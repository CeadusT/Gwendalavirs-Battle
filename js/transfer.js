'use strict';
/* ==========================================================================
   Partage de bibliothèque : export / import JSON entre joueurs,
   et import de cartes en lot depuis le modèle Excel.
   ========================================================================== */

const LIBRARY_FORMAT = 'gwendalavirs-battle-library';

/* Marque les cartes importées comme « nouvelles » et les remet dans l'historique du Studio. */
function markImported(ids) {
  for (const id of ids) {
    freshlySaved.add(id);
    studioHistoryHidden.delete(id);
  }
  saveFreshlySaved();
  saveStudioHistory();
}

/* ---------- JSON ---------- */

$('#exportLibrary').onclick = () => {
  ensureLibraryOrder();
  const pack = { format: LIBRARY_FORMAT, version: 1, exportedAt: new Date().toISOString(), customCards, editedBase, limitRules, libraryOrder };
  downloadBlob(new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' }), `Gwendalavirs-Battle-Bibliotheque-${new Date().toISOString().slice(0, 10)}.gwb.json`);
  flash('Bibliothèque exportée. Envoie ce fichier à l’autre joueur.');
};

/* Liste légère : toutes les cartes visibles, sans illustrations ni mise en forme. */
$('#exportCardList').onclick = () => {
  const fields = ['id', 'name', 'type', 'subtype', 'color', 'rarity', 'set', 'spire', 'attack', 'health', 'showAttack', 'showHealth', 'showSpire', 'fullArt', 'unique', 'creativity', 'power', 'text'];
  const list = cards.map(c => Object.fromEntries(fields.map(k => [k, k === 'text' ? plainText(c.text) : c[k]])));
  const pack = { format: 'gwendalavirs-battle-card-list', version: 1, exportedAt: new Date().toISOString(), count: list.length, cards: list };
  downloadBlob(new Blob([JSON.stringify(pack)], { type: 'application/json' }), `Gwendalavirs-Battle-Cartes-${new Date().toISOString().slice(0, 10)}.json`);
  flash(`${list.length} cartes exportées sans illustrations.`);
};

$('#importLibrary').onclick = () => $('#importLibraryFile').click();

/* Les cartes « Ewilan » et « Salim » importées reprennent l'illustration déjà
   présente dans ta bibliothèque pour ce personnage (comportement des versions précédentes). */
const SHARED_ART_CHARACTERS = ['Ewilan', 'Salim'];
function reuseCharacterArt(c) {
  const character = SHARED_ART_CHARACTERS.find(name => new RegExp(name, 'i').test(c.name));
  if (!character) return c;
  const existing = cards.find(x => x.id !== c.id && x.image && new RegExp(character, 'i').test(x.name));
  return existing ? { ...c, image: existing.image } : c;
}

$('#importLibraryFile').onchange = async e => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  try {
    const pack = JSON.parse(await file.text());
    if (pack?.format !== LIBRARY_FORMAT) throw new Error('format');
    const incoming = (Array.isArray(pack.customCards) ? pack.customCards : []).filter(c => c && typeof c === 'object').map(normalizeCard).map(reuseCharacterArt);
    const incomingEdits = pack.editedBase && typeof pack.editedBase === 'object' ? pack.editedBase : {};

    const byId = new Map(customCards.map(c => [c.id, c]));
    for (const c of incoming) byId.set(c.id, c);
    customCards = [...byId.values()];
    editedBase = { ...editedBase, ...incomingEdits };
    if (pack.limitRules) limitRules = normalizeRules(pack.limitRules);

    // Les cartes importées gardent l'ordre de l'autre joueur, à la suite des tiennes.
    const incomingIds = new Set([...incoming.map(c => c.id), ...Object.keys(incomingEdits)]);
    if (Array.isArray(pack.libraryOrder)) {
      const importedOrder = pack.libraryOrder.map(String).filter(id => incomingIds.has(id));
      const rest = [...incomingIds].filter(id => !importedOrder.includes(id));
      libraryOrder = [...libraryOrder.filter(id => !incomingIds.has(id)), ...importedOrder, ...rest];
    }

    if (!(await saveCardData())) throw new Error('storage');
    saveRules();
    saveLibraryOrder();
    markImported(incomingIds);
    cardsChanged();
    flash(`${incomingIds.size} carte(s) importée(s) / mise(s) à jour.`);
  } catch (err) {
    console.error(err);
    flash(err?.message === 'storage' ? 'Espace de stockage du navigateur indisponible.' : 'Fichier de bibliothèque invalide ou illisible.');
  }
};

