/* history.js — many practices, one picture over time.
 *
 * load.js answers "what did this drill / this session cost". This file answers
 * the questions that only appear once there are weeks of them:
 *
 *   Where is the load actually coming from — which drills, which categories?
 *   What does a day before a game look like, compared to every other one?
 *   Is this week heavier than the last three?
 *
 * Everything here is aggregation. There is no new measurement and no new
 * model — if a number cannot be built out of what load.js already computes,
 * it does not belong in this file.
 *
 * THE RULE THAT TRAVELS WITH EVERY TOTAL IN HERE: an unrated drill is null,
 * not zero. Summing a week with a third of it unrated and presenting the
 * total as the week's load makes a heavy week read as a light one. Every
 * roll-up therefore carries its own coverage, and the screen has to say so.
 */

import { TISSUE, toDateKey, addDays } from './models.js';
import {
  blockMinutes, blockLoad, blockTissue, blockContactMinutes,
  participationOf, blockLiveMinutes,
} from './load.js';

/* ---- ranges ----------------------------------------------------------- */

export const RANGES = [
  { key: '2w',     label: '2 weeks', days: 14 },
  { key: '4w',     label: '4 weeks', days: 28 },
  { key: '8w',     label: '8 weeks', days: 56 },
  { key: 'season', label: 'Season',  days: null },
];

/**
 * The window to analyse.
 *
 * `to` is always today, never the last recorded practice. Three rest days at
 * the end of the window are part of the picture: monotony and the acute
 * window are both wrong if the series quietly stops at the last session.
 */
export function rangeFor(sessions, key = '4w', today = toDateKey(new Date())) {
  const dates = sessions.map((s) => s.date).filter(Boolean).sort();
  const first = dates.length ? dates[0] : today;
  const last = dates.length ? dates[dates.length - 1] : today;
  const to = last > today ? last : today;   // a session dated ahead of today still counts
  const spec = RANGES.find((r) => r.key === key) || RANGES[1];
  const from = spec.days === null ? first : maxDate(first, addDays(to, -(spec.days - 1)));
  return { from, to, key: spec.key, label: spec.label, firstEver: first };
}

function maxDate(a, b) { return a > b ? a : b; }

/* ---- one day ---------------------------------------------------------- */

/** Blocks keyed by the calendar day their session belongs to. */
export function blocksByDate(sessions, blocks) {
  const dateOf = new Map(sessions.map((s) => [s.id, s.date]));
  const out = new Map();
  for (const b of blocks) {
    const d = dateOf.get(b.sessionId);
    if (!d) continue;                       // orphan: its session was deleted
    if (!out.has(d)) out.set(d, []);
    out.get(d).push(b);
  }
  return out;
}

/**
 * Everything about one calendar day. A day can hold more than one session
 * (a shootaround and a lift), and the coach thinks in days, so the day is the
 * unit — not the session.
 *
 * `load` is full-participation team load: what the day cost a player who did
 * every drill. Per-player numbers come from playerDaySeries below.
 *
 * `meanDrillMinutes` is the average length of a drill run that day. Note this
 * is per RUN, not wall-clock: when practice splits into groups two clocks run
 * at once, so the drill minutes of a day can exceed the length of the session.
 */
export function dayRollup(date, dayBlocks = [], daySessions = []) {
  let load = 0, minutes = 0, ratedMinutes = 0, contactMinutes = 0;
  let taggedMinutes = 0, liveMinutes = 0, timedMinutes = 0;
  const unrated = [];
  const tissue = {};
  for (const t of TISSUE) tissue[t.key] = 0;

  for (const b of dayBlocks) {
    const m = blockMinutes(b);
    minutes += m;

    const l = blockLoad(b);
    if (l === null) unrated.push(b);
    else { load += l; ratedMinutes += m; }

    contactMinutes += blockContactMinutes(b);

    if (TISSUE.some((t) => b.tissue && b.tissue[t.key] !== null && b.tissue[t.key] !== undefined)) {
      taggedMinutes += m;
    }
    for (const t of TISSUE) {
      const s = blockTissue(b, t.key);
      if (s !== null) tissue[t.key] += s;
    }

    const live = blockLiveMinutes(b);
    if (live !== null) { liveMinutes += live; timedMinutes += m; }
  }

  return {
    date,
    sessions: daySessions,
    blocks: dayBlocks,
    trained: dayBlocks.length > 0,
    load,
    minutes,
    ratedMinutes,
    // Coverage is 1 for a rest day: nothing was asked for, so nothing is missing.
    coverage: minutes ? ratedMinutes / minutes : 1,
    unrated,
    drillCount: dayBlocks.length,
    meanDrillMinutes: dayBlocks.length ? minutes / dayBlocks.length : null,
    contactMinutes,
    tissue,
    tissueCoverage: minutes ? taggedMinutes / minutes : 1,
    liveMinutes,
    liveDensity: timedMinutes ? liveMinutes / timedMinutes : null,
    liveCoverage: minutes ? timedMinutes / minutes : 0,
    types: [...new Set(daySessions.map((s) => s.type).filter(Boolean))],
  };
}

