'use strict';
/* ==========================================================================
   Card Studio : formulaire, aperçu en direct, éditeur de texte riche,
   illustration, historique des cartes créées et limites d'exemplaires.
   ========================================================================== */

const sName = $('#studioName');
const sColor = $('#studioColor');
const sType = $('#studioType');
const sSubtype = $('#studioSubtype');
const sSet = $('#studioSet');
const sSpire = $('#studioSpire');
const sShowSpire = $('#studioShowSpire');
const sAttack = $('#studioAttack');
const sHealth = $('#studioHealth');
const sShowAttack = $('#studioShowAttack');
const sShowHealth = $('#studioShowHealth');
const sLimitOverride = $('#studioLimitOverride');
const sImage = $('#studioImage');
const sText = $('#studioText');
const liveCard = $('#liveCard');
const imageDrop = $('#imageDrop');
const imageFile = $('#studioImageFile');
const imageThumb = $('#imageDropThumb');
const imageRemove = $('#imageRemove');
const textFontSize = $('#textFontSize');
const typeFontSize = $('#typeFontSize');
const subtypeFontSize = $('#subtypeFontSize');
const textColorPalette = $('#textColorPalette');
const spellLang = $('#spellLang');

const PREVIEW_NAME = 'Nouvelle carte';
const PREVIEW_TEXT = 'Le texte de la carte apparaîtra ici.';

let editingId = null;                   // id de la carte en cours de modification (null = nouvelle)
let studioRarity = RARITIES[0];
let studioZoom = Number(readText(STORAGE_KEYS.studioZoom)) || 100;
let textStyle = { ...DEFAULT_TEXT_STYLE };
let typeStyle = { ...DEFAULT_TYPE_STYLE };
let subtypeStyle = { ...DEFAULT_SUBTYPE_STYLE };
let studioHistoryHidden = new Set(readJson(STORAGE_KEYS.studioHistoryHidden, []));
const saveStudioHistory = () => writeJson(STORAGE_KEYS.studioHistoryHidden, [...studioHistoryHidden]);

/* L'éditeur de texte est un <div contenteditable> : on lui donne une propriété
   .value comme un champ classique, toujours nettoyée. */
Object.defineProperty(sText, 'value', {
  get() { return this.innerHTML; },
  set(v) { this.innerHTML = sanitizeRichText(v || ''); },
});

function buildStudioControls() {
  sColor.innerHTML = COLOR_NAMES.map(name => `<option>${name}</option>`).join('');
  sSpire.innerHTML = Array.from({ length: MAX_SPIRE - MIN_SPIRE + 1 }, (_, i) => `<option>${MIN_SPIRE + i}</option>`).join('');
  textColorPalette.innerHTML = TEXT_COLORS.map(({ hex, name }) => `<button type="button" class="textColorSwatch" data-text-color="${hex}" style="--swatch: ${hex}" title="${name}" aria-label="Texte ${name.toLowerCase()}"></button>`).join('');
}

/* ---------- Aperçu en direct ---------- */

function studioCardData() {
  return normalizeCard({
    id: editingId || 'live',
    name: sName.value.trim(),
    spire: sSpire.value,
    showSpire: sShowSpire.checked,
    type: sType.value || 'Carte',
    subtype: sSubtype.value,
    color: sColor.value,
    rarity: studioRarity,
    attack: sAttack.value,
    health: sHealth.value,
    showAttack: sShowAttack.checked,
    showHealth: sShowHealth.checked,
    text: sText.value,
    textStyle: { ...textStyle },
    typeStyle: { ...typeStyle },
    subtypeStyle: { ...subtypeStyle },
    set: sSet.value,
    deckLimitOverride: sLimitOverride.value,
    image: sImage.value,
  });
}

