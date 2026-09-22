/* views/settings.js — backup, restore, and the honest note about what this
 * app measures.
 *
 * Backup matters more than it looks. All data lives on this one device: if the
 * iPad is lost or reset, the season is gone. Export is the only insurance.
 */

import * as db from '../db.js';
import { h, mount, toast, confirmDanger, downloadFile, pickFile, toCSV, openModal, field, textInput, pickImage, shrinkImage } from '../ui.js';
import { ACCENTS } from '../pdf.js';
import {
  toDateKey, resolveIntensity, DEFAULT_GROUPS, LIVE_CATEGORIES, LEGACY_LIVE_CATEGORY,
  CONTACT_ROLES, contactRowForCategory, offeredCategories,
} from '../models.js';
import {
  planLiveSplit, applyLiveSplit, pendingRelabels, relabelRuns,
  categoryUsage, renameCategory, removeCategory,
} from '../sync.js';

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
  const liveSplit = planLiveSplit(await db.getAll(db.STORES.drills), await db.getAll(db.STORES.blocks));
  const liveSplitWaiting = liveSplit.drills.length + liveSplit.runs.length;
  const contactMap = await db.getMeta('contactRows', null);
  const usage = categoryUsage(drills, blocks);
  const hiddenCategories = await db.getMeta('hiddenCategories', []);
  /* Every category offered in the drill editor, whether or not anything is
     filed under it yet — an unused starter category is exactly the kind he
     needs to be able to remove. */
  const usageByName = new Map(usage.map((u) => [u.name, u]));
  const allCategories = [
    ...usage,
    ...offeredCategories(drills, customCategories, hiddenCategories)
      .filter((c) => !usageByName.has(c))
      .map((name) => ({ name, drills: 0, runs: 0 })),
  ];
  const stale = await pendingRelabels();
  const groups = await db.getMeta('groups', DEFAULT_GROUPS);
  const lastBackup = await db.getMeta('lastBackupAt', null);
  const [pdfClub, pdfPrepared, pdfAccent, pdfLogo] = await Promise.all([
    db.getMeta('pdfClubName', ''), db.getMeta('pdfPreparedBy', ''),
    db.getMeta('pdfAccent', ACCENTS[0].hex), db.getMeta('pdfLogo', null),
  ]);
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

    /* ---- what goes on every PDF ---- */
    pdfCard({ pdfClub, pdfPrepared, pdfAccent, pdfLogo }, root),

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

      h('h3', { style: { marginTop: '18px' }, text: 'Practice groups' }),
      h('p', { class: 'tiny', style: { marginTop: 0 } },
        'How practice splits when it splits. “Team” is always first and costs no taps. Removing one never changes a practice already recorded.'),
      h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '7px' } },
        groups.filter((g) => g !== 'Team').map((g) => removableChip(g, async () => {
          await db.setMeta('groups', groups.filter((x) => x !== g));
          toast(`“${g}” removed from the list`);
          await render(root);
        }))),
      h('button', {
        class: 'btn btn-sm', style: { marginTop: '8px' },
        // A real modal, not window.prompt — prompt() is unreliable inside an
        // installed app window, which is exactly where this runs.
        onclick: async () => {
          const res = await openModal('New practice group', (body, done) => {
            const input = textInput('', { placeholder: 'e.g. Smalls' });
            body.append(field('Group name', input,
              'What you call this split on the floor. It shows up in “Start a drill”.'));
            return () => done({ name: input.value.trim() });
          }, { confirmLabel: 'Add' });
          const name = res && res.name;
          if (!name) return;
          if (groups.some((g) => g.toLowerCase() === name.toLowerCase())) {
            toast('That group is already on the list');
            return;
          }
          await db.setMeta('groups', [...groups, name]);
          toast(`“${name}” added`);
          await render(root);
        },
      }, '+ New group'),

      h('h3', { style: { marginTop: '18px' }, text: 'Drill categories' }),
      h('p', { class: 'tiny', style: { marginTop: 0 } },
        'Every category offered when you file a drill, with how much is filed under it. Renaming one renames it on every drill at once — and onto a name you already use, it merges the two. Removing one that still has drills asks where to move them first.'),
      h('div', { class: 'list' }, allCategories.length
        ? allCategories.map((u) => h('div', { class: 'row' }, [
          h('div', { class: 'grow' }, [
            h('div', { class: 'name', text: u.name }),
            h('div', { class: 'tiny', text: u.drills || u.runs
              ? `${u.drills} drill${u.drills === 1 ? '' : 's'} · ${u.runs} recorded run${u.runs === 1 ? '' : 's'}`
              : 'nothing filed under it' }),
          ]),
          h('div', { class: 'btn-row', style: { margin: 0 } }, [
            h('button', { class: 'btn btn-sm', onclick: () => renameCategoryFlow(u, allCategories, root) }, 'Rename…'),
            h('button', { class: 'btn btn-sm', onclick: () => removeCategoryFlow(u, allCategories, root) }, 'Remove…'),
          ]),
        ]))
        : [h('div', { class: 'tiny', style: { padding: '12px' }, text: 'No categories yet.' })]),

      /* Offered only while something is still filed under the old name. */
      liveSplitWaiting ? h('div', { class: 'note', style: { marginTop: '14px' } }, [
        h('strong', { text: `“${LEGACY_LIVE_CATEGORY}” can be split. ` }),
        `${liveSplit.drills.length} drill${liveSplit.drills.length === 1 ? '' : 's'} and ${liveSplit.runs.length} recorded run${liveSplit.runs.length === 1 ? '' : 's'} can be re-filed from the matchup they already carry.`,
        h('div', { class: 'btn-row', style: { marginTop: '8px' } }, [
          h('button', { class: 'btn btn-sm btn-primary', onclick: () => splitLive(liveSplit, root) }, 'Split it…'),
        ]),
      ]) : null,
    ]),

    /* ---- which categories are contact ---- */
    contactCard(usage, contactMap, root),

    /* ---- practices still under an older name ---- */
    relabelCard(stale, root),

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

