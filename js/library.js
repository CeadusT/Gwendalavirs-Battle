'use strict';
/* ==========================================================================
   Deckbuilder — panneau de filtres et grille de la bibliothèque.
   ========================================================================== */

const grid = $('#grid');
const searchInput = $('#search');
const typeFilter = $('#type');
const subtypeFilter = $('#subtypeFilter');
const setFilter = $('#setFilter');
const filtersPanel = $('#filtersPanel');
const libraryPanel = $('#libraryPanel');
const sizeInput = $('#size');

/* ---------- État des filtres ---------- */

const activeColors = new Set();         // vide = toutes les couleurs
const activeRarities = new Set(RARITIES);
let collectionMode = 'all';             // 'all' | 'bookmarks'
let deckPresence = 'all';               // 'all' | 'in' | 'out'
let spireLow = MIN_SPIRE;
let spireHigh = MAX_SPIRE;
let displaySpires = readText(STORAGE_KEYS.displaySpires) !== 'false';

/* Données de glisser-déposer partagées avec le deck et la corbeille. */
let dragContext = null;                 // { id, source: 'library' | 'deck' }
let dragGhost = null;

/* ---------- Construction des contrôles ---------- */

function buildFilterControls() {
  $('#colorTabs').innerHTML = COLOR_NAMES.map(name => `<button class="colorTab" data-filter-group="color" data-filter-value="${name}" title="${name} · ${COLORS[name].element} · double-clic = seulement ${name}"><svg viewBox="0 0 24 24">${COLORS[name].filterIcon}</svg><span>${name}</span></button>`).join('');
  for (const select of $$('[data-set-options]')) select.insertAdjacentHTML('beforeend', SETS.map(s => `<option>${escapeHtml(s)}</option>`).join(''));
}

/* ---------- Filtrage ---------- */

function cardMatchesFilters(c) {
  const query = searchInput.value.toLowerCase();
  const qty = qtyOf(c.id);
  return (collectionMode === 'all' || bookmarks.has(c.id))
    && (!query || searchIndex.get(c.id)?.includes(query))
    && (!activeColors.size || activeColors.has(c.color))
    && (typeFilter.value === 'Tous' || c.type === typeFilter.value)
    && (subtypeFilter.value === 'Tous' || c.subtype === subtypeFilter.value)
    && (setFilter.value === 'Tous' || c.set === setFilter.value)
    && c.spire >= spireLow && c.spire <= spireHigh
    && activeRarities.has(c.rarity)
    && (deckPresence === 'all' || (deckPresence === 'in' ? qty > 0 : qty === 0));
}

function filteredCards() {
  const position = new Map(libraryOrder.map((id, index) => [id, index]));
  return cards.filter(cardMatchesFilters).sort((a, b) => (position.get(a.id) ?? Infinity) - (position.get(b.id) ?? Infinity));
}

/* ---------- Grille ---------- */

function renderLibrary() {
  const shown = filteredCards();
  grid.replaceChildren(...shown.map(c => {
    const article = document.createElement('article');
    article.className = 'card'
      + (c.showAttack || c.showHealth ? ' hasCharacterStats' : '')
      + (bookmarks.has(c.id) ? ' bookmarked' : '')
      + (freshlySaved.has(c.id) ? ' freshSaved' : '');
    article.draggable = true;
    article.dataset.id = c.id;
    article.dataset.color = c.color;
    article.title = 'Glisse sur une autre carte pour la réorganiser · clic droit ou glisse vers Corbeille pour supprimer';
    article.innerHTML = cardMarkup(c, { quick: true });
    return article;
  }));
  $('#count').textContent = shown.length;
  $('#shown').textContent = shown.length;
  $('#totalCards').textContent = cards.length;
  $('#libraryTitle').textContent = collectionMode === 'bookmarks' ? 'Bookmarks' : 'Toutes les cartes';
}

/* Les événements de la grille sont gérés une seule fois ici (délégation),
   plutôt que d'attacher des écouteurs à chaque carte à chaque affichage. */
const cardOfEvent = e => {
  const el = e.target.closest('#grid .card');
  return el ? { el, card: cardsById.get(el.dataset.id) } : {};
};

grid.addEventListener('click', e => {
  const button = e.target.closest('button');
  const { card } = cardOfEvent(e);
  if (!button || !card) return;
  e.stopPropagation();
  if (button.classList.contains('bookmark')) toggleBookmark(card.id);
  else if (button.classList.contains('editCard')) openStudioForCard(card);
  else if (button.classList.contains('add')) addCard(card);
  else if (button.classList.contains('remove')) subtractCard(card);
});

grid.addEventListener('contextmenu', e => {
  const { card } = cardOfEvent(e);
  if (!card) return;
  e.preventDefault();
  openDeleteCardModal(card, 'trash');
});

