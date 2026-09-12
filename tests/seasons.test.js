/* tests/seasons.test.js — run with:
 *   /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m tests/seasons.test.js
 *
 * Which season and phase a practice belongs to. The tests that matter are the
 * edges: 20.9 is the last day of preseason and 21.9 the first of inseason, a
 * season with no end runs until the next one starts, and a phase he has not
 * dated yet is not an empty range.
 */

import {
  suggestLabel, seasonEnd, seasonFor, phaseOn, phaseRange, inRange, closeRange,
  viewedSeason, validateSeason, outsideEverySeason,
} from '../js/seasons.js';

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; print(`FAIL  ${name}${detail ? `  (${detail})` : ''}`); }
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  ok(name, a === e, `got ${a}, expected ${e}`);
}

const s26 = { id: 's26', label: '2026/2027', start: '2026-08-01', inseason: '2026-09-21', offseason: null, end: null };
const s27 = { id: 's27', label: '2027/2028', start: '2027-08-02', inseason: null, offseason: null, end: null };
const both = [s27, s26];   // deliberately out of order

/* ---- names ---- */
eq('an August start is this year / next', suggestLabel('2026-08-01'), '2026/2027');
eq('a spring date belongs to the season that started last year', suggestLabel('2027-03-10'), '2026/2027');

/* ---- the 20.9 boundary he gave ---- */
eq('20.9 is still preseason', phaseOn(s26, '2026-09-20', both), 'preseason');
eq('21.9 is inseason', phaseOn(s26, '2026-09-21', both), 'inseason');
eq('the day before the season is no phase', phaseOn(s26, '2026-07-31', both), null);
eq('preseason ends the day before inseason starts',
  phaseRange(s26, 'preseason', both), { from: '2026-08-01', to: '2026-09-20' });

/* ---- open ends ---- */
eq('with no end, a season runs until the next one starts', seasonEnd(s26, both), '2027-08-01');
eq('the latest season is open', seasonEnd(s27, both), null);
eq('so inseason runs to the day before next season',
  phaseRange(s26, 'inseason', both), { from: '2026-09-21', to: '2027-08-01' });
eq('a practice on 1.8.2027 is still last season', seasonFor(both, '2027-08-01').id, 's26');
eq('and 2.8.2027 is the new one', seasonFor(both, '2027-08-02').id, 's27');
ok('a practice before every season belongs to none', seasonFor(both, '2026-07-01') === null);

/* ---- a phase with no date is not an empty range ---- */
ok('inseason of a season that has not reached it is null, not empty', phaseRange(s27, 'inseason', both) === null);
ok('same for offseason', phaseRange(s26, 'offseason', both) === null);
eq('preseason of an open, undated season runs open', phaseRange(s27, 'preseason', both), { from: '2027-08-02', to: null });

/* ---- ranges ---- */
ok('an open range contains a far date', inRange({ from: '2026-01-01', to: null }, '2030-01-01'));
ok('a closed range ends where it says', !inRange({ from: '2026-01-01', to: '2026-01-31' }, '2026-02-01'));
eq('an open range closes at today for a report',
  closeRange({ from: '2027-08-02', to: null }, [], '2027-09-01'), { from: '2027-08-02', to: '2027-09-01' });
eq('or at a practice dated ahead of today',
  closeRange({ from: '2027-08-02', to: null }, [{ date: '2027-09-05' }], '2027-09-01').to, '2027-09-05');
eq('never before its own start',
  closeRange({ from: '2027-08-02', to: null }, [], '2027-07-01').to, '2027-08-02');

/* ---- which season the screens show ---- */
eq('the one he picked wins', viewedSeason(both, 's27', '2026-10-01').id, 's27');
eq('otherwise the one today is in', viewedSeason(both, null, '2026-10-01').id, 's26');
eq('otherwise the latest', viewedSeason(both, 'gone', '2020-01-01').id, 's27');
ok('none when nothing is set up', viewedSeason([], null) === null);

/* ---- validation, in his words ---- */
ok('a sensible season is accepted', validateSeason(s26, [s27]).length === 0, validateSeason(s26, [s27]).join(' | '));
ok('inseason before preseason is refused',
  validateSeason({ ...s26, inseason: '2026-07-01' }, []).some((e) => e.indexOf('before preseason') !== -1));
ok('offseason before inseason is refused',
  validateSeason({ ...s26, offseason: '2026-09-01' }, []).some((e) => e.indexOf('before inseason') !== -1));
ok('two seasons with one name are refused',
  validateSeason({ ...s27, id: 'x', start: '2028-08-01' }, [s27]).some((e) => e.indexOf('already a season') !== -1));
ok('an end that runs into the next season is refused',
  validateSeason({ ...s26, end: '2027-09-01' }, [s27]).some((e) => e.indexOf('overlap') !== -1));
ok('a missing start is refused', validateSeason({ id: 'n', label: 'X', start: '' }, []).length > 0);

/* ---- honesty: practices no season claims ---- */
eq('practices outside every season are counted, not dropped',
  outsideEverySeason([{ date: '2026-07-15' }, { date: '2026-08-15' }], both).length, 1);
eq('with no seasons at all nothing is "outside"', outsideEverySeason([{ date: '2026-07-15' }], []).length, 0);

print(`\n${pass} passed, ${fail} failed`);
if (fail) throw new Error(`${fail} test(s) failed`);
