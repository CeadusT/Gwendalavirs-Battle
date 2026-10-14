'use strict';
/* ==========================================================================
   Stockage dans le navigateur.
   - localStorage : petits réglages et le deck en cours (clés « gwb.* »).
   - IndexedDB    : les données lourdes ou nombreuses (cartes créées / modifiées, corbeille,
                    decks enregistrés), qui dépasseraient vite la limite de ~5 Mo du localStorage.
   ========================================================================== */

const STORAGE_KEYS = {
  // Deck en cours
  deck: 'gwb.deck',
  deckOrder: 'gwb.deckOrder',
  deckName: 'gwb.deckName',
  hero: 'gwb.hero',
  savedDecks: 'gwb.savedDecks',         // repli si IndexedDB est indisponible
  currentDeckId: 'gwb.currentDeckId',
  // Bibliothèque
  libraryOrder: 'gwb.libraryOrder',
  shareList: 'gwb.shareList',              // cartes rassemblées dans l'onglet Partage
  bookmarks: 'gwb.bookmarks',
  freshlySaved: 'gwb.freshlySaved',
  limitRules: 'gwb.limitRules',
  customTypes: 'gwb.customTypes',
  customSubtypes: 'gwb.customSubtypes',
  deletedTypes: 'gwb.deletedTypes',
  permanentlyDeletedBase: 'gwb.permanentlyDeletedBase',
  // Réglages d'affichage
  cardSize: 'gwb.cardSize',
  displaySpires: 'gwb.displaySpires',
  panels: 'gwb.panels',
  deckPanes: 'gwb.deckPanes',
  studioPanes: 'gwb.studioPanes',
  studioPanelState: 'gwb.studioPanelState',
  studioZoom: 'gwb.studioZoom',
  studioHistoryHidden: 'gwb.studioHistoryHidden',
  spellLang: 'gwb.spellLang',
  // Repli si IndexedDB est indisponible (et anciennes versions du site)
  customCards: 'gwb.customCards',
  editedBase: 'gwb.editedBase',
  trashCards: 'gwb.trashCards',
};

/* Les versions ≤ 1.8 utilisaient aussi des clés « deckforge.* » : on les renomme une fois. */
const LEGACY_KEYS = {
  'deckforge.deck': STORAGE_KEYS.deck,
  'deckforge.deckName': STORAGE_KEYS.deckName,
  'deckforge.hero': STORAGE_KEYS.hero,
  'deckforge.size': STORAGE_KEYS.cardSize,
  'deckforge.customCards': STORAGE_KEYS.customCards,
};

function migrateLegacyKeys() {
  try {
    for (const [oldKey, newKey] of Object.entries(LEGACY_KEYS)) {
      const value = localStorage.getItem(oldKey);
      if (value === null) continue;
      if (localStorage.getItem(newKey) === null) localStorage.setItem(newKey, value);
      localStorage.removeItem(oldKey);
    }
  } catch (err) {
    console.warn('Migration des anciennes clés impossible', err);
  }
}

function readText(key, fallback = null) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null || raw === '') return fallback;
    return JSON.parse(raw) ?? fallback;
  } catch {
    return fallback;
  }
}

let storageWarningShown = false;
function warnStorageFull(err) {
  console.warn('Écriture impossible dans le stockage du navigateur', err);
  if (storageWarningShown) return;
  storageWarningShown = true;
  flash('Stockage du navigateur plein : la dernière modification n’a pas pu être enregistrée.');
}

function writeText(key, value) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, String(value));
    return true;
  } catch (err) {
    warnStorageFull(err);
    return false;
  }
}

function writeJson(key, value) {
  return writeText(key, JSON.stringify(value));
}

/* ---------- IndexedDB ---------- */

const DB_NAME = 'gwendalavirs-battle';
const DB_STORE = 'state';
let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(DB_STORE)) request.result.createObjectStore(DB_STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise;
}

