/* tests/history.test.js — run with:
 *   /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m tests/history.test.js
 *
 * The aggregation layer: many practices rolled into days, drills, categories
 * and game-day buckets. Pure maths, no browser.
 *
 * The tests that matter most in here are the honesty ones — that an unrated
 * drill never quietly becomes a zero, that a rest day is kept, and that a
 * bucket built from one day says so.
 */

import {
  rangeFor, blocksByDate, dayRollup, dayRollups, loadSeries, windowCoverage,
  aggregate, sessionRollups, gameDayCoverage, gameWeekComparison,
  categoryByGameDay, drillWindowAverages,
  drillRollups, categoryMix, playerDaySeries, playerTotals, comparePeriods,
  plainSummary, contactTimeOf,
  startOfWeek, startOfMonth, endOfMonth, daysBetween, periodRange, columnUnitFor,
  columnsFor, blockMatchup, contactRowOf, reportRowsFor, reportTable, drillReport, spreadOf,
  gameDayCounts, perPractice, REPORT_GAME_DAYS,
} from '../js/history.js';
import { acwrSeries, provisionalNote } from '../js/load.js';
import { addDays } from '../js/models.js';

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; }
  else { fail++; print(`FAIL  ${name}${detail ? `  (${detail})` : ''}`); }
}
function eq(name, actual, expected, tol = 1e-9) {
  const good = (typeof expected === 'number' && typeof actual === 'number')
    ? Math.abs(actual - expected) <= tol
    : actual === expected;
  ok(name, good, `got ${actual}, expected ${expected}`);
}

const D = (n) => addDays('2026-03-02', n);           // 2026-03-02 is a Monday
const ses = (id, date, extra = {}) => ({ id, date, type: 'Practice', rosterIds: ['p1', 'p2'], ...extra });
const blk = (sessionId, intensity, minutes, extra = {}) => ({
  id: `b_${Math.random().toString(36).slice(2, 8)}`,
  sessionId, intensity, elapsedMs: minutes * 60000, running: false, lastResumedAt: null,
  participation: {}, tissue: { jump: null, sprint: null, cod: null }, contact: true,
  liveMs: null, drillId: null, drillName: 'Drill', ...extra,
});

/* ---- days ------------------------------------------------------------- */

{
  const sessions = [ses('s1', D(0)), ses('s2', D(0)), ses('s3', D(2))];
  const blocks = [
    blk('s1', 5, 20), blk('s1', 8, 10),
    blk('s2', 4, 30),                 // a second session the same day
    blk('s3', 6, 15),
  ];

  const byDate = blocksByDate(sessions, blocks);
  eq('two sessions on one day roll into one day', byDate.get(D(0)).length, 3);

  const day = dayRollup(D(0), byDate.get(D(0)), [sessions[0], sessions[1]]);
  eq('day load sums every session that day', day.load, 5 * 20 + 8 * 10 + 4 * 30);
  eq('day minutes sum too', day.minutes, 60);
  eq('mean drill length is per run', day.meanDrillMinutes, 20);
  eq('a fully rated day has full coverage', day.coverage, 1);

  const range = { from: D(0), to: D(3) };
  const days = dayRollups(sessions, blocks, range);
  eq('the series covers every calendar day in the window', days.length, 4);
  eq('a rest day is present', days[1].date, D(1));
  eq('and it is a genuine zero, not a gap', days[1].load, 0);
  ok('a rest day is marked as untrained', days[1].trained === false);
}

/* ---- an unrated drill must never become a zero ------------------------ */

{
  const sessions = [ses('s1', D(0))];
  const blocks = [blk('s1', 6, 20), blk('s1', null, 20, { unrated: true })];
  const day = dayRollup(D(0), blocks, sessions);

  eq('an unrated drill contributes no load', day.load, 120);
  eq('but its minutes still count as court time', day.minutes, 40);
  eq('so the day reports half its time uncovered', day.coverage, 0.5);
  eq('and names the run that is missing', day.unrated.length, 1);
  ok('the day is incomplete, not light — coverage says so', day.coverage < 1);

  const cov = windowCoverage([day]);
  eq('window coverage carries it up to the week', cov.fraction, 0.5);
  eq('and counts the unrated runs', cov.unratedRuns, 1);
}

/* ---- the game week, from the coach's own label -------------------------- */

