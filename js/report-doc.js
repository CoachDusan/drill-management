/* report-doc.js — what goes into a PDF report, as plain data.
 *
 * Kept apart from the drawing (js/pdf.js) on purpose. Everything that can be
 * wrong about a report — which practices are in it, the order the drills come
 * in, what a cell says when nothing was timed — is decided here, in plain
 * objects and strings, and tested without a PDF library. The renderer only
 * lays it out.
 *
 * The coach specified the reports himself (2026-09-12):
 *
 *   Daily    as a practice, by category
 *   Weekly   each practice on its own, or all together; by category; by drill
 *            (how many times, longest, shortest, average)
 *   Monthly  each week on its own; categories per week and for the month; by
 *            drill for the month
 *   Yearly   the same as monthly, with months instead of weeks
 *   Any dates
 *
 * and one rule for every drill list: CONTACT 5on5 FIRST, THEN OTHER CONTACT,
 * THEN NO DEFENCE — and within each, the most-used drill first. Contact first
 * because that is where the live time is, and live time is what he reads.
 *
 * The honesty rules of the app travel into the PDF unchanged: a drill nobody
 * timed is "not timed", never 0:00 live; a live figure over part of a cell is
 * starred and footnoted; practices left out by the season, phase or game-day
 * choice are named. A PDF gets handed to people who never saw the screen, so
 * it needs these more than the screen does, not less.
 */

import { formatDate, CONTACT_ROWS } from './models.js';
import { fmtMinutes, fmtDensity, orderedBlocks, blockMinutes, blockLiveMinutes } from './load.js';
import * as hist from './history.js';

/* The contact rows first, in his order, then the work with nobody defending,
   then anything that cannot be placed. */
export const MATCHUP_ORDER = [...CONTACT_ROWS.map((r) => r.key), 'noDefence', 'none', 'unknown'];

/* The same words as the rows of his weekly grid, so one PDF never calls the
   same group of drills two different things. */
export const GROUP_LABEL = {
  ...Object.fromEntries(CONTACT_ROWS.map((r) => [r.key, r.label])),
  noDefence: 'In a contact category, but no live defence',
  none: 'Not contact',
  unknown: 'Not set up yet',
};

/** Which group a drill row belongs in. A drill in no contact category at all
 *  is 'none' — the warm-ups, the shooting, the 5v0 pattern work. */
export function groupOf(row) {
  return row.contactRow || 'none';
}

/** His order for every drill list. Frequency beats minutes on purpose: he
 *  asked for "more frequently used drills before less frequently used". */
export function sortDrillRows(rows) {
  const rank = (m) => { const i = MATCHUP_ORDER.indexOf(m); return i === -1 ? MATCHUP_ORDER.length : i; };
  return rows.slice().sort((a, b) =>
    rank(groupOf(a)) - rank(groupOf(b))
    || b.runs - a.runs
    || b.minutes - a.minutes
    || String(a.name).localeCompare(String(b.name)));
}

/** Which report a period makes, and what "on its own" means for it. */
export function reportKind(period, unit) {
  if (period === 'day') return { key: 'day', title: 'Daily report', breakdown: null };
  if (period === 'week') return { key: 'week', title: 'Weekly report', breakdown: 'practice', breakdownLabel: 'Each practice on its own' };
  if (period === 'month') return { key: 'month', title: 'Monthly report', breakdown: 'week', breakdownLabel: 'Each week on its own' };
  if (period === 'year') return { key: 'year', title: 'Yearly report', breakdown: 'month', breakdownLabel: 'Each month on its own' };
  const breakdown = unit === 'day' ? 'practice' : unit;
  return {
    key: period,
    title: period === 'season' ? 'Season report' : 'Report for chosen dates',
    breakdown,
    breakdownLabel: breakdown === 'practice' ? 'Each practice on its own' : `Each ${breakdown} on its own`,
  };
}

/* ---- what a cell says ---------------------------------------------------- */

/** Two lines: full time, then live time · live %. A star marks a live figure
 *  that covers only part of the cell. */
