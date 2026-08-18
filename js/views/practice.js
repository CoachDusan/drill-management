/* views/practice.js — the courtside screen.
 *
 * Design rules, because this gets used standing up with a whistle in one hand:
 *  - Starting a drill is one tap from the main screen.
 *  - The running clock is the biggest thing on the page.
 *  - Nothing is ever lost to a reload. A running block stores when it was last
 *    resumed, so closing the app mid-drill and reopening it keeps counting.
 *  - Everyone is assumed to be in every drill; only exceptions get tapped.
 */

import * as db from '../db.js';
import {
  makeSession, makeBlock, toDateKey, formatDate, intensityInfo,
  resolveIntensity, TISSUE,
} from '../models.js';
import {
  blockMinutes, blockLoad, sessionTeamLoad, sessionTeamMinutes,
  sessionLoadByPlayer, blockTissue, tissueCoverage, contactShare,
  blockLiveDensity, blockLiveMinutes, sessionLiveDensity,
  fmtLoad, fmtClock, fmtMinutes, fmtDensity,
} from '../load.js';
import {
  h, mount, toast, openModal, confirmDanger, field,
  textInput, numberInput, selectInput, emptyState,
} from '../ui.js';
import { intensityPicker, intensityBadge } from '../components.js';

const SESSION_TYPES = ['Practice', 'Shootaround', 'Game', 'Lift', 'Recovery', 'Other'];

/* Context that tends to explain a spike after the fact. These are only a
 * starting set — the coach adds his own, and those are what actually get used
 * once he has been through a season. Stored in meta under 'customTags'. */
const QUICK_TAGS = [
  'Game tomorrow', 'Day after game', 'Back-to-back', 'Travel day',
  'Heavy lift day', 'Short roster', 'Long practice', 'Return-to-play',
];

async function allTags() {
  const custom = await db.getMeta('customTags', []);
  return [...QUICK_TAGS, ...custom.filter((t) => !QUICK_TAGS.includes(t))];
}

const GROUP_PRESETS = ['Team', 'Bigs', 'Guards', 'Wings', 'Group A', 'Group B', 'Starters', 'Bench'];

let rootEl = null;
let ticker = null;

/** Called by the router when leaving this tab — stop the clock updates. */
export function teardown() {
  if (ticker) { clearInterval(ticker); ticker = null; }
}

export async function render(root) {
  rootEl = root;
  teardown();

  const sessions = await db.getAll(db.STORES.sessions);
  const live = sessions.find((s) => s.status === 'live');

  if (live) await renderLive(root, live);
  else await renderIdle(root, sessions);
}

/* ======================================================================
   No practice running
   ====================================================================== */

async function renderIdle(root, sessions) {
  const [players, drills] = await Promise.all([
    db.getAll(db.STORES.players),
    db.getAll(db.STORES.drills),
  ]);

  const activePlayers = players.filter((p) => p.status === 'active');
  const activeDrills = drills.filter((d) => !d.archived);
  const ready = activePlayers.length > 0 && activeDrills.length > 0;

  const recent = sessions
    .filter((s) => s.status === 'complete')
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
    .slice(0, 12);

  const recentCards = [];
  for (const s of recent) {
    const blocks = await db.getBy(db.STORES.blocks, 'sessionId', s.id);
    recentCards.push(sessionRow(s, blocks));
  }

  mount(root,
    h('div', { class: 'page-head' }, [
      h('div', {}, [
        h('h1', { text: 'Practice' }),
        h('div', { class: 'sub', style: { margin: 0 }, text: 'Start a session, then run the clock on each drill' }),
      ]),
    ]),

    ready
      ? h('button', {
        class: 'btn btn-primary btn-lg btn-block',
        style: { marginBottom: '22px' },
        onclick: () => startPractice(),
      }, 'Start a practice')
      : h('div', { class: 'note warn' }, [
        h('strong', { text: 'Two things first. ' }),
        !activePlayers.length ? 'Add players to the Roster. ' : '',
        !activeDrills.length ? 'Add drills to the Drill library. ' : '',
        'Once both are in, starting a practice takes one tap.',
      ]),

    recent.length
      ? h('div', {}, [h('h2', { text: 'Recent sessions' }), h('div', { class: 'list' }, recentCards)])
      : (ready ? emptyState('⏱', 'No sessions recorded yet',
        'Tap “Start a practice” when the first drill begins. You can also log a session after the fact if you forgot to run the clock.') : null),
  );
}

function sessionRow(s, blocks) {
  const load = sessionTeamLoad(blocks);
  const mins = sessionTeamMinutes(blocks);
  return h('div', { class: 'row clickable', onclick: () => openSessionSummary(s) }, [
    h('div', { class: 'grow' }, [
      h('div', { class: 'name', text: `${formatDate(s.date)}${s.label ? ` · ${s.label}` : ''}` }),
      h('div', { class: 'tiny', text: `${s.type} · ${blocks.length} drill${blocks.length === 1 ? '' : 's'} · ${Math.round(mins)} min` }),
    ]),
    h('div', { style: { textAlign: 'right' } }, [
      h('div', { class: 'nums', style: { fontWeight: '700' }, text: fmtLoad(load) }),
      h('div', { class: 'tiny', text: 'AU' }),
    ]),
  ]);
}

/* ======================================================================
   Starting a practice
   ====================================================================== */

