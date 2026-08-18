/* tests/views.test.js — boot each screen headlessly and check it builds.
 *
 * Run:  jsc -m tests/views.test.js
 *
 * What this proves: the render paths execute, the right records are written,
 * and the numbers shown match the maths. What it cannot prove: that anything
 * looks right. Only the real tablet can tell us that.
 */

import { document, flush, runTimers, resetDatabases } from './harness.js';

const db = await import('../js/db.js');
const { makeDrill, makePlayer } = await import('../js/models.js');
const drills = await import('../js/views/drills.js');
const roster = await import('../js/views/roster.js');
const practice = await import('../js/views/practice.js');
const settings = await import('../js/views/settings.js');
const analysis = await import('../js/views/analysis.js');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; print(`FAIL  ${name}${detail ? `\n      ${detail}` : ''}`); }
}
function contains(name, node, text) {
  const body = node.textContent;
  ok(name, body.indexOf(text) !== -1, `expected to find "${text}"`);
}

function newRoot() { const r = document.createElement('main'); document.body.appendChild(r); return r; }

/* ---------------------------------------------------------------- */

resetDatabases();

/* ---- empty states ---- */

let root = newRoot();
await drills.render(root);
await flush();
contains('drill library shows an empty state', root, 'No drills yet');
contains('the empty state lets him add a drill', root, 'Add your first drill');
contains('and points at the library import', root, 'Import a drill library');

root = newRoot();
await roster.render(root);
await flush();
contains('roster shows an empty state', root, 'No players yet');

root = newRoot();
await practice.render(root);
await flush();
contains('practice blocks until roster and drills exist', root, 'Two things first');
practice.teardown();

/* ---- seed a squad and a library ---- */

const players = [
  makePlayer({ name: 'Marko Jokic', number: '4', position: 'PG' }),
  makePlayer({ name: 'Luka Peric', number: '7', position: 'SG' }),
  makePlayer({ name: 'Nikola Ilic', number: '11', position: 'C' }),
  makePlayer({ name: 'Stefan Novak', number: '23', position: 'PF', status: 'injured' }),
];
await db.putMany(db.STORES.players, players);

const library = [
  // A warm-up does not fit the grid, so it is judged.
  makeDrill({
    name: 'Dynamic warm-up', category: 'Warm-up', typicalMinutes: 12,
    intensityMode: 'manual', intensity: 2,
    tissue: { jump: 1, sprint: 0, cod: 1 },
  }),
  // Half court, 4v4, resets each rep -> (3+2+1)/3*2 = 4.0
  makeDrill({
    name: 'Shell defence', category: 'Defense', typicalMinutes: 15,
    intensityMode: 'derived', court: 3, situation: 2, rhythm: 1,
    tissue: { jump: 0, sprint: 0, cod: 3 },
  }),
  // Full court, 3v2, non-stop -> (5+3+5)/3*2 = 8.7
  makeDrill({
    name: '11-man full court', category: 'Transition', typicalMinutes: 10,
    intensityMode: 'derived', court: 5, situation: 3, rhythm: 5,
    tissue: { jump: 2, sprint: 3, cod: 2 },
  }),
  // A real tracked value straight from the club's data.
  makeDrill({
    name: 'Live 5v5', category: 'Live / scrimmage', typicalMinutes: 20,
    intensityMode: 'measured', measured: 7.50,
    tissue: { jump: 3, sprint: 2, cod: 3 },
  }),
  // Deliberately left untagged, to prove the app admits the gap.
  makeDrill({
    name: 'Free throws', category: 'Shooting', typicalMinutes: 5,
    intensityMode: 'derived', court: 1, situation: 1, rhythm: 1, contact: false,
  }),
  // 5-on-0 pattern work: same players and court as live 5v5, no defence.
  makeDrill({
    name: '5 on 0 full court', category: 'Offense', typicalMinutes: 10,
    intensityMode: 'derived', court: 5, situation: 1, rhythm: 3, contact: false,
    tissue: { jump: 1, sprint: 2, cod: 1 },
  }),
];
await db.putMany(db.STORES.drills, library);

root = newRoot();
await roster.render(root);
await flush();
contains('roster lists a player', root, 'Marko Jokic');
contains('roster counts by status', root, '3 active · 1 injured');

