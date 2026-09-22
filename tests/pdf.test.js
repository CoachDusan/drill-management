/* tests/pdf.test.js — run with:
 *   jsc -m tests/pdf.test.js
 *   jsc -m tests/pdf.test.js -- /some/folder     # also writes sample PDFs there to look at
 *   jsc -m tests/pdf.test.js -- /some/folder logo.png
 *
 * Makes REAL PDFs with the vendored library, from invented data (no club data
 * is used or needed). What this proves: every report kind renders without
 * throwing, the output is a PDF with the pages expected, and the text on it is
 * the text the report builder decided on. What it cannot prove: that the PDF
 * looks right. Write the samples out and open them.
 */

// The vendored library expects a browser. Just enough of one:
globalThis.window = globalThis;
globalThis.navigator = globalThis.navigator || { userAgent: 'jsc' };
if (typeof TextEncoder === 'undefined') {
  globalThis.TextEncoder = class {
    encode(str) {
      const u = unescape(encodeURIComponent(String(str)));
      const a = new Uint8Array(u.length);
      for (let i = 0; i < u.length; i++) a[i] = u.charCodeAt(i);
      return a;
    }
  };
}
if (typeof TextDecoder === 'undefined') {
  globalThis.TextDecoder = class {
    decode(buf) {
      const a = new Uint8Array(buf || []);
      let s = '';
      for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
      try { return decodeURIComponent(escape(s)); } catch (_) { return s; }
    }
  };
}
load('vendor/jspdf.umd.min.js');
load('vendor/jspdf.plugin.autotable.min.js');
const JsPDF = globalThis.jspdf.jsPDF;

const { renderReportPdf, pdfText, ACCENTS } = await import('../js/pdf.js');
const { buildReportDoc } = await import('../js/report-doc.js');
const { addDays } = await import('../js/models.js');

const args = (typeof scriptArgs !== 'undefined' && scriptArgs) || globalThis.arguments || [];
const outDir = args[0] || null;
const logoPath = args[1] || null;

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; print(`FAIL  ${name}${detail ? `  (${detail})` : ''}`); }
}

/* ---- text the fonts can draw ---- */
ok('plain text is untouched', pdfText('5on5 HC + 2') === '5on5 HC + 2');
ok('Western European letters and dashes survive', pdfText('Müller – š · …') === 'Müller – š · …', pdfText('Müller – š · …'));
ok('letters the font cannot draw lose their accent, not the letter', pdfText('Čačak Đorđe ć') === 'Cacak Dorde c', pdfText('Čačak Đorđe ć'));
ok('line breaks are kept', pdfText('a\nb') === 'a\nb');
ok('nothing becomes "null"', pdfText(null) === '');

/* ---- invented data: a month, three weeks trained ---- */
const D = (n) => addDays('2026-03-02', n);
const drills = [
  { id: 'd1', name: '5on5 half court +2', category: '5on5 live', situation: 1, contact: true },
  { id: 'd2', name: '5on5 full court scrimmage', category: '5on5 live', situation: 1, contact: true },
  { id: 'd3', name: '3on3 full court', category: 'Small-sided live', situation: 3, contact: true },
  { id: 'd4', name: '4on3 advantage', category: 'Advantage games', situation: 2, contact: true },
  { id: 'd5', name: 'Shell 5on0', category: 'Offense', situation: 1, contact: false },
  { id: 'd6', name: 'Form shooting', category: 'Shooting', situation: 1, contact: false },
  { id: 'd7', name: 'Closeouts 1on1', category: 'Defense', situation: 5, contact: true },
];
const lib = Object.fromEntries(drills.map((d) => [d.id, d]));
let seq = 0;
const blk = (sessionId, drillId, mins, live = null, extra = {}) => {
  const d = lib[drillId];
  seq += 1;
  return {
    id: `b${seq}`, sessionId, drillId, drillName: d.name, category: d.category, situation: d.situation,
    contact: d.contact, intensity: 6, elapsedMs: mins * 60000, liveMs: live === null ? null : live * 60000,
    running: false, participation: {}, order: null, group: 'Team', note: '',
    tissue: { jump: null, sprint: null, cod: null }, createdAt: `2026-03-01T10:${String(seq).padStart(2, '0')}:00Z`, ...extra,
  };
};
const gd = ['GD-3', 'GD-2', 'GD-1'];
const sessions = [];
const blocks = [];
[0, 1, 2, 7, 8, 9, 21, 22, 23].forEach((day, i) => {
  const id = `s${i}`;
  sessions.push({ id, date: D(day), gameDay: gd[i % 3], type: 'Practice', label: i === 4 ? 'Shootaround' : '' });
  blocks.push(blk(id, 'd6', 12));
  blocks.push(blk(id, 'd7', 8, 5));
  blocks.push(blk(id, 'd5', 10 + i));
  if (i % 3 !== 2) blocks.push(blk(id, 'd3', 12, 7));
  blocks.push(blk(id, i % 2 ? 'd2' : 'd1', 20 + i, 12 + (i % 4), i === 3 ? { note: 'Played to 7 — Đorđe tight hamstring' } : {}));
  if (i === 5) blocks.push(blk(id, 'd4', 9));
});

