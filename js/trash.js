'use strict';
/* ==========================================================================
   Corbeille : mettre de côté, restaurer ou supprimer définitivement des cartes.
   Les copies (avec leurs images) sont stockées dans IndexedDB, pas dans le
   localStorage, pour ne jamais saturer le stockage du navigateur.
   ========================================================================== */

const tabTrash = $('#tabTrash');

/* Retire toute trace d'une carte du deck en cours, des favoris et du Studio. */
function forgetCard(id) {
  removeFromDeck(id);
  bookmarks.delete(id);
  freshlySaved.delete(id);
  if (editingId === id) resetStudio();
}

async function trashChanged() {
  const stored = await saveTrashData();
  saveCardData();
  saveBookmarks();
  saveFreshlySaved();
  saveDeckState();
  cardsChanged();
  return stored;
}

async function moveCardToTrash(c) {
  if (!c) return;
  trashCards = trashCards.filter(x => x.id !== c.id);
  trashCards.push({ ...c, trashedAt: Date.now(), trashOrigin: isBaseId(c.id) ? 'base' : 'custom' });
  forgetCard(c.id);
  await trashChanged();
  flash(`${c.name} placée dans la corbeille.`);
}

/* Toute la bibliothèque part dans la corbeille : rien n'est perdu, tout se restaure. */
async function moveLibraryToTrash() {
  const all = cards.slice();
  if (!all.length) return;
  const now = Date.now();
  const ids = new Set(all.map(c => c.id));
  trashCards = trashCards.filter(x => !ids.has(x.id));
  for (const c of all) {
    trashCards.push({ ...c, trashedAt: now, trashOrigin: isBaseId(c.id) ? 'base' : 'custom' });
    forgetCard(c.id);
  }
  hero = null;
  await trashChanged();
  flash(`${all.length} carte${all.length > 1 ? 's' : ''} placée${all.length > 1 ? 's' : ''} dans la corbeille.`);
}

async function restoreAllFromTrash() {
  const n = trashCards.length;
  if (!n) return;
  trashCards = [];
  await trashChanged();
  flash(`${n} carte${n > 1 ? 's' : ''} restaurée${n > 1 ? 's' : ''} dans la bibliothèque.`);
}

async function restoreFromTrash(id) {
  trashCards = trashCards.filter(c => c.id !== id);
  await trashChanged();
  flash('Carte restaurée dans la bibliothèque.');
}

function deleteForever(c) {
  if (isBaseId(c.id)) {
    permanentlyDeletedBase.add(c.id);
    delete editedBase[c.id];
  } else {
    customCards = customCards.filter(x => x.id !== c.id);
  }
  studioHistoryHidden.delete(c.id);
  forgetCard(c.id);
}

async function permanentlyDeleteFromTrash(id) {
  const c = trashCards.find(x => x.id === id);
  if (!c) return;
  deleteForever(c);
  trashCards = trashCards.filter(x => x.id !== id);
  saveStudioHistory();
  await trashChanged();
  flash(`${c.name} supprimée définitivement.`);
}

async function permanentlyDeleteAllTrash() {
  const removed = trashCards.length;
  if (!removed) return;
  trashCards.forEach(deleteForever);
  trashCards = [];
  saveStudioHistory();
  await trashChanged();
  flash(`${removed} carte${removed > 1 ? 's' : ''} supprimée${removed > 1 ? 's' : ''} définitivement.`);
}

function renderTrash() {
  const count = trashCards.length;
  $('#trashCount').textContent = count;
  $('#trashBadge').textContent = count;
  $('#trashBadge').classList.toggle('hidden', count === 0);
  $('#emptyTrash').disabled = count === 0;
  $('#restoreAllTrash').disabled = count === 0;
  $('#trashLibrary').disabled = cards.length === 0;
  $('#trashList').innerHTML = count ? trashCards.slice().reverse().map(raw => {
    const c = normalizeCard(raw);
    const id = escapeHtml(c.id);
    return `<div class="trashItem"><article class="card" data-color="${escapeHtml(c.color)}">${cardMarkup(c)}</article><div class="trashMeta">`
      + `<span class="eyebrow">${raw.trashOrigin === 'base' ? 'CARTE DE BASE' : 'CARTE CRÉÉE'}</span><h3>${escapeHtml(c.name)}</h3>`
      + `<p>${escapeHtml(c.color)} · ${escapeHtml(c.type)} · ${escapeHtml(c.rarity)} · Volonté ${c.spire}<br>Supprimée ${raw.trashedAt ? new Date(raw.trashedAt).toLocaleString('fr-FR') : ''}</p>`
      + `<div class="trashButtons"><button class="restoreCard" data-id="${id}">Restaurer</button><button class="permaDelete" data-id="${id}">Supprimer définitivement</button></div></div></div>`;
  }).join('') : '<div class="note">La corbeille est vide.</div>';
}

