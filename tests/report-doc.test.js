/* tests/report-doc.test.js — run with:
 *   /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m tests/report-doc.test.js
 *
 * What goes into a PDF report, before any PDF library touches it. The tests
 * that matter: his drill order (contact 5on5, other contact, no defence; most
 * used first — frequency beating minutes), empty weeks getting no page, and a
 * drill nobody timed never printing as 0:00 live.
 */

import {
  buildReportDoc, sortDrillRows, reportKind, cellFullLive, drillTable, practiceSheet,
} from '../js/report-doc.js';
import { addDays } from '../js/models.js';

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; print(`FAIL  ${name}${detail ? `  (${detail})` : ''}`); }
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  ok(name, a === e, `got ${a}, expected ${e}`);
}

const D = (n) => addDays('2026-03-02', n);          // a Monday
const drills = [
  { id: 'd5',  name: '5on5 HC',    category: '5on5 live',        situation: 1, contact: true },
  { id: 'dS',  name: '3on3 FC',    category: 'Small-sided live', situation: 3, contact: true },
  { id: 'dS2', name: '1on1 HC',    category: 'Small-sided live', situation: 5, contact: true },
  { id: 'dN',  name: 'Shell 5on0', category: 'Offense',          situation: 1, contact: false },
];
const lib = Object.fromEntries(drills.map((d) => [d.id, d]));
let seq = 0;
const blk = (sessionId, drillId, mins, liveMins = null, extra = {}) => {
  const d = lib[drillId];
  seq += 1;
  return {
    id: `b${seq}`, sessionId, drillId, drillName: d.name, category: d.category,
    situation: d.situation, contact: d.contact, intensity: 5,
    elapsedMs: mins * 60000, liveMs: liveMins === null ? null : liveMins * 60000,
    running: false, lastResumedAt: null, participation: {}, order: null,
    tissue: { jump: null, sprint: null, cod: null }, group: 'Team', note: '',
    createdAt: `2026-03-02T10:00:${String(seq).padStart(2, '0')}Z`, ...extra,
  };
};

const sessions = [
  { id: 's1', date: D(0), gameDay: 'GD-3', type: 'Practice', label: '' },
  { id: 's2', date: D(1), gameDay: 'GD-2', type: 'Practice', label: 'Shootaround' },
  { id: 's3', date: D(2), gameDay: 'GD-1', type: 'Practice', label: '' },
  { id: 's4', date: D(15), gameDay: 'GD-1', type: 'Practice', label: '' },   // week 3 of March
];
const blocks = [
  blk('s1', 'dN', 15),                                   // never timed
  blk('s1', 'dS', 10, 6),
  blk('s1', 'dS2', 40, 20),                              // ONE run, but more minutes than 3on3's three
  blk('s2', 'dS', 12, 7, { order: 2 }),
  blk('s2', 'dN', 10, null, { order: 0 }),
  blk('s2', 'd5', 20, 12, { order: 1 }),
  blk('s3', 'dS', 10, 5),
  blk('s4', 'd5', 25, 15),
];

const week = { from: D(0), to: D(6), label: '2 – 8 Mar' };

/* ---- his drill order ---- */
{
  const t = drillTable(sessions, blocks, drills, week);
  const names = t.rows.filter((r) => r.style !== 'group').map((r) => r.cells[0]);
  eq('contact 5on5 first, other contact next, no defence last', names, ['5on5 HC', '3on3 FC', '1on1 HC', 'Shell 5on0']);
  ok('within a band, three runs beat one run of more minutes', names.indexOf('3on3 FC') < names.indexOf('1on1 HC'));
  eq('the bands are named between the rows',
    t.rows.filter((r) => r.style === 'group').map((r) => r.cells[0]),
    ['Contact 5on5', 'Contact 1on1/2on2…', 'No defence']);

  const shell = t.rows.find((r) => r.cells[0] === 'Shell 5on0');
  // Every full/live pair: the live line must be a dash, never 0:00.
  const liveLines = shell.cells.slice(3, 7).map((c) => c.split('\n')[1]);
  eq('a drill nobody timed never shows 0:00 live', liveLines, ['—', '—', '—', '—']);
  ok('its times cell says it was timed on none of its runs', shell.cells[2] === '2\nlive on 0', shell.cells[2]);

  const sorted = sortDrillRows([
    { name: 'b', matchup: 'unknown', runs: 9, minutes: 99 },
    { name: 'a', matchup: 'unopposed', runs: 1, minutes: 1 },
  ]);
  eq('matchup-unknown drills go after no defence', sorted.map((r) => r.name), ['a', 'b']);
}

/* ---- cells ---- */
eq('a full cell has full time, then live time and %', cellFullLive({ minutes: 20, timedRuns: 1, liveMinutes: 10, liveDensity: 0.5, liveCoverage: 1 }), '20:00\n10:00 · 50%');
eq('a partly timed cell is starred', cellFullLive({ minutes: 20, timedRuns: 1, liveMinutes: 5, liveDensity: 0.5, liveCoverage: 0.5 }), '20:00\n5:00 · 50% *');
eq('an untimed cell says so', cellFullLive({ minutes: 20, timedRuns: 0, liveMinutes: 0, liveCoverage: 0 }), '20:00\nnot timed');
eq('an empty cell is a dash', cellFullLive({ minutes: 0 }), '—');