async function startPractice() {
  const players = await db.getAll(db.STORES.players);
  const eligible = players.filter((p) => p.status !== 'inactive');
  const preselected = new Set(players.filter((p) => p.status === 'active').map((p) => p.id));

  const result = await openModal('Start a practice', (body, done) => {
    const date = h('input', { type: 'date', value: toDateKey(new Date()) });
    const type = selectInput(SESSION_TYPES, 'Practice');
    const label = textInput('', { placeholder: 'Optional — e.g. pre-game shootaround' });

    const roster = h('div', { class: 'list' }, eligible.map((p) => {
      const on = preselected.has(p.id);
      const row = h('div', {
        class: 'row clickable',
        onclick: () => {
          const nowOn = !row.dataset.on || row.dataset.on === 'false';
          row.dataset.on = String(nowOn);
          if (nowOn) preselected.add(p.id); else preselected.delete(p.id);
          paint(row, nowOn);
        },
      }, [
        h('div', { class: 'grow' }, [
          h('div', { class: 'name', text: `${p.number ? `#${p.number} ` : ''}${p.name}` }),
          p.status === 'injured' ? h('div', { class: 'tiny', text: 'Marked injured' }) : null,
        ]),
        h('span', { class: 'chip', 'data-state': '' }),
      ]);
      row.dataset.on = String(on);
      paint(row, on);
      return row;
    }));

    function paint(row, on) {
      const chip = row.querySelector('.chip');
      chip.textContent = on ? 'Training' : 'Not training';
      chip.className = on ? 'chip on' : 'chip';
      row.style.opacity = on ? '1' : '.55';
    }

    body.append(
      h('div', { class: 'form-row' }, [field('Date', date), field('Type', type)]),
      field('Label', label),
      h('h3', { style: { marginTop: '18px' }, text: 'Who is training today?' }),
      h('p', { class: 'tiny', style: { marginTop: 0 } },
        'Tap anyone who is not. Injured players start switched off. You can still change this drill by drill once practice is running.'),
      roster,
    );

    return () => {
      if (!preselected.size) { toast('Nobody is marked as training'); return; }
      done({
        date: date.value || toDateKey(new Date()),
        type: type.value,
        label: label.value.trim(),
        rosterIds: [...preselected],
      });
    };
  }, { confirmLabel: 'Start practice' });

  if (!result) return;

  const session = makeSession({
    date: result.date,
    type: result.type,
    label: result.label,
    rosterIds: result.rosterIds,
    startedAt: new Date().toISOString(),
  });
  await db.put(db.STORES.sessions, session);
  toast('Practice started');
  await render(rootEl);
}

/* ======================================================================
   Practice in progress
   ====================================================================== */

async function renderLive(root, session) {
  const [players, drills, blocks] = await Promise.all([
    db.getAll(db.STORES.players),
    db.getAll(db.STORES.drills),
    db.getBy(db.STORES.blocks, 'sessionId', session.id),
  ]);

  const roster = players.filter((p) => (session.rosterIds || []).includes(p.id));
  const ordered = blocks.slice().sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  const running = ordered.filter((b) => b.running);
  const done = ordered.filter((b) => !b.running);

  // The ticker reads from this cache every second rather than hitting the
  // database; it has to be refilled on every render, including after a reload
  // that lands mid-practice with a clock still running.
  liveBlocks.clear();
  ordered.forEach((b) => liveBlocks.set(b.id, b));

  const teamLoad = sessionTeamLoad(ordered);
  const teamMins = sessionTeamMinutes(ordered);

  mount(root,
    h('div', { class: 'page-head' }, [
      h('div', {}, [
        h('h1', { text: session.label || session.type }),
        h('div', { class: 'sub', style: { margin: 0 },
          text: `${formatDate(session.date)} · ${roster.length} training · started ${clockTime(session.startedAt)}` }),
      ]),
      h('button', { class: 'btn', onclick: () => endPractice(session, ordered) }, 'End practice'),
    ]),

    h('div', { class: 'grid three', style: { marginBottom: '18px' } }, [
      h('div', { class: 'stat' }, [
        h('div', { class: 'k', text: 'Court time' }),
        h('div', { class: 'v', 'data-total-mins': '1', text: fmtMinutes(teamMins) }),
        h('div', { class: 'n', text: 'total across all drills' }),
      ]),
      h('div', { class: 'stat' }, [
        h('div', { class: 'k', text: 'Load so far' }),
        h('div', { class: 'v' }, [h('span', { 'data-total-load': '1', text: fmtLoad(teamLoad) }), h('span', { class: 'u', text: 'AU' })]),
        h('div', { class: 'n', text: 'for a player doing everything' }),
      ]),
      h('div', { class: 'stat' }, [
        h('div', { class: 'k', text: 'Drills' }),
        h('div', { class: 'v', text: String(ordered.length) }),
        h('div', { class: 'n', text: running.length ? `${running.length} running now` : 'none running' }),
      ]),
      liveStat(ordered),
    ]),

    h('button', {
      class: 'btn btn-primary btn-lg btn-block',
      style: { marginBottom: '20px' },
      onclick: () => addBlock(session, drills, roster),
    }, '+ Start a drill'),

    running.length ? h('div', {}, [
      h('h2', { style: { marginTop: '4px' }, text: 'Running now' }),
      h('div', { class: 'list' }, running.map((b) => runningCard(b, session, roster))),
    ]) : null,

    done.length ? h('div', {}, [
      h('h2', { text: 'Done' }),
      h('div', { class: 'list' }, done.slice().reverse().map((b) => doneRow(b, session, roster))),
    ]) : null,

    !ordered.length ? emptyState('🏀', 'Nothing recorded yet',
      'Tap “Start a drill” when the first one begins. If practice splits into groups, start a second drill and both clocks run at once.') : null,

    await contextCard(session),
  );

  startTicker();
}

/** Live density, with the coverage that qualifies it. */
function liveStat(blocks) {
  const live = sessionLiveDensity(blocks);
  return h('div', { class: 'stat' }, [
    h('div', { class: 'k', text: 'Live density' }),
    h('div', { class: 'v', text: fmtDensity(live.density) }),
    h('div', { class: 'n', text: live.timedCount
      ? `timed on ${live.timedCount} of ${blocks.length} drill${blocks.length === 1 ? '' : 's'}`
      : 'not timed yet' }),
  ]);
}

function clockTime(iso) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/* ---- the big running card ---- */

function runningCard(block, session, roster) {
  const outCount = roster.filter((p) => (block.participation || {})[p.id] === 0).length;
  const limitedCount = roster.filter((p) => (block.participation || {})[p.id] === 0.5).length;

  return h('div', { class: 'card', style: { marginBottom: 0 } }, [
    h('div', { class: 'card-head' }, [
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 } }, [
        intensityBadge(block.intensity),
        h('div', { style: { minWidth: 0 } }, [
          h('div', { class: 'name', style: { fontWeight: '650' }, text: block.drillName }),
          h('div', { class: 'tiny', text: intensityInfo(block.intensity).label }),
        ]),
      ]),
      block.group && block.group !== 'Team' ? h('span', { class: 'chip on', text: block.group }) : null,
    ]),

    h('div', {
      class: 'mono',
      'data-clock': block.id,
      style: { fontSize: '54px', fontWeight: '700', letterSpacing: '-.02em', lineHeight: '1.1', margin: '6px 0 12px' },
      text: fmtClock(block.elapsedMs + (block.running && block.lastResumedAt ? Date.now() - new Date(block.lastResumedAt).getTime() : 0)),
    }),

    h('div', { class: 'btn-row' }, [
      h('button', { class: 'btn btn-primary', style: { flex: '2' }, onclick: () => stopBlock(block) }, 'Stop'),
      h('button', { class: 'btn', style: { flex: '1' }, onclick: () => pauseBlock(block) }, 'Pause'),
      h('button', { class: 'btn', onclick: () => editParticipation(block, session, roster) },
        outCount || limitedCount ? `${roster.length - outCount} in` : 'Who’s in'),
    ]),

    (outCount || limitedCount) ? h('div', { class: 'tiny', style: { marginTop: '9px' },
      text: [outCount ? `${outCount} sitting out` : '', limitedCount ? `${limitedCount} limited` : ''].filter(Boolean).join(' · ') }) : null,
  ]);
}