$('#trashList').addEventListener('click', e => {
  const button = e.target.closest('button[data-id]');
  if (!button) return;
  if (button.classList.contains('restoreCard')) restoreFromTrash(button.dataset.id);
  else openDeleteCardModal(trashCards.find(x => x.id === button.dataset.id), 'permanent');
});

/* Glisser une carte de la bibliothèque sur l'onglet Corbeille. */
tabTrash.addEventListener('dragenter', e => {
  if (dragContext?.source !== 'library') return;
  e.preventDefault();
  tabTrash.classList.add('trashDropTarget');
});
tabTrash.addEventListener('dragover', e => {
  if (dragContext?.source !== 'library') return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  tabTrash.classList.add('trashDropTarget');
});
tabTrash.addEventListener('dragleave', e => {
  if (!tabTrash.contains(e.relatedTarget)) tabTrash.classList.remove('trashDropTarget');
});
tabTrash.addEventListener('drop', e => {
  if (dragContext?.source !== 'library') return;
  e.preventDefault();
  e.stopPropagation();
  const c = cardsById.get(dragContext.id);
  endDrag();
  moveCardToTrash(c);
});

/* ---------- Fenêtre de confirmation ---------- */

const deleteCardModal = $('#deleteCardModal');
let pendingDelete = null;   // { id, mode: 'trash' | 'permanent' | 'all' }

const DELETE_MODAL_TEXTS = {
  trash: c => ['Mettre cette carte à la corbeille ?', `${c.name} disparaîtra de la bibliothèque et sera retirée du deck, mais pourra être restaurée depuis la Corbeille.`, 'Mettre à la corbeille'],
  permanent: c => ['Supprimer définitivement cette carte ?', `${c.name} sera effacée définitivement. Cette action ne peut pas être annulée.`, 'Supprimer définitivement'],
  library: () => {
    const n = cards.length;
    return ['Voulez-vous vraiment tout supprimer ?', `Les ${n} carte${n > 1 ? 's' : ''} de la bibliothèque seront placées dans la corbeille et retirées du deck. Tu pourras les restaurer avec « Tout restaurer ».`, 'Tout supprimer'];
  },
  all: () => {
    const n = trashCards.length;
    const s = n > 1 ? 's' : '';
    return ['Vider toute la corbeille ?', `Les ${n} carte${s} contenue${s} dans la corbeille seront supprimées définitivement. Cette action ne peut pas être annulée.`, 'Tout supprimer définitivement'];
  },
};

function openDeleteCardModal(c, mode = 'trash') {
  if (!c && mode !== 'all' && mode !== 'library') return;
  pendingDelete = { id: c?.id ?? null, mode };
  const [title, copy, confirmLabel] = DELETE_MODAL_TEXTS[mode](c);
  $('#deleteCardTitle').textContent = title;
  $('#deleteCardCopy').textContent = copy;
  $('#deleteCardConfirm').textContent = confirmLabel;
  deleteCardModal.classList.remove('hidden');
}

function closeDeleteCardModal() {
  deleteCardModal.classList.add('hidden');
  pendingDelete = null;
}

$('#emptyTrash').onclick = () => {
  if (trashCards.length) openDeleteCardModal(null, 'all');
};
$('#trashLibrary').onclick = () => {
  if (cards.length) openDeleteCardModal(null, 'library');
};
$('#restoreAllTrash').onclick = restoreAllFromTrash;
$('#deleteCardCancel').onclick = closeDeleteCardModal;
closeOnBackdrop(deleteCardModal, closeDeleteCardModal);
$('#deleteCardConfirm').onclick = () => {
  if (!pendingDelete) return;
  const { id, mode } = pendingDelete;
  closeDeleteCardModal();
  if (mode === 'all') permanentlyDeleteAllTrash();
  else if (mode === 'library') moveLibraryToTrash();
  else if (mode === 'trash') moveCardToTrash(cardsById.get(id));
  else permanentlyDeleteFromTrash(id);
};
