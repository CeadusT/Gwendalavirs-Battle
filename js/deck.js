'use strict';
/* ==========================================================================
   Deck en cours, panneau du deck et fenêtre « Mes decks ».
   ========================================================================== */

const deckPanel = $('#deckPanel');

/* ---------- État du deck ---------- */

let deck = readJson(STORAGE_KEYS.deck, {});            // id de carte → nombre d'exemplaires
let deckOrder = readJson(STORAGE_KEYS.deckOrder, []);  // ordre d'affichage (et d'export)
let deckName = readText(STORAGE_KEYS.deckName) || 'Mon deck';
let hero = null;                                       // carte Héros (résolue une fois les cartes chargées)
let savedDecks = [];                                   // decks enregistrés (IndexedDB, chargés au démarrage)
let currentDeckId = readText(STORAGE_KEYS.currentDeckId);

function saveDeckState() {
  writeJson(STORAGE_KEYS.deck, deck);
  writeJson(STORAGE_KEYS.deckOrder, deckOrder);
  writeText(STORAGE_KEYS.deckName, deckName);
  writeText(STORAGE_KEYS.hero, hero?.id ?? null);
}

function saveDecks() {
  saveDeckLibrary();
  writeText(STORAGE_KEYS.currentDeckId, currentDeckId);
}

/* Après un changement de cartes, le héros pointe vers la version à jour (ou disparaît). */
function resolveHero() {
  hero = hero ? cardsById.get(hero.id) || null : null;
}

function loadStoredHero() {
  hero = cardsById.get(readText(STORAGE_KEYS.hero)) || null;
}

function qtyOf(id) {
  return Number(deck[id]) || 0;
}

function ensureDeckOrder() {
  const ids = Object.keys(deck).filter(id => qtyOf(id) > 0);
  deckOrder = deckOrder.filter(id => ids.includes(id));
  for (const id of ids) if (!deckOrder.includes(id)) deckOrder.push(id);
}

/* Cartes du deck dans l'ordre affiché : [{ c, q }]. */
function deckEntries() {
  ensureDeckOrder();
  return deckOrder.map(id => ({ c: cardsById.get(id), q: qtyOf(id) })).filter(x => x.c && x.q > 0);
}

/* Liste à plat des exemplaires à imprimer : le héros d'abord, puis le deck dans l'ordre affiché. */
function deckCardCopies() {
  const copies = hero ? [hero] : [];
  for (const { c, q } of deckEntries()) for (let i = 0; i < q; i++) copies.push(c);
  return copies;
}

function removeFromDeck(id) {
  delete deck[id];
  deckOrder = deckOrder.filter(x => x !== id);
  if (hero?.id === id) hero = null;
}

function deckChanged() {
  saveDeckState();
  renderDeck();
  renderLibrary();
}

function addCard(c) {
  if (!c) return;
  if (isHeroCard(c)) {
    hero = c;
    deckChanged();
    flash(`${c.name} devient ton héros.`);
    return;
  }
  if (!deckOrder.includes(c.id)) deckOrder.push(c.id);
  deck[c.id] = qtyOf(c.id) + 1;
  deckChanged();
}

function removeCard(id) {
  if (qtyOf(id) > 1) deck[id]--;
  else removeFromDeck(id);
  deckChanged();
}

function subtractCard(c) {
  if (!c) return;
  if (!isHeroCard(c)) {
    removeCard(c.id);
  } else if (hero?.id === c.id) {
    hero = null;
    deckChanged();
    flash('Héros retiré.');
  }
}

function moveDeckItem(sourceId, targetId, after) {
  if (sourceId === targetId) return;
  ensureDeckOrder();
  if (!deckOrder.includes(sourceId) || !deckOrder.includes(targetId)) return;
  deckOrder.splice(deckOrder.indexOf(sourceId), 1);
  deckOrder.splice(deckOrder.indexOf(targetId) + (after ? 1 : 0), 0, sourceId);
  saveDeckState();
  renderDeck();
}

/* ---------- Panneau du deck ---------- */

function renderBreakdown(target, items, total) {
  $(target).innerHTML = items.map(([label, value]) => {
    const pct = total ? Math.round((value / total) * 100) : 0;
    return `<div class="breakdownRow"><span>${escapeHtml(label)}</span><b>${value}</b><em>${pct}%</em><span class="breakdownBar"><i style="width:${pct}%"></i></span></div>`;
  }).join('');
}