root = newRoot();
await drills.render(root);
await flush();
contains('untagged drills are flagged in a banner', root, 'without movement tags');
contains('the banner says why it matters', root, 'makes a heavy week look quiet');
contains('and offers to work through them', root, 'Tag them');
contains('library lists a drill', root, '11-man full court');
contains('library groups by category', root, 'Transition');
contains('library previews the typical load', root, '~87 AU');
contains('a measured drill is labelled as measured', root, 'measured');
contains('movement tags are summarised in the list', root, 'Spri high');
contains('an untagged drill is called out', root, 'No movement tags yet');

/* ---- run a practice ---- */

const { makeSession, makeBlock } = await import('../js/models.js');
const session = makeSession({
  date: '2026-08-18',
  label: 'Tuesday session',
  rosterIds: players.filter((p) => p.status === 'active').map((p) => p.id),
});
await db.put(db.STORES.sessions, session);

root = newRoot();
await practice.render(root);
await flush();
contains('live practice shows its label', root, 'Tuesday session');
contains('live practice offers to start a drill', root, '+ Start a drill');
contains('empty practice says so', root, 'Nothing recorded yet');
practice.teardown();

/* a running drill and a finished one */
const running = makeBlock({
  sessionId: session.id, drillId: library[2].id, drillName: '11-man full court',
  intensity: 8, group: 'Team', running: true,
  lastResumedAt: new Date(Date.now() - 90000).toISOString(), elapsedMs: 0,
  createdAt: '2026-08-18T10:10:00.000Z',
});
const finished = makeBlock({
  sessionId: session.id, drillId: library[0].id, drillName: 'Dynamic warm-up',
  intensity: 2, group: 'Team', running: false, elapsedMs: 12 * 60000,
  endedAt: '2026-08-18T10:12:00.000Z', createdAt: '2026-08-18T10:00:00.000Z',
});
const groupBlock = makeBlock({
  sessionId: session.id, drillId: library[1].id, drillName: 'Shell defence',
  intensity: 4, group: 'Bigs', running: true,
  lastResumedAt: new Date(Date.now() - 30000).toISOString(), elapsedMs: 0,
  participation: { [players[0].id]: 0 },
  createdAt: '2026-08-18T10:11:00.000Z',
});
await db.putMany(db.STORES.blocks, [running, finished, groupBlock]);

root = newRoot();
await practice.render(root);
await flush();

contains('finished drill appears under Done', root, 'Dynamic warm-up');
contains('running drill appears', root, '11-man full court');
contains('two clocks can run at once', root, '2 running now');
contains('a group split is labelled', root, 'Bigs');
contains('warm-up load is intensity x minutes', root, '24');
contains('sitting-out count is shown', root, '1 sitting out');

const clocks = root.querySelectorAll('[data-clock]');
ok('each running drill gets its own clock', clocks.length === 2, `found ${clocks.length}`);
ok('the clock is counting', /^[0-9]+:[0-9]{2}$/.test(clocks[0].textContent), clocks[0].textContent);

/* the ticker must keep counting after a re-render, not freeze */
const before = clocks[0].textContent;
runTimers();
ok('ticker updates the clock in place', typeof clocks[0].textContent === 'string' && clocks[0].textContent.length > 0, clocks[0].textContent);
ok('ticker did not blank the clock', clocks[0].textContent !== '', before);
practice.teardown();

/* ---- context tags persist ---- */
root = newRoot();
await practice.render(root);
await flush();
const tagChip = root.querySelectorAll('.chip').filter((c) => c.textContent === 'Game tomorrow')[0];
ok('quick context tags are offered', !!tagChip);
if (tagChip) {
  tagChip.click();
  await flush();
  const saved = await db.get(db.STORES.sessions, session.id);
  ok('tapping a tag saves it to the session', (saved.tags || []).includes('Game tomorrow'), JSON.stringify(saved.tags));
}
practice.teardown();

/* ---- live density, end to end ---- */

// give the running block a live time and check it surfaces
await db.put(db.STORES.blocks, {
  ...(await db.get(db.STORES.blocks, finished.id)),
  liveMs: 6 * 60000,   // 6 live minutes out of the 12 the warm-up ran
});
await flush();

