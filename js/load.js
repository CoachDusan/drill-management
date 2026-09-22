/* load.js — the maths that turns a stopwatch into a training-load number.
 *
 * HONEST FRAMING, kept here because it should never get lost:
 *
 *   This measures PRESCRIBED (internal-estimate) load, not measured external
 *   load. There is no GPS, no accelerometer, no heart rate. The intensity
 *   number is the coach's judgement of how hard a drill demands players work.
 *
 *   So: two players in the same drill get the same number, even if one took
 *   twelve possessions and the other took three. It answers "how much did I
 *   ask of this group, and how does that compare to last week" — which is the
 *   question that actually drives most overload injuries. It does not answer
 *   "how much did this athlete's body actually do."
 *
 * Method: load = intensity x duration, the session-RPE approach (Foster et al.,
 * 1998/2001), applied per drill and summed, rather than to the whole session.
 * Units are arbitrary units (AU). An AU is only meaningful compared to another
 * AU from the same coach using the same scale.
 */

import { toDateKey, addDays, TISSUE } from './models.js';

export const AU = 'AU';

/* ---- the base unit --------------------------------------------------- */

export function blockMinutes(block) {
  const running = block.running && block.lastResumedAt
    ? (Date.now() - new Date(block.lastResumedAt).getTime())
    : 0;
  return (block.elapsedMs + running) / 60000;
}

/** Team-level load for one drill run: intensity x minutes.
 *
 * Returns null — never 0 — for a drill that has not been rated yet. A drill
 * added courtside and left to be rated after practice has an UNKNOWN load, and
 * unknown is not the same as none. Returning 0 would quietly shrink the day and
 * a real spike would read as a quiet week. Same rule as an untimed live clock
 * and an untagged movement profile; `loadCoverage()` reports how much of a
 * session is missing. */
export function blockLoad(block) {
  const i = block.intensity;
  if (i === null || i === undefined || !Number.isFinite(Number(i))) return null;
  return Number(i) * blockMinutes(block);
}

/** How much of a session actually has an intensity behind it. */
export function loadCoverage(blocks) {
  let rated = 0;
  let total = 0;
  for (const b of blocks) {
    const mins = blockMinutes(b);
    total += mins;
    if (blockLoad(b) !== null) rated += mins;
  }
  return {
    ratedMinutes: rated,
    totalMinutes: total,
    fraction: total ? rated / total : 1,
    unrated: blocks.filter((b) => blockLoad(b) === null),
  };
}

/** How much of this drill a given player did: 1, 0.5, or 0. */
export function participationOf(block, playerId) {
  const p = block.participation ? block.participation[playerId] : undefined;
  return p === undefined ? 1 : p;
}

/** Load a single player accrued in a single drill run. */
export function playerBlockLoad(block, playerId) {
  const load = blockLoad(block);
  return load === null ? null : load * participationOf(block, playerId);
}

/* ---- session roll-ups ------------------------------------------------ */

/** Total load per player for one session. Returns Map<playerId, number>. */
export function sessionLoadByPlayer(blocks, playerIds) {
  const out = new Map(playerIds.map((id) => [id, 0]));
  for (const b of blocks) {
    const load = blockLoad(b);
    if (!load) continue;
    for (const id of playerIds) {
      out.set(id, out.get(id) + load * participationOf(b, id));
    }
  }
  return out;
}

/** Minutes on court per player for one session. */
export function sessionMinutesByPlayer(blocks, playerIds) {
  const out = new Map(playerIds.map((id) => [id, 0]));
  for (const b of blocks) {
    const mins = blockMinutes(b);
    for (const id of playerIds) {
      const p = participationOf(b, id);
      if (p > 0) out.set(id, out.get(id) + mins * p);
    }
  }
  return out;
}

/** Full-participation team load: what the session cost a player who did everything. */
export function sessionTeamLoad(blocks) {
  return blocks.reduce((sum, b) => sum + blockLoad(b), 0);
}

export function sessionTeamMinutes(blocks) {
  return blocks.reduce((sum, b) => sum + blockMinutes(b), 0);
}

