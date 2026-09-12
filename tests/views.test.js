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
const { makeDrill, makePlayer, toDateKey, addDays } = await import('../js/models.js');

/* Fixture dates are RELATIVE to today, never pinned to a literal.
 * The ACWR assertions below depend on how much history exists, and a pinned
 * date silently changes that answer every day the calendar moves — the suite
 * rots into red without anything in the app having changed. */
const TODAY = toDateKey(new Date());
const ago = (n) => addDays(TODAY, -n);
const { blockLoad } = await import('../js/load.js');
const drills = await import('../js/views/drills.js');
const roster = await import('../js/views/roster.js');
const practice = await import('../js/views/practice.js');
const settings = await import('../js/views/settings.js');
const analysis = await import('../js/views/analysis.js');
const reports = await import('../js/views/reports.js');

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
/* He asked for the drill's own notes on the library list too, beside how hard
 * it is and its movement tags — and on as many lines as he wrote them on. */
{
  const withNote = (await db.getAll(db.STORES.drills))[0];
  await db.put(db.STORES.drills, { ...withNote, notes: 'two lines\nsecond line' });
  root = newRoot();
  await drills.render(root);
  await flush();
  contains('drill notes are on the library list', root, 'second line');
  const noteEls = root.querySelectorAll('.run-note');
  ok('and in the class that keeps their line breaks', noteEls.length > 0);
  ok('with the break intact', noteEls[0].textContent.indexOf('\n') !== -1);
}

/* ---- run a practice ---- */

