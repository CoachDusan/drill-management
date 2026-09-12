/* pdf.js — draws a report document (js/report-doc.js) as a PDF.
 *
 * Built inside the app, not through the browser's print window. That was the
 * coach's call, made against the lighter option with both costs in front of
 * him: print-to-PDF needs "Background graphics" ticked every time or the
 * colours vanish; this carries a PDF library in the app, and every layout
 * change is code. He chose one tap and guaranteed colours.
 *
 * The library (jsPDF + AutoTable) is vendored in /vendor — no CDN, because
 * this runs in a gym with no signal — and loaded only when a PDF is made, so
 * it costs nothing at start-up. sw.js caches it for offline use.
 *
 * Nothing in here decides WHAT goes in a report. That is report-doc.js, and
 * it is tested without a PDF library. This file only lays it out.
 */

export const ACCENTS = [
  { key: 'navy',   label: 'Navy',   hex: '#1f3a5f' },
  { key: 'red',    label: 'Red',    hex: '#a4262c' },
  { key: 'green',  label: 'Green',  hex: '#1e6b45' },
  { key: 'orange', label: 'Orange', hex: '#b85600' },
  { key: 'purple', label: 'Purple', hex: '#553c8b' },
  { key: 'black',  label: 'Black',  hex: '#262626' },
];

/* ---- loading the library ------------------------------------------------- */

let enginePromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`the PDF library (${src}) did not load`));
    document.head.appendChild(el);
  });
}

/** The jsPDF constructor, loading it the first time it is needed. */
const engineReady = (J) => !!J && ((J.API && typeof J.API.autoTable === 'function') || typeof J.prototype.autoTable === 'function');

export function loadPdfEngine() {
  if (window.jspdf && engineReady(window.jspdf.jsPDF)) {
    return Promise.resolve(window.jspdf.jsPDF);
  }
  if (!enginePromise) {
    enginePromise = loadScript('./vendor/jspdf.umd.min.js')
      .then(() => loadScript('./vendor/jspdf.plugin.autotable.min.js'))
      .then(() => window.jspdf.jsPDF)
      .catch((err) => { enginePromise = null; throw err; });
  }
  return enginePromise;
}

/* ---- text the built-in fonts can draw ------------------------------------
 *
 * The PDF's built-in Helvetica covers Western European letters and the usual
 * punctuation (– · … “ ” š ž), not č ć đ. Embedding a full Unicode font would
 * add hundreds of KB to every report; every drill in the club library today
 * is plain ASCII. So a letter the font cannot draw is written without its
 * accent (č → c) rather than as a blank box — readable, and the one place the
 * PDF can differ from the screen.
 */
const WIN_ANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
const PLAIN = { 'đ': 'd', 'Đ': 'D', 'ł': 'l', 'Ł': 'L', 'ı': 'i', 'ß': 'ss' };

export function pdfText(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/[^\n\x20-\x7e -ÿ]/g, (ch) => {
      if (WIN_ANSI_EXTRA.indexOf(ch) !== -1) return ch;
      if (PLAIN[ch]) return PLAIN[ch];
      const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
      return base && /^[\x20-\x7e -ÿ]+$/.test(base) ? base : '?';
    });
}

/* ---- colour ------------------------------------------------------------- */

function rgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  const n = parseInt(m ? m[1] : '1f3a5f', 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function tint(c, amount) { return c.map((v) => Math.round(v + (255 - v) * amount)); }

/* ---- drawing -------------------------------------------------------------- */

const M = 14;            // page margin, mm
const TOP = 17;          // where content starts on a continuation page

/**
 * @param model    from buildReportDoc()
 * @param branding { clubName, preparedBy, accent: '#hex', logo: dataURL }
 * @param JsPDF    the jsPDF constructor
 */
export function renderReportPdf(model, branding = {}, JsPDF, { compress = true, generatedOn = null } = {}) {
  const T = pdfText;
  const accent = rgb(branding.accent || ACCENTS[0].hex);
  const light = tint(accent, 0.86);
  const pdf = new JsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress });
  const W = pdf.internal.pageSize.getWidth();
  const H = pdf.internal.pageSize.getHeight();
  const club = T(branding.clubName || '');
  pdf.setProperties({ title: T(`${model.title} — ${model.subtitle}`), creator: 'Load Tracker' });

  /* ---- first-page header band ---- */
  const bandH = 32;
  pdf.setFillColor(...accent);
  pdf.rect(0, 0, W, bandH, 'F');
  let textX = M;
  if (branding.logo) {
    try {
      const p = pdf.getImageProperties(branding.logo);
      const scale = Math.min(34 / p.width, 22 / p.height);
      const iw = p.width * scale, ih = p.height * scale;
      pdf.setFillColor(255, 255, 255);
      pdf.roundedRect(M, (bandH - ih) / 2 - 2, iw + 4, ih + 4, 2, 2, 'F');
      pdf.addImage(branding.logo, p.fileType || 'PNG', M + 2, (bandH - ih) / 2, iw, ih);
      textX = M + iw + 11;
    } catch (_) {
      // A logo that will not decode must never stop the report being made.
    }
  }
  pdf.setTextColor(255, 255, 255);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(20);
  pdf.text(T(model.title), textX, 15);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(11);
  pdf.text(T(model.subtitle), textX, 23);
  if (club) {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(12);
    pdf.text(club, W - M, 14.5, { align: 'right' });
  }
  if (branding.preparedBy) {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.text(T(`Prepared by ${branding.preparedBy}`), W - M, 21.5, { align: 'right' });
  }

  /* ---- badges: season · phase, game day, practices ---- */
  let y = bandH + 8;
  let x = M;
  pdf.setFontSize(8.5);
  pdf.setFont('helvetica', 'bold');
  for (const b of model.badges) {
    const label = T(b);
    const w = pdf.getTextWidth(label) + 7;
    pdf.setFillColor(...light);
    pdf.roundedRect(x, y - 4.4, w, 6.4, 3.2, 3.2, 'F');
    pdf.setTextColor(...accent);
    pdf.text(label, x + 3.5, y);
    x += w + 3;
  }
  y += 7;

  /* ---- tiles ---- */
  const gap = 5;
  const tw = (W - 2 * M - gap * (model.tiles.length - 1)) / model.tiles.length;
  const th = 23;
  model.tiles.forEach((t, i) => {
    const tx = M + i * (tw + gap);
    pdf.setDrawColor(222, 222, 222);
    pdf.setFillColor(250, 250, 250);
    pdf.roundedRect(tx, y, tw, th, 2, 2, 'FD');
    pdf.setFillColor(...accent);
    pdf.rect(tx, y + 3, 1.4, th - 6, 'F');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7.5);
    pdf.setTextColor(110, 110, 110);
    pdf.text(T(t.label.toUpperCase()), tx + 6, y + 6.5);
    pdf.setFontSize(17);
    pdf.setTextColor(25, 25, 25);
    pdf.text(T(t.value), tx + 6, y + 15);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.5);
    pdf.setTextColor(110, 110, 110);
    pdf.text(pdf.splitTextToSize(T(t.note), tw - 9)[0] || '', tx + 6, y + 20);
  });
  y += th + 9;

  /* ---- sections ----
   *
   * A table that would split but fits on a fresh page goes to that page whole.
   * The first table after the tiles is the exception — moving it would leave
   * page one as a header and four boxes. Everything else: no page carrying the
   * last three rows of a table and nothing else. */
  const ctx = { accent, light, W };
  const measure = (block) => {
    const scratch = new JsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: false });
    drawTable(scratch, block, TOP, ctx);
    return scratch.getNumberOfPages() === 1 ? scratch.lastAutoTable.finalY - TOP : Infinity;
  };
  const fits = (h) => y + h <= H - 15;
  const fitsFresh = (h) => h <= H - (TOP + 3) - 15;
  let firstTableDrawn = false;

  for (const section of model.sections) {
    const headH = 6.5 + (section.sub ? 4.5 : 0);
    const first = section.blocks[0];
    const firstH = first && first.type === 'table' && firstTableDrawn ? measure(first) : 12;
    if (section.pageBreak || y > H - 48 || (!fits(headH + 1 + firstH) && fitsFresh(headH + 1 + firstH))) {
      pdf.addPage(); y = TOP + 3;
    }
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(13);
    pdf.setTextColor(...accent);
    pdf.text(T(section.heading), M, y);
    pdf.setDrawColor(...accent);
    pdf.setLineWidth(0.5);
    pdf.line(M, y + 2, W - M, y + 2);
    y += 6.5;
    if (section.sub) {
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(8.5);
      pdf.setTextColor(100, 100, 100);
      pdf.text(T(section.sub), M, y);
      y += 4.5;
    }
    for (let bi = 0; bi < section.blocks.length; bi++) {
      const block = section.blocks[bi];
      if (block.type === 'note') {
        pdf.setFontSize(9);
        pdf.setTextColor(80, 80, 80);
        const lines = pdf.splitTextToSize(T(block.text), W - 2 * M);
        pdf.text(lines, M, y + 3);
        y += lines.length * 4.5 + 4;
        continue;
      }
      if (bi > 0 && firstTableDrawn) {
        const hgt = measure(block);
        if (!fits(1 + hgt) && fitsFresh(1 + hgt)) { pdf.addPage(); y = TOP + 3; }
      } else if (y > H - 32) { pdf.addPage(); y = TOP + 3; }
      drawTable(pdf, block, y + 1, ctx);
      firstTableDrawn = true;
      y = pdf.lastAutoTable.finalY + 8;
    }
  }

  /* ---- notes ---- */
  if (model.footnotes.length) {
    pdf.setFontSize(7.8);
    const lines = model.footnotes.map((f) => pdf.splitTextToSize(T(f), W - 2 * M - 4));
    const need = 8 + lines.reduce((s, l) => s + l.length * 3.6 + 1.2, 0);
    if (y + need > H - 16) { pdf.addPage(); y = TOP + 3; }
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9.5);
    pdf.setTextColor(...accent);
    pdf.text('Notes', M, y);
    y += 5;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.8);
    pdf.setTextColor(90, 90, 90);
    for (const l of lines) {
      if (y + l.length * 3.6 > H - 16) { pdf.addPage(); y = TOP + 3; }
      pdf.text('•', M, y);
      pdf.text(l, M + 4, y);
      y += l.length * 3.6 + 1.2;
    }
  }

  /* ---- every page: continuation strip and footer ---- */
  const pages = pdf.getNumberOfPages();
  const made = generatedOn || new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  for (let p = 1; p <= pages; p++) {
    pdf.setPage(p);
    if (p > 1) {
      pdf.setFillColor(...accent);
      pdf.rect(0, 0, W, 3, 'F');
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(8);
      pdf.setTextColor(...accent);
      pdf.text(T(`${model.title} · ${model.subtitle}`), M, 10);
      if (club) {
        pdf.setFont('helvetica', 'normal');
        pdf.text(club, W - M, 10, { align: 'right' });
      }
    }
    pdf.setDrawColor(220, 220, 220);
    pdf.setLineWidth(0.2);
    pdf.line(M, H - 10, W - M, H - 10);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.5);
    pdf.setTextColor(130, 130, 130);
    pdf.text(T(`${club ? `${club} · ` : ''}Made with Load Tracker on ${made}. Prescribed load, not measured load.`), M, H - 5.5);
    pdf.text(`Page ${p} of ${pages}`, W - M, H - 5.5, { align: 'right' });
  }
  return pdf;
}