function renderLive() {
  const data = studioCardData();
  const preview = { ...data, name: sName.value || PREVIEW_NAME, text: data.text || PREVIEW_TEXT };
  liveCard.innerHTML = cardMarkup(preview, { studio: true });
  liveCard.className = 'card studioLiveCard' + (preview.showAttack || preview.showHealth ? ' hasCharacterStats' : '');
  liveCard.dataset.color = preview.color;
  liveCard.dataset.zone = 'color';
  applyStudioZoom();
  applySpellLanguageTo($$('[contenteditable]', liveCard));
}

for (const input of [sName, sColor, sType, sSubtype, sSet, sSpire, sShowSpire, sAttack, sHealth, sShowAttack, sShowHealth, sLimitOverride]) {
  input.addEventListener('input', () => {
    if (input === sType || input === sSubtype) syncTaxonomyDeleteButtons();
    renderLive();
  });
}

function setStudioRarity(rarity) {
  studioRarity = rarity;
  $$('#studioRarity button').forEach(b => b.classList.toggle('active', b.dataset.r === rarity));
}
$('#studioRarity').addEventListener('click', e => {
  const button = e.target.closest('button[data-r]');
  if (!button) return;
  setStudioRarity(button.dataset.r);
  renderLive();
});

/* ---------- Types / Sous-types (liste déroulante filtrable + créer / supprimer) ---------- */

const taxonomyInput = kind => (kind === 'type' ? sType : sSubtype);
const taxonomyLabel = kind => (kind === 'type' ? 'Type' : 'Sous-type');

function closeTaxonomyMenus(except = null) {
  for (const kind of ['type', 'subtype']) if (kind !== except) $(`#${kind}Menu`).classList.add('hidden');
}

function openTaxonomyMenu(kind, filter) {
  const menu = $(`#${kind}Menu`);
  closeTaxonomyMenus(kind);
  menu.innerHTML = taxonomyMenuMarkup(kind, filter ? taxonomyInput(kind).value : '');
  menu.classList.remove('hidden');
}

for (const kind of ['type', 'subtype']) {
  const input = taxonomyInput(kind);
  const menu = $(`#${kind}Menu`);
  $(`#${kind}Toggle`).onclick = e => {
    e.stopPropagation();
    if (menu.classList.contains('hidden')) openTaxonomyMenu(kind, false);
    else closeTaxonomyMenus();
  };
  input.addEventListener('input', () => openTaxonomyMenu(kind, true));
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      openTaxonomyMenu(kind, false);
    } else if (e.key === 'Escape') {
      closeTaxonomyMenus();
    }
  });
  menu.onclick = e => {
    const option = e.target.closest('.taxonomyOption');
    if (!option) return;
    input.value = option.dataset.value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    closeTaxonomyMenus();
    input.focus();
  };
}
document.addEventListener('click', e => {
  if (!e.target.closest('.taxonomyPicker')) closeTaxonomyMenus();
});

function taxonomyExists(kind, value) {
  return kind === 'type' ? typeExists(value) : customSubtypes.has(value);
}

function syncTaxonomyDeleteButtons() {
  for (const kind of ['type', 'subtype']) {
    const value = taxonomyInput(kind).value.trim();
    // Seuls les Sous-types créés à la main sont supprimables (les autres viennent des cartes).
    const removable = taxonomyExists(kind, value);
    const button = $(kind === 'type' ? '#deleteType' : '#deleteSubtype');
    button.disabled = !removable;
    button.title = removable ? `Supprimer le ${taxonomyLabel(kind)} « ${value} »` : `Sélectionne un ${taxonomyLabel(kind)} existant à supprimer`;
  }
}

function taxonomiesChanged() {
  saveTaxonomies();
  syncTaxonomyControls();
  syncTaxonomyDeleteButtons();
  renderRules();
  renderLive();
}