grid.addEventListener('mouseover', e => {
  const { el, card } = cardOfEvent(e);
  if (!card || el.contains(e.relatedTarget)) return;
  if (freshlySaved.delete(card.id)) {
    saveFreshlySaved();
    el.classList.remove('freshSaved');
  }
  const text = plainText(card.text).trim();
  $('#preview').innerHTML = `<strong>${escapeHtml(card.name)}</strong>${escapeHtml(card.set)} · ${escapeHtml(card.color)} · ${escapeHtml(card.type)} · limite ${limitOf(card)}`
    + (text ? `<span class="previewText">${escapeHtml(text)}</span>` : '');
});

function clearLibraryDropMarkers() {
  $$('#grid .card').forEach(x => x.classList.remove('libraryDropBefore', 'libraryDropAfter'));
}

const dropsAfter = (el, e) => {
  const box = el.getBoundingClientRect();
  return e.clientX > box.left + box.width / 2;
};

grid.addEventListener('dragstart', e => {
  const { el, card } = cardOfEvent(e);
  if (!card) return;
  dragContext = { id: card.id, source: 'library' };
  e.dataTransfer.effectAllowed = 'copyMove';
  e.dataTransfer.setData('text/plain', card.id);
  const ghost = makeDragGhost(el);
  try {
    e.dataTransfer.setDragImage(ghost, Math.round(ghost.getBoundingClientRect().width / 2), 34);
  } catch { /* certains navigateurs refusent une image personnalisée */ }
  document.body.classList.add('draggingCard');
  grid.classList.add('reordering');
  el.classList.add('dragging');
});

grid.addEventListener('dragover', e => {
  const { el, card } = cardOfEvent(e);
  if (!card || dragContext?.source !== 'library' || dragContext.id === card.id) return;
  e.preventDefault();
  e.stopPropagation();
  clearLibraryDropMarkers();
  el.classList.add(dropsAfter(el, e) ? 'libraryDropAfter' : 'libraryDropBefore');
  e.dataTransfer.dropEffect = 'move';
});

grid.addEventListener('drop', e => {
  const { el, card } = cardOfEvent(e);
  if (!card || dragContext?.source !== 'library' || dragContext.id === card.id) return;
  e.preventDefault();
  e.stopPropagation();
  const sourceId = dragContext.id;
  dragContext = null;
  moveLibraryItem(sourceId, card.id, dropsAfter(el, e));
});

grid.addEventListener('dragend', e => {
  e.target.closest?.('.card')?.classList.remove('dragging');
  grid.classList.remove('reordering');
  clearLibraryDropMarkers();
  endDrag();
});

function makeDragGhost(cardEl) {
  removeDragGhost();
  const ghost = cardEl.cloneNode(true);
  ghost.className = 'card dragGhost';
  ghost.removeAttribute('draggable');
  ghost.querySelector('.cardActionGrid')?.remove();
  document.body.appendChild(ghost);
  dragGhost = ghost;
  return ghost;
}

function removeDragGhost() {
  dragGhost?.remove();
  dragGhost = null;
}

/* Remet à zéro tout l'état visuel d'un glisser-déposer. */
function endDrag() {
  removeDragGhost();
  document.body.classList.remove('draggingCard');
  $('#deckPanel').classList.remove('dropActive');
  libraryPanel.classList.remove('dropActive');
  $('#tabTrash').classList.remove('trashDropTarget');
  dragContext = null;
}

/* Une carte du deck déposée sur la bibliothèque perd un exemplaire. */
libraryPanel.addEventListener('dragover', e => {
  if (dragContext?.source !== 'deck') return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  libraryPanel.classList.add('dropActive');
});
libraryPanel.addEventListener('dragleave', e => {
  if (!libraryPanel.contains(e.relatedTarget)) libraryPanel.classList.remove('dropActive');
});
libraryPanel.addEventListener('drop', e => {
  if (dragContext?.source !== 'deck') return;
  e.preventDefault();
  const id = dragContext.id;
  endDrag();
  removeCard(id);
});

function moveLibraryItem(sourceId, targetId, after) {
  if (sourceId === targetId) return;
  ensureLibraryOrder();
  if (!libraryOrder.includes(sourceId) || !libraryOrder.includes(targetId)) return;
  libraryOrder.splice(libraryOrder.indexOf(sourceId), 1);
  libraryOrder.splice(libraryOrder.indexOf(targetId) + (after ? 1 : 0), 0, sourceId);
  saveLibraryOrder();
  renderLibrary();
  flash('Ordre de la bibliothèque enregistré.');
}

function toggleBookmark(id) {
  if (!bookmarks.delete(id)) bookmarks.add(id);
  saveBookmarks();
  renderLibrary();
  flash(bookmarks.has(id) ? 'Carte ajoutée aux bookmarks.' : 'Carte retirée des bookmarks.');
}

/* ---------- Contrôles du panneau de filtres ---------- */

for (const input of [searchInput, typeFilter, subtypeFilter, setFilter]) input.addEventListener('input', renderLibrary);

/* Boutons Couleur / Rareté : clic = ajouter ou retirer, double-clic = seulement celui-là. */
const filterGroups = {
  color: { state: activeColors, allValues: COLOR_NAMES, emptyMeansAll: true },
  rarity: { state: activeRarities, allValues: RARITIES, emptyMeansAll: false },
};