/* ---- a finished drill ---- */

function doneRow(block, session, roster) {
  const mins = blockMinutes(block);
  const density = blockLiveDensity(block);
  const paused = block.elapsedMs > 0 && !block.endedAt;
  return h('div', { class: 'row clickable', onclick: () => editBlock(block, session, roster) }, [
    intensityBadge(block.intensity),
    h('div', { class: 'grow' }, [
      h('div', { class: 'name' }, [
        block.drillName,
        block.group && block.group !== 'Team' ? h('span', { class: 'chip', style: { marginLeft: '8px' }, text: block.group }) : null,
        paused ? h('span', { class: 'chip', style: { marginLeft: '8px' }, text: 'paused' }) : null,
      ]),
      h('div', { class: 'tiny', text: [
        fmtMinutes(mins),
        `${fmtLoad(blockLoad(block))} AU`,
        density === null ? null : `${fmtDensity(density)} live`,
      ].filter(Boolean).join(' · ') }),
    ]),
    paused
      ? h('button', { class: 'btn btn-sm', onclick: (e) => { e.stopPropagation(); resumeBlock(block); } }, 'Resume')
      : h('span', { class: 'tiny', text: '›', style: { fontSize: '22px' } }),
  ]);
}

/* ---- session context ---- */

async function contextCard(session, { onChange = null } = {}) {
  const tags = new Set(session.tags || []);
  const available = await allTags();

  const chips = h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '7px', marginBottom: '12px' } });

  async function save() {
    const current = await db.get(db.STORES.sessions, session.id);
    if (!current) return;
    await db.put(db.STORES.sessions, { ...current, tags: [...tags] });
    if (onChange) onChange([...tags]);
  }

  function paintChips(list) {
    chips.innerHTML = '';
    list.forEach((t) => {
      const chip = h('button', {
        class: tags.has(t) ? 'chip on' : 'chip',
        style: { minHeight: '38px', cursor: 'pointer', border: '1px solid var(--line)' },
        onclick: async () => {
          if (tags.has(t)) tags.delete(t); else tags.add(t);
          chip.className = tags.has(t) ? 'chip on' : 'chip';
          await save();
        },
      }, t);
      chips.appendChild(chip);
    });

    chips.appendChild(h('button', {
      class: 'chip',
      style: { minHeight: '38px', cursor: 'pointer', border: '1px dashed var(--line)', color: 'var(--accent)' },
      onclick: async () => {
        const name = await newTagPrompt();
        if (!name) return;
        const custom = await db.getMeta('customTags', []);
        if (!custom.includes(name) && !QUICK_TAGS.includes(name)) {
          await db.setMeta('customTags', [...custom, name]);
        }
        tags.add(name);
        await save();
        paintChips(await allTags());
        toast(`“${name}” added`);
      },
    }, '+ New tag'));
  }

  paintChips(available);

  const notes = h('textarea', {
    placeholder: 'Anything that might explain these numbers later — mood, weather, who looked flat, what you changed…',
    onchange: async (e) => {
      const current = await db.get(db.STORES.sessions, session.id);
      if (!current) return;
      await db.put(db.STORES.sessions, { ...current, notes: e.target.value });
      toast('Note saved');
    },
  }, session.notes || '');

  return h('div', { class: 'card' }, [
    h('h3', { text: 'Context' }),
    h('p', { class: 'tiny', style: { marginTop: 0 } },
      'A spike in the numbers is much more useful three months from now if it has a reason attached. Tap a tag to switch it on, or write your own — your own tags are kept and offered every session after that.'),
    chips,
    notes,
  ]);
}