async function dbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function dbSet(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/* Enregistre dans IndexedDB, sinon (navigation privée, etc.) dans le localStorage.
   Renvoie true si les données ont été enregistrées quelque part. */
async function writeHeavyData(dbKey, data, fallbackKeys) {
  try {
    await dbSet(dbKey, data);
    for (const key of Object.values(fallbackKeys)) localStorage.removeItem(key);
    return true;
  } catch (err) {
    console.warn('IndexedDB indisponible', err);
    return Object.entries(fallbackKeys).every(([field, key]) => writeJson(key, data[field]));
  }
}

/* Une seule écriture à la fois par clé : les demandes faites pendant une écriture sont
   regroupées en une seule, lancée ensuite avec l'état le plus récent (getData est lu à ce
   moment-là). Évite d'empiler des dizaines d'écritures lors d'actions rapprochées. */
const heavyWrites = new Map();   // clé → { running, queued, busy }

function saveHeavyData(dbKey, getData, fallbackKeys) {
  const entry = heavyWrites.get(dbKey) || {};
  heavyWrites.set(dbKey, entry);
  if (!entry.queued) {
    entry.queued = (async () => {
      await entry.running;
      entry.queued = null;
      entry.busy = true;
      entry.running = writeHeavyData(dbKey, getData(), fallbackKeys).finally(() => { entry.busy = !!entry.queued; });
      return entry.running;
    })();
  }
  return entry.queued;
}

function hasPendingWrites() {
  return [...heavyWrites.values()].some(entry => entry.queued || entry.busy);
}

function saveCardData() {
  return saveHeavyData('cards', () => ({ customCards, editedBase }), { customCards: STORAGE_KEYS.customCards, editedBase: STORAGE_KEYS.editedBase });
}

function saveDeckLibrary() {
  return saveHeavyData('decks', () => ({ savedDecks }), { savedDecks: STORAGE_KEYS.savedDecks });
}

function saveTrashData() {
  writeJson(STORAGE_KEYS.permanentlyDeletedBase, [...permanentlyDeletedBase]);
  return saveHeavyData('trash', () => ({ trashCards }), { trashCards: STORAGE_KEYS.trashCards });
}

/* Prévient avant de fermer la page si un enregistrement est encore en cours. */
window.addEventListener('beforeunload', e => {
  if (hasPendingWrites()) e.preventDefault();
});

/* Charge les données lourdes. Ce qui traîne encore dans le localStorage (ancienne
   version ou repli) est repris puis basculé dans IndexedDB. */
async function loadHeavyData() {
  const fromLocal = {
    customCards: readJson(STORAGE_KEYS.customCards, []),
    editedBase: readJson(STORAGE_KEYS.editedBase, {}),
    trashCards: readJson(STORAGE_KEYS.trashCards, []),
    savedDecks: readJson(STORAGE_KEYS.savedDecks, []),
  };
  let storedCards = null;
  let storedTrash = null;
  let storedDecks = null;
  try {
    [storedCards, storedTrash, storedDecks] = await Promise.all([dbGet('cards'), dbGet('trash'), dbGet('decks')]);
  } catch (err) {
    console.warn('Chargement du stockage étendu impossible', err);
    return fromLocal;
  }
  const data = {
    customCards: Array.isArray(storedCards?.customCards) ? storedCards.customCards : fromLocal.customCards,
    editedBase: storedCards?.editedBase && typeof storedCards.editedBase === 'object' ? storedCards.editedBase : fromLocal.editedBase,
    trashCards: Array.isArray(storedTrash?.trashCards) ? storedTrash.trashCards : fromLocal.trashCards,
    savedDecks: Array.isArray(storedDecks?.savedDecks) ? storedDecks.savedDecks : fromLocal.savedDecks,
  };
  data.needsCardMigration = !storedCards && (fromLocal.customCards.length > 0 || Object.keys(fromLocal.editedBase).length > 0);
  data.needsTrashMigration = !storedTrash && fromLocal.trashCards.length > 0;
  data.needsDeckMigration = !storedDecks && fromLocal.savedDecks.length > 0;
  return data;
}