/* ---- movement demand -------------------------------------------------
 *
 * Same shape as load, but per tissue: level (0-3) x minutes. Answers "how much
 * jumping has he done this week", which is a far more actionable question than
 * "how much load has he done this week" when the worry is a tendon.
 *
 * Units are arbitrary and NOT comparable to AU or to each other. A jump score
 * of 40 and a sprint score of 40 do not mean the same amount of anything —
 * each one is only ever compared against itself over time.
 */

/** Movement score for one drill run, or null if the drill was never tagged. */
export function blockTissue(block, key) {
  const level = block.tissue ? block.tissue[key] : null;
  if (level === null || level === undefined) return null;
  return Number(level) * blockMinutes(block);
}

/** Per-player movement scores for a session. Returns Map<playerId, number>. */
export function sessionTissueByPlayer(blocks, playerIds, key) {
  const out = new Map(playerIds.map((id) => [id, 0]));
  for (const b of blocks) {
    const score = blockTissue(b, key);
    if (!score) continue;
    for (const id of playerIds) out.set(id, out.get(id) + score * participationOf(b, id));
  }
  return out;
}

/** Every tissue at once: { jump: Map, sprint: Map, cod: Map }. */
export function sessionTissueAll(blocks, playerIds) {
  const out = {};
  for (const t of TISSUE) out[t.key] = sessionTissueByPlayer(blocks, playerIds, t.key);
  return out;
}

/**
 * How much of a session's court time came from drills that were never tagged.
 * The analysis must show this: untagged drills silently drag every movement
 * total down, and a coach who does not know that will read a real spike as
 * a quiet week.
 */
export function tissueCoverage(blocks) {
  let tagged = 0;
  let total = 0;
  for (const b of blocks) {
    const mins = blockMinutes(b);
    total += mins;
    const any = TISSUE.some((t) => b.tissue && b.tissue[t.key] !== null && b.tissue[t.key] !== undefined);
    if (any) tagged += mins;
  }
  return { taggedMinutes: tagged, totalMinutes: total, fraction: total ? tagged / total : 1 };
}

/* ---- live density -----------------------------------------------------
 *
 *   live density = time the ball was live / total drill time
 *
 * The coach times the live action on a second stopwatch and types it in when he
 * stops the drill. This is the one number here that is genuinely MEASURED
 * rather than rated, which makes it the most trustworthy thing in the app.
 *
 * It measures the same property the `rhythm` grid level estimates. Kept
 * separate on purpose: rhythm is a prediction, this is an observation, and
 * collapsing them would throw away the ability to check one against the other
 * once there are a few weeks of both.
 */

/** 0-1, or null when the coach did not time it. */
export function blockLiveDensity(block) {
  if (block.liveMs === null || block.liveMs === undefined) return null;
  const totalMs = blockMinutes(block) * 60000;
  if (!totalMs) return null;
  return Math.min(1, block.liveMs / totalMs);
}

/** Live minutes for one drill run, or null if untimed. */
export function blockLiveMinutes(block) {
  if (block.liveMs === null || block.liveMs === undefined) return null;
  return Math.min(block.liveMs, blockMinutes(block) * 60000) / 60000;
}

/**
 * Session live density, plus how much of the session it was actually measured
 * over. Averaging only the timed drills and presenting it as if it covered the
 * whole session would overstate it, so coverage travels with the number.
 */
export function sessionLiveDensity(blocks) {
  let liveMs = 0;
  let timedMs = 0;
  let totalMs = 0;
  let timedCount = 0;

  for (const b of blocks) {
    const ms = blockMinutes(b) * 60000;
    totalMs += ms;
    if (b.liveMs === null || b.liveMs === undefined) continue;
    timedMs += ms;
    liveMs += Math.min(b.liveMs, ms);
    timedCount += 1;
  }

  return {
    density: timedMs ? liveMs / timedMs : null,
    liveMinutes: liveMs / 60000,
    timedMinutes: timedMs / 60000,
    totalMinutes: totalMs / 60000,
    timedCount,
    coverage: totalMs ? timedMs / totalMs : 0,
  };
}

