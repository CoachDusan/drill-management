/* components.js — widgets that carry basketball meaning, shared across views. */

import { h, field } from './ui.js';
import {
  INTENSITY, intensityInfo, intensityBand,
  COURT_LEVELS, SITUATION_OPTIONS, situationOption, RHYTHM_LEVELS, rhythmLabel,
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

  const courtSel = h('select', {
    onchange: (e) => { court = Number(e.target.value); paint(); },
  });
  COURT_LEVELS.forEach((l) => courtSel.appendChild(
    h('option', { value: l.value, selected: l.value === court }, l.label)));
  courtSel.value = String(court);

  /* One picker for the matchup, the way the coach says it out loud — "3v0",
     not "3v3 plus a defence toggle". Sets both fields underneath. */
  const sitSel = h('select', {
    onchange: (e) => {
      const opt = SITUATION_OPTIONS[Number(e.target.value)];
      situation = opt.situation; contact = opt.contact; paint();
    },
  });
  SITUATION_OPTIONS.forEach((o, i) => sitSel.appendChild(h('option', {
    value: i,
    selected: o.situation === situation && o.contact === contact,
  }, o.note ? `${o.label} — ${o.note.toLowerCase()}` : o.label)));
  sitSel.value = String(SITUATION_OPTIONS.findIndex(
    (o) => o.situation === situation && o.contact === contact));

  const rhythmSel = h('select', {
    onchange: (e) => { rhythm = Number(e.target.value); paint(); },
  });
  /* Both wordings on every level, because they are one dial and he thinks in
     whichever suits the drill. "Rare stops" is how you rate a scrimmage;
     "3 lengths, then stop" is how you rate a rep-based transition drill —
     and it is the wording the 43 imported library drills were rated against. */
  RHYTHM_LEVELS.forEach((l) => rhythmSel.appendChild(
    h('option', { value: l.value, selected: l.value === rhythm }, `${l.label} — ${l.lengths.toLowerCase()}`)));
  rhythmSel.value = String(rhythm);

  const rhythmNote = h('div', { class: 'tiny', style: { marginTop: '4px' } });
  const sitNote = h('div', { class: 'tiny', style: { marginTop: '4px' } });

  function paint() {
    const value = deriveIntensity(court, situation, rhythm, contact);
    const r = RHYTHM_LEVELS.find((l) => l.value === rhythm);
    rhythmNote.textContent = r ? `${r.note} How far a length runs is set by the court above, so the two together already say how much transition there is.` : '';

    // Say the flat spots out loud rather than letting him find one and assume
    // the app is broken. Two of them:
    //  - at five players the situation scale has bottomed out, and the club's
    //    own matched pair says the real gap between 5v5 and 5v0 is about 0.25;
    //  - at Stationary the matchup axis has nothing to scale at all.
    if (court === 1) {
      sitNote.textContent = 'On the spot the matchup stops counting — 1v0 and 5v5 give the same number, because a free-throw line does not get harder when fewer people stand on it. Stationary work floors at 2.0; for anything lighter than that use “My own rating”.';
    } else {
      sitNote.textContent = situation === 1
        ? '5v5 and 5v0 come out the same. The measured pair differs by 0.25 — less than this grid\u2019s own error. Use Rhythm to separate them: a non-stop 5v5 is not the same drill as one full of whistles. More than five a side \u2014 6v6 in a warm-up \u2014 is rated here too: the scale bottoms out at five, and whether it counts as contact comes from the category you file it under, not from this dial.'
        : (contact ? '' : 'Unopposed work rates about one level easier than the same drill contested.');
    }

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
      h('label', { class: 'field' }, [
        h('span', { class: 'lbl', text: 'Game situation' }),
        sitSel,
        sitNote,
      ]),
    ]),
    h('label', { class: 'field' }, [
      h('span', { class: 'lbl', text: 'Rhythm — what stops the action?' }),
      rhythmSel,
      rhythmNote,
    ]),
    readout,
  );
  paint();

  wrap.getValues = () => ({
    court, situation, rhythm, contact,
    intensity: deriveIntensity(court, situation, rhythm, contact),
  });
  return wrap;
}

function describe(court, situation, rhythm, contact) {
  const c = COURT_LEVELS.find((l) => l.value === court);
  const r = RHYTHM_LEVELS.find((l) => l.value === rhythm);
  const s = situationOption(situation, contact);
  return `${c ? c.label : ''} · ${s ? s.label : ''} · ${r ? rhythmLabel(r.value).toLowerCase() : ''}`;
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