/** Small single-field prompt for a new tag name. */
function newTagPrompt() {
  return openModal('New tag', (body, done) => {
    const input = textInput('', { placeholder: 'e.g. Altitude, Exam week, New floor' });
    body.append(
      h('p', { class: 'small muted' },
        'Short is better — this becomes a button you tap in a hurry. It is saved and offered in every future session.'),
      input,
    );
    return () => {
      const v = input.value.trim();
      if (!v) { toast('Give the tag a name'); return; }
      if (v.length > 28) { toast('Keep it under 28 characters'); return; }
      done(v);
    };
  }, { confirmLabel: 'Add tag' });
}

/* ======================================================================
   The clock
   ====================================================================== */

function startTicker() {
  teardown();
  ticker = setInterval(() => {
    const nodes = rootEl ? rootEl.querySelectorAll('[data-clock]') : [];
    if (!nodes.length) return;
    // Only the digits are rewritten each second — re-rendering the whole page
    // would fight the coach's scroll position and finger.
    nodes.forEach((node) => {
      const block = liveBlocks.get(node.dataset.clock);
      if (!block) return;
      const ms = block.elapsedMs + (block.running && block.lastResumedAt ? Date.now() - new Date(block.lastResumedAt).getTime() : 0);
      node.textContent = fmtClock(ms);
    });
    updateTotals();
  }, 1000);
}

/* Cache of the blocks currently on screen, so the ticker does not hit the
   database every second. */
const liveBlocks = new Map();

function updateTotals() {
  const blocks = [...liveBlocks.values()];
  if (!blocks.length || !rootEl) return;
  const loadEl = rootEl.querySelector('[data-total-load]');
  const minsEl = rootEl.querySelector('[data-total-mins]');
  if (loadEl) loadEl.textContent = fmtLoad(sessionTeamLoad(blocks));
  if (minsEl) minsEl.textContent = fmtMinutes(sessionTeamMinutes(blocks));
}

/* ======================================================================
   Block actions
   ====================================================================== */

async function addBlock(session, drills, roster) {
  const available = drills.filter((d) => !d.archived)
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));

  const result = await openModal('Start a drill', (body, done) => {
    let group = 'Team';
    let search = '';

    // Practice runs as a whole squad most of the time, so the group picker
    // stays out of the way until it is actually needed. One tap to change it,
    // zero taps for the common case.
    const groupRow = h('div', {
      class: 'hidden',
      style: { display: 'flex', flexWrap: 'wrap', gap: '7px', margin: '10px 0 4px' },
    });
    const groupLine = h('div', {
      style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' },
    });

    function paintGroups() {
      groupRow.innerHTML = '';
      GROUP_PRESETS.forEach((g) => {
        groupRow.appendChild(h('button', {
          class: group === g ? 'chip on' : 'chip',
          style: { minHeight: '40px', border: '1px solid var(--line)', cursor: 'pointer' },
          onclick: () => { group = g; paintGroups(); paintGroupLine(); },
        }, g));
      });
    }

    function paintGroupLine() {
      groupLine.innerHTML = '';
      groupLine.append(
        h('span', { class: 'tiny', text: 'Group' }),
        h('span', { class: group === 'Team' ? 'chip' : 'chip on', text: group }),
        h('button', {
          class: 'btn btn-sm btn-ghost',
          style: { minHeight: '36px', padding: '4px 8px' },
          onclick: () => groupRow.classList.toggle('hidden'),
        }, 'Change'),
      );
    }

    paintGroups();
    paintGroupLine();

    const list = h('div', { class: 'list' });
    function paintList() {
      list.innerHTML = '';
      const matches = available.filter((d) => !search
        || `${d.name} ${d.category}`.toLowerCase().includes(search.toLowerCase()));
      if (!matches.length) {
        list.appendChild(h('div', { class: 'tiny', style: { padding: '14px' }, text: 'No drills match that search.' }));
        return;
      }
      matches.forEach((d) => {
        list.appendChild(h('div', {
          class: 'row clickable',
          onclick: () => done({ drill: d, group, mode: 'start' }),
        }, [
          intensityBadge(resolveIntensity(d)),
          h('div', { class: 'grow' }, [
            h('div', { class: 'name', text: d.name }),
            h('div', { class: 'tiny', text: d.category }),
          ]),
          h('span', { class: 'tiny', text: 'Start ›' }),
        ]));
      });
    }
    paintList();

    body.append(
      h('input', {
        type: 'search', placeholder: 'Search drills…',
        oninput: (e) => { search = e.target.value; paintList(); },
      }),
      groupLine,
      groupRow,
      h('p', { class: 'tiny', style: { margin: '8px 0 10px' } }, 'Tap a drill and its clock starts immediately.'),
      list,
      h('button', {
        class: 'btn btn-block', style: { marginTop: '12px' },
        onclick: () => done({ group, mode: 'manual' }),
      }, 'Log a drill I already ran'),
    );

    return null; // choosing a drill is the confirm action
  }, { cancelLabel: 'Close', wide: true });

  if (!result) return;

  if (result.mode === 'manual') return manualBlock(session, available, result.group, roster);

  const d = result.drill;
  const block = makeBlock({
    sessionId: session.id,
    drillId: d.id,
    drillName: d.name,
    intensity: resolveIntensity(d),
    tissue: { ...(d.tissue || { jump: null, sprint: null, cod: null }) },
    contact: d.contact !== false,
    group: result.group,
    startedAt: new Date().toISOString(),
    running: true,
    lastResumedAt: new Date().toISOString(),
    participation: {},
  });
  await db.put(db.STORES.blocks, block);
  liveBlocks.set(block.id, block);
  toast(`${d.name} started`);
  await render(rootEl);
}

