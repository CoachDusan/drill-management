/* views/settings.js — backup, restore, and the honest note about what this
 * app measures.
 *
 * Backup matters more than it looks. All data lives on this one device: if the
 * iPad is lost or reset, the season is gone. Export is the only insurance.
 */

import * as db from '../db.js';
import { h, mount, toast, confirmDanger, downloadFile, pickFile, toCSV } from '../ui.js';
import { toDateKey, resolveIntensity } from '../models.js';

export async function render(root) {
  const [players, drills, sessions, blocks] = await Promise.all([
    db.getAll(db.STORES.players),
    db.getAll(db.STORES.drills),
    db.getAll(db.STORES.sessions),
    db.getAll(db.STORES.blocks),
  ]);

  const askLiveTime = await db.getMeta('askLiveTime', true);
  const customTags = await db.getMeta('customTags', []);
  const customCategories = await db.getMeta('customCategories', []);
  const lastBackup = await db.getMeta('lastBackupAt', null);
  const daysSince = lastBackup
    ? Math.floor((Date.now() - new Date(lastBackup).getTime()) / 86400000)
    : null;

  mount(root,
    h('div', { class: 'page-head' }, [
      h('div', {}, [
        h('h1', { text: 'Settings' }),
        h('div', { class: 'sub', style: { margin: 0 }, text: 'Backup, data, and what the numbers mean' }),
      ]),
    ]),

    h('div', { class: 'grid four', style: { marginBottom: '20px' } }, [
      tile('Players', players.length),
      tile('Drills', drills.filter((d) => !d.archived).length),
      tile('Sessions', sessions.length),
      tile('Drill runs', blocks.length),
    ]),

    /* ---- backup ---- */
    h('div', { class: 'card' }, [
      h('h2', { style: { marginTop: 0 }, text: 'Backup' }),
      h('p', { class: 'small muted' },
        'Everything you record lives on this device only — nothing is sent anywhere. That keeps it private and working without wifi, but it also means a lost or wiped iPad loses the season. Export a backup file every couple of weeks and keep it somewhere safe.'),
      lastBackup
        ? h('div', { class: daysSince > 21 ? 'note warn' : 'note' },
          daysSince === 0 ? 'Last backup: today.'
            : `Last backup: ${daysSince} day${daysSince === 1 ? '' : 's'} ago.`)
        : h('div', { class: 'note warn' }, 'You have never exported a backup.'),
      h('div', { class: 'btn-row' }, [
        h('button', { class: 'btn btn-primary', onclick: () => exportBackup(root) }, 'Export backup file'),
        h('button', { class: 'btn', onclick: () => importBackup(root) }, 'Restore from backup'),
      ]),
    ]),

    /* ---- spreadsheet export ---- */
    h('div', { class: 'card' }, [
      h('h2', { style: { marginTop: 0 }, text: 'Export to spreadsheet' }),
      h('p', { class: 'small muted' },
        'CSV files you can open in Numbers or Excel, if you want to do your own analysis or share numbers with the medical staff.'),
      h('div', { class: 'btn-row' }, [
        h('button', { class: 'btn', onclick: () => exportDrillsCSV(drills) }, 'Drill library (CSV)'),
        h('button', { class: 'btn', onclick: () => exportRosterCSV(players) }, 'Roster (CSV)'),
      ]),
    ]),

    /* ---- courtside behaviour ---- */
    h('div', { class: 'card' }, [
      h('h2', { style: { marginTop: 0 }, text: 'During practice' }),
      h('div', { class: 'row', style: { border: 'none', padding: 0 } }, [
        h('div', { class: 'grow' }, [
          h('div', { class: 'name', text: 'Ask for live time when I stop a drill' }),
          h('div', { class: 'tiny', text: 'Type what your stopwatch says the ball was live for, and the app works out live density. Always skippable — turn this off if you would rather add live times afterwards.' }),
        ]),
        h('button', {
          class: askLiveTime ? 'btn btn-sm btn-primary' : 'btn btn-sm',
          onclick: async () => { await db.setMeta('askLiveTime', !askLiveTime); await render(root); },
        }, askLiveTime ? 'On' : 'Off'),
      ]),
    ]),

    /* ---- drill library import ---- */
    h('div', { class: 'card' }, [
      h('h2', { style: { marginTop: 0 }, text: 'Import a drill library' }),
      h('p', { class: 'small muted' },
        'Loads a whole set of drills from a file in one go. This only ever ADDS drills — your practices, roster and settings are untouched, and a drill whose name you already have is skipped. Safe to run twice.'),
      h('div', { class: 'btn-row' }, [
        h('button', { class: 'btn', onclick: () => importDrillLibrary(root) }, 'Choose a drill library file'),
        h('button', { class: 'btn', onclick: () => exportDrillLibrary() }, 'Save my drills as a file' ),
      ]),
    ]),

    /* ---- the coach's own vocabulary ---- */
    h('div', { class: 'card' }, [
      h('h2', { style: { marginTop: 0 }, text: 'Your own tags and categories' }),
      h('p', { class: 'small muted' },
        'Tags you write during a practice, and drill categories you add, are kept here and offered every time after that. Remove any you stopped using — it only takes them off the list, it never changes a practice you already recorded.'),

      h('h3', { style: { marginTop: '16px' }, text: 'Context tags' }),
      customTags.length
        ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '7px' } },
          customTags.map((t) => removableChip(t, () => removeCustom('customTags', t, root))))
        : h('p', { class: 'tiny', style: { marginTop: 0 } },
          'None yet. Tap “+ New tag” during a practice to add one.'),

      h('h3', { style: { marginTop: '18px' }, text: 'Drill categories' }),
      customCategories.length
        ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '7px' } },
          customCategories.map((c) => removableChip(c, () => removeCustom('customCategories', c, root))))
        : h('p', { class: 'tiny', style: { marginTop: 0 } },
          'None yet. Add one from the “+ New category” option in the drill editor.'),
    ]),

    /* ---- what this measures ---- */
    h('div', { class: 'card' }, [
      h('h2', { style: { marginTop: 0 }, text: 'What these numbers are — and are not' }),
      h('p', { class: 'small' }, [
        h('strong', { text: 'This measures prescribed load, not measured load. ' }),
        'There is no GPS and no heart rate here. A load number is your intensity rating multiplied by the minutes on the clock. It tells you how much you asked of the group and how that compares to last week. It cannot tell you what an individual body actually did — two players in the same drill get the same number even if one took twelve possessions and the other took three.',
      ]),
      h('p', { class: 'small' }, [
        h('strong', { text: 'The scale must stay honest. ' }),
        'The whole value of this data is that a 7 in March means what a 7 meant in November. If your ratings drift over the season, the trends become fiction. When in doubt, go back to the anchor descriptions in the drill editor.',
      ]),
      h('p', { class: 'small' }, [
        h('strong', { text: 'Units are arbitrary. ' }),
        'A load of 480 AU means nothing on its own. It only means something next to your own numbers from other days and other weeks.',
      ]),
    ]),

    /* ---- danger zone ---- */
    h('div', { class: 'card' }, [
      h('h2', { style: { marginTop: 0 }, text: 'Erase everything' }),
      h('p', { class: 'small muted' }, 'Removes every player, drill and practice from this device. Export a backup first — this cannot be undone.'),
      h('button', { class: 'btn btn-danger', onclick: () => eraseAll(root) }, 'Erase all data'),
    ]),
  );
}