function renderDeckBreakdowns(entries) {
  const all = hero ? [...entries, { c: hero, q: 1 }] : entries;
  const total = all.reduce((n, x) => n + x.q, 0);
  const count = (...types) => all.filter(x => types.includes(x.c.type)).reduce((n, x) => n + x.q, 0);
  renderBreakdown('#drawingBreakdown', [
    ['Dessin de base', count('Dessin de base', 'Dessin de base jeton')],
    ['Dessin avancé', count('Dessin avancé')],
    ['Dessin légendaire', count('Dessin légendaire')],
  ], total);
}

function deckRowMarkup({ c, q }) {
  const max = limitOf(c);
  const over = q > max;
  const id = escapeHtml(c.id);
  return `<div class="deckRow" draggable="true" data-id="${id}" title="Double-clic : retrouver la carte dans la bibliothèque · glisse pour réordonner, ou vers la bibliothèque pour retirer 1 exemplaire">`
    + `<span class="deckThumb ${colorClass(c)}"${backgroundImageStyle(c.image)}></span>`
    + `<span class="mana">${c.spire}</span><span class="name" title="${escapeHtml(c.name)}">${escapeHtml(c.name)}</span>`
    + `<button class="rowBtn minus" data-id="${id}">−</button><button class="rowBtn plus" data-id="${id}">+</button>`
    + `<span class="qty ${over ? 'over' : ''}" title="${over ? 'Limite dépassée' : ''}">${q}/${max}</span></div>`;
}

function renderDeck() {
  const entries = deckEntries();
  const total = entries.reduce((n, x) => n + x.q, 0);
  $('#deckCount').textContent = total;
  $('#statCards').textContent = total;
  $('#statColors').textContent = new Set(entries.map(x => x.c.color)).size;
  $('#statSpire').textContent = entries.reduce((n, x) => n + x.c.spire * x.q, 0);
  $('#deckName').textContent = deckName;
  $('#heroName').textContent = hero ? hero.name : 'Aucun héros';
  $('#heroMeta').textContent = hero ? `${hero.color} · ${hero.rarity}` : 'Choisis un Héros dans la bibliothèque';
  $('#heroOrb').textContent = hero ? '✦' : '+';
  renderDeckBreakdowns(entries);
  $('#deckRows').innerHTML = entries.length
    ? entries.map(deckRowMarkup).join('')
    : '<div class="note">Ajoute des cartes depuis la bibliothèque ou glisse-les ici.</div>';
}

const deckRows = $('#deckRows');
const clearDeckDropMarkers = () => $$('.deckRow').forEach(x => x.classList.remove('dropBefore', 'dropAfter'));
const rowDropsAfter = (row, e) => {
  const box = row.getBoundingClientRect();
  return e.clientY > box.top + box.height / 2;
};

deckRows.addEventListener('click', e => {
  const button = e.target.closest('.rowBtn');
  if (!button) return;
  e.stopPropagation();
  if (button.classList.contains('minus')) removeCard(button.dataset.id);
  else addCard(cardsById.get(button.dataset.id));
});

/* Double-clic sur une ligne du deck (ou sur le héros) : retrouver la carte dans la bibliothèque. */
deckRows.addEventListener('dblclick', e => {
  const row = e.target.closest('.deckRow');
  if (!row || e.target.closest('button')) return;
  revealInLibrary(row.dataset.id);
});
$('.hero').addEventListener('dblclick', () => {
  if (hero) revealInLibrary(hero.id);
});

deckRows.addEventListener('dragstart', e => {
  const row = e.target.closest('.deckRow');
  if (!row) return;
  if (e.target.closest('button')) {
    e.preventDefault();
    return;
  }
  dragContext = { id: row.dataset.id, source: 'deck' };
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', row.dataset.id);
  document.body.classList.add('draggingCard');
  row.classList.add('dragging');
});

deckRows.addEventListener('dragover', e => {
  const row = e.target.closest('.deckRow');
  if (!row || dragContext?.source !== 'deck' || dragContext.id === row.dataset.id) return;
  e.preventDefault();
  clearDeckDropMarkers();
  row.classList.add(rowDropsAfter(row, e) ? 'dropAfter' : 'dropBefore');
  e.dataTransfer.dropEffect = 'move';
});

deckRows.addEventListener('drop', e => {
  const row = e.target.closest('.deckRow');
  if (!row || dragContext?.source !== 'deck' || dragContext.id === row.dataset.id) return;
  e.preventDefault();
  e.stopPropagation();
  const sourceId = dragContext.id;
  clearDeckDropMarkers();
  dragContext = null;
  moveDeckItem(sourceId, row.dataset.id, rowDropsAfter(row, e));
});

deckRows.addEventListener('dragend', e => {
  e.target.closest?.('.deckRow')?.classList.remove('dragging');
  clearDeckDropMarkers();
  endDrag();
});

