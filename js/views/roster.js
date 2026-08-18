/* views/roster.js — the players.
 *
 * Kept deliberately thin. The app assumes everyone on the active roster does
 * every drill; the coach only marks the exceptions during practice. That
 * assumption is what keeps courtside use down to two taps per drill.
 */

import * as db from '../db.js';
import { makePlayer } from '../models.js';
import { h, mount, toast, openModal, confirmDanger, field, textInput, selectInput, emptyState } from '../ui.js';
import { statusDot } from '../components.js';

const STATUSES = [
  { value: 'active',   label: 'Active — trains fully' },
  { value: 'injured',  label: 'Injured — not training' },
  { value: 'inactive', label: 'Inactive — off roster' },
];

const STATUS_SHORT = { active: 'Active', injured: 'Injured', inactive: 'Inactive' };

export async function render(root) {
  const players = (await db.getAll(db.STORES.players))
    .sort((a, b) => {
      const order = { active: 0, injured: 1, inactive: 2 };
      return (order[a.status] - order[b.status])
        || (Number(a.number || 999) - Number(b.number || 999))
        || a.name.localeCompare(b.name);
    });

  const counts = players.reduce((acc, p) => { acc[p.status] = (acc[p.status] || 0) + 1; return acc; }, {});

  const body = players.length
    ? h('div', { class: 'list' }, players.map((p) => playerRow(p, root)))
    : emptyState('👥', 'No players yet',
      'Add the roster once. During practice the app assumes everyone is in every drill, and you just tap the ones who sat out.',
      h('button', { class: 'btn btn-primary', style: { marginTop: '14px' }, onclick: () => editPlayer(null, root) }, 'Add your first player'));

  mount(root,
    h('div', { class: 'page-head' }, [
      h('div', {}, [
        h('h1', { text: 'Roster' }),
        h('div', { class: 'sub', style: { margin: 0 },
          text: `${counts.active || 0} active · ${counts.injured || 0} injured · ${counts.inactive || 0} inactive` }),
      ]),
      h('div', { class: 'btn-row' }, [
        players.length ? h('button', { class: 'btn', onclick: () => bulkAdd(root) }, 'Add several') : null,
        h('button', { class: 'btn btn-primary', onclick: () => editPlayer(null, root) }, '+ New player'),
      ]),
    ]),
    body,
  );
}

function playerRow(p, root) {
  return h('div', { class: 'row clickable', onclick: () => editPlayer(p, root) }, [
    statusDot(p.status),
    p.number !== '' && p.number !== null && p.number !== undefined
      ? h('span', { class: 'mono', style: { minWidth: '32px', fontWeight: '700', color: 'var(--text-2)' }, text: `#${p.number}` })
      : h('span', { style: { minWidth: '32px' } }),
    h('div', { class: 'grow' }, [
      h('div', { class: 'name', text: p.name }),
      h('div', { class: 'tiny', text: [p.position, STATUS_SHORT[p.status]].filter(Boolean).join(' · ') }),
    ]),
    h('span', { class: 'tiny', text: '›', style: { fontSize: '22px' } }),
  ]);
}

export async function editPlayer(existing, root) {
  const player = existing ? { ...existing } : makePlayer();

  const result = await openModal(existing ? 'Edit player' : 'New player', (body, done) => {
    const name = textInput(player.name, { placeholder: 'Full name' });
    const number = textInput(player.number, { placeholder: '#', inputmode: 'numeric' });
    const position = selectInput(['', 'PG', 'SG', 'SF', 'PF', 'C'], player.position || '');
    const status = selectInput(STATUSES, player.status);

    body.append(
      field('Name', name),
      h('div', { class: 'form-row' }, [
        field('Number', number),
        field('Position', position),
      ]),
      field('Status', status,
        'Injured players stay in the app and keep their history — they are just left out of new practices by default.'),
      existing ? h('div', { class: 'btn-row', style: { marginTop: '8px' } }, [
        h('button', { class: 'btn btn-sm btn-danger', onclick: () => done({ __action: 'delete' }) }, 'Delete player'),
      ]) : null,
    );

    return () => {
      if (!name.value.trim()) { toast('Give the player a name'); name.focus(); return; }
      done({
        ...player,
        name: name.value.trim(),
        number: number.value.trim(),
        position: position.value,
        status: status.value,
      });
    };
  }, { confirmLabel: existing ? 'Save changes' : 'Add player' });

  if (!result) return;

  if (result.__action === 'delete') {
    const ok = await confirmDanger('Delete player?',
      `${player.name} and all of their recorded practice data will be permanently removed. If they have just left the team, set them to Inactive instead — that keeps the history.`,
      'Delete permanently');
    if (!ok) return;
    await db.remove(db.STORES.players, player.id);
    await db.removeBy(db.STORES.playerSessions, 'playerId', player.id);
    toast('Player deleted');
    return render(root);
  }

  await db.put(db.STORES.players, result);
  toast(existing ? 'Player updated' : `${result.name} added`);
  await render(root);
}

/** Paste-a-list entry, because typing 15 players one modal at a time is grim. */
async function bulkAdd(root) {
  const result = await openModal('Add several players', (body, done) => {
    const area = h('textarea', {
      placeholder: '4 Marko Jokic PG\n7 Luka Peric SG\nNikola Ilic C',
      style: { minHeight: '190px' },
    });
    body.append(
      h('p', { class: 'small muted' }, 'One player per line. A leading number becomes their jersey number, and a trailing position (PG, SG, SF, PF, C) is picked up too.'),
      area,
    );
    return () => done(area.value);
  }, { confirmLabel: 'Add players' });

  if (!result) return;

  const lines = result.split('\n').map((l) => l.trim()).filter(Boolean);
  const players = [];
  for (const line of lines) {
    let rest = line;
    let number = '';
    const numMatch = rest.match(/^#?(\d{1,2})\s+(.*)$/);
    if (numMatch) { number = numMatch[1]; rest = numMatch[2]; }

    let position = '';
    const posMatch = rest.match(/\s+(PG|SG|SF|PF|C)$/i);
    if (posMatch) { position = posMatch[1].toUpperCase(); rest = rest.slice(0, posMatch.index); }

    const name = rest.trim();
    if (name) players.push(makePlayer({ name, number, position }));
  }

  if (!players.length) { toast('Nothing to add'); return; }
  await db.putMany(db.STORES.players, players);
  toast(`${players.length} players added`);
  await render(root);
}