{
  const sessions = [
    ses('a1', D(3),  { gameDay: 'GD-2', startedAt: '2026-03-05T17:00:00Z', endedAt: '2026-03-05T18:40:00Z' }),
    ses('a2', D(4),  { gameDay: 'GD-1' }),
    ses('ga', D(5),  { gameDay: 'GD', type: 'Game' }),
    ses('b1', D(10), { gameDay: 'GD-2' }),
    ses('b2', D(11), { gameDay: 'GD-1' }),
    ses('c1', D(17), { gameDay: 'GD-X' }),        // more than five days out
    ses('c2', D(18), {}),                          // never labelled
  ];
  const blocks = [
    blk('a1', 8, 60, { category: 'Live / scrimmage', liveMs: 30 * 60000 }),
    blk('a1', 4, 20, { category: 'Defense' }),
    blk('a2', 4, 30, { category: 'Shooting', liveMs: 12 * 60000 }),
    blk('b1', 8, 50, { category: 'Live / scrimmage', liveMs: 20 * 60000 }),
    blk('b2', 5, 30, { category: 'Shooting' }),
    blk('b2', 3, 10, { category: 'Warm-up' }),
    blk('c1', 6, 40, { category: 'Conditioning' }),
    blk('c2', 6, 40, { category: 'Conditioning' }),
  ];

  const rollups = sessionRollups(sessions, blocks, []);
  eq('one row per practice', rollups.length, 7);
  eq('a practice knows its clocked length', rollups[0].minutes, 80);
  eq('and its wall clock when it has one', rollups[0].wallMinutes, 100);
  eq('live density is over the timed drills only', rollups[0].liveDensity, 30 / 60);
  eq('and carries how much it covers', rollups[0].liveCoverage, 60 / 80);

  const cov = gameDayCoverage(rollups);
  eq('an unlabelled practice is counted, not assumed', cov.unset, 1);
  eq('GD-X is its own answer, not the same as unset', cov.excluded, 1);
  eq('and only the game-week ones are compared', cov.compared, 5);

  const cmp = gameWeekComparison(rollups);
  eq('only game-week days appear', cmp.length, 3);
  eq('they read in the order he plans a week', cmp.map((b) => b.key).join(' '), 'GD-2 GD-1 GD');
  ok('GD-X never appears', !cmp.some((b) => b.key === 'GD-X'));

  const gd1 = cmp.find((b) => b.key === 'GD-1');
  const gd2 = cmp.find((b) => b.key === 'GD-2');
  eq('GD-1 pools two practices', gd1.n, 2);
  eq('average practice length', gd1.meanMinutes, 35);      // 30 and 40
  eq('the spread is kept', gd1.minMinutes, 30);
  eq('average load', gd1.meanLoad, (120 + 180) / 2);
  eq('average drills per practice', gd1.meanDrills, 1.5);
  eq('GD-2 is longer than GD-1', gd2.meanMinutes, 65);

  // Pooled, not the mean of the percentages: a 60-minute drill must not weigh
  // the same as a 4-minute one.
  eq('live density is pooled across the bucket', gd2.liveDensity, (30 + 20) / (60 + 50));
  eq('and reports how much of the time it covers', gd2.liveCoverage, 110 / 130);
  eq('a bucket with nothing timed says null, not zero', gd1.liveDensity, 12 / 30);

  /* ---- what a game day is made of ---- */

  const made = categoryByGameDay(rollups, 'GD-1');
  eq('it knows how many practices it averaged', made.sessions, 2);
  const shooting = made.categories.find((c) => c.category === 'Shooting');
  const warmup = made.categories.find((c) => c.category === 'Warm-up');
  eq('shooting appears in both', shooting.sessionsUsedIn, 2);
  eq('and averages its minutes per practice', shooting.meanMinutes, 30);
  eq('warm-up appeared in only one', warmup.sessionsUsedIn, 1);
  // Divided by every GD-1, not just the one that used it: skipping a category
  // half the time must show up as a lower average.
  eq('a category skipped half the time averages lower', warmup.meanMinutes, 5);
  eq('per-run length is separate from per-practice time', warmup.meanRunMinutes, 10);
  eq('the biggest slice leads', made.categories[0].category, 'Shooting');
  eq('live density per category', shooting.liveDensity, 12 / 30);
  eq('with its own coverage', shooting.liveCoverage, 30 / 60);

  ok('asking for a game day with no practices is empty, not an error',
    categoryByGameDay(rollups, 'GD-5').categories.length === 0);
}

/* ---- the same drill over three timescales ------------------------------- */

{
  const today = D(30);
  const sessions = [
    ses('s1', D(28)),   // inside the last 7 days
    ses('s2', D(10)),   // inside the last 28
    ses('s3', D(0)),    // season only
  ];
  const blocks = [
    blk('s1', 8, 20, { drillId: 'd1', drillName: 'Live 5v5', liveMs: 14 * 60000 }),
    blk('s2', 8, 30, { drillId: 'd1', drillName: 'Live 5v5' }),
    blk('s3', 6, 40, { drillId: 'd1', drillName: 'Live 5v5' }),
  ];

  const w = drillWindowAverages(sessions, blocks, [], today)[0];
  eq('the week window sees one run', w.windows.week.runs, 1);
  eq('the month window sees two', w.windows.month.runs, 2);
  eq('the season sees all three', w.windows.season.runs, 3);

  eq('average length shortens in the recent window', w.windows.week.meanMinutes, 20);
  eq('and is longer over the season', w.windows.season.meanMinutes, 30);
  eq('average load per run, this week', w.windows.week.meanLoad, 160);
  eq('average load per run, all season', w.windows.season.meanLoad, (160 + 240 + 240) / 3);

  eq('live density where it was measured', w.windows.week.liveDensity, 14 / 20);
  eq('and its coverage over the season', w.windows.season.liveCoverage, 20 / 90);

  // A drill not run recently must show an honest empty week, not last month's
  // numbers standing in for it.
  const stale = drillWindowAverages(
    [ses('s9', D(0))],
    [blk('s9', 5, 25, { drillId: 'd9', drillName: 'Old drill' })],
    [], today,
  )[0];
  eq('a drill not run this week shows no runs', stale.windows.week.runs, 0);
  ok('and no average rather than a stale one', stale.windows.week.meanMinutes === null);
  eq('while the season still has it', stale.windows.season.runs, 1);
}

/* ---- drills ------------------------------------------------------------ */

