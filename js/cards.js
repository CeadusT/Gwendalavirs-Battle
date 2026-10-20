'use strict';
/* ==========================================================================
   Cartes : normalisation, limites d'exemplaires, Types / Sous-types,
   état de la bibliothèque et rendu HTML d'une carte.
   ========================================================================== */

migrateLegacyKeys();

/* ---------- État des cartes ---------- */

let customCards = [];                 // cartes créées (stockées dans IndexedDB)
let editedBase = {};                  // modifications des cartes de base, par id
let trashCards = [];                  // copies des cartes mises à la corbeille
let permanentlyDeletedBase = new Set(readJson(STORAGE_KEYS.permanentlyDeletedBase, []));
let cards = [];                       // bibliothèque visible (base + créées − corbeille)
let cardsById = new Map();
let searchIndex = new Map();          // id → texte de recherche en minuscules
let libraryOrder = readJson(STORAGE_KEYS.libraryOrder, []).map(String);
let bookmarks = new Set(readJson(STORAGE_KEYS.bookmarks, []));
let freshlySaved = new Set(readJson(STORAGE_KEYS.freshlySaved, []));

const cleanStringSet = key => new Set(readJson(key, []).map(v => String(v).trim()).filter(Boolean));
let customTypes = cleanStringSet(STORAGE_KEYS.customTypes);
let customSubtypes = cleanStringSet(STORAGE_KEYS.customSubtypes);
let deletedTypes = cleanStringSet(STORAGE_KEYS.deletedTypes);

const saveBookmarks = () => writeJson(STORAGE_KEYS.bookmarks, [...bookmarks]);
const saveFreshlySaved = () => writeJson(STORAGE_KEYS.freshlySaved, [...freshlySaved]);
const saveLibraryOrder = () => writeJson(STORAGE_KEYS.libraryOrder, libraryOrder);

function saveTaxonomies() {
  writeJson(STORAGE_KEYS.customTypes, [...customTypes]);
  writeJson(STORAGE_KEYS.customSubtypes, [...customSubtypes]);
  writeJson(STORAGE_KEYS.deletedTypes, [...deletedTypes]);
}

/* ---------- Normalisation ---------- */

function normalizeFontStyle(raw, defaults) {
  return {
    fontSize: clamp(Number(raw?.fontSize) || defaults.fontSize, 6, 40),
    bold: raw?.bold ?? defaults.bold,
    italic: raw?.italic ?? defaults.italic,
    underline: raw?.underline ?? defaults.underline,
  };
}

const LEGACY_PLACEHOLDER_TEXT = 'Le texte de la carte apparaîtra ici.';

/* Toute carte (base, créée, importée en JSON ou Excel) passe par ici :
   les valeurs inattendues sont corrigées pour ne jamais casser l'affichage. */
function normalizeCard(c) {
  let type = String(c.type || c.tribal || 'Carte').trim() || 'Carte';
  if (type === 'Tribal jeton') type = 'Jeton';
  const isCharacter = type.includes('Personnage');
  const isHero = type === HERO_TYPE;
  const image = typeof c.image === 'string' && c.image.trim() ? c.image.trim() : undefined;
  return {
    ...c,
    id: String(c.id ?? ''),
    name: String(c.name ?? ''),
    // Les versions ≤ 1.8 enregistraient le texte d'exemple du Studio quand le texte était vide.
    text: String(c.text ?? '') === LEGACY_PLACEHOLDER_TEXT ? '' : String(c.text ?? ''),
    type,
    subtype: String(c.subtype || '').trim(),
    color: COLORS[c.color] ? c.color : FALLBACK_COLOR,
    rarity: RARITIES.includes(c.rarity) ? c.rarity : RARITIES[0],
    set: SETS.includes(c.set) ? c.set : SETS[0],
    spire: clamp(Math.round(Number(c.spire) || 0), MIN_SPIRE, MAX_SPIRE),
    creativity: clamp(Math.round(Number(c.creativity) || 0), 0, EMBLEM.max),
    power: clamp(Math.round(Number(c.power) || 0), 0, EMBLEM.max),
    showSpire: c.showSpire === undefined ? !AUTO_HIDE_SPIRE_TYPES.has(type) : c.showSpire !== false,
    attack: Math.max(0, Number(c.attack) || 0),
    health: Math.max(0, Number(c.health) || 0),
    showAttack: c.showAttack === undefined ? isCharacter : c.showAttack !== false,
    showHealth: c.showHealth === undefined ? isCharacter || isHero : c.showHealth !== false,
    deckLimitOverride: Number(c.deckLimitOverride) > 0 ? Number(c.deckLimitOverride) : null,
    fullArt: c.fullArt === true || c.fullArt === 'true',
    unique: c.unique === true || c.unique === 'true',
    image,
    textStyle: normalizeFontStyle(c.textStyle, DEFAULT_TEXT_STYLE),
    typeStyle: normalizeFontStyle(c.typeStyle || c.tribalStyle, DEFAULT_TYPE_STYLE),
    subtypeStyle: normalizeFontStyle(c.subtypeStyle, DEFAULT_SUBTYPE_STYLE),
  };
}

