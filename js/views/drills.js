/* views/drills.js — the drill library.
 *
 * This is the foundation of everything else. A drill is a name, a category and
 * an intensity. The intensity is the coach's standing judgement of how hard
 * that drill demands players work; the stopwatch supplies the other half.
 */

import * as db from '../db.js';
import {
  makeDrill, DEFAULT_CATEGORIES, intensityInfo,
  INTENSITY_MODES, resolveIntensity, hasTissueTags, TISSUE, TISSUE_LEVELS,
} from '../models.js';
import { h, mount, toast, openModal, confirmDanger, field, textInput, numberInput, selectInput, emptyState } from '../ui.js';
import { intensityPicker, intensityBadge, intensityGrid, tissuePicker } from '../components.js';

let search = '';
let showArchived = false;

export async function render(root) {
  const drills = await db.getAll(db.STORES.drills);
  const categories = await categoryList(drills);

  const visible = drills
    .filter((d) => showArchived ? true : !d.archived)
    .filter((d) => !search || (`${d.name} ${d.category} ${d.notes}`).toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));

  const body = h('div', {});

  if (!drills.length) {
    body.appendChild(emptyState('📋', 'No drills yet',
      'Add every drill you run in practice, with its intensity. Once they are in here, tracking a practice is just tapping start and stop.',
      h('button', { class: 'btn btn-primary', style: { marginTop: '16px' }, onclick: () => editDrill(null, root) },
        'Add your first drill')));
    body.appendChild(h('div', { class: 'note', style: { marginTop: '16px' } }, [
      h('strong', { text: 'Have a drill library file? ' }),
      'Settings → Import a drill library loads a whole library at once. It only adds drills — practices you have already recorded are never touched.',
    ]));
  } else if (!visible.length) {
    body.appendChild(emptyState('🔍', 'Nothing matches', 'Try a different search, or clear it to see the whole library.'));
  } else {
    const untagged = drills.filter((d) => !d.archived && !hasTissueTags(d));
    if (untagged.length) {
      body.appendChild(h('div', { class: 'note warn' }, [
        h('div', {}, [
          h('strong', { text: `${untagged.length} drill${untagged.length === 1 ? '' : 's'} without movement tags. ` }),
          'Until these are tagged, their jumping, sprinting and change of direction are missing from the totals — which makes a heavy week look quiet.',
        ]),
        h('button', {
          class: 'btn btn-sm btn-primary', style: { marginTop: '10px' },
          onclick: () => tagRun(untagged, root),
        }, `Tag them (${untagged.length} left)`),
      ]));
    }

    let lastCat = null;
    const list = h('div', { class: 'list' });
    for (const d of visible) {
      if (d.category !== lastCat) {
        lastCat = d.category;
        list.appendChild(h('h2', { text: d.category, style: { margin: '18px 0 2px' } }));
      }
      list.appendChild(drillRow(d, root));
    }
    body.appendChild(list);
  }

  mount(root,
    h('div', { class: 'page-head' }, [
      h('div', {}, [
        h('h1', { text: 'Drill library' }),
        h('div', { class: 'sub', style: { margin: 0 }, text: `${drills.filter((d) => !d.archived).length} active drills across ${categories.length} categories` }),
      ]),
      h('button', { class: 'btn btn-primary', onclick: () => editDrill(null, root) }, '+ New drill'),
    ]),

    !drills.length ? null : h('div', { class: 'util' }, [
      h('input', {
        type: 'search', placeholder: 'Search drills…', value: search,
        oninput: (e) => { search = e.target.value; render(root); },
      }),
      h('button', {
        class: `btn btn-sm ${showArchived ? 'btn-primary' : ''}`,
        onclick: () => { showArchived = !showArchived; render(root); },
      }, showArchived ? 'Hiding nothing' : 'Show archived'),
    ]),

    body,

    drills.length ? null : h('div', { class: 'note' }, [
      h('strong', { text: 'Tip: ' }),
      'Start with the twenty or so drills you actually run most weeks. You can add more any time, and old practices keep the name and intensity they had on the day.',
    ]),
  );
}

