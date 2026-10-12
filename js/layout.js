'use strict';
/* ==========================================================================
   Mise en page : onglets, panneaux masquables, séparateurs redimensionnables
   et zoom Ctrl + molette.
   ========================================================================== */

const deckView = $('#deckView');
const studioView = $('#studioView');
const trashView = $('#trashView');
let currentView = 'deck';   // 'deck' | 'studio' | 'trash'

/* ---------- Onglets ---------- */

function setView(mode) {
  currentView = mode;
  hideHoverPreview();
  deckView.classList.toggle('hidden', mode !== 'deck');
  studioView.classList.toggle('hidden', mode !== 'studio');
  trashView.classList.toggle('hidden', mode !== 'trash');
  $('#tabDeck').classList.toggle('active', mode === 'deck');
  $('#tabStudio').classList.toggle('active', mode === 'studio');
  $('#tabTrash').classList.toggle('active', mode === 'trash');
  $('#showFilters').classList.toggle('hidden', mode !== 'deck');
  $('#showDeck').classList.toggle('hidden', mode !== 'deck');
  if (mode === 'deck') {
    applyDeckPanels();
    renderLibrary();
    renderDeck();
  } else if (mode === 'studio') {
    applyStudioPanels();
    renderStudio();
  } else {
    renderTrash();
  }
  if (mode !== 'studio') {
    $('#showStudioEditor').classList.remove('show');
    $('#showStudioList').classList.remove('show');
  }
}

$('#tabDeck').onclick = () => setView('deck');
$('#tabStudio').onclick = () => setView('studio');
$('#tabDecks').onclick = openDecksModal;
$('#tabTrash').onclick = () => setView('trash');

/* ---------- Panneaux latéraux du Deckbuilder ---------- */

const deckPanels = readJson(STORAGE_KEYS.panels, { left: true, right: true });

function applyDeckPanels() {
  deckView.classList.toggle('leftHidden', !deckPanels.left);
  deckView.classList.toggle('rightHidden', !deckPanels.right);
  filtersPanel.classList.toggle('hidden', !deckPanels.left);
  deckPanel.classList.toggle('hidden', !deckPanels.right);
  $('#showFilters').classList.toggle('show', !deckPanels.left);
  $('#showDeck').classList.toggle('show', !deckPanels.right);
  writeJson(STORAGE_KEYS.panels, deckPanels);
}

function setDeckPanel(side, visible) {
  deckPanels[side] = visible;
  applyDeckPanels();
}

$('#hideFilters').onclick = () => setDeckPanel('left', false);
$('#hideDeck').onclick = () => setDeckPanel('right', false);
$('#showFilters').onclick = () => setDeckPanel('left', true);
$('#showDeck').onclick = () => setDeckPanel('right', true);

/* ---------- Panneaux du Card Studio ---------- */

const studioPanels = readJson(STORAGE_KEYS.studioPanelState, { editor: true, list: true });

function applyStudioPanels() {
  studioView.classList.toggle('editorHidden', !studioPanels.editor);
  studioView.classList.toggle('listHidden', !studioPanels.list);
  $('#studioEditorPane').classList.toggle('hidden', !studioPanels.editor);
  $('#studioListPane').classList.toggle('hidden', !studioPanels.list);
  const active = !studioView.classList.contains('hidden');
  $('#showStudioEditor').classList.toggle('show', active && !studioPanels.editor);
  $('#showStudioList').classList.toggle('show', active && !studioPanels.list);
  writeJson(STORAGE_KEYS.studioPanelState, studioPanels);
}

function showStudioPane(pane, visible = true) {
  studioPanels[pane] = visible;
  applyStudioPanels();
}

$('#hideStudioEditor').onclick = () => showStudioPane('editor', false);
$('#hideStudioList').onclick = () => showStudioPane('list', false);
$('#showStudioEditor').onclick = () => showStudioPane('editor');
$('#showStudioList').onclick = () => showStudioPane('list');

/* ---------- Séparateurs redimensionnables ---------- */

function cssPx(el, name, fallback) {
  return Number.parseFloat(getComputedStyle(el).getPropertyValue(name)) || fallback;
}

/* Fait glisser un séparateur : variable CSS `cssVar` de `container`, bornée entre min et max.
   direction = 1 si le panneau grandit vers la droite, -1 s'il grandit vers la gauche. */
function setupSplitter(handle, { container, cssVar, fallback, min, max, direction, onEnd }) {
  handle.addEventListener('pointerdown', e => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('active');
    const startX = e.clientX;
    const startSize = cssPx(container, cssVar, fallback);
    const move = ev => container.style.setProperty(cssVar, `${clamp(startSize + direction * (ev.clientX - startX), min, max)}px`);
    const up = () => {
      handle.classList.remove('active');
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      onEnd();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });
}

const PANES = {
  deckLeft: { container: deckView, cssVar: '--deck-left', fallback: 286, min: 180, max: 560, direction: 1 },
  deckRight: { container: deckView, cssVar: '--deck-right', fallback: 350, min: 240, max: 680, direction: -1 },
  studioEditor: { container: studioView, cssVar: '--studio-editor', fallback: 410, min: 300, max: 720, direction: 1 },
  studioList: { container: studioView, cssVar: '--studio-list', fallback: 270, min: 220, max: 560, direction: -1 },
};

const saveDeckPanes = () => writeJson(STORAGE_KEYS.deckPanes, { left: cssPx(deckView, '--deck-left', 286), right: cssPx(deckView, '--deck-right', 350) });
const saveStudioPanes = () => writeJson(STORAGE_KEYS.studioPanes, { editor: cssPx(studioView, '--studio-editor', 410), list: cssPx(studioView, '--studio-list', 270) });

setupSplitter($('#deckSplitLeft'), { ...PANES.deckLeft, onEnd: saveDeckPanes });
setupSplitter($('#deckSplitRight'), { ...PANES.deckRight, onEnd: saveDeckPanes });
setupSplitter($('#studioSplitEditor'), { ...PANES.studioEditor, onEnd: saveStudioPanes });
setupSplitter($('#studioSplitList'), { ...PANES.studioList, onEnd: saveStudioPanes });

function restorePaneSizes() {
  const deckSizes = readJson(STORAGE_KEYS.deckPanes, {});
  const studioSizes = readJson(STORAGE_KEYS.studioPanes, {});
  deckView.style.setProperty('--deck-left', `${Math.max(PANES.deckLeft.min, Number(deckSizes.left) || PANES.deckLeft.fallback)}px`);
  deckView.style.setProperty('--deck-right', `${Math.max(PANES.deckRight.min, Number(deckSizes.right) || PANES.deckRight.fallback)}px`);
  studioView.style.setProperty('--studio-editor', `${Math.max(PANES.studioEditor.min, Number(studioSizes.editor) || PANES.studioEditor.fallback)}px`);
  studioView.style.setProperty('--studio-list', `${Math.max(PANES.studioList.min, Number(studioSizes.list) || PANES.studioList.fallback)}px`);
}

/* ---------- Ctrl + molette : zoom des cartes plutôt que zoom du navigateur ---------- */

document.addEventListener('wheel', e => {
  if (!e.ctrlKey || currentView === 'trash') return;
  e.preventDefault();
  const step = e.deltaY < 0 ? 10 : -10;
  if (currentView === 'studio') changeStudioZoom(step);
  else writeText(STORAGE_KEYS.cardSize, setCardSize(Number(sizeInput.value) + step));
}, { passive: false });

function initLayout() {
  restorePaneSizes();
  applyDeckPanels();
  applyStudioPanels();
}
