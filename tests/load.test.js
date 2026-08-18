/* tests/load.test.js — run with:
 *   /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m tests/load.test.js
 *
 * Pure maths only, no browser needed. These are the numbers the coach will
 * make decisions from, so they get checked.
 */

import {
  blockLiveDensity, blockLiveMinutes, sessionLiveDensity,
  sessionLiveMinutesByPlayer, fmtDensity,
  blockLoad, blockMinutes, participationOf, playerBlockLoad,
  sessionLoadByPlayer, sessionMinutesByPlayer, sessionTeamLoad,
  sRPELoad, dailySeries, acwrSeries, monotonySeries, weekOverWeek,
  acwrFlag, monotonyFlag, fmtClock,
} from '../js/load.js';
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

const mins = (m) => ({ elapsedMs: m * 60000, running: false, lastResumedAt: null });
const block = (intensity, m, participation = {}) => ({ ...mins(m), intensity, participation });

/* ---- base unit ---- */
eq('20 min at intensity 7 = 140 AU', blockLoad(block(7, 20)), 140);
eq('minutes from elapsed ms', blockMinutes(mins(12.5)), 12.5);
eq('zero-length drill is zero load', blockLoad(block(9, 0)), 0);

/* ---- a running clock keeps counting ---- */
const live = { elapsedMs: 60000, running: true, lastResumedAt: new Date(Date.now() - 30000).toISOString(), intensity: 6, participation: {} };
ok('running clock adds live time', Math.abs(blockMinutes(live) - 1.5) < 0.05, blockMinutes(live));

/* ---- participation ---- */
eq('unlisted player counts as full', participationOf(block(5, 10), 'p1'), 1);
eq('player marked out counts as zero', participationOf(block(5, 10, { p1: 0 }), 'p1'), 0);
eq('limited player gets half the load', playerBlockLoad(block(8, 10, { p1: 0.5 }), 'p1'), 40);
eq('player who sat out gets no load', playerBlockLoad(block(8, 10, { p1: 0 }), 'p1'), 0);

/* ---- session roll-up ---- */
const blocks = [
  block(5, 10),                 // 50 AU everyone
  block(8, 20, { p2: 0 }),      // 160 AU, p2 out
  block(3, 15, { p3: 0.5 }),    // 45 AU, p3 half
];
const ids = ['p1', 'p2', 'p3'];
const loads = sessionLoadByPlayer(blocks, ids);
eq('full participant total', loads.get('p1'), 50 + 160 + 45);
eq('player who missed a drill', loads.get('p2'), 50 + 0 + 45);
eq('player on limited minutes', loads.get('p3'), 50 + 160 + 22.5);
eq('team load ignores participation', sessionTeamLoad(blocks), 255);

const minutesBy = sessionMinutesByPlayer(blocks, ids);
eq('minutes for full participant', minutesBy.get('p1'), 45);
eq('minutes skip drills sat out', minutesBy.get('p2'), 25);
eq('limited minutes count half', minutesBy.get('p3'), 10 + 20 + 7.5);

/* ---- the player's own rating ---- */
eq('sRPE load = rpe x minutes', sRPELoad(7, 90), 630);
eq('no rating gives no sRPE load', sRPELoad(null, 90), null);

/* ---- daily series fills rest days ---- */
const from = '2026-01-01';
const to = addDays(from, 6);
const series = dailySeries([
  { date: '2026-01-01', load: 300 },
  { date: '2026-01-01', load: 100 },   // two sessions same day
  { date: '2026-01-04', load: 500 },
], from, to);
eq('series covers every calendar day', series.length, 7);
eq('same-day sessions add up', series[0].load, 400);
eq('rest day is an explicit zero', series[1].load, 0);
eq('later session lands on right day', series[3].load, 500);

/* ---- ACWR ---- */
const steady = dailySeries(
  Array.from({ length: 40 }, (_, i) => ({ date: addDays(from, i), load: 100 })),
  from, addDays(from, 39));
const acwr = acwrSeries(steady);
ok('ACWR withheld before 28 days of history', acwr[26].acwr === null && acwr[26].sufficient === false);
ok('ACWR available from day 28', acwr[27].sufficient === true);
eq('steady load gives ACWR of 1.0', acwr[35].acwr, 1.0, 1e-9);

const spike = steady.map((p, i) => ({ ...p, load: i >= 35 ? 300 : 100 }));
const spikeAcwr = acwrSeries(spike);
ok('a tripled week pushes ACWR well above 1.5', spikeAcwr[39].acwr > 1.5, spikeAcwr[39].acwr);
eq('spike is flagged', acwrFlag(spikeAcwr[39].acwr).level, 'high');
eq('steady is flagged ok', acwrFlag(1.0).level, 'ok');
eq('no history is flagged unknown', acwrFlag(null).level, 'unknown');

/* ---- monotony ---- */
const flat = dailySeries(
  Array.from({ length: 7 }, (_, i) => ({ date: addDays(from, i), load: 200 })),
  from, addDays(from, 6));
const flatMono = monotonySeries(flat);
ok('identical days give no variation, so monotony is withheld', flatMono[6].monotony === null);