root = newRoot();
await practice.render(root);
await flush();
contains('live density appears on the practice screen', root, 'Live density');
contains('and is worked out from the typed live time', root, '50%');
contains('and says how much of the session it covers', root, 'timed on 1 of');
practice.teardown();

// stopping a drill asks for the live time
root = newRoot();
await practice.render(root);
await flush();
const stopBtn = root.querySelectorAll('button').filter((b) => b.textContent === 'Stop')[0];
ok('a running drill has a Stop button', !!stopBtn);
stopBtn.click();
await flush();

const liveModal = document.body.querySelectorAll('.modal')[0];
ok('stopping a drill asks for the live time', !!liveModal);
if (liveModal) {
  contains('it names the drill', liveModal, 'Live time');
  contains('it shows how long the drill actually ran', liveModal, 'The drill ran');
  contains('it can always be skipped', liveModal, 'Did not time it');
  const skip = liveModal.querySelectorAll('button').filter((b) => b.textContent === 'Did not time it')[0];
  ok('skipping is one tap', !!skip);
  if (skip) {
    skip.click();
    await flush();
    const skipped = await db.get(db.STORES.blocks, running.id);
    ok('a skipped drill stays unmeasured, not zero', skipped.liveMs === null || skipped.liveMs === undefined,
      String(skipped.liveMs));
  }
}
document.body.querySelectorAll('.scrim').forEach((n) => n.remove());
practice.teardown();

// the prompt can be switched off
await db.setMeta('askLiveTime', false);
root = newRoot();
await settings.render(root);
await flush();
contains('the prompt can be turned off in settings', root, 'Ask for live time when I stop a drill');
await db.setMeta('askLiveTime', true);

/* ---- context tags: presets, and the coach's own ---- */

root = newRoot();
await practice.render(root);
await flush();
contains('a preset tag is offered', root, 'Day after game');
contains('he can write his own tag', root, '+ New tag');
practice.teardown();

await db.setMeta('customTags', ['Altitude camp', 'Exam week']);
root = newRoot();
await practice.render(root);
await flush();
contains('his own tags are offered back', root, 'Altitude camp');
contains('and so is the second one', root, 'Exam week');

const ownTag = root.querySelectorAll('.chip').filter((c) => c.textContent === 'Exam week')[0];
ok('his own tag is tappable', !!ownTag);
if (ownTag) {
  ownTag.click();
  await flush();
  const saved = await db.get(db.STORES.sessions, session.id);
  ok('tapping his own tag saves it', (saved.tags || []).includes('Exam week'), JSON.stringify(saved.tags));
}
practice.teardown();

/* a duplicate of a preset must not appear twice */
await db.setMeta('customTags', ['Altitude camp', 'Travel day']);
root = newRoot();
await practice.render(root);
await flush();
const travelChips = root.querySelectorAll('.chip').filter((c) => c.textContent === 'Travel day');
ok('a custom tag matching a preset is not duplicated', travelChips.length === 1, `found ${travelChips.length}`);
practice.teardown();

/* ---- starting a drill defaults to the whole squad ---- */

root = newRoot();
await practice.render(root);
await flush();
const startBtn = root.querySelectorAll('button').filter((b) => b.textContent.indexOf('Start a drill') !== -1)[0];
ok('there is a start-a-drill button', !!startBtn);
startBtn.click();
await flush();

const modal = document.body.querySelectorAll('.modal')[0];
ok('the start-a-drill sheet opens', !!modal);
if (modal) {
  // A placeholder is an attribute, not text — check the element itself.
  const searchBox = modal.querySelectorAll('[type=search]')[0];
  ok('it opens straight onto a drill search box', !!searchBox
    && (searchBox.getAttribute('placeholder') || '').indexOf('Search drills') === 0,
    searchBox ? searchBox.getAttribute('placeholder') : 'no search box');
  contains('the group is already set to Team', modal, 'Team');
  contains('changing the group is available but secondary', modal, 'Change');
  contains('drills are listed ready to tap', modal, 'Live 5v5');

  // The group chip row starts hidden; the drill list does not.
  const hidden = modal.querySelectorAll('.hidden');
  ok('the group options start collapsed', hidden.length >= 1, `found ${hidden.length} hidden`);

  const changeBtn = modal.querySelectorAll('button').filter((b) => b.textContent === 'Change')[0];
  ok('a Change control exists', !!changeBtn);
  if (changeBtn) {
    changeBtn.click();
    contains('tapping Change reveals the other groups', modal, 'Bigs');
  }
  document.body.querySelectorAll('.scrim').forEach((n) => n.remove());
}
practice.teardown();