export function cellFullLive(agg) {
  if (!agg || !agg.minutes) return '—';
  if (!agg.timedRuns) return `${fmtMinutes(agg.minutes)}\nnot timed`;
  const star = agg.liveCoverage < 0.999 ? ' *' : '';
  return `${fmtMinutes(agg.minutes)}\n${fmtMinutes(agg.liveMinutes)} · ${fmtDensity(agg.liveDensity)}${star}`;
}

/** A contact row's cell. Contact time is the second stopwatch, so it comes
 *  first; the drill time it was part of sits underneath. An untimed contact
 *  drill has no contact time — "not timed", never 0 and never its full length.
 *  A star marks contact time that covers only some of the drills. */
export function cellContact(agg) {
  if (!agg || !agg.minutes) return '—';
  if (!agg.timedRuns) return `not timed\nof ${fmtMinutes(agg.minutes)}`;
  const star = agg.liveCoverage < 0.999 ? ' *' : '';
  return `${fmtMinutes(agg.liveMinutes)}${star}\nof ${fmtMinutes(agg.minutes)}`;
}

/** The label a row carries in a PDF table: a part of a contact format is
 *  indented under its format, so "Live" never stands on its own. */
function rowLabel(row) {
  return row.level === 'part' ? `    ${row.label}` : row.label;
}

function rowStyle(row) {
  if (row.emphasis) return 'emph';
  if (row.level === 'group') return 'matchup-group';
  return row.kind === 'matchup' ? 'matchup' : 'normal';
}

function pair(full, live) {
  const f = full === null || full === undefined ? '—' : fmtMinutes(full);
  const l = live === null || live === undefined ? '—' : fmtMinutes(live);
  return `${f}\n${l}`;
}

function sumAggs(aggs) {
  const out = { minutes: 0, liveMinutes: 0, timedMinutes: 0, timedRuns: 0, runs: 0 };
  for (const a of aggs) {
    out.minutes += a.minutes; out.liveMinutes += a.liveMinutes;
    out.timedMinutes += a.timedMinutes; out.timedRuns += a.timedRuns; out.runs += a.runs;
  }
  out.liveDensity = out.timedMinutes ? out.liveMinutes / out.timedMinutes : null;
  out.liveCoverage = out.minutes ? out.timedMinutes / out.minutes : 0;
  return out;
}

/* How contact is counted, for people who never saw the app. The coach asked
   for this to be written into the PDF "in an understandable way" — it goes
   to the head coach and the medical staff, who read the number without the
   definition otherwise. */
export const CONTACT_EXPLAINED = [
  'How contact is counted: contact time is only the part of a drill with real live play against a defence, timed on a second stopwatch — a 5on5 shell drill that starts as a walk-through counts only once it goes live. In the contact rows the top line is contact time and the line under it is the full drill time. A contact drill that was not timed says “not timed”: never zero, never its full length.',
  'Three formats. 5on5 contact = Live (5on5 live drills) + Continuous (5on5on5) + Shell (5on5 shell once live). Small-sided contact = Live (small-sided live drills) + Continuous (3on3on3, 4on4on4) + Shell (1on1 closeouts, 4on4 shell once live). Transition contact = advantage games with live play. Whole contact = all of them. Live and continuous drills always count; defense and transition drills only when they go live.',
  'The contact rows are a second look at the same drills, not extra time: a live transition drill appears once in its category and once in Transition contact.',
];

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
/** "26.10." — how he writes dates himself ("26.10. till 22.12."). */
const dm = (k) => `${Number(k.slice(8, 10))}.${Number(k.slice(5, 7))}.`;

/* A column header that fits a narrow column: "Week 2" over "2.3.–8.3.", or
   "Mar". Dates are clipped to the report, so a month's first week does not
   claim days from February it never reports on. */
function columnHead(c, unit, range) {
  const from = c.from > range.from ? c.from : range.from;
  const to = c.to < range.to ? c.to : range.to;
  if (unit === 'week') return { label: `Week ${c.index || ''}`.trim(), when: from === to ? dm(from) : `${dm(from)}–${dm(to)}` };
  if (unit === 'month') return { label: new Date(`${c.from}T12:00:00`).toLocaleDateString(undefined, { month: 'short' }), when: '' };
  return { label: c.label, when: '' };
}