function createTaxonomy(kind) {
  const input = taxonomyInput(kind);
  const value = input.value.trim();
  if (!value) {
    input.focus();
    flash(`Écris d’abord un ${taxonomyLabel(kind)}.`);
    return;
  }
  if (taxonomyExists(kind, value)) {
    syncTaxonomyDeleteButtons();
    flash(`Le ${taxonomyLabel(kind)} « ${value} » existe déjà.`);
    return;
  }
  if (kind === 'type') {
    deletedTypes.delete(value);
    if (!TYPES.includes(value)) customTypes.add(value);
    if (!limitRules.type[value]) {
      limitRules.type[value] = DEFAULT_LIMIT;
      saveRules();
    }
  } else {
    customSubtypes.add(value);
  }
  input.value = value;
  taxonomiesChanged();
  flash(`${taxonomyLabel(kind)} « ${value} » créé.`);
}

function deleteTaxonomy(kind) {
  const input = taxonomyInput(kind);
  const value = input.value.trim();
  const label = taxonomyLabel(kind);
  if (!taxonomyExists(kind, value)) {
    flash(`Sélectionne un ${label} existant à supprimer.`);
    return;
  }
  const used = cards.filter(c => (kind === 'type' ? c.type : c.subtype) === value).length;
  if (used) {
    alert(`Impossible de supprimer « ${value} » : ${used} carte${used > 1 ? 's l’utilisent' : ' l’utilise'}. Modifie d’abord ${used > 1 ? 'ces cartes' : 'cette carte'}.`);
    return;
  }
  if (!confirm(`Supprimer définitivement le ${label} « ${value} » ?`)) return;
  if (kind === 'type') {
    customTypes.delete(value);
    if (TYPES.includes(value)) deletedTypes.add(value);
    if (Object.hasOwn(limitRules.type, value)) {
      delete limitRules.type[value];
      saveRules();
    }
    input.value = [...TYPES, ...customTypes].find(v => !deletedTypes.has(v)) || 'Carte';
  } else {
    customSubtypes.delete(value);
    input.value = '';
  }
  taxonomiesChanged();
  flash(`${label} « ${value} » supprimé.`);
}

$('#createType').onclick = () => createTaxonomy('type');
$('#createSubtype').onclick = () => createTaxonomy('subtype');
$('#deleteType').onclick = () => deleteTaxonomy('type');
$('#deleteSubtype').onclick = () => deleteTaxonomy('subtype');

/* ---------- Mise en forme : taille / gras / italique / souligné ---------- */

function styleFor(target) {
  return target === 'text' ? textStyle : target === 'type' ? typeStyle : subtypeStyle;
}

function syncFormatControls() {
  textFontSize.value = String(textStyle.fontSize);
  typeFontSize.value = String(typeStyle.fontSize);
  subtypeFontSize.value = String(subtypeStyle.fontSize);
  $$('.formatToggle').forEach(b => b.classList.toggle('active', !!styleFor(b.dataset.formatTarget)[b.dataset.formatKey]));
}

typeFontSize.oninput = () => {
  typeStyle.fontSize = Number(typeFontSize.value) || DEFAULT_TYPE_STYLE.fontSize;
  renderLive();
};
subtypeFontSize.oninput = () => {
  subtypeStyle.fontSize = Number(subtypeFontSize.value) || DEFAULT_SUBTYPE_STYLE.fontSize;
  renderLive();
};

/* ---------- Éditeur de texte riche ----------
   Le texte se met en forme mot par mot : on mémorise la sélection, car cliquer
   sur un bouton de la barre d'outils la fait perdre. */

let richRange = null;

function selectionNodeIn(editor) {
  const sel = getSelection();
  if (!sel?.rangeCount || !editor.contains(sel.anchorNode)) return null;
  return sel.anchorNode.nodeType === Node.ELEMENT_NODE ? sel.anchorNode : sel.anchorNode.parentElement;
}

function rememberRichRange() {
  const sel = getSelection();
  if (sel?.rangeCount && sText.contains(sel.anchorNode)) richRange = sel.getRangeAt(0).cloneRange();
}