/** For drills that were already run before anyone opened the app. */
async function manualBlock(session, drills, group, roster) {
  const result = await openModal('Log a drill you already ran', (body, done) => {
    const drill = selectInput(drills.map((d) => ({ value: d.id, label: `${d.name} (${resolveIntensity(d).toFixed(1)})` })), drills[0] && drills[0].id);
    const mins = numberInput(10, { min: 1, max: 240 });
    body.append(
      field('Drill', drill),
      field('How long did it run? (minutes)', mins),
      h('div', { class: 'note' }, 'This records the same as a stopwatch would — it just trusts your memory for the duration.'),
    );
    return () => {
      const d = drills.find((x) => x.id === drill.value);
      const m = Number(mins.value);
      if (!d || !m || m <= 0) { toast('Pick a drill and a length'); return; }
      done({ drill: d, minutes: m });
    };
  }, { confirmLabel: 'Log it' });

  if (!result) return;

  const block = makeBlock({
    sessionId: session.id,
    drillId: result.drill.id,
    drillName: result.drill.name,
    intensity: resolveIntensity(result.drill),
    tissue: { ...(result.drill.tissue || { jump: null, sprint: null, cod: null }) },
    contact: result.drill.contact !== false,
    group,
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    elapsedMs: result.minutes * 60000,
    running: false,
    participation: {},
  });
  await db.put(db.STORES.blocks, block);
  toast(`${result.drill.name} logged`);
  await render(rootEl);
}

async function pauseBlock(block) {
  const fresh = await db.get(db.STORES.blocks, block.id);
  if (!fresh || !fresh.running) return;
  const extra = fresh.lastResumedAt ? Date.now() - new Date(fresh.lastResumedAt).getTime() : 0;
  await db.put(db.STORES.blocks, { ...fresh, elapsedMs: fresh.elapsedMs + extra, running: false, lastResumedAt: null });
  toast('Paused');
  await render(rootEl);
}

async function resumeBlock(block) {
  const fresh = await db.get(db.STORES.blocks, block.id);
  if (!fresh || fresh.running) return;
  await db.put(db.STORES.blocks, { ...fresh, running: true, lastResumedAt: new Date().toISOString(), endedAt: null });
  toast('Resumed');
  await render(rootEl);
}

async function stopBlock(block) {
  const fresh = await db.get(db.STORES.blocks, block.id);
  if (!fresh) return;
  const extra = fresh.running && fresh.lastResumedAt ? Date.now() - new Date(fresh.lastResumedAt).getTime() : 0;
  const elapsedMs = fresh.elapsedMs + extra;
  const stopped = { ...fresh, elapsedMs, running: false, lastResumedAt: null, endedAt: new Date().toISOString() };
  await db.put(db.STORES.blocks, stopped);
  toast(`${fresh.drillName} · ${fmtClock(elapsedMs)}`);

  const askLive = await db.getMeta('askLiveTime', true);
  if (askLive) await promptLiveTime(stopped);

  await render(rootEl);
}

/**
 * "How much of that was live?" — read off the coach's own stopwatch.
 * Always skippable: he will not run the second watch every drill, and an
 * unmeasured drill must stay unmeasured rather than being recorded as zero.
 */