/* ---- tables ---------------------------------------------------------------- */

/** His weekly grid: categories and contact rows down the side, one column per
 *  day / week / month, the total, and per practice on a game-day report. */
export function categoryTable(sessions, blocks, drills, range, unit, { categories = null, perN = null, contactRows = null } = {}) {
  const t = hist.reportTable(sessions, blocks, drills, range, unit, { categories, contactRows });
  if (!t.columns.length || !t.rows.length) return null;
  const everything = sumAggs(t.columns.map((c) => c.total));
  const per = (agg, f = cellFullLive) => (perN ? [f(hist.perPractice(agg, perN))] : []);
  return {
    type: 'table',
    kind: 'category',
    columns: [
      { label: '', align: 'left', role: 'label' },
      ...t.columns.map((c) => {
        const head = columnHead(c, unit, range);
        return { label: head.label, sub: [head.when, c.gameDays.join(' · ')].filter(Boolean).join('\n'), align: 'right' };
      }),
      { label: 'Total', align: 'right', role: 'total' },
      ...(perN ? [{ label: 'Per practice', sub: `of ${perN}`, align: 'right', role: 'total' }] : []),
    ],
    rows: [
      ...t.rows.map((row, i) => {
        const f = row.kind === 'matchup' ? cellContact : cellFullLive;
        return {
          style: rowStyle(row),
          cells: [rowLabel(row), ...t.columns.map((c) => f(c.cells[i])), f(row), ...per(row, f)],
        };
      }),
      { style: 'total', cells: ['Everything', ...t.columns.map((c) => cellFullLive(c.total)), cellFullLive(everything), ...per(everything)] },
    ],
    unclassified: t.unclassified,
    noDefence: t.noDefence,
  };
}

/** A category table with no columns — for one practice or one day. */
export function simpleCategoryTable(blocks, drills, { categories = null, contactRows = null } = {}) {
  const r = hist.reportRowsFor(blocks, drills, { categories, contactRows });
  const rows = r.rows.filter((row) => row.kind === 'category' || row.minutes);
  if (!rows.length) return null;
  const line = (agg) => [
    agg.minutes ? fmtMinutes(agg.minutes) : '—',
    agg.minutes ? (agg.timedRuns ? fmtMinutes(agg.liveMinutes) : 'not timed') : '—',
    agg.minutes && agg.timedRuns ? `${fmtDensity(agg.liveDensity)}${agg.liveCoverage < 0.999 ? ' *' : ''}` : '—',
  ];
  return {
    type: 'table',
    kind: 'category-simple',
    columns: [
      { label: 'By category', align: 'left', role: 'label' },
      { label: 'Full time', align: 'right' },
      { label: 'Live time', sub: 'contact rows: contact time', align: 'right' },
      { label: 'Live %', align: 'right' },
    ],
    rows: rows.map((row) => ({
      style: rowStyle(row),
      cells: [rowLabel(row), ...line(row)],
    })),
    unclassified: r.unclassified,
    noDefence: r.noDefence,
  };
}

/** By drill, in his order, with group rows between the contact rows.
 *
 * AVERAGE AND LIVE % ARE THE TWO HE READS. They used to sit last, after the
 * total, the longest and the shortest, and he asked for them picked out
 * (2026-09-20). They now come straight after how many times the drill ran,
 * and the renderer prints those two columns in bold on a tinted background.
 * The spread is still there, to the right of them, because a drill that runs
 * 25 minutes before one game and 10 before the next is being used two ways
 * and the average hides it. */