const isBaseId = id => String(id).startsWith('base-');
const isHeroCard = c => c?.type === HERO_TYPE;

/* Famille visuelle d'une carte : 'legend' (Dessin légendaire), 'drawing' (autre Dessin) ou ''.
   Les Dessins ont un coût en losange et une plume sur la ligne de type ;
   les Dessins légendaires un cadre prismatique (voir css/styles.css, section Cartes). */
function cardKind(c) {
  const type = String(c?.type || '');
  if (!/dessin/i.test(type)) return '';
  return /légendaire/i.test(type) ? 'legend' : 'drawing';
}

/* Blason des Dessins (SVG 100 × 100) : Volonté (rouge) et Créativité (bleu) en haut,
   Pouvoir (jaune) en bas, sur un disque noir serti d'or. Le même dessin sert au PDF (print.js). */
const EMBLEM_LAYOUT = {
  disc: { cx: 50, cy: 50, r: 48 },
  circles: [
    { key: 'will', field: 'spire', cx: 33, cy: 39, tx: 29, ty: 35, title: 'Volonté' },
    { key: 'creativity', field: 'creativity', cx: 67, cy: 39, tx: 71, ty: 35, title: 'Créativité' },
    { key: 'power', field: 'power', cx: 50, cy: 69, tx: 50, ty: 73, title: 'Pouvoir' },
  ],
  r: 20,
  center: { cx: 50, cy: 49, r: 9 },
  symbol: 'M45 53 L50 48 L55 53 M50 48 L50 43',
};

function emblemSvg(c) {
  const L = EMBLEM_LAYOUT;
  const circles = L.circles.map(k => `<circle cx="${k.cx}" cy="${k.cy}" r="${L.r}" fill="${EMBLEM[k.key]}" stroke="${EMBLEM.gold}" stroke-width="2.5"/>`).join('');
  const numbers = L.circles.map(k => `<text x="${k.tx}" y="${k.ty}">${Number(c[k.field]) || 0}</text>`).join('');
  return `<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="48" fill="${EMBLEM.ink}" stroke="${EMBLEM.gold}" stroke-width="3.5"/>${circles}`
    + `<circle cx="${L.center.cx}" cy="${L.center.cy}" r="${L.center.r}" fill="${EMBLEM.ink}" stroke="${EMBLEM.gold}" stroke-width="2"/>`
    + `<path d="${L.symbol}" fill="none" stroke="${EMBLEM.gold}" stroke-width="1.8" stroke-linecap="round"/>${numbers}</svg>`;
}

const QUILL_ICON = 'M20 4c-7 0-12 4-14 11l-1 5 4-2c7-2 11-7 11-14ZM5 20l7-7';

/* ---------- Bibliothèque ---------- */

function trashedIds() {
  return new Set(trashCards.map(c => c.id));
}

/* Recalcule la bibliothèque après tout changement de cartes. */
function refreshCards() {
  const hidden = trashedIds();
  const base = BASE_CARDS
    .filter(c => !permanentlyDeletedBase.has(c.id))
    .map(c => (editedBase[c.id] ? { ...c, ...editedBase[c.id], id: c.id } : c));
  cards = [...base, ...customCards].map(normalizeCard).filter(c => !hidden.has(c.id));
  cardsById = new Map(cards.map(c => [c.id, c]));
  searchIndex = new Map(cards.map(c => [c.id, `${c.name} ${plainText(c.text)} ${c.type} ${c.subtype}`.toLowerCase()]));
  ensureLibraryOrder();
  syncTaxonomyControls();
}

function ensureLibraryOrder() {
  const valid = new Set(cards.map(c => c.id));
  libraryOrder = [...new Set(libraryOrder)].filter(id => valid.has(id));
  const known = new Set(libraryOrder);
  for (const c of cards) if (!known.has(c.id)) libraryOrder.push(c.id);
}

/* ---------- Limites d'exemplaires ---------- */

