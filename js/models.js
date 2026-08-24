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
/* What the coach actually picks: the matchup as he would say it out loud.
 * Each option is just a (situation, contact) pair — the two fields underneath
 * are unchanged, and so is the formula.
 *
 * Note the deliberate flat spot at five players: 5v5 and 5v0 resolve to the
 * same number. The situation scale bottoms out at 5v5, so the no-defence
 * adjustment has nowhere left to drop. That is not an oversight — the club's
 * own matched pair (5v5 FC 5.75, 5v0 FC 5.50, same court and rhythm) differ by
 * 0.25, well inside the grid's own error of 0.46 and the +/-0.64 the same
 * drill varies by between runs. Forcing them apart made the fit measurably
 * worse (R-squared 0.937 -> 0.926), so the flat spot stays and the UI says so
 * rather than hiding it. */
export const SITUATION_OPTIONS = [
  { situation: 5, contact: true,  label: '1v1' },
  { situation: 5, contact: false, label: '1v0' },
  { situation: 4, contact: true,  label: '2v2', note: 'Also 2v1' },
  { situation: 4, contact: false, label: '2v0' },
  { situation: 3, contact: true,  label: '3v3', note: 'Also 3v2' },
  { situation: 3, contact: false, label: '3v0' },
  { situation: 2, contact: true,  label: '4v4', note: 'Also 4v3' },
  { situation: 2, contact: false, label: '4v0' },
  { situation: 1, contact: true,  label: '5v5' },
  { situation: 1, contact: false, label: '5v0' },
];

/** Find the option matching a drill's stored situation + contact. */
export function situationOption(situation, contact) {
  const s = clampLevel(situation);
  const k = contact !== false;
  return SITUATION_OPTIONS.find((o) => o.situation === s && o.contact === k)
      || SITUATION_OPTIONS[SITUATION_OPTIONS.length - 2];
}

export const CONTACT_LEVELS = [
  { value: true,  label: 'Live defence',  note: 'Contested. Someone is trying to stop them.' },
  { value: false, label: 'No defence',    note: 'Unopposed pattern work — 5v0, 3v0, shooting, walk-through.' },
];

/* RHYTHM — how long the action runs before something stops it.
 *
 * Originally worded purely in court lengths, which works for rep-based drills
 * and says nothing useful about live play: a scrimmage is stopped by a whistle,
 * not by a rep count. The coach could not tell a continuous Spanish 5v5 apart
 * from a whistle-heavy scrimmage, so both were rated non-stop and both came out
 * at 7.3 — the complaint that prompted this rewording.
 *
 * The levels and the maths are UNCHANGED. Only the labels are. The original
 * court-length anchors are kept in the notes so the 43 imported library drills,
 * which were rated against that wording, still mean what they meant. */
