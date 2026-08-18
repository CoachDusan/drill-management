/* models.js — the vocabulary of the app.
 *
 * This is where the basketball meaning lives: what an intensity number means,
 * what counts as a category, how a drill or a player is shaped.
 */

import { newId } from './db.js';

/* ---- intensity scale ------------------------------------------------
 *
 * 1-10, anchored to things that happen on a court. The anchors are FIXED on
 * purpose. The whole value of this data is that a 7 in November means the same
 * thing as a 7 in March; if the scale drifts, the trends become fiction.
 *
 * Adapted from the Borg CR-10 category-ratio scale, which is the scale the
 * session-RPE literature is built on.
 */
export const INTENSITY = [
  { value: 1,  label: 'Very light',   example: 'Walk-through, teaching on air, standing instruction' },
  { value: 2,  label: 'Light',        example: 'Form shooting, stationary ball handling, mobility' },
  { value: 3,  label: 'Easy',         example: 'Half-court shell, controlled 3v0, spot shooting' },
  { value: 4,  label: 'Moderate',     example: '5v0 offense at pace, closeout drills, passing series' },
  { value: 5,  label: 'Somewhat hard',example: 'Controlled half-court 5v5, box-out work' },
  { value: 6,  label: 'Hard',         example: 'Live half-court 5v5, competitive shooting with movement' },
  { value: 7,  label: 'Very hard',    example: 'Full-court 5v5, transition drills, scrimmage' },
  { value: 8,  label: 'Really hard',  example: 'Full-court live with pressure, press break, extended runs' },
  { value: 9,  label: 'Extremely hard',example:'Conditioning, suicides, competitive full-court repeats' },
  { value: 10, label: 'Maximal',      example: 'All-out sprints, max testing, nothing left after' },
];

/* ---- the objective grid ---------------------------------------------
 *
 * A better way to set intensity than asking "how hard did that feel", taken
 * from the coach's own framework. Three facts about a drill, none of which is
 * a matter of opinion:
 *
 *   COURT      how much ground each player has to cover
 *   SITUATION  how many players share it — fewer players, nowhere to hide
 *   RHYTHM     how much continuous work before a stop
 *
 * Court dimension appears in the original as a VOLUME input. It sits in
 * intensity here because intensity is a rate: court size sets how much ground
 * gets covered per minute, and the stopwatch supplies the minutes. Multiply
 * the two back together and you are at the same place, but with a measured
 * duration instead of an estimated one.
 *
 * CONTACT is the fourth input, and it is smaller than it looks. Measured
 * matched pairs — the same court and player count, with and without live
 * defence — move intensity by less than this grid's own error, and at half
 * court the contested version measured LOWER than the unopposed one.
 *
 * What the data does show is a systematic bias the other way: unopposed work
 * is consistently EASIER than the grid predicts, by about 0.7. Dropping the
 * situation one level when there is no defence absorbs that without adding a
 * fudge factor — a 3v0 behaves like a 4v4.
 *
 * Checked against 22 measured drill values spanning all three source images:
 * R-squared 0.93, mean error 0.44 on a 1-10 scale. See tests/intensity.test.js.
 *
 * Contact still matters enormously — but for INJURY RISK, not for intensity.
 * It is therefore tracked as exposure (contact minutes) alongside the movement
 * tags, and deliberately kept out of the load number.
 */

export const COURT_LEVELS = [
  { value: 5, label: 'Full court',         note: 'End to end' },
  { value: 4, label: 'Three-quarter court',note: 'From the far free-throw line' },
  { value: 3, label: 'Half court',         note: 'One end only' },
  { value: 2, label: 'Inside the arc',     note: 'Confined to the three-point line' },
  { value: 1, label: 'Stationary',         note: 'Spot work, little or no travel' },
];

export const SITUATION_LEVELS = [
  { value: 5, label: '1v1', note: 'Nowhere to hide, no rest in the possession' },
  { value: 4, label: '2v2', note: 'Also 2v1' },
  { value: 3, label: '3v3', note: 'Also 3v2' },
  { value: 2, label: '4v4', note: 'Also 4v3' },
  { value: 1, label: '5v5', note: 'Most players sharing the floor, most standing' },
];

/* Whether there is live opposition. Counted by attacking players either way:
 * a 3v0 breakdown drill is situation 3, with `contact` false. */
