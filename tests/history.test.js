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

print(`\n${pass} passed, ${fail} failed`);
if (fail) throw new Error(`${fail} test(s) failed`);