{
  const sessions = [ses('s1', D(0)), ses('s2', D(3))];
  const blocks = [
    blk('s1', 8, 20, { drillId: 'd1', drillName: 'Live 5v5', category: 'Live / scrimmage' }),
    blk('s2', 7, 30, { drillId: 'd1', drillName: 'Live 5v5 (new name)', category: 'Live / scrimmage' }),
    blk('s1', 4, 15, { drillId: 'd2', drillName: 'Shell', category: 'Defense' }),
    blk('s1', null, 10, { drillId: null, drillName: 'Something Ivan sprang on me' }),
  ];
  const drills = [{ id: 'd1', category: 'Live / scrimmage' }, { id: 'd2', category: 'Defense' }];

  const rolls = drillRollups(sessions, blocks, drills);
  const live = rolls.find((r) => r.drillId === 'd1');

  eq('a renamed drill keeps one history', live.runCount, 2);
  eq('and is shown under what he calls it now', live.name, 'Live 5v5 (new name)');
  eq('its load is the sum of its runs', live.load, 8 * 20 + 7 * 30);
  eq('mean intensity across runs', live.meanIntensity, 7.5);
  ok('run-to-run spread is reported', live.sdMinutes > 0);
  eq('the heaviest drill sorts first', rolls[0].drillId, 'd1');

  const courtside = rolls.find((r) => r.name === 'Something Ivan sprang on me');
  eq('a courtside drill with no id still groups', courtside.runCount, 1);
  eq('an unrated run adds no load', courtside.load, 0);
  eq('but is counted as unrated', courtside.unratedRuns, 1);
  eq('and its minutes are still real', courtside.minutes, 10);

  const mix = categoryMix(rolls);
  eq('the biggest category leads', mix[0].category, 'Live / scrimmage');
  eq('shares are of rated load', Math.round(mix[0].share * 100), Math.round((370 / 430) * 100));
  ok('a drill with no category is named honestly',
    mix.some((c) => c.category === 'Not in the library'));
  eq('shares sum to one', Math.round(mix.reduce((s, c) => s + c.share, 0)), 1);
}

/* ---- one player -------------------------------------------------------- */

{
  const sessions = [
    ses('s1', D(0), { rosterIds: ['p1', 'p2'] }),
    ses('s2', D(1), { rosterIds: ['p2'] }),        // p1 was not there
  ];
  const blocks = [
    blk('s1', 6, 20),                               // both, full
    blk('s1', 8, 10, { participation: { p1: 0.5 } }),
    blk('s2', 5, 40),
  ];
  const range = { from: D(0), to: D(1) };

  const p1 = playerDaySeries(sessions, blocks, 'p1', range);
  eq('full participation counts in full', p1[0].load, 6 * 20 + 8 * 10 * 0.5);
  eq('limited counts as half the minutes too', p1[0].minutes, 20 + 5);
  eq('a day off the roster is a real zero', p1[1].load, 0);
  ok('and is marked as not on the roster', p1[1].onRoster === false);

  const p2 = playerDaySeries(sessions, blocks, 'p2', range);
  eq('the player who was there gets the second day', p2[1].load, 200);

  const totals = playerTotals(sessions, blocks, [{ id: 'p1' }, { id: 'p2' }], range);
  eq('the busier player sorts first', totals[0].player.id, 'p2');
  eq('days trained is counted', totals[1].daysTrained, 1);
}

/* ---- week on week ------------------------------------------------------ */

{
  const sessions = [];
  const blocks = [];
  // 100 AU/day for 7 days, then 150 AU/day for 7 days.
  for (let i = 0; i < 14; i++) {
    sessions.push(ses(`s${i}`, D(i)));
    blocks.push(blk(`s${i}`, i < 7 ? 10 : 15, 10));
  }
  const days = dayRollups(sessions, blocks, { from: D(0), to: D(13) });
  const cmp = comparePeriods(days, 7);
  eq('this week totals correctly', cmp.load, 1050);
  eq('last week too', cmp.priorLoad, 700);
  eq('and the change is a percentage', cmp.change, 50);
  eq('training days counted', cmp.trainingDays, 7);

  ok('one week alone has nothing to compare against',
    comparePeriods(days.slice(0, 7), 7).priorLoad === null);
}

/* ---- the provisional ACWR he asked for --------------------------------- */

{
  const flat = [];
  for (let i = 0; i < 40; i++) flat.push({ date: D(i), load: 100 });
  const s = acwrSeries(flat);

  ok('the real ACWR is still withheld before 28 days', s[20].acwr === null);
  ok('a provisional one is offered instead', s[20].provisional !== null);
  eq('and it says how many days it stands on', s[20].daysOfHistory, 21);
  eq('and how many are still to come', s[20].daysUntilReliable, 7);

  // The point of the 7-day floor: below it the two windows are the same days.
  ok('no provisional number in the first week', s[5].provisional === null);
  ok('nor on day seven exactly, where it could only ever read 1.00',
    s[6].provisional === null);
  ok('from day eight it carries information', s[7].provisional !== null);

  ok('once real, the provisional stands down', s[30].provisional === null && s[30].acwr !== null);

  // A provisional number must not invent a spike by dividing by 28 days that
  // do not exist: steady load has to read ~1.0 however short the history.
  eq('steady load reads about 1.0 provisionally', s[14].provisional, 1.0, 1e-9);

  const ramp = [];
  for (let i = 0; i < 20; i++) ramp.push({ date: D(i), load: i < 13 ? 50 : 300 });
  const r = acwrSeries(ramp);
  ok('a real ramp still shows up early', r[19].provisional > 1.5, r[19].provisional);

  ok('the wording always states what it stands on',
    provisionalNote(14).indexOf('14 days') !== -1, provisionalNote(14));
  ok('and the first week is explained, not just blank',
    provisionalNote(4).indexOf('1.00') !== -1, provisionalNote(4));
  ok('once there are 28 days there is no caveat left', provisionalNote(28) === null);
}