export async function promptLiveTime(block) {
  const totalMs = blockMinutes(block) * 60000;

  const result = await openModal(`Live time — ${block.drillName}`, (body, done) => {
    const existing = block.liveMs === null || block.liveMs === undefined ? null : block.liveMs;
    const startMin = existing === null ? '' : Math.floor(existing / 60000);
    const startSec = existing === null ? '' : Math.round((existing % 60000) / 1000);

    const minutes = numberInput(startMin, { min: 0, max: 240, placeholder: '0' });
    const seconds = numberInput(startSec, { min: 0, max: 59, placeholder: '00' });
    const preview = h('div', { class: 'tiny', style: { marginTop: '8px', minHeight: '20px' } });

    function paint() {
      const ms = toMs(minutes.value, seconds.value);
      if (ms === null) { preview.textContent = ''; return; }
      if (ms > totalMs) {
        preview.textContent = `That is longer than the drill ran (${fmtClock(totalMs)}). Check the stopwatch.`;
        preview.style.color = 'var(--high)';
        return;
      }
      preview.style.color = '';
      preview.textContent = `Live density ${Math.round((ms / totalMs) * 100)}% — ${fmtClock(ms)} live out of ${fmtClock(totalMs)}.`;
    }
    minutes.addEventListener('input', paint);
    seconds.addEventListener('input', paint);

    body.append(
      h('p', { class: 'small muted', style: { marginTop: 0 } },
        `The drill ran ${fmtClock(totalMs)}. Type what your stopwatch says the ball was actually live for.`),
      h('div', { class: 'form-row' }, [
        field('Minutes', minutes),
        field('Seconds', seconds),
      ]),
      preview,
      h('div', { class: 'btn-row', style: { marginTop: '14px' } }, [
        h('button', { class: 'btn btn-sm', onclick: () => done({ __action: 'skip' }) }, 'Did not time it'),
        existing !== null
          ? h('button', { class: 'btn btn-sm btn-danger', onclick: () => done({ __action: 'clear' }) }, 'Clear')
          : null,
      ]),
    );
    paint();

    return () => {
      const ms = toMs(minutes.value, seconds.value);
      if (ms === null) { toast('Enter the live time, or tap “Did not time it”'); return; }
      if (ms > totalMs) {
        toast(`Live time cannot exceed the ${fmtClock(totalMs)} the drill ran`);
        return;
      }
      done({ liveMs: ms });
    };
  }, { confirmLabel: 'Save', cancelLabel: 'Close' });

  if (!result) return;
  if (result.__action === 'skip') return;

  const fresh = await db.get(db.STORES.blocks, block.id);
  if (!fresh) return;

  if (result.__action === 'clear') {
    await db.put(db.STORES.blocks, { ...fresh, liveMs: null });
    toast('Live time cleared');
    return;
  }

  await db.put(db.STORES.blocks, { ...fresh, liveMs: result.liveMs });
  const density = Math.round((result.liveMs / (blockMinutes(fresh) * 60000)) * 100);
  toast(`Live density ${density}%`);
}

/** Minutes + seconds boxes to milliseconds. Blank in both means "not timed". */
function toMs(minStr, secStr) {
  const m = String(minStr).trim();
  const sec = String(secStr).trim();
  if (m === '' && sec === '') return null;
  const mins = m === '' ? 0 : Number(m);
  const secs = sec === '' ? 0 : Number(sec);
  if (!Number.isFinite(mins) || !Number.isFinite(secs) || mins < 0 || secs < 0) return null;
  return Math.round((mins * 60 + secs) * 1000);
}

