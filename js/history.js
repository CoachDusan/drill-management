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

import {
  TISSUE, toDateKey, addDays, fromDateKey, formatDate,
  GAME_DAY_ORDER, isGameWeekDay, matchupBand,
  CONTACT_ROWS, CONTACT_GROUPS, contactRowForCategory,
} from './models.js';
import {
  blockMinutes, blockLoad, blockTissue, blockContactMinutes,
  participationOf, blockLiveMinutes,
  fmtLoad, fmtMinutes, fmtDuration, fmtRatio, acwrFlag, monotonyFlag,
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
/* `seasonFrom` is where "Season" starts once seasons are set up. Without it,
 * Season meant "since the first practice ever recorded" — which next year
 * would quietly mean two seasons. ACWR and monotony must NOT be given it: load
 * does not reset on the day a season starts, and they need the history. */
export function rangeFor(sessions, key = '4w', today = toDateKey(new Date()), seasonFrom = null) {
  const dates = sessions.map((s) => s.date).filter(Boolean).sort();
  const first = dates.length ? dates[0] : today;
  const last = dates.length ? dates[dates.length - 1] : today;
  const to = last > today ? last : today;   // a session dated ahead of today still counts
  const spec = RANGES.find((r) => r.key === key) || RANGES[1];
  const from = spec.days === null ? (seasonFrom || first) : maxDate(first, addDays(to, -(spec.days - 1)));
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

/* A run of a drill that was added courtside and never set up has no category,
 * and neither — honestly — does the drill: its stored category is only the
 * default a new drill is born with. Say so instead of filing it under that. */
export const NOT_SET_UP = 'Drill not set up yet';

function categoryOfBlock(block, library) {
  if (block.category) return block.category;
  const d = block.drillId ? library.get(block.drillId) : null;
  if (d && d.unrated) return NOT_SET_UP;
  return (d && d.category) ? d.category : 'Not in the library';
}

/** The category a single run is reported under — for anything that lists
 *  runs one by one (a practice sheet in a PDF). Same rules as the tables. */
export function categoryLabelOf(block, drills = []) {
  return categoryOfBlock(block, new Map(drills.map((d) => [d.id, d])));
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

export function drillWindowAverages(sessions, blocks, drills = [], today = toDateKey(new Date()), seasonFrom = null) {
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
      const from = w.days === null ? seasonFrom : addDays(today, -(w.days - 1));
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
  if (drill && drill.unrated) return NOT_SET_UP;
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
export function playerDaySeries(sessions, blocks, playerId, range, { drills = [], contactRows = null } = {}) {
  const byDate = blocksByDate(sessions, blocks);
  const library = new Map(drills.map((d) => [d.id, d]));
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

    let load = 0, minutes = 0, contact = 0, contactUntimed = 0, ratedMinutes = 0;
    const tissue = {};
    for (const t of TISSUE) tissue[t.key] = 0;

    for (const b of mine) {
      const share = participationOf(b, playerId);
      if (share <= 0) continue;
      const m = blockMinutes(b) * share;
      minutes += m;
      const l = blockLoad(b);
      if (l !== null) { load += l * share; ratedMinutes += m; }
      // Contact is his definition (the category) and his measure (the second
      // stopwatch), the same as the report. An untimed contact drill is
      // carried separately, never folded in as zero or as its full length.
      const c = contactTimeOf(b, library, contactRows);
      if (c && c.live !== null) contact += c.live * share;
      else if (c) contactUntimed += c.full * share;
      for (const t of TISSUE) {
        const s = blockTissue(b, t.key);
        if (s !== null) tissue[t.key] += s * share;
      }
    }

    out.push({
      date: cursor, load, minutes, contactMinutes: contact, contactUntimedMinutes: contactUntimed, tissue,
      onRoster, coverage: minutes ? ratedMinutes / minutes : 1,
    });
    cursor = addDays(cursor, 1);
  }
  return out;
}

/** Totals per player over the window, for the squad table. */
export function playerTotals(sessions, blocks, players, range, opts = {}) {
  return players.map((p) => {
    const series = playerDaySeries(sessions, blocks, p.id, range, opts);
    const tissue = {};
    for (const t of TISSUE) tissue[t.key] = series.reduce((s, d) => s + d.tissue[t.key], 0);
    return {
      player: p,
      series,
      load: series.reduce((s, d) => s + d.load, 0),
      minutes: series.reduce((s, d) => s + d.minutes, 0),
      contactMinutes: series.reduce((s, d) => s + d.contactMinutes, 0),
      contactUntimedMinutes: series.reduce((s, d) => s + d.contactUntimedMinutes, 0),
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

/* ======================================================================
   Reports
   ======================================================================

   Stage 4 answered "what does a GD-1 look like". This answers the question
   he asked next, which is narrower and more practical: over a stretch of
   dates I choose, how many minutes went into each category and each drill,
   and how many of those minutes were live.

   Three things shape everything below.

   FULL TIME AND LIVE TIME, ALWAYS TOGETHER. He runs the second stopwatch
   mainly on live and scrimmage work, so the drills he most wants reported
   are exactly the ones that have a live figure. "25 min full, 15 min live"
   is the sentence; a percentage on its own is not one he can plan with, and
   minutes on their own do not compare a 40-minute scrimmage to a 10-minute
   one. Both, in that order, everywhere.

   COVERAGE TRAVELS WITH EVERY LIVE FIGURE. A bucket's live minutes are the
   live minutes of the drills he timed. If he timed two of six, the bucket is
   not 30% live — it is 30% live across the third of it he measured, and the
   report has to say which. `liveCoverage` is on every row for that reason.

   PERIODS ARE CALENDAR PERIODS, NOT ROLLING WINDOWS. "Last 28 days" answers
   a training-load question; "October" answers a planning question, and this
   is the planning screen. A week runs Monday to Sunday.
*/

/** Monday of the week a date falls in. Basketball weeks start on Monday. */
export function startOfWeek(dateKey) {
  const d = fromDateKey(dateKey);
  const shift = (d.getDay() + 6) % 7;   // Sunday(0) -> 6, Monday(1) -> 0
  return addDays(dateKey, -shift);
}

/** Inclusive day count between two date keys. */
export function daysBetween(from, to) {
  return Math.round((fromDateKey(to) - fromDateKey(from)) / 86400000) + 1;
}

export function startOfMonth(dateKey) { return `${dateKey.slice(0, 7)}-01`; }
export function endOfMonth(dateKey) {
  const d = fromDateKey(startOfMonth(dateKey));
  d.setMonth(d.getMonth() + 1);
  return toDateKey(new Date(d.getTime() - 86400000));
}
export function startOfYear(dateKey) { return `${dateKey.slice(0, 4)}-01-01`; }
export function endOfYear(dateKey) { return `${dateKey.slice(0, 4)}-12-31`; }

/* ---- the game-day filter on reports (2026-09-12) -------------------------
 *
 * "GD-1, from 21.9 till 31.10, and how many practices it is taken from." The
 * count is the point: a GD-1 picture drawn from two practices is not a
 * picture of GD-1. GD itself is not offered — nobody runs a stopwatch on a
 * game, so a GD report could only ever be empty.
 */
export const REPORT_GAME_DAYS = GAME_DAY_ORDER.filter((g) => g !== 'GD');

/** How many practices carry each label. Unset is its own count, never 0 of
 *  something — those practices cannot be reached by any filter. */
export function gameDayCounts(sessions) {
  const out = { unset: 0, 'GD-X': 0 };
  for (const g of GAME_DAY_ORDER) out[g] = 0;
  for (const s of sessions) {
    const k = s.gameDay || 'unset';
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

/**
 * One cell divided by the number of practices behind it.
 *
 * Divided by EVERY practice in the bucket, not only the ones that used this
 * category: defence skipped on one GD-1 out of four averages a quarter lower,
 * which is the honest answer to "how much defence is on a GD-1". Same rule as
 * categoryByGameDay(). Ratios (live %, coverage) do not change with the divisor.
 */
export function perPractice(agg, practices) {
  if (!agg || !practices) return null;
  return {
    ...agg,
    minutes: agg.minutes / practices,
    liveMinutes: agg.liveMinutes / practices,
    timedMinutes: agg.timedMinutes / practices,
  };
}

/** The periods the report screen offers, plus the custom from/till. */
export const REPORT_PERIODS = [
  { key: 'day',    label: 'Day' },
  { key: 'week',   label: 'Week' },
  { key: 'month',  label: 'Month' },
  { key: 'year',   label: 'Year' },
  { key: 'season', label: 'Season' },   // the chosen season or phase, whole
  { key: 'custom', label: 'Choose dates' },
];

/** The calendar period containing `anchor`. */
export function periodRange(period, anchor, custom = null) {
  if (period === 'custom' && custom) {
    const from = custom.from <= custom.to ? custom.from : custom.to;
    const to = custom.from <= custom.to ? custom.to : custom.from;
    return { from, to, period, label: `${formatDate(from, { weekday: false })} – ${formatDate(to, { weekday: false })}` };
  }
  if (period === 'day') return { from: anchor, to: anchor, period, label: formatDate(anchor) };
  if (period === 'week') {
    const from = startOfWeek(anchor);
    const to = addDays(from, 6);
    return { from, to, period, label: `${formatDate(from, { weekday: false })} – ${formatDate(to, { weekday: false })}` };
  }
  if (period === 'month') {
    const from = startOfMonth(anchor);
    return { from, to: endOfMonth(anchor), period, label: monthLabel(from) };
  }
  return { from: startOfYear(anchor), to: endOfYear(anchor), period, label: anchor.slice(0, 4) };
}

function monthLabel(dateKey) {
  return fromDateKey(dateKey).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

/**
 * Split a range into the columns of his table.
 *
 * A weekly report has one column per DAY (his first image: 8.12. GD-3,
 * 9.12. GD-2, 10.12. GD-1). A monthly report has one column per WEEK (his
 * second image: Week1 6.10.-13.10.). So the column unit follows the period
 * rather than being a separate choice he has to make.
 *
 * Days with nothing recorded are dropped from a day-column table — a week
 * has seven days and he trains on four, and five empty columns push the ones
 * that matter off the side of a tablet. Weeks are kept even when empty,
 * because an empty week inside a month is information.
 */
export function columnUnitFor(period) {
  if (period === 'day') return 'day';
  if (period === 'week') return 'day';
  if (period === 'month') return 'week';
  if (period === 'year') return 'month';
  return null;   // custom: chosen by the screen
}

export function columnsFor(range, unit) {
  const out = [];
  let guard = 0;
  if (unit === 'day') {
    let c = range.from;
    while (c <= range.to && guard++ < 400) { out.push({ key: c, from: c, to: c }); c = addDays(c, 1); }
  } else if (unit === 'week') {
    let c = startOfWeek(range.from);
    let n = 1;
    while (c <= range.to && guard++ < 400) {
      const end = addDays(c, 6);
      out.push({
        key: c, from: c, to: end, index: n,
        label: `Week ${n} · ${formatDate(c, { weekday: false })} – ${formatDate(end, { weekday: false })}`,
      });
      c = addDays(c, 7); n += 1;
    }
  } else {
    let c = startOfMonth(range.from);
    while (c <= range.to && guard++ < 400) {
      out.push({ key: c, from: c, to: endOfMonth(c), label: monthLabel(c) });
      c = addDays(endOfMonth(c), 1);
    }
  }
  return out;
}

/* ---- classifying a run -------------------------------------------------- */

/** The matchup band for a run, falling back to the library for old runs. */
export function blockMatchup(block, library) {
  if (block.contact === false) return 'unopposed';
  const d = block.drillId ? library.get(block.drillId) : null;
  // Never set up: whatever the library says now is the only answer there is,
  // and a drill that is still unrated has no answer at all.
  if (block.contact === null || block.detailsPending) {
    if (!d || d.unrated) return 'unknown';
    return matchupBand(d.situation, d.contact !== false);
  }
  let s = block.situation;
  if (s === null || s === undefined) s = d ? d.situation : null;
  return matchupBand(s, true);
}

/* ---- the contact rows ---------------------------------------------------
 *
 * His tree — 5on5 contact (live, continuous, shell), small-sided contact
 * (live, continuous, shell), transition contact — and it comes from the
 * CATEGORY, not from the grid. See the long note in models.js.
 *
 * Three answers besides the rows, and each of them is reported rather than
 * folded into a total:
 *   null         not a contact category at all — warm-ups, shooting, 5v0.
 *   'noDefence'  a shell or transition drill recorded with no live defence.
 *   'unknown'    the run cannot be placed: a drill added courtside and never
 *                set up, an old run whose drill has been deleted, or a
 *                continuous / shell drill with no matchup to size it by.
 */
export function contactRowOf(block, library, map = null) {
  const category = categoryOfBlock(block, library);
  // A run whose drill was never set up has no category of its own, so it
  // cannot be placed. Saying "not contact" would quietly shrink the totals.
  if (category === NOT_SET_UP || category === 'Not in the library') return 'unknown';

  const role = contactRowForCategory(category, map);
  if (!role) return null;
  // "Always counted as contact" — the category alone decides these two.
  if (role === 'live5') return 'c5Live';
  if (role === 'liveSmall') return 'smLive';

  const d = block.drillId ? library.get(block.drillId) : null;
  if (role === 'shell' || role === 'transition') {
    let contact = block.contact;
    if (contact === null || contact === undefined || block.detailsPending) {
      contact = (d && !d.unrated) ? d.contact !== false : null;
    }
    if (contact === null) return 'unknown';
    // "Not all drills from category defense but only those with the contact."
    if (contact === false) return 'noDefence';
    if (role === 'transition') return 'transition';
  }

  // Continuous and shell split by how many are a side: 5v5 is whole-squad.
  let s = block.situation;
  if (s === null || s === undefined) s = d ? d.situation : null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 1 || n > 5) return 'unknown';
  const big = n === 1;
  if (role === 'continuous') return big ? 'c5Cont' : 'smCont';
  return big ? 'c5Shell' : 'smShell';
}

/** One run's contact under his definition, or null when it is not in a
 *  contact row. `live` is the contact time — null when the second stopwatch
 *  was not run, which is "not timed", not zero. */
export function contactTimeOf(block, library, map = null) {
  const row = contactRowOf(block, library, map);
  const info = CONTACT_ROWS.find((r) => r.key === row);
  if (!info) return null;
  return { row, group: info.group, full: blockMinutes(block), live: blockLiveMinutes(block) };
}

/* ---- Analysis in plain words (2026-09-22) ---------------------------------
 *
 * "Make it easier to read." The screen opened on four tiles of numbers; a
 * coach reading it between practices wants the sentence first and the detail
 * underneath. Every clause here is a number already on the screen — nothing
 * is worked out only for the summary — and the honesty rules travel with it:
 * unrated runs make a total incomplete, untimed contact is named, a
 * provisional ratio says so.
 */
export function plainSummary({ label, days, sessionCount, contact, acwrPoint = null, monoPoint = null, recentDays = null }) {
  const out = [];
  const minutes = days.reduce((s, d) => s + d.minutes, 0);
  const load = days.reduce((s, d) => s + d.load, 0);
  const unrated = days.reduce((s, d) => s + (Array.isArray(d.unrated) ? d.unrated.length : 0), 0);
  if (!sessionCount) return [`${label}: nothing recorded.`];
  out.push(`${label}: ${sessionCount} practice${sessionCount === 1 ? '' : 's'}, ${fmtDuration(minutes)} on court, load ${fmtLoad(load)} AU${unrated ? ` — incomplete, ${unrated} drill run${unrated === 1 ? '' : 's'} still unrated` : ''}.`);

  // "The 7 days before" may lie outside the window: load does not reset on
  // the day inseason starts, so the first inseason week is compared with the
  // last preseason one. `recentDays` is the history up to the window's end.
  const trail = recentDays || days;
  const cmp = comparePeriods(trail, 7);
  if (cmp && cmp.change !== null && trail.length >= 14) {
    const ch = Math.round(cmp.change);
    out.push(`Last 7 days: ${fmtLoad(cmp.load)} AU — ${Math.abs(ch) < 5 ? 'about the same as' : `${Math.abs(ch)}% ${ch > 0 ? 'more than' : 'less than'}`} the 7 days before.`);
  }

  if (contact && contact.minutes) {
    out.push(contact.timedRuns
      ? `Contact: ${fmtDuration(contact.liveMinutes)} of live play in contact drills${contact.liveCoverage < 0.999 ? ` (only ${Math.round(contact.liveCoverage * 100)}% of contact-drill time was timed, so this is short)` : ''}.`
      : `Contact drills ran for ${fmtDuration(contact.minutes)}, but none were timed on the second stopwatch, so there is no contact time.`);
  } else {
    out.push('No contact drills in this window.');
  }

  if (acwrPoint) {
    const real = acwrPoint.acwr;
    const v = real != null ? real : acwrPoint.provisional;
    if (v != null) out.push(`Acute:chronic ${fmtRatio(v)}${real == null ? ' (provisional)' : ''} — ${acwrFlag(v).text.charAt(0).toLowerCase()}${acwrFlag(v).text.slice(1)}.`);
  }
  if (monoPoint && monoPoint.monotony != null) {
    const f = monotonyFlag(monoPoint.monotony).text;
    out.push(`Monotony ${fmtRatio(monoPoint.monotony)} — ${f.charAt(0).toLowerCase()}${f.slice(1)}.`);
  }
  return out;
}

/**
 * Every row of his weekly table, in his order, built from one pass over the
 * runs: every category first, then only the contact rows. A contact format
 * with parts gets a total row followed by the parts that have anything in them; "Whole contact" is every
 * part added, not another bucket the runs are sorted into — a drill belongs
 * to exactly one part.
 *
 * In the contact rows the number that matters is the LIVE time: that is the
 * contact time. The full drill time travels beside it so he can see how much
 * of a drill the contact was.
 */
export function reportRowsFor(blocks, drills = [], { categories = null, contactRows = null } = {}) {
  const library = new Map(drills.map((d) => [d.id, d]));
  const byCategory = new Map();
  const byBand = new Map();

  for (const b of blocks) {
    const cat = categoryOfBlock(b, library);
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat).push(b);

    const band = contactRowOf(b, library, contactRows);
    if (band) {
      if (!byBand.has(band)) byBand.set(band, []);
      byBand.get(band).push(b);
    }
  }

  const catKeys = categories
    ? categories.filter((c) => byCategory.has(c))
    : [...byCategory.keys()].sort((a, b) =>
      aggregate(byCategory.get(b)).minutes - aggregate(byCategory.get(a)).minutes);

  const rows = catKeys.map((c) => ({
    key: `cat:${c}`, kind: 'category', label: c, blocks: byCategory.get(c),
    ...aggregate(byCategory.get(c)),
  }));

  for (const g of CONTACT_GROUPS) {
    const parts = CONTACT_ROWS.filter((r) => r.group === g.key);
    const all = parts.flatMap((r) => byBand.get(r.key) || []);
    if (parts.length === 1) {
      rows.push({ key: `band:${parts[0].key}`, kind: 'matchup', level: 'group', label: g.label, blocks: all, ...aggregate(all) });
      continue;
    }
    rows.push({ key: `band:${g.key}`, kind: 'matchup', level: 'group', label: g.label, blocks: all, ...aggregate(all) });
    for (const r of parts) {
      const list = byBand.get(r.key) || [];
      // A part nothing ran in is left out; its format row always stays, so
      // "no transition contact this week" is still said. Ten rows of dashes
      // pushed the real ones off the page (seen in the sample PDFs).
      if (!list.length) continue;
      rows.push({ key: `band:${r.key}`, kind: 'matchup', level: 'part', label: r.part, fullLabel: r.label, blocks: list, ...aggregate(list) });
    }
  }

  const whole = CONTACT_ROWS.flatMap((r) => byBand.get(r.key) || []);
  rows.push({
    key: 'band:whole', kind: 'matchup', level: 'whole', label: 'Whole contact', emphasis: true, blocks: whole,
    ...aggregate(whole),
  });

  const unknown = byBand.get('unknown') || [];
  const noDefence = byBand.get('noDefence') || [];
  return {
    rows,
    // Never silently folded into a contact total. Reported so he knows the
    // contact rows are short, rather than believing them.
    unclassified: { runs: unknown.length, ...aggregate(unknown) },
    // A shell or transition drill recorded with no live defence. Left out, and
    // that is worth saying rather than hiding.
    noDefence: { runs: noDefence.length, ...aggregate(noDefence) },
  };
}

/**
 * The table itself: his rows down the side, one column per day or per week.
 *
 * Each cell is a full aggregate, so the screen can print "25 min full, 15 min
 * live" and still know how much of that cell was actually timed.
 */
export function reportTable(sessions, blocks, drills, range, unit, { categories = null, contactRows = null } = {}) {
  const dateOf = new Map(sessions.map((s) => [s.id, s.date]));
  const gameDayOf = new Map(sessions.map((s) => [s.id, s.gameDay || null]));
  const inRange = blocks.filter((b) => {
    const d = dateOf.get(b.sessionId);
    return d && d >= range.from && d <= range.to;
  });

  const overall = reportRowsFor(inRange, drills, { categories, contactRows });
  const rowOrder = overall.rows.map((r) => r.key);

  let columns = columnsFor(range, unit);
  if (unit === 'day') {
    // Drop days nobody trained: five empty columns push the four that matter
    // off the side of a tablet. An empty WEEK inside a month is kept, because
    // a week off is a fact about the month.
    const trained = new Set(inRange.map((b) => dateOf.get(b.sessionId)));
    columns = columns.filter((c) => trained.has(c.key));
  }

  const cols = columns.map((c) => {
    const cellBlocks = inRange.filter((b) => {
      const d = dateOf.get(b.sessionId);
      return d >= c.from && d <= c.to;
    });
    const built = reportRowsFor(cellBlocks, drills, { categories, contactRows });
    const byKey = new Map(built.rows.map((r) => [r.key, r]));
    // The game-week labels of the sessions in this column. A day usually has
    // one; a week has several, and the header lists them in order.
    const labels = [...new Set(sessions
      .filter((s) => s.date >= c.from && s.date <= c.to && cellBlocks.some((b) => b.sessionId === s.id))
      .map((s) => gameDayOf.get(s.id))
      .filter(Boolean))];
    return {
      ...c,
      label: c.label || formatDate(c.key),
      gameDays: labels,
      cells: rowOrder.map((k) => byKey.get(k) || null),
      total: aggregate(cellBlocks),
    };
  });

  return { range, unit, columns: cols, rows: overall.rows,
    unclassified: overall.unclassified, noDefence: overall.noDefence };
}

/* ---- one drill, over a chosen stretch of dates --------------------------
 *
 * "5on5, HC+2 — 5 times in this period. Longest 25 min / 12:30 live, shortest
 * 15 min / 8:00, average 20 min / 10:00. Of those, 3 were GD-1: ..."
 *
 * The spread is the point. An average on its own hides that the same drill
 * ran 25 minutes before one game and 10 before the next, and the game-day
 * split is what turns that from noise into a plan.
 *
 * Live minutes are summarised over the TIMED runs only, and `timedRuns` says
 * how many those were. Counting an untimed run as zero live minutes would
 * report a shortest-live of 0:00 for a drill he simply did not time.
 */
export function drillReport(sessions, blocks, drills, range, { contactRows = null } = {}) {
  const dateOf = new Map(sessions.map((s) => [s.id, s.date]));
  const gameDayOf = new Map(sessions.map((s) => [s.id, s.gameDay || null]));
  const library = new Map(drills.map((d) => [d.id, d]));

  const groups = new Map();
  for (const b of blocks) {
    const date = dateOf.get(b.sessionId);
    if (!date || date < range.from || date > range.to) continue;
    const key = b.drillId || `name:${String(b.drillName || '').trim().toLowerCase()}`;
    if (!groups.has(key)) {
      groups.set(key, { key, drillId: b.drillId || null, name: b.drillName || 'Unnamed drill', runs: [] });
    }
    const g = groups.get(key);
    g.runs.push({ block: b, date, gameDay: gameDayOf.get(b.sessionId) || null });
    if (date >= (g.lastDate || '')) { g.lastDate = date; g.name = b.drillName || g.name; }
  }

  return [...groups.values()].map((g) => {
    const byGameDay = new Map();
    for (const r of g.runs) {
      const k = r.gameDay || 'unset';
      if (!byGameDay.has(k)) byGameDay.set(k, []);
      byGameDay.get(k).push(r);
    }
    const order = [...GAME_DAY_ORDER, 'GD-X', 'unset'];
    return {
      key: g.key,
      drillId: g.drillId,
      name: g.name,
      category: categoryOfBlock(g.runs[g.runs.length - 1].block, library),
      matchup: blockMatchup(g.runs[g.runs.length - 1].block, library),
      // Which contact row this drill's list is grouped under. Same rules as
      // the table, so one PDF never says two different things about a drill.
      contactRow: contactRowOf(g.runs[g.runs.length - 1].block, library, contactRows),
      lastDate: g.lastDate,
      ...spreadOf(g.runs.map((r) => r.block)),
      byGameDay: order
        .filter((k) => byGameDay.has(k))
        .map((k) => ({
          gameDay: k === 'unset' ? null : k,
          label: k === 'unset' ? 'Not labelled' : k,
          ...spreadOf(byGameDay.get(k).map((r) => r.block)),
        })),
    };
  }).sort((a, b) => b.minutes - a.minutes);
}

/** Count, longest, shortest and average — for full time and for live time. */
export function spreadOf(blocks) {
  const mins = blocks.map((b) => blockMinutes(b));
  const timed = blocks.filter((b) => blockLiveMinutes(b) !== null);
  const live = timed.map((b) => blockLiveMinutes(b));
  const liveTotal = live.reduce((s, v) => s + v, 0);
  const timedTotal = timed.reduce((s, b) => s + blockMinutes(b), 0);
  const total = mins.reduce((s, v) => s + v, 0);

  return {
    runs: blocks.length,
    minutes: total,
    maxMinutes: mins.length ? Math.max(...mins) : null,
    minMinutes: mins.length ? Math.min(...mins) : null,
    meanMinutes: mins.length ? total / mins.length : null,

    timedRuns: timed.length,
    liveMinutes: live.length ? liveTotal : null,
    maxLiveMinutes: live.length ? Math.max(...live) : null,
    minLiveMinutes: live.length ? Math.min(...live) : null,
    meanLiveMinutes: live.length ? liveTotal / live.length : null,

    // Pooled, never an average of percentages: a 4-minute drill must not
    // weigh the same as a 40-minute one.
    liveDensity: timedTotal ? liveTotal / timedTotal : null,
    liveCoverage: total ? timedTotal / total : 0,
    load: blocks.reduce((s, b) => s + (blockLoad(b) || 0), 0),
    coverage: total
      ? blocks.filter((b) => blockLoad(b) !== null).reduce((s, b) => s + blockMinutes(b), 0) / total
      : 1,
  };
}