/* ---- ranges ------------------------------------------------------------ */

{
  const sessions = [ses('s1', '2026-01-05'), ses('s2', '2026-03-01')];
  const r = rangeFor(sessions, '4w', '2026-03-10');
  eq('a 4-week window ends today, not at the last practice', r.to, '2026-03-10');
  eq('and starts 28 days back', r.from, '2026-02-11');

  const season = rangeFor(sessions, 'season', '2026-03-10');
  eq('the season window starts at the first practice ever', season.from, '2026-01-05');

  const empty = rangeFor([], '4w', '2026-03-10');
  eq('no practices at all still gives a valid window', empty.to, '2026-03-10');
}

/* ======================================================================
   Reports — minutes by category and by drill, over dates he chooses.
   ====================================================================== */

/* ---- calendar periods, not rolling windows ---- */
{
  eq('a week starts on Monday', startOfWeek('2026-03-05'), '2026-03-02');
  eq('Monday is already the start of its own week', startOfWeek('2026-03-02'), '2026-03-02');
  // Sunday is the END of its week, not the start of the next one. Getting this
  // backwards silently moves every Sunday practice into the following week.
  eq('Sunday belongs to the week that just finished', startOfWeek('2026-03-08'), '2026-03-02');

  eq('months start on the first', startOfMonth('2026-03-17'), '2026-03-01');
  eq('and end on the last', endOfMonth('2026-03-17'), '2026-03-31');
  eq('February is handled by the calendar, not by a table', endOfMonth('2028-02-10'), '2028-02-29');
  eq('both ends of a range are included', daysBetween('2026-03-02', '2026-03-08'), 7);

  eq('a day report is one day', periodRange('day', '2026-03-05').from, '2026-03-05');
  eq('a week report runs Monday to Sunday', periodRange('week', '2026-03-05').to, '2026-03-08');
  eq('a month report covers the month', periodRange('month', '2026-03-05').to, '2026-03-31');
  eq('a year report covers the year', periodRange('year', '2026-03-05').from, '2026-01-01');

  // "From 26.10. till 22.12." — and the same two dates typed the other way up.
  const c = periodRange('custom', '2026-03-05', { from: '2026-12-22', to: '2026-10-26' });
  eq('a backwards custom range is straightened out, not rejected', c.from, '2026-10-26');
  eq('and its other end follows', c.to, '2026-12-22');

  eq('a week is read day by day', columnUnitFor('week'), 'day');
  eq('a month is read week by week', columnUnitFor('month'), 'week');
  eq('a year is read month by month', columnUnitFor('year'), 'month');

  eq('a week has seven day columns',
     columnsFor({ from: '2026-03-02', to: '2026-03-08' }, 'day').length, 7);
  // March 2026 opens on a Sunday, so its first week column reaches back into
  // February and the month spans six of them. Six is the right answer, not a
  // rounding slip: the alternative loses that Sunday's practice entirely.
  const weeks = columnsFor({ from: '2026-03-01', to: '2026-03-31' }, 'week');
  eq('a month that opens on a Sunday spans six week columns', weeks.length, 6);
  // The first column has to reach back to the Monday, or a month starting on a
  // Wednesday would report a three-day first week as a full one.
  eq('the first week column starts on its Monday', weeks[0].from, '2026-02-23');
}

/* ---- classifying a run: category is his, the contact rows come from the grid ---- */
{
  const library = new Map([['d1', { id: 'd1', situation: 3, contact: true, category: 'Defense' }]]);

  eq('a snapshotted matchup is used',
     blockMatchup({ situation: 1, contact: true, drillId: 'd1' }, library), 'contact5');
  eq('small-sided contact is its own band',
     blockMatchup({ situation: 4, contact: true, drillId: 'd1' }, library), 'contactSmall');
  eq('no defence is neither',
     blockMatchup({ situation: 1, contact: false, drillId: 'd1' }, library), 'unopposed');

  // Old runs predate the snapshot and fall back to the library, exactly as
  // `category` already does — so the fallback shrinks over time.
  eq('an old run falls back to the library',
     blockMatchup({ situation: null, contact: true, drillId: 'd1' }, library), 'contactSmall');

  // And when neither exists it is UNKNOWN, never quietly counted as 5on5.
  eq('a run with no matchup anywhere is unknown, not assumed',
     blockMatchup({ situation: null, contact: true, drillId: 'gone' }, library), 'unknown');
}