const varied = dailySeries([
  { date: from, load: 400 }, { date: addDays(from, 1), load: 100 },
  { date: addDays(from, 2), load: 500 }, { date: addDays(from, 3), load: 0 },
  { date: addDays(from, 4), load: 350 }, { date: addDays(from, 5), load: 150 },
  { date: addDays(from, 6), load: 0 },
], from, addDays(from, 6));
const vm = monotonySeries(varied)[6];
eq('weekly total', vm.weekly, 1500);
ok('good hard/easy contrast reads as low monotony', vm.monotony < 1.5, vm.monotony);
eq('strain is weekly load x monotony', vm.strain, vm.weekly * vm.monotony, 1e-9);
eq('monotony flag reads ok', monotonyFlag(vm.monotony).level, 'ok');
eq('high monotony flagged', monotonyFlag(2.4).level, 'high');

/* a grindingly similar week */
const samey = dailySeries(
  [420, 400, 430, 410, 405, 415, 425].map((v, i) => ({ date: addDays(from, i), load: v })),
  from, addDays(from, 6));
ok('every-day-the-same week reads as high monotony', monotonySeries(samey)[6].monotony > 2.0,
  monotonySeries(samey)[6].monotony);

/* ---- week over week ---- */
const twoWeeks = dailySeries(
  Array.from({ length: 14 }, (_, i) => ({ date: addDays(from, i), load: i < 7 ? 100 : 150 })),
  from, addDays(from, 13));
eq('50% heavier week reads as +50%', weekOverWeek(twoWeeks), 50);
eq('not enough history returns nothing', weekOverWeek(twoWeeks.slice(0, 10)), null);

/* ---- live density -----------------------------------------------------
 * live density = time the ball was live / total drill time
 */

const timed = (totalMin, liveMin) => ({
  ...mins(totalMin), intensity: 5, participation: {}, liveMs: liveMin * 60000,
});
const untimed = (totalMin) => ({ ...mins(totalMin), intensity: 5, participation: {}, liveMs: null });

eq('12 live minutes in a 20 minute drill is 60%', blockLiveDensity(timed(20, 12)), 0.6);
eq('a fully live drill is 100%', blockLiveDensity(timed(10, 10)), 1);
eq('no live time at all is 0%, not null', blockLiveDensity(timed(10, 0)), 0);
eq('an untimed drill is null, NOT zero', blockLiveDensity(untimed(20)), null);
eq('a drill with no duration cannot have a density', blockLiveDensity(timed(0, 0)), null);
eq('live time longer than the drill is capped at 100%', blockLiveDensity(timed(10, 15)), 1);

eq('live minutes are reported', blockLiveMinutes(timed(20, 12)), 12);
eq('untimed means no live minutes figure', blockLiveMinutes(untimed(20)), null);
eq('live minutes cannot exceed the drill', blockLiveMinutes(timed(10, 15)), 10);

/* a session mixing timed and untimed drills */
const mixed = [timed(20, 12), timed(10, 4), untimed(30)];
const dens = sessionLiveDensity(mixed);
eq('density is worked out over the timed drills only', dens.density, 16 / 30);
eq('and the timed minutes are reported', dens.timedMinutes, 30);
eq('live minutes are totalled', dens.liveMinutes, 16);
eq('total court time includes the untimed drill', dens.totalMinutes, 60);
eq('two of three drills were timed', dens.timedCount, 2);
eq('coverage says half the session was timed', dens.coverage, 0.5);

ok('an untimed drill never drags the density down',
  sessionLiveDensity([timed(20, 12), untimed(100)]).density === 0.6);

const none = sessionLiveDensity([untimed(20), untimed(10)]);
eq('a session with nothing timed has no density', none.density, null);
eq('and zero coverage', none.coverage, 0);
eq('an empty session has no density', sessionLiveDensity([]).density, null);

/* per player */
const liveBy = sessionLiveMinutesByPlayer([timed(20, 12)], ['p1', 'p2']);
eq('every player in the drill gets the live minutes', liveBy.get('p1'), 12);
eq('a limited player gets half',
  sessionLiveMinutesByPlayer([{ ...timed(20, 12), participation: { p1: 0.5 } }], ['p1']).get('p1'), 6);
eq('a player who sat out gets none',
  sessionLiveMinutesByPlayer([{ ...timed(20, 12), participation: { p1: 0 } }], ['p1']).get('p1'), 0);
eq('untimed drills add no live minutes for anyone',
  sessionLiveMinutesByPlayer([untimed(30)], ['p1']).get('p1'), 0);

eq('density formats as a percentage', fmtDensity(0.625), '63%');
eq('an unmeasured density shows a dash, not 0%', fmtDensity(null), '—');
eq('zero density shows as 0%', fmtDensity(0), '0%');

/* a running clock keeps the density honest as the drill goes on */
const stillRunning = {
  elapsedMs: 5 * 60000, running: true,
  lastResumedAt: new Date(Date.now() - 5 * 60000).toISOString(),
  intensity: 5, participation: {}, liveMs: 5 * 60000,
};
ok('density falls as an unfinished drill keeps running',
  blockLiveDensity(stillRunning) < 0.55, String(blockLiveDensity(stillRunning)));

/* ---- clock formatting ---- */
eq('clock under an hour', fmtClock(9 * 60000 + 5000), '9:05');
eq('clock over an hour', fmtClock(3 * 3600000 + 4 * 60000 + 9000), '3:04:09');
eq('zero clock', fmtClock(0), '0:00');

print(`\n${pass} passed, ${fail} failed`);
if (fail) throw new Error(`${fail} test(s) failed`);
