'use strict';
/* ==========================================================================
   Onglet « Partage » : rassembler quelques cartes (glisser-déposer, clic, ou
   bouton « Envoyer vers Partage » du Card Studio) et les exporter en JSON.
   Le fichier a le même format que l'export de bibliothèque : l'autre joueur
   l'importe avec « Importer JSON » et les cartes arrivent dans sa bibliothèque.
   ========================================================================== */

const shareView = $('#shareView');
const shareLibrary = $('#shareLibrary');
const shareList = $('#shareList');
const shareDrop = $('#shareDrop');
const SHARE_CARD_SIZE = 150;

let shareIds = readJson(STORAGE_KEYS.shareList, []).map(String);
let shareQuery = '';

const saveShareList = () => writeJson(STORAGE_KEYS.shareList, shareIds);
/* Les cartes supprimées depuis (corbeille) disparaissent de la sélection. */
const sharedCards = () => shareIds.map(id => cardsById.get(id)).filter(Boolean);

function updateShareBadge() {
  const n = sharedCards().length;
  const badge = $('#shareBadge');
  badge.textContent = n;
  badge.classList.toggle('hidden', !n);
}

function addToShare(id) {
  const card = cardsById.get(String(id));
  if (!card) return false;
  if (!shareIds.includes(card.id)) {
    shareIds.push(card.id);
    saveShareList();
  }
  updateShareBadge();
  if (currentView === 'share') renderShare();
  return true;
}

function removeFromShare(id) {
  shareIds = shareIds.filter(x => x !== id);
  saveShareList();
  updateShareBadge();
  renderShare();
}

const shareCardHtml = (c, extra = '') =>
  `<article class="card shareCard${extra}" draggable="true" data-id="${escapeHtml(c.id)}" style="--size:${SHARE_CARD_SIZE}px">${cardMarkup(c)}</article>`;

function renderShare() {
  updateShareBadge();
  if (currentView !== 'share') return;
  const chosen = sharedCards();
  const chosenIds = new Set(chosen.map(c => c.id));
  const query = shareQuery.trim().toLowerCase();
  const pool = cards.filter(c => !query || searchIndex.get(c.id)?.includes(query));
  shareLibrary.innerHTML = pool.length
    ? pool.map(c => shareCardHtml(c, chosenIds.has(c.id) ? ' isShared' : '')).join('')
    : '<div class="note">Aucune carte ne correspond à cette recherche.</div>';
  shareList.innerHTML = chosen.map(c => `<div class="shareItem">${shareCardHtml(c)}<button class="shareRemove" type="button" data-remove="${escapeHtml(c.id)}" title="Retirer du partage">×</button></div>`).join('');
  shareDrop.classList.toggle('isEmpty', !chosen.length);
  $('#shareCount').textContent = chosen.length ? `${chosen.length} carte${chosen.length > 1 ? 's' : ''}` : 'Aucune carte';
  $('#exportShare').disabled = !chosen.length;
  $('#clearShare').disabled = !chosen.length;
}

/* ---------- Glisser-déposer ---------- */

let shareDragId = null;
let shareDragFromList = false;   // la carte vient de la zone de droite (cartes à partager)

function shareDragStart(e) {
  const el = e.target.closest('.card[data-id]');
  if (!el) return;
  shareDragId = el.dataset.id;
  shareDragFromList = shareList.contains(el);
  hideHoverPreview();
  e.dataTransfer.effectAllowed = 'copyMove';
  e.dataTransfer.setData('text/plain', shareDragId);
}

shareLibrary.addEventListener('dragstart', shareDragStart);
shareList.addEventListener('dragstart', shareDragStart);
document.addEventListener('dragend', () => {
  shareDragId = null;
  shareDragFromList = false;
  shareDrop.classList.remove('isOver');
  sharePick.classList.remove('isOver');
  $('#tabShare').classList.remove('isOver');
});

/* Carte venue de la bibliothèque du Partage, ou de la bibliothèque du Deckbuilder. */
const draggedCardId = () => shareDragId || (dragContext?.source === 'library' ? dragContext.id : null);