/* ---- his weekly table ---- */
{
  const drills = [
    { id: 'dDef', category: 'Defense', situation: 1, contact: true },
    { id: 'dTr',  category: 'Transition', situation: 3, contact: true },
    { id: 'd1v1', category: 'Live / scrimmage', situation: 5, contact: true },
    { id: 'd5v5', category: 'Live / scrimmage', situation: 1, contact: true },
    { id: 'dSht', category: 'Shooting', situation: 1, contact: false },
  ];
  const run = (sessionId, drill, minutes, liveMinutes, extra = {}) => blk(sessionId, 5, minutes, {
    drillId: drill.id, drillName: drill.id, category: drill.category,
    situation: drill.situation, contact: drill.contact,
    liveMs: liveMinutes === null ? null : liveMinutes * 60000, ...extra,
  });

  // Two training days in one week, one rest day between them.
  const sessions = [
    ses('w1', D(0), { gameDay: 'GD-3' }),
    ses('w2', D(2), { gameDay: 'GD-1' }),
  ];
  const blocks = [
    run('w1', drills[0], 15, null),          // Defense, 5on5 contact, untimed
    run('w1', drills[2], 15, 5),             // 1v1 contact
    run('w1', drills[3], 25, 15),            // 5v5 contact
    run('w2', drills[1], 8, null),           // Transition
    run('w2', drills[3], 10, 5),             // 5v5 contact
    run('w2', drills[4], 20, null),          // Shooting, unopposed
  ];

  const range = periodRange('week', D(0));
  const table = reportTable(sessions, blocks, drills, range, 'day');

  eq('empty days are dropped so the columns that matter stay on screen',
     table.columns.length, 2);
  eq('each column knows where it sat in the game week',
     table.columns.map((c) => c.gameDays.join()).join(' | '), 'GD-3 | GD-1');

  const rowOf = (label) => table.rows.findIndex((r) => r.label === label || r.key === label);
  const cellOf = (label, col) => table.columns[col].cells[rowOf(label)];

  eq('Defense on the first day', cellOf('Defense', 0).minutes, 15);
  eq('Defense is absent on the second, not zeroed', cellOf('Defense', 1), null);
  eq('Transition on the second day', cellOf('Transition', 1).minutes, 8);

  /* THE CONTACT ROWS COME FROM THE CATEGORY (his spec, 2026-09-20, made a
     tree 2026-09-22): 5on5 contact and small-sided contact, each with Live /
     Continuous / Shell inside, then Transition contact. The old single
     "Live / scrimmage" category splits by how many are a side, and a Defense
     drill counts only when there is live play inside it. */
  eq('every category comes first, then only the contact rows',
     table.rows.findIndex((r) => r.kind === 'matchup'),
     table.rows.filter((r) => r.kind === 'category').length);
  eq('his three formats, in his order, with the parts that have anything in them',
     table.rows.filter((r) => r.kind === 'matchup').map((r) => r.key.slice(5)).join(),
     'contact5,c5Cont,c5Shell,contactSmall,smCont,transition,whole');
  {
    const empty = reportRowsFor([], drills).rows.map((r) => r.key.slice(5)).join();
    eq('with nothing run, the three formats are still there and no part is',
       empty, 'contact5,contactSmall,transition,whole');
  }
  eq('small-sided contact is the 1v1 only', cellOf('band:contactSmall', 0).minutes, 15);
  eq('the 5on5 scrimmage from the old live category is 5on5 continuous-or-live work',
     cellOf('band:c5Cont', 0).minutes, 25);
  eq('the 5on5 defensive drill with live play is a 5on5 shell', cellOf('band:c5Shell', 0).minutes, 15);
  eq('and 5on5 contact is its parts added', cellOf('band:contact5', 0).minutes, 40);
  eq('transition has its own', cellOf('band:transition', 1).minutes, 8);

  // "Whole contact" is the rows ADDED, and the unopposed shooting is not in
  // it — the whole point of the row. The format totals are not added twice.
  eq('whole contact adds every contact part', cellOf('Whole contact', 0).minutes, 55);
  /* The category rows and the contact rows are two different cuts of the same
     runs, not a hierarchy. The contested transition drill is counted under
     Transition AND inside Whole contact; the unopposed shooting is in neither
     contact row. This is the one thing about the table that can be misread, so
     the screen says it in a footnote and this pins it down. */
  eq('a contested transition drill is in the contact rows too',
     cellOf('Whole contact', 1).minutes, 18);
  eq('while the unopposed shooting is in neither contact row',
     cellOf('Whole contact', 1).minutes + cellOf('Shooting', 1).minutes,
     table.columns[1].total.minutes);
  eq('while the day total still counts the shooting', table.columns[1].total.minutes, 38);

  /* CONTACT TIME IS THE SECOND STOPWATCH (2026-09-22): only the live part of
     a drill is contact. Pooled over the timed drills, never an average of
     percentages, and an untimed contact drill adds nothing — it is "not
     timed", not zero contact and not its full length. */
  const wholeD1 = cellOf('Whole contact', 0);
  eq('whole contact time is the live minutes', wholeD1.liveMinutes, 20);
  eq('live density is pooled over the timed drills only',
     Math.round(wholeD1.liveDensity * 1000) / 1000, 0.5);
  eq('and coverage says how much of the row that was',
     Math.round(wholeD1.liveCoverage * 1000) / 1000, Math.round((40 / 55) * 1000) / 1000);
  const shellD1 = cellOf('band:c5Shell', 0);
  eq('an untimed shell drill has no contact time', shellD1.liveMinutes, 0);
  eq('and says it was not timed, rather than claiming zero', shellD1.timedRuns, 0);

  const shooting = cellOf('Shooting', 1);
  eq('an untimed row reports no live minutes rather than zero', shooting.liveMinutes, 0);
  eq('and no density at all', shooting.liveDensity, null);
  eq('it declares that nothing in it was timed', shooting.timedRuns, 0);

  eq('nothing is unclassified when every run carries its matchup',
     table.unclassified.runs, 0);

  /* A month keeps its empty weeks: a week off is a fact about the month, where
     an empty Thursday is just a Thursday. */
  const monthly = reportTable(sessions, blocks, drills,
    periodRange('month', D(0)), 'week');
  ok('a month keeps every week column, including the empty ones',
     monthly.columns.length >= 4, String(monthly.columns.length));
  ok('and at least one of them is genuinely empty',
     monthly.columns.some((c) => c.total.minutes === 0));
}