export const CONTACT_LEVELS = [
  { value: true,  label: 'Live defence',  note: 'Contested. Someone is trying to stop them.' },
  { value: false, label: 'No defence',    note: 'Unopposed pattern work — 5v0, 3v0, shooting, walk-through.' },
];

export const RHYTHM_LEVELS = [
  { value: 5, label: 'Non-stop',                note: 'Continuous, no dead time' },
  { value: 4, label: 'Three lengths, then stop',note: '' },
  { value: 3, label: 'Two lengths, then stop',  note: '' },
  { value: 2, label: 'One length, then stop',   note: '' },
  { value: 1, label: 'Half-court action, then stop', note: 'Reset after each rep' },
];

/**
 * Average the three levels and put the result on the same 1-10 scale the rest
 * of the app uses. Deliberately simple: the coach can do this arithmetic in
 * his head and check it, which matters more than squeezing out the last of the
 * fit. Averaging (not multiplying) is what matched the measured data — the
 * three factors trade off against each other rather than compounding.
 */
export function deriveIntensity(court, situation, rhythm, contact = true) {
  const c = clampLevel(court);
  const r = clampLevel(rhythm);
  // Unopposed work behaves like one situation level fewer. See the note above.
  const s = clampLevel(contact === false ? clampLevel(situation) - 1 : situation);
  return Math.round((((c + s + r) / 3) * 2) * 10) / 10;
}

function clampLevel(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 1;
  return Math.min(5, Math.max(1, n));
}

/** Where a drill's intensity number came from — recorded so the analysis can
 *  be honest about how much to trust it. */
export const INTENSITY_MODES = [
  { value: 'derived',  label: 'From the grid',   note: 'Court, players and rhythm. Repeatable, and the same in March as in November.' },
  { value: 'measured', label: 'Measured value',  note: 'A real number from tracking data. The most trustworthy source there is.' },
  { value: 'manual',   label: 'My own rating',   note: 'Your judgement, 1-10. For anything the grid does not describe — lifting, rehab, individual work.' },
];

/** The final 1-10 number for a drill, whichever way it was set. */
export function resolveIntensity(drill) {
  if (!drill) return 5;
  // Number(null) and Number('') are both 0, which is finite — so an empty
  // measurement would quietly resolve to the lightest possible intensity and
  // hide load. Reject the empty cases explicitly before converting.
  const m = drill.measured;
  const hasMeasurement = m !== null && m !== undefined && m !== '' && Number.isFinite(Number(m));
  if (drill.intensityMode === 'measured' && hasMeasurement) {
    return Math.min(10, Math.max(1, Number(m)));
  }
  if (drill.intensityMode === 'manual') return Number(drill.intensity) || 5;
  return deriveIntensity(drill.court, drill.situation, drill.rhythm, drill.contact !== false);
}

/* ---- movement demands ------------------------------------------------
 *
 * One intensity number cannot say WHAT KIND of work a drill was, and the kind
 * is what predicts the injury. Two drills can both be a 7 and load completely
 * different tissue. Set once per drill, never during practice.
 */

export const TISSUE = [
  { key: 'jump',   label: 'Jumping',             why: 'Achilles and patellar tendon', example: 'Rebounding, finishing, box-outs, repeated take-offs' },
  { key: 'sprint', label: 'Sprinting',           why: 'Hamstrings',                   example: 'Full-court running at or near top speed' },
  { key: 'cod',    label: 'Change of direction', why: 'Ankles and groin',             example: 'Cutting, closeouts, defensive slides, reacting to a live ball' },
];

export const TISSUE_LEVELS = [
  { value: 0, label: 'None' },
  { value: 1, label: 'Low' },
  { value: 2, label: 'Moderate' },
  { value: 3, label: 'High' },
];

export function tissueOf(drill, key) {
  const v = drill && drill.tissue ? drill.tissue[key] : undefined;
  return (v === undefined || v === null) ? null : Number(v);
}

/** A drill with no movement tags contributes nothing to the tissue totals,
 *  and the analysis has to say so rather than quietly counting it as zero. */
export function hasTissueTags(drill) {
  return TISSUE.some((t) => tissueOf(drill, t.key) !== null);
}

export function intensityInfo(value) {
  const v = Math.round(Number(value)) || 5;
  return INTENSITY.find((i) => i.value === v) || INTENSITY[4];
}

/* Colour band for an intensity value — used consistently everywhere so the
 * coach learns the colours the way he'd learn a heat map. */