/** Live minutes per player — arguably the best game-likeness proxy available. */
export function sessionLiveMinutesByPlayer(blocks, playerIds) {
  const out = new Map(playerIds.map((id) => [id, 0]));
  for (const b of blocks) {
    const live = blockLiveMinutes(b);
    if (!live) continue;
    for (const id of playerIds) out.set(id, out.get(id) + live * participationOf(b, id));
  }
  return out;
}

export function fmtDensity(d) {
  return d === null || d === undefined ? '—' : `${Math.round(d * 100)}%`;
}

/**
 * Live time the way the coach asked for it: the minutes AND the percentage.
 *
 * A percentage on its own is not actionable — 50% of a 4-minute drill and 50%
 * of a 40-minute one are different afternoons, and it is the minutes he plans
 * with. The percentage stays because it is what makes two drills of different
 * lengths comparable. Both, always, in that order.
 */
export function fmtLive(minutes, density) {
  if (minutes === null || minutes === undefined) return '—';
  const pct = (density === null || density === undefined) ? null : `${Math.round(density * 100)}%`;
  return pct ? `${fmtMinutes(minutes)} live · ${pct}` : `${fmtMinutes(minutes)} live`;
}

/** The same, for one drill run. Null when the second stopwatch was not run. */
export function blockLiveLabel(block) {
  const mins = blockLiveMinutes(block);
  if (mins === null) return null;
  return fmtLive(mins, blockLiveDensity(block));
}

/* ---- running order ----------------------------------------------------
 *
 * Practice is not always recorded in the order it happened: a drill gets
 * started late, or two clocks run at once and stop in the wrong sequence, or
 * he logs one from memory afterwards. So the order is his to set by hand.
 *
 * `order` is absent on every run recorded before this existed, and those sort
 * by createdAt exactly as they always did — no migration, and the tablet is
 * carrying real data. Hand-ordered runs sort first, in his order; the rest
 * follow in the order they were created.
 */
export function orderedBlocks(blocks) {
  return blocks.slice().sort((a, b) => {
    const ao = a.order, bo = b.order;
    const aSet = ao !== null && ao !== undefined;
    const bSet = bo !== null && bo !== undefined;
    if (aSet && bSet && ao !== bo) return ao - bo;
    if (aSet !== bSet) return aSet ? -1 : 1;
    return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
  });
}

/** Renumber a list into 0..n-1, so the stored order stays dense and readable. */
export function renumber(blocks) {
  return blocks.map((b, i) => ({ ...b, order: i }));
}

/* ---- contact exposure ------------------------------------------------
 *
 * Kept separate from load on purpose. The measured data says live defence
 * barely moves intensity, so folding it into the load number would be
 * inventing an effect that is not there. But contact is where collisions,
 * awkward landings and stepping on a foot come from — the most common ankle
 * sprain mechanism in basketball — so it is worth counting in its own right.
 *
 * "His contact minutes are up 80% this week" is a different warning from
 * "his load is up 20%", and often the more useful one.
 */

/* null contact means the drill has never been set up — not known, so it is
 * not counted as contact. The run is flagged and named on screen instead. */
export function blockContactMinutes(block) {
  return block.contact === false || block.contact === null ? 0 : blockMinutes(block);
}

export function sessionContactByPlayer(blocks, playerIds) {
  const out = new Map(playerIds.map((id) => [id, 0]));
  for (const b of blocks) {
    const mins = blockContactMinutes(b);
    if (!mins) continue;
    for (const id of playerIds) out.set(id, out.get(id) + mins * participationOf(b, id));
  }
  return out;
}

/** Share of a session's court time that was contested. */
export function contactShare(blocks) {
  let contact = 0, total = 0;
  for (const b of blocks) {
    total += blockMinutes(b);
    contact += blockContactMinutes(b);
  }
  return { contactMinutes: contact, totalMinutes: total, fraction: total ? contact / total : 0 };
}