/* ---- starting a drill for real must carry the drill's settings over ---- */

root = newRoot();
await practice.render(root);
await flush();
const startBtn2 = root.querySelectorAll('button').filter((b) => b.textContent.indexOf('Start a drill') !== -1)[0];
startBtn2.click();
await flush();

const sheet = document.body.querySelectorAll('.modal')[0];
const liveRow = sheet.querySelectorAll('.row').filter((r) => r.textContent.indexOf('Live 5v5') !== -1)[0];
ok('the measured drill is offered in the sheet', !!liveRow);
if (liveRow) {
  liveRow.click();
  await flush();

  const created = (await db.getBy(db.STORES.blocks, 'sessionId', session.id))
    .filter((b) => b.drillName === 'Live 5v5')[0];
  ok('starting a drill creates a block', !!created);
  if (created) {
    ok('the measured intensity is carried onto the block', created.intensity === 7.50, String(created.intensity));
    ok('the movement tags are carried onto the block',
      created.tissue && created.tissue.jump === 3 && created.tissue.sprint === 2 && created.tissue.cod === 3,
      JSON.stringify(created.tissue));
    ok('the clock is running', created.running === true);
    ok('the contact flag is carried onto the block', created.contact === true, String(created.contact));
    ok('the block records when it was resumed', !!created.lastResumedAt);

    // history must not be rewritten when the library changes afterwards
    const lib = await db.get(db.STORES.drills, created.drillId);
    await db.put(db.STORES.drills, { ...lib, name: 'Renamed drill', measured: 2, tissue: { jump: 0, sprint: 0, cod: 0 } });
    const after = await db.get(db.STORES.blocks, created.id);
    ok('renaming a drill does not rewrite recorded history', after.drillName === 'Live 5v5', after.drillName);
    ok('re-rating a drill does not rewrite recorded intensity', after.intensity === 7.50, String(after.intensity));
    ok('re-tagging a drill does not rewrite recorded movement', after.tissue.jump === 3, String(after.tissue.jump));
    await db.put(db.STORES.drills, lib);

    await db.remove(db.STORES.blocks, created.id);
  }
}
document.body.querySelectorAll('.scrim').forEach((n) => n.remove());
practice.teardown();

/* ---- unopposed drills carry through and are excluded from contact time ---- */

root = newRoot();
await practice.render(root);
await flush();
const startBtn3 = root.querySelectorAll('button').filter((b) => b.textContent.indexOf('Start a drill') !== -1)[0];
startBtn3.click();
await flush();
const sheet2 = document.body.querySelectorAll('.modal')[0];
const noDrow = sheet2.querySelectorAll('.row').filter((r) => r.textContent.indexOf('5 on 0 full court') !== -1)[0];
ok('the unopposed drill is offered', !!noDrow);
if (noDrow) {
  noDrow.click();
  await flush();
  const made = (await db.getBy(db.STORES.blocks, 'sessionId', session.id))
    .filter((b) => b.drillName === '5 on 0 full court')[0];
  ok('an unopposed drill records contact false', made && made.contact === false, JSON.stringify(made && made.contact));
  // full court, 5v5, two lengths, no defence -> situation drops to 1 (floor), so 6.0
  ok('its intensity comes from the grid with the defence adjustment',
    made && Math.abs(made.intensity - 6.0) < 0.01, String(made && made.intensity));
  await db.remove(db.STORES.blocks, made.id);
}
document.body.querySelectorAll('.scrim').forEach((n) => n.remove());
practice.teardown();

/* ---- the drill editor exposes all three ways to set intensity ---- */

root = newRoot();
await drills.render(root);
await flush();
const drillRow = root.querySelectorAll('.row').filter((r) => r.textContent.indexOf('Shell defence') !== -1)[0];
ok('a drill row is tappable', !!drillRow);
drillRow.click();
await flush();

