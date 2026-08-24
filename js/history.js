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

import { TISSUE, toDateKey, addDays, GAME_DAY_ORDER, isGameWeekDay } from './models.js';
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

/* ---- the game week -----------------------------------------------------
 *
 * The coach plans in days relative to the next game, not in calendar weeks:
 * GD-1 should look nothing like GD-3, and the question is whether every GD-1
 * of the season actually does.
 *
 * The label is set BY HAND when the practice starts. An earlier version worked
 * it out from recorded games plus a list of upcoming fixtures; that could only
 * ever label the past without the second list, and gave two sources of truth
 * for one fact the coach already knows. One dropdown replaced all of it.
 *
 * GD-X ("more than five days out") is deliberately excluded from these
 * comparisons — there is no game week to compare it against — but it still
 * counts in every load, drill and weekly total. An UNSET label is a third
 * thing again, and is reported rather than assumed.
 */

/** Sum a set of drill runs once, so everything else can compose from it. */
export function aggregate(blocks) {
  let minutes = 0, load = 0, ratedMinutes = 0, liveMinutes = 0, timedMinutes = 0;
  let timedRuns = 0, unratedRuns = 0, contactMinutes = 0;

  for (const b of blocks) {
    const m = blockMinutes(b);
    minutes += m;
    const l = blockLoad(b);
    if (l === null) unratedRuns += 1;
    else { load += l; ratedMinutes += m; }
    contactMinutes += blockContactMinutes(b);
    const live = blockLiveMinutes(b);
    if (live !== null) { liveMinutes += live; timedMinutes += m; timedRuns += 1; }
  }

  return {
    runs: blocks.length,
    minutes, load, ratedMinutes, unratedRuns, contactMinutes,
    liveMinutes, timedMinutes, timedRuns,
    // Density over the TIMED drills only, with coverage travelling beside it.
    // A 70% density measured on two of six drills is not the session's density.
    liveDensity: timedMinutes ? liveMinutes / timedMinutes : null,
    liveCoverage: minutes ? timedMinutes / minutes : 0,
    coverage: minutes ? ratedMinutes / minutes : 1,
    meanRunMinutes: blocks.length ? minutes / blocks.length : null,
  };
}

/** One row per practice: how long it was, what it cost, how live it was. */
export function sessionRollups(sessions, blocks, drills = []) {
  const byId = new Map();
  for (const b of blocks) {
    if (!byId.has(b.sessionId)) byId.set(b.sessionId, []);
    byId.get(b.sessionId).push(b);
  }
  const library = new Map(drills.map((d) => [d.id, d]));

  return sessions.map((session) => {
    const own = byId.get(session.id) || [];
    const agg = aggregate(own);

    // Wall clock is what he would call the length of practice; clocked minutes
    // are what was actually timed. They differ, and by design: when practice
    // splits into groups two clocks run at once, so clocked can exceed wall.
    const wallMinutes = (session.startedAt && session.endedAt)
      ? Math.max(0, (Date.parse(session.endedAt) - Date.parse(session.startedAt)) / 60000)
      : null;

    return {
      session,
      date: session.date,
      gameDay: session.gameDay || null,
      blocks: own,
      ...agg,
      wallMinutes,
      byCategory: categoryBreakdown(own, library),
    };
  }).sort((a, b) => a.date.localeCompare(b.date));
}

function categoryOfBlock(block, library) {
  if (block.category) return block.category;
  const d = block.drillId ? library.get(block.drillId) : null;
  return (d && d.category) ? d.category : 'Not in the library';
}

function categoryBreakdown(blocks, library) {
  const map = new Map();
  for (const b of blocks) {
    const key = categoryOfBlock(b, library);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(b);
  }
  return [...map.entries()].map(([category, list]) => ({ category, ...aggregate(list) }));
}

/** How many practices still have no game-week label. */
export function gameDayCoverage(rollups) {
  const unset = rollups.filter((r) => !r.gameDay);
  const excluded = rollups.filter((r) => r.gameDay === 'GD-X');
  return {
    total: rollups.length,
    unset: unset.length,
    excluded: excluded.length,
    compared: rollups.filter((r) => isGameWeekDay(r.gameDay)).length,
    unsetSessions: unset,
  };
}

/**
 * Every GD-1 of the season next to every GD-2, and so on.
 *
 * Averaged per PRACTICE, not per day: two sessions on one day are two
 * practices. Each bucket carries `n`, because with two of them a mean is not
 * a mean and the screen has to say which it is.
 */