/**
 * A continuous day-by-day series across the window, rest days included as
 * genuine zeros. The zeros are not padding — monotony is the measure of
 * whether hard days and easy days differ, and it is meaningless without them.
 */
export function dayRollups(sessions, blocks, range) {
  const byDate = blocksByDate(sessions, blocks);
  const sessionsByDate = new Map();
  for (const s of sessions) {
    if (!s.date) continue;
    if (!sessionsByDate.has(s.date)) sessionsByDate.set(s.date, []);
    sessionsByDate.get(s.date).push(s);
  }

  const out = [];
  let cursor = range.from;
  let guard = 0;
  while (cursor <= range.to && guard++ < 4000) {
    out.push(dayRollup(cursor, byDate.get(cursor) || [], sessionsByDate.get(cursor) || []));
    cursor = addDays(cursor, 1);
  }
  return out;
}

/** Feed for load.js's dailySeries / acwrSeries / monotonySeries. */
export function loadSeries(days) {
  return days.map((d) => ({ date: d.date, load: d.load }));
}

/** How much of a whole window has an intensity behind it. */
export function windowCoverage(days) {
  let rated = 0, total = 0, unrated = 0;
  for (const d of days) { rated += d.ratedMinutes; total += d.minutes; unrated += d.unrated.length; }
  return { ratedMinutes: rated, totalMinutes: total, unratedRuns: unrated, fraction: total ? rated / total : 1 };
}

/* ---- game days ---------------------------------------------------------
 *
 * The coach plans in days relative to the next game, not in calendar weeks:
 * GD-1 is the day before a game and should look nothing like GD-3. Comparing
 * every GD-1 of the season against each other is the question — "is my day
 * before a game actually staying light, or has it crept up?"
 *
 * Games need no new record. A game is a session with type 'Game', which the
 * app has always been able to store. The only thing missing is a game that
 * has not happened yet, so an upcoming-fixture list is merged in here; a
 * fixture on a date that later has a real Game session simply collapses into
 * the same day.
 */

export const GAME_TYPES = ['Game'];

/** Every date the squad plays, past (recorded) and future (scheduled). */
export function gameDates(sessions, fixtures = []) {
  const set = new Set();
  for (const s of sessions) if (GAME_TYPES.includes(s.type) && s.date) set.add(s.date);
  for (const f of fixtures) {
    const d = typeof f === 'string' ? f : (f && f.date);
    if (d) set.add(d);
  }
  return [...set].sort();
}

/**
 * Label one day relative to the nearest game.
 *
 * Countdown wins ties: with a game either side, the day belongs to the
 * preparation for the next one, which is what the coach is deciding about.
 * `maxAfter` is small on purpose — GD+1 is a recovery day and means something,
 * GD+4 is just a Tuesday.
 */
export function gameDayLabel(date, games, { maxBefore = 7, maxAfter = 2 } = {}) {
  if (!games.length) return null;
  if (games.includes(date)) return { key: 'GD', label: 'GD', offset: 0, order: 0 };

  let before = null, after = null;
  for (const g of games) {
    if (g < date) before = g;                    // games are sorted; keep the latest
    else if (after === null) after = g;          // first one ahead
  }

  const toNext = after ? daysBetween(date, after) : null;
  const sinceLast = before ? daysBetween(before, date) : null;

  if (toNext !== null && toNext <= maxBefore && (sinceLast === null || toNext <= sinceLast)) {
    return { key: `GD-${toNext}`, label: `GD-${toNext}`, offset: -toNext, order: -toNext };
  }
  if (sinceLast !== null && sinceLast <= maxAfter) {
    return { key: `GD+${sinceLast}`, label: `GD+${sinceLast}`, offset: sinceLast, order: sinceLast };
  }
  return null;   // too far from any game to be about a game
}