/* Une carte de la bibliothèque déposée sur le deck y est ajoutée. */
deckPanel.addEventListener('dragover', e => {
  if (dragContext?.source !== 'library') return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  deckPanel.classList.add('dropActive');
});
deckPanel.addEventListener('dragleave', e => {
  if (!deckPanel.contains(e.relatedTarget)) deckPanel.classList.remove('dropActive');
});
deckPanel.addEventListener('drop', e => {
  if (dragContext?.source !== 'library') return;
  e.preventDefault();
  const id = dragContext.id;
  endDrag();
  addCard(cardsById.get(id));
});

$('#clear').onclick = () => {
  deck = {};
  deckOrder = [];
  hero = null;
  deckChanged();
  flash('Deck vidé.');
};

/* ---------- Fenêtre « Renommer » ---------- */

const renameModal = $('#renameModal');
const renameInput = $('#renameInput');

function openRename() {
  renameInput.value = deckName;
  renameModal.classList.remove('hidden');
  setTimeout(() => {
    renameInput.focus();
    renameInput.select();
  }, 0);
}

function closeRename() {
  renameModal.classList.add('hidden');
}

function saveRename() {
  const next = renameInput.value.trim();
  if (!next) return;
  deckName = next;
  saveDeckState();
  renderDeck();
  closeRename();
  flash('Deck renommé.');
}

$('#renameDeck').onclick = openRename;
$('#renameCancel').onclick = closeRename;
$('#renameSave').onclick = saveRename;
renameInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') saveRename();
  if (e.key === 'Escape') closeRename();
});
closeOnBackdrop(renameModal, closeRename);

/* ---------- Fenêtre « Mes decks » ---------- */

const decksModal = $('#decksModal');
const savedDeckList = $('#savedDeckList');
const newDeckNameInput = $('#newDeckName');

function closeOnBackdrop(modal, close) {
  modal.addEventListener('mousedown', e => {
    if (e.target === modal) close();
  });
}