/* ---- a run that cannot be classified is declared, never folded in ---- */
{
  const drills = [{ id: 'known', category: 'Defense', situation: 1, contact: true }];
  const sessions = [ses('s', D(0))];
  const blocks = [
    blk('s', 5, 10, { drillId: 'known', category: 'Defense', situation: 1, contact: true }),
    // Recorded before the snapshot existed, and its drill has since been
    // deleted: there is no category to place it under, now or ever.
    blk('s', 5, 30, { drillId: 'deleted', category: null, situation: null, contact: true }),
  ];
  const table = reportTable(sessions, blocks, drills, periodRange('day', D(0)), 'day');
  const row = (l) => table.rows.find((r) => r.label === l);

  eq('the unclassifiable run is kept out of the contact total', row('Whole contact').minutes, 10);
  eq('and reported instead of vanishing', table.unclassified.runs, 1);
  eq('with its minutes named', table.unclassified.minutes, 30);
  eq('while the day still counts all of it', table.columns[0].total.minutes, 40);
}

/* ---- which drills are contact: his rules, not the grid's -------------
 *
 * The fault that prompted this: a 6on6 warm-up, entered as 5v5 with live
 * defence because the matchup dial stops at five a side, was being counted as
 * whole-squad contact. "Definitely don't count it as a 5on5." Contact now
 * comes from the category, so filing it as a warm-up is the whole fix.
 */
{
  const drills = [
    { id: 'w6',   category: 'Warm-up',          situation: 1, contact: true },
    { id: 'd5',   category: '5on5 live',        situation: 1, contact: true },
    { id: 'dSml', category: 'Small-sided live', situation: 3, contact: true },
    { id: 'c5',   category: 'Continuous games', situation: 1, contact: true },  // 5on5on5
    { id: 'c4',   category: 'Continuous games', situation: 2, contact: true },  // 4on4on4
    { id: 'c3',   category: 'Continuous games', situation: 3, contact: true },  // 3on3on3
    { id: 'shell',category: 'Defense',          situation: 2, contact: true },
    { id: 'shell5',category: 'Defense',         situation: 1, contact: true },
    { id: 'close',category: 'Defense',          situation: 5, contact: true },  // 1on1 closeout
    { id: 'walk', category: 'Defense',          situation: 2, contact: false },
    { id: 'tr',   category: 'Transition',       situation: 3, contact: true },
    { id: 'tr0',  category: 'Transition',       situation: 3, contact: false },
    { id: 'd5x',  category: '5on5 live',        situation: 1, contact: false },
  ];
  const lib = new Map(drills.map((d) => [d.id, d]));
  const runOf = (d) => ({ drillId: d.id, category: d.category, situation: d.situation, contact: d.contact });
  const rowFor = (id, map = null) => contactRowOf(runOf(drills.find((d) => d.id === id)), lib, map);

  eq('a 6on6 warm-up entered as 5v5 is not contact at all', rowFor('w6'), null);
  eq('5on5 live is 5on5 contact, live', rowFor('d5'), 'c5Live');
  eq('small-sided live is small-sided contact, live', rowFor('dSml'), 'smLive');
  eq('5on5on5 is 5on5 contact, continuous', rowFor('c5'), 'c5Cont');
  eq('4on4on4 is small-sided contact, continuous', rowFor('c4'), 'smCont');
  eq('3on3on3 is small-sided contact, continuous', rowFor('c3'), 'smCont');
  eq('a 4on4 defence drill that goes live is a small-sided shell', rowFor('shell'), 'smShell');
  eq('a 5on5 shell drill that goes live is a 5on5 shell', rowFor('shell5'), 'c5Shell');
  eq('a 1on1 closeout drill is a small-sided shell', rowFor('close'), 'smShell');
  eq('a defence drill with nobody defending is not contact', rowFor('walk'), 'noDefence');
  eq('transition with live play is transition contact', rowFor('tr'), 'transition');
  eq('transition with nobody defending is not', rowFor('tr0'), 'noDefence');
  // "Always counted as contact" — the category alone decides these.
  eq('a 5on5 live drill counts whatever its defence flag says', rowFor('d5x'), 'c5Live');

  // His vocabulary, so the mapping is his too — Settings can move a category
  // in or out, and the defaults are only a first guess from the name.
  eq('a category he marks as not contact drops out',
     rowFor('tr', { Transition: null }), null);
  eq('and one he adds is counted',
     rowFor('w6', { 'Warm-up': 'liveSmall' }), 'smLive');
  // What Settings saved before the tree is read, not rewritten.
  eq('an old saved "Contact 5on5" setting reads as 5on5 live',
     rowFor('w6', { 'Warm-up': 'contact5' }), 'c5Live');
  eq('an old "by size" setting reads as continuous',
     rowFor('w6', { 'Warm-up': 'bySize' }), 'c5Cont');
  eq('an old "shell" setting still needs live play',
     rowFor('walk', { Defense: 'shell' }), 'noDefence');

  // A run whose drill was never set up has no category of its own. Calling it
  // "not contact" would quietly shrink the contact totals.
  eq('a drill that has never been set up cannot be placed',
     contactRowOf({ drillId: 'new', category: null, detailsPending: true, contact: null },
       new Map([['new', { id: 'new', unrated: true }]])), 'unknown');
}

/* A drill in a contact category but recorded with no live defence is left out
   of the contact rows AND said out loud — he expects all his transition work
   to be in there, so a total that is quietly short is worse than no total. */
{
  const drills = [{ id: 'tr0', category: 'Transition', situation: 3, contact: false }];
  const rows = reportRowsFor(
    [blk('s', 5, 12, { drillId: 'tr0', category: 'Transition', situation: 3, contact: false })],
    drills);
  eq('unopposed transition is not in the contact rows',
     rows.rows.find((r) => r.key === 'band:whole').minutes, 0);
  eq('but it is reported rather than hidden', rows.noDefence.runs, 1);
  eq('with its minutes', rows.noDefence.minutes, 12);
}