export function drillTable(sessions, blocks, drills, range, { contactRows = null } = {}) {
  const rows = sortDrillRows(hist.drillReport(sessions, blocks, drills, range, { contactRows }));
  if (!rows.length) return null;
  const out = [];
  let group = null;
  for (const r of rows) {
    if (groupOf(r) !== group) {
      group = groupOf(r);
      out.push({ style: 'group', cells: [GROUP_LABEL[group] || GROUP_LABEL.unknown] });
    }
    out.push({
      style: 'normal',
      cells: [
        r.name,
        r.category || 'Not in the library',
        `${r.runs}${r.timedRuns < r.runs ? `\nlive on ${r.timedRuns}` : ''}`,
        pair(r.meanMinutes, r.meanLiveMinutes),
        fmtDensity(r.liveDensity),
        pair(r.minutes, r.timedRuns ? r.liveMinutes : null),
        pair(r.maxMinutes, r.maxLiveMinutes),
        pair(r.minMinutes, r.minLiveMinutes),
      ],
    });
  }
  return {
    type: 'table',
    kind: 'drill',
    columns: [
      { label: 'Drill', align: 'left', role: 'label' },
      { label: 'Category', align: 'left' },
      { label: 'Times', align: 'right' },
      { label: 'Average', sub: 'full / live', align: 'right', emph: true },
      { label: 'Live %', align: 'right', emph: true },
      { label: 'Total', sub: 'full / live', align: 'right' },
      { label: 'Longest', sub: 'full / live', align: 'right' },
      { label: 'Shortest', sub: 'full / live', align: 'right' },
    ],
    rows: out,
  };
}

/** One practice as it ran: the running order, then its categories.
 *
 * No row number and no group column (2026-09-20): the rows are already in the
 * order the drills ran, and a number counting them adds nothing he cannot
 * see. The group is a courtside fact — which half of the squad was on which
 * basket — and it is not what the report is for. Live time is the column he
 * reads, so it is printed in bold. */
export function practiceSheet(session, blocks, drills, { categories = null, contactRows = null } = {}) {
  const list = orderedBlocks(blocks.filter((b) => b.sessionId === session.id));
  const total = hist.aggregate(list);
  const table = {
    type: 'table',
    kind: 'practice',
    columns: [
      { label: 'Drill', align: 'left', role: 'label' },
      { label: 'Category', align: 'left' },
      { label: 'Full time', align: 'right' },
      { label: 'Live time', align: 'right', emph: true },
      { label: 'Live %', align: 'right' },
    ],
    rows: [
      ...list.map((b) => {
        const live = blockLiveMinutes(b);
        const mins = blockMinutes(b);
        return {
          style: 'normal',
          cells: [
            b.note ? `${b.drillName}\n${b.note}` : b.drillName,
            hist.categoryLabelOf(b, drills),
            fmtMinutes(mins),
            live === null ? 'not timed' : fmtMinutes(live),
            live === null || !mins ? '—' : fmtDensity(Math.min(1, live / mins)),
          ],
        };
      }),
      {
        style: 'total',
        cells: ['Total', '', fmtMinutes(total.minutes),
          total.timedRuns ? fmtMinutes(total.liveMinutes) : '—',
          total.timedRuns ? `${fmtDensity(total.liveDensity)}${total.liveCoverage < 0.999 ? ' *' : ''}` : '—'],
      },
    ],
  };
  return {
    heading: formatDate(session.date),
    sub: [session.gameDay || 'No game-day label', session.label, session.type && session.type !== 'Practice' ? session.type : null]
      .filter(Boolean).join(' · '),
    blocks: list.length
      ? [table, simpleCategoryTable(list, drills, { categories, contactRows })].filter(Boolean)
      : [{ type: 'note', text: 'No drills were recorded in this practice.' }],
  };
}

/* ---- the whole report ---------------------------------------------------- */

function byDateThenStart(a, b) {
  return a.date.localeCompare(b.date) || String(a.startedAt || a.createdAt || '').localeCompare(String(b.startedAt || b.createdAt || ''));
}

/**
 * `sessions` are already narrowed by season, phase and game day, exactly as
 * the screen narrows them. `notes` carries what the screen said about the
 * practices it left out, so the PDF says it too.
 */
