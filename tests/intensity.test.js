/* tests/intensity.test.js — the objective intensity grid.
 *
 * The important test here is the last one: the grid is checked against the
 * club's own measured drill values. If someone changes the formula and the fit
 * degrades, this fails. That is the point — the formula's only justification
 * is that it reproduces those measurements.
 */

import {
  deriveIntensity, resolveIntensity, intensityInfo, intensityBand,
  COURT_LEVELS, SITUATION_LEVELS, RHYTHM_LEVELS, CONTACT_LEVELS,
  TISSUE, TISSUE_LEVELS, tissueOf, hasTissueTags, makeDrill,
} from '../js/models.js';
import {
  blockTissue, sessionTissueByPlayer, tissueCoverage,
  blockContactMinutes, sessionContactByPlayer, contactShare,
} from '../js/load.js';

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) pass++; else { fail++; print(`FAIL  ${name}${detail ? `  (${detail})` : ''}`); }
}
function eq(name, a, b, tol = 1e-9) {
  ok(name, (typeof b === 'number' && typeof a === 'number') ? Math.abs(a - b) <= tol : a === b, `got ${a}, expected ${b}`);
}

const mins0 = (m) => ({ elapsedMs: m * 60000, running: false, lastResumedAt: null });

/* ---- scales are the ones from the coach's framework ---- */
eq('five court levels', COURT_LEVELS.length, 5);
eq('full court is the top court level', COURT_LEVELS[0].value, 5);
eq('stationary is the bottom', COURT_LEVELS[4].value, 1);
eq('1v1 is the most intense situation', SITUATION_LEVELS[0].label, '1v1');
eq('5v5 is the least', SITUATION_LEVELS[4].label, '5v5');
eq('non-stop is the top rhythm', RHYTHM_LEVELS[0].label, 'Non-stop');

/* ---- the formula ---- */
eq('everything at minimum gives 2', deriveIntensity(1, 1, 1), 2);
eq('everything at maximum gives 10', deriveIntensity(5, 5, 5), 10);
eq('half court 5v5 stop-start', deriveIntensity(3, 1, 1), 3.3);
eq('full court 2v2 non-stop', deriveIntensity(5, 4, 5), 9.3);
eq('out-of-range input is clamped, not trusted', deriveIntensity(99, -4, 3), deriveIntensity(5, 1, 3));

/* averaging, not multiplying: the factors trade off rather than compound */
ok('full court 5v5 is less than half court 1v1 non-stop',
  deriveIntensity(5, 1, 1) < deriveIntensity(3, 5, 5),
  `${deriveIntensity(5, 1, 1)} vs ${deriveIntensity(3, 5, 5)}`);

/* ---- live defence ---- */
eq('contact is a two-way choice', CONTACT_LEVELS.length, 2);
eq('contested is the default', CONTACT_LEVELS[0].value, true);

eq('unopposed work drops one situation level',
  deriveIntensity(5, 3, 5, false), deriveIntensity(5, 2, 5, true));
eq('5v0 half court', deriveIntensity(3, 1, 2, false), deriveIntensity(3, 1, 2, true));
ok('a 3v0 is easier than a 3v3 on the same court and rhythm',
  deriveIntensity(5, 3, 4, false) < deriveIntensity(5, 3, 4, true));
eq('contact defaults to true when unspecified', deriveIntensity(5, 3, 4), deriveIntensity(5, 3, 4, true));
eq('5v5 cannot drop below the bottom level',
  deriveIntensity(3, 1, 1, false), deriveIntensity(3, 1, 1, true));

const noDefence = makeDrill({ intensityMode: 'derived', court: 5, situation: 3, rhythm: 4, contact: false });
const contested = makeDrill({ intensityMode: 'derived', court: 5, situation: 3, rhythm: 4, contact: true });
ok('resolveIntensity honours the defence flag',
  resolveIntensity(noDefence) < resolveIntensity(contested),
  `${resolveIntensity(noDefence)} vs ${resolveIntensity(contested)}`);

