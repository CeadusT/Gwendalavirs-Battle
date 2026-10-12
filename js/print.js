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
function drawRichCanvasText(ctx, html, { x, startY, maxY, maxWidthAtY, baseStyle, scale = 1.75 }) {
  const basePx = Math.round((baseStyle.fontSize || DEFAULT_TEXT_STYLE.fontSize) * scale);
  const pxOf = style => Math.round((style.fontSize || baseStyle.fontSize || DEFAULT_TEXT_STYLE.fontSize) * scale);
  const fontFor = style => `${style.italic ? 'italic ' : ''}${style.bold ? '800 ' : '400 '}${pxOf(style)}px Roboto, sans-serif`;
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
      y += Math.max(23, Math.round(basePx * 1.3));
      lineWidth = 0;
      linePx = basePx;
      return true;
    }
    const height = Math.max(23, Math.round(linePx * 1.3));
    if (y > maxY) return false;
    let cursor = x;
    for (const token of line) {
      ctx.font = fontFor(token.style);
      ctx.fillStyle = token.style.color || baseStyle.color || DEFAULT_TEXT_COLOR;
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

/* ---------- Dessin d'une carte (630 × 880 px) ---------- */

async function renderCardJpeg(c, lowInk = false) {
  await document.fonts.ready;
  const W = CARD_PX_W;
  const H = CARD_PX_H;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const base = COLORS[c.color]?.hex || '#67717c';
  const isHero = isHeroCard(c);
  const showAttack = !!c.showAttack;
  const showHealth = !!c.showHealth;
  const hasStats = showAttack || showHealth;
  const showCost = c.showSpire !== false;

  // Fond et cadre arrondi
  ctx.fillStyle = '#0c0f12';
  ctx.fillRect(0, 0, W, H);
  roundRect(ctx, 8, 8, W - 16, H - 16, 30);
  ctx.save();
  ctx.clip();

  // Bandeau du titre
  const header = ctx.createLinearGradient(18, 18, W - 18, 118);
  header.addColorStop(0, base);
  header.addColorStop(1, '#14191e');
  ctx.fillStyle = header;
  ctx.fillRect(14, 14, W - 28, 108);
  ctx.strokeStyle = '#e2d4a2';
  ctx.lineWidth = 3;
  ctx.strokeRect(20, 20, W - 40, 96);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '800 32px Roboto, sans-serif';
  const titleLeft = showCost ? 116 : 40;
  const titleRight = isHero ? 590 : 514;
  const nameLines = wrapText(ctx, c.name, Math.max(220, titleRight - titleLeft), 2);
  nameLines.forEach((text, i) => ctx.fillText(text, (titleLeft + titleRight) / 2, 64 + (i - (nameLines.length - 1) / 2) * 34));

  // Coût en Volonté
  if (showCost) {
    ctx.fillStyle = '#121820';
    ctx.strokeStyle = '#e2d4a2';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(67, 68, 39, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = '900 35px Roboto, sans-serif';
    ctx.fillText(String(c.spire), 67, 64);
    ctx.fillStyle = '#e8d9a5';
    ctx.font = '900 10px Roboto, sans-serif';
    ctx.fillText('VOLONTÉ', 67, 91);
  }

  // Élément (pas sur les Héros)
  if (!isHero) {
    ctx.fillStyle = base;
    ctx.strokeStyle = '#eef2f4';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(W - 67, 62, 41, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 25px Roboto, sans-serif';
    ctx.fillText(COLORS[c.color]?.glyph || FALLBACK_ICON, W - 67, 53);
    ctx.fillStyle = '#0b0e11';
    roundRect(ctx, W - 111, 79, 88, 22, 5);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '900 12px Roboto, sans-serif';
    ctx.fillText(elementName(c), W - 67, 90);
  }

  // Illustration (recadrée pour remplir la zone)
  const art = { x: 24, y: 126, w: W - 48, h: 426 };
  ctx.save();
  ctx.beginPath();
  ctx.rect(art.x, art.y, art.w, art.h);
  ctx.clip();
  const img = await loadImage(c.image);
  if (img) {
    const scale = Math.max(art.w / img.width, art.h / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    ctx.drawImage(img, art.x + (art.w - dw) / 2, art.y + (art.h - dh) / 2, dw, dh);
  } else {
    const fill = ctx.createLinearGradient(art.x, art.y, art.x + art.w, art.y + art.h);
    fill.addColorStop(0, base);
    fill.addColorStop(1, '#121820');
    ctx.fillStyle = fill;
    ctx.fillRect(art.x, art.y, art.w, art.h);
  }
  ctx.restore();
  ctx.strokeStyle = '#e2d4a2';
  ctx.lineWidth = 4;
  ctx.strokeRect(art.x, art.y, art.w, art.h);

  // Ruban Type · Sous-type
  const ribbonY = 552;
  const fontOf = st => `${st.italic ? 'italic ' : ''}${st.bold ? '900 ' : '500 '}${Math.round(st.fontSize * 1.65)}px Roboto, sans-serif`;
  ctx.fillStyle = '#e7e3d7';
  ctx.fillRect(22, ribbonY, W - 44, 54);
  ctx.strokeStyle = base;
  ctx.lineWidth = 5;
  ctx.strokeRect(22, ribbonY, W - 44, 54);
  ctx.fillStyle = '#172027';
  ctx.textAlign = 'left';
  ctx.font = fontOf(normalizeFontStyle(c.typeStyle, DEFAULT_TYPE_STYLE));
  const typeText = `${TYPE_ICONS[c.type] || FALLBACK_ICON}  ${String(c.type).toUpperCase()}`;
  ctx.fillText(typeText, 40, ribbonY + 28);
  if (c.subtype) {
    const subtypeX = 40 + ctx.measureText(typeText).width;
    ctx.font = fontOf(normalizeFontStyle(c.subtypeStyle, DEFAULT_SUBTYPE_STYLE));
    ctx.fillText(` · ${c.subtype}`, subtypeX, ribbonY + 28);
  }

  // Texte de règles
  ctx.fillStyle = '#e3dfd3';
  ctx.fillRect(22, 606, W - 44, H - 628);
  const ts = normalizeFontStyle(c.textStyle, DEFAULT_TEXT_STYLE);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  drawRichCanvasText(ctx, c.text || '', {
    x: 44,
    startY: 646,
    maxY: 815,
    maxWidthAtY: y => (hasStats && y >= 758 ? (showAttack && showHealth ? 270 : 414) : 542),
    baseStyle: { ...ts, color: DEFAULT_TEXT_COLOR },
  });

  // Badges ATK / PV
  if (hasStats) {
    ctx.textBaseline = 'middle';
    ctx.font = '900 33px Roboto, sans-serif';
    let statX = showAttack && showHealth ? W - 292 : W - 158;
    const badge = (label, border) => {
      ctx.fillStyle = '#11161bea';
      roundRect(ctx, statX, 770, 122, 59, 25);
      ctx.fill();
      ctx.strokeStyle = border;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.fillText(label, statX + 22, 801);
      statX += 134;
    };
    if (showAttack) badge(`⚔ ${Math.max(0, Number(c.attack) || 0)}`, '#d5a84f');
    if (showHealth) badge(`♥ ${Math.max(0, Number(c.health) || 0)}`, '#d96464');
  }

  // Pied de carte
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#34383b';
  ctx.font = '700 13px Roboto, sans-serif';
  ctx.fillText(c.set || SETS[0], 42, 846);
  ctx.textAlign = 'right';
  ctx.fillText("Gwendalavir's Battle", W - 42, 846);
  ctx.restore();
  ctx.strokeStyle = '#46505a';
  ctx.lineWidth = 8;
  roundRect(ctx, 8, 8, W - 16, H - 16, 30);
  ctx.stroke();

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

const TTS_MAX_CARDS_PER_SHEET = 70;   // limite de TTS : 10 colonnes × 7 lignes

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

async function buildTtsSheet(cardCopies) {
  const CELL_W = 252;
  const CELL_H = 352;
  const cols = Math.min(10, cardCopies.length);
  const rows = Math.ceil(cardCopies.length / cols);
  const canvas = document.createElement('canvas');
  canvas.width = cols * CELL_W;
  canvas.height = rows * CELL_H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#111318';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const rendered = new Map();
  for (const [i, card] of cardCopies.entries()) {
    flash(`Préparation TTS ${i + 1}/${cardCopies.length}…`);
    if (!rendered.has(card.id)) rendered.set(card.id, await jpegBytesToImage(await renderCardJpeg(card)));
    ctx.drawImage(rendered.get(card.id), (i % cols) * CELL_W, Math.floor(i / cols) * CELL_H, CELL_W, CELL_H);
  }
  return { bytes: await canvasPngBytes(canvas), cols, rows, count: cardCopies.length };
}

function buildTtsBack() {
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
  return canvasPngBytes(canvas);
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
      const manifest = { format: 'gwendalavirs-battle-tts', version: 1, deckName, sheets: [] };
      for (let i = 0; i < copies.length; i += TTS_MAX_CARDS_PER_SHEET) {
        const group = copies.slice(i, i + TTS_MAX_CARDS_PER_SHEET);
        const sheet = await buildTtsSheet(group);
        const file = `faces-${manifest.sheets.length + 1}.png`;
        files.push({ name: file, bytes: sheet.bytes });
        manifest.sheets.push({ file, width: sheet.cols, height: sheet.rows, number: sheet.count, cards: group.map(c => ({ id: c.id, name: c.name })) });
      }
      files.push({ name: 'dos.png', bytes: await buildTtsBack() });
      const instructions = [
        "GWENDALAVIR'S BATTLE — EXPORT TABLETOP SIMULATOR",
        '',
        '1. Décompresse cette archive.',
        '2. Dans TTS : Objects > Components > Custom > Deck.',
        '3. Pour chaque planche faces-X.png, choisis-la dans Face et choisis dos.png dans Back.',
        '4. Renseigne Width, Height et Number avec les valeurs ci-dessous.',
        '5. Active « Back is Hidden ».',
        "6. Choisis « Cloud » lors de l'import si les autres joueurs doivent voir les cartes.",
        '',
        ...manifest.sheets.map((s, i) => `Planche ${i + 1} : Width ${s.width} · Height ${s.height} · Number ${s.number}`),
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
document.addEventListener('click', e => {
  if (exportDropdown.open && !exportDropdown.contains(e.target)) closeExportMenu();
});
