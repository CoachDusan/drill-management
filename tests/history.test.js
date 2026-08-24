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
  gameDates, gameDayLabel, gameDayBuckets,
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

/* ---- game days --------------------------------------------------------- */

{
  // Game on the Saturday (D(5)) and the following Wednesday (D(9)).
  const sessions = [
    ses('g1', D(5), { type: 'Game' }),
    ses('g2', D(9), { type: 'Game' }),
    ses('s1', D(4)),
  ];

  const games = gameDates(sessions);
  eq('a game needs no new record — type Game is enough', games.length, 2);
  eq('games come back sorted', games[0], D(5));

  eq('the day before a game is GD-1', gameDayLabel(D(4), games).label, 'GD-1');
  eq('two days before is GD-2', gameDayLabel(D(3), games).label, 'GD-2');
  eq('game day itself is GD', gameDayLabel(D(5), games).label, 'GD');
  eq('the day after is GD+1', gameDayLabel(D(6), games).label, 'GD+1');

  // D(7) is 2 days after Saturday and 2 days before Wednesday. Preparation
  // for the next game wins the tie: that is the decision he is making.
  eq('a tie goes to the game ahead', gameDayLabel(D(7), games).label, 'GD-2');

  ok('a day far from any game gets no label',
    gameDayLabel(addDays(D(9), 6), games) === null);
  ok('with no games at all, nothing is labelled',
    gameDayLabel(D(3), []) === null);

  // Upcoming fixtures merge in, so today can read GD-1 before the game exists.
  const withFixture = gameDates(sessions, [{ date: D(14) }]);
  eq('a scheduled fixture counts as a game date', withFixture.length, 3);
  eq('a fixture on a day already played collapses',
    gameDates(sessions, [{ date: D(5) }]).length, 2);
}

/* ---- game-day buckets -------------------------------------------------- */

{
  // Two full game weeks so GD-1 has two days behind it.
  const sessions = [
    ses('a1', D(3)), ses('a2', D(4)),  ses('ga', D(5), { type: 'Game' }),
    ses('b1', D(10)), ses('b2', D(11)), ses('gb', D(12), { type: 'Game' }),
  ];
  const blocks = [
    blk('a1', 8, 60),                    // GD-2, heavy: 480
    blk('a2', 4, 30),                    // GD-1, light: 120
    blk('b1', 8, 50),                    // GD-2: 400
    blk('b2', 5, 30),                    // GD-1: 150
  ];
  const range = { from: D(0), to: D(12) };
  const days = dayRollups(sessions, blocks, range);
  const buckets = gameDayBuckets(days, gameDates(sessions));

  const gd1 = buckets.find((b) => b.key === 'GD-1');
  const gd2 = buckets.find((b) => b.key === 'GD-2');

  eq('GD-1 is built from two days', gd1.n, 2);
  eq('and averages them', gd1.meanLoad, 135);
  eq('GD-2 averages its own two', gd2.meanLoad, 440);
  ok('the day before a game is lighter than two days before', gd1.meanLoad < gd2.meanLoad);
  eq('the spread is kept, not just the mean', gd1.minLoad, 120);
  eq('mean drill length is reported per day', gd1.meanDrillMinutes, 30);

  // Countdown first, then game day, then the days after — the order he reads
  // a week in. Asserted as a property so the window's edges cannot break it.
  const order = buckets.map((b) => b.order);
  ok('buckets read in the order he plans a week',
    order.every((v, i) => i === 0 || v > order[i - 1]), buckets.map((b) => b.key).join(' '));
  const at = (k) => buckets.findIndex((b) => b.key === k);
  ok('GD-1 sits immediately before game day', at('GD') === at('GD-1') + 1);
  ok('and the days after a game come last', at('GD+1') > at('GD'));

  // A rest day on GD-1 is a real, deliberate GD-1 and must pull the mean down.
  const withRest = gameDayBuckets(
    dayRollups(
      [...sessions, ses('gc', addDays(D(12), 7), { type: 'Game' })],
      blocks,
      { from: D(0), to: addDays(D(12), 7) },
    ),
    gameDates([...sessions, ses('gc', addDays(D(12), 7), { type: 'Game' })]),
  );
  const gd1b = withRest.find((b) => b.key === 'GD-1');
  eq('a third GD-1 with no practice still counts as a GD-1', gd1b.n, 3);
  eq('and drags the average down rather than being dropped', gd1b.meanLoad, 90);
  eq('the rest day is reported', gd1b.restDays, 1);
  ok('but it does not distort the average drill length',
    gd1b.meanDrillMinutes === 30, gd1b.meanDrillMinutes);
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