shareDrop.addEventListener('dragover', e => {
  if (!draggedCardId()) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  shareDrop.classList.add('isOver');
});
shareDrop.addEventListener('dragleave', e => {
  if (!shareDrop.contains(e.relatedTarget)) shareDrop.classList.remove('isOver');
});
shareDrop.addEventListener('drop', e => {
  const id = draggedCardId();
  if (!id) return;
  e.preventDefault();
  shareDrop.classList.remove('isOver');
  addToShare(id);
});

/* Glisser une carte de la zone de droite vers la gauche la retire du partage. */
const sharePick = $('.sharePick');
sharePick.addEventListener('dragover', e => {
  if (!shareDragFromList) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  sharePick.classList.add('isOver');
});
sharePick.addEventListener('dragleave', e => {
  if (!sharePick.contains(e.relatedTarget)) sharePick.classList.remove('isOver');
});
sharePick.addEventListener('drop', e => {
  if (!shareDragFromList || !shareDragId) return;
  e.preventDefault();
  sharePick.classList.remove('isOver');
  removeFromShare(shareDragId);
});

/* Depuis le Deckbuilder : déposer une carte de la bibliothèque sur l'onglet « Partage ». */
const tabShare = $('#tabShare');
tabShare.addEventListener('dragover', e => {
  if (!draggedCardId()) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  tabShare.classList.add('isOver');
});
tabShare.addEventListener('dragleave', () => tabShare.classList.remove('isOver'));
tabShare.addEventListener('drop', e => {
  const id = draggedCardId();
  if (!id) return;
  e.preventDefault();
  e.stopPropagation();
  tabShare.classList.remove('isOver');
  if (addToShare(id)) flash(`${cardsById.get(id).name} ajoutée au Partage.`);
});

/* ---------- Clics ---------- */

shareLibrary.addEventListener('click', e => {
  const el = e.target.closest('.card[data-id]');
  if (!el) return;
  if (shareIds.includes(el.dataset.id)) removeFromShare(el.dataset.id);
  else addToShare(el.dataset.id);
});

shareList.addEventListener('click', e => {
  const id = e.target.closest('[data-remove]')?.dataset.remove;
  if (id) removeFromShare(id);
});

for (const area of [shareLibrary, shareList]) {
  area.addEventListener('mouseover', e => {
    const el = e.target.closest('.card[data-id]');
    const card = el && cardsById.get(el.dataset.id);
    if (card) showHoverPreview(card);
  });
  area.addEventListener('mouseleave', hideHoverPreview);
}

$('#shareSearch').addEventListener('input', e => {
  shareQuery = e.target.value;
  renderShare();
});

$('#clearShare').onclick = () => {
  shareIds = [];
  saveShareList();
  renderShare();
};

/* ---------- Export ---------- */

$('#exportShare').onclick = () => {
  const chosen = sharedCards();
  if (!chosen.length) return flash('Ajoute d’abord des cartes à partager.');
  const pack = {
    format: LIBRARY_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    customCards: chosen.filter(c => !isBaseId(c.id)),
    editedBase: Object.fromEntries(chosen.filter(c => isBaseId(c.id)).map(c => [c.id, c])),
    libraryOrder: chosen.map(c => c.id),
  };
  const date = new Date().toISOString().slice(0, 10);
  downloadBlob(new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' }), `Gwendalavirs-Battle-Partage-${date}-${chosen.length}-cartes.gwb.json`);
  flash(`${chosen.length} carte${chosen.length > 1 ? 's' : ''} exportée${chosen.length > 1 ? 's' : ''}. L’autre joueur l’importe avec « Importer JSON ».`);
};

/* ---------- Card Studio : « Envoyer vers Partage » ---------- */

$('#shareStudioCard').onclick = async () => {
  if (!sName.value.trim()) {
    showStudioPane('editor');
    sName.focus();
    return flash('Donne un nom à la carte avant de l’envoyer vers Partage.');
  }
  // La carte est d'abord sauvegardée, pour partager exactement ce qui est affiché.
  await $('#saveCard').onclick();
  if (editingId && addToShare(editingId)) flash(`${sName.value.trim()} sauvegardée et ajoutée au Partage (${sharedCards().length} carte${sharedCards().length > 1 ? 's' : ''}).`);
};

updateShareBadge();