/** Three-state participation: full -> limited -> out -> full. */
async function editParticipation(block, session, roster) {
  const fresh = await db.get(db.STORES.blocks, block.id);
  if (!fresh) return;
  const state = { ...(fresh.participation || {}) };

  const result = await openModal(`Who’s in — ${fresh.drillName}`, (body, done) => {
    const list = h('div', { class: 'list' });
    const painters = [];
    const repaintAll = () => painters.forEach((fn) => fn());

    function labelFor(v) {
      if (v === 0) return { text: 'Sat out', cls: 'chip' };
      if (v === 0.5) return { text: 'Limited', cls: 'chip' };
      return { text: 'Full', cls: 'chip on' };
    }

    roster.forEach((p) => {
      const row = h('div', { class: 'row clickable' });
      const chip = h('span', { class: 'chip' });
      const paint = () => {
        const v = state[p.id] === undefined ? 1 : state[p.id];
        const l = labelFor(v);
        chip.textContent = l.text;
        chip.className = l.cls;
        row.style.opacity = v === 0 ? '.5' : '1';
      };
      row.addEventListener('click', () => {
        const v = state[p.id] === undefined ? 1 : state[p.id];
        state[p.id] = v === 1 ? 0.5 : (v === 0.5 ? 0 : 1);
        paint();
      });
      row.append(
        h('div', { class: 'grow' }, [
          h('div', { class: 'name', text: `${p.number ? `#${p.number} ` : ''}${p.name}` }),
        ]),
        chip,
      );
      paint();
      painters.push(paint);
      list.appendChild(row);
    });

    body.append(
      h('p', { class: 'tiny', style: { marginTop: 0 } },
        'Tap a player to cycle Full → Limited → Sat out. “Limited” counts as half the load — that is a judgement call, not a measurement.'),
      h('div', { class: 'btn-row', style: { marginBottom: '12px' } }, [
        h('button', {
          class: 'btn btn-sm',
          onclick: () => {
            roster.forEach((p) => { delete state[p.id]; });
            repaintAll();
          },
        }, 'Everyone full'),
      ]),
      list,
    );

    return () => done({ participation: state });
  }, { confirmLabel: 'Save' });

  if (!result) return;
  const participation = result.reset ? {} : result.participation;
  await db.put(db.STORES.blocks, { ...fresh, participation });
  await render(rootEl);
}

/** Fix a finished drill: duration, intensity, group, or delete it. */
async function editBlock(block, session, roster) {
  const fresh = await db.get(db.STORES.blocks, block.id);
  if (!fresh) return;

  const result = await openModal(fresh.drillName, (body, done) => {
    const minutes = numberInput(Math.round(blockMinutes(fresh) * 10) / 10, { min: 0, step: '0.1' });
    const group = selectInput(GROUP_PRESETS, fresh.group || 'Team');
    const picker = intensityPicker(fresh.intensity);

    body.append(
      h('div', { class: 'form-row' }, [
        field('Length (minutes)', minutes),
        field('Group', group),
      ]),
      h('label', { class: 'field' }, [
        h('span', { class: 'lbl', text: 'Intensity for this run' }),
        picker,
      ]),
      h('div', { class: 'note' },
        'Changing the intensity here affects only this one run. The drill library keeps its own rating.'),
      h('div', { class: 'btn-row' }, [
        h('button', { class: 'btn btn-sm', onclick: () => done({ __action: 'live' }) }, 'Live time'),
        h('button', { class: 'btn btn-sm', onclick: () => done({ __action: 'participation' }) }, 'Who’s in'),
        h('button', { class: 'btn btn-sm', onclick: () => done({ __action: 'resume' }) }, 'Resume clock'),
        h('button', { class: 'btn btn-sm btn-danger', onclick: () => done({ __action: 'delete' }) }, 'Delete'),
      ]),
    );

    return () => done({
      elapsedMs: Math.max(0, Number(minutes.value) || 0) * 60000,
      group: group.value,
      intensity: picker.getValue(),
    });
  }, { confirmLabel: 'Save' });

  if (!result) return;

  if (result.__action === 'live') { await promptLiveTime(fresh); return render(rootEl); }
  if (result.__action === 'participation') return editParticipation(fresh, session, roster);
  if (result.__action === 'resume') return resumeBlock(fresh);
  if (result.__action === 'delete') {
    const ok = await confirmDanger('Delete this drill run?', `${fresh.drillName} will be removed from this practice.`, 'Delete');
    if (!ok) return;
    await db.remove(db.STORES.blocks, fresh.id);
    liveBlocks.delete(fresh.id);
    toast('Removed');
    return render(rootEl);
  }

  await db.put(db.STORES.blocks, { ...fresh, ...result, running: false, lastResumedAt: null });
  toast('Updated');
  await render(rootEl);
}

/* ======================================================================
   Ending a practice
   ====================================================================== */

async function endPractice(session, blocks) {
  const stillRunning = blocks.filter((b) => b.running);

  const ok = await confirmDanger('End this practice?',
    stillRunning.length
      ? `${stillRunning.length} clock${stillRunning.length === 1 ? ' is' : 's are'} still running and will be stopped now. The session moves to your history, where you can still correct it.`
      : 'The session moves to your history. You can still open it and correct anything afterwards.',
    'End practice');
  if (!ok) return;

  const now = new Date().toISOString();
  for (const b of stillRunning) {
    const extra = b.lastResumedAt ? Date.now() - new Date(b.lastResumedAt).getTime() : 0;
    await db.put(db.STORES.blocks, { ...b, elapsedMs: b.elapsedMs + extra, running: false, lastResumedAt: null, endedAt: now });
  }

  await db.put(db.STORES.sessions, { ...session, status: 'complete', endedAt: now });
  liveBlocks.clear();
  toast('Practice saved');
  await render(rootEl);
  await openSessionSummary({ ...session, status: 'complete', endedAt: now });
}

/* ======================================================================
   Session summary
   ====================================================================== */

/** Says plainly how much of the session the live figure actually covers. */
function liveNote(blocks) {
  const live = sessionLiveDensity(blocks);
  if (!blocks.length) return null;
  if (!live.timedCount) {
    return h('div', { class: 'note' },
      'No live time recorded for this session. Run a second stopwatch on the live action and type it in when you stop a drill, and the app works out the live density.');
  }
  if (live.coverage < 0.999) {
    return h('div', { class: 'note warn' }, [
      h('strong', { text: `Live density covers ${Math.round(live.coverage * 100)}% of this session. ` }),
      `It is the figure for the ${live.timedCount} drill${live.timedCount === 1 ? '' : 's'} you timed, not for the whole practice.`,
    ]);
  }
  return h('div', { class: 'note' },
    `${Math.round(live.liveMinutes)} live minutes out of ${Math.round(live.totalMinutes)} on court — every drill timed.`);
}

/** Movement totals for a session, plus an honest note when drills are untagged. */
function tissueSummaryBlock(blocks) {
  const coverage = tissueCoverage(blocks);
  const wrap = h('div', { style: { marginTop: '18px' } });
  wrap.appendChild(h('h3', { text: 'Movement demands' }));

  if (coverage.totalMinutes === 0) return wrap;

  const contact = contactShare(blocks);
  wrap.appendChild(h('div', { class: 'grid four' }, [
    h('div', { class: 'stat' }, [
      h('div', { class: 'k', text: 'Contact time' }),
      h('div', { class: 'v', text: String(Math.round(contact.contactMinutes)) }),
      h('div', { class: 'n', text: `minutes · ${Math.round(contact.fraction * 100)}% of the session` }),
    ]),
  ].concat(TISSUE.map((t) => {
    const total = blocks.reduce((sum, b) => sum + (blockTissue(b, t.key) || 0), 0);
    return h('div', { class: 'stat' }, [
      h('div', { class: 'k', text: t.label }),
      h('div', { class: 'v', text: Math.round(total).toLocaleString() }),
      h('div', { class: 'n', text: t.why }),
    ]);
  }))));

  if (coverage.fraction < 0.999) {
    const missing = Math.round((1 - coverage.fraction) * 100);
    wrap.appendChild(h('div', { class: 'note warn', style: { marginTop: '12px' } }, [
      h('strong', { text: `${missing}% of this session is not counted above. ` }),
      'Some drills have no movement tags yet, so their jumping, sprinting and change of direction are missing from these totals. Add the tags in the drill library and they will count from then on.',
    ]));
  }

  return wrap;
}

async function openSessionSummary(session) {
  const [players, blocks] = await Promise.all([
    db.getAll(db.STORES.players),
    db.getBy(db.STORES.blocks, 'sessionId', session.id),
  ]);
  const roster = players.filter((p) => (session.rosterIds || []).includes(p.id));
  const byPlayer = sessionLoadByPlayer(blocks, roster.map((p) => p.id));
  const ordered = blocks.slice().sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));

  // Built before the modal opens because contextCard reads saved tags.
  const contextSlot = h('div', { style: { marginBottom: '6px' } });
  contextCard(session).then((card) => contextSlot.appendChild(card));

  await openModal(`${formatDate(session.date)}${session.label ? ` · ${session.label}` : ''}`, (body, done) => {
    body.append(
      h('div', { class: 'grid three', style: { marginBottom: '16px' } }, [
        h('div', { class: 'stat' }, [
          h('div', { class: 'k', text: 'Court time' }),
          h('div', { class: 'v', text: `${Math.round(sessionTeamMinutes(ordered))}` }),
          h('div', { class: 'n', text: 'minutes' }),
        ]),
        h('div', { class: 'stat' }, [
          h('div', { class: 'k', text: 'Full-session load' }),
          h('div', { class: 'v' }, [fmtLoad(sessionTeamLoad(ordered)), h('span', { class: 'u', text: 'AU' })]),
          h('div', { class: 'n', text: 'doing every drill' }),
        ]),
        h('div', { class: 'stat' }, [
          h('div', { class: 'k', text: 'Drills' }),
          h('div', { class: 'v', text: String(ordered.length) }),
          h('div', { class: 'n', text: `${roster.length} players` }),
        ]),
        liveStat(ordered),
      ]),

      liveNote(ordered),

      contextSlot,

      h('h3', { text: 'Drills' }),
      h('div', { class: 'table-wrap' }, [
        h('table', {}, [
          h('thead', {}, h('tr', {}, [
            h('th', { text: 'Drill' }), h('th', { text: 'Group' }),
            h('th', { class: 'num', text: 'Min' }), h('th', { class: 'num', text: 'Live' }),
            h('th', { class: 'num', text: 'Int' }), h('th', { class: 'num', text: 'AU' }),
          ])),
          h('tbody', {}, ordered.map((b) => h('tr', {}, [
            h('td', {}, [
              b.drillName,
              b.contact === false ? h('span', { class: 'chip', style: { marginLeft: '7px' }, text: 'no D' }) : null,
            ]),
            h('td', { class: 'tiny', text: b.group || 'Team' }),
            h('td', { class: 'num', text: fmtMinutes(blockMinutes(b)) }),
            h('td', { class: 'num', text: fmtDensity(blockLiveDensity(b)) }),
            h('td', { class: 'num', text: String(b.intensity) }),
            h('td', { class: 'num', text: fmtLoad(blockLoad(b)) }),
          ]))),
        ]),
      ]),

      tissueSummaryBlock(ordered),

      h('h3', { style: { marginTop: '18px' }, text: 'Load per player' }),
      h('div', { class: 'table-wrap' }, [
        h('table', {}, [
          h('thead', {}, h('tr', {}, [h('th', { text: 'Player' }), h('th', { class: 'num', text: 'AU' })])),
          h('tbody', {}, roster
            .slice()
            .sort((a, b) => (byPlayer.get(b.id) || 0) - (byPlayer.get(a.id) || 0))
            .map((p) => h('tr', {}, [
              h('td', { text: `${p.number ? `#${p.number} ` : ''}${p.name}` }),
              h('td', { class: 'num', text: fmtLoad(byPlayer.get(p.id) || 0) }),
            ]))),
        ]),
      ]),

      h('div', { class: 'btn-row', style: { marginTop: '18px' } }, [
        h('button', { class: 'btn btn-sm btn-danger', onclick: () => done({ __action: 'delete' }) }, 'Delete session'),
      ]),
    );
    return null;
  }, { cancelLabel: 'Close', wide: true }).then(async (res) => {
    if (res && res.__action === 'delete') {
      const ok = await confirmDanger('Delete this session?',
        'The practice and every drill run in it will be permanently removed.', 'Delete');
      if (!ok) return;
      await db.removeBy(db.STORES.blocks, 'sessionId', session.id);
      await db.removeBy(db.STORES.playerSessions, 'sessionId', session.id);
      await db.remove(db.STORES.sessions, session.id);
      toast('Session deleted');
      await render(rootEl);
    }
  });
}