/* ---- which categories count as contact ----------------------------------
 *
 * His own definition (2026-09-20, sharpened 2026-09-22): three contact
 * formats, with Live / Continuous / Shell inside the first two. A category is
 * given a role; the role says whether it is always contact or only with live
 * defence, and whether the drill's matchup decides 5on5 or small-sided. See
 * models.js for the tree.
 *
 * It lives here rather than in the code because the categories are his and he
 * renames them. The app only guesses the first time, from the name.
 */
function contactCard(usage, map, root) {
  const options = [{ value: '', label: 'Not contact' }, ...CONTACT_ROLES];
  return h('div', { class: 'card' }, [
    h('h2', { style: { marginTop: 0 }, text: 'Which categories are contact' }),
    h('p', { class: 'small muted' },
      'Reports show three contact formats. 5on5 contact: Live, Continuous (5on5on5), Shell. Small-sided contact: Live, Continuous (3on3on3, 4on4on4), Shell (1on1 closeouts, 4on4 shell). Transition contact. Whole contact is all of them added.'),
    h('p', { class: 'small muted' }, [
      h('strong', { text: 'Contact time is the second stopwatch. ' }),
      'Only the live part of a drill counts — on a shell drill that starts as a walk-through, start the second watch when it goes live. A contact drill you did not time shows as “not timed”, never as zero.',
    ]),
    h('p', { class: 'small muted' },
      'Shell and Transition count only drills set to live defence. Live and Continuous always count. For Continuous and Shell, the drill’s matchup decides the size: 5v5 is 5on5 contact, fewer a side is small-sided.'),
    h('div', { class: 'list' }, usage.length
      ? usage.map((u) => {
        const current = contactRowForCategory(u.name, map) || '';
        const sel = h('select', {
          style: { width: 'auto', maxWidth: '300px', minHeight: '40px' },
          onchange: async (e) => {
            const next = { ...(map || {}) };
            next[u.name] = e.target.value || null;
            await db.setMeta('contactRows', next);
            toast(e.target.value ? `${u.name} counts as contact` : `${u.name} is not counted as contact`);
            await render(root);
          },
        }, options.map((o) => h('option', { value: o.value, selected: o.value === current }, o.label)));
        return h('div', { class: 'row' }, [
          h('div', { class: 'grow' }, [
            h('div', { class: 'name', text: u.name }),
            h('div', { class: 'tiny', text: `${u.drills} drill${u.drills === 1 ? '' : 's'}` }),
          ]),
          sel,
        ]);
      })
      : [h('div', { class: 'tiny', style: { padding: '12px' }, text: 'No drills filed yet.' })]),
  ]);
}