const defaultRules = { rarity: Object.fromEntries(RARITIES.map(r => [r, DEFAULT_LIMIT])), type: Object.fromEntries(TYPES.map(t => [t, DEFAULT_LIMIT])) };

function clampRule(value) {
  return clamp(Number(value) || DEFAULT_LIMIT, 1, 99);
}

function normalizeRules(raw) {
  const rules = structuredClone(defaultRules);
  for (const r of RARITIES) rules.rarity[r] = clampRule(raw?.rarity?.[r]);
  for (const [t, v] of Object.entries(raw?.type || {})) rules.type[t] = clampRule(v);
  return rules;
}

let limitRules = normalizeRules(readJson(STORAGE_KEYS.limitRules, defaultRules));
const saveRules = () => writeJson(STORAGE_KEYS.limitRules, limitRules);

/* Limite d'une carte : sa limite spéciale, sinon la plus stricte entre rareté et Type. */
function limitOf(c) {
  if (Number(c.deckLimitOverride) > 0) return Number(c.deckLimitOverride);
  return Math.min(clampRule(limitRules.rarity[c.rarity]), clampRule(limitRules.type[c.type]));
}

/* ---------- Types et Sous-types ---------- */

function typeExists(value) {
  return (TYPES.includes(value) || customTypes.has(value)) && !deletedTypes.has(value);
}

function taxonomyValues(kind) {
  const values = kind === 'type'
    ? [...TYPES, ...customTypes, ...cards.map(c => c.type)].filter(v => v && !deletedTypes.has(v))
    : [...customSubtypes, ...cards.map(c => c.subtype)].filter(Boolean);
  return [...new Set(values)].sort((a, b) => a.localeCompare(b, 'fr'));
}

function taxonomyMenuMarkup(kind, query = '') {
  const current = $(kind === 'type' ? '#studioType' : '#studioSubtype')?.value || '';
  const q = query.trim().toLocaleLowerCase('fr');
  const values = taxonomyValues(kind).filter(v => !q || v.toLocaleLowerCase('fr').includes(q));
  if (!values.length) return '<div class="taxonomyEmpty">Aucun résultat — clique sur Créer pour ajouter cette valeur.</div>';
  return values.map(v => `<button type="button" class="taxonomyOption${v === current ? ' active' : ''}" data-value="${escapeHtml(v)}">${escapeHtml(v)}</button>`).join('');
}

/* Met à jour les filtres Type / Sous-type de la bibliothèque. */
function syncTaxonomyControls() {
  const fill = (select, values) => {
    const previous = select.value || 'Tous';
    select.innerHTML = ['Tous', ...values].map(v => `<option>${escapeHtml(v)}</option>`).join('');
    select.value = values.includes(previous) ? previous : 'Tous';
  };
  fill($('#type'), taxonomyValues('type'));
  fill($('#subtypeFilter'), taxonomyValues('subtype'));
}

/* ---------- Rendu d'une carte ---------- */

const ICONS = {
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.75 5.57 6.15.9-4.45 4.33 1.05 6.12L12 17.03l-5.5 2.89 1.05-6.12L3.1 9.47l6.15-.9L12 3Z"/></svg>',
  pencil: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 20 4.2-1 10.6-10.6-3.2-3.2L5 15.8 4 20Z"/><path d="m13.9 6.9 3.2 3.2"/></svg>',
};

/* Tailles exprimées en fraction de la largeur de carte (--size), base 315 px (carte de
   référence de la charte, 63 × 88 mm). --card-min-font fixe un plancher de lisibilité
   (relevé en mode compact, voir library.js). */
const CARD_BASE_WIDTH = 315;

function scaledFontSize(px) {
  return `max(var(--card-min-font,4px),calc(var(--size)*${(Number(px) / CARD_BASE_WIDTH).toFixed(5)}))`;
}

function styleCss(raw, defaults) {
  const st = normalizeFontStyle(raw, defaults);
  return `font-size:${scaledFontSize(st.fontSize)};font-weight:${st.bold ? 700 : 500};font-style:${st.italic ? 'italic' : 'normal'};text-decoration:${st.underline ? 'underline' : 'none'};`;
}

function scaledCardText(html) {
  return sanitizeRichText(html).replace(/\n/g, '<br>').replace(/font-size:\s*(\d+(?:\.\d+)?)px/gi, (_, size) => `font-size:${scaledFontSize(size)}`);
}

function colorClass(c) {
  return (COLORS[c.color] ? c.color : FALLBACK_COLOR).toLowerCase();
}

