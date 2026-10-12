'use strict';
/* ==========================================================================
   Démarrage de l'application.
   ========================================================================== */

/* À appeler après toute modification de cartes (création, import, corbeille…) :
   recalcule la bibliothèque et réaffiche tout ce qui en dépend. */
function cardsChanged() {
  refreshCards();
  resolveHero();
  renderLibrary();
  renderDeck();
  renderStudio();
  renderTrash();
}

async function initApp() {
  for (const el of $$('[data-app-version]')) el.textContent = APP_VERSION;
  document.title = `Gwendalavir's Battle · Deckbuilder V${APP_VERSION}`;

  // Les cartes sont chargées avant le premier affichage : aucune sauvegarde ne peut
  // écraser les données pendant qu'elles sont encore en cours de lecture.
  const data = await loadHeavyData();
  customCards = data.customCards.filter(c => c && typeof c === 'object').map(normalizeCard);
  editedBase = data.editedBase;
  trashCards = data.trashCards.filter(c => c && typeof c === 'object');
  if (data.needsCardMigration) await saveCardData();
  if (data.needsTrashMigration) await saveTrashData();

  refreshCards();
  loadStoredHero();
  initLayout();
  initLibrary();
  initStudio();
  cardsChanged();
  updateSpireFilter('min');
}

initApp();