/* ---- contact exposure is counted, but kept out of load ---- */
const live20 = { ...mins0(20), intensity: 7, participation: {}, contact: true };
const dead20 = { ...mins0(20), intensity: 7, participation: {}, contact: false };
eq('contested minutes count as contact', blockContactMinutes(live20), 20);
eq('unopposed minutes do not', blockContactMinutes(dead20), 0);
eq('a block with no contact field counts as contested',
  blockContactMinutes({ ...mins0(10), intensity: 5, participation: {} }), 10);

const share = contactShare([live20, dead20]);
eq('half the session was contested', share.fraction, 0.5);
eq('contact minutes are totalled', share.contactMinutes, 20);

eq('a player who sat out gets no contact exposure',
  sessionContactByPlayer([{ ...live20, participation: { p1: 0 } }], ['p1']).get('p1'), 0);
eq('a limited player gets half the contact exposure',
  sessionContactByPlayer([{ ...live20, participation: { p1: 0.5 } }], ['p1']).get('p1'), 10);

/* ---- where the number comes from ---- */
const gridDrill = makeDrill({ intensityMode: 'derived', court: 5, situation: 4, rhythm: 5 });
eq('a grid drill resolves from the grid', resolveIntensity(gridDrill), 9.3);

const measuredDrill = makeDrill({ intensityMode: 'measured', measured: 7.25, court: 1, situation: 1, rhythm: 1 });
eq('a measured drill uses its measurement, not the grid', resolveIntensity(measuredDrill), 7.25);

const manualDrill = makeDrill({ intensityMode: 'manual', intensity: 6, court: 1, situation: 1, rhythm: 1 });
eq('a judged drill uses the coach rating', resolveIntensity(manualDrill), 6);

const brokenMeasured = makeDrill({ intensityMode: 'measured', measured: null, court: 3, situation: 1, rhythm: 1 });
eq('a measured drill with no number falls back to the grid', resolveIntensity(brokenMeasured), 3.3);

/* fractional intensities must not break the colour bands or labels */
ok('a fractional intensity still gets a band', typeof intensityBand(3.3) === 'string');
ok('a fractional intensity still gets a label', !!intensityInfo(3.3).label);
eq('3.3 rounds into the 3 band', intensityBand(3.3), intensityBand(3));

/* ---- movement tags ---- */
eq('three tissues are tracked', TISSUE.length, 3);
eq('four levels each', TISSUE_LEVELS.length, 4);

const untagged = makeDrill({});
ok('a new drill starts untagged', !hasTissueTags(untagged));
eq('an untagged tissue reads as null, not zero', tissueOf(untagged, 'jump'), null);

const tagged = makeDrill({ tissue: { jump: 3, sprint: 1, cod: 2 } });
ok('a tagged drill is recognised', hasTissueTags(tagged));

const mins = mins0;
const jumpy = { ...mins(20), intensity: 7, participation: {}, tissue: { jump: 3, sprint: 1, cod: 2 } };
const plain = { ...mins(20), intensity: 7, participation: {}, tissue: { jump: null, sprint: null, cod: null } };

eq('jump score is level x minutes', blockTissue(jumpy, 'jump'), 60);
eq('sprint score is separate', blockTissue(jumpy, 'sprint'), 20);
eq('an untagged drill scores null, not zero', blockTissue(plain, 'jump'), null);

const jumpBy = sessionTissueByPlayer([jumpy], ['p1', 'p2'], 'jump');
eq('everyone in the drill gets the jump score', jumpBy.get('p1'), 60);

const halfIn = { ...jumpy, participation: { p2: 0.5 } };
eq('a limited player gets half the jumping', sessionTissueByPlayer([halfIn], ['p2'], 'jump').get('p2'), 30);
eq('a player who sat out gets none',
  sessionTissueByPlayer([{ ...jumpy, participation: { p3: 0 } }], ['p3'], 'jump').get('p3'), 0);

/* coverage: untagged drills must be declared, never silently zero */
const cov = tissueCoverage([jumpy, plain]);
eq('half the minutes are tagged', cov.fraction, 0.5);
eq('coverage counts total minutes', cov.totalMinutes, 40);
eq('fully tagged reads as complete', tissueCoverage([jumpy]).fraction, 1);