function syncFilterGroup(group) {
  const { state } = filterGroups[group];
  $$(`[data-filter-group="${group}"]`).forEach(b => b.classList.toggle('active', state.has(b.dataset.filterValue)));
}

filtersPanel.addEventListener('click', e => {
  const button = e.target.closest('button[data-filter-group]');
  const cfg = button && filterGroups[button.dataset.filterGroup];
  if (!cfg) return;
  const value = button.dataset.filterValue;
  if (!cfg.state.delete(value)) cfg.state.add(value);
  if (!cfg.emptyMeansAll && cfg.state.size === 0) cfg.allValues.forEach(v => cfg.state.add(v));
  syncFilterGroup(button.dataset.filterGroup);
  renderLibrary();
});

filtersPanel.addEventListener('dblclick', e => {
  const button = e.target.closest('button[data-filter-group]');
  const cfg = button && filterGroups[button.dataset.filterGroup];
  if (!cfg) return;
  e.preventDefault();
  cfg.state.clear();
  cfg.state.add(button.dataset.filterValue);
  syncFilterGroup(button.dataset.filterGroup);
  renderLibrary();
  flash(`${button.dataset.filterValue} uniquement.`);
});

$('#allColors').onclick = () => {
  activeColors.clear();
  syncFilterGroup('color');
  renderLibrary();
};

function setActiveButton(container, button) {
  $$('button', container).forEach(b => b.classList.toggle('active', b === button));
}

$('#collectionTabs').addEventListener('click', e => {
  const button = e.target.closest('button[data-mode]');
  if (!button) return;
  setActiveButton(e.currentTarget, button);
  collectionMode = button.dataset.mode;
  renderLibrary();
});

$('#deckPresence').addEventListener('click', e => {
  const button = e.target.closest('button[data-presence]');
  if (!button) return;
  setActiveButton(e.currentTarget, button);
  deckPresence = button.dataset.presence;
  renderLibrary();
});

/* Sous ces largeurs, les cartes passent en mode compact (texte à taille lisible minimale,
   nom du set masqué), puis tiny (illustration réduite, élément masqué). Voir styles.css. */
const COMPACT_CARD_SIZE = 200;
const TINY_CARD_SIZE = 130;

/* Taille des cartes (curseur, et Ctrl + molette dans layout.js). */
function setCardSize(value) {
  const size = clamp(Number(value) || 174, Number(sizeInput.min), Number(sizeInput.max));
  sizeInput.value = size;
  grid.style.setProperty('--size', `${size}px`);
  grid.classList.toggle('compact', size < COMPACT_CARD_SIZE);
  grid.classList.toggle('tiny', size < TINY_CARD_SIZE);
  $('#sizeV').textContent = size;
  return size;
}
sizeInput.oninput = () => writeText(STORAGE_KEYS.cardSize, setCardSize(sizeInput.value));

/* Filtre de Volonté : deux curseurs superposés + deux cases numériques. */
function updateSpireFilter(source) {
  const clampSpire = v => clamp(Number(v) || 0, MIN_SPIRE, MAX_SPIRE);
  if (source === 'min' || source === 'minBox') {
    spireLow = clampSpire(source === 'minBox' ? $('#spireMinBox').value : $('#spireMin').value);
    spireHigh = Math.max(spireHigh, spireLow);
  } else {
    spireHigh = clampSpire(source === 'maxBox' ? $('#spireMaxBox').value : $('#spireMax').value);
    spireLow = Math.min(spireLow, spireHigh);
  }
  $('#spireMin').value = $('#spireMinBox').value = spireLow;
  $('#spireMax').value = $('#spireMaxBox').value = spireHigh;
  const left = spireLow / MAX_SPIRE;
  const right = spireHigh / MAX_SPIRE;
  const fill = $('#rangeFill');
  fill.style.left = `calc(10px + ${left * 100}% - ${left * 20}px)`;
  fill.style.width = `calc(${(right - left) * 100}% - ${(right - left) * 20}px)`;
  renderLibrary();
}
$('#spireMin').oninput = () => updateSpireFilter('min');
$('#spireMax').oninput = () => updateSpireFilter('max');
$('#spireMinBox').oninput = () => updateSpireFilter('minBox');
$('#spireMaxBox').oninput = () => updateSpireFilter('maxBox');
$('#allSpires').onclick = () => {
  spireLow = MIN_SPIRE;
  spireHigh = MAX_SPIRE;
  $('#spireMin').value = MIN_SPIRE;
  updateSpireFilter('min');
};

const displaySpiresInput = $('#displaySpires');
displaySpiresInput.onchange = () => {
  displaySpires = displaySpiresInput.checked;
  writeText(STORAGE_KEYS.displaySpires, displaySpires);
  renderLibrary();
};

function initLibrary() {
  buildFilterControls();
  displaySpiresInput.checked = displaySpires;
  setCardSize(readText(STORAGE_KEYS.cardSize));
}