function drillRow(d, root) {
  const intensity = resolveIntensity(d);
  const info = intensityInfo(intensity);
  const typicalLoad = Math.round(intensity * (d.typicalMinutes || 0));
  const tagged = hasTissueTags(d);

  return h('div', {
    class: 'row clickable',
    onclick: () => editDrill(d, root),
  }, [
    intensityBadge(intensity),
    h('div', { class: 'grow' }, [
      h('div', { class: 'name' }, [
        d.name,
        d.archived ? h('span', { class: 'chip', style: { marginLeft: '8px' }, text: 'archived' }) : null,
        d.intensityMode === 'measured' ? h('span', { class: 'chip on', style: { marginLeft: '8px' }, text: 'measured' }) : null,
      ]),
      h('div', { class: 'tiny', text: `${info.label}${d.typicalMinutes ? ` · usually ${d.typicalMinutes} min` : ''}${typicalLoad ? ` · ~${typicalLoad} AU` : ''}` }),
      tagged
        ? h('div', { class: 'tiny', style: { marginTop: '2px' }, text: tissueSummary(d) })
        : h('div', { class: 'tiny', style: { marginTop: '2px', color: 'var(--watch)' }, text: 'No movement tags yet' }),
    ]),
    h('span', { class: 'tiny', text: '›', style: { fontSize: '22px' } }),
  ]);
}

function tissueSummary(d) {
  return TISSUE.map((t) => {
    const v = d.tissue ? d.tissue[t.key] : null;
    const label = (TISSUE_LEVELS.find((l) => l.value === Number(v)) || {}).label || '—';
    return `${t.label.slice(0, 4).replace('Chan', 'CoD')} ${label.toLowerCase()}`;
  }).join(' · ');
}

async function categoryList(drills) {
  const custom = await db.getMeta('customCategories', []);
  const used = [...new Set(drills.map((d) => d.category))];
  return [...new Set([...DEFAULT_CATEGORIES, ...custom, ...used])].filter(Boolean);
}

/* ---- add / edit ------------------------------------------------------- */

export async function editDrill(existing, root) {
  const drills = await db.getAll(db.STORES.drills);
  const categories = await categoryList(drills);
  const drill = existing ? { ...existing } : makeDrill();

  const result = await openModal(existing ? 'Edit drill' : 'New drill', (body, done) => {
    const name = textInput(drill.name, { placeholder: 'e.g. 11-man full court' });
    const cat = selectInput([...categories, { value: '__new', label: '+ New category…' }], drill.category);
    const newCat = textInput('', { placeholder: 'New category name', class: 'hidden' });
    const mins = numberInput(drill.typicalMinutes, { min: 1, max: 180, placeholder: '10' });
    const notes = h('textarea', { placeholder: 'Coaching notes, setup, variations…' }, drill.notes || '');

    cat.addEventListener('change', () => {
      newCat.classList.toggle('hidden', cat.value !== '__new');
      if (cat.value === '__new') newCat.focus();
    });

    /* --- how intensity gets set --- */
    let mode = drill.intensityMode || 'derived';

    const grid = intensityGrid(drill);
    const manual = intensityPicker(drill.intensityMode === 'manual' ? drill.intensity : resolveIntensity(drill));
    const measured = numberInput(drill.measured === null || drill.measured === undefined ? '' : drill.measured,
      { min: 1, max: 10, step: '0.01', placeholder: 'e.g. 7.25' });

    const panes = {
      derived: h('div', {}, [grid]),
      manual: h('div', { class: 'hidden' }, [manual]),
      measured: h('div', { class: 'hidden' }, [
        field('Measured value (1–10)', measured,
          'A number from your own tracking data. Anything on the same scale works, as long as you use the same scale for every drill.'),
      ]),
    };

    const modeRow = h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '5px', marginBottom: '10px' } });
    const modeNote = h('div', { class: 'tiny', style: { marginBottom: '12px' } });

    function paintMode() {
      modeRow.innerHTML = '';
      INTENSITY_MODES.forEach((m) => {
        modeRow.appendChild(h('button', {
          type: 'button',
          class: mode === m.value ? 'btn btn-primary btn-sm' : 'btn btn-sm',
          onclick: () => { mode = m.value; paintMode(); },
        }, m.label));
      });
      const active = INTENSITY_MODES.find((m) => m.value === mode);
      modeNote.textContent = active ? active.note : '';
      Object.entries(panes).forEach(([k, pane]) => pane.classList.toggle('hidden', k !== mode));
    }
    paintMode();

    /* --- movement demands --- */
    const tissue = tissuePicker(drill);

    body.append(
      field('Drill name', name),
      h('div', { class: 'form-row' }, [
        field('Category', cat),
        field('Typical length (minutes)', mins, 'Just a default — the stopwatch is what counts.'),
      ]),
      newCat,

      h('h3', { style: { marginTop: '20px' }, text: 'Intensity' }),
      modeRow,
      modeNote,
      panes.derived, panes.manual, panes.measured,

      h('h3', { style: { marginTop: '24px' }, text: 'Movement demands' }),
      h('p', { class: 'tiny', style: { marginTop: 0 } },
        'One intensity number cannot say what KIND of work this was, and the kind is what predicts the injury. Set these once and the app can tell you his jumping is up 60% this week, not just that his load is.'),
      tissue,

      field('Notes (optional)', notes),

      existing ? h('div', { class: 'btn-row', style: { marginTop: '8px' } }, [
        h('button', { class: 'btn btn-sm', onclick: () => done({ __action: 'archive' }) },
          drill.archived ? 'Restore to library' : 'Archive'),
        h('button', { class: 'btn btn-sm btn-danger', onclick: () => done({ __action: 'delete' }) }, 'Delete'),
      ]) : null,
    );

    return async () => {
      if (!name.value.trim()) { toast('Give the drill a name'); name.focus(); return; }

      let category = cat.value;
      if (category === '__new') {
        category = newCat.value.trim();
        if (!category) { toast('Name the new category'); newCat.focus(); return; }
        const custom = await db.getMeta('customCategories', []);
        if (!custom.includes(category)) await db.setMeta('customCategories', [...custom, category]);
      }

      const gridValues = grid.getValues();
      const measuredValue = measured.value === '' ? null : Number(measured.value);

      if (mode === 'measured' && (measuredValue === null || !Number.isFinite(measuredValue))) {
        toast('Enter the measured value'); measured.focus(); return;
      }

      const next = {
        ...drill,
        name: name.value.trim(),
        category,
        intensityMode: mode,
        court: gridValues.court,
        situation: gridValues.situation,
        rhythm: gridValues.rhythm,
        contact: gridValues.contact,
        measured: measuredValue,
        tissue: tissue.getValues(),
        typicalMinutes: Number(mins.value) || 0,
        notes: notes.value.trim(),
      };
      // Keep the flat number in sync so nothing downstream has to know how it
      // was arrived at.
      next.intensity = mode === 'manual' ? manual.getValue() : resolveIntensity(next);
      done(next);
    };
  }, { confirmLabel: existing ? 'Save changes' : 'Add drill' });

  if (!result) return;
  if (result.__action === 'archive') return archiveDrill(drill, root);
  if (result.__action === 'delete') return deleteDrill(drill, root);

  await db.put(db.STORES.drills, result);
  toast(existing ? 'Drill updated' : `“${result.name}” added`);
  await render(root);
}