/* ---- the spread of one drill ----------------------------------------
 * His worked example: 5 runs, longest / shortest / average, full time and
 * live time. The live figures are over the TIMED runs only — counting an
 * untimed run as zero live minutes would report a shortest of 0:00 for a
 * drill he simply did not put a second watch on. */
{
  const runs = [
    blk('s', 5, 25, { liveMs: 12.5 * 60000 }),
    blk('s', 5, 15, { liveMs: 8 * 60000 }),
    blk('s', 5, 20, { liveMs: null }),          // ran it, did not time it
  ];
  const sp = spreadOf(runs);
  eq('it counts every run', sp.runs, 3);
  eq('longest full time', sp.maxMinutes, 25);
  eq('shortest full time', sp.minMinutes, 15);
  eq('average full time', sp.meanMinutes, 20);

  eq('only two were timed', sp.timedRuns, 2);
  eq('longest live time', sp.maxLiveMinutes, 12.5);
  eq('shortest live time is from a timed run, not from the untimed one',
     sp.minLiveMinutes, 8);
  eq('average live time is over the timed runs', sp.meanLiveMinutes, 10.25);
  eq('density is pooled over the timed runs', sp.liveDensity, 20.5 / 40);
  eq('coverage says how much of the drill that was', sp.liveCoverage, 40 / 60);

  const none = spreadOf([blk('s', 5, 10, { liveMs: null })]);
  eq('a drill he never timed has no live total, not a zero', none.liveMinutes, null);
  eq('nor a shortest live time', none.minLiveMinutes, null);
  eq('nor a density', none.liveDensity, null);
}

/* ---- the same drill, split by day before the game ---- */
{
  const sessions = [
    ses('a', D(0), { gameDay: 'GD-1' }),
    ses('b', D(3), { gameDay: 'GD-1' }),
    ses('c', D(5), { gameDay: 'GD-2' }),
    ses('d', D(6), {}),                       // he did not say
  ];
  const mk = (sid, mins, live) => blk(sid, 6, mins, {
    drillId: 'hc2', drillName: '5on5, HC+2', category: 'Live / scrimmage',
    situation: 1, contact: true, liveMs: live === null ? null : live * 60000,
  });
  const blocks = [mk('a', 15, 8), mk('b', 10, 6), mk('c', 25, 12.5), mk('d', 20, 10)];

  const rows = drillReport(sessions, blocks, [], { from: D(0), to: D(6) });
  eq('one drill, grouped', rows.length, 1);
  const r = rows[0];
  eq('it kept the name he calls it', r.name, '5on5, HC+2');
  eq('four runs in the window', r.runs, 4);

  const gd1 = r.byGameDay.find((g) => g.gameDay === 'GD-1');
  eq('two of them were GD-1', gd1.runs, 2);
  eq('longest GD-1 run', gd1.maxMinutes, 15);
  eq('shortest GD-1 run', gd1.minMinutes, 10);
  eq('average GD-1 run', gd1.meanMinutes, 12.5);
  eq('average GD-1 live time', gd1.meanLiveMinutes, 7);

  // An unlabelled practice is a THIRD state, not GD-X and not silently dropped.
  const unset = r.byGameDay.find((g) => g.gameDay === null);
  eq('the practice he never labelled is reported as its own row', unset.runs, 1);
  eq('and it is called out rather than guessed at', unset.label, 'Not labelled');

  eq('the game-week rows are read furthest-out first',
     r.byGameDay.map((g) => g.label).join(' '), 'GD-2 GD-1 Not labelled');

  // The window is a real filter, not decoration.
  const narrow = drillReport(sessions, blocks, [], { from: D(0), to: D(0) });
  eq('a one-day window sees one run', narrow[0].runs, 1);
}

/* ---- the game-day filter on reports ---- */
{
  const counts = gameDayCounts([
    ses('a', D(0), { gameDay: 'GD-1' }), ses('b', D(7), { gameDay: 'GD-1' }),
    ses('c', D(1), { gameDay: 'GD-6' }), ses('d', D(2)), ses('e', D(3), { gameDay: 'GD-X' }),
  ]);
  eq('two GD-1 practices are counted', counts['GD-1'], 2);
  eq('GD-6 is counted', counts['GD-6'], 1);
  eq('an unlabelled practice is its own count, not dropped', counts.unset, 1);
  eq('GD-X is its own count too', counts['GD-X'], 1);
  eq('a label nobody used is a real zero', counts['GD-3'], 0);
  ok('the report row offers GD-6 first and GD-1 last', REPORT_GAME_DAYS[0] === 'GD-6' && REPORT_GAME_DAYS[REPORT_GAME_DAYS.length - 1] === 'GD-1');
  ok('and does not offer game day, which has no stopwatch data', REPORT_GAME_DAYS.indexOf('GD') === -1);

  // Defence on 1 of 4 GD-1s, 20 minutes: 5 minutes per GD-1, not 20.
  const cell = { minutes: 20, liveMinutes: 8, timedMinutes: 20, timedRuns: 1, runs: 1, liveDensity: 0.4, liveCoverage: 1 };
  const avg = perPractice(cell, 4);
  eq('per practice divides by every practice in the bucket', avg.minutes, 5);
  eq('live minutes too', avg.liveMinutes, 2);
  eq('the live percentage does not change', avg.liveDensity, 0.4);
  ok('no practices means no average, not zero', perPractice(cell, 0) === null);
}