/* ---- which report a period makes ---- */
eq('a week breaks down by practice', reportKind('week', 'day').breakdown, 'practice');
eq('a month by week', reportKind('month', 'week').breakdown, 'week');
eq('a year by month', reportKind('year', 'month').breakdown, 'month');
eq('chosen dates follow their column unit', reportKind('custom', 'week').breakdown, 'week');

/* ---- weekly ---- */
{
  const plain = buildReportDoc({ period: 'week', unit: 'day', range: week, sessions, blocks, drills });
  eq('a weekly report is by category, then by drill', plain.sections.map((s) => s.heading), ['By category', 'By drill']);
  const cat = plain.sections[0].blocks[0];
  eq('one column per training day, plus label and total', cat.columns.length, 3 + 2);
  ok('columns carry their game-day label', cat.columns[1].sub === 'GD-3', cat.columns[1].sub);
  const monthDoc = buildReportDoc({ period: 'month', unit: 'week', range: { from: '2026-03-01', to: '2026-03-31', label: 'March 2026' }, sessions, blocks, drills });
  const wk1 = monthDoc.sections[0].blocks[0].columns[1];
  ok('a week column is short enough for a narrow column', wk1.label === 'Week 1', wk1.label);
  ok('and never claims days outside the month', wk1.sub.split('\n')[0] === '1.3.', wk1.sub);
  ok('the file is named for what it is', plain.fileName === 'Weekly report 2026-03-02 to 2026-03-08.pdf', plain.fileName);
  eq('three practices counted', plain.tiles[0].value, '3');
  eq('contact 5on5 has its own tile', plain.tiles[3].value, '20:00');
  ok('a partly timed cell brings its footnote', plain.footnotes.some((f) => f.indexOf('* This live figure') === 0));
  ok('and the contact-rows explanation travels with the table', plain.footnotes.some((f) => f.indexOf('Contact rows come from') === 0));

  const each = buildReportDoc({ period: 'week', unit: 'day', range: week, sessions, blocks, drills, breakdown: true });
  const sheets = each.sections.slice(2);
  eq('each practice on its own adds one sheet per practice', sheets.length, 3);
  ok('the first sheet starts a new page', sheets[0].pageBreak === true);
  ok('a sheet names its game day and label', sheets[1].sub === 'GD-2 · Shootaround', sheets[1].sub);
  const order = sheets[1].blocks[0].rows.filter((r) => r.style !== 'total').map((r) => r.cells[1]);
  eq('a practice sheet is in the order it ran, as he dragged it', order, ['Shell 5on0', '5on5 HC', '3on3 FC']);
}

/* ---- monthly ---- */
{
  const month = { from: '2026-03-01', to: '2026-03-31', label: 'March 2026' };
  const doc = buildReportDoc({ period: 'month', unit: 'week', range: month, sessions, blocks, drills, breakdown: true });
  const cat = doc.sections[0].blocks[0];
  ok('the month table keeps empty weeks as columns', cat.columns.length - 2 >= 5, String(cat.columns.length - 2));
  const weeks = doc.sections.slice(2);
  eq('but only weeks with practices get a page', weeks.length, 2);
  ok('a week page is labelled as a week', weeks[0].heading.indexOf('Week ') === 0, weeks[0].heading);
  eq('and has its own categories and drills', weeks[0].blocks.map((b) => b.kind), ['category', 'drill']);
}

/* ---- a game-day report ---- */
{
  const gd1 = sessions.filter((s) => s.gameDay === 'GD-1');
  const month = { from: '2026-03-01', to: '2026-03-31', label: 'March 2026' };
  const doc = buildReportDoc({ period: 'month', unit: 'week', range: month, sessions: gd1, blocks, drills, gameDay: 'GD-1', perN: 2,
    notes: ['2 practices have no game-day label in these dates.'] });
  ok('the title says which game day', doc.title === 'Monthly report · GD-1', doc.title);
  ok('the per-practice column is there', doc.sections[0].blocks[0].columns.some((c) => c.label === 'Per practice'));
  ok('the divisor is explained', doc.footnotes.some((f) => f.indexOf('Per practice') !== -1));
  ok('what the screen left out is said in the PDF too', doc.footnotes.indexOf('2 practices have no game-day label in these dates.') !== -1);
  eq('court time per practice on the tile', doc.tiles[1].note, '17:30 per practice');
}

/* ---- daily ---- */
{
  const doc = buildReportDoc({ period: 'day', unit: 'day', range: { from: D(1), to: D(1), label: 'Tue 3 Mar' }, sessions, blocks, drills });
  eq('a daily report is the practice itself', doc.sections.length, 1);
  eq('with its categories under the running order', doc.sections[0].blocks.map((b) => b.kind), ['practice', 'category-simple']);
}

/* ---- nothing recorded ---- */
{
  const doc = buildReportDoc({ period: 'week', unit: 'day', range: { from: D(21), to: D(27), label: 'empty' }, sessions, blocks, drills });
  eq('an empty week says so instead of drawing empty tables', doc.sections.map((s) => s.heading), ['Nothing recorded']);
}

print(`\n${pass} passed, ${fail} failed`);
if (fail) throw new Error(`${fail} test(s) failed`);
