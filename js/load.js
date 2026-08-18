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

/** Team-level load for one drill run: intensity x minutes. */
export function blockLoad(block) {
  return block.intensity * blockMinutes(block);
}

/** How much of this drill a given player did: 1, 0.5, or 0. */
export function participationOf(block, playerId) {
  const p = block.participation ? block.participation[playerId] : undefined;
  return p === undefined ? 1 : p;
}

/** Load a single player accrued in a single drill run. */
export function playerBlockLoad(block, playerId) {
  return blockLoad(block) * participationOf(block, playerId);
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

export function blockContactMinutes(block) {
  return block.contact === false ? 0 : blockMinutes(block);
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
    return {
      date: point.date,
      load: point.load,
      acute,
      chronic,
      acwr: sufficient ? acute / chronic : null,
      sufficient,
    };
  });
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