/* ======================================================================
   The grid against the club's own measured values.
   ====================================================================== */

/* The measured values live in `private/measured-drills.json`, which is not in
   the repository — they are the club's own tracking data and are deliberately
   kept off public hosting. Without that file these checks skip rather than
   fail, so the public repo's suite still runs green. */

function loadMeasured() {
  try {
    const raw = readFile('./private/measured-drills.json');
    return JSON.parse(raw).drills.map((d) => [d.name, d.court, d.situation, d.rhythm, d.contact, d.measured]);
  } catch (e) {
    return null;
  }
}

const MEASURED = loadMeasured();

if (!MEASURED) {
  print('SKIP  fit against measured drill values — private/measured-drills.json not present');
} else {

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

let worst = 0, worstName = '';
const errors = [];
for (const [name, c, s, r, k, actual] of MEASURED) {
  const predicted = deriveIntensity(c, s, r, k);
  const err = Math.abs(predicted - actual);
  errors.push(err);
  if (err > worst) { worst = err; worstName = name; }
}

const mae = mean(errors);
const actuals = MEASURED.map((row) => row[5]);
const grandMean = mean(actuals);
const ssTot = actuals.reduce((sum, a) => sum + (a - grandMean) ** 2, 0);
const ssRes = MEASURED.reduce((sum, [, c, s, r, k, a]) => sum + (a - deriveIntensity(c, s, r, k)) ** 2, 0);
const r2 = 1 - ssRes / ssTot;

ok(`grid predicts ${MEASURED.length} measured drills within 0.6 on average (got ${mae.toFixed(2)})`, mae < 0.6);
ok(`no single drill is off by more than 1.4 (worst: ${worstName} ${worst.toFixed(2)})`, worst < 1.4);
ok(`grid explains at least 90% of the variation (R-squared ${r2.toFixed(3)})`, r2 > 0.90);

/* The defence adjustment must actually earn its place: without it the fit
   should be measurably worse. If it is not, drop the extra input. */
const naiveErrors = MEASURED.map(([, c, s, r, , a]) => Math.abs(deriveIntensity(c, s, r, true) - a));
const naiveMae = mean(naiveErrors);
ok(`treating unopposed work as contested fits worse (${naiveMae.toFixed(2)} vs ${mae.toFixed(2)})`,
  naiveMae > mae + 0.1, `naive ${naiveMae.toFixed(2)}, adjusted ${mae.toFixed(2)}`);

/* Contact must NOT be a large intensity effect — the matched pairs say so.
   If someone later inflates it, this fails. */
const pairs = [
  ['5v5 half court', deriveIntensity(3, 1, 1, false), deriveIntensity(3, 1, 1, true)],
  ['5v5 full court', deriveIntensity(5, 1, 3, false), deriveIntensity(5, 1, 3, true)],
];
for (const [label, off, on] of pairs) {
  ok(`${label}: live defence changes intensity by less than 1.0`, Math.abs(on - off) < 1.0, `${off} vs ${on}`);
}

/* the ordering must hold even where the exact number does not */
const ordered = MEASURED.slice().sort((a, b) => a[5] - b[5]);
let inversions = 0;
for (let i = 0; i < ordered.length; i++) {
  for (let j = i + 1; j < ordered.length; j++) {
    const [, ci, si, ri, ki] = ordered[i];
    const [, cj, sj, rj, kj] = ordered[j];
    if (deriveIntensity(ci, si, ri, ki) > deriveIntensity(cj, sj, rj, kj) + 0.9) inversions++;
  }
}
const totalPairs = (ordered.length * (ordered.length - 1)) / 2;
ok(`the grid rarely ranks a lighter drill above a harder one (${inversions} bad pairs of ${totalPairs})`,
  inversions <= totalPairs * 0.05, String(inversions));

print(`fit: R-squared ${r2.toFixed(3)}, mean error ${mae.toFixed(2)}, worst ${worst.toFixed(2)} (${worstName})`);
}
print(`${pass} passed, ${fail} failed`);
if (fail) throw new Error(`${fail} test(s) failed`);