/* ---- 2026-09-22: a player's contact is the report's contact ----
 * The squad column used to count every drill with live defence at full
 * length — the 6on6 warm-up included, every whistle included. It is now the
 * category's definition and the second stopwatch's measure. */
{
  const sessions = [ses('c1', D(0))];
  const blocks = [
    // 6on6 warm-up entered as 5v5 with live defence: not contact.
    blk('c1', 4, 10, { category: 'Warm-up', situation: 1, contact: true, liveMs: 8 * 60000 }),
    // 5on5 live, 20 min, 12 live; p2 limited.
    blk('c1', 7, 20, { category: '5on5 live', situation: 1, contact: true, liveMs: 12 * 60000, participation: { p2: 0.5 } }),
    // Shell that goes live, not timed.
    blk('c1', 5, 15, { category: 'Defense', situation: 1, contact: true, liveMs: null }),
  ];
  const range = { from: D(0), to: D(0) };
  const p1 = playerDaySeries(sessions, blocks, 'p1', range);
  eq('contact time is the live part of the contact drills only', p1[0].contactMinutes, 12);
  eq('an untimed contact drill is carried apart, not as zero or as contact', p1[0].contactUntimedMinutes, 15);
  const p2 = playerDaySeries(sessions, blocks, 'p2', range);
  eq('a limited player gets half the contact', p2[0].contactMinutes, 6);
  const tot = playerTotals(sessions, blocks, [{ id: 'p1' }], range);
  eq('and the squad table totals it', tot[0].contactMinutes, 12);
  eq('with the untimed part beside it', tot[0].contactUntimedMinutes, 15);
  eq('a warm-up is not contact, whatever its matchup', contactTimeOf(blocks[0], new Map()), null);
}

/* ---- 2026-09-22: Analysis in plain words ----
 * Every clause is a number the screen already shows, and the honesty rules
 * go into the sentence with it. */
{
  const sessions = [];
  const blocks = [];
  for (let i = 0; i < 14; i++) {
    sessions.push(ses(`p${i}`, D(i)));
    blocks.push(blk(`p${i}`, 5, i < 7 ? 20 : 24));   // 100 AU/day, then 120
  }
  const range = { from: D(0), to: D(13) };
  const days = dayRollups(sessions, blocks, range);
  const timed = { minutes: 40, timedRuns: 2, liveMinutes: 25, liveCoverage: 1 };
  const lines = plainSummary({ label: 'Inseason so far', days, sessionCount: 14, contact: timed });
  ok('it opens with the window, the practices, court time and load',
    lines[0].indexOf('Inseason so far: 14 practices') === 0 && lines[0].indexOf('AU') !== -1, lines[0]);
  ok('it compares the last 7 days with the 7 before', lines.some((l) => l.indexOf('20% more than') !== -1), lines.join(' | '));
  ok('contact is the live time, said the way a coach says it', lines.some((l) => l.indexOf('Contact: 25 min') === 0), lines.join(' | '));

  const partly = plainSummary({ label: 'X', days, sessionCount: 14, contact: { minutes: 40, timedRuns: 1, liveMinutes: 10, liveCoverage: 0.5 } });
  ok('partly timed contact says it is short', partly.some((l) => l.indexOf('so this is short') !== -1));
  const none = plainSummary({ label: 'X', days, sessionCount: 14, contact: { minutes: 40, timedRuns: 0, liveMinutes: 0, liveCoverage: 0 } });
  ok('untimed contact is named, never a zero', none.some((l) => l.indexOf('none were timed') !== -1) && !none.some((l) => l.indexOf('Contact: 0') !== -1));

  const unratedDays = dayRollups([ses('u', D(0))], [blk('u', null, 20)], { from: D(0), to: D(0) });
  const u = plainSummary({ label: 'X', days: unratedDays, sessionCount: 1, contact: null });
  ok('unrated drills make the load incomplete, and it says so', u[0].indexOf('incomplete, 1 drill run still unrated') !== -1, u[0]);

  const prov = plainSummary({ label: 'X', days, sessionCount: 14, contact: null, acwrPoint: { acwr: null, provisional: 1.2 } });
  ok('a provisional ratio is marked provisional in the sentence', prov.some((l) => l.indexOf('1.20 (provisional)') !== -1), prov.join(' | '));
  const real = plainSummary({ label: 'X', days, sessionCount: 14, contact: null, acwrPoint: { acwr: 1.2, provisional: 1.2 } });
  ok('a real one is not', real.some((l) => l.indexOf('Acute:chronic 1.20 —') === 0));
  // The wording is a prompt to look, never a diagnosis — same rule as gapFlag.
  const words = [...lines, ...partly, ...none, ...u, ...prov].join(' ').toLowerCase();
  ok('no injury or overtraining language', !/injur|overtrain|risk of|danger/.test(words), words);
  // The first inseason week is compared with the last preseason one: load
  // does not reset when a phase starts.
  const phaseOnly = plainSummary({ label: 'Inseason', days: days.slice(7), sessionCount: 7, contact: null, recentDays: days });
  ok('a week at the start of a phase is compared with the week before it',
    phaseOnly.some((l) => l.indexOf('20% more than') !== -1), phaseOnly.join(' | '));
  eq('an empty window says so plainly', plainSummary({ label: 'Preseason', days: [], sessionCount: 0 })[0], 'Preseason: nothing recorded.');
}

print(`\n${pass} passed, ${fail} failed`);
if (fail) throw new Error(`${fail} test(s) failed`);
