export const defaults = { width: 50, height: 30, margin: 3, padding: 1, font: 2, lineHeight: 2, dpi: 203 };

export const mmToPx = (mm, dpi) => Math.round(mm * dpi / 25.4);

export function spotifyUri(value) {
  const v = value.trim();
  if (/^spotify:album:[a-zA-Z0-9]{22}$/.test(v)) return v;
  try {
    const url = new URL(v);
    const match = url.pathname.match(/^\/(?:intl-[a-z]{2}\/)?album\/([a-zA-Z0-9]{22})\/?$/);
    if (url.hostname === 'open.spotify.com' && match) return `spotify:album:${match[1]}`;
  } catch { /* Input may be empty or a URI. */ }
  return null;
}

export function geometry(s) {
  for (const key of Object.keys(defaults)) {
    if (!Number.isFinite(s[key]) || s[key] <= 0) throw new Error('Dimensions must be positive numbers.');
  }
  if (s.width > 150 || s.height > 200 || s.dpi < 100 || s.dpi > 600) throw new Error('Maximum size: 150 × 200 mm. Resolution: 100–600 dpi.');
  const w = s.width - 2 * s.margin, h = s.height - 2 * s.margin;
  const column = Math.max(10, w * 0.25);
  const row = Math.max(s.font + s.lineHeight + 2 * s.padding, h * 0.25);
  const codeHeight = h - 2 * row;
  if (w - column - 2 * s.padding < s.font * 2 || codeHeight < 2 * s.padding + 3) {
    throw new Error('The layout does not fit. Increase the label size or reduce the spacing and font size.');
  }
  return { w, h, column, row, codeHeight };
}

export function wrapText(text, maxWidth, measure) {
  const lines = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate) <= maxWidth) { line = candidate; continue; }
      if (line) { lines.push(line); line = ''; }
      // Even a single long word is wrapped; no silent clipping or font shrinking.
      for (const char of word) {
        if (line && measure(line + char) > maxWidth) { lines.push(line); line = ''; }
        line += char;
      }
    }
    lines.push(line);
  }
  return lines;
}

export function drawLabel(canvas, s, artist, album, codeImage = null, unavailable = false) {
  const g = geometry(s), scale = s.dpi / 25.4;
  canvas.width = mmToPx(s.width, s.dpi);
  canvas.height = mmToPx(s.height, s.dpi);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save(); ctx.scale(scale, scale); ctx.translate(s.margin, s.margin);
  // The grid controls placement only; no borders are part of the label.
  ctx.fillStyle = '#000';
  const errors = [];
  const cell = (text, x, y, w, h, bold = false, align = bold ? 'right' : 'left') => {
    // Measure at 100× to avoid font hinting rounding 2 mm metrics to integers.
    const precision = 100;
    ctx.font = `${bold ? 700 : 400} ${s.font * precision}px "Open Sans"`;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    const inset = s.padding;
    const inkWidth = t => {
      const m = ctx.measureText(t);
      return Math.max(m.width, m.actualBoundingBoxLeft + m.actualBoundingBoxRight) / precision;
    };
    const lines = wrapText(text, w - 2 * inset, inkWidth);
    const metrics = lines.map(line => {
      const m = ctx.measureText(line);
      return { ascent: m.actualBoundingBoxAscent / precision, descent: m.actualBoundingBoxDescent / precision,
        left: m.actualBoundingBoxLeft / precision, right: m.actualBoundingBoxRight / precision };
    });
    const top = Math.min(...metrics.map((m, i) => i * s.lineHeight - m.ascent));
    const bottom = Math.max(...metrics.map((m, i) => i * s.lineHeight + m.descent));
    const overlaps = metrics.some((m, i) => i > 0 && metrics[i - 1].descent + m.ascent > s.lineHeight + .01);
    if (bottom - top > h - 2 * inset || overlaps || lines.some(line => inkWidth(line) > w - 2 * inset)) {
      errors.push(`Text “${text.slice(0, 32)}” does not fit. Edit the text or layout settings.`);
    }
    // Center the whole multiline ink block, not each baseline independently.
    // Padding is a layout constraint, never a clipping mask over the glyphs.
    const baseline = y + (h - (bottom - top)) / 2 - top;
    lines.forEach((line, i) => {
      const originX = align === 'center' ? x + (w + metrics[i].left - metrics[i].right) / 2
        : align === 'right' ? x + w - inset - metrics[i].right : x + inset + metrics[i].left;
      ctx.save(); ctx.translate(originX, baseline + i * s.lineHeight);
      ctx.scale(1 / precision, 1 / precision); ctx.fillText(line, 0, 0); ctx.restore();
    });
  };
  cell('Artist\nname', 0, 0, g.column, g.row, true);
  cell(artist, g.column, 0, g.w - g.column, g.row);
  cell('Album\ntitle', 0, g.row, g.column, g.row, true);
  cell(album, g.column, g.row, g.w - g.column, g.row);
  if (codeImage) {
    const inset = s.padding;
    const ratio = codeImage.naturalWidth / codeImage.naturalHeight;
    const w = Math.min(g.w - 2 * inset, (g.codeHeight - 2 * inset) * ratio);
    const h = w / ratio;
    ctx.drawImage(codeImage, (g.w - w) / 2, 2 * g.row + (g.codeHeight - h) / 2, w, h);
    if (w < 20) errors.push('The Spotify Code needs at least 20 mm of width.');
  } else if (unavailable) {
    cell('not available on spotify', 0, 2 * g.row, g.w, g.codeHeight, false, 'center');
  }
  ctx.restore();
  // Preview and output share exactly the same one-bit raster.
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const bw = pixels.data[i] * .2126 + pixels.data[i + 1] * .7152 + pixels.data[i + 2] * .0722 < 160 ? 0 : 255;
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = bw;
  }
  ctx.putImageData(pixels, 0, 0);
  return { errors, geometry: g };
}

export function printCrop(width, height, head, direction, marginPx) {
  const cross = direction === 'left' ? height : width;
  const excess = Math.max(0, cross - head);
  if (Math.ceil(excess / 2) >= marginPx) throw new Error('The layout exceeds the printhead width. Change the label size or orientation.');
  return { x: direction === 'top' ? Math.floor(excess / 2) : 0, y: direction === 'left' ? Math.floor(excess / 2) : 0,
    width: direction === 'top' ? Math.min(width, head) : width, height: direction === 'left' ? Math.min(height, head) : height };
}