function restoreRichRange() {
  if (!richRange) return false;
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(richRange);
  sText.focus({ preventScroll: true });
  return true;
}

/* Restaure la sélection mémorisée ; prévient si rien n'est sélectionné. */
function requireTextSelection(message) {
  if (richRange && !richRange.collapsed && restoreRichRange()) return true;
  flash(message);
  return false;
}

function textChanged() {
  sText.dispatchEvent(new Event('input', { bubbles: true }));
  rememberRichRange();
}

function rgbToHex(color) {
  const hex = String(color || '').trim().match(/^#([0-9a-f]{6})$/i);
  if (hex) return `#${hex[1].toLowerCase()}`;
  const values = String(color || '').match(/[\d.]+/g);
  if (!values || values.length < 3) return DEFAULT_TEXT_COLOR;
  return '#' + values.slice(0, 3).map(v => clamp(Math.round(Number(v)), 0, 255).toString(16).padStart(2, '0')).join('');
}

function setTextColorPalette(value) {
  const color = rgbToHex(value || DEFAULT_TEXT_COLOR);
  $$('.textColorSwatch', textColorPalette).forEach(b => b.classList.toggle('active', b.dataset.textColor.toLowerCase() === color));
}

function ensureFontSizeOption(size) {
  if (![...textFontSize.options].some(o => Number(o.value) === size)) {
    textFontSize.add(new Option(String(size), String(size)));
    [...textFontSize.options].sort((a, b) => Number(a.value) - Number(b.value)).forEach(o => textFontSize.add(o));
  }
  textFontSize.value = String(size);
}

/* Met la barre d'outils en accord avec le texte sélectionné. */
function syncSelectedTextControls() {
  rememberRichRange();
  const node = selectionNodeIn(sText);
  const sized = node?.closest('span[style*="font-size"]');
  ensureFontSizeOption(clamp(Math.round(Number.parseFloat(sized?.style.fontSize) || textStyle.fontSize), RICH_TEXT_MIN_PX, RICH_TEXT_MAX_PX));
  const colored = node?.closest('font[color],span[style*="color"]');
  setTextColorPalette(colored ? getComputedStyle(colored).color : DEFAULT_TEXT_COLOR);
  const states = { bold: document.queryCommandState('bold'), italic: document.queryCommandState('italic'), underline: document.queryCommandState('underline') };
  $$('.formatToggle[data-format-target="text"]').forEach(b => b.classList.toggle('active', !!states[b.dataset.formatKey]));
}

function pasteCleanText(e, target, after) {
  e.preventDefault();
  const plain = (e.clipboardData || window.clipboardData).getData('text/plain').replace(/\r\n?/g, '\n');
  document.execCommand('insertHTML', false, escapeHtml(plain).replace(/\n/g, '<br>'));
  target.normalize();
  after?.();
}

/* Ctrl+B / Ctrl+I / Ctrl+S (souligné). Renvoie true si le raccourci a été traité. */
function handleFormatShortcut(e) {
  if (!e.ctrlKey) return false;
  const command = { b: 'bold', i: 'italic', s: 'underline' }[e.key.toLowerCase()];
  if (!command) return false;
  e.preventDefault();
  document.execCommand(command, false);
  return true;
}

sText.addEventListener('input', () => {
  const textEl = $('[data-inline-edit="text"]', liveCard);
  if (textEl) textEl.innerHTML = scaledCardText(sText.value || PREVIEW_TEXT);
  rememberRichRange();
});
sText.addEventListener('mouseup', syncSelectedTextControls);
sText.addEventListener('keyup', syncSelectedTextControls);
sText.addEventListener('paste', e => pasteCleanText(e, sText, () => {
  sText.dispatchEvent(new Event('input', { bubbles: true }));
  syncSelectedTextControls();
}));
sText.addEventListener('keydown', e => {
  if (handleFormatShortcut(e)) sText.dispatchEvent(new Event('input', { bubbles: true }));
});

textFontSize.oninput = () => {
  if (!requireTextSelection('Sélectionne le mot ou le passage dont tu veux changer la taille.')) return;
  // execCommand ne sait produire que des <font size>, convertis aussitôt en <span> en px.
  document.execCommand('fontSize', false, '4');
  $$('font[size="4"]', sText).forEach(el => {
    const span = document.createElement('span');
    span.style.fontSize = `${textFontSize.value}px`;
    span.append(...el.childNodes);
    el.replaceWith(span);
  });
  textChanged();
};

for (const button of $$('.formatToggle')) {
  // Empêche le bouton de voler la sélection du texte.
  button.onmousedown = e => {
    if (button.dataset.formatTarget === 'text') e.preventDefault();
  };
  button.onclick = () => {
    const { formatKey: key, formatTarget: target } = button.dataset;
    if (target === 'text') {
      if (!requireTextSelection('Sélectionne le mot ou le passage à mettre en forme.')) return;
      document.execCommand(key, false);
      textChanged();
      return;
    }
    const style = styleFor(target);
    style[key] = !style[key];
    syncFormatControls();
    renderLive();
  };
}

textColorPalette.addEventListener('mousedown', e => {
  if (!e.target.closest('.textColorSwatch')) return;
  e.preventDefault();
  rememberRichRange();
});
textColorPalette.addEventListener('click', e => {
  const swatch = e.target.closest('.textColorSwatch');
  if (!swatch || !requireTextSelection('Sélectionne le mot ou le passage dont tu veux changer la couleur.')) return;
  document.execCommand('foreColor', false, swatch.dataset.textColor);
  textChanged();
  setTextColorPalette(swatch.dataset.textColor);
});

/* Langue du correcteur orthographique. */
function applySpellLanguageTo(elements) {
  const mode = spellLang.value || 'auto';
  for (const el of elements) {
    el.spellcheck = true;
    if (mode === 'auto') el.removeAttribute('lang');
    else el.lang = mode;
  }
}
spellLang.onchange = () => {
  writeText(STORAGE_KEYS.spellLang, spellLang.value || 'auto');
  applySpellLanguageTo([sText, sName, ...$$('[contenteditable]', liveCard)]);
  sText.focus({ preventScroll: true });
};

/* ---------- Édition directe sur l'aperçu (nom et texte) ---------- */

liveCard.addEventListener('input', e => {
  const field = e.target.closest('[data-inline-edit]');
  if (field?.dataset.inlineEdit === 'name') sName.value = field.innerText.replace(/\s*\n\s*/g, ' ').trimStart();
  if (field?.dataset.inlineEdit === 'text') sText.value = field.innerHTML;
});
liveCard.addEventListener('keydown', e => {
  const field = e.target.closest('[data-inline-edit]');
  if (field?.dataset.inlineEdit === 'name' && e.key === 'Enter') {
    e.preventDefault();
    field.blur();
  }
  if (field?.dataset.inlineEdit === 'text') handleFormatShortcut(e);
});
liveCard.addEventListener('paste', e => {
  const field = e.target.closest('[data-inline-edit="text"]');
  if (!field) return;
  pasteCleanText(e, field, () => {
    sText.value = field.innerHTML;
    sText.dispatchEvent(new Event('input', { bubbles: true }));
  });
});
liveCard.addEventListener('focusout', e => {
  const field = e.target.closest('[data-inline-edit]');
  if (!field) return;
  if (field.dataset.inlineEdit === 'name' && !sName.value.trim()) sName.value = PREVIEW_NAME;
  renderLive();
});

/* ---------- Zones survolées : aperçu ↔ champ du formulaire ---------- */

function clearZoneHighlights() {
  liveCard.classList.remove('zoneHighlight');
  $$('.zoneHighlight', liveCard).forEach(x => x.classList.remove('zoneHighlight'));
  $$('.studioEditor .fieldHighlight').forEach(x => x.classList.remove('fieldHighlight'));
}

liveCard.addEventListener('mouseover', e => {
  clearZoneHighlights();
  const zone = e.target.closest('[data-zone]');
  if (!zone) return;
  const key = zone.dataset.zone;
  if (key === 'color') liveCard.classList.add('zoneHighlight');
  else zone.classList.add('zoneHighlight');
  $(`.studioEditor [data-field="${key}"]`)?.classList.add('fieldHighlight');
});
liveCard.addEventListener('mouseleave', clearZoneHighlights);

$('#studioEditorPane').addEventListener('mouseover', e => {
  const field = e.target.closest('[data-field]');
  if (!field) return;
  clearZoneHighlights();
  field.classList.add('fieldHighlight');
  const key = field.dataset.field;
  if (key === 'color') liveCard.classList.add('zoneHighlight');
  else $$('[data-zone]', liveCard).filter(z => z.dataset.zone === key).forEach(z => z.classList.add('zoneHighlight'));
});
$('#studioEditorPane').addEventListener('mouseleave', clearZoneHighlights);

/* ---------- Zoom de l'aperçu ---------- */

function applyStudioZoom() {
  studioZoom = clamp(Number(studioZoom) || 100, 60, 180);
  $('#studioZoom').value = studioZoom;
  $('#studioZoomValue').textContent = `${studioZoom}%`;
  const size = Math.round((360 * studioZoom) / 100);
  liveCard.style.setProperty('--size', `${size}px`);
  liveCard.style.width = `${size}px`;
  writeText(STORAGE_KEYS.studioZoom, studioZoom);
}

function changeStudioZoom(delta) {
  studioZoom += delta;
  applyStudioZoom();
}

$('#studioZoom').oninput = e => {
  studioZoom = Number(e.target.value);
  applyStudioZoom();
};
$('#zoomOut').onclick = () => changeStudioZoom(-10);
$('#zoomIn').onclick = () => changeStudioZoom(10);

/* ---------- Illustration ---------- */

const IMAGE_MAX_WIDTH = 1000;
const IMAGE_MAX_HEIGHT = 1400;

function setStudioImage(src) {
  sImage.value = src || '';
  imageDrop.classList.toggle('hasImage', !!src);
  imageThumb.classList.toggle('hidden', !src);
  imageRemove.classList.toggle('hidden', !src);
  imageThumb.style.backgroundImage = src ? cssUrl(src) : '';
  renderLive();
}

function isSupportedImage(file) {
  const name = String(file?.name || '').toLowerCase();
  const type = String(file?.type || '').toLowerCase();
  return !!file && (['image/jpeg', 'image/png', 'image/webp'].includes(type) || /\.(jpe?g|png|webp)$/.test(name));
}

/* Redimensionne l'image (1000 × 1400 max) et la convertit en JPEG pour limiter sa taille. */
async function optimizeImageFile(file) {
  if (!isSupportedImage(file)) throw new Error('not-image');
  const img = await loadImage(await readFileAsDataUrl(file));
  if (!img?.naturalWidth || !img.naturalHeight) throw new Error('decode-failed');
  const scale = Math.min(1, IMAGE_MAX_WIDTH / img.naturalWidth, IMAGE_MAX_HEIGHT / img.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.88);
}

async function acceptStudioFile(file) {
  try {
    flash('Optimisation de l’image…');
    setStudioImage(await optimizeImageFile(file));
    flash(`${file.name || 'Image'} chargée.`);
  } catch (err) {
    console.warn(err);
    flash('Format illisible. Utilise un fichier JPG, PNG ou WebP.');
  }
}

imageDrop.onclick = e => {
  if (e.target !== imageRemove) imageFile.click();
};
imageDrop.onkeydown = e => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    imageFile.click();
  }
};
imageFile.onchange = () => {
  if (imageFile.files?.[0]) acceptStudioFile(imageFile.files[0]);
  imageFile.value = '';
};
for (const type of ['dragenter', 'dragover']) {
  imageDrop.addEventListener(type, e => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    imageDrop.classList.add('dragover');
  });
}
imageDrop.addEventListener('dragleave', e => {
  e.preventDefault();
  e.stopPropagation();
  if (!imageDrop.contains(e.relatedTarget)) imageDrop.classList.remove('dragover');
});
imageDrop.addEventListener('drop', e => {
  e.preventDefault();
  e.stopPropagation();
  imageDrop.classList.remove('dragover');
  const files = [...(e.dataTransfer?.files || [])];
  const fromItems = [...(e.dataTransfer?.items || [])].filter(x => x.kind === 'file').map(x => x.getAsFile());
  const file = files.find(isSupportedImage) || fromItems.find(isSupportedImage);
  if (file) acceptStudioFile(file);
  else flash('Dépose ici un fichier JPG, PNG ou WebP.');
});
imageRemove.onclick = e => {
  e.stopPropagation();
  setStudioImage('');
};