/* ---- the player's own verdict ----------------------------------------
 * sRPE load = the player's 1-10 rating x the minutes they were actually on
 * court. Comparing this against the prescribed load above is the single most
 * useful thing in the app: a persistent gap means the coach's intensity
 * ratings and the players' bodies disagree, and the bodies are the ones that
 * get injured.
 */
export function sRPELoad(rpe, minutes) {
  if (rpe == null || !minutes) return null;
  return rpe * minutes;
}

/**
 * What the coach asked for, next to what the player felt — the comparison this
 * whole app exists to make.
 *
 * Both sides are (1-10) x minutes over the same session, so they are directly
 * comparable. The useful number for a coach is NOT the AU gap, which scales
 * with how long practice was; it is the gap in intensity points, because that
 * is the language he already rates drills in. "You called it a 6, he felt an
 * 8" is a sentence he can act on. 240 AU is not.
 *
 * prescribed intensity = his load / his minutes  (his own average for the day)
 * felt intensity       = the player's single 1-10 answer
 *
 * Returns one row per player. `felt` is null when that player did not answer —
 * never 0, because "he didn't say" and "he felt nothing" are different facts
 * and only one of them is information.
 */
export function feltVsPrescribed(blocks, playerIds, playerSessions) {
  const loads = sessionLoadByPlayer(blocks, playerIds);
  const minutes = sessionMinutesByPlayer(blocks, playerIds);
  const byPlayer = new Map((playerSessions || []).map((ps) => [ps.playerId, ps]));

  return playerIds.map((id) => {
    const load = loads.get(id) || 0;
    const mins = minutes.get(id) || 0;
    const ps = byPlayer.get(id);
    const rpe = ps && ps.rpe != null ? Number(ps.rpe) : null;

    const prescribedIntensity = mins > 0 ? load / mins : null;
    const feltLoad = sRPELoad(rpe, mins);

    return {
      playerId: id,
      minutes: mins,
      prescribedLoad: load,
      prescribedIntensity,
      rpe,
      feltLoad,
      // Positive means it felt harder than it was written down as.
      gap: (rpe != null && prescribedIntensity != null) ? rpe - prescribedIntensity : null,
    };
  });
}

/** How many of the players who trained actually gave a rating. */
export function rpeCoverage(playerIds, playerSessions) {
  const byPlayer = new Map((playerSessions || []).map((ps) => [ps.playerId, ps]));
  const answered = playerIds.filter((id) => {
    const ps = byPlayer.get(id);
    return ps && ps.rpe != null;
  });
  return {
    answered: answered.length,
    total: playerIds.length,
    fraction: playerIds.length ? answered.length / playerIds.length : 0,
    missing: playerIds.filter((id) => !answered.includes(id)),
  };
}

/**
 * The session's own gap: the middle player's, not the average.
 *
 * Median on purpose. One player having a miserable day should not drag the
 * squad's number with him — that is exactly the individual case the per-player
 * rows are for. Returns null when nobody answered.
 */
export function sessionGap(rows) {
  const gaps = rows.map((r) => r.gap).filter((g) => g != null).sort((a, b) => a - b);
  if (!gaps.length) return null;
  const mid = Math.floor(gaps.length / 2);
  return gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
}

/**
 * Wording for a gap. A prompt to look, never a diagnosis — and deliberately
 * quiet below a full intensity point, because the coach's own drills vary by
 * +/-0.64 between runs and a 1-10 answer given in a corridor is not a precise
 * instrument either.
 */
export function gapFlag(gap) {
  if (gap == null) return { level: 'none', label: 'No rating', note: 'Nobody has answered yet.' };
  if (gap >= 2) return {
    level: 'watch', label: 'Felt much harder',
    note: 'They are working well above what this was written down as. Worth asking what made it heavy.',
  };
  if (gap >= 1) return {
    level: 'note', label: 'Felt harder',
    note: 'A little above the plan. Worth watching if it keeps happening.',
  };
  if (gap <= -2) return {
    level: 'watch', label: 'Felt much easier',
    note: 'Well below what was planned. Either the drills are rated high, or they were not going after it.',
  };
  if (gap <= -1) return {
    level: 'note', label: 'Felt easier',
    note: 'A little below the plan. Worth watching if it keeps happening.',
  };
  return {
    level: 'ok', label: 'Close to plan',
    note: 'What you asked for and what they felt agree, within the noise of both.',
  };
}