/** A chip with an x that removes it from a saved list. */
function removableChip(label, onRemove) {
  return h('span', { class: 'chip', style: { paddingRight: '4px' } }, [
    label,
    h('button', {
      class: 'btn btn-ghost',
      style: { minHeight: '26px', padding: '0 7px', fontSize: '16px', lineHeight: '1', color: 'var(--text-3)' },
      title: `Remove ${label}`,
      'aria-label': `Remove ${label}`,
      onclick: onRemove,
    }, '\u00d7'),
  ]);
}

async function removeCustom(key, value, root) {
  const list = await db.getMeta(key, []);
  await db.setMeta(key, list.filter((v) => v !== value));
  toast(`“${value}” removed from the list`);
  await render(root);
}

function tile(k, v) {
  return h('div', { class: 'stat' }, [
    h('div', { class: 'k', text: k }),
    h('div', { class: 'v', text: String(v) }),
  ]);
}

async function importDrillLibrary(root) {
  const file = await pickFile('.json,application/json');
  if (!file) return;

  let payload;
  try { payload = JSON.parse(file.text); }
  catch (_) { toast('That file is not readable'); return; }

  try {
    const { added, skipped } = await db.importDrills(payload);
    if (!added && !skipped) { toast('No drills in that file'); return; }
    toast(added
      ? `${added} drill${added === 1 ? '' : 's'} added${skipped ? `, ${skipped} already here` : ''}`
      : 'Those drills are all already here');
  } catch (err) {
    toast(err.message || 'Could not read that file');
    return;
  }
  await render(root);
}