/* ---------- Charger / réinitialiser / sauvegarder ---------- */

function fillStudioForm(c) {
  editingId = c?.id ?? null;
  sName.value = c?.name || '';
  sColor.value = c?.color || 'Bleu';
  sType.value = c ? c.type : 'Dessin de base';
  sSubtype.value = c?.subtype || '';
  sSet.value = c?.set || SETS[0];
  sSpire.value = String(c?.spire ?? 0);
  sShowSpire.checked = c ? c.showSpire !== false : true;
  sAttack.value = String(c?.attack ?? 0);
  sHealth.value = String(c?.health ?? 0);
  sShowAttack.checked = !!c?.showAttack;
  sShowHealth.checked = !!c?.showHealth;
  sLimitOverride.value = c?.deckLimitOverride ? String(c.deckLimitOverride) : '';
  sText.value = c?.text || '';
  textStyle = normalizeFontStyle(c?.textStyle, DEFAULT_TEXT_STYLE);
  typeStyle = normalizeFontStyle(c?.typeStyle, DEFAULT_TYPE_STYLE);
  subtypeStyle = normalizeFontStyle(c?.subtypeStyle, DEFAULT_SUBTYPE_STYLE);
  syncFormatControls();
  syncTaxonomyDeleteButtons();
  setStudioRarity(c?.rarity || RARITIES[0]);
  $('#editBadge').classList.toggle('hidden', !c);
  setStudioImage(c?.image || '');
}