/* ---- practices recorded under an older name -----------------------------
 *
 * The app asks at the moment a drill is renamed. This is the catch-up for the
 * renaming he had already done by hand before it asked — and the only way to
 * change his mind afterwards. Nothing happens without him tapping it. */
function relabelCard(stale, root) {
  if (!stale.length) return null;
  const runs = stale.reduce((n, s) => n + s.runs, 0);
  return h('div', { class: 'card' }, [
    h('h2', { style: { marginTop: 0 }, text: 'Practices recorded under an older name' }),
    h('p', { class: 'small muted' },
      `${runs} recorded drill run${runs === 1 ? '' : 's'} kept the name or category it had on the day, and the library has since changed. Reports show what was recorded, so the same drill can appear under two names. Update the ones you meant to rename — the intensity, matchup and movement tags of those runs are never touched.`),
    h('div', { class: 'list' }, stale.map((item) => h('div', { class: 'row' }, [
      h('div', { class: 'grow' }, [
        h('div', { class: 'name', text: item.drill.name }),
        h('div', { class: 'tiny', text: [
          `${item.runs} run${item.runs === 1 ? '' : 's'}`,
          item.oldNames.length ? `recorded as “${item.oldNames.join('”, “')}”` : null,
          item.oldCategories.length ? `filed under ${item.oldCategories.join(', ')} — now ${item.drill.category}` : null,
        ].filter(Boolean).join(' · ') }),
      ]),
      h('button', {
        class: 'btn btn-sm',
        onclick: async () => {
          const n = await relabelRuns(item.drill);
          toast(`${n} run${n === 1 ? '' : 's'} updated`);
          await render(root);
        },
      }, 'Update'),
    ]))),
    h('div', { class: 'btn-row', style: { marginTop: '10px' } }, [
      h('button', {
        class: 'btn btn-primary',
        onclick: async () => {
          let n = 0;
          for (const item of stale) n += await relabelRuns(item.drill);
          toast(`${n} recorded run${n === 1 ? '' : 's'} updated`);
          await render(root);
        },
      }, 'Update all of them'),
    ]),
  ]);
}

/* Rename a category on every drill at once, and — because he asked for the
 * old reports to change too — offer the recorded runs with it. Renaming onto
 * a name already in use merges them, which is how two categories become one. */