function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00`) - Date.parse(`${a}T00:00:00`)) / 86400000);
}

/**
 * Group the window's days by their game-day label.
 *
 * Every bucket carries `n` — how many days it is built from — because with
 * two of them a mean is not a mean, and the screen has to say which it is.
 * Rest days are kept: a GD-1 the squad did nothing on is a real, deliberate
 * GD-1, and dropping it would flatter the average.
 */
export function gameDayBuckets(days, games, opts = {}) {
  const map = new Map();
  for (const d of days) {
    const gd = gameDayLabel(d.date, games, opts);
    if (!gd) continue;
    if (!map.has(gd.key)) map.set(gd.key, { key: gd.key, label: gd.label, order: gd.order, days: [] });
    map.get(gd.key).days.push(d);
  }

  const out = [...map.values()].map((b) => {
    const loads = b.days.map((d) => d.load);
    const drillDays = b.days.filter((d) => d.drillCount > 0);
    const covered = b.days.reduce((s, d) => s + d.ratedMinutes, 0);
    const total = b.days.reduce((s, d) => s + d.minutes, 0);
    return {
      ...b,
      n: b.days.length,
      meanLoad: mean(loads),
      minLoad: loads.length ? Math.min(...loads) : null,
      maxLoad: loads.length ? Math.max(...loads) : null,
      sdLoad: sd(loads),
      meanMinutes: mean(b.days.map((d) => d.minutes)),
      // Averaged over the days that actually had drills: a rest day has no
      // average drill length, and counting it as zero would be a lie.
      meanDrillMinutes: mean(drillDays.map((d) => d.meanDrillMinutes)),
      meanDrillCount: mean(drillDays.map((d) => d.drillCount)),
      restDays: b.days.length - drillDays.length,
      contactMinutes: mean(b.days.map((d) => d.contactMinutes)),
      coverage: total ? covered / total : 1,
    };
  });

  // GD-4, GD-3, GD-2, GD-1, GD, GD+1 — the way he reads a week.
  return out.sort((a, b) => a.order - b.order);
}

function mean(arr) {
  const v = arr.filter((x) => x !== null && x !== undefined && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

function sd(arr) {
  const v = arr.filter((x) => x !== null && x !== undefined && Number.isFinite(x));
  if (v.length < 2) return null;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1));
}

/* ---- drills ------------------------------------------------------------
 *
 * Which drills are actually doing the work. Grouped by drillId where there is
 * one, so renaming a drill does not split its history in two; the name shown
 * is the most recent snapshot, because that is what he calls it now.
 *
 * A drill created courtside has no drillId, so those group by name instead.
 */
export function drillRollups(sessions, blocks, drills = []) {
  const dateOf = new Map(sessions.map((s) => [s.id, s.date]));
  const library = new Map(drills.map((d) => [d.id, d]));
  const groups = new Map();

  for (const b of blocks) {
    const date = dateOf.get(b.sessionId);
    if (!date) continue;
    const key = b.drillId || `name:${String(b.drillName || '').trim().toLowerCase()}`;
    if (!groups.has(key)) {
      groups.set(key, { key, drillId: b.drillId || null, name: b.drillName || 'Unnamed drill', runs: [] });
    }
    const g = groups.get(key);
    g.runs.push({ block: b, date });
    if (date >= (g.lastDate || '')) { g.lastDate = date; g.name = b.drillName || g.name; }
  }

  return [...groups.values()].map((g) => {
    const minutes = g.runs.reduce((s, r) => s + blockMinutes(r.block), 0);
    const rated = g.runs.filter((r) => blockLoad(r.block) !== null);
    const load = rated.reduce((s, r) => s + blockLoad(r.block), 0);
    const intensities = rated.map((r) => Number(r.block.intensity));
    const durations = g.runs.map((r) => blockMinutes(r.block));
    const timed = g.runs.filter((r) => blockLiveMinutes(r.block) !== null);
    const liveMin = timed.reduce((s, r) => s + blockLiveMinutes(r.block), 0);
    const timedMin = timed.reduce((s, r) => s + blockMinutes(r.block), 0);

    return {
      ...g,
      category: categoryOf(g, library),
      runCount: g.runs.length,
      minutes,
      load,
      unratedRuns: g.runs.length - rated.length,
      meanIntensity: mean(intensities),
      // The club's own repeated measurements put a drill's run-to-run spread
      // at +/-0.64. This is the same figure for HIS drills, from his own data.
      sdIntensity: sd(intensities),
      meanMinutes: mean(durations),
      sdMinutes: sd(durations),
      liveDensity: timedMin ? liveMin / timedMin : null,
      liveTimedRuns: timed.length,
      contactMinutes: g.runs.reduce((s, r) => s + blockContactMinutes(r.block), 0),
      firstDate: g.runs.map((r) => r.date).sort()[0],
    };
  }).sort((a, b) => b.load - a.load);
}

/**
 * A drill run does not snapshot its category, so old runs have to look it up
 * in the library as it stands today. New runs snapshot it (see makeBlock), so
 * this fallback shrinks over time rather than growing.
 */
function categoryOf(group, library) {
  const withCat = group.runs.filter((r) => r.block.category);
  if (withCat.length) return withCat[withCat.length - 1].block.category;
  const drill = group.drillId ? library.get(group.drillId) : null;
  return drill && drill.category ? drill.category : null;
}

/** Where the load went, by category. Shares are of RATED load only. */
export function categoryMix(rollups) {
  const map = new Map();
  for (const r of rollups) {
    const key = r.category || 'Not in the library';
    if (!map.has(key)) map.set(key, { category: key, load: 0, minutes: 0, runCount: 0, drills: 0 });
    const c = map.get(key);
    c.load += r.load;
    c.minutes += r.minutes;
    c.runCount += r.runCount;
    c.drills += 1;
  }
  const total = [...map.values()].reduce((s, c) => s + c.load, 0);
  return [...map.values()]
    .map((c) => ({ ...c, share: total ? c.load / total : 0 }))
    .sort((a, b) => b.load - a.load);
}

/* ---- one player over time ---------------------------------------------- */

/**
 * A single player's day-by-day series. Participation is applied, so a player
 * who sat out half a practice gets half of it — and a day he was not on the
 * session roster at all is a real zero, because he genuinely did none of it.
 */
export function playerDaySeries(sessions, blocks, playerId, range) {
  const byDate = blocksByDate(sessions, blocks);
  const rosterByDate = new Map();
  for (const s of sessions) {
    if (!s.date) continue;
    const ids = rosterByDate.get(s.date) || new Set();
    (s.rosterIds || []).forEach((id) => ids.add(id));
    rosterByDate.set(s.date, ids);
  }

  const out = [];
  let cursor = range.from;
  let guard = 0;
  while (cursor <= range.to && guard++ < 4000) {
    const dayBlocks = byDate.get(cursor) || [];
    const onRoster = (rosterByDate.get(cursor) || new Set()).has(playerId);
    const mine = onRoster ? dayBlocks : [];

    let load = 0, minutes = 0, contact = 0, ratedMinutes = 0;
    const tissue = {};
    for (const t of TISSUE) tissue[t.key] = 0;

    for (const b of mine) {
      const share = participationOf(b, playerId);
      if (share <= 0) continue;
      const m = blockMinutes(b) * share;
      minutes += m;
      const l = blockLoad(b);
      if (l !== null) { load += l * share; ratedMinutes += m; }
      contact += blockContactMinutes(b) * share;
      for (const t of TISSUE) {
        const s = blockTissue(b, t.key);
        if (s !== null) tissue[t.key] += s * share;
      }
    }

    out.push({
      date: cursor, load, minutes, contactMinutes: contact, tissue,
      onRoster, coverage: minutes ? ratedMinutes / minutes : 1,
    });
    cursor = addDays(cursor, 1);
  }
  return out;
}

/** Totals per player over the window, for the squad table. */
export function playerTotals(sessions, blocks, players, range) {
  return players.map((p) => {
    const series = playerDaySeries(sessions, blocks, p.id, range);
    const tissue = {};
    for (const t of TISSUE) tissue[t.key] = series.reduce((s, d) => s + d.tissue[t.key], 0);
    return {
      player: p,
      series,
      load: series.reduce((s, d) => s + d.load, 0),
      minutes: series.reduce((s, d) => s + d.minutes, 0),
      contactMinutes: series.reduce((s, d) => s + d.contactMinutes, 0),
      daysTrained: series.filter((d) => d.minutes > 0).length,
      tissue,
    };
  }).sort((a, b) => b.load - a.load);
}

/* ---- weeks -------------------------------------------------------------- */

/** Totals for the last `days` of a series, and the `days` before that. */
export function comparePeriods(days, window = 7) {
  const n = days.length;
  if (n < window) return null;
  const recent = days.slice(n - window);
  const prior = n >= window * 2 ? days.slice(n - window * 2, n - window) : null;
  const sumLoad = (arr) => arr.reduce((s, d) => s + d.load, 0);

  const now = sumLoad(recent);
  const before = prior ? sumLoad(prior) : null;
  return {
    load: now,
    priorLoad: before,
    change: (before && before > 0) ? ((now - before) / before) * 100 : null,
    minutes: recent.reduce((s, d) => s + d.minutes, 0),
    trainingDays: recent.filter((d) => d.minutes > 0).length,
    coverage: windowCoverage(recent).fraction,
  };
}