export function buildReportDoc({
  period, unit, range, sessions, blocks, drills = [], categories = null,
  scopeLabel = null, gameDay = null, perN = null, notes = [], contactRows = null,
  include = { categories: true, drills: true }, breakdown = false, title = null,
}) {
  const kind = reportKind(period, unit);
  const inRange = sessions.filter((s) => s.date >= range.from && s.date <= range.to).sort(byDateThenStart);
  const ids = new Set(inRange.map((s) => s.id));
  const rangeBlocks = blocks.filter((b) => ids.has(b.sessionId));
  const totals = hist.aggregate(rangeBlocks);
  const bands = hist.reportRowsFor(rangeBlocks, drills, { categories, contactRows });
  const bandRow = (key) => bands.rows.find((r) => r.key === key) || { minutes: 0, timedRuns: 0 };
  const c5 = bandRow('band:c5Live');
  const whole = bandRow('band:whole');
  const n = inRange.length;

  /* THE HEADING IS HIS TO WRITE. A week in a team sport is not Monday to
     Sunday — it runs from one game to the next — so a report over chosen
     dates may well be his weekly report, and calling it "Report for chosen
     dates" makes it look like something else. `title` is whatever he typed;
     without it the period names the report as before. */
  const heading = (title && String(title).trim())
    ? String(title).trim()
    : (gameDay ? `${kind.title} · ${gameDay}` : kind.title);

  /* The tiles, in the order he reads them. On a daily report the practice
     count is dropped — "I know it is only 1" — and contact takes its place.
     Contact is every contact row added up; 5on5 live is the whole-squad row,
     under the name he calls it. */
  const tiles = [
    ...(kind.key === 'day' && n === 1 ? [] : [
      { label: 'Practices', value: String(n), note: `${plural(totals.runs, 'drill run')}` }]),
    { label: 'Court time', value: fmtMinutes(totals.minutes),
      note: perN ? `${fmtMinutes(totals.minutes / perN)} per practice` : 'every drill, full time' },
    { label: 'Live time', value: totals.timedRuns ? fmtMinutes(totals.liveMinutes) : '—',
      note: totals.timedRuns
        ? `${fmtDensity(totals.liveDensity)} live · ${Math.round(totals.liveCoverage * 100)}% of court time timed`
        : 'second stopwatch not used' },
    // Kept short on purpose: five tiles across a landscape page leave room
    // for one line, and a note that runs off the tile reads as a mistake.
    // Contact time is the second stopwatch on the contact drills.
    { label: 'Contact', value: whole.timedRuns ? fmtMinutes(whole.liveMinutes) : '—',
      note: !whole.minutes ? 'no contact drills'
        : !whole.timedRuns ? `not timed · ${fmtMinutes(whole.minutes)} drills`
          : `live part of ${fmtMinutes(whole.minutes)}${whole.liveCoverage < 0.999 ? ' *' : ''}` },
    { label: '5on5 live', value: c5.timedRuns ? fmtMinutes(c5.liveMinutes) : '—',
      note: !c5.minutes ? 'none in these dates'
        : !c5.timedRuns ? `not timed · ${fmtMinutes(c5.minutes)} drills`
          : `live part of ${fmtMinutes(c5.minutes)}${c5.liveCoverage < 0.999 ? ' *' : ''}` },
  ];

  const doc = {
    title: heading,
    subtitle: range.label,
    kind: kind.key,
    badges: [scopeLabel, gameDay ? `${gameDay} only` : null, plural(n, 'practice')].filter(Boolean),
    tiles,
    sections: [],
    footnotes: [],
    fileName: `${heading.replace(/[\\/:*?"<>|]/g, '-')} ${range.from}${range.to !== range.from ? ` to ${range.to}` : ''}.pdf`,
  };

  if (!totals.runs) {
    doc.sections.push({ heading: 'Nothing recorded', blocks: [{ type: 'note', text: 'No drills were recorded in these dates.' }] });
    doc.footnotes.push(...notes);
    return doc;
  }

  if (kind.key === 'day') {
    for (const s of inRange) doc.sections.push(practiceSheet(s, blocks, drills, { categories, contactRows }));
    if (inRange.length > 1 && include.categories) {
      const t = simpleCategoryTable(rangeBlocks, drills, { categories, contactRows });
      if (t) doc.sections.push({ heading: 'The whole day, by category', blocks: [t] });
    }
  } else {
    if (include.categories) {
      const t = categoryTable(inRange, blocks, drills, range, unit, { categories, perN, contactRows });
      if (t) doc.sections.push({
        heading: 'By category',
        sub: `One column per ${unit}. Each cell: full time, then live time · live %.`,
        blocks: [t],
      });
    }
    if (include.drills) {
      const t = drillTable(inRange, blocks, drills, range, { contactRows });
      if (t) doc.sections.push({
        heading: 'By drill',
        sub: 'Contact first, then the rest — most-used first within each. Average and live % are picked out.',
        blocks: [t],
      });
    }

    if (breakdown && kind.breakdown === 'practice') {
      inRange.forEach((s, i) => doc.sections.push({ ...practiceSheet(s, blocks, drills, { categories, contactRows }), pageBreak: i === 0 }));
    } else if (breakdown && (kind.breakdown === 'week' || kind.breakdown === 'month')) {
      const subUnit = kind.breakdown === 'week' ? 'day' : 'week';
      for (const col of hist.columnsFor(range, kind.breakdown)) {
        const sub = {
          from: col.from > range.from ? col.from : range.from,
          to: col.to < range.to ? col.to : range.to,
        };
        const subSessions = inRange.filter((s) => s.date >= sub.from && s.date <= sub.to);
        // An empty week keeps its column in the month table — a week off is a
        // fact about the month — but gets no page of its own.
        if (!subSessions.length) continue;
        sub.label = kind.breakdown === 'week' && col.index
          ? `Week ${col.index} · ${dm(sub.from)}–${dm(sub.to)}`
          : kind.breakdown === 'month'
            ? new Date(`${sub.from}T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
            : `${dm(sub.from)}–${dm(sub.to)}`;
        doc.sections.push({
          heading: sub.label,
          sub: plural(subSessions.length, 'practice'),
          pageBreak: true,
          blocks: [
            categoryTable(subSessions, blocks, drills, sub, subUnit, { categories, contactRows, perN: perN ? subSessions.length : null }),
            drillTable(subSessions, blocks, drills, sub, { contactRows }),
          ].filter(Boolean),
        });
      }
    }
  }

  /* ---- footnotes: what someone who never saw the screen needs to know ---- */
  const text = JSON.stringify(doc.sections);
  doc.footnotes.push('Full time is the drill stopwatch. Live time is the second stopwatch, where it was run; live % is live time over the time that was timed.');
  if (text.indexOf(' *') !== -1 || JSON.stringify(tiles).indexOf(' *') !== -1) {
    doc.footnotes.push('* This live or contact figure covers only the drills that were timed. Untimed work is not 0% live and not zero contact — it was not measured.');
  }
  if (whole.minutes || include.categories) doc.footnotes.push(...CONTACT_EXPLAINED);
  if (bands.noDefence.runs) {
    doc.footnotes.push(`${plural(bands.noDefence.runs, 'drill run')} (${fmtMinutes(bands.noDefence.minutes)}) are shell or transition drills recorded with no live defence, so they are not in the contact rows.`);
  }
  if (bands.unclassified.runs) {
    doc.footnotes.push(`${plural(bands.unclassified.runs, 'drill run')} (${fmtMinutes(bands.unclassified.minutes)}) are missing from the contact rows: the app cannot tell which category they belong to.`);
  }
  if (text.indexOf(hist.NOT_SET_UP) !== -1) {
    doc.footnotes.push(`“${hist.NOT_SET_UP}” marks drills added during practice whose details have not been filled in yet.`);
  }
  if (perN) {
    doc.footnotes.push(`“Per practice” divides by every ${gameDay || ''} practice in these dates, including ones that did not use that row.`.replace('  ', ' '));
  }
  doc.footnotes.push(...notes.filter(Boolean));
  return doc;
}