export function intensityBand(value) {
  const v = Math.round(Number(value));
  if (v <= 2) return 'i1';
  if (v <= 4) return 'i2';
  if (v <= 6) return 'i3';
  if (v <= 8) return 'i4';
  return 'i5';
}

/* ---- drill categories ----------------------------------------------- */

export const DEFAULT_CATEGORIES = [
  'Warm-up',
  'Skill development',
  'Shooting',
  'Offense',
  'Defense',
  'Transition',
  'Live / scrimmage',
  'Conditioning',
  'Strength / power',
  'Cool-down / recovery',
];

/* ---- participation --------------------------------------------------
 *
 * A player is in a drill fully, at reduced volume, or not at all. "Limited"
 * counts as half. That 0.5 is a judgement call, not a measurement — it is
 * labelled as such in the UI so nobody mistakes it for precision.
 */
export const PARTICIPATION = {
  full: 1,
  limited: 0.5,
  out: 0,
};

/* ---- factories ------------------------------------------------------ */

export function makePlayer(fields = {}) {
  return {
    id: newId('plr'),
    name: '',
    number: '',
    position: '',
    status: 'active',        // active | injured | inactive
    createdAt: new Date().toISOString(),
    ...fields,
  };
}

export function makeDrill(fields = {}) {
  return {
    id: newId('drl'),
    name: '',
    category: 'Skill development',

    intensityMode: 'derived',
    court: 3,          // half court
    situation: 1,      // 5v5
    rhythm: 1,         // half-court action, then stop
    contact: true,     // live defence; false for 5v0-style pattern work
    measured: null,    // a real tracked value, when one exists
    intensity: 4,      // the resolved 1-10 number; kept in sync on save

    tissue: { jump: null, sprint: null, cod: null },

    typicalMinutes: 10,
    notes: '',
    archived: false,
    createdAt: new Date().toISOString(),
    ...fields,
  };
}

export function makeSession(fields = {}) {
  const now = new Date();
  return {
    id: newId('ses'),
    date: toDateKey(now),
    label: '',
    type: 'Practice',        // Practice | Game | Lift | Recovery | Other
    status: 'live',          // live | complete
    startedAt: now.toISOString(),
    endedAt: null,
    tags: [],
    notes: '',
    custom: {},
    createdAt: now.toISOString(),
    ...fields,
  };
}

export function makeBlock(fields = {}) {
  return {
    id: newId('blk'),
    sessionId: null,
    drillId: null,
    drillName: '',           // snapshot, so renaming a drill never rewrites history
    intensity: 5,            // snapshot, adjustable in the moment
    tissue: { jump: null, sprint: null, cod: null }, // snapshot too
    contact: true,           // snapshot: was this contested?
    group: 'Team',           // 'Team', or a station name when practice splits
    startedAt: null,
    endedAt: null,
    elapsedMs: 0,            // accumulated, so pause/resume works
    liveMs: null,            // time the ball was actually live, from the coach's
                             // own stopwatch. null means never measured — which
                             // is not the same as zero.
    running: false,
    lastResumedAt: null,
    participation: {},       // playerId -> 1 | 0.5 | 0 ; absent means full
    note: '',
    createdAt: new Date().toISOString(),
    ...fields,
  };
}

export function makePlayerSession(fields = {}) {
  return {
    id: newId('psn'),
    sessionId: null,
    playerId: null,
    rpe: null,               // 1-10, the player's own felt exertion
    custom: {},
    createdAt: new Date().toISOString(),
    ...fields,
  };
}

export function makeCustomField(fields = {}) {
  return {
    id: newId('fld'),
    name: '',
    scope: 'session',        // session | player
    type: 'scale',           // scale | number | boolean | text
    min: 1,
    max: 5,
    unit: '',
    order: 0,
    archived: false,
    createdAt: new Date().toISOString(),
    ...fields,
  };
}

/* ---- dates ----------------------------------------------------------
 * Everything is keyed by local calendar day (YYYY-MM-DD). A practice belongs
 * to the day the coach thinks it happened on, not to a UTC timestamp.
 */

export function toDateKey(d) {
  const dt = (d instanceof Date) ? d : new Date(d);
  const pad = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

export function fromDateKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(key, n) {
  const d = fromDateKey(key);
  d.setDate(d.getDate() + n);
  return toDateKey(d);
}

export function formatDate(key, { weekday = true } = {}) {
  const d = fromDateKey(key);
  return d.toLocaleDateString(undefined, {
    weekday: weekday ? 'short' : undefined,
    month: 'short',
    day: 'numeric',
  });
}