/* ---------- Lecture d'un fichier Excel (.xlsx) ----------
   Un .xlsx est un ZIP de fichiers XML : on le lit directement, sans bibliothèque
   externe, pour que l'import fonctionne aussi hors ligne. */

const OOXML_REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

async function unzip(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  // Fin du répertoire central : signature 0x06054b50, cherchée depuis la fin du fichier.
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('xlsx-zip');
  const files = new Map();
  let pos = view.getUint32(end + 16, true);
  for (let i = 0, total = view.getUint16(end + 10, true); i < total; i++) {
    if (view.getUint32(pos, true) !== 0x02014b50) throw new Error('xlsx-central');
    const method = view.getUint16(pos + 10, true);
    const packedSize = view.getUint32(pos + 20, true);
    const nameLength = view.getUint16(pos + 28, true);
    const extraLength = view.getUint16(pos + 30, true);
    const commentLength = view.getUint16(pos + 32, true);
    const localHeader = view.getUint32(pos + 42, true);
    const name = new TextDecoder().decode(bytes.slice(pos + 46, pos + 46 + nameLength));
    const dataStart = localHeader + 30 + view.getUint16(localHeader + 26, true) + view.getUint16(localHeader + 28, true);
    const packed = bytes.slice(dataStart, dataStart + packedSize);
    if (method === 0) {
      files.set(name, packed);
    } else if (method === 8) {
      const stream = new Blob([packed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      files.set(name, new Uint8Array(await new Response(stream).arrayBuffer()));
    } else {
      throw new Error('xlsx-compression');
    }
    pos += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

function xmlDoc(bytes) {
  if (!bytes) throw new Error('xlsx-xml');
  const doc = new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('xlsx-xml');
  return doc;
}
const xmlNodes = (node, name) => [...node.getElementsByTagNameNS('*', name)];
const xmlFirst = (node, name) => node?.getElementsByTagNameNS('*', name)[0] || null;
const xmlText = node => xmlNodes(node, 't').map(x => x.textContent || '').join('');
const relId = node => node?.getAttribute('r:id') || node?.getAttribute('r:embed') || node?.getAttributeNS(OOXML_REL_NS, 'id') || node?.getAttributeNS(OOXML_REL_NS, 'embed') || '';
const relationships = doc => new Map(xmlNodes(doc, 'Relationship').map(r => [r.getAttribute('Id'), r.getAttribute('Target')]));
const relsPathOf = path => {
  const parts = path.split('/');
  const name = parts.pop();
  return `${parts.join('/')}/_rels/${name}.rels`;
};

function resolveZipPath(base, target) {
  target = String(target || '');
  if (target.startsWith('/')) return target.slice(1);
  return new URL(target, `https://xlsx.local/${base}`).pathname.replace(/^\//, '');
}

/* « AB12 » → index de colonne 27. */
function columnIndex(ref) {
  let n = 0;
  for (const ch of ref.match(/^[A-Z]+/i)?.[0] || '') n = n * 26 + ch.toUpperCase().charCodeAt(0) - 64;
  return n - 1;
}

const IMAGE_MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', svg: 'image/svg+xml', gif: 'image/gif' };

/* Images collées dans la feuille : renvoie une Map « ligne:colonne » → data URL. */
async function readEmbeddedImages(zip, sheetPath, sheetDoc) {
  const found = new Map();
  const sheetRels = zip.get(relsPathOf(sheetPath));
  const drawingNode = xmlFirst(sheetDoc, 'drawing');
  if (!sheetRels || !drawingNode) return found;
  const drawingPath = resolveZipPath(sheetPath, relationships(xmlDoc(sheetRels)).get(relId(drawingNode)));
  const drawingBytes = zip.get(drawingPath);
  const drawingRels = zip.get(relsPathOf(drawingPath));
  if (!drawingBytes || !drawingRels) return found;
  const drawing = xmlDoc(drawingBytes);
  const mediaById = relationships(xmlDoc(drawingRels));
  for (const anchor of [...xmlNodes(drawing, 'oneCellAnchor'), ...xmlNodes(drawing, 'twoCellAnchor')]) {
    const from = xmlFirst(anchor, 'from');
    const row = Number(xmlFirst(from, 'row')?.textContent);
    const col = Number(xmlFirst(from, 'col')?.textContent);
    const mediaPath = resolveZipPath(drawingPath, mediaById.get(relId(xmlFirst(anchor, 'svgBlip') || xmlFirst(anchor, 'blip'))));
    const bytes = zip.get(mediaPath);
    if (!Number.isFinite(row) || !Number.isFinite(col) || !bytes) continue;
    const mime = IMAGE_MIME[mediaPath.split('.').pop()?.toLowerCase()] || 'application/octet-stream';
    found.set(`${row}:${col}`, await readFileAsDataUrl(new Blob([bytes], { type: mime })));
  }
  return found;
}

/* Lit la feuille « Cartes » : renvoie les lignes (tableaux de valeurs) et les images. */
async function readExcelRows(file) {
  const zip = await unzip(await file.arrayBuffer());
  const workbook = xmlDoc(zip.get('xl/workbook.xml'));
  const sheet = xmlNodes(workbook, 'sheet').find(s => excelKey(s.getAttribute('name')) === 'cartes');
  if (!sheet) throw new Error('xlsx-sheet');
  let target = relationships(xmlDoc(zip.get('xl/_rels/workbook.xml.rels'))).get(relId(sheet));
  if (!target) throw new Error('xlsx-sheet');
  target = target.replace(/^\//, '');
  if (!target.startsWith('xl/')) target = `xl/${target.replace(/^\.\//, '')}`;
  if (!zip.get(target)) throw new Error('xlsx-sheet');

  const sharedBytes = zip.get('xl/sharedStrings.xml');
  const shared = sharedBytes ? xmlNodes(xmlDoc(sharedBytes), 'si').map(xmlText) : [];
  const doc = xmlDoc(zip.get(target));
  const rows = [];
  for (const row of xmlNodes(doc, 'row')) {
    const values = [];
    const rowNumber = Math.max(1, Number(row.getAttribute('r')) || rows.length + 1);
    for (const cell of xmlNodes(row, 'c')) {
      const type = cell.getAttribute('t');
      const v = xmlFirst(cell, 'v')?.textContent ?? '';
      const inline = xmlFirst(cell, 'is');
      values[columnIndex(cell.getAttribute('r') || '')] =
        type === 's' ? shared[Number(v)] ?? ''
        : type === 'inlineStr' && inline ? xmlText(inline)
        : type === 'b' ? (v === '1' ? 'Oui' : 'Non')
        : v;
    }
    rows[rowNumber - 1] = values;
  }
  return { rows, embeddedImages: await readEmbeddedImages(zip, target, doc) };
}

/* ---------- Conversion d'une ligne Excel en carte ---------- */

/* En-tête normalisé : sans accents, minuscules, « Rareté » → « rarete ». */
function excelKey(v) {
  return String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function excelBool(v, fallback = false) {
  const key = excelKey(v);
  if (['oui', 'true', 'vrai', '1', 'x'].includes(key)) return true;
  if (['non', 'false', 'faux', '0'].includes(key)) return false;
  return fallback;
}

function excelNumber(v, fallback = 0) {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
}

/* Retrouve la valeur officielle malgré les variantes de saisie (casse, accents,
   apostrophe typographique ’ …) : « Commune » → « Commun », « D’un monde… » → « D'un monde… ». */
const EXCEL_ALIASES = { commune: 'Commun', legendaire: 'Légendaire' };
function matchOfficial(value, officialValues) {
  const key = excelKey(value);
  if (!key) return '';
  return officialValues.find(v => excelKey(v) === key) || (officialValues.includes(EXCEL_ALIASES[key]) ? EXCEL_ALIASES[key] : String(value).trim());
}

function cardFromExcel(row, headers, line, embeddedImages) {
  // Lit la première colonne existante parmi plusieurs noms possibles.
  const get = (...names) => {
    for (const name of names) {
      const index = headers.get(excelKey(name));
      if (index !== undefined) return row[index] ?? '';
    }
    return '';
  };
  const name = String(get('Nom')).trim();
  if (!name) return null;
  const color = matchOfficial(get('Couleur'), COLOR_NAMES);
  const type = String(get('Type', 'Tribal')).trim();
  const rarity = matchOfficial(get('Rareté', 'Rarete'), RARITIES);
  const set = matchOfficial(get('Set'), SETS) || SETS[0];
  const spire = excelNumber(get('Volonté', 'Volonte', 'Spire'), 0);

  const errors = [];
  if (!COLORS[color]) errors.push(`couleur « ${color} »`);
  if (!type) errors.push('Type manquant');
  if (!RARITIES.includes(rarity)) errors.push(`rareté « ${rarity} »`);
  if (!SETS.includes(set)) errors.push(`Set « ${set} »`);
  if (spire < MIN_SPIRE || spire > MAX_SPIRE) errors.push(`Volonté ${spire}`);
  if (errors.length) throw new Error(`Ligne ${line} : ${errors.join(', ')}`);

  const html = String(get('Texte HTML')).trim();
  const plain = String(get('Texte')).replace(/\r\n?/g, '\n');
  const imageColumn = headers.get('illustration');
  const embeddedImage = imageColumn === undefined ? '' : embeddedImages.get(`${line - 1}:${imageColumn}`);
  const isCharacter = type.includes('Personnage');

  return normalizeCard({
    id: String(get('ID')).trim() || `custom-${Date.now()}-${line}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    color,
    type,
    subtype: String(get('Sous-type', 'Sous type')).trim(),
    rarity,
    spire,
    showSpire: excelBool(get('Afficher Volonté (1/0)', 'Afficher Volonte (1/0)', 'Afficher Spire (1/0)'), !AUTO_HIDE_SPIRE_TYPES.has(type)),
    image: embeddedImage || String(get('Illustration')).trim() || undefined,
    text: sanitizeRichText(html || escapeHtml(plain).replace(/\n/g, '<br>')),
    set,
    attack: Math.max(0, excelNumber(get('ATK', 'Attaque'), 0)),
    health: Math.max(0, excelNumber(get('PV', 'Points de vie'), 0)),
    showAttack: excelBool(get('Afficher ATK (1/0)', 'Afficher Attaque (1/0)'), isCharacter),
    showHealth: excelBool(get('Afficher PV (1/0)', 'Afficher Points de vie (1/0)'), isCharacter || type === HERO_TYPE),
    deckLimitOverride: Math.max(0, excelNumber(get('Limite spéciale', 'Limite speciale'), 0)) || null,
    fullArt: excelBool(get('Full art (1/0)', 'Full art'), false),
    unique: excelBool(get('Unique (1/0)', 'Unique'), false),
    creativity: Math.max(0, excelNumber(get('Créativité', 'Creativite'), 0)),
    power: Math.max(0, excelNumber(get('Pouvoir'), 0)),
    textStyle: { fontSize: excelNumber(get('Taille texte'), DEFAULT_TEXT_STYLE.fontSize) },
    typeStyle: {
      fontSize: excelNumber(get('Taille Type', 'Taille Tribal'), DEFAULT_TYPE_STYLE.fontSize),
      bold: excelBool(get('Type gras', 'Tribal gras'), true),
      italic: excelBool(get('Type italique', 'Tribal italique')),
      underline: excelBool(get('Type souligné', 'Tribal souligné')),
    },
    subtypeStyle: {
      fontSize: excelNumber(get('Taille Sous-type'), DEFAULT_SUBTYPE_STYLE.fontSize),
      bold: excelBool(get('Sous-type gras')),
      italic: excelBool(get('Sous-type italique')),
      underline: excelBool(get('Sous-type souligné')),
    },
  });
}

async function importExcelCards(file) {
  const { rows, embeddedImages } = await readExcelRows(file);
  if (rows.length < 2) throw new Error('Le fichier ne contient aucune carte.');
  const headers = new Map((rows[0] || []).map((h, i) => [excelKey(h), i]));
  for (const required of ['nom', 'couleur', 'rarete']) if (!headers.has(required)) throw new Error(`Colonne obligatoire manquante : ${required}`);
  if (!headers.has('type') && !headers.has('tribal')) throw new Error('Colonne obligatoire manquante : Type');
  if (!headers.has('volonte') && !headers.has('spire')) throw new Error('Colonne obligatoire manquante : Volonté');

  const imported = [];
  const errors = [];
  for (let i = 1; i < rows.length; i++) {
    try {
      const c = cardFromExcel(rows[i] || [], headers, i + 1, embeddedImages);
      if (c) imported.push(c);
    } catch (err) {
      errors.push(err.message);
    }
  }
  if (!imported.length && errors.length) throw new Error(errors.join('\n'));

  const byId = new Map(customCards.map(c => [c.id, c]));
  for (const c of imported) {
    if (isBaseId(c.id)) editedBase[c.id] = c;
    else byId.set(c.id, c);
  }
  customCards = [...byId.values()];
  if (!(await saveCardData())) throw new Error('Espace de stockage du navigateur indisponible.');
  markImported(imported.map(c => c.id));
  cardsChanged();
  if (errors.length) alert(`${imported.length} carte(s) importée(s).\n\nLignes ignorées :\n${errors.join('\n')}`);
  flash(`${imported.length} carte(s) importée(s) depuis Excel${embeddedImages.size ? ` · ${embeddedImages.size} image(s) intégrée(s)` : ''}${errors.length ? ` · ${errors.length} ignorée(s)` : ''}.`);
}

$('#importExcel').onclick = () => $('#importExcelFile').click();
$('#importExcelFile').onchange = async e => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  try {
    await importExcelCards(file);
  } catch (err) {
    console.error(err);
    alert(`Import Excel impossible.\n\n${err.message || 'Fichier illisible.'}`);
    flash('Import Excel impossible : vérifie le modèle fourni.');
  }
};
