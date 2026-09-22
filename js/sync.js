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

/* ---- a drill renamed or re-filed after it has already been run ----------
 *
 * A run keeps its own copy of the drill's name and category, so that re-filing
 * a drill in March cannot rewrite what November's practices were made of. The
 * coach hit the other side of that (2026-09-20): he renamed his live drills
 * "5on5 live", and the reports went on printing "Live / Scrimmage (5on5)" for
 * every practice he had already recorded.
 *
 * Both behaviours are right in different situations, and neither the app nor
 * anyone else can tell which one it is — correcting a name is not the same
 * thing as changing what a drill is. So the app asks, once, at the moment he
 * saves the change, and says how many practices it would touch. See
 * js/views/drills.js.
 *
 * Only the NAME and the CATEGORY. Intensity, matchup and movement tags stay
 * exactly as they were recorded: those are what the load number was built
 * from, and rewriting them would change what a practice cost.
 */
export function staleRuns(blocks, drill) {
  if (!drill) return [];
  return blocks.filter((b) => b.drillId === drill.id
    && !b.detailsPending && !b.unrated
    && ((b.drillName && b.drillName !== drill.name)
      || (b.category && b.category !== drill.category)));
}

/** Bring those runs up to the library's current name and category. */
export async function relabelRuns(drill) {
  const blocks = await db.getAll(db.STORES.blocks);
  const stale = staleRuns(blocks, drill);
  for (const b of stale) {
    await db.put(db.STORES.blocks, { ...b, drillName: drill.name, category: drill.category });
  }
  return stale.length;
}

/**
 * Every drill whose recorded runs are under an older name or category.
 *
 * This is the catch-up for changes already made: he re-filed his library by
 * hand before the app ever offered, so the question has to be askable after
 * the fact as well as at the moment of saving. Settings lists these.
 */
export async function pendingRelabels() {
  const [drills, blocks] = await Promise.all([
    db.getAll(db.STORES.drills), db.getAll(db.STORES.blocks),
  ]);
  const out = [];
  for (const d of drills) {
    if (d.unrated) continue;
    const stale = staleRuns(blocks, d);
    if (!stale.length) continue;
    out.push({
      drill: d,
      runs: stale.length,
      oldNames: [...new Set(stale.map((b) => b.drillName).filter((n) => n && n !== d.name))],
      oldCategories: [...new Set(stale.map((b) => b.category).filter((c) => c && c !== d.category))],
    });
  }
  return out.sort((a, b) => b.runs - a.runs);
}

/* ---- renaming a category ------------------------------------------------
 *
 * "You gave me the ideas and we agreed on changes… but the changes are not
 * visible" — the new names were offered in the drill editor, one drill at a
 * time, and the only way to apply them was to open all twenty. A category is
 * one word that labels a whole shelf of drills, so it gets renamed in one
 * place. Renaming onto a name that already exists merges the two, which is
 * how "Transition" becomes "Advantage games (transition)".
 */
export function categoryUsage(drills, blocks) {
  const counts = new Map();
  const bump = (name, key) => {
    if (!name) return;
    if (!counts.has(name)) counts.set(name, { name, drills: 0, runs: 0 });
    counts.get(name)[key]++;
  };
  for (const d of drills) if (!d.archived) bump(d.category, 'drills');
  for (const b of blocks) bump(b.category, 'runs');
  return [...counts.values()].sort((a, b) => b.drills - a.drills || a.name.localeCompare(b.name));
}

export async function renameCategory(from, to, { runsToo = true } = {}) {
  const [drills, blocks] = await Promise.all([
    db.getAll(db.STORES.drills), db.getAll(db.STORES.blocks),
  ]);
  let movedDrills = 0, movedRuns = 0;
  for (const d of drills) {
    if (d.category !== from) continue;
    await db.put(db.STORES.drills, { ...d, category: to });
    movedDrills++;
  }
  if (runsToo) {
    for (const b of blocks) {
      if (b.category !== from) continue;
      await db.put(db.STORES.blocks, { ...b, category: to });
      movedRuns++;
    }
  }
  // Keep his own list of categories and the contact mapping in step, so the
  // renamed category does not lose the contact row it was assigned.
  const custom = await db.getMeta('customCategories', []);
  if (custom.includes(from)) {
    await db.setMeta('customCategories', [...new Set(custom.map((c) => (c === from ? to : c)))]);
  }
  // On a merge the category being merged INTO keeps its own contact setting:
  // folding Transition into his advantage category must not change what the
  // advantage category counts as.
  const map = await db.getMeta('contactRows', null);
  if (map && Object.prototype.hasOwnProperty.call(map, from)) {
    const next = { ...map };
    if (!Object.prototype.hasOwnProperty.call(map, to)) next[to] = map[from];
    delete next[from];
    await db.setMeta('contactRows', next);
  }
  return { drills: movedDrills, runs: movedRuns };
}

/* ---- removing a category --------------------------------------------------
 *
 * "There are two of the same option — the first one should be deleted", and
 * "Transition should be deleted as well" (2026-09-22). The starter
 * categories could not be removed at all, so the one the app shipped with
 * sat beside the one he had written himself.
 *
 * A category with nothing filed under it simply leaves the list. One that
 * still carries drills has to go somewhere, and only he knows where — so the
 * screen asks, and the drills (and, if he ticks it, their recorded runs) are
 * moved first, exactly as a rename onto an existing name merges the two.
 */
export async function removeCategory(name, { moveTo = null, runsToo = true } = {}) {
  let moved = { drills: 0, runs: 0 };
  if (moveTo && moveTo !== name) moved = await renameCategory(name, moveTo, { runsToo });
  const hidden = await db.getMeta('hiddenCategories', []);
  if (!hidden.includes(name)) await db.setMeta('hiddenCategories', [...hidden, name]);
  const custom = await db.getMeta('customCategories', []);
  if (custom.includes(name)) await db.setMeta('customCategories', custom.filter((c) => c !== name));
  return moved;
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