/** Drills only — a library file to move between devices or hand to someone. */
async function exportDrillLibrary() {
  const drills = await db.getAll(db.STORES.drills);
  if (!drills.length) { toast('No drills to save yet'); return; }
  const payload = {
    format: 'drill-load-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    note: 'Drill library only.',
    data: { players: [], sessions: [], blocks: [], playerSessions: [], customFields: [], meta: [], drills },
  };
  downloadFile(`drill-library-${toDateKey(new Date())}.json`, JSON.stringify(payload, null, 2));
  toast(`${drills.length} drills saved`);
}

async function exportBackup(root) {
  const payload = await db.exportAll();
  downloadFile(`load-tracker-backup-${toDateKey(new Date())}.json`, JSON.stringify(payload, null, 2));
  await db.setMeta('lastBackupAt', new Date().toISOString());
  toast('Backup exported');
  await render(root);
}

async function importBackup(root) {
  const file = await pickFile('.json,application/json');
  if (!file) return;

  let payload;
  try { payload = JSON.parse(file.text); }
  catch (_) { toast('That file is not readable'); return; }

  if (!payload || payload.format !== 'drill-load-backup') {
    toast('That is not a Load Tracker backup');
    return;
  }

  const counts = Object.entries(payload.data || {})
    .map(([k, v]) => `${(v || []).length} ${k}`).join(', ');

  const ok = await confirmDanger('Restore this backup?',
    `This will replace everything currently on this device with the contents of ${file.name} (${counts}). Anything recorded since that backup will be lost.`,
    'Replace all data');
  if (!ok) return;

  await db.importAll(payload, { replace: true });
  toast('Backup restored');
  await render(root);
}

function exportDrillsCSV(drills) {
  const rows = [[
    'Name', 'Category', 'Intensity', 'Set by', 'Court', 'Situation', 'Rhythm', 'Live defence',
    'Jumping', 'Sprinting', 'Change of direction',
    'Typical minutes', 'Typical load (AU)', 'Archived', 'Notes',
  ]];
  const lvl = (v) => (v === null || v === undefined ? '' : v);
  for (const d of drills) {
    const intensity = resolveIntensity(d);
    rows.push([
      d.name, d.category, intensity.toFixed(2), d.intensityMode,
      d.court, d.situation, d.rhythm, d.contact === false ? 'no' : 'yes',
      lvl(d.tissue && d.tissue.jump), lvl(d.tissue && d.tissue.sprint), lvl(d.tissue && d.tissue.cod),
      d.typicalMinutes, Math.round(intensity * (d.typicalMinutes || 0)),
      d.archived ? 'yes' : 'no', d.notes,
    ]);
  }
  downloadFile(`drills-${toDateKey(new Date())}.csv`, toCSV(rows), 'text/csv');
  toast('Drill library exported');
}

function exportRosterCSV(players) {
  const rows = [['Name', 'Number', 'Position', 'Status']];
  for (const p of players) rows.push([p.name, p.number, p.position, p.status]);
  downloadFile(`roster-${toDateKey(new Date())}.csv`, toCSV(rows), 'text/csv');
  toast('Roster exported');
}

async function eraseAll(root) {
  const ok = await confirmDanger('Erase all data?',
    'Every player, drill and practice will be permanently deleted from this device. There is no undo and no copy on a server.',
    'Erase everything');
  if (!ok) return;
  await db.clearAll();
  toast('All data erased');
  await render(root);
}