/* ---- daily series ----------------------------------------------------- */

/**
 * Build a continuous day-by-day load series, including zero days.
 * Rest days MUST be present as zeros: monotony and chronic load are wrong
 * without them.
 *
 * @param entries [{ date: 'YYYY-MM-DD', load: number }]
 * @returns [{ date, load }] every calendar day from `from` to `to`
 */
export function dailySeries(entries, from, to) {
  const totals = new Map();
  for (const e of entries) {
    totals.set(e.date, (totals.get(e.date) || 0) + e.load);
  }
  const out = [];
  let cursor = from;
  let guard = 0;
  while (cursor <= to && guard++ < 4000) {
    out.push({ date: cursor, load: totals.get(cursor) || 0 });
    cursor = addDays(cursor, 1);
  }
  return out;
}

function sum(arr) { return arr.reduce((a, b) => a + b, 0); }

function stdev(arr) {
  if (arr.length < 2) return 0;
  const mean = sum(arr) / arr.length;
  const variance = sum(arr.map((v) => (v - mean) ** 2)) / (arr.length - 1);
  return Math.sqrt(variance);
}

/* ---- rolling workload ------------------------------------------------- */

/**
 * Acute:chronic workload ratio, rolling-average form.
 *   acute   = load over the last 7 days
 *   chronic = average 7-day load over the last 28 days
 *   ACWR    = acute / chronic
 *
 * CAVEATS THE UI MUST REPEAT:
 *  - It is meaningless until 28 days of history exist. We return
 *    `sufficient: false` until then rather than showing a confident number.
 *  - The famous "sweet spot 0.8-1.3 / danger above 1.5" thresholds come from
 *    studies in other sports with measured loads, and have been seriously
 *    challenged in the literature since (Impellizzeri et al., 2020). Treat a
 *    high ratio as "look into this week", never as "this player will be hurt".
 *  - Sharp rises matter more than the absolute number.
 */
export function acwrSeries(series, { acuteDays = 7, chronicDays = 28 } = {}) {
  return series.map((point, i) => {
    const acuteWindow = series.slice(Math.max(0, i - acuteDays + 1), i + 1).map((p) => p.load);
    const chronicWindow = series.slice(Math.max(0, i - chronicDays + 1), i + 1).map((p) => p.load);

    const acute = sum(acuteWindow);
    const chronicTotal = sum(chronicWindow);
    const chronic = chronicTotal / (chronicDays / acuteDays); // 28-day total scaled to a 7-day equivalent

    const sufficient = i >= chronicDays - 1 && chronic > 0;

    /* An early, explicitly provisional reading, for the weeks before the real
     * one is available. Asked for deliberately, with the caveat understood.
     *
     * It divides by the days that actually EXIST rather than by 28 — dividing
     * a 10-day total by four would understate chronic load and invent a spike
     * out of nothing.
     *
     * It stays null for the first seven days, and that is arithmetic, not
     * caution: until there is more history than the acute window itself, the
     * two windows are the same days and the ratio is 1.00 by construction. A
     * number that can only be 1.00 is not an early reading of anything.
     */
    const daysOfHistory = i + 1;
    const provisionalChronic = chronicWindow.length
      ? chronicTotal / (chronicWindow.length / acuteDays)
      : 0;
    const canBeProvisional = daysOfHistory > acuteDays && provisionalChronic > 0;

    return {
      date: point.date,
      load: point.load,
      acute,
      chronic,
      acwr: sufficient ? acute / chronic : null,
      sufficient,
      daysOfHistory,
      daysUntilReliable: Math.max(0, chronicDays - daysOfHistory),
      provisional: sufficient ? null : (canBeProvisional ? acute / provisionalChronic : null),
    };
  });
}