const resetStudio = () => fillStudioForm(null);
const populateStudio = c => fillStudioForm(normalizeCard(c));

function openStudioForCard(c) {
  setView('studio');
  populateStudio(c);
  renderStudio();
  setTimeout(() => sName.focus(), 0);
}

$('#resetCard').onclick = resetStudio;

$('#saveCard').onclick = async () => {
  const name = sName.value.trim();
  if (!name) {
    showStudioPane('editor');
    sName.focus();
    return;
  }
  const isEdit = !!editingId;
  const id = editingId || `custom-${Date.now()}`;
  const card = { ...studioCardData(), id, name };
  if (isBaseId(id)) {
    editedBase[id] = card;
  } else {
    const index = customCards.findIndex(c => c.id === id);
    if (index >= 0) customCards[index] = card;
    else customCards.push(card);
  }
  editingId = id;
  $('#editBadge').classList.remove('hidden');
  freshlySaved.add(id);
  studioHistoryHidden.delete(id);
  saveFreshlySaved();
  saveStudioHistory();
  const stored = await saveCardData();
  cardsChanged();
  if (!stored) flash('Espace de stockage du navigateur indisponible : la carte n’a pas pu être enregistrée.');
  else flash(isEdit ? `${name} modifiée et sauvegardée.` : `${name} sauvegardée.`);
};

