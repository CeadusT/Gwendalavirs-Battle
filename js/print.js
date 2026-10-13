'use strict';
/* ==========================================================================
   Impression : dessin d'une carte sur canvas, export PDF (A4, 3 × 3 cartes
   de 63 × 88 mm) et pack Tabletop Simulator (planches PNG + dos, en ZIP).
   ========================================================================== */

const CARD_PX_W = 630;
const CARD_PX_H = 880;

function loadImage(url) {
  return new Promise(resolve => {
    if (!url) {
      resolve(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/* Découpe un texte simple en lignes (… si ça dépasse maxLines). */
function wrapText(ctx, text, maxWidth, maxLines) {
  const lines = [];
  let truncated = false;
  for (const paragraph of String(text || '').replace(/\r/g, '').split('\n')) {
    if (lines.length >= maxLines) {
      truncated = true;
      break;
    }
    if (!paragraph.trim()) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const word of paragraph.trim().split(/\s+/)) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = word;
        if (lines.length >= maxLines) {
          truncated = true;
          break;
        }
      } else {
        line = test;
      }
    }
    if (lines.length < maxLines && line) lines.push(line);
  }
  if (truncated && lines.length) {
    let last = lines[lines.length - 1];
    while (ctx.measureText(`${last}…`).width > maxWidth && last.length > 1) last = last.slice(0, -1);
    lines[lines.length - 1] = `${last}…`;
  }
  return lines.slice(0, maxLines);
}

/* ---------- Texte riche sur canvas ---------- */

/* Transforme le texte riche en suite de mots stylés ({ text, style }) et de retours ({ break }). */
function richCanvasTokens(html, baseStyle) {
  const tokens = [];
  const pushText = (value, style) => {
    for (const part of String(value || '').replace(/ /g, ' ').split(/(\s+)/)) {
      if (!part) continue;
      if (/[\r\n]/.test(part)) {
        part.split(/\r?\n/).forEach((piece, index, all) => {
          if (piece) tokens.push({ text: /^\s+$/.test(piece) ? ' ' : piece, style: { ...style } });
          if (index < all.length - 1) tokens.push({ break: true });
        });
      } else {
        tokens.push({ text: /^\s+$/.test(part) ? ' ' : part, style: { ...style } });
      }
    }
  };
  const walk = (node, style) => {
    if (node.nodeType === Node.TEXT_NODE) {
      pushText(node.nodeValue, style);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.tagName === 'BR') {
      tokens.push({ break: true });
      return;
    }
    const next = { ...style };
    if (node.matches('b,strong')) next.bold = true;
    if (node.matches('i,em')) next.italic = true;
    if (node.matches('u')) next.underline = true;
    if (node.tagName === 'SPAN') {
      const size = Number.parseFloat(node.style.fontSize);
      const color = safeCssColor(node.style.color);
      if (size >= RICH_TEXT_MIN_PX && size <= RICH_TEXT_MAX_PX) next.fontSize = size;
      if (color) next.color = color;
    }
    node.childNodes.forEach(child => walk(child, next));
  };
  parseInertHtml(sanitizeRichText(html)).childNodes.forEach(node => walk(node, { ...baseStyle }));
  return tokens;
}

/* Dessine le texte mot par mot avec retour à la ligne automatique.
   maxWidthAtY permet de rétrécir les lignes à côté des badges ATK / PV. */
function drawRichCanvasText(ctx, html, { x, startY, maxY, maxWidthAtY, baseStyle, scale = 2, family = CARD_THEME.fontText, lineHeight = 1.36, mapColor = color => color, boldColor = null }) {
  const basePx = Math.round((baseStyle.fontSize || DEFAULT_TEXT_STYLE.fontSize) * scale);
  const pxOf = style => Math.round((style.fontSize || baseStyle.fontSize || DEFAULT_TEXT_STYLE.fontSize) * scale);
  const fontFor = style => `${style.italic ? 'italic ' : ''}${style.bold ? '700 ' : '400 '}${pxOf(style)}px ${family}`;
  const widthOf = token => {
    ctx.font = fontFor(token.style);
    return ctx.measureText(token.text).width;
  };
  let y = startY;
  let line = [];
  let lineWidth = 0;
  let linePx = basePx;

  const drawLine = () => {
    while (line.length && line[line.length - 1].text === ' ') line.pop();
    if (!line.length) {
      y += Math.round(basePx * lineHeight);
      lineWidth = 0;
      linePx = basePx;
      return true;
    }
    const height = Math.round(linePx * lineHeight);
    if (y > maxY) return false;
    let cursor = x;
    for (const token of line) {
      ctx.font = fontFor(token.style);
      ctx.fillStyle = mapColor(token.style.color || (token.style.bold && boldColor) || baseStyle.color || DEFAULT_TEXT_COLOR);
      ctx.fillText(token.text, cursor, y);
      const width = widthOf(token);
      if (token.style.underline && token.text.trim()) ctx.fillRect(cursor, y + 3, width, Math.max(1.2, Math.round(linePx / 18)));
      cursor += width;
    }
    y += height;
    line = [];
    lineWidth = 0;
    linePx = basePx;
    return y <= maxY + height;
  };

  for (const token of richCanvasTokens(html, baseStyle)) {
    if (token.break) {
      if (!drawLine()) break;
      continue;
    }
    if (token.text === ' ' && !line.length) continue;
    const width = widthOf(token);
    if (token.text !== ' ' && line.length && lineWidth + width > maxWidthAtY(y)) {
      if (!drawLine()) break;
    }
    if (y > maxY) break;
    if (token.text === ' ' && !line.length) continue;
    line.push(token);
    lineWidth += width;
    linePx = Math.max(linePx, pxOf(token.style));
  }
  if (line.length && y <= maxY) drawLine();
}

/* ---------- Dessin d'une carte (630 × 880 px) ----------
   Reproduit le rendu HTML de la charte (css/styles.css, section Cartes) au double de la
   carte de référence de 315 × 440 px : 1 em de la carte = 32 px ici. */

const CARD_FONTS = ["600 32px 'Cinzel'", "700 32px 'Cinzel'", "400 26px 'Alegreya'", "700 26px 'Alegreya'", "italic 400 26px 'Alegreya'", "italic 700 26px 'Alegreya'", "500 22px 'Alegreya Sans SC'", "700 22px 'Alegreya Sans SC'"];
let cardFontsReady = null;
function loadCardFonts() {
  cardFontsReady ??= Promise.all(CARD_FONTS.map(font => document.fonts.load(font).catch(() => null)));
  return cardFontsReady;
}

const EM = 32;   // 1 em de la carte en pixels du rendu

function strokeIcon(ctx, d, cx, cy, size, color, width = 1.8) {
  ctx.save();
  ctx.translate(cx - size / 2, cy - size / 2);
  ctx.scale(size / 24, size / 24);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke(new Path2D(d));
  ctx.restore();
}

function fillIcon(ctx, d, cx, cy, size, color) {
  ctx.save();
  ctx.translate(cx - size / 2, cy - size / 2);
  ctx.scale(size / 24, size / 24);
  ctx.fillStyle = color;
  ctx.fill(new Path2D(d));
  ctx.restore();
}

const ATTACK_ICON = 'M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2';
const HEALTH_ICON = 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z';

/* Illustration (recadrée pour couvrir la zone) ou paysage de remplacement. */
async function drawArt(ctx, c, pal, area, placeholderHeight = area.h) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(area.x, area.y, area.w, area.h);
  ctx.clip();
  const img = await loadImage(c.image);
  if (img) {
    const scale = Math.max(area.w / img.width, area.h / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    ctx.drawImage(img, area.x + (area.w - dw) / 2, area.y + (area.h - dh) / 2, dw, dh);
  } else {
    const sky = ctx.createLinearGradient(0, area.y, 0, area.y + placeholderHeight);
    sky.addColorStop(0, pal.skyTop);
    sky.addColorStop(0.78, pal.skyBottom);
    ctx.fillStyle = sky;
    ctx.fillRect(area.x, area.y, area.w, area.h);
    // Même paysage que le SVG de cardMarkup() (viewBox 300 × 250, ancré en bas, recadré).
    const scale = Math.max(area.w / 300, placeholderHeight / 250);
    const ox = area.x + (area.w - 300 * scale) / 2;
    const oy = area.y + placeholderHeight - 250 * scale;
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = pal.sun;
    ctx.beginPath();
    ctx.arc(214, 92, 24, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    [pal.hillFar, pal.hillMid, pal.hillNear].forEach((color, i) => {
      ctx.fillStyle = color;
      ctx.fill(new Path2D(PLACEHOLDER_HILLS[i]));
    });
    if (placeholderHeight < area.h) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = pal.hillNear;
      ctx.fillRect(area.x, area.y + placeholderHeight - 1, area.w, area.h - placeholderHeight + 1);
    }
  }
  ctx.restore();
}

/* Dégradé irisé des Dessins légendaires, de gauche à droite. */
function prismGradient(ctx, x0, x1, fadeEnd = false) {
  const g = ctx.createLinearGradient(x0, 0, x1, 0);
  ['#ffb3d9', '#c7b3ff', '#9fe0ff', '#a8f5c8', '#fff0a0'].forEach((col, i) => g.addColorStop(i / 5, col));
  g.addColorStop(1, fadeEnd ? 'rgba(255,195,160,0)' : '#ffc3a0');
  return g;
}

function drawCost(ctx, c, cx, cy, full) {
  const r = 1.125 * EM;   // diamètre 2,25 em
  ctx.beginPath();
  if (cardKind(c) === 'drawing') {
    // Dessin : losange d'encre bleue.
    const d = 1.38 * EM;
    ctx.moveTo(cx, cy - d);
    ctx.lineTo(cx + d, cy);
    ctx.lineTo(cx, cy + d);
    ctx.lineTo(cx - d, cy);
    ctx.closePath();
    if (full) {
      ctx.fillStyle = 'rgba(10,20,32,.65)';
    } else {
      const g = ctx.createRadialGradient(cx - d * 0.3, cy - d * 0.4, 1, cx, cy, d);
      g.addColorStop(0, '#34506e');
      g.addColorStop(0.75, '#0f1a28');
      ctx.fillStyle = g;
    }
    ctx.fill();
    ctx.lineWidth = full ? 3 : 4;
    ctx.strokeStyle = full ? '#cfe0f1' : '#a9c3dd';
    ctx.stroke();
    ctx.fillStyle = '#f3f7fb';
    ctx.font = `700 ${1.125 * EM}px ${CARD_THEME.fontTitle}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(c.spire), cx, cy + 2);
    return;
  }
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  if (full) {
    ctx.fillStyle = 'rgba(10,9,7,.6)';
  } else {
    const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.4, 1, cx, cy, r);
    g.addColorStop(0, '#3a3127');
    g.addColorStop(0.75, '#120f0b');
    ctx.fillStyle = g;
  }
  ctx.fill();
  ctx.lineWidth = full ? 3 : 4;
  ctx.strokeStyle = full ? CARD_THEME.goldLight : CARD_THEME.gold;
  ctx.stroke();
  ctx.fillStyle = full ? '#fbf3df' : '#f3e6c4';
  ctx.font = `700 ${1.125 * EM}px ${CARD_THEME.fontTitle}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(c.spire), cx, cy + 2);
}

function drawName(ctx, c, left, right, cy, full) {
  const size = Number(nameSizeEm(c.name, full)) * EM;
  ctx.font = `600 ${size}px ${CARD_THEME.fontTitle}`;
  if (cardKind(c) === 'legend') {
    const g = ctx.createLinearGradient(left, 0, right, 0);
    ['#fff6d6', '#ffd1e8', '#c9e8ff', '#fff6d6'].forEach((col, i) => g.addColorStop(i / 3, col));
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = full ? '#fbf3df' : '#f6ecd2';
  }
  ctx.textBaseline = 'middle';
  ctx.textAlign = full ? 'left' : 'center';
  ctx.shadowColor = 'rgba(0,0,0,.85)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 2;
  const lines = wrapText(ctx, c.name, right - left, 2);
  const lineH = size * 1.12;
  lines.forEach((line, i) => ctx.fillText(line, full ? left : (left + right) / 2, cy + (i - (lines.length - 1) / 2) * lineH));
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

/* Ligne de Type : « TYPE · Sous-type » en petites capitales, puis la rareté. */
function drawTypeLine(ctx, c, x, cy, right, colors, full) {
  const typeSt = normalizeFontStyle(c.typeStyle, DEFAULT_TYPE_STYLE);
  const subSt = normalizeFontStyle(c.subtypeStyle, DEFAULT_SUBTYPE_STYLE);
  const kind = cardKind(c);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  let start = x;
  if (kind === 'drawing') {
    const q = typeSt.fontSize * 2 * 1.1;
    strokeIcon(ctx, QUILL_ICON, x + q / 2, cy, q, colors.type, 2.2);
    start = x + q + 8;
  }
  ctx.letterSpacing = '1.5px';
  ctx.font = `${typeSt.italic ? 'italic ' : ''}${typeSt.bold ? 700 : 500} ${typeSt.fontSize * 2}px ${CARD_THEME.fontCaps}`;
  const typeW = ctx.measureText(c.type).width;
  ctx.fillStyle = kind === 'legend' && full ? prismGradient(ctx, start, start + typeW) : colors.type;
  ctx.fillText(c.type, start, cy);
  let cursor = start + typeW;
  if (c.subtype) {
    ctx.font = `${subSt.italic ? 'italic ' : ''}${subSt.bold ? 700 : 500} ${subSt.fontSize * 2}px ${CARD_THEME.fontCaps}`;
    ctx.fillStyle = colors.subtype;
    const sub = ` · ${c.subtype}`;
    ctx.fillText(sub, cursor, cy);
    cursor += ctx.measureText(sub).width;
  }
  ctx.letterSpacing = '0px';
  const d = 9;   // losange de rareté
  const rx = right - d;
  if (full && cursor + 16 < rx - d - 8) {
    let line;
    if (kind === 'legend') {
      line = prismGradient(ctx, cursor + 12, rx - d - 8, true);
    } else {
      line = ctx.createLinearGradient(cursor + 12, 0, rx - d - 8, 0);
      line.addColorStop(0, colors.subtype);
      line.addColorStop(1, 'rgba(255,255,255,0)');
    }
    ctx.fillStyle = line;
    ctx.fillRect(cursor + 12, cy - 1, rx - d - 8 - cursor - 12, 2);
  }
  ctx.save();
  ctx.translate(rx, cy);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = RARITY_COLORS[c.rarity] || RARITY_COLORS.Commun;
  ctx.fillRect(-d / 1.41, -d / 1.41, d * 1.41, d * 1.41);
  if (!full) {
    ctx.strokeStyle = 'rgba(0,0,0,.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(-d / 1.41, -d / 1.41, d * 1.41, d * 1.41);
  }
  ctx.restore();
}

/* Médaillon ATK | PV, aligné à droite du pied de carte (même tracé que .gw-stats). */
function drawStats(ctx, c, right, cy, full) {
  const parts = [];
  if (c.showAttack) parts.push({ kind: 'attack', label: String(c.attack) });
  if (c.showHealth) parts.push({ kind: 'health', label: String(c.health) });
  if (!parts.length) return 0;
  const fs = 0.8125 * EM;
  const iconSize = fs;
  const iconGap = 0.25 * fs;
  const sepGap = 0.55 * fs;
  const pad = 0.7 * fs;
  const h = 1.846 * fs;
  ctx.font = `700 ${fs}px ${CARD_THEME.fontTitle}`;
  for (const p of parts) p.w = iconSize + iconGap + ctx.measureText(p.label).width;
  const w = pad * 2 + parts.reduce((n, p) => n + p.w, 0) + (parts.length - 1) * (sepGap * 2 + 1);
  const x = right - w;
  roundRect(ctx, x, cy - h / 2, w, h, h / 2);
  ctx.fillStyle = full ? 'rgba(10,9,7,.55)' : '#1a1610';
  ctx.fill();
  ctx.lineWidth = full ? 2 : 3;
  ctx.strokeStyle = full ? 'rgba(232,212,156,.8)' : CARD_THEME.gold;
  ctx.stroke();
  let px = x + pad;
  parts.forEach((p, i) => {
    if (i > 0) {
      px += sepGap;
      ctx.fillStyle = 'rgba(232,212,156,.45)';
      ctx.fillRect(px, cy - h / 2 + 0.35 * fs, 1, h - 0.7 * fs);
      px += 1 + sepGap;
    }
    if (p.kind === 'health') fillIcon(ctx, HEALTH_ICON, px + iconSize / 2, cy, iconSize, '#e07a6e');
    else strokeIcon(ctx, ATTACK_ICON, px + iconSize / 2, cy, iconSize, CARD_THEME.goldLight, 2);
    ctx.fillStyle = full ? '#fbf3df' : '#f6ecd2';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.label, px + iconSize + iconGap, cy + 2);
    px += p.w;
  });
  return w;
}

function drawFooter(ctx, c, left, right, cy, full) {
  const statsW = drawStats(ctx, c, right, cy, full);
  const fs = 0.5625 * EM;
  ctx.font = `500 ${fs}px ${CARD_THEME.fontCaps}`;
  ctx.letterSpacing = '1px';
  ctx.fillStyle = full ? 'rgba(241,232,212,.6)' : '#6d5d45';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const x = left + 0.4 * fs;
  const maxW = right - x - statsW - (statsW ? 0.5 * EM : 0);
  let set = c.set || SETS[0];
  while (ctx.measureText(set).width > maxW && set.length > 4) set = `${set.slice(0, -2)}…`;
  ctx.fillText(set, x, cy);
  ctx.letterSpacing = '0px';
}

async function renderCardJpeg(c, lowInk = false) {
  await loadCardFonts();
  const W = CARD_PX_W;
  const H = CARD_PX_H;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const pal = cardPalette(c);
  const isHero = isHeroCard(c);
  const kind = cardKind(c);
  const showCost = c.showSpire !== false;
  const full = !!c.fullArt;
  const outerRadius = 30;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  roundRect(ctx, 0, 0, W, H, outerRadius);
  ctx.save();
  ctx.clip();

  if (full) {
    await drawArt(ctx, c, pal, { x: 0, y: 0, w: W, h: H }, H * 0.72);
    const top = ctx.createLinearGradient(0, 0, 0, H * 0.21);
    top.addColorStop(0, 'rgba(8,7,5,.78)');
    top.addColorStop(0.57, 'rgba(8,7,5,.35)');
    top.addColorStop(1, 'rgba(8,7,5,0)');
    ctx.fillStyle = top;
    ctx.fillRect(0, 0, W, H * 0.21);
    const bottom = ctx.createLinearGradient(0, H, 0, H * 0.47);
    bottom.addColorStop(0, 'rgba(8,7,5,.94)');
    bottom.addColorStop(0.51, 'rgba(8,7,5,.86)');
    bottom.addColorStop(0.81, 'rgba(8,7,5,.4)');
    bottom.addColorStop(1, 'rgba(8,7,5,0)');
    ctx.fillStyle = bottom;
    ctx.fillRect(0, H * 0.47, W, H * 0.53);
    roundRect(ctx, 14, 14, W - 28, H - 28, 20);
    ctx.lineWidth = 2;
    if (kind === 'legend') {
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(255,255,255,.85)';
    } else {
      ctx.strokeStyle = isHero ? 'rgba(232,212,156,.85)' : 'rgba(232,212,156,.35)';
    }
    ctx.stroke();

    const headY = 0.5 * EM + 1.8125 * EM;
    const padX = EM;
    if (showCost) drawCost(ctx, c, padX + 1.125 * EM, headY, true);
    const nameLeft = padX + (showCost ? 2.25 * EM + 0.5 * EM : 0);
    const nameRight = W - padX - (isHero ? 0 : 2.125 * EM + 0.5 * EM);
    drawName(ctx, c, nameLeft, nameRight, headY, true);
    if (!isHero) {
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,.9)';
      ctx.shadowBlur = 6;
      strokeIcon(ctx, COLORS[c.color]?.icon || COLORS[FALLBACK_COLOR].icon, W - padX - 1.0625 * EM, headY, 1.375 * EM, pal.light);
      ctx.restore();
    }

    const rulesX = 1.125 * EM;
    const rulesTop = H - 2.75 * EM - 9.375 * EM;
    const typeY = rulesTop + 0.45 * EM;
    const fullTypeColor = kind === 'drawing' ? '#cfe0f1' : pal.light;
    drawTypeLine(ctx, c, rulesX, typeY, W - rulesX, { type: fullTypeColor, subtype: pal.light }, true);
    const ts = normalizeFontStyle(c.textStyle, DEFAULT_TEXT_STYLE);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = 'rgba(0,0,0,.6)';
    ctx.shadowBlur = 3;
    const isDark = color => /^(#202428|rgb\(32, ?36, ?40\))$/i.test(String(color).trim());
    drawRichCanvasText(ctx, c.text || '', {
      x: rulesX,
      startY: typeY + 0.5 * EM + ts.fontSize * 2,
      maxY: H - 2.75 * EM - 6,
      maxWidthAtY: () => W - 2 * rulesX,
      baseStyle: { ...ts, color: '#f1e8d4' },
      mapColor: color => (isDark(color) ? '#f1e8d4' : color),
      boldColor: CARD_THEME.goldLight,
    });
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    drawFooter(ctx, c, EM, W - EM, H - 0.875 * EM - 0.8125 * EM, true);
  } else {
    // Cadre : encre (ou or pour un Héros), puis corps arrondi avec filet d'or.
    if (isHero) {
      const gold = ctx.createLinearGradient(0, 0, W, H);
      gold.addColorStop(0, '#e8d49c');
      gold.addColorStop(0.55, '#8a6a2f');
      gold.addColorStop(1, '#c9a45c');
      ctx.fillStyle = gold;
    } else if (kind === 'legend') {
      const prism = ctx.createConicGradient((210 - 90) * Math.PI / 180, W / 2, H / 2);
      ['#ffd1e8', '#c9b6ff', '#a8e6ff', '#b8ffd9', '#fff2a8', '#ffc9a8', '#ffd1e8'].forEach((col, i) => prism.addColorStop(i / 6, col));
      ctx.fillStyle = prism;
    } else {
      ctx.fillStyle = CARD_THEME.ink;
    }
    ctx.fillRect(0, 0, W, H);
    const inset = 14;
    const bx = inset;
    const by = inset;
    const bw = W - 2 * inset;
    const bh = H - 2 * inset;
    roundRect(ctx, bx, by, bw, bh, 20);
    ctx.save();
    ctx.clip();
    ctx.fillStyle = CARD_THEME.parchment;
    ctx.fillRect(bx, by, bw, bh);

    const artH = 15.5 * EM;
    await drawArt(ctx, c, pal, { x: bx, y: by, w: bw, h: artH });
    const head = ctx.createLinearGradient(0, by, 0, by + 3.625 * EM);
    head.addColorStop(0, 'rgba(13,11,8,.92)');
    head.addColorStop(0.62, 'rgba(13,11,8,.72)');
    head.addColorStop(1, 'rgba(13,11,8,0)');
    ctx.fillStyle = head;
    ctx.fillRect(bx, by, bw, 3.625 * EM);

    const headY = by + 1.8125 * EM;
    const padX = 0.5625 * EM;
    if (showCost) drawCost(ctx, c, bx + padX + 1.125 * EM, headY, false);
    const nameLeft = bx + padX + (showCost ? 2.25 * EM : 0) + 0.5 * EM;
    const nameRight = bx + bw - padX - (isHero ? 0 : 2.125 * EM) - 0.5 * EM;
    drawName(ctx, c, nameLeft, nameRight, headY, false);
    if (!isHero) {
      const ex = bx + bw - padX - 1.0625 * EM;
      ctx.beginPath();
      ctx.arc(ex, headY, 1.0625 * EM, 0, Math.PI * 2);
      ctx.fillStyle = pal.el;
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#e9d9a8';
      ctx.stroke();
      strokeIcon(ctx, COLORS[c.color]?.icon || COLORS[FALLBACK_COLOR].icon, ex, headY, 1.125 * EM, '#fffaf0');
    }

    // Ligne de Type
    const typeTop = by + artH;
    const typeH = 1.625 * EM;
    let typeColors = { type: '#2a2117', subtype: '#5a4a35' };
    let typeInset = 0;
    if (kind === 'legend') {
      // Plaque d'encre sertie d'un liseré irisé, sur le parchemin.
      ctx.fillStyle = pal.tint;
      ctx.fillRect(bx, typeTop, bw, typeH);
      typeInset = 0.35 * EM;
      const px = bx + typeInset;
      const pw = bw - 2 * typeInset;
      const py = typeTop + 0.1 * EM;
      const ph = typeH - 0.2 * EM;
      roundRect(ctx, px, py, pw, ph, 0.4 * EM);
      ctx.fillStyle = prismGradient(ctx, px, px + pw);
      ctx.fill();
      const b = 0.13 * EM;
      roundRect(ctx, px + b, py + b, pw - 2 * b, ph - 2 * b, 0.4 * EM - b);
      const ink = ctx.createLinearGradient(0, py, 0, py + ph);
      ink.addColorStop(0, '#2e2540');
      ink.addColorStop(1, '#1b1626');
      ctx.fillStyle = ink;
      ctx.fill();
      typeColors = { type: '#fff6e6', subtype: '#d9cfff' };
    } else if (kind === 'drawing') {
      const band = ctx.createLinearGradient(bx, 0, bx + bw, 0);
      band.addColorStop(0, '#1d2c3d');
      band.addColorStop(0.6, '#2c4259');
      band.addColorStop(1, '#3a5672');
      ctx.fillStyle = band;
      ctx.fillRect(bx, typeTop, bw, typeH);
      ctx.fillStyle = '#a9c3dd';
      ctx.fillRect(bx, typeTop, bw, 4);
      ctx.fillStyle = '#b89a5e';
      ctx.fillRect(bx, typeTop + typeH - 2, bw, 2);
      typeColors = { type: '#e6eef7', subtype: '#b9cde0' };
    } else {
      ctx.fillStyle = pal.tint;
      ctx.fillRect(bx, typeTop, bw, typeH);
      ctx.fillStyle = pal.el;
      ctx.fillRect(bx, typeTop, bw, 4);
      ctx.fillStyle = '#b89a5e';
      ctx.fillRect(bx, typeTop + typeH - 2, bw, 2);
    }
    drawTypeLine(ctx, c, bx + 0.75 * EM + typeInset * 0.6, typeTop + typeH / 2 + 1, bx + bw - 0.75 * EM - typeInset * 0.6, typeColors, false);

    // Texte et pied
    const footH = 2 * EM;
    const textTop = typeTop + typeH;
    const footTop = by + bh - footH;
    const textBg = ctx.createLinearGradient(0, textTop, 0, footTop);
    textBg.addColorStop(0, '#f2eadb');
    textBg.addColorStop(1, '#e8ddc5');
    ctx.fillStyle = textBg;
    ctx.fillRect(bx, textTop, bw, footTop - textTop);
    ctx.fillStyle = CARD_THEME.parchmentShade;
    ctx.fillRect(bx, footTop, bw, footH);
    const ts = normalizeFontStyle(c.textStyle, DEFAULT_TEXT_STYLE);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    drawRichCanvasText(ctx, c.text || '', {
      x: bx + 0.94 * EM,
      startY: textTop + 0.625 * EM + ts.fontSize * 2,
      maxY: footTop - 8,
      maxWidthAtY: () => bw - 2 * 0.94 * EM,
      baseStyle: { ...ts, color: CARD_THEME.text },
    });
    drawFooter(ctx, c, bx + 0.5 * EM, bx + bw - 0.5 * EM, footTop + (footH - 0.25 * EM) / 2, false);
    ctx.restore();
    roundRect(ctx, bx + 1, by + 1, bw - 2, bh - 2, 20);
    ctx.lineWidth = 2;
    ctx.strokeStyle = isHero ? '#fff3cf' : kind === 'legend' ? '#ffffff' : CARD_THEME.gold;
    ctx.stroke();
  }
  ctx.restore();

  // Version « Low conso » : désaturée et éclaircie pour économiser l'encre.
  if (lowInk) {
    ctx.save();
    ctx.globalCompositeOperation = 'saturation';
    ctx.fillStyle = '#777';
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = 'rgba(255,255,255,.42)';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
  return dataUrlToBytes(canvas.toDataURL('image/jpeg', lowInk ? 0.78 : 0.93));
}

/* ---------- Octets ---------- */

function dataUrlToBytes(dataUrl) {
  const binary = atob(dataUrl.split(',')[1]);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

const textBytes = s => new TextEncoder().encode(s);

function concatBytes(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let pos = 0;
  for (const part of parts) {
    out.set(part, pos);
    pos += part.length;
  }
  return out;
}

/* ---------- PDF ---------- */

const MM_TO_PT = 72 / 25.4;

/* Construit un PDF A4 « à la main » : chaque carte différente est une image JPEG
   (dessinée une seule fois), posée jusqu'à 9 fois par page sans marge entre les cartes. */
async function buildDeckPdf(cardCopies, lowInk) {
  const PAGE_W = 595.276;
  const PAGE_H = 841.89;
  const CARD_W = 63 * MM_TO_PT;
  const CARD_H = 88 * MM_TO_PT;
  const startX = (PAGE_W - 3 * CARD_W) / 2;
  const startY = (PAGE_H - 3 * CARD_H) / 2;

  const objects = [];
  const reserve = () => objects.push(null);   // renvoie le numéro (1, 2, …) de l'objet réservé
  const setObject = (n, bytes) => { objects[n - 1] = bytes; };
  const catalog = reserve();
  const pages = reserve();

  const unique = [...new Map(cardCopies.map(c => [c.id, c])).values()];
  const imageRefs = new Map();
  for (const [index, c] of unique.entries()) {
    flash(`Préparation PDF ${index + 1}/${unique.length}…`);
    const jpg = await renderCardJpeg(c, lowInk);
    const n = reserve();
    setObject(n, concatBytes([
      textBytes(`<< /Type /XObject /Subtype /Image /Width ${CARD_PX_W} /Height ${CARD_PX_H} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`),
      jpg,
      textBytes('\nendstream'),
    ]));
    imageRefs.set(c.id, n);
  }

  const pageRefs = [];
  for (let p = 0; p < cardCopies.length; p += 9) {
    const contentNum = reserve();
    const pageNum = reserve();
    pageRefs.push(pageNum);
    let content = '';
    const xobjects = [];
    cardCopies.slice(p, p + 9).forEach((c, i) => {
      const x = startX + (i % 3) * CARD_W;
      const y = PAGE_H - startY - (Math.floor(i / 3) + 1) * CARD_H;
      content += `q ${CARD_W.toFixed(3)} 0 0 ${CARD_H.toFixed(3)} ${x.toFixed(3)} ${y.toFixed(3)} cm /Im${i} Do Q\n`;
      xobjects.push(`/Im${i} ${imageRefs.get(c.id)} 0 R`);
    });
    setObject(contentNum, textBytes(`<< /Length ${content.length} >>\nstream\n${content}endstream`));
    setObject(pageNum, textBytes(`<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /XObject << ${xobjects.join(' ')} >> >> /Contents ${contentNum} 0 R >>`));
  }
  setObject(pages, textBytes(`<< /Type /Pages /Kids [${pageRefs.map(n => `${n} 0 R`).join(' ')}] /Count ${pageRefs.length} >>`));
  setObject(catalog, textBytes(`<< /Type /Catalog /Pages ${pages} 0 R >>`));

  // Assemblage : en-tête, objets, table des positions (xref), fin de fichier.
  const chunks = [textBytes('%PDF-1.4\n%âãÏÓ\n')];
  const offsets = [];
  let pos = chunks[0].length;
  objects.forEach((bytes, i) => {
    offsets.push(pos);
    const chunk = concatBytes([textBytes(`${i + 1} 0 obj\n`), bytes, textBytes('\nendobj\n')]);
    chunks.push(chunk);
    pos += chunk.length;
  });
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${pos}\n%%EOF`;
  chunks.push(textBytes(xref));
  return concatBytes(chunks);
}

/* Bouton d'export : grisé pendant la création, puis remis dans son état. */
async function runExport(button, busyLabel, task) {
  if (!deckCardCopies().length) {
    flash('Le deck est vide.');
    return;
  }
  const idleLabel = button.textContent;
  button.classList.add('pdfBusy');
  button.textContent = busyLabel;
  try {
    await task(deckCardCopies());
  } finally {
    button.classList.remove('pdfBusy');
    button.textContent = idleLabel;
  }
}

function exportDeckPdf(lowInk) {
  return runExport($(lowInk ? '#exportPdfLow' : '#exportPdf'), 'Création du PDF…', async copies => {
    try {
      const pdf = await buildDeckPdf(copies, lowInk);
      downloadBlob(new Blob([pdf], { type: 'application/pdf' }), `${safeFileName(deckName, 'mon-deck')}${lowInk ? '-low-conso' : ''}.pdf`);
      flash(`${lowInk ? 'PDF Low conso' : 'PDF'} exporté · cartes jointives 63 × 88 mm.`);
    } catch (err) {
      console.error(err);
      flash('Impossible de créer le PDF.');
    }
  });
}

/* ---------- Tabletop Simulator ---------- */

/* Format imposé par TTS pour un deck personnalisé : une planche de 10 colonnes × 7 lignes,
   remplie de gauche à droite et de haut en bas. Les 69 premières cases portent les cartes ;
   la 70e (en bas à droite) est la « carte cachée » montrée aux autres joueurs.
   La grille garde toujours ces dimensions, même si le deck est plus petit : les valeurs à
   saisir dans TTS sont donc toujours Width 10 et Height 7. */
const TTS_COLS = 10;
const TTS_ROWS = 7;
const TTS_MAX_CARDS_PER_SHEET = TTS_COLS * TTS_ROWS - 1;
/* Taille d'une case : proportions d'une carte (63 × 88 mm) et planche ≤ 4096 px,
   la taille maximale que TTS gère sans perte. */
const TTS_CELL_W = 409;
const TTS_CELL_H = 571;

function canvasPngBytes(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob(async blob => (blob ? resolve(new Uint8Array(await blob.arrayBuffer())) : reject(new Error('png'))), 'image/png'));
}

async function jpegBytesToImage(bytes) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
  try {
    return await loadImage(url);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/* Planche de faces au format TTS ; `rendered` évite de redessiner une carte déjà dessinée. */
async function buildTtsSheet(cardCopies, backCanvas, rendered) {
  const canvas = document.createElement('canvas');
  canvas.width = TTS_COLS * TTS_CELL_W;
  canvas.height = TTS_ROWS * TTS_CELL_H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#111318';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const drawCell = (image, index) => ctx.drawImage(image, (index % TTS_COLS) * TTS_CELL_W, Math.floor(index / TTS_COLS) * TTS_CELL_H, TTS_CELL_W, TTS_CELL_H);
  for (const [i, card] of cardCopies.entries()) {
    flash(`Préparation TTS ${i + 1}/${cardCopies.length}…`);
    if (!rendered.has(card.id)) rendered.set(card.id, await jpegBytesToImage(await renderCardJpeg(card)));
    drawCell(rendered.get(card.id), i);
  }
  drawCell(backCanvas, TTS_COLS * TTS_ROWS - 1);   // carte cachée : le dos
  return canvasPngBytes(canvas);
}

function drawTtsBack() {
  const canvas = document.createElement('canvas');
  canvas.width = CARD_PX_W;
  canvas.height = CARD_PX_H;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, CARD_PX_W, CARD_PX_H);
  gradient.addColorStop(0, '#0d1118');
  gradient.addColorStop(0.5, '#213347');
  gradient.addColorStop(1, '#0b0d12');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, CARD_PX_W, CARD_PX_H);
  ctx.strokeStyle = '#c89b49';
  ctx.lineWidth = 12;
  roundRect(ctx, 25, 25, 580, 830, 34);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(226,184,95,.35)';
  ctx.lineWidth = 3;
  roundRect(ctx, 45, 45, 540, 790, 25);
  ctx.stroke();
  ctx.fillStyle = '#d9b461';
  ctx.beginPath();
  ctx.arc(315, 365, 112, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#18202a';
  ctx.font = 'bold 165px Georgia';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('G', 315, 373);
  ctx.fillStyle = '#f0dfb7';
  ctx.font = 'bold 36px Georgia';
  ctx.fillText("GWENDALAVIR'S", 315, 555);
  ctx.font = 'bold 27px Georgia';
  ctx.letterSpacing = '8px';
  ctx.fillText('BATTLE', 315, 605);
  return canvas;
}

/* ZIP sans compression (« stored »), suffisant pour des PNG déjà compressés. */
let crcTable = null;
function crc32(bytes) {
  crcTable ??= Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  let crc = 0xffffffff;
  for (const b of bytes) crc = crcTable[(crc ^ b) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function littleEndianBlock(size, write) {
  const block = new Uint8Array(size);
  write(new DataView(block.buffer));
  return block;
}

function makeZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const name = textBytes(file.name);
    const data = file.bytes instanceof Uint8Array ? file.bytes : new Uint8Array(file.bytes);
    const crc = crc32(data);
    const local = littleEndianBlock(30, v => {
      v.setUint32(0, 0x04034b50, true);
      v.setUint16(4, 20, true);
      v.setUint32(14, crc, true);
      v.setUint32(18, data.length, true);
      v.setUint32(22, data.length, true);
      v.setUint16(26, name.length, true);
    });
    const central = littleEndianBlock(46, v => {
      v.setUint32(0, 0x02014b50, true);
      v.setUint16(4, 20, true);
      v.setUint16(6, 20, true);
      v.setUint32(16, crc, true);
      v.setUint32(20, data.length, true);
      v.setUint32(24, data.length, true);
      v.setUint16(28, name.length, true);
      v.setUint32(42, offset, true);
    });
    locals.push(local, name, data);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const centralSize = centrals.reduce((n, x) => n + x.length, 0);
  const end = littleEndianBlock(22, v => {
    v.setUint32(0, 0x06054b50, true);
    v.setUint16(8, files.length, true);
    v.setUint16(10, files.length, true);
    v.setUint32(12, centralSize, true);
    v.setUint32(16, offset, true);
  });
  return new Blob([...locals, ...centrals, end], { type: 'application/zip' });
}

function exportDeckTts() {
  return runExport($('#exportTts'), 'Création TTS…', async copies => {
    try {
      const files = [];
      const manifest = { format: 'gwendalavirs-battle-tts', version: 2, deckName, sheets: [] };
      const back = drawTtsBack();
      const rendered = new Map();
      for (let i = 0; i < copies.length; i += TTS_MAX_CARDS_PER_SHEET) {
        const group = copies.slice(i, i + TTS_MAX_CARDS_PER_SHEET);
        const file = `faces-${manifest.sheets.length + 1}.png`;
        files.push({ name: file, bytes: await buildTtsSheet(group, back, rendered) });
        manifest.sheets.push({ file, width: TTS_COLS, height: TTS_ROWS, number: group.length, cards: group.map(c => ({ id: c.id, name: c.name })) });
      }
      files.push({ name: 'dos.png', bytes: await canvasPngBytes(back) });
      const instructions = [
        "GWENDALAVIR'S BATTLE — EXPORT TABLETOP SIMULATOR",
        '',
        '1. Décompresse cette archive.',
        '2. Dans TTS : Objects > Components > Custom > Deck.',
        '3. Face : choisis faces-1.png. Back : choisis dos.png.',
        `4. Width : ${TTS_COLS} · Height : ${TTS_ROWS} (toujours ces valeurs) · Number : voir ci-dessous.`,
        '5. Active « Back is Hidden ».',
        "6. Choisis « Cloud » lors de l'import si les autres joueurs doivent voir les cartes.",
        '7. Plus de 69 cartes ? Recommence pour chaque planche suivante (faces-2.png, …).',
        '',
        ...manifest.sheets.map((s, i) => `Planche ${i + 1} (${s.file}) : Width ${s.width} · Height ${s.height} · Number ${s.number}`),
        '',
      ].join('\n');
      files.push({ name: 'LISEZ-MOI.txt', bytes: textBytes(instructions) });
      files.push({ name: 'manifest.json', bytes: textBytes(JSON.stringify(manifest, null, 2)) });
      downloadBlob(makeZip(files), `${safeFileName(deckName, 'mon-deck')}-TTS.zip`);
      flash('Pack TTS exporté. Décompresse-le avant l’import.');
    } catch (err) {
      console.error(err);
      flash('Impossible de créer le pack TTS.');
    }
  });
}

/* ---------- Menu « Exporter » ---------- */

const exportDropdown = $('#exportDropdown');
const closeExportMenu = () => exportDropdown.removeAttribute('open');

$('#exportPdf').onclick = () => {
  closeExportMenu();
  exportDeckPdf(false);
};
$('#exportPdfLow').onclick = () => {
  closeExportMenu();
  exportDeckPdf(true);
};
$('#exportTts').onclick = () => {
  closeExportMenu();
  exportDeckTts();
};
$('#exportGame').onclick = () => {
  closeExportMenu();
  exportDeckForGame();
};
document.addEventListener('click', e => {
  if (exportDropdown.open && !exportDropdown.contains(e.target)) closeExportMenu();
});