async function renameCategoryFlow(usageRow, usage, root) {
  const others = usage.filter((u) => u.name !== usageRow.name).map((u) => u.name);
  const result = await openModal(`Rename “${usageRow.name}”`, (body, done) => {
    const input = textInput(usageRow.name, { placeholder: 'New name' });
    const runsBox = h('input', { type: 'checkbox', checked: true });
    const warn = h('div', {});
    input.addEventListener('input', () => {
      mount(warn, others.includes(input.value.trim())
        ? h('div', { class: 'note' }, `“${input.value.trim()}” already exists — the two will be merged into one category.`)
        : null);
    });
    body.append(
      field('Category name', input, `${usageRow.drills} drill${usageRow.drills === 1 ? '' : 's'} will move.`),
      warn,
      h('label', { class: 'field', style: { display: 'flex', gap: '10px', alignItems: 'center' } }, [
        runsBox,
        h('span', { text: `Also rename it on the ${usageRow.runs} practice run${usageRow.runs === 1 ? '' : 's'} already recorded` }),
      ]),
      h('p', { class: 'tiny' },
        'With that ticked, every report from the first practice onwards uses the new name. Without it, reports keep printing the old name for practices already recorded.'),
    );
    return () => {
      const name = input.value.trim();
      if (!name) { toast('Give the category a name'); input.focus(); return; }
      done({ name, runsToo: !!runsBox.checked });
    };
  }, { confirmLabel: 'Rename' });

  if (!result || result.name === usageRow.name) return;
  const moved = await renameCategory(usageRow.name, result.name, { runsToo: result.runsToo });
  toast(`${moved.drills} drill${moved.drills === 1 ? '' : 's'}${result.runsToo ? ` and ${moved.runs} run${moved.runs === 1 ? '' : 's'}` : ''} moved to “${result.name}”`);
  await render(root);
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

/* The coach's four names, two of which the matchup can place. The dialog says
 * which is which, and says that past practices are re-filed too — by their own
 * recorded matchup, so what each practice was does not change, only how finely
 * it is named. */
async function splitLive(plan, root) {
  const lines = LIVE_CATEGORIES.map((c) => h('li', {}, [
    h('strong', { text: c.name }),
    ` — ${c.note}`,
    c.derivable ? ` · ${plan.counts[c.name] || 0} drill${(plan.counts[c.name] || 0) === 1 ? '' : 's'}` : '',
  ]));
  const ok = await openModal(`Split “${LEGACY_LIVE_CATEGORY}”`, (body, done) => {
    body.append(
      h('ul', { style: { paddingLeft: '18px' } }, lines),
      h('p', { class: 'small' },
        `${plan.drills.length} drill${plan.drills.length === 1 ? '' : 's'} in the library and ${plan.runs.length} run${plan.runs.length === 1 ? '' : 's'} in practices you already recorded will move, using the matchup each one stored. Past practices are included, so this season's reports use the new names from the first day.`),
      h('p', { class: 'small' },
        'Advantage games and Continuous games cannot be worked out — the matchup records a 4on3 the same as a 4on4, and has no way to say three teams rotate. Move those drills by hand in Drills.'),
      (plan.leftDrills || plan.leftRuns) ? h('div', { class: 'note warn' },
        `${plan.leftDrills} drill${plan.leftDrills === 1 ? '' : 's'} and ${plan.leftRuns} run${plan.leftRuns === 1 ? '' : 's'} stay under “${LEGACY_LIVE_CATEGORY}”: they have no defence, or no matchup recorded, so they cannot be placed without guessing.`) : null,
    );
    return () => done(true);
  }, { confirmLabel: 'Split it' });
  if (!ok) return;
  await applyLiveSplit(plan);
  toast(`Split — ${plan.drills.length} drills and ${plan.runs.length} runs re-filed`);
  await render(root);
}

/* Club name, who prepared it, a colour and a logo — on every PDF from Reports.
 * Stored on this device like everything else, and included in backups. */
function pdfCard({ pdfClub, pdfPrepared, pdfAccent, pdfLogo }, root) {
  const save = (key, label) => async (e) => {
    await db.setMeta(key, e.target.value.trim());
    toast(`${label} saved`);
  };
  const club = textInput(pdfClub, { placeholder: 'e.g. KK Your Club — U19' });
  club.addEventListener('change', save('pdfClubName', 'Club name'));
  const prepared = textInput(pdfPrepared, { placeholder: 'e.g. S&C coach' });
  prepared.addEventListener('change', save('pdfPreparedBy', 'Name'));

  return h('div', { class: 'card' }, [
    h('h2', { style: { marginTop: 0 }, text: 'PDF reports' }),
    h('p', { class: 'small muted' },
      'What goes on every PDF you make from Reports. Stored on this device only.'),
    h('div', { class: 'form-row' }, [
      field('Club or team name', club),
      field('Prepared by', prepared, 'Optional. Shown under the club name.'),
    ]),

    h('h3', { style: { marginTop: '14px' }, text: 'Colour' }),
    h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px' } }, ACCENTS.map((a) => h('button', {
      class: 'btn btn-sm',
      title: a.label,
      'aria-pressed': a.hex === pdfAccent ? 'true' : 'false',
      style: {
        background: a.hex, color: '#fff', minWidth: '84px',
        outline: a.hex === pdfAccent ? '3px solid var(--text)' : 'none', outlineOffset: '2px',
      },
      onclick: async () => { await db.setMeta('pdfAccent', a.hex); toast(`${a.label} it is`); await render(root); },
    }, a.hex === pdfAccent ? `✓ ${a.label}` : a.label))),

    h('h3', { style: { marginTop: '14px' }, text: 'Logo' }),
    pdfLogo
      ? h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' } }, [
        h('img', { src: pdfLogo, alt: 'Club logo', style: { maxHeight: '64px', maxWidth: '160px', background: '#fff', padding: '4px', borderRadius: '6px', border: '1px solid var(--line)' } }),
        h('button', { class: 'btn btn-sm', onclick: () => chooseLogo(root) }, 'Change logo'),
        h('button', { class: 'btn btn-sm btn-danger', onclick: async () => { await db.setMeta('pdfLogo', null); toast('Logo removed'); await render(root); } }, 'Remove logo'),
      ])
      : h('button', { class: 'btn btn-sm', onclick: () => chooseLogo(root) }, 'Add logo'),
    h('p', { class: 'tiny' }, 'PNG or JPG. It is shrunk to a small size before it is stored, so backup files stay small.'),
  ]);
}

