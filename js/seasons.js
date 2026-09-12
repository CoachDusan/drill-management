/* seasons.js — which season and which phase a practice belongs to.
 *
 * The coach asked (2026-09-12) for Preseason / Inseason / Offseason with dates
 * he can set and change, and a season he can pick — 2026/2027 now, 2027/2028
 * next year, starting empty, with this season's practices still there.
 *
 * A SEASON IS A SET OF DATES, NOT A SEPARATE DATABASE. Every practice belongs
 * wherever its date falls. That is what makes the dates changeable: move the
 * start of Inseason and every practice re-sorts, with nothing to migrate and
 * nothing that can fall out of step. Picking next season simply shows next
 * season's dates, which are empty until he trains in them.
 *
 * This is deliberately the opposite of the game-day decision, and the reason
 * is worth keeping. Game day is a fact about ONE practice that he knows before
 * he walks in, so it is set by hand on that practice. A phase boundary is ONE
 * date that labels hundreds of practices, and he wants to be able to move it.
 *
 * Stored under the `seasons` meta key:
 *   { id, label: '2026/2027',
 *     start:     '2026-08-01',   preseason begins (required)
 *     inseason:  '2026-09-21',   or null — not reached yet
 *     offseason: null,           or a date
 *     end:       null }          or a date; blank runs until the next season
 *
 * Pure functions only. No database, no DOM.
 */

import { addDays, toDateKey } from './models.js';

export const PHASES = [
  { key: 'preseason', label: 'Preseason' },
  { key: 'inseason',  label: 'Inseason' },
  { key: 'offseason', label: 'Offseason' },
];

export function phaseLabel(key) {
  if (key === 'all') return 'Whole season';
  const p = PHASES.find((x) => x.key === key);
  return p ? p.label : '';
}

/** "2026/2027" for a season starting in the second half of 2026. */
export function suggestLabel(dateKey) {
  const y = Number(dateKey.slice(0, 4));
  const m = Number(dateKey.slice(5, 7));
  return m >= 7 ? `${y}/${y + 1}` : `${y - 1}/${y}`;
}

export function sortSeasons(seasons) {
  return [...(seasons || [])].sort((a, b) => a.start.localeCompare(b.start));
}

/** The last day of a season: its own end, else the day before the next one
 *  starts, else null — open, still running. */
export function seasonEnd(season, seasons) {
  if (season.end) return season.end;
  const next = sortSeasons(seasons).find((s) => s.start > season.start);
  return next ? addDays(next.start, -1) : null;
}

export function seasonFor(seasons, dateKey) {
  return sortSeasons(seasons).find((s) => {
    const end = seasonEnd(s, seasons);
    return s.start <= dateKey && (end === null || dateKey <= end);
  }) || null;
}

/** 'preseason' | 'inseason' | 'offseason', or null outside the season. */
export function phaseOn(season, dateKey, seasons) {
  if (!season || dateKey < season.start) return null;
  const end = seasonEnd(season, seasons);
  if (end !== null && dateKey > end) return null;
  if (season.offseason && dateKey >= season.offseason) return 'offseason';
  if (season.inseason && dateKey >= season.inseason) return 'inseason';
  return 'preseason';
}

/**
 * The dates a phase covers, or the whole season for 'all'. `to` is null when
 * the phase is still open. Returns null for a phase that has no start date
 * yet — Inseason before he has said when it begins is not an empty range,
 * it is not a range at all, and the screen says so.
 */
export function phaseRange(season, phase, seasons) {
  if (!season) return null;
  const end = seasonEnd(season, seasons);
  if (phase === 'all') return { from: season.start, to: end };
  if (phase === 'preseason') {
    const next = season.inseason || season.offseason;
    return { from: season.start, to: next ? addDays(next, -1) : end };
  }
  if (phase === 'inseason') {
    if (!season.inseason) return null;
    return { from: season.inseason, to: season.offseason ? addDays(season.offseason, -1) : end };
  }
  if (phase === 'offseason') {
    if (!season.offseason) return null;
    return { from: season.offseason, to: end };
  }
  return null;
}

export function inRange(range, dateKey) {
  return !!range && dateKey >= range.from && (range.to === null || dateKey <= range.to);
}

/** An open range made concrete for a report: runs to today, or to the last
 *  practice if one is dated ahead of today. */
export function closeRange(range, sessions = [], today = toDateKey(new Date())) {
  if (!range) return null;
  if (range.to !== null) return range;
  const last = sessions.map((s) => s.date).filter((d) => d >= range.from).sort().pop();
  const to = [today, last || today, range.from].sort().pop();
  return { ...range, to };
}

/** Which season the screens show: the one he picked, else the one today is
 *  in, else the most recent. Null only when no season is set up. */
export function viewedSeason(seasons, pickedId, today = toDateKey(new Date())) {
  if (!seasons || !seasons.length) return null;
  return seasons.find((s) => s.id === pickedId)
    || seasonFor(seasons, today)
    || sortSeasons(seasons).pop();
}

/** Every problem with a season as he typed it, in his words. Empty = fine. */
export function validateSeason(candidate, others = []) {
  const errors = [];
  const c = candidate;
  if (!c.label || !c.label.trim()) errors.push('Give the season a name, e.g. 2026/2027.');
  if (!c.start) errors.push('Preseason needs a start date.');
  if (others.some((o) => o.id !== c.id && o.label.trim().toLowerCase() === String(c.label || '').trim().toLowerCase())) {
    errors.push(`There is already a season called ${c.label}.`);
  }
  if (!c.start) return errors;
  if (c.inseason && c.inseason < c.start) errors.push('Inseason cannot start before preseason.');
  if (c.offseason && c.offseason < (c.inseason || c.start)) errors.push('Offseason cannot start before inseason.');
  const last = [c.start, c.inseason, c.offseason].filter(Boolean).sort().pop();
  if (c.end && c.end < last) errors.push('The season cannot end before its last phase starts.');

  const all = sortSeasons([...others.filter((o) => o.id !== c.id), c]);
  for (let i = 0; i < all.length - 1; i++) {
    const a = all[i], b = all[i + 1];
    if (a.start === b.start) errors.push(`${a.label} and ${b.label} start on the same day.`);
    else if (a.end && a.end >= b.start) errors.push(`${a.label} ends after ${b.label} has started — they would overlap.`);
    else if ((a.offseason || a.inseason) && [a.inseason, a.offseason].filter(Boolean).some((d) => d >= b.start)) {
      errors.push(`${a.label} has a phase starting after ${b.label} begins.`);
    }
  }
  return [...new Set(errors)];
}

/** Practices no season claims. Reported, never silently dropped. */
export function outsideEverySeason(sessions, seasons) {
  if (!seasons || !seasons.length) return [];
  return sessions.filter((s) => !seasonFor(seasons, s.date));
}