/* Column widths by table kind. Anything not listed shares what is left. */
const WIDTHS = {
  drill: { 0: 62, 1: 36, 2: 15, 7: 16 },
  practice: { 0: 9, 1: 78, 2: 40, 3: 24 },
  'category-simple': { 0: 70 },
  category: { 0: 44 },
};

function drawTable(pdf, block, startY, { accent, light }) {
  const T = pdfText;
  const cols = block.columns;
  const wide = cols.length > 10;
  const grid = block.kind === 'category';
  // His weekly grid is the tallest thing in a report; tighter rows keep it on
  // the first page more often.
  const fontSize = wide ? 6.8 : grid ? 7.8 : 8.2;
  const padding = wide ? 1.2 : grid ? 1.25 : 1.6;
  const align = (i) => (cols[i] && cols[i].align === 'right' ? 'right' : 'left');

  const columnStyles = {};
  if (grid) {
    // Totals and per-practice must not wrap their star onto a third line.
    cols.forEach((c, i) => { if (c.role === 'total') columnStyles[i] = { minCellWidth: 22 }; });
  }
  const widths = WIDTHS[block.kind] || {};
  Object.keys(widths).forEach((k) => { columnStyles[k] = { ...(columnStyles[k] || {}), cellWidth: widths[k] }; });

  pdf.autoTable({
    startY,
    theme: 'grid',
    margin: { left: M, right: M, top: TOP, bottom: 15 },
    rowPageBreak: 'avoid',
    showHead: 'everyPage',
    styles: {
      font: 'helvetica', fontSize, cellPadding: padding, overflow: 'linebreak',
      lineColor: [226, 226, 226], lineWidth: 0.2, textColor: [30, 30, 30], valign: 'middle',
    },
    headStyles: { fillColor: accent, textColor: [255, 255, 255], fontStyle: 'bold', fontSize },
    columnStyles,
    head: [cols.map((c, i) => ({
      content: T(c.sub ? `${c.label}\n${c.sub}` : c.label),
      styles: { halign: align(i) },
    }))],
    body: block.rows.map((r) => {
      if (r.style === 'group') {
        return [{ content: T(r.cells[0]), colSpan: cols.length,
          styles: { fillColor: light, textColor: accent, fontStyle: 'bold', fontSize: fontSize + 0.4 } }];
      }
      const st = r.style === 'total' ? { fontStyle: 'bold', fillColor: [236, 236, 236] }
        : r.style === 'emph' ? { fontStyle: 'bold', fillColor: light }
          : r.style === 'matchup' ? { fillColor: [248, 248, 248] } : {};
      return r.cells.map((cell, i) => ({ content: T(cell), styles: { ...st, halign: align(i) } }));
    }),
  });
}
