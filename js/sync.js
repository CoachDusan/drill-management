/* sync.js — practice runs that follow the library, and the one-off repairs.
 *
 * Almost every run is a SNAPSHOT: it keeps its own copy of the drill's name,
 * intensity, category, matchup and movement tags, so re-rating or re-filing a
 * drill in March never rewrites what November's practices meant.
 *
 * The exception is a run whose drill had never been set up when it ran — one
 * typed in courtside. It has nothing to protect: the details are blank, not
 * different. So it follows the library until the drill is saved once, then
 * becomes an ordinary snapshot. See drillSnapshot() in models.js.
 */

import * as db from './db.js';
import { drillSnapshot, liveCategoryFor, LEGACY_LIVE_CATEGORY } from './models.js';

/**
 * The drill has just been saved in the library: fill in every run still
 * waiting on it. Returns how many runs changed.
 *
 * An intensity he set by hand on the run itself is kept — that was a decision
 * about that day. Everything the practice screen gives no way to set (category,
 * matchup, movement tags) comes from the library, because the run never had
 * its own answer.
 */
export async function followLibrary(drill) {
  if (!drill || drill.unrated) return 0;
  // Read all and filter in memory rather than adding a drillId index: an index
  // means a schema version bump, and the tablet is carrying a season of data.
  const blocks = await db.getAll(db.STORES.blocks);
  const waiting = blocks.filter((b) => b.drillId === drill.id && (b.detailsPending || b.unrated));
  const snap = drillSnapshot(drill);
  for (const b of waiting) {
    const keepHandRating = !b.unrated && b.intensity !== null && b.intensity !== undefined;
    await db.put(db.STORES.blocks, {
      ...b,
      category: snap.category,
      tissue: snap.tissue,
      contact: snap.contact,
      situation: snap.situation,
      intensity: keepHandRating ? b.intensity : snap.intensity,
      unrated: false,
      detailsPending: false,
    });
  }
  return waiting.length;
}

/* ---- repairing runs recorded before this existed -------------------------
 *
 * Before 2026-09-12 a courtside run copied the new drill's defaults, and the
 * coach found his set-up drills still filed under "Skill development" in the
 * report. Those runs carry no flag, so they are recognised by what the old
 * code wrote:
 *
 *   - the drill did not exist before the run did (it was invented for it —
 *     created a few ms before a courtside start, or after the run on a swap);
 *   - the run carries the default category, or none, and no movement tags.
 *
 * A drill picked from the library was, by definition, there before the run,
 * so a real snapshot cannot match. Runs that match are un-guessed and then
 * followed exactly as a new courtside run would be. Idempotent: every run it
 * touches ends with detailsPending set explicitly, and is never matched again.
 */
const OLD_DEFAULT_CATEGORY = 'Skill development';
const INVENTED_WITHIN_MS = 60 * 1000;

export function looksCourtsideInvented(block, drill) {
  if (!block || !drill || block.drillId !== drill.id) return false;
  if (block.detailsPending !== undefined) return false;
  const born = Date.parse(drill.createdAt);
  const ran = Date.parse(block.createdAt);
  if (!Number.isFinite(born) || !Number.isFinite(ran)) return false;
  if (born < ran - INVENTED_WITHIN_MS) return false;
  if (block.category && block.category !== OLD_DEFAULT_CATEGORY) return false;
  const t = block.tissue || {};
  return [t.jump, t.sprint, t.cod].every((v) => v === null || v === undefined);
}

export async function repairCourtsideRuns() {
  const [drills, blocks] = await Promise.all([
    db.getAll(db.STORES.drills), db.getAll(db.STORES.blocks),
  ]);
  const library = new Map(drills.map((d) => [d.id, d]));
  let repaired = 0;
  for (const b of blocks) {
    const d = library.get(b.drillId);
    if (!looksCourtsideInvented(b, d)) continue;
    repaired++;
    if (d.unrated) {
      // Still not set up: take the guess away and let the run wait.
      await db.put(db.STORES.blocks, {
        ...b, category: null, contact: null, situation: null, detailsPending: true,
      });
    } else {
      await db.put(db.STORES.blocks, { ...b, detailsPending: true });
    }
  }
  for (const d of drills) if (!d.unrated) await followLibrary(d);
  return repaired;
}

/* ---- splitting "Live / scrimmage" ----------------------------------------
 *
 * Worked out from each record's OWN matchup — a run's snapshot, not the
 * library as it stands today — so the split says what each practice already
 * recorded, in finer words. Nothing about what was run changes. Anything the
 * matchup cannot place (unopposed, or not recorded) is left under the old name
 * and counted, rather than guessed into one of the new ones.
 */
export function planLiveSplit(drills, blocks) {
  const library = new Map(drills.map((d) => [d.id, d]));
  const plan = { drills: [], runs: [], leftDrills: 0, leftRuns: 0, counts: {} };

  for (const d of drills) {
    if (d.category !== LEGACY_LIVE_CATEGORY) continue;
    const to = liveCategoryFor(d.situation, d.contact !== false);
    if (to) { plan.drills.push({ id: d.id, to }); plan.counts[to] = (plan.counts[to] || 0) + 1; }
    else plan.leftDrills++;
  }
  for (const b of blocks) {
    if (b.category !== LEGACY_LIVE_CATEGORY) continue;
    const d = library.get(b.drillId);
    const situation = (b.situation === null || b.situation === undefined) ? (d ? d.situation : null) : b.situation;
    const contact = b.contact === null ? null : b.contact !== false;
    const to = liveCategoryFor(situation, contact);
    if (to) plan.runs.push({ id: b.id, to });
    else plan.leftRuns++;
  }
  return plan;
}

export async function applyLiveSplit(plan) {
  for (const p of plan.drills) {
    const d = await db.get(db.STORES.drills, p.id);
    if (d) await db.put(db.STORES.drills, { ...d, category: p.to });
  }
  for (const p of plan.runs) {
    const b = await db.get(db.STORES.blocks, p.id);
    if (b) await db.put(db.STORES.blocks, { ...b, category: p.to });
  }
}