/**
 * How much weight the early number deserves. Separate from acwrFlag on
 * purpose: the wording has to carry the fact that it is built on part of a
 * window, every time it is shown, not once in a footnote.
 */
export function provisionalNote(daysOfHistory, chronicDays = 28) {
  const left = Math.max(0, chronicDays - daysOfHistory);
  if (left <= 0) return null;
  if (daysOfHistory <= 7) {
    return `Only ${daysOfHistory} day${daysOfHistory === 1 ? '' : 's'} of history. Too few to compare a week against anything \u2014 the ratio would be 1.00 whatever you did. ${left} more days.`;
  }
  return `Provisional: built on ${daysOfHistory} days, not 28. It compares this week against a short and probably unrepresentative baseline, so treat it as a direction, not a number. Reliable in ${left} more days.`;
}

/**
 * Foster's monotony and strain over a rolling 7-day window.
 *   monotony = mean daily load / standard deviation of daily load
 *   strain   = weekly total load x monotony
 *
 * Monotony is the "every day is the same day" measure. High monotony with high
 * volume is the pattern most associated with staleness and illness — it is
 * often a stronger flag than raw volume. Above ~2.0 is the usual concern line.
 * It is driven mainly by whether there is genuine variation: hard days that are
 * actually hard, easy days that are actually easy.
 */
export function monotonySeries(series, { windowDays = 7 } = {}) {
  return series.map((point, i) => {
    const window = series.slice(Math.max(0, i - windowDays + 1), i + 1).map((p) => p.load);
    const full = window.length === windowDays;
    const weekly = sum(window);
    const sd = stdev(window);
    const mean = window.length ? weekly / window.length : 0;
    const monotony = (full && sd > 0) ? mean / sd : null;
    return {
      date: point.date,
      weekly,
      monotony,
      strain: monotony == null ? null : weekly * monotony,
      sufficient: full,
    };
  });
}

/** Week-on-week change in total load, as a percentage. */
export function weekOverWeek(series) {
  const n = series.length;
  if (n < 14) return null;
  const thisWeek = sum(series.slice(n - 7).map((p) => p.load));
  const lastWeek = sum(series.slice(n - 14, n - 7).map((p) => p.load));
  if (!lastWeek) return null;
  return ((thisWeek - lastWeek) / lastWeek) * 100;
}

/* ---- interpretation helpers ------------------------------------------
 * Deliberately worded as prompts to look, never as diagnoses.
 */

export function acwrFlag(acwr) {
  if (acwr == null) return { level: 'unknown', text: 'Not enough history yet' };
  if (acwr < 0.8) return { level: 'low',  text: 'Below recent norm — undertrained or coming back' };
  if (acwr <= 1.3) return { level: 'ok',   text: 'In line with recent weeks' };
  if (acwr <= 1.5) return { level: 'watch',text: 'Ramping up faster than usual — worth a look' };
  return { level: 'high', text: 'Sharp spike vs recent weeks — worth a conversation' };
}

export function monotonyFlag(m) {
  if (m == null) return { level: 'unknown', text: 'Not enough history yet' };
  if (m < 1.5) return { level: 'ok',    text: 'Good variation between hard and easy days' };
  if (m < 2.0) return { level: 'watch', text: 'Days are starting to look alike' };
  return { level: 'high', text: 'Very little hard/easy contrast this week' };
}

/* ---- formatting -------------------------------------------------------- */

export function fmtLoad(n) {
  if (n == null) return '—';
  return Math.round(n).toLocaleString();
}

/** A long total the way a coach says it: "24 h 10 min", "45 min". The
 *  stopwatch style ("1450:00") is right for one drill and unreadable for a
 *  month (seen on the Analysis screen, 2026-09-22). */
export function fmtDuration(mins) {
  if (mins == null) return '—';
  const total = Math.round(mins);
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function fmtMinutes(mins) {
  if (mins == null) return '—';
  const total = Math.round(mins * 60);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function fmtClock(ms) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

export function fmtRatio(n) {
  return n == null ? '—' : n.toFixed(2);
}

export { toDateKey, addDays };