const branding = { clubName: 'Sample Basketball Club', preparedBy: 'S&C coach', accent: ACCENTS[0].hex };
if (logoPath) {
  const buf = readFile(logoPath, 'binary');
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  branding.logo = `data:image/png;base64,${btoa(bin)}`;
} else {
  branding.logo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
}

function render(name, input, opts = {}) {
  const model = buildReportDoc({ drills, blocks, ...input });
  let pdf = null;
  try { pdf = renderReportPdf(model, opts.branding || branding, JsPDF, { compress: false, generatedOn: '12 Sep 2026' }); }
  catch (e) { ok(`${name} renders`, false, `${e && e.message}\n${String(e && e.stack).slice(0, 300)}`); return null; }
  const out = pdf.output();
  ok(`${name} is a PDF`, out.slice(0, 5) === '%PDF-');
  if (outDir) writeFile(`${outDir}/${name}.pdf`, pdf.output('arraybuffer'));
  return { model, pdf, out, pages: pdf.getNumberOfPages() };
}

const week = { from: D(0), to: D(6), label: '2 – 8 Mar 2026' };
const month = { from: '2026-03-01', to: '2026-03-31', label: 'March 2026' };

const weekly = render('weekly', { period: 'week', unit: 'day', range: week, sessions, scopeLabel: '2025/2026 · Inseason' });
if (weekly) {
  ok('the title is on the page', weekly.out.indexOf('(Weekly report)') !== -1);
  ok('the club name is on the page', weekly.out.indexOf('(Sample Basketball Club)') !== -1);
  ok('the season and phase are on the page', weekly.out.indexOf('2025/2026 · Inseason') !== -1 || weekly.out.indexOf('2025/2026 \\267 Inseason') !== -1);
  // Three since 2026-09-22: the contact tree has more rows, and he asked for
  // how contact is counted to be written out in the PDF. A fourth page would
  // mean something is laid out badly — check the samples.
  ok('a weekly report fits on three pages', weekly.pages <= 3, String(weekly.pages));
}

const weeklyEach = render('weekly-each-practice', { period: 'week', unit: 'day', range: week, sessions, breakdown: true });
if (weeklyEach && weekly) ok('each practice on its own adds pages', weeklyEach.pages > weekly.pages, `${weeklyEach.pages} vs ${weekly.pages}`);

const monthly = render('monthly-each-week', { period: 'month', unit: 'week', range: month, sessions, breakdown: true, scopeLabel: '2025/2026 · Inseason' });
if (monthly) ok('a month with three trained weeks has a page per week after the summary', monthly.pages >= 4, String(monthly.pages));

render('yearly', { period: 'year', unit: 'month', range: { from: '2026-01-01', to: '2026-12-31', label: '2026' }, sessions });
render('daily', { period: 'day', unit: 'day', range: { from: D(7), to: D(7), label: 'Mon 9 Mar 2026' }, sessions });

const gd1 = sessions.filter((s) => s.gameDay === 'GD-1');
const gdReport = render('gd1-month', { period: 'month', unit: 'week', range: month, sessions: gd1, gameDay: 'GD-1', perN: gd1.length,
  notes: ['2 practices in these dates have no game-day label and are not included.'] });
if (gdReport) ok('a game-day PDF says per practice', gdReport.out.indexOf('Per practice') !== -1);

render('empty', { period: 'week', unit: 'day', range: { from: D(40), to: D(46), label: 'an empty week' }, sessions });

// A logo that is not an image must not stop the report.
render('bad-logo', { period: 'week', unit: 'day', range: week, sessions }, { branding: { ...branding, logo: 'data:image/png;base64,bm90IGFuIGltYWdl' } });
render('no-branding', { period: 'week', unit: 'day', range: week, sessions }, { branding: {} });

print(`\n${pass} passed, ${fail} failed`);
if (fail) throw new Error(`${fail} test(s) failed`);