/* ---------- Historique « Créées / modifiées » ---------- */

function renderStudioList() {
  const hidden = trashedIds();
  const visible = c => !hidden.has(c.id) && !studioHistoryHidden.has(c.id);
  const rows = [
    ...customCards.filter(visible).map(c => ({ c: normalizeCard(c), kind: 'custom' })),
    ...Object.values(editedBase).filter(visible).map(c => ({ c: normalizeCard(c), kind: 'base' })),
  ];
  $('#customList').innerHTML = rows.length ? rows.map(({ c, kind }) => {
    const id = escapeHtml(c.id);
    return `<div class="customRow" data-id="${id}"><span class="mana">${c.spire}</span><span class="grow"><strong>${escapeHtml(c.name)}</strong><br><span style="color:#777">${escapeHtml(c.color)} · ${escapeHtml(c.type)} · ${escapeHtml(c.rarity)} · limite ${limitOf(c)}${kind === 'base' ? ' · base modifiée' : ''}</span></span>`
      + `<button class="secondary editStored" data-id="${id}">Modifier</button><button class="danger deleteCustom" data-id="${id}" data-kind="${kind}">${kind === 'base' ? 'Réinitialiser' : 'Corbeille'}</button></div>`;
  }).join('') : '<div class="note">L’historique est vide. Les cartes restent disponibles dans la bibliothèque.</div>';
}