export const RHYTHM_LEVELS = [
  { value: 5, label: 'Non-stop',        note: 'Nothing interrupts it. Continuous 5v5, Spanish, rolling transition.' },
  { value: 4, label: 'Rare stops',      note: 'Long runs between breaks. Around three lengths; a scrimmage with few whistles.' },
  { value: 3, label: 'Regular stops',   note: 'Whistles, free throws, subs. Around two lengths between breaks.' },
  { value: 2, label: 'Frequent stops',  note: 'One length, or one possession, then a reset.' },
  { value: 1, label: 'Stop-start',      note: 'Reset after every rep. Half-court action, then stop.' },
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

/* ---- what the player says ---------------------------------------------
 *
 * The same 1-10 scale, worded from the player's side. The drill anchors above
 * describe what a drill IS ("half-court shell, controlled 3v0"); a player is
 * not rating a drill, he is rating his own afternoon, and asking him to match
 * himself against a list of drills would produce the coach's answer back.
 *
 * Deliberately blunt and short: this gets asked in a corridor, often in a
 * second language, sometimes while someone is putting his shoes on.
 *
 * Ask about 30 minutes after the session (Foster et al.) — asked on the floor,
 * the last drill dominates the answer instead of the whole practice.
 */
export const RPE_SCALE = [
  { value: 1,  label: 'Very light',      example: 'Barely felt like training' },
  { value: 2,  label: 'Light',           example: 'Easy the whole way through' },
  { value: 3,  label: 'Easy',            example: 'Comfortable, never out of breath' },
  { value: 4,  label: 'Moderate',        example: 'Working, but could talk' },
  { value: 5,  label: 'Somewhat hard',   example: 'Breathing hard in places' },
  { value: 6,  label: 'Hard',            example: 'Had to push at times' },
  { value: 7,  label: 'Very hard',       example: 'Tired, glad of the breaks' },
  { value: 8,  label: 'Really hard',     example: 'Heavy legs, wanted it to end' },
  { value: 9,  label: 'Extremely hard',  example: 'Almost nothing left' },
  { value: 10, label: 'Maximal',         example: 'Could not have done more' },
];

/** The player-facing wording for a 1-10 answer. */
export function rpeInfo(v) {
  const n = Math.min(10, Math.max(1, Math.round(Number(v) || 0)));
  return RPE_SCALE.find((r) => r.value === n) || RPE_SCALE[4];
}

/* ---- practice groups -------------------------------------------------
 *
 * Practice runs as a whole squad most of the time, so 'Team' stays first and
 * costs zero taps. When it does split, the coach's own words are what matter:
 * he works smalls against bigs, in two groups, not the guards / wings / bigs
 * split this originally shipped with. Same principle as tags and categories —
 * the presets are a first guess by someone who is not in that gym. Editable in
 * Settings; stored under the 'groups' meta key. */
export const DEFAULT_GROUPS = ['Team', 'Bigs', 'Smalls'];

/* ---- where a practice sits in the game week --------------------------
 *
 * Set BY HAND when the practice starts, not worked out from a fixture list.
 * The coach knows what day it is; making the app infer it from recorded games
 * meant it could only ever label the past, needed a second list of upcoming
 * fixtures to label the present, and gave two sources of truth for one fact.
 * One dropdown removes all of that.
 *
 * GD-X means "more than five days out". Those practices still count in every
 * load, drill and weekly total — they are simply left out of the game-week
 * comparisons, because there is no game week to compare them against.
 *
 * null means he has not said. That is NOT the same as GD-X, and the analysis
 * reports it rather than assuming: same rule as an untimed clock, an untagged
 * movement profile, an unrated drill and a missing RPE.
 */
export const GAME_DAYS = [
  { value: 'GD',   label: 'GD',   note: 'Game day' },
  { value: 'GD-1', label: 'GD-1', note: 'Day before the game' },
  { value: 'GD-2', label: 'GD-2', note: 'Two days out' },
  { value: 'GD-3', label: 'GD-3', note: 'Three days out' },
  { value: 'GD-4', label: 'GD-4', note: 'Four days out' },
  { value: 'GD-5', label: 'GD-5', note: 'Five days out' },
  { value: 'GD-X', label: 'GD-X', note: 'More than five days out — no game-week analysis' },
];

/** The order he reads a week in: furthest out first, game day last. */
export const GAME_DAY_ORDER = ['GD-5', 'GD-4', 'GD-3', 'GD-2', 'GD-1', 'GD'];

/** Does this label belong in the game-week comparisons? GD-X and unset do not. */
export function isGameWeekDay(value) {
  return GAME_DAY_ORDER.includes(value);
}

export function gameDayInfo(value) {
  return GAME_DAYS.find((g) => g.value === value) || null;
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
    gameDay: null,           // 'GD' | 'GD-1'..'GD-5' | 'GD-X' | null (not said)
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
    category: null,          // snapshot too: re-filing a drill in the library
                             // must not rewrite what last November's practices
                             // were made of. Null on runs recorded before this
                             // existed, which fall back to the library.
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