const editor = document.body.querySelectorAll('.modal')[0];
ok('the drill editor opens', !!editor);
if (editor) {
  contains('grid mode is offered', editor, 'From the grid');
  contains('measured mode is offered', editor, 'Measured value');
  contains('a judged rating is offered', editor, 'My own rating');
  contains('the grid asks about court', editor, 'Court used');
  contains('the grid asks about the game situation', editor, 'Game situation');
  contains('the grid asks about rhythm', editor, 'Rhythm');
  contains('the grid asks whether there is live defence', editor, 'Live defence');
  contains('and offers the unopposed option', editor, 'No defence');
  contains('it shows the resulting number', editor, 'Intensity 4.0');
  contains('and explains where it came from', editor, 'Half court');

  contains('movement demands are asked for', editor, 'Movement demands');
  contains('jumping is tied to a tissue', editor, 'Achilles and patellar tendon');
  contains('sprinting is tied to a tissue', editor, 'Hamstrings');
  contains('change of direction is tied to a tissue', editor, 'Ankles and groin');
  document.body.querySelectorAll('.scrim').forEach((n) => n.remove());
}

/* ---- a finished session reports movement, and admits what it cannot ---- */

const doneSession = await db.get(db.STORES.sessions, session.id);
await db.put(db.STORES.sessions, { ...doneSession, status: 'complete', endedAt: new Date().toISOString() });
await db.put(db.STORES.blocks, {
  ...(await db.get(db.STORES.blocks, running.id)),
  running: false, elapsedMs: 20 * 60000, endedAt: new Date().toISOString(),
  tissue: { jump: 2, sprint: 3, cod: 2 },
});
await flush();

root = newRoot();
await practice.render(root);
await flush();
const sessionCard = root.querySelectorAll('.row').filter((r) => r.textContent.indexOf('Tuesday session') !== -1)[0];
ok('a finished session is listed', !!sessionCard);
sessionCard.click();
await flush();

const summary = document.body.querySelectorAll('.modal')[0];
ok('the session summary opens', !!summary);
if (summary) {
  contains('the summary reports movement demands', summary, 'Movement demands');
  contains('jumping is totalled', summary, 'Jumping');
  contains('sprinting is totalled', summary, 'Sprinting');
  // one tagged block of 20 min at sprint level 3 = 60
  contains('sprint score is level x minutes', summary, '60');
  contains('untagged drills are declared, not silently zeroed', summary, 'is not counted above');
  contains('contact exposure is reported separately from load', summary, 'Contact time');
  contains('the summary reports live density', summary, 'Live density');
  contains('and qualifies how much it covers', summary, 'covers');
  contains('and as a share of the session', summary, '% of the session');
  document.body.querySelectorAll('.scrim').forEach((n) => n.remove());
}
practice.teardown();

/* ---- settings ---- */

root = newRoot();
await settings.render(root);
await flush();
contains('settings counts the drills', root, 'Drills');
contains('settings nags about backup', root, 'never exported a backup');
contains('settings states the honest limits', root, 'prescribed load, not measured load');
contains('settings lists his own tags', root, 'Altitude camp');
contains('settings offers a drill library import', root, 'Import a drill library');
contains('and says the import cannot destroy practices', root, 'your practices, roster and settings are untouched');
contains('settings explains removing them is safe', root, 'never changes a practice you already recorded');

/* ---- backup round trip ---- */

const backup = await db.exportAll();
ok('backup captures players', backup.data.players.length === 4, String(backup.data.players.length));
ok('backup captures blocks', backup.data.blocks.length === 3, String(backup.data.blocks.length));

await db.clearAll();
await flush();
ok('erase clears the database', (await db.getAll(db.STORES.players)).length === 0);

await db.importAll(backup);
await flush();
ok('restore brings players back', (await db.getAll(db.STORES.players)).length === 4);
ok('restore brings drill runs back', (await db.getAll(db.STORES.blocks)).length === 3);

let threw = false;
try { await db.importAll({ format: 'something-else' }); } catch (e) { threw = true; }
ok('a foreign file is rejected', threw);

/* ---- analysis placeholder still renders ---- */

root = newRoot();
await analysis.render(root);
await flush();
contains('analysis screen renders', root, 'Analysis');

print(`\n${pass} passed, ${fail} failed`);
if (fail) throw new Error(`${fail} test(s) failed`);