async function chooseLogo(root) {
  const picked = await pickImage();
  if (!picked) return;
  try {
    const small = await shrinkImage(picked.dataUrl, 480);
    await db.setMeta('pdfLogo', small);
    toast('Logo saved');
    await render(root);
  } catch (err) {
    toast(err && err.message ? err.message : 'That image could not be read');
  }
}

/* Remove a category from the list. With nothing filed under it, that is all.
   With drills still in it, he picks where they go — the app never guesses —
   and the recorded runs follow unless he unticks it. */
async function removeCategoryFlow(row, all, root) {
  const inUse = row.drills + row.runs > 0;
  const others = all.filter((u) => u.name !== row.name).map((u) => u.name);
  const result = await openModal(`Remove “${row.name}”`, (body, done) => {
    if (!inUse) {
      body.append(h('p', { class: 'small' },
        'Nothing is filed under it, so it just stops being offered when you file a drill.'));
      return () => done({});
    }
    const sel = h('select', {}, [
      h('option', { value: '', text: 'Choose a category…' }),
      ...others.map((o) => h('option', { value: o, text: o })),
    ]);
    const runsBox = h('input', { type: 'checkbox', checked: true });
    body.append(
      field('Move its drills to', sel,
        `${row.drills} drill${row.drills === 1 ? '' : 's'} and ${row.runs} recorded run${row.runs === 1 ? '' : 's'} are filed under it.`),
      h('label', { class: 'field', style: { display: 'flex', gap: '10px', alignItems: 'center' } }, [
        runsBox,
        h('span', { text: 'Also move the practice runs already recorded' }),
      ]),
      h('p', { class: 'tiny' },
        'With that ticked, every report from the first practice onwards shows the new category. The category you move them to keeps its own contact setting.'),
    );
    return () => {
      if (!sel.value) { toast('Choose where the drills should go'); return; }
      done({ moveTo: sel.value, runsToo: !!runsBox.checked });
    };
  }, { confirmLabel: 'Remove' });
  if (!result) return;
  const moved = await removeCategory(row.name, result);
  toast(result.moveTo
    ? `“${row.name}” removed — ${moved.drills} drill${moved.drills === 1 ? '' : 's'}${result.runsToo ? ` and ${moved.runs} run${moved.runs === 1 ? '' : 's'}` : ''} moved to “${result.moveTo}”`
    : `“${row.name}” removed from the list`);
  await render(root);
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