function newDeckId() {
  let id;
  do id = `deck-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  while (savedDecks.some(d => d.id === id));
  return id;
}

function deckSnapshot(id, name) {
  return { id, name, deck: { ...deck }, deckOrder: [...deckOrder], heroId: hero?.id || null, updatedAt: Date.now() };
}

/* Le deck en cours a-t-il des changements qui seraient perdus en en ouvrant un autre ? */
function hasUnsavedDeckChanges() {
  ensureDeckOrder();
  const saved = savedDecks.find(d => d.id === currentDeckId);
  if (!saved) return deckOrder.length > 0 || !!hero;
  const current = deckSnapshot(saved.id, deckName);
  return saved.name !== deckName
    || !sameJson(Object.entries(saved.deck || {}).filter(([, q]) => Number(q) > 0).sort(), Object.entries(current.deck).sort())
    || (saved.heroId || null) !== current.heroId;
}

function confirmDiscardDeckChanges() {
  return !hasUnsavedDeckChanges() || confirm(`Le deck « ${deckName} » contient des modifications non enregistrées.\n\nElles seront perdues. Continuer ?`);
}

function renderSavedDecks() {
  const query = deckSearchInput.value.trim().toLocaleLowerCase('fr');
  const shown = savedDecks.filter(d => !query || String(d.name).toLocaleLowerCase('fr').includes(query));
  $('#savedDeckCount').textContent = savedDecks.length > 1 ? `${savedDecks.length} decks enregistrés` : savedDecks.length ? '1 deck enregistré' : '';
  if (!shown.length) {
    savedDeckList.innerHTML = `<div class="note">${savedDecks.length ? 'Aucun deck ne correspond à cette recherche.' : 'Aucun deck enregistré.'}</div>`;
    return;
  }
  savedDeckList.innerHTML = shown.map(d => {
    const total = Object.values(d.deck || {}).reduce((n, q) => n + Number(q || 0), 0) + (d.heroId ? 1 : 0);
    const isCurrent = d.id === currentDeckId;
    return `<div class="savedDeckRow ${isCurrent ? 'current' : ''}" data-id="${escapeHtml(d.id)}"><div class="savedDeckInfo"><strong>${escapeHtml(d.name)}</strong><small>${total} carte(s) · ${isCurrent ? 'deck actif' : 'sauvegardé'}</small></div>`
      + '<button data-action="open">Ouvrir</button><button data-action="rename">Renommer</button><button data-action="duplicate">Dupliquer</button><button class="deleteSavedDeck" data-action="delete">Supprimer</button></div>';
  }).join('');
}

const deckSearchInput = $('#deckSearch');
deckSearchInput.addEventListener('input', renderSavedDecks);

function openDecksModal() {
  newDeckNameInput.value = deckName;
  deckSearchInput.value = '';
  renderSavedDecks();
  decksModal.classList.remove('hidden');
}

function closeDecksModal() {
  decksModal.classList.add('hidden');
}

$('#decksClose').onclick = closeDecksModal;
closeOnBackdrop(decksModal, closeDecksModal);

$('#saveCurrentDeck').onclick = () => {
  const name = newDeckNameInput.value.trim() || deckName;
  const updatesExisting = savedDecks.some(d => d.id === currentDeckId);
  if (updatesExisting) {
    savedDecks = savedDecks.map(d => (d.id === currentDeckId ? deckSnapshot(d.id, name) : d));
  } else {
    currentDeckId = newDeckId();
    savedDecks.push(deckSnapshot(currentDeckId, name));
  }
  deckName = name;
  saveDeckState();
  saveDecks();
  renderDeck();
  renderSavedDecks();
  flash(updatesExisting ? 'Deck mis à jour.' : 'Nouveau deck enregistré.');
};

$('#createEmptyDeck').onclick = () => {
  if (!confirmDiscardDeckChanges()) return;
  currentDeckId = null;
  deckName = newDeckNameInput.value.trim() || 'Nouveau deck';
  deck = {};
  deckOrder = [];
  hero = null;
  newDeckNameInput.value = deckName;
  saveDeckState();
  saveDecks();
  renderDeck();
  renderLibrary();
  renderSavedDecks();
  flash('Nouveau deck prêt : enregistre-le quand il est terminé.');
};

const savedDeckActions = {
  open(item) {
    if (item.id !== currentDeckId && !confirmDiscardDeckChanges()) return;
    currentDeckId = item.id;
    deckName = item.name;
    deck = { ...(item.deck || {}) };
    deckOrder = [...(item.deckOrder || Object.keys(deck))];
    hero = cardsById.get(item.heroId) || null;
    saveDeckState();
    saveDecks();
    renderDeck();
    renderLibrary();
    closeDecksModal();
    setView('deck');
    flash('Deck ouvert.');
  },
  rename(item) {
    const name = prompt('Nouveau nom du deck', item.name)?.trim();
    if (!name) return;
    item.name = name;
    if (item.id === currentDeckId) {
      deckName = name;
      saveDeckState();
      renderDeck();
    }
    saveDecks();
    renderSavedDecks();
  },
  duplicate(item) {
    savedDecks.push({ ...structuredClone(item), id: newDeckId(), name: `${item.name} — copie`, updatedAt: Date.now() });
    saveDecks();
    renderSavedDecks();
    flash('Deck dupliqué.');
  },
  delete(item) {
    if (!confirm(`Supprimer « ${item.name} » ?`)) return;
    savedDecks = savedDecks.filter(d => d.id !== item.id);
    if (currentDeckId === item.id) currentDeckId = null;
    saveDecks();
    renderSavedDecks();
    flash('Deck supprimé.');
  },
};

savedDeckList.onclick = e => {
  const button = e.target.closest('button[data-action]');
  const item = button && savedDecks.find(d => d.id === button.closest('.savedDeckRow').dataset.id);
  if (item) savedDeckActions[button.dataset.action]?.(item);
};

/* ---------- Export pour le logiciel de jeu ---------- */

const GAME_CARD_FIELDS = ['id', 'name', 'type', 'subtype', 'color', 'rarity', 'set', 'spire', 'text', 'attack', 'health', 'showAttack', 'showHealth', 'showSpire', 'fullArt', 'image'];
const gameCard = c => Object.fromEntries(GAME_CARD_FIELDS.filter(k => c[k] !== undefined).map(k => [k, c[k]]));

/* Fichier lu par le logiciel de jeu (format « gwendalavirs-battle-deck ») :
   chaque carte y est copiée en entier, le jeu n'a donc pas besoin de la bibliothèque. */
function exportDeckForGame() {
  const entries = deckEntries();
  if (!entries.length && !hero) return flash('Le deck est vide.');
  const data = {
    format: 'gwendalavirs-battle-deck',
    version: 1,
    name: deckName,
    exportedAt: new Date().toISOString(),
    hero: hero ? gameCard(hero) : null,
    cards: entries.map(({ c, q }) => ({ card: gameCard(c), quantity: q })),
  };
  downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `${safeFileName(deckName, 'mon-deck')}.gwb-deck.json`);
  flash('Deck exporté pour le logiciel de jeu.');
}