export async function archiveDrill(drill, root) {
  await db.put(db.STORES.drills, { ...drill, archived: !drill.archived });
  toast(drill.archived ? 'Drill restored' : 'Drill archived');
  await render(root);
}

export async function deleteDrill(drill, root) {
  const ok = await confirmDanger('Delete drill?',
    `“${drill.name}” will be removed from the library. Practices you have already recorded keep their own copy of the name and intensity, so your history is not affected.`,
    'Delete');
  if (!ok) return;
  await db.remove(db.STORES.drills, drill.id);
  toast('Drill deleted');
  await render(root);
}


/* ---- bulk actions ------------------------------------------------------ */

/**
 * Walk through untagged drills one at a time. Three taps each, and it says how
 * many are left, so it is finishable in one sitting rather than being an
 * open-ended chore.
 */
async function tagRun(queue, root) {
  for (let i = 0; i < queue.length; i++) {
    const drill = await db.get(db.STORES.drills, queue[i].id);
    if (!drill) continue;

    const result = await openModal(drill.name, (body, done) => {
      const picker = tissuePicker(drill);
      body.append(
        h('div', { class: 'tiny', style: { marginBottom: '10px' } },
          `${i + 1} of ${queue.length} · ${drill.category} · intensity ${resolveIntensity(drill).toFixed(1)}`),
        h('p', { class: 'small muted', style: { marginTop: 0 } },
          'How much of each does this drill actually demand? Think about a typical run of it.'),
        picker,
        h('div', { class: 'btn-row' }, [
          h('button', { class: 'btn btn-sm', onclick: () => done({ __action: 'skip' }) }, 'Skip for now'),
          h('button', { class: 'btn btn-sm btn-danger', onclick: () => done({ __action: 'stop' }) }, 'Stop here'),
        ]),
      );
      return () => {
        if (!picker.isComplete()) { toast('Set all three, or skip this drill'); return; }
        done({ tissue: picker.getValues() });
      };
    }, { confirmLabel: i === queue.length - 1 ? 'Save and finish' : 'Save and next', cancelLabel: 'Close' });

    if (!result || result.__action === 'stop') break;
    if (result.__action === 'skip') continue;

    await db.put(db.STORES.drills, { ...drill, tissue: result.tissue });
  }
  await render(root);
}
