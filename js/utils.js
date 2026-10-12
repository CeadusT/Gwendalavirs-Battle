'use strict';
/* ==========================================================================
   Petits outils partagés : sélection DOM, échappement, texte riche, fichiers.
   ========================================================================== */

function $(selector, root = document) {
  return root.querySelector(selector);
}

function $$(selector, root = document) {
  return [...root.querySelectorAll(selector)];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/* À utiliser pour TOUT texte inséré dans du HTML (contenu ou attribut). */
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[ch]);
}

/* Valeur CSS url("…") sûre, quelle que soit l'adresse de l'image.
   Le résultat doit encore passer par escapeHtml() s'il va dans un attribut style="…". */
function cssUrl(value) {
  return `url("${String(value ?? '').replace(/[\\"]/g, '\\$&').replace(/[\n\r\f]/g, '')}")`;
}

/* Analyse du HTML dans un <template> : contrairement à un <div>, rien n'y est exécuté
   ni chargé (une balise <img onerror=…> piégée reste inoffensive). */
function parseInertHtml(html) {
  const template = document.createElement('template');
  template.innerHTML = String(html ?? '');
  return template.content;
}

function htmlOf(fragment) {
  const box = document.createElement('div');
  box.append(fragment);
  return box.innerHTML;
}

/* Renvoie la couleur CSS normalisée, ou '' si la valeur n'est pas une couleur. */
function safeCssColor(value) {
  const probe = document.createElement('span');
  probe.style.color = String(value || '');
  return probe.style.color;
}

const RICH_TEXT_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'BR', 'SPAN']);
const RICH_TEXT_MIN_PX = 8;
const RICH_TEXT_MAX_PX = 24;

/* Texte de carte : on ne garde que gras / italique / souligné / retour à la ligne,
   plus la taille et la couleur sur les <span>. Tout le reste est retiré. */
function sanitizeRichText(html) {
  const fragment = parseInertHtml(html);
  // La liste est figée avant la boucle : les enfants des balises retirées y sont déjà
  // et seront donc nettoyés à leur tour.
  for (const el of fragment.querySelectorAll('*')) {
    if (el.tagName === 'FONT') {
      // Ancien format produit par execCommand('foreColor') : converti en <span>.
      const span = document.createElement('span');
      const color = safeCssColor(el.getAttribute('color'));
      if (color) span.style.color = color;
      span.append(...el.childNodes);
      el.replaceWith(span);
      continue;
    }
    if (!RICH_TEXT_TAGS.has(el.tagName)) {
      el.replaceWith(...el.childNodes);
      continue;
    }
    const size = Number.parseInt(el.style.fontSize, 10);
    const color = el.tagName === 'SPAN' ? safeCssColor(el.style.color) : '';
    for (const attr of [...el.attributes]) el.removeAttribute(attr.name);
    if (el.tagName === 'SPAN') {
      if (size >= RICH_TEXT_MIN_PX && size <= RICH_TEXT_MAX_PX) el.style.fontSize = `${size}px`;
      if (color) el.style.color = color;
    }
  }
  return htmlOf(fragment);
}

function plainText(html) {
  const fragment = parseInertHtml(String(html ?? '').replace(/<br\s*\/?>/gi, '\n'));
  return (fragment.textContent || '').replace(/\u00a0/g, ' ');
}

/* Message temporaire en haut de l'écran. */
function flash(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(flash.timer);
  flash.timer = setTimeout(() => toast.classList.add('hidden'), 1900);
}

function downloadBlob(blob, fileName) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(link.href);
    link.remove();
  }, 5000);
}

function safeFileName(name, fallback) {
  return (String(name || '').trim() || fallback).replace(/[\\/:*?"<>|]+/g, '-');
}

function readFileAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
