/* components.js — widgets that carry basketball meaning, shared across views. */

import { h, field } from './ui.js';
import {
  INTENSITY, intensityInfo, intensityBand,
  COURT_LEVELS, SITUATION_LEVELS, RHYTHM_LEVELS, CONTACT_LEVELS,
  TISSUE, TISSUE_LEVELS, deriveIntensity,
} from './models.js';

/**
 * The 1-10 intensity picker with its anchor description underneath.
 * The description is the whole point: it keeps a "7" meaning the same thing
 * in March as it did in November.
 */
export function intensityPicker(value, onChange) {
  const wrap = h('div', {});
  const legend = h('div', { class: 'iscale-legend' });
  const scale = h('div', { class: 'iscale' });
  let current = Number(value) || 5;

  function paint() {
    [...scale.children].forEach((btn) => {
      const v = Number(btn.dataset.v);
      const on = v === current;
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.className = on ? `${intensityBand(v)}` : '';
      btn.style.background = on ? '' : '';
    });
    const info = intensityInfo(current);
    legend.innerHTML = '';
    legend.append(
      h('b', { text: `${info.value} — ${info.label}` }),
      h('div', { class: 'small muted', text: info.example }),
    );
  }

  INTENSITY.forEach((i) => {
    scale.appendChild(h('button', {
      type: 'button',
      'data-v': i.value,
      onclick: () => { current = i.value; paint(); onChange && onChange(current); },
    }, String(i.value)));
  });

  wrap.append(scale, legend);
  paint();
  wrap.getValue = () => current;
  wrap.setValue = (v) => { current = Number(v); paint(); };
  return wrap;
}

/** The little coloured intensity square used in lists. */
export function intensityBadge(value) {
  return h('span', {
    class: `badge-i ${intensityBand(value)}`,
    title: `${value} — ${intensityInfo(value).label}`,
  }, String(value));
}

/** Player status dot. */
export function statusDot(status) {
  const colour = status === 'injured' ? 'var(--high)'
    : status === 'inactive' ? 'var(--text-3)'
      : 'var(--ok)';
  return h('span', { class: 'dot', style: { background: colour }, title: status });
}


/* ---- the objective intensity grid ------------------------------------
 * Three dropdowns, a live readout of the resulting number, and a plain-English
 * sentence saying why it came out that way.
 */
export function intensityGrid(drill, onChange) {
  const wrap = h('div', {});
  let court = Number(drill.court) || 3;
  let situation = Number(drill.situation) || 1;
  let rhythm = Number(drill.rhythm) || 1;
  let contact = drill.contact !== false;

  const readout = h('div', {
    style: {
      display: 'flex', alignItems: 'center', gap: '12px',
      padding: '12px 14px', marginTop: '12px',
      background: 'var(--surface-2)', borderRadius: 'var(--radius-s)',
    },
  });

  function picker(levels, value, set) {
    const sel = h('select', {
      onchange: (e) => { set(Number(e.target.value)); paint(); },
    });
    levels.forEach((l) => sel.appendChild(h('option', { value: l.value, selected: l.value === value }, l.label)));
    sel.value = String(value);
    return sel;
  }

  const courtSel = picker(COURT_LEVELS, court, (v) => { court = v; });
  const situationSel = picker(SITUATION_LEVELS, situation, (v) => { situation = v; });
  const rhythmSel = picker(RHYTHM_LEVELS, rhythm, (v) => { rhythm = v; });

  const contactRow = h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px' } });
  function paintContact() {
    contactRow.innerHTML = '';
    CONTACT_LEVELS.forEach((l) => {
      contactRow.appendChild(h('button', {
        type: 'button',
        class: contact === l.value ? 'btn btn-primary btn-sm' : 'btn btn-sm',
        onclick: () => { contact = l.value; paintContact(); paint(); },
      }, l.label));
    });
  }

  function paint() {
    const value = deriveIntensity(court, situation, rhythm, contact);
    readout.innerHTML = '';
    readout.append(
      intensityBadge(value),
      h('div', {}, [
        h('div', { style: { fontWeight: '650' }, text: `Intensity ${value.toFixed(1)} — ${intensityInfo(value).label}` }),
        h('div', { class: 'tiny', text: describe(court, situation, rhythm, contact) }),
      ]),
    );
    if (onChange) onChange(value);
  }

  wrap.append(
    h('div', { class: 'form-row' }, [
      field('Court used', courtSel),
      field('Game situation', situationSel),
    ]),
    field('Rhythm', rhythmSel),
    h('label', { class: 'field' }, [
      h('span', { class: 'lbl', text: 'Defence' }),
      contactRow,
      h('div', { class: 'tiny', style: { marginTop: '4px' },
        text: 'Unopposed work is about one level easier than the same drill contested. Counted separately for injury exposure, because contact is where collisions and awkward landings come from.' }),
    ]),
    readout,
  );
  paintContact();
  paint();

  wrap.getValues = () => ({
    court, situation, rhythm, contact,
    intensity: deriveIntensity(court, situation, rhythm, contact),
  });
  return wrap;
}

function describe(court, situation, rhythm, contact) {
  const c = COURT_LEVELS.find((l) => l.value === court);
  const s = SITUATION_LEVELS.find((l) => l.value === situation);
  const r = RHYTHM_LEVELS.find((l) => l.value === rhythm);
  const situationText = contact ? (s ? s.label : '') : `${s ? s.label.split('v')[0] : ''}v0`;
  return `${c ? c.label : ''} · ${situationText} · ${r ? r.label.toLowerCase() : ''}`;
}

/* ---- movement demand tags --------------------------------------------
 * Three rows, four buttons each. Twelve taps to describe a drill's whole
 * movement profile, once, forever.
 */
export function tissuePicker(drill) {
  const wrap = h('div', {});
  const state = {};
  TISSUE.forEach((t) => {
    const existing = drill.tissue ? drill.tissue[t.key] : null;
    state[t.key] = (existing === undefined || existing === null) ? null : Number(existing);
  });

  TISSUE.forEach((t) => {
    const row = h('div', { style: { marginBottom: '14px' } });
    const buttons = h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '5px' } });

    function paint() {
      buttons.innerHTML = '';
      TISSUE_LEVELS.forEach((l) => {
        const on = state[t.key] === l.value;
        buttons.appendChild(h('button', {
          type: 'button',
          class: on ? 'btn btn-primary btn-sm' : 'btn btn-sm',
          onclick: () => { state[t.key] = l.value; paint(); },
        }, l.label));
      });
    }
    paint();

    row.append(
      h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px', marginBottom: '5px' } }, [
        h('span', { style: { fontWeight: '650', fontSize: '15px' }, text: t.label }),
        h('span', { class: 'tiny', text: t.why }),
      ]),
      buttons,
      h('div', { class: 'tiny', style: { marginTop: '4px' }, text: t.example }),
    );
    wrap.appendChild(row);
  });

  wrap.getValues = () => ({ ...state });
  wrap.isComplete = () => TISSUE.every((t) => state[t.key] !== null);
  return wrap;
}