export function gameWeekComparison(rollups) {
  const map = new Map();
  for (const r of rollups) {
    if (!isGameWeekDay(r.gameDay)) continue;
    if (!map.has(r.gameDay)) map.set(r.gameDay, []);
    map.get(r.gameDay).push(r);
  }

  return GAME_DAY_ORDER
    .filter((key) => map.has(key))
    .map((key) => {
      const rows = map.get(key);
      const liveMinutes = rows.reduce((s, r) => s + r.liveMinutes, 0);
      const timedMinutes = rows.reduce((s, r) => s + r.timedMinutes, 0);
      const totalMinutes = rows.reduce((s, r) => s + r.minutes, 0);
      const loads = rows.map((r) => r.load);
      return {
        key,
        label: key,
        n: rows.length,
        sessions: rows,
        meanMinutes: mean(rows.map((r) => r.minutes)),
        sdMinutes: sd(rows.map((r) => r.minutes)),
        minMinutes: rows.length ? Math.min(...rows.map((r) => r.minutes)) : null,
        maxMinutes: rows.length ? Math.max(...rows.map((r) => r.minutes)) : null,
        meanWallMinutes: mean(rows.map((r) => r.wallMinutes)),
        meanLoad: mean(loads),
        minLoad: loads.length ? Math.min(...loads) : null,
        maxLoad: loads.length ? Math.max(...loads) : null,
        meanDrills: mean(rows.map((r) => r.runs)),
        meanRunMinutes: mean(rows.map((r) => r.meanRunMinutes)),
        // Pooled across the bucket rather than averaging the per-session
        // percentages: a 40-minute session should not weigh the same as a
        // 4-minute one.
        liveDensity: timedMinutes ? liveMinutes / timedMinutes : null,
        liveCoverage: totalMinutes ? timedMinutes / totalMinutes : 0,
        coverage: totalMinutes
          ? rows.reduce((s, r) => s + r.ratedMinutes, 0) / totalMinutes : 1,
      };
    });
}

/**
 * Inside one game day, where the time actually goes — by drill category.
 *
 * "On a GD-1 I average 22 minutes of shooting at 61% live" is the sentence
 * this exists to produce. Minutes are per practice; density is pooled.
 */
export function categoryByGameDay(rollups, gameDay) {
  const rows = rollups.filter((r) => r.gameDay === gameDay);
  if (!rows.length) return { gameDay, sessions: 0, categories: [] };

  const map = new Map();
  for (const r of rows) {
    for (const c of r.byCategory) {
      if (!map.has(c.category)) map.set(c.category, []);
      map.get(c.category).push(c);
    }
  }

  const totalMinutes = rows.reduce((s, r) => s + r.minutes, 0);
  const categories = [...map.entries()].map(([category, list]) => {
    const minutes = list.reduce((s, c) => s + c.minutes, 0);
    const liveMinutes = list.reduce((s, c) => s + c.liveMinutes, 0);
    const timedMinutes = list.reduce((s, c) => s + c.timedMinutes, 0);
    const runs = list.reduce((s, c) => s + c.runs, 0);
    return {
      category,
      // Divided by every session in the bucket, not just the ones that used
      // this category: a category skipped on two GD-1s out of three averages
      // lower, which is the honest answer to "how much do I do of this".
      meanMinutes: minutes / rows.length,
      meanRuns: runs / rows.length,
      meanRunMinutes: runs ? minutes / runs : null,
      meanLoad: list.reduce((s, c) => s + c.load, 0) / rows.length,
      minutes,
      runs,
      sessionsUsedIn: list.length,
      liveDensity: timedMinutes ? liveMinutes / timedMinutes : null,
      liveCoverage: minutes ? timedMinutes / minutes : 0,
      share: totalMinutes ? minutes / totalMinutes : 0,
    };
  }).sort((a, b) => b.meanMinutes - a.meanMinutes);

  return { gameDay, sessions: rows.length, categories, totalMinutes };
}

/* ---- the same drill over different timescales ---------------------------
 *
 * "Is this drill drifting?" A drill that ran 12 minutes in October and runs
 * 20 now is a different drill, and the season average hides it. Week, month
 * and season are shown side by side rather than behind a selector, because
 * the comparison IS the point.
 */
export const DRILL_WINDOWS = [
  { key: 'week',   label: 'Last 7 days',  days: 7 },
  { key: 'month',  label: 'Last 28 days', days: 28 },
  { key: 'season', label: 'All season',   days: null },
];

export function drillWindowAverages(sessions, blocks, drills = [], today = toDateKey(new Date())) {
  const dateOf = new Map(sessions.map((s) => [s.id, s.date]));
  const library = new Map(drills.map((d) => [d.id, d]));
  const groups = new Map();

  for (const b of blocks) {
    const date = dateOf.get(b.sessionId);
    if (!date) continue;
    const key = b.drillId || `name:${String(b.drillName || '').trim().toLowerCase()}`;
    if (!groups.has(key)) groups.set(key, { key, drillId: b.drillId || null, name: b.drillName || 'Unnamed drill', runs: [] });
    const g = groups.get(key);
    g.runs.push({ block: b, date });
    if (date >= (g.lastDate || '')) { g.lastDate = date; g.name = b.drillName || g.name; }
  }

  return [...groups.values()].map((g) => {
    const windows = {};
    for (const w of DRILL_WINDOWS) {
      const from = w.days === null ? null : addDays(today, -(w.days - 1));
      const inWindow = g.runs.filter((r) => from === null || (r.date >= from && r.date <= today));
      const agg = aggregate(inWindow.map((r) => r.block));
      windows[w.key] = {
        ...agg,
        meanLoad: agg.runs ? agg.load / agg.runs : null,
        meanMinutes: agg.runs ? agg.minutes / agg.runs : null,
      };
    }
    return {
      key: g.key,
      drillId: g.drillId,
      name: g.name,
      category: categoryOfBlock(g.runs[g.runs.length - 1].block, library),
      lastDate: g.lastDate,
      runs: g.runs,
      windows,
    };
  }).sort((a, b) => b.windows.season.load - a.windows.season.load);
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