$('#customList').addEventListener('click', async e => {
  const row = e.target.closest('.customRow[data-id]');
  if (!row) return;
  const id = row.dataset.id;
  const deleteButton = e.target.closest('.deleteCustom');
  if (!deleteButton) {
    if (cardsById.has(id)) populateStudio(cardsById.get(id));
    return;
  }
  if (deleteButton.dataset.kind === 'base') {
    delete editedBase[id];
    if (editingId === id) resetStudio();
    await saveCardData();
    cardsChanged();
    flash('Modification de la carte de base réinitialisée.');
  } else if (cardsById.has(id)) {
    openDeleteCardModal(cardsById.get(id), 'trash');
  }
});

$('#clearStudioHistory').onclick = () => {
  for (const c of [...customCards, ...Object.values(editedBase)]) studioHistoryHidden.add(c.id);
  saveStudioHistory();
  renderStudio();
  flash('Historique du Studio vidé. Les cartes sont conservées.');
};

/* ---------- Limites d'exemplaires ---------- */

function ruleLineMarkup(kind, key) {
  return `<label class="ruleLine">${escapeHtml(key)} <input class="ruleInput" data-rule-kind="${kind}" data-rule-key="${escapeHtml(key)}" type="number" min="1" max="99" value="${clampRule(limitRules[kind][key])}"></label>`;
}

function renderRules() {
  const types = [...TYPES, ...customTypes].filter(t => !deletedTypes.has(t));
  $('#rarityRules').innerHTML = '<strong>Par rareté</strong>' + RARITIES.map(r => ruleLineMarkup('rarity', r)).join('');
  $('#typeRules').innerHTML = '<strong>Par Type principal</strong>' + [...new Set(types)].map(t => ruleLineMarkup('type', t)).join('');
}

$('.rulesBox').addEventListener('input', e => {
  const input = e.target.closest('.ruleInput');
  if (!input) return;
  const value = clampRule(input.value);
  limitRules[input.dataset.ruleKind][input.dataset.ruleKey] = value;
  input.value = value;
  saveRules();
  renderDeck();
  renderLive();
  renderLibrary();
});

function renderStudio() {
  renderLive();
  renderStudioList();
  renderRules();
  syncFormatControls();
}

function initStudio() {
  buildStudioControls();
  spellLang.value = readText(STORAGE_KEYS.spellLang) || 'auto';
  applySpellLanguageTo([sText, sName]);
  setTextColorPalette(DEFAULT_TEXT_COLOR);
  resetStudio();
}