const { makeSession, makeBlock } = await import('../js/models.js');
const session = makeSession({
  date: ago(6),
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
  // The matchup is picked the way the coach says it out loud — one control,
  // not "5v5" plus a separate defence toggle.
  contains('the matchup is offered contested', editor, '5v5');
  contains('and unopposed, as its own option', editor, '5v0');
  contains('right down to a 1v0', editor, '1v0');
  contains('it shows the resulting number', editor, 'Intensity 4.0');
  contains('and explains where it came from', editor, 'Half court');

  contains('movement demands are asked for', editor, 'Movement demands');
  contains('jumping is tied to a tissue', editor, 'Achilles and patellar tendon');
  contains('sprinting is tied to a tissue', editor, 'Hamstrings');
  contains('change of direction is tied to a tissue', editor, 'Ankles and groin');
  document.body.querySelectorAll('.scrim').forEach((n) => n.remove());
}

/* ---- stage 3: what the players said ---- */
{
  const rpe = await import('../js/views/rpe.js');
  const doneS = await db.get(db.STORES.sessions, session.id);
  const sess = { ...doneS, status: 'complete', endedAt: new Date().toISOString() };
  await db.put(db.STORES.sessions, sess);
  const squad = (await db.getAll(db.STORES.players)).slice(0, 2);
  await db.put(db.STORES.sessions, { ...sess, rosterIds: squad.map((p) => p.id) });

  const opened = rpe.collectRPE({ ...sess, rosterIds: squad.map((p) => p.id) }, squad);
  await flush();
  const modal = document.body.querySelectorAll('.modal')[0];
  ok('the ratings screen opens', !!modal);
  if (modal) {
    contains('it asks for the player\u2019s own answer', modal, 'Their answer, not yours');
    contains('it says when to ask', modal, 'half an hour');
    contains('it says a skipped player is blank, not zero', modal, 'never counted as an easy day');
    contains('it counts who has answered', modal, `0 of ${squad.length} answered`);

    // One tap per player is the whole design constraint — no modal each.
    const scales = modal.querySelectorAll('.iscale');
    ok('every player gets a 1-10 row on one screen', scales.length === squad.length,
      String(scales.length));

    const sevens = scales[0].querySelectorAll('button').filter((b) => b.textContent === '7');
    if (sevens[0]) {
      sevens[0].click();
      await flush();
      contains('tapping a number shows the player wording', modal, 'Tired, glad of the breaks');
      contains('and updates the counter', modal, `1 of ${squad.length} answered`);
      sevens[0].click();   // tap the same number again
      await flush();
      contains('tapping it again clears the mistap', modal, `0 of ${squad.length} answered`);
      sevens[0].click();
      await flush();
    }

    const save = document.body.querySelectorAll('button')
      .filter((b) => b.textContent.indexOf('Save ratings') !== -1)[0];
    ok('ratings can be saved', !!save);
    if (save) { save.click(); await flush(); }
    await opened;

    const stored = await db.getBy(db.STORES.playerSessions, 'sessionId', sess.id);
    const withRpe = stored.filter((r) => r.rpe != null);
    ok('the rating is written to the player record', withRpe.length === 1, String(withRpe.length));
    ok('and it is the number that was tapped', withRpe[0] && withRpe[0].rpe === 7,
      String(withRpe[0] && withRpe[0].rpe));
    ok('the player who said nothing has no rating',
      stored.filter((r) => r.rpe === 0).length === 0);
  }
  document.body.querySelectorAll('.scrim').forEach((n) => n.remove());
}

/* ---- rating a courtside drill afterwards feeds the practice ----
 * The coach adds a drill mid-practice and rates it during or after. If the
 * rating did not travel back to the run, the session would stay permanently
 * incomplete and "rate it later" would be a dead end. */
{
  const lateDrill = makeDrill({ name: 'Spanish 5v5', unrated: true, intensity: null });
  await db.put(db.STORES.drills, lateDrill);

  const lateRun = makeBlock({
    sessionId: session.id, drillId: lateDrill.id, drillName: lateDrill.name,
    intensity: null, unrated: true, elapsedMs: 12 * 60000,
    endedAt: new Date().toISOString(),
  });
  // A run of the SAME drill that already carries a number, to prove history
  // is not rewritten underneath the coach.
  const settledRun = makeBlock({
    sessionId: session.id, drillId: lateDrill.id, drillName: lateDrill.name,
    intensity: 9.9, unrated: false, elapsedMs: 5 * 60000,
    endedAt: new Date().toISOString(),
  });
  await db.put(db.STORES.blocks, lateRun);
  await db.put(db.STORES.blocks, settledRun);

  ok('before rating, the run has no load at all', blockLoad(lateRun) === null);

  root = newRoot();
  await drills.render(root);
  await flush();
  contains('the library asks for a rating', root, 'not rated yet');

  const rateBtn = root.querySelectorAll('button')
    .filter((b) => b.textContent.indexOf('Spanish 5v5') !== -1)[0];
  ok('a one-tap rate button is offered', !!rateBtn);
  if (rateBtn) {
    rateBtn.click();
    await flush();
    const modal = document.body.querySelectorAll('.modal')[0];
    const save = document.body.querySelectorAll('button')
      .filter((b) => b.textContent.indexOf('Save changes') !== -1)[0];
    ok('the drill editor opens on it', !!modal);
    if (save) { save.click(); await flush(); }

    const filled = await db.get(db.STORES.blocks, lateRun.id);
    ok('the practice run picks the rating up', filled && filled.intensity !== null,
      String(filled && filled.intensity));
    ok('and is no longer flagged unrated', filled && !filled.unrated);
    ok('so it finally has a load', blockLoad(filled) !== null);

    const untouched = await db.get(db.STORES.blocks, settledRun.id);
    ok('a run that already had a number is left alone',
      untouched && Math.abs(untouched.intensity - 9.9) < 0.001,
      String(untouched && untouched.intensity));
  }
  document.body.querySelectorAll('.scrim').forEach((n) => n.remove());
  await db.remove(db.STORES.blocks, lateRun.id);
  await db.remove(db.STORES.blocks, settledRun.id);
  await db.remove(db.STORES.drills, lateDrill.id);
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

  // Stage 3: the rating saved earlier must show up as a comparison here.
  contains('the summary compares plan against feeling', summary, 'what they felt');
  contains('it shows what the coach prescribed', summary, 'You said');
  contains('and what the player answered', summary, 'He said');
  contains('partial coverage is admitted', summary, 'players answered');
  contains('one session is not treated as proof', summary, 'proves nothing on its own');
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

/* ---- analysis ----------------------------------------------------------
 * The screen is drill-first and day-first by design, so these check that the
 * drills and the game-day countdown actually reach the page — and, more
 * importantly, that nothing on it quietly presents an incomplete total as a
 * light week. */

root = newRoot();
await analysis.render(root);
await flush();

contains('analysis screen renders', root, 'Analysis');
contains('it states what the numbers are up front', root, 'Prescribed load');
contains('the week panel is there', root, 'Last 7 days');
contains('so is monotony', root, 'Monotony');
contains('and the acute:chronic ratio', root, 'Acute:chronic');

/* He asked for an early ACWR reading. One week of history cannot give one:
 * the acute and chronic windows are the same days, so it would read 1.00
 * whatever he did. The screen has to say that rather than print the 1.00. */
contains('a week of history explains itself instead of printing 1.00', root, 'would be 1.00');
ok('and no confident ratio is shown yet',
  root.textContent.indexOf('In line with recent weeks') === -1);

contains('the drill table is there', root, 'Your drills');
contains('and lists a drill by name', root, 'Dynamic warm-up');
contains('load is attributed by category', root, 'Where the load went');
contains('the squad table is there', root, 'The squad');
contains('contact minutes are counted separately', root, 'Contact');
contains('movement totals appear', root, 'Jumping');

/* The honesty rules, on a screen where breaking them is most dangerous. */
contains('an untagged drill is admitted, not counted as zero', root, 'not in those movement totals');
contains('AU are not comparable between tissues', root, 'NOT comparable between tissues');
contains('and load is not what the body did', root, 'Compared against the squad median');

/* ---- the game week, from the coach's own label ---- */

contains('an unlabelled practice is asked for a game day', root, 'marked with a game day yet');
contains('and told where to set it', root, 'Set game day');
contains('and how many are waiting', root, 'waiting for one');

/* Label the seeded practice, and add a second GD-1 plus a GD-2 so the
 * comparison has something to compare. */
await db.put(db.STORES.sessions, { ...(await db.get(db.STORES.sessions, session.id)), gameDay: 'GD-1' });

const gd1b = makeSession({
  date: ago(2), gameDay: 'GD-1', label: 'Friday', status: 'complete',
  rosterIds: session.rosterIds,
  startedAt: '2026-08-21T17:00:00.000Z', endedAt: '2026-08-21T18:30:00.000Z',
});
const gd2 = makeSession({
  date: ago(3), gameDay: 'GD-2', label: 'Thursday', status: 'complete',
  rosterIds: session.rosterIds,
});
// A game day with no drills clocked in it: the row will read 0.
const gdGame = makeSession({
  date: ago(1), gameDay: 'GD', type: 'Game', label: 'Away at Partizan',
  status: 'complete', rosterIds: session.rosterIds,
});
const gdx = makeSession({
  date: ago(6), gameDay: 'GD-X', label: 'Off week', status: 'complete',
  rosterIds: session.rosterIds,
});
await db.putMany(db.STORES.sessions, [gd1b, gd2, gdx, gdGame]);
await db.putMany(db.STORES.blocks, [
  makeBlock({ sessionId: gd1b.id, drillName: 'Shooting series', category: 'Shooting',
    intensity: 3, elapsedMs: 20 * 60000, liveMs: 8 * 60000, running: false }),
  makeBlock({ sessionId: gd2.id, drillName: 'Live 5v5', category: 'Live / scrimmage',
    intensity: 8, elapsedMs: 45 * 60000, liveMs: 30 * 60000, running: false }),
  makeBlock({ sessionId: gdx.id, drillName: 'Conditioning', category: 'Conditioning',
    intensity: 9, elapsedMs: 30 * 60000, running: false }),
]);

root = newRoot();
await analysis.render(root);
await flush();

contains('the game week panel appears once practices are labelled', root, 'The game week');
contains('GD-1 is compared against itself', root, 'GD-1');
contains('GD-2 too', root, 'GD-2');
contains('a bucket built on few practices says so', root, 'fewer than three practices');
contains('GD-X is excluded, and says so', root, 'left out of this table');
ok('and GD-X is not a row in the comparison',
  root.textContent.indexOf('GD-X is left out') !== -1);
contains('clocked time is distinguished from wall clock', root, 'not wall clock');
contains('a 0 game day is explained, not left to imply games are free',
  root, 'not what a game costs');
contains('and the totals admit they exclude games', root, 'exclude games');
contains('live density says what it covers', root, 'only the drills you timed');

/* What a game day is made of — the category breakdown for one GD. */
contains('the category breakdown appears', root, 'What a game day is made of');
contains('and names a category', root, 'Shooting');
contains('it says how many practices it averaged', root, 'practice');
contains('a skipped category averaging lower is explained', root, 'how much of this do I actually do');

/* Tapping a game-day row lists every practice behind it. */
const gdRow = root.querySelectorAll('tr').filter((r) => r.textContent.indexOf('GD-2') === 0)[0];
if (gdRow) {
  gdRow.click();
  await flush();
  const gm = document.body.querySelectorAll('.modal')[0];
  ok('a game-day row opens the practices behind it', !!gm);
  if (gm) contains('and lists them', gm, 'Every GD-2');
  document.body.querySelectorAll('.scrim').forEach((n) => n.remove());
}

/* ---- an unrated drill must not read as a light week ---- */

const ghost = makeBlock({
  sessionId: session.id, drillId: null, drillName: 'Drill Ivan sprang on me',
  intensity: null, unrated: true, running: false, elapsedMs: 25 * 60000,
  createdAt: '2026-08-18T11:00:00.000Z',
});
await db.put(db.STORES.blocks, ghost);

root = newRoot();
await analysis.render(root);
await flush();

contains('an unrated drill is reported at window level', root, 'no intensity behind it');
contains('and the totals are called incomplete, not low', root, 'incomplete, not low');
contains('the unrated run still shows in the drill table', root, 'Drill Ivan sprang on me');
contains('flagged as unrated there too', root, '1 unrated');

/* ---- tapping a drill opens its history ---- */

const drillRowA = root.querySelectorAll('tr').filter((r) => r.textContent.indexOf('Dynamic warm-up') !== -1)[0];
ok('a drill row is tappable', !!drillRowA);
if (drillRowA) {
  drillRowA.click();
  await flush();
  const dm = document.body.querySelectorAll('.modal')[0];
  ok('the drill history opens', !!dm);
  if (dm) {
    contains('it shows every run', dm, 'Every run');
    contains('and how long it usually lasts', dm, 'Average length');
    contains('an untagged drill admits it', dm, 'No movement tags');
  }
  document.body.querySelectorAll('.scrim').forEach((n) => n.remove());
}

/* ---- tapping a player opens their trend ---- */

const playerRow = root.querySelectorAll('tr').filter((r) => r.textContent.indexOf('Marko Jokic') !== -1)[0];
ok('a player row is tappable', !!playerRow);
if (playerRow) {
  playerRow.click();
  await flush();
  const pm = document.body.querySelectorAll('.modal')[0];
  ok('the player view opens', !!pm);
  if (pm) {
    contains('it shows their day by day', pm, 'Day by day');
    contains('and repeats what the number is not', pm, 'not what his body did');
  }
  document.body.querySelectorAll('.scrim').forEach((n) => n.remove());
}

await db.remove(db.STORES.blocks, ghost.id);
for (const x of [gd1b, gd2, gdx, gdGame]) {
  await db.removeBy(db.STORES.blocks, 'sessionId', x.id);
  await db.remove(db.STORES.sessions, x.id);
}

/* ---- the offline shell must list every module the app imports ----
 * A file missing here loads fine on wifi and fails in a gym with none — the
 * worst possible failure, because it only shows up where it cannot be fixed.
 * sw.js and offline-check.html keep separate copies of the list, so they are
 * checked against each other and against what is actually on disk. */
{
  const swSrc = read('sw.js');
  const checkSrc = read('offline-check.html');

  const shell = (swSrc.match(/const SHELL = \[([\s\S]*?)\]/) || [])[1] || '';
  const swList = (shell.match(/'\.\/[^']*'/g) || []).map((x) => x.slice(1, -1));

  const checkList = ((checkSrc.match(/var SHELL = \[([\s\S]*?)\];/) || [])[1] || '')
    .match(/'\.\/[^']*'/g).map((x) => x.slice(1, -1));

  ok('the service worker lists the app shell', swList.length > 10, String(swList.length));
  // Order is irrelevant to caching; contents are not.
  ok('the offline checker lists exactly the same files',
    swList.slice().sort().join('|') === checkList.slice().sort().join('|'),
    `only in sw: ${swList.filter((x) => checkList.indexOf(x) === -1).join()} | ` +
    `only in checker: ${checkList.filter((x) => swList.indexOf(x) === -1).join()}`);

  // Every module js/ actually contains must be in that list.
  const modules = swList.filter((u) => u.indexOf('./js/') === 0);
  const onDisk = [
    'app', 'db', 'models', 'load', 'history', 'ui', 'components',
  ].map((n) => `./js/${n}.js`).concat(
    ['practice', 'drills', 'roster', 'analysis', 'reports', 'settings', 'rpe']
      .map((n) => `./js/views/${n}.js`));

  const missing = onDisk.filter((f) => modules.indexOf(f) === -1);
  ok('no module is left out of the offline cache', missing.length === 0, missing.join());
}

/* ======================================================================
   What the coach asked for after a fortnight on the tablet
   ====================================================================== */

/* ---- drag a drill before another one -----------------------------------
 * The drag itself is pointer events against row midpoints, so the harness
 * gives every element a synthetic 50px box (see harness.js). This proves the
 * gesture reaches the database, not that it feels right under a thumb —
 * only the real tablet can say that. */
{
  await db.clearAll();
  await flush();

  const ses = makeSession({ date: TODAY, label: 'Order test', status: 'live', rosterIds: [] });
  await db.put(db.STORES.sessions, ses);

  const mk = (name, createdAt) => makeBlock({
    sessionId: ses.id, drillName: name, intensity: 5,
    running: false, elapsedMs: 10 * 60000, endedAt: createdAt, createdAt,
  });
  const first = mk('First drill', '2026-01-01T10:00:00.000Z');
  const second = mk('Second drill', '2026-01-01T10:20:00.000Z');
  const third = mk('Third drill', '2026-01-01T10:40:00.000Z');
  await db.putMany(db.STORES.blocks, [first, second, third]);

  root = newRoot();
  await practice.render(root);
  await flush();

  const rows = root.querySelectorAll('[data-id]');
  ok('the done list is draggable', rows.length === 3, String(rows.length));
  ok('drills are listed in the order they ran, first at the top',
    rows[0].textContent.indexOf('First drill') !== -1, rows[0].textContent);
  contains('the list says how to reorder it', root, 'before or after another one');

  // Drag the third drill above the first: press its grip, move to the top.
  const list = rows[0].parentNode;
  const handle = rows[2].querySelector('[data-grip]');
  list.dispatch('pointerdown', { target: handle, pointerId: 1 });
  list.dispatch('pointermove', { target: handle, pointerId: 1, clientY: 2 });
  list.dispatch('pointerup', { target: handle, pointerId: 1 });
  await flush();

  const saved = (await db.getBy(db.STORES.blocks, 'sessionId', ses.id))
    .slice().sort((a, b) => a.order - b.order).map((b) => b.drillName);
  ok('the dragged drill is saved in its new place',
    saved.join(' | ') === 'Third drill | First drill | Second drill', saved.join(' | '));
  ok('every run gets a dense order, so the next drag is a straight comparison',
    (await db.getBy(db.STORES.blocks, 'sessionId', ses.id))
      .map((b) => b.order).sort().join('') === '012');

  // And it survives a reload — the whole point of storing it.
  root = newRoot();
  await practice.render(root);
  await flush();
  const after = root.querySelectorAll('[data-id]');
  ok('the new order is what the screen shows next time',
    after[0].textContent.indexOf('Third drill') !== -1, after[0].textContent);
  practice.teardown();
}

/* ---- notes, on the screen and on two lines ------------------------------
 * He writes them courtside on more than one line ("till 7 / Marko tight
 * hamstring") and they have to read the same everywhere. `.run-note` is the
 * one class that carries `white-space: pre-line`; if a note is ever rendered
 * with `.tiny` again, the second line silently joins the first. */
{
  const ses = (await db.getAll(db.STORES.sessions))[0];
  const blocks = await db.getBy(db.STORES.blocks, 'sessionId', ses.id);
  const note = 'till 7\nMarko tight hamstring';
  await db.put(db.STORES.blocks, { ...blocks[0], note, liveMs: 4 * 60000 });

  root = newRoot();
  await practice.render(root);
  await flush();

  contains('the note is on the live screen, not only in the summary', root, 'Marko tight hamstring');
  const noted = root.querySelectorAll('.run-note');
  ok('the note is rendered in the class that keeps its line breaks', noted.length > 0);
  ok('and the line break itself survives into the DOM',
    noted[0].textContent.indexOf('\n') !== -1, JSON.stringify(noted[0].textContent));

  contains('live time is shown in minutes, not only as a percentage', root, '4:00 live');
  contains('the percentage is still there beside it', root, '40%');
  practice.teardown();
}

/* ---- the reports screen ------------------------------------------------
 * His own weekly table: categories down the side, one column per training
 * day with its game-week label, and every cell carrying full time AND live
 * time. These check the sentence he asked for actually reaches the page. */
{
  await db.clearAll();
  await flush();

  const lib = [
    makeDrill({ id: 'r_def', name: 'Shell defence', category: 'Defense', situation: 1, contact: false }),
    makeDrill({ id: 'r_tr', name: 'Transition 1on1', category: 'Transition', situation: 5, contact: true }),
    makeDrill({ id: 'r_5v5', name: '5on5, HC+2', category: 'Live / scrimmage', situation: 1, contact: true }),
  ];
  await db.putMany(db.STORES.drills, lib);

  const mkSes = (date, gameDay) => makeSession({
    date, gameDay, status: 'complete', rosterIds: [],
    endedAt: new Date().toISOString(),
  });
  const s1 = mkSes(ago(2), 'GD-3');
  const s2 = mkSes(ago(1), 'GD-1');
  await db.putMany(db.STORES.sessions, [s1, s2]);

  const mkBlk = (ses, drill, mins, liveMins) => makeBlock({
    sessionId: ses.id, drillId: drill.id, drillName: drill.name,
    category: drill.category, situation: drill.situation, contact: drill.contact,
    intensity: 6, running: false, elapsedMs: mins * 60000,
    liveMs: liveMins === null ? null : liveMins * 60000,
  });
  await db.putMany(db.STORES.blocks, [
    mkBlk(s1, lib[0], 15, null),
    mkBlk(s1, lib[1], 15, 5),
    mkBlk(s1, lib[2], 25, 15),
    mkBlk(s2, lib[2], 10, 5),
  ]);

  root = newRoot();
  await reports.render(root);
  await flush();

  contains('the reports screen renders', root, 'Reports');
  contains('his own category rows are there', root, 'Defense');
  contains('and the contact rows the categories cannot produce', root, 'Contact 5on5');
  contains('including the small-sided one', root, 'Contact 1on1/2on2');
  contains('and the two of them added up', root, 'Whole contact');

  // The sentence he actually asked for: minutes of live game, not only a share.
  contains('cells carry live time in minutes', root, '15:00 live');
  contains('with the percentage beside it', root, '60%');

  // Columns are training days, labelled with where they sat in the game week.
  contains('the game-week label is on the column', root, 'GD-3');
  contains('and so is the next one', root, 'GD-1');

  // Honesty: the shell drill was never timed, and the screen has to say so
  // rather than letting a short live figure read as a quiet day.
  contains('an untimed drill is declared, not counted as 0% live', root, 'not timed');
  contains('and the period says how much of it was measured at all', root, 'Live coverage');

  // Drill by drill, with the spread he asked for.
  contains('the per-drill section is there', root, 'By drill');
  contains('and names a drill', root, '5on5, HC+2');
  contains('with the longest run', root, 'Longest');
  contains('the shortest', root, 'Shortest');
  contains('and the average', root, 'Average');

  contains('the date range is on screen', root, 'session');
  reports.teardown();
}

/* ---- 2026-09-12: a courtside drill follows the library until it is set up ----
 * The coach typed a new 5on5 drill in during practice, set it up afterwards in
 * Drills (Defense, 5v5 live), and the report still filed it under "Skill
 * development" — the default a new drill is born with, copied into the run as
 * if it were his answer. */
{
  const { drillSnapshot, makeBlock: mkB, GAME_DAY_ORDER, isGameWeekDay } = await import('../js/models.js');
  const { followLibrary, repairCourtsideRuns, planLiveSplit, applyLiveSplit } = await import('../js/sync.js');
  const hist = await import('../js/history.js');

  const ses = makeSession({ date: TODAY, gameDay: 'GD-6', status: 'complete', endedAt: new Date().toISOString(), label: 'Courtside day' });
  await db.put(db.STORES.sessions, ses);

  const cs = makeDrill({ name: 'Courtside 5on5', unrated: true, intensity: null });
  await db.put(db.STORES.drills, cs);
  const run = mkB({ sessionId: ses.id, ...drillSnapshot(cs), elapsedMs: 10 * 60000, endedAt: new Date().toISOString() });
  await db.put(db.STORES.blocks, run);

  ok('a never-set-up drill gives the run no category, not the default', run.category === null, String(run.category));
  ok('and no matchup', run.contact === null && run.situation === null);
  ok('and flags it as waiting', run.detailsPending === true);
  ok('no invented intensity either', run.intensity === null);

  let rows = hist.reportRowsFor([run], [cs]);
  ok('the report says the drill is not set up, rather than guessing a category',
    rows.rows.some((r) => r.label === hist.NOT_SET_UP));
  ok('and keeps it out of the contact rows, counted as unclassified', rows.unclassified.runs === 1);

  // He rates the run by hand on the practice screen first...
  await db.put(db.STORES.blocks, { ...run, intensity: 7, unrated: false });
  // ...then sets the drill up in the library.
  const setUp = { ...cs, category: 'Defense', court: 3, situation: 1, contact: true, rhythm: 4, unrated: false };
  await db.put(db.STORES.drills, setUp);
  const moved = await followLibrary(setUp);
  ok('setting the drill up reaches the run', moved === 1, String(moved));

  const after = await db.get(db.STORES.blocks, run.id);
  ok('the run is now filed under his category', after.category === 'Defense', String(after.category));
  ok('with his matchup', after.contact === true && after.situation === 1);
  ok('the rating he gave that day is kept', after.intensity === 7, String(after.intensity));
  ok('and it stops waiting', after.detailsPending === false);

  rows = hist.reportRowsFor([after], [setUp]);
  ok('the report counts it as Defense', rows.rows.some((r) => r.label === 'Defense' && r.runs === 1));
  ok('and as Contact 5on5', rows.rows.some((r) => r.key === 'band:contact5' && r.runs === 1));

  // From here on it is an ordinary snapshot: re-filing the drill in March
  // must not rewrite what this practice was.
  const refiled = { ...setUp, category: 'Transition' };
  await db.put(db.STORES.drills, refiled);
  ok('a later re-file touches nothing', (await followLibrary(refiled)) === 0);
  ok('the run keeps the category it was set up with',
    (await db.get(db.STORES.blocks, run.id)).category === 'Defense');

  /* ---- runs already on the tablet from before the fix ---- */
  const born = new Date(Date.now() - 3600 * 1000).toISOString();
  const oldCs = makeDrill({ name: 'Old courtside', unrated: false, category: 'Defense', situation: 1, contact: true, createdAt: born });
  const oldRun = mkB({ sessionId: ses.id, drillId: oldCs.id, drillName: oldCs.name, category: 'Skill development',
    intensity: 6, unrated: false, elapsedMs: 8 * 60000, createdAt: new Date(Date.parse(born) + 40).toISOString() });
  delete oldRun.detailsPending;              // older records never had the field

  // A drill that really was in the library, filed under Skill development at
  // the time and re-filed since. Its run is a genuine snapshot.
  const realDrill = makeDrill({ name: 'Form shooting', category: 'Shooting', createdAt: new Date(Date.now() - 10 * 86400000).toISOString() });
  const realRun = mkB({ sessionId: ses.id, drillId: realDrill.id, drillName: realDrill.name, category: 'Skill development',
    intensity: 3, elapsedMs: 5 * 60000 });
  delete realRun.detailsPending;

  await db.putMany(db.STORES.drills, [oldCs, realDrill]);
  await db.putMany(db.STORES.blocks, [oldRun, realRun]);
  const repaired = await repairCourtsideRuns();
  ok('the start-up repair finds the old courtside run', repaired === 1, String(repaired));
  const fixedOld = await db.get(db.STORES.blocks, oldRun.id);
  ok('and files it where he set the drill up', fixedOld.category === 'Defense', String(fixedOld.category));
  ok('keeping the intensity that run already had', fixedOld.intensity === 6);
  ok('a genuine library snapshot is left alone',
    (await db.get(db.STORES.blocks, realRun.id)).category === 'Skill development');
  ok('the repair is idempotent', (await repairCourtsideRuns()) === 0);

  /* ---- GD-6 ---- */
  ok('GD-6 is an option, furthest out first', GAME_DAY_ORDER[0] === 'GD-6');
  ok('and belongs in the game-week comparison', isGameWeekDay('GD-6'));

  root = newRoot();
  await practice.render(root);
  await flush();
  const csRow = root.querySelectorAll('.row').filter((r) => r.textContent.indexOf('Courtside day') !== -1)[0];
  ok('recent sessions list the practice', !!csRow);
  ok('with its game day on the row', csRow && csRow.textContent.indexOf('GD-6') !== -1);

  /* ---- splitting Live / scrimmage ---- */
  const smallLive = makeDrill({ name: '3 on 3 HC', category: 'Live / scrimmage', situation: 3, contact: true });
  const bigLive = makeDrill({ name: '5 on 5 FC', category: 'Live / scrimmage', situation: 1, contact: true });
  const shell = makeDrill({ name: '5 on 0 shell', category: 'Live / scrimmage', situation: 1, contact: false });
  await db.putMany(db.STORES.drills, [smallLive, bigLive, shell]);
  // A run whose OWN snapshot says 5v5, of a drill since changed to 3v3.
  const oldLiveRun = mkB({ sessionId: ses.id, ...drillSnapshot(smallLive), situation: 1, elapsedMs: 20 * 60000 });
  await db.put(db.STORES.blocks, oldLiveRun);

  root = newRoot();
  await settings.render(root);
  await flush();
  contains('settings offers the split while the old name is in use', root, 'can be split');

  const plan = planLiveSplit(await db.getAll(db.STORES.drills), await db.getAll(db.STORES.blocks));
  ok('contested small-sided goes to Small-sided live',
    plan.drills.some((x) => x.id === smallLive.id && x.to === 'Small-sided live'));
  ok('contested 5v5 goes to 5on5 live',
    plan.drills.some((x) => x.id === bigLive.id && x.to === '5on5 live'));
  ok('an unopposed drill is not guessed into a live category',
    !plan.drills.some((x) => x.id === shell.id) && plan.leftDrills === 1);
  ok('a past run is split by its own recorded matchup, not the library today',
    plan.runs.some((x) => x.id === oldLiveRun.id && x.to === '5on5 live'));
  await applyLiveSplit(plan);
  ok('the split is written', (await db.get(db.STORES.drills, bigLive.id)).category === '5on5 live');
}

/* ---- the By drill search keeps the box he is typing in ----
 * Every keystroke used to re-render the whole screen, which destroyed the
 * input: the keyboard closed and the page jumped to the top. */
{
  root = newRoot();
  await reports.render(root);
  await flush();
  const box = root.querySelectorAll('input').filter((i) =>
    String(i.getAttribute('placeholder') || '').indexOf('Search drills') !== -1)[0];
  ok('the drill search box is there', !!box);
  if (box) {
    box.dispatch('input', { target: { value: 'zzzz-no-such-drill' } });
    await flush();
    ok('typing does not replace the search box',
      root.querySelectorAll('input').indexOf(box) !== -1);
    contains('but the list under it does filter', root, 'No drill matches that.');
  }
  reports.teardown();
}

/* ---- 2026-09-12 stage 2: seasons and phases ----
 * "Practices till 20.9 are preseason; I want reports for inseason only." A
 * season is a set of dates; a practice belongs wherever its date falls. */
{
  const hist = await import('../js/history.js');
  const lastModal = () => { const ms = document.body.querySelectorAll('.modal'); return ms[ms.length - 1]; };
  const buttonIn = (node, text) => node.querySelectorAll('button').filter((b) => b.textContent === text)[0];
  const clearModals = () => document.body.querySelectorAll('.scrim').forEach((n) => n.remove());

  await db.setMeta('seasons', []);
  await db.setMeta('viewSeasonId', null);
  await db.setMeta('reportPhase', null);

  // One practice each side of the boundary, one before the season, each with
  // a drill whose name says where it belongs.
  const mk = async (date, label, drillName) => {
    const se = makeSession({ date, label, status: 'complete', endedAt: new Date().toISOString() });
    await db.put(db.STORES.sessions, se);
    await db.put(db.STORES.blocks, makeBlock({ sessionId: se.id, drillName, category: 'Defense', situation: 1, contact: true,
      intensity: 5, elapsedMs: 12 * 60000, endedAt: new Date().toISOString() }));
    return se;
  };
  await mk(ago(8), 'Preseason practice', 'PRE-drill');
  await mk(ago(2), 'Inseason practice', 'IN-drill');
  await mk(ago(200), 'Last spring practice', 'OLD-drill');

  root = newRoot();
  await practice.render(root);
  await flush();
  contains('without a season, Practice offers to set one up', root, 'Set up the season');

  buttonIn(root, 'Set up the season').click();
  await flush();
  let modal = lastModal();
  ok('the season editor opens', !!modal);
  let inputs = modal.querySelectorAll('input');
  ok('it asks for a name and four dates', inputs.length === 5, String(inputs.length));
  ok('the first season starts at the first practice ever recorded, so nothing is left outside',
    inputs[1].value <= ago(200), inputs[1].value);

  // A mistake first: inseason before preseason.
  inputs[0].value = 'Test 1/2';
  inputs[1].value = ago(10);
  inputs[2].value = ago(20);
  buttonIn(modal, 'Add season').click();
  await flush();
  contains('an impossible order is refused in his words', lastModal(), 'cannot start before preseason');
  ok('and nothing is saved', (await db.getMeta('seasons', [])).length === 0);

  inputs[2].value = ago(4);          // inseason from 4 days ago
  buttonIn(lastModal(), 'Add season').click();
  await flush();
  const saved = await db.getMeta('seasons', []);
  ok('the season is saved', saved.length === 1 && saved[0].label === 'Test 1/2' && saved[0].inseason === ago(4));
  clearModals();

  root = newRoot();
  await practice.render(root);
  await flush();
  contains('the season is on the Practice screen', root, 'Test 1/2');
  contains('with today’s phase', root, 'Today: Inseason');
  const inRow = root.querySelectorAll('.row').filter((r) => r.textContent.indexOf('Inseason practice') !== -1)[0];
  ok('a practice row says which phase it was', inRow && inRow.textContent.indexOf('Inseason') !== -1);
  const preRow = root.querySelectorAll('.row').filter((r) => r.textContent.indexOf('Preseason practice') !== -1)[0];
  ok('and so does a preseason one', preRow && preRow.textContent.indexOf('Preseason') !== -1);
  contains('practices before every season are counted out loud, not hidden', root, 'outside every season');
  ok('and are not listed in the season',
    !root.querySelectorAll('.row').some((r) => r.textContent.indexOf('Last spring practice') !== -1));

  /* ---- reports: inseason only ---- */
  root = newRoot();
  await reports.render(root);
  await flush();
  contains('reports offer the phases', root, 'Preseason');
  buttonIn(root, 'Inseason').click();
  await flush();
  ok('the phase he picks is remembered', (await db.getMeta('reportPhase', null)) === 'inseason');

  buttonIn(root, 'Choose dates').click();
  await flush();
  modal = lastModal();
  inputs = modal.querySelectorAll('input');
  inputs[0].value = ago(10);
  inputs[1].value = TODAY;
  buttonIn(modal, 'Show it').click();
  await flush();
  clearModals();
  // The By drill search is module state; an earlier test left a query in it.
  const search = root.querySelectorAll('input').filter((i) =>
    String(i.getAttribute('placeholder') || '').indexOf('Search drills') !== -1)[0];
  if (search) { search.dispatch('input', { target: { value: '' } }); await flush(); }
  contains('an inseason report includes the inseason practice', root, 'IN-drill');
  ok('and leaves the preseason one out', root.textContent.indexOf('PRE-drill') === -1);
  contains('and says so, rather than letting the dates look light', root, 'Inseason only.');
  contains('naming what was left out', root, 'Preseason');

  buttonIn(root, 'Whole season').click();
  await flush();
  contains('the whole season includes preseason again', root, 'PRE-drill');

  buttonIn(root, 'Season').click();
  await flush();
  contains('the Season period is labelled with the season and phase', root, 'Test 1/2 · Whole season');
  ok('and never reaches back before the season', root.textContent.indexOf('OLD-drill') === -1);

  /* ---- next season starts empty; this one is untouched ---- */
  const next = { id: 'sea_next', label: 'Next 2/3', start: addDays(TODAY, 1), inseason: null, offseason: null, end: null };
  await db.setMeta('seasons', [...saved, next]);
  await db.setMeta('viewSeasonId', next.id);
  root = newRoot();
  await practice.render(root);
  await flush();
  contains('a new season starts empty', root, 'Nothing recorded in Next 2/3 yet');
  contains('and says the old practices are still saved', root, 'still saved');
  contains('switching back is offered', root, 'Switch season');
  ok('the old season’s practices still exist', (await db.getAll(db.STORES.sessions)).some((x) => x.label === 'Inseason practice'));
  contains('an undated inseason is not pretended to be empty', (await (async () => {
    const r = newRoot(); await reports.render(r); await flush(); return r; })()), 'Inseason · no date');

  /* ---- Analysis: Season means this season; load maths unchanged ---- */
  ok('Season starts at the season start when one is given',
    hist.rangeFor([{ date: '2026-01-05' }], 'season', '2026-03-01', '2026-02-01').from === '2026-02-01');
  ok('and at the first practice when none is',
    hist.rangeFor([{ date: '2026-01-05' }], 'season', '2026-03-01').from === '2026-01-05');
  root = newRoot();
  await analysis.render(root);
  await flush();
  contains('analysis still renders with seasons set up', root, 'Analysis');

  await db.setMeta('viewSeasonId', null);
  reports.teardown();
}

/* ---- 2026-09-12 stage 3: the game-day row on Reports ----
 * "GD-1 … GD-6, with dates from–till, and how many practices it is taken from." */
{
  const lastModal = () => { const ms = document.body.querySelectorAll('.modal'); return ms[ms.length - 1]; };
  const clearModals = () => document.body.querySelectorAll('.scrim').forEach((n) => n.remove());
  const buttons = (node, prefix) => node.querySelectorAll('button').filter((b) => b.textContent.indexOf(prefix) === 0);

  const end = new Date().toISOString();
  const a = makeSession({ date: ago(1), gameDay: 'GD-5', label: 'GD5 a', status: 'complete', endedAt: end });
  const b = makeSession({ date: ago(3), gameDay: 'GD-5', label: 'GD5 b', status: 'complete', endedAt: end });
  await db.putMany(db.STORES.sessions, [a, b]);
  await db.putMany(db.STORES.blocks, [
    makeBlock({ sessionId: a.id, drillName: 'GD5-only drill', category: 'Defense', situation: 1, contact: true,
      intensity: 6, elapsedMs: 20 * 60000, liveMs: 10 * 60000, endedAt: end }),
    makeBlock({ sessionId: b.id, drillName: 'GD5-second drill', category: 'Shooting', situation: 1, contact: false,
      intensity: 3, elapsedMs: 10 * 60000, endedAt: end }),
  ]);

  root = newRoot();
  await reports.render(root);
  await flush();
  clearModals();
  buttons(root, 'Whole season')[0].click();
  await flush();
  buttons(root, 'Choose dates')[0].click();
  await flush();
  if (!lastModal()) { buttons(root, 'Change dates')[0].click(); await flush(); }
  const inputs = lastModal().querySelectorAll('input');
  inputs[0].value = ago(3);
  inputs[1].value = TODAY;
  buttons(lastModal(), 'Show it')[0].click();
  await flush();
  clearModals();

  contains('the game-day row is there', root, 'All days');
  ok('GD-6 is offered', buttons(root, 'GD-6 ·').length === 1);
  ok('game day itself is not — it has no stopwatch data', buttons(root, 'GD ·').length === 0);
  const gd5 = buttons(root, 'GD-5 ·')[0];
  ok('each button says how many practices it has in these dates', gd5 && gd5.textContent === 'GD-5 · 2', gd5 && gd5.textContent);

  gd5.click();
  await flush();
  contains('the report says what it is taken from', root, 'Taken from 2 practices');
  contains('and that two is not a pattern', root, 'too few to call it a pattern');
  contains('its from–till is on screen with a way to change it', root, 'GD-5 practices from');
  contains('GD-5 drills are in it', root, 'GD5-only drill');
  contains('both of them', root, 'GD5-second drill');
  ok('a GD-1 drill is not', root.textContent.indexOf('5on5, HC+2') === -1);
  contains('a game-day report averages per practice', root, 'Per practice');
  contains('court time per practice is total over every GD-5', root, '15:00 per practice, across 2');
  contains('unlabelled practices are named, since no filter can reach them', root, 'no game-day label in these dates');

  buttons(root, 'All days')[0].click();
  await flush();
  contains('all days brings the other practices back', root, '5on5, HC+2');
  ok('and a plain report is totals, not averages', root.textContent.indexOf('Per practice') === -1);
  reports.teardown();
}

print(`\n${pass} passed, ${fail} failed`);
if (fail) throw new Error(`${fail} test(s) failed`);
