/* tests/library.test.js — importing a drill library from a file.
 *
 * The club's real library lives in `private/drill-library.json`, which is not
 * in the repository. These tests build their own fixture, so they run anywhere;
 * where the private file IS present, they also check it loads cleanly.
 *
 * The property that matters most here: importing drills must NEVER touch a
 * recorded practice. A full backup restore replaces the database; this must not.
 */

import { flush, resetDatabases } from './harness.js';

const db = await import('../js/db.js');
const { makeDrill, makePlayer, makeSession, makeBlock, resolveIntensity } = await import('../js/models.js');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) pass++; else { fail++; print(`FAIL  ${name}${detail ? `  (${detail})` : ''}`); }
}
function eq(name, a, b) { ok(name, a === b, `got ${a}, expected ${b}`); }

function libraryFile(drills) {
  return {
    format: 'drill-load-backup', version: 1, exportedAt: '2026-08-18T00:00:00.000Z',
    data: { players: [], sessions: [], blocks: [], playerSessions: [], customFields: [], meta: [], drills },
  };
}

/* Synthetic values on purpose — the club's real numbers stay out of this
   repository. The real library is exercised at the end of this file, only when
   private/drill-library.json is present. */
const fixture = libraryFile([
  makeDrill({ id: 'drl_a', name: 'Half court sample drill', category: 'Live / scrimmage', intensityMode: 'measured', measured: 5.00, intensity: 5.00 }),
  makeDrill({ id: 'drl_b', name: 'Full court sample drill', category: 'Live / scrimmage', intensityMode: 'measured', measured: 7.00, intensity: 7.00 }),
  makeDrill({ id: 'drl_c', name: 'Grid-rated sample drill', category: 'Live / scrimmage', intensityMode: 'derived', court: 5, situation: 5, rhythm: 5, contact: true }),
]);

resetDatabases();

/* ---- a clean import ---- */
let res = await db.importDrills(fixture);
await flush();
eq('every drill in the file is added', res.added, 3);
eq('nothing is skipped on a clean library', res.skipped, 0);
eq('and they are in the database', (await db.getAll(db.STORES.drills)).length, 3);

const measured = (await db.getAll(db.STORES.drills)).find((d) => d.name === 'Full court sample drill');
eq('a measured drill keeps its value', measured.measured, 7.00);
eq('and resolves to it', resolveIntensity(measured), 7.00);

/* ---- running it twice must not duplicate ---- */
res = await db.importDrills(fixture);
await flush();
eq('a second import adds nothing', res.added, 0);
eq('and skips everything', res.skipped, 3);
eq('the library is unchanged', (await db.getAll(db.STORES.drills)).length, 3);

/* ---- THE IMPORTANT ONE: importing must not destroy a season ---- */
await db.clearAll();
await flush();

const player = makePlayer({ name: 'Marko Jokic', number: '4' });
const session = makeSession({ date: '2026-08-17', label: 'Monday', status: 'complete', rosterIds: [player.id] });
const block = makeBlock({ sessionId: session.id, drillName: 'Old drill', intensity: 6, elapsedMs: 15 * 60000 });
await db.put(db.STORES.players, player);
await db.put(db.STORES.sessions, session);
await db.put(db.STORES.blocks, block);
await db.put(db.STORES.drills, makeDrill({ name: 'My own drill', intensityMode: 'manual', intensity: 9 }));
await db.setMeta('askLiveTime', false);
await flush();

await db.importDrills(fixture);
await flush();

eq('the roster survives an import', (await db.getAll(db.STORES.players)).length, 1);
eq('recorded sessions survive an import', (await db.getAll(db.STORES.sessions)).length, 1);
eq('recorded drill runs survive an import', (await db.getAll(db.STORES.blocks)).length, 1);
eq('settings survive an import', await db.getMeta('askLiveTime'), false);
eq('the coach’s own drill is still there', (await db.getAll(db.STORES.drills)).filter((d) => d.name === 'My own drill').length, 1);
eq('and the imported drills were added alongside', (await db.getAll(db.STORES.drills)).length, 4);

/* ---- name clashes leave the coach's version alone ---- */
await db.clearAll();
await flush();
await db.put(db.STORES.drills, makeDrill({ name: 'Half court sample drill', category: 'Mine', intensityMode: 'manual', intensity: 9 }));
res = await db.importDrills(fixture);
await flush();
const clash = (await db.getAll(db.STORES.drills)).filter((d) => d.name === 'Half court sample drill');
eq('a clash leaves exactly one drill', clash.length, 1);
eq('and it is the coach’s', clash[0].intensity, 9);
eq('and keeps his category', clash[0].category, 'Mine');
eq('one drill was skipped', res.skipped, 1);

/* ---- a colliding id must not overwrite an unrelated drill ---- */
await db.clearAll();
await flush();
await db.put(db.STORES.drills, makeDrill({ id: 'drl_a', name: 'Something else entirely', intensity: 5 }));
await db.importDrills(fixture);
await flush();
const all = await db.getAll(db.STORES.drills);
eq('a reused id does not clobber an existing drill', all.filter((d) => d.name === 'Something else entirely').length, 1);
eq('and the incoming drill is still added', all.filter((d) => d.name === 'Half court sample drill').length, 1);
eq('with a fresh id', all.length, 4);

/* ---- bad input ---- */
let threw = false;
try { await db.importDrills({ format: 'something-else' }); } catch (e) { threw = true; }
ok('a foreign file is rejected', threw);

res = await db.importDrills(libraryFile([]));
eq('an empty library reports nothing added', res.added, 0);

res = await db.importDrills({ format: 'drill-load-backup', data: {} });
eq('a backup with no drills section is handled', res.added, 0);

const noName = await db.importDrills(libraryFile([{ ...makeDrill({ name: '' }), id: 'drl_x' }]));
eq('a nameless drill is skipped rather than imported', noName.added, 0);

/* ---- the club's real library, when it is present ---- */
let real = null;
try { real = JSON.parse(readFile('./private/drill-library.json')); } catch (e) { /* not in a fresh clone */ }

if (!real) {
  print('SKIP  club drill library — private/drill-library.json not present');
} else {
  await db.clearAll();
  await flush();
  const out = await db.importDrills(real);
  await flush();
  const stored = await db.getAll(db.STORES.drills);
  ok(`the real library imports cleanly (${out.added} drills)`, out.added === stored.length && out.added > 30);
  ok('every drill has a name', stored.every((d) => d.name && d.name.trim()));
  ok('every drill resolves to a sane intensity',
    stored.every((d) => resolveIntensity(d) >= 1 && resolveIntensity(d) <= 10));
  ok('nothing arrives pre-tagged for movement',
    stored.every((d) => !d.tissue || (d.tissue.jump === null && d.tissue.sprint === null && d.tissue.cod === null)));
  const again = await db.importDrills(real);
  eq('and re-importing it adds nothing', again.added, 0);
}

print(`\n${pass} passed, ${fail} failed`);
if (fail) throw new Error(`${fail} test(s) failed`);