function elementName(c) {
  return COLORS[c.color]?.element || String(c.color);
}

function backgroundImageStyle(image, overlay = '') {
  return image ? ` style="${escapeHtml(`background-image:${overlay}${cssUrl(image)}`)}"` : '';
}

/* Mélange deux couleurs #rrggbb (t = 0 → a, t = 1 → b). */
function mixColor(a, b, t) {
  const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const x = rgb(a);
  const y = rgb(b);
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

/* Teintes dérivées de l'élément, partagées par le rendu HTML et le PDF. */
function cardPalette(c) {
  const el = COLORS[c.color]?.hex || COLORS[FALLBACK_COLOR].hex;
  return {
    el,
    light: mixColor(el, '#ffffff', 0.5),
    tint: mixColor(el, CARD_THEME.parchment, 0.8),
    skyTop: mixColor(el, '#06070c', 0.62),
    skyBottom: mixColor(el, '#f3e3c0', 0.38),
    sun: mixColor(el, '#fff3d6', 0.68),
    hillFar: mixColor(el, '#2a2f3a', 0.32),
    hillMid: mixColor(el, '#151821', 0.55),
    hillNear: mixColor(el, '#08090c', 0.78),
    // Encre des Dessins : la couleur de l'élément, foncée (losange et bandeau de type).
    pale: mixColor(el, '#ffffff', 0.72),
    inkDark: mixColor(el, '#0d0c10', 0.72),
    inkMid: mixColor(el, '#141218', 0.5),
    inkLight: mixColor(el, '#1a171d', 0.3),
  };
}

/* Paysage de remplacement quand la carte n'a pas d'illustration. */
const PLACEHOLDER_HILLS = [
  'M0 168 L42 128 L84 150 L132 98 L182 140 L232 108 L300 150 L300 250 L0 250 Z',
  'M0 198 L62 158 L112 184 L162 148 L222 190 L272 164 L300 178 L300 250 L0 250 Z',
  'M0 224 L52 204 L122 220 L192 198 L252 216 L300 206 L300 250 L0 250 Z',
];

function placeholderArt(pal) {
  return `<svg class="gw-placeholder" viewBox="0 0 300 250" preserveAspectRatio="xMidYMax slice" aria-hidden="true">`
    + `<circle cx="214" cy="92" r="24" fill="${pal.sun}" opacity=".85"/>`
    + `<path d="${PLACEHOLDER_HILLS[0]}" fill="${pal.hillFar}"/><path d="${PLACEHOLDER_HILLS[1]}" fill="${pal.hillMid}"/><path d="${PLACEHOLDER_HILLS[2]}" fill="${pal.hillNear}"/></svg>`;
}

const STAT_ICONS = {
  attack: '<svg viewBox="0 0 24 24" aria-hidden="true" class="gw-statIcon"><path d="M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2"/></svg>',
  health: '<svg viewBox="0 0 24 24" aria-hidden="true" class="gw-statIcon"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z"/></svg>',
};

/* Taille du nom selon sa longueur, en em de la carte (1 em = 16 px sur une carte de 315 px). */
function nameSizeEm(name, fullArt) {
  const n = String(name).length;
  const size = n > 26 ? 13 : n > 18 ? 14 : fullArt ? 17 : 15.5;
  return (size / 16).toFixed(4);
}

/* Nombre d'exemplaires dans le deck en cours (défini dans deck.js). */
function deckCopies(c) {
  return isHeroCard(c) ? (hero?.id === c.id ? 1 : 0) : qtyOf(c.id);
}

/* HTML intérieur d'une carte, au format de la charte graphique :
   style normal (« Enluminure ») ou full art selon c.fullArt.
   quick  : boutons de survol (bibliothèque) · studio : zones éditables (Card Studio) */
function cardMarkup(c, { quick = false, studio = false } = {}) {
  const zone = name => (studio ? ` data-zone="${name}"` : '');
  const editable = name => (studio ? ` data-zone="${name}" data-inline-edit="${name}" contenteditable="true" spellcheck="true"` : '');
  const isHero = isHeroCard(c);
  const showCost = (studio || displaySpires) && c.showSpire !== false;
  const pal = cardPalette(c);
  const kind = cardKind(c);
  const variant = `gw ${c.fullArt ? 'gw--full' : 'gw--normal'}${isHero ? ' gw--hero' : ''}${kind ? ` gw--${kind}` : ''}`;
  const vars = `--el:${pal.el};--el-light:${pal.light};--el-tint:${pal.tint};--sky-top:${pal.skyTop};--sky-bottom:${pal.skyBottom}`
    + (kind === 'drawing' ? `;--el-pale:${pal.pale};--ink-dark:${pal.inkDark};--ink-mid:${pal.inkMid};--ink-light:${pal.inkLight}` : '');

  const actions = quick ? `<div class="cardActionGrid">`
    + `<div class="cardActionRow"><button class="cardAction top editCard" title="Modifier dans le Card Studio">${ICONS.pencil}</button>`
    + `<button class="cardAction top bookmark ${bookmarks.has(c.id) ? 'on' : ''}" title="${bookmarks.has(c.id) ? 'Retirer des favoris' : 'Ajouter aux favoris'}">${ICONS.star}</button></div>`
    + `<div class="cardActionRow"><button class="cardAction bottom remove ${isHero && hero?.id !== c.id ? 'disabled' : ''}" title="Retirer un exemplaire">−</button>`
    + `<button class="cardAction bottom add" title="Ajouter un exemplaire">+</button></div></div>` : '';

  const copies = quick ? deckCopies(c) : 0;
  const deckCount = copies ? `<span class="libraryDeckCount" title="${copies} exemplaire${copies > 1 ? 's' : ''} dans le deck">×${copies}</span>` : '';

  const cost = !showCost ? ''
    : kind ? `<div class="gw-emblem"${zone('spire')} title="Volonté ${c.spire} · Créativité ${c.creativity} · Pouvoir ${c.power}">${emblemSvg(c)}</div>`
      : `<div class="gw-cost"${zone('spire')} title="Coût en Volonté"><span>${c.spire}</span></div>`;
  const quill = kind === 'drawing' ? `<svg class="gw-quill" viewBox="0 0 24 24" aria-hidden="true"><path d="${QUILL_ICON}"/></svg>` : '';
  const element = isHero ? '' : `<div class="gw-el"${zone('color')} title="Élément ${escapeHtml(elementName(c))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${COLORS[c.color]?.icon || COLORS[FALLBACK_COLOR].icon}"/></svg></div>`;
  const subtype = c.subtype ? `<span class="gw-sep">·</span><span class="gw-subtype"${zone('subtype')} style="${styleCss(c.subtypeStyle, DEFAULT_SUBTYPE_STYLE)}">${escapeHtml(c.subtype)}</span>` : '';
  // Médaillon ATK | PV à droite du pied de carte (l'un ou l'autre peut être masqué).
  const statParts = [
    c.showAttack ? `<span class="gw-stat gw-stat--attack" title="Attaque">${STAT_ICONS.attack}${c.attack}</span>` : '',
    c.showHealth ? `<span class="gw-stat gw-stat--health" title="Points de vie">${STAT_ICONS.health}${c.health}</span>` : '',
  ].filter(Boolean);
  const stats = statParts.length ? `<span class="gw-stats">${statParts.join('<i class="gw-statSep" aria-hidden="true"></i>')}</span>` : '';
  // Gras / italique / souligné du texte se règlent mot par mot, pas sur tout le bloc.
  const textStyle = styleCss({ ...c.textStyle, bold: false, italic: false, underline: false }, DEFAULT_TEXT_STYLE);

  return actions
    + `<div class="${variant}" style="${vars}"><div class="gw-body">`
    + `<div class="gw-art"${zone('image')}${backgroundImageStyle(c.image)}>${c.image ? '' : placeholderArt(pal)}</div>`
    + `<div class="gw-shade" aria-hidden="true"></div>`
    + `<div class="gw-head"${zone('color')}>${cost}<h3 class="gw-name" style="font-size:max(var(--card-name-min,0px),${nameSizeEm(c.name, c.fullArt)}em)"${editable('name')}>${escapeHtml(c.name)}</h3>${element}</div>`
    + `<div class="gw-rules"><div class="gw-type"${zone('color')}>${quill}<span class="gw-typeName"${zone('type')} style="${styleCss(c.typeStyle, DEFAULT_TYPE_STYLE)}">${escapeHtml(c.type)}</span>${subtype}<span class="gw-rarity" style="background:${RARITY_COLORS[c.rarity] || RARITY_COLORS.Commun}" title="Rareté ${escapeHtml(c.rarity)}"></span></div>`
    + `<div class="gw-text" style="${textStyle}"${editable('text')}>${scaledCardText(c.text)}</div></div>`
    + `<div class="gw-foot"${zone('stats')}><span class="gw-set"${zone('set')}>${escapeHtml(c.set)}</span>${stats}</div>`
    + `${deckCount}</div></div>`;
}
