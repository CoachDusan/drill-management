/* views/reports.js — "how much of what did we do, between these two dates?"
 *
 * The Analysis tab answers load questions: is this week heavy, is every day
 * the same, who is carrying the most. This tab answers PLANNING questions,
 * which are the ones the coach actually asked for after a fortnight on the
 * tablet:
 *
 *   How much defence did we do this week, and on which day?
 *   How much whole-squad contact, full time and live time?
 *   This drill — how many times, how long, and how long before a game?
 *
 * Three things shape the whole screen.
 *
 * FULL TIME AND LIVE TIME TOGETHER, EVERYWHERE. He runs the second stopwatch
 * mainly on live and scrimmage work, which is exactly the work he plans a
 * week around. "25 min full, 15 min live" is his own sentence, from his own
 * table. A percentage alone cannot be planned with; minutes alone cannot
 * compare a 40-minute scrimmage with a 10-minute one.
 *
 * CALENDAR PERIODS, NOT ROLLING WINDOWS. Analysis asks about the last 28
 * days. This asks about October. Different question, different screen.
 *
 * COVERAGE TRAVELS WITH EVERY LIVE FIGURE. A live percentage is over the
 * drills he timed, never over the whole cell, and every cell that is short
 * says so rather than letting the number speak for itself.
 */

import * as db from '../db.js';
import { toDateKey, addDays, MATCHUP_BANDS } from '../models.js';
import { fmtMinutes, fmtLoad, fmtDensity } from '../load.js';
import * as hist from '../history.js';
import { h, mount, emptyState, toast, openModal, field } from '../ui.js';

let rootEl = null;

/* Screen state. Deliberately module-level and not in the URL: he taps between
   periods constantly and a hash change per tap would fill the back stack. */
let period = 'week';
let anchor = toDateKey(new Date());
let custom = null;                       // { from, to } once he picks dates
let drillQuery = '';
let openDrill = null;                    // which drill's game-day split is open

export function teardown() {}

export async function render(root) {
  rootEl = root;

  const [sessions, blocks, drills, categories] = await Promise.all([
    db.getAll(db.STORES.sessions),
    db.getAll(db.STORES.blocks),
    db.getAll(db.STORES.drills),
    db.getMeta('categories', null),
  ]);

  const head = h('div', { class: 'page-head' }, [
    h('div', {}, [
      h('h1', { text: 'Reports' }),
      h('p', { class: 'sub', style: { margin: '2px 0 0' },
        text: 'Minutes by category and by drill, over dates you choose. Full time and live time side by side.' }),
    ]),
  ]);

  if (!sessions.length || !blocks.length) {
    mount(root, head, emptyState('🗓', 'Nothing to report yet',
      'Run a practice or two with the stopwatch and this becomes the week-by-week picture of what you actually did.'));
    return;
  }

  const range = hist.periodRange(period, anchor, custom);
  const unit = period === 'custom' ? customUnit(range) : hist.columnUnitFor(period);
  const table = hist.reportTable(sessions, blocks, drills, range, unit, {
    categories: categories && categories.length ? categories : null,
  });
  const inRange = sessions.filter((s) => s.date >= range.from && s.date <= range.to);
  const rangeBlocks = blocks.filter((b) => inRange.some((s) => s.id === b.sessionId));
  const totals = hist.aggregate(rangeBlocks);
  const perDrill = hist.drillReport(sessions, blocks, drills, range);

  mount(root,
    head,
    periodBar(),
    rangeHeading(range, inRange),
    totalsPanel(totals, inRange),
    tablePanel(table),
    unclassifiedNote(table.unclassified),
    drillPanel(perDrill),
  );
}

/* ---- choosing the stretch of dates -------------------------------------- */

function periodBar() {
  return h('div', {}, [
    h('div', { class: 'util' }, hist.REPORT_PERIODS.map((p) => h('button', {
      class: p.key === period ? 'btn btn-sm btn-primary' : 'btn btn-sm',
      onclick: () => {
        period = p.key;
        if (p.key === 'custom' && !custom) return pickDates();
        render(rootEl);
      },
    }, p.label))),

    period === 'custom' ? null : h('div', { class: 'btn-row', style: { margin: '10px 0 4px' } }, [
      h('button', { class: 'btn btn-sm', onclick: () => { anchor = step(-1); render(rootEl); } }, '‹ Earlier'),
      h('button', { class: 'btn btn-sm', onclick: () => { anchor = toDateKey(new Date()); render(rootEl); } }, 'Today'),
      h('button', { class: 'btn btn-sm', onclick: () => { anchor = step(1); render(rootEl); } }, 'Later ›'),
    ]),

    period === 'custom' ? h('div', { class: 'btn-row', style: { margin: '10px 0 4px' } }, [
      h('button', { class: 'btn btn-sm', onclick: () => pickDates() }, custom ? 'Change dates' : 'Pick dates'),
    ]) : null,
  ]);
}

/** One period back or forward from the anchor. */
function step(dir) {
  if (period === 'day') return addDays(anchor, dir);
  if (period === 'week') return addDays(hist.startOfWeek(anchor), 7 * dir);
  if (period === 'month') {
    const first = hist.startOfMonth(anchor);
    return dir > 0 ? addDays(hist.endOfMonth(first), 1) : hist.startOfMonth(addDays(first, -1));
  }
  const y = Number(anchor.slice(0, 4)) + dir;
  return `${y}-01-01`;
}

/* A long custom range gets weekly columns, a short one daily columns. Past
   about a fortnight the day columns stop fitting on a tablet and stop being
   the question he is asking anyway. */
function customUnit(range) {
  const days = hist.daysBetween(range.from, range.to);
  if (days <= 16) return 'day';
  if (days <= 130) return 'week';
  return 'month';
}

async function pickDates() {
  const today = toDateKey(new Date());
  const start = (custom && custom.from) || addDays(today, -27);
  const end = (custom && custom.to) || today;

  const result = await openModal('Report from … till …', (body, done) => {
    const from = h('input', { type: 'date', value: start });
    const to = h('input', { type: 'date', value: end });
    body.append(
      h('p', { class: 'tiny', style: { marginTop: 0 } },
        'Any stretch of dates. Both ends are included.'),
      h('div', { class: 'form-row' }, [field('From', from), field('Till', to)]),
    );
    return () => {
      if (!from.value || !to.value) { toast('Pick both dates'); return; }
      done({ from: from.value, to: to.value });
    };
  }, { confirmLabel: 'Show it' });

  if (!result) { if (!custom) period = 'week'; return render(rootEl); }
  custom = result;
  period = 'custom';
  await render(rootEl);
}

function rangeHeading(range, sessions) {
  const labelled = sessions.filter((s) => s.gameDay).length;
  return h('div', { style: { margin: '14px 0 12px' } }, [
    h('h2', { style: { margin: '0 0 2px' }, text: range.label }),
    h('div', { class: 'tiny', text: sessions.length
      ? `${sessions.length} session${sessions.length === 1 ? '' : 's'}${labelled < sessions.length
        ? ` · ${sessions.length - labelled} with no game-week label`
        : ''}`
      : 'Nothing recorded in these dates' }),
  ]);
}

/* ---- the top line -------------------------------------------------------- */

function totalsPanel(t, sessions) {
  if (!t.runs) {
    return h('div', { class: 'note' },
      'No drills recorded between these dates. Step back a period, or choose different dates.');
  }
  return h('div', {}, [
    h('div', { class: 'grid four' }, [
      h('div', { class: 'stat' }, [
        h('div', { class: 'k', text: 'Court time' }),
        h('div', { class: 'v', text: fmtMinutes(t.minutes) }),
        h('div', { class: 'n', text: `${t.runs} drill run${t.runs === 1 ? '' : 's'} across ${sessions.length} session${sessions.length === 1 ? '' : 's'}` }),
      ]),
      h('div', { class: 'stat' }, [
        h('div', { class: 'k', text: 'Live time' }),
        h('div', { class: 'v', text: t.timedRuns ? fmtMinutes(t.liveMinutes) : '—' }),
        h('div', { class: 'n', text: t.timedRuns
          ? `${fmtDensity(t.liveDensity)} of the ${fmtMinutes(t.timedMinutes)} you timed`
          : 'you did not run the second stopwatch in these dates' }),
      ]),
      h('div', { class: 'stat' }, [
        h('div', { class: 'k', text: 'Live coverage' }),
        h('div', { class: 'v', text: `${Math.round(t.liveCoverage * 100)}%` }),
        h('div', { class: 'n', text: `${t.timedRuns} of ${t.runs} runs timed` }),
      ]),
      h('div', { class: 'stat' }, [
        h('div', { class: 'k', text: 'Load' }),
        h('div', { class: 'v' }, [fmtLoad(t.load), h('span', { class: 'u', text: 'AU' })]),
        h('div', { class: 'n', text: t.unratedRuns
          ? `${t.unratedRuns} run${t.unratedRuns === 1 ? '' : 's'} unrated — incomplete, not light`
          : 'every run rated' }),
      ]),
    ]),

    /* Said out loud rather than left in a percentage. A live density measured
       on a third of the work is not the period's live density. */
    t.runs && t.liveCoverage < 0.999 ? h('div', { class: 'note warn', style: { marginTop: '12px' } }, [
      h('strong', { text: `Live time covers ${Math.round(t.liveCoverage * 100)}% of these dates. ` }),
      `Every live figure below is for the ${t.timedRuns} run${t.timedRuns === 1 ? '' : 's'} you timed, not for the whole period. The rest were not measured, which is not the same as being 0% live.`,
    ]) : null,
  ]);
}

/* ---- the table he drew --------------------------------------------------- */

function tablePanel(table) {
  if (!table.columns.length) return null;

  const unitWord = table.unit === 'day' ? 'day' : table.unit === 'week' ? 'week' : 'month';

  return h('div', { style: { marginTop: '22px' } }, [
    h('h2', { text: 'By category' }),
    h('p', { class: 'tiny', style: { margin: '-6px 0 10px' } },
      `One column per ${unitWord}. Each cell is total drill time, with the live time underneath where you ran the second watch.`),

    h('div', { class: 'table-wrap' }, [
      h('table', { class: 'report' }, [
        h('thead', {}, h('tr', {}, [
          h('th', { text: '' }),
          ...table.columns.map((c) => h('th', {}, [
            h('div', { text: c.label }),
            c.gameDays.length
              ? h('div', { class: 'th-sub', text: c.gameDays.join(' · ') })
              : h('div', { class: 'th-sub', text: '—' }),
          ])),
          h('th', { class: 'num', text: 'Total' }),
        ])),
        h('tbody', {}, table.rows.map((row, i) => h('tr', {
          class: row.emphasis ? 'emph' : '',
        }, [
          h('td', {}, [
            h('div', { class: 'name', text: row.label }),
            row.kind === 'matchup'
              ? h('div', { class: 'th-sub', text: matchupNote(row) })
              : null,
          ]),
          ...table.columns.map((c) => cell(c.cells[i])),
          cell(row, true),
        ]))),
        h('tfoot', {}, h('tr', {}, [
          h('td', { text: 'Everything' }),
          ...table.columns.map((c) => cell(c.total)),
          h('td', { class: 'num' }, cellText(sumOf(table.columns.map((c) => c.total)))),
        ])),
      ]),
    ]),

    h('p', { class: 'tiny', style: { marginTop: '8px' } },
      'Contact rows come from the matchup on the drill, not from its category, so a drill appears in one category row and one contact row. “Whole contact” is the two contact rows added together — it is not a third bucket.'),
  ]);
}

function matchupNote(row) {
  if (row.key === 'band:whole') return 'Contact 5on5 + smaller, added';
  const b = MATCHUP_BANDS.find((x) => `band:${x.key}` === row.key);
  return b ? b.note : '';
}

function sumOf(aggs) {
  const out = { minutes: 0, liveMinutes: 0, timedMinutes: 0, timedRuns: 0, runs: 0 };
  for (const a of aggs) {
    out.minutes += a.minutes; out.liveMinutes += a.liveMinutes;
    out.timedMinutes += a.timedMinutes; out.timedRuns += a.timedRuns; out.runs += a.runs;
  }
  out.liveDensity = out.timedMinutes ? out.liveMinutes / out.timedMinutes : null;
  out.liveCoverage = out.minutes ? out.timedMinutes / out.minutes : 0;
  return out;
}

function cell(agg, isTotal = false) {
  return h('td', { class: isTotal ? 'num total-col' : 'num' }, cellText(agg));
}

/** The two lines of one cell: total time, then live time where it exists. */
function cellText(agg) {
  if (!agg || !agg.minutes) return h('span', { class: 'muted', text: '—' });
  const lines = [h('div', { text: fmtMinutes(agg.minutes) })];
  if (agg.timedRuns) {
    lines.push(h('div', { class: 'live-line',
      text: `${fmtMinutes(agg.liveMinutes)} live · ${fmtDensity(agg.liveDensity)}` }));
    // Where the live figure only covers part of the cell, the percentage is
    // of the timed part — so say what the timed part was.
    if (agg.liveCoverage < 0.999) {
      lines.push(h('div', { class: 'th-sub', text: `timed on ${fmtMinutes(agg.timedMinutes)}` }));
    }
  } else {
    lines.push(h('div', { class: 'th-sub', text: 'not timed' }));
  }
  return h('div', {}, lines);
}

function unclassifiedNote(u) {
  if (!u || !u.runs) return null;
  return h('div', { class: 'note warn' }, [
    h('strong', { text: `${u.runs} run${u.runs === 1 ? '' : 's'} (${fmtMinutes(u.minutes)}) are missing from the contact rows. ` }),
    'The app cannot tell whether they were contested. Usually that is a drill added during practice and not set up yet — open it in Drills, set the matchup, and these runs are counted from then on. Otherwise it is an old run whose drill has been deleted. They still count in the totals.',
  ]);
}

/* ---- drill by drill ------------------------------------------------------
 *
 * His own worked example: "5on5, HC+2 — 5 times in the selected time.
 * Maximum 25/12.5, minimum 15/8, average 20/10. Then GD-1: 3 times, same
 * again." The spread matters more than the average: a drill that runs 25
 * minutes before one game and 10 before the next is being used two different
 * ways, and the mean hides it.
 */
function drillPanel(rows) {
  if (!rows.length) return null;

  /* Typing repaints the LIST, never the screen. Re-rendering the whole page on
     every keystroke destroyed the search box he was typing in, so the keyboard
     closed and the page jumped back to the top after each letter. */
  const list = h('div', { class: 'list', style: { marginTop: '12px' } });
  function paint() {
    const q = drillQuery.toLowerCase();
    const matches = rows.filter((r) => !q || `${r.name} ${r.category || ''}`.toLowerCase().includes(q));
    mount(list, matches.length
      ? matches.map((r) => drillCard(r, paint))
      : [h('div', { class: 'tiny', style: { padding: '14px' }, text: 'No drill matches that.' })]);
  }
  paint();

  return h('div', { style: { marginTop: '26px' } }, [
    h('h2', { text: 'By drill' }),
    h('p', { class: 'tiny', style: { margin: '-6px 0 10px' } },
      'How often each drill ran in these dates, how long it ran, and how much of that was live. Tap one to split it by day before the game.'),
    h('input', {
      type: 'search', placeholder: 'Search drills or categories…', value: drillQuery,
      oninput: (e) => { drillQuery = e.target.value; paint(); },
    }),
    list,
  ]);
}

function drillCard(r, repaint) {
  const open = openDrill === r.key;
  return h('div', { class: 'card', style: { marginBottom: 0 } }, [
    h('div', {
      class: 'card-head clickable',
      style: { cursor: 'pointer' },
      onclick: () => { openDrill = open ? null : r.key; repaint(); },
    }, [
      h('div', { style: { minWidth: 0 } }, [
        h('div', { class: 'name', style: { fontWeight: '650' }, text: r.name }),
        h('div', { class: 'tiny', text: [
          r.category || 'Not in the library',
          `${r.runs} time${r.runs === 1 ? '' : 's'}`,
          `${fmtMinutes(r.minutes)} in total`,
        ].join(' · ') }),
      ]),
      h('span', { class: 'tiny', text: open ? '▾' : '▸', style: { fontSize: '18px' } }),
    ]),

    spreadTable(r),

    open ? h('div', { style: { marginTop: '14px' } }, [
      h('h3', { style: { fontSize: '14px', margin: '0 0 8px' }, text: 'Split by day before the game' }),
      r.byGameDay.length > 1
        ? h('div', {}, r.byGameDay.map((g) => h('div', { style: { marginBottom: '12px' } }, [
          h('div', { class: 'tiny', style: { fontWeight: '650', marginBottom: '4px' },
            text: `${g.label} — ${g.runs} time${g.runs === 1 ? '' : 's'}` }),
          spreadTable(g),
        ])))
        : h('div', { class: 'note' },
          `Every run of this drill in these dates carries the same label (${r.byGameDay[0] ? r.byGameDay[0].label : '—'}), so there is nothing to compare it against yet.`),
    ]) : null,
  ]);
}

/** Longest, shortest, average — full time and live time side by side. */
function spreadTable(s) {
  return h('div', { class: 'table-wrap', style: { marginTop: '10px' } }, [
    h('table', {}, [
      h('thead', {}, h('tr', {}, [
        h('th', { text: '' }),
        h('th', { class: 'num', text: 'Full time' }),
        h('th', { class: 'num', text: 'Live time' }),
        h('th', { class: 'num', text: 'Live %' }),
      ])),
      h('tbody', {}, [
        spreadRow('Longest', s.maxMinutes, s.maxLiveMinutes),
        spreadRow('Shortest', s.minMinutes, s.minLiveMinutes),
        spreadRow('Average', s.meanMinutes, s.meanLiveMinutes),
        h('tr', {}, [
          h('td', { text: 'Total' }),
          h('td', { class: 'num', text: fmtMinutes(s.minutes) }),
          h('td', { class: 'num', text: s.timedRuns ? fmtMinutes(s.liveMinutes) : '—' }),
          h('td', { class: 'num', text: fmtDensity(s.liveDensity) }),
        ]),
      ]),
    ]),
    /* The live figures are over the runs he timed, and the count has to sit
       beside them: a shortest-live of 0:00 for a drill he simply did not
       time on one day would be a lie the same shape as a real number. */
    s.timedRuns < s.runs ? h('div', { class: 'tiny', style: { marginTop: '6px' } },
      s.timedRuns
        ? `Live figures are from the ${s.timedRuns} of ${s.runs} runs you timed.`
        : `None of these ${s.runs} runs were timed, so there is no live figure.`) : null,
  ]);
}

function spreadRow(label, mins, live) {
  const density = (mins && live !== null && live !== undefined) ? live / mins : null;
  return h('tr', {}, [
    h('td', { text: label }),
    h('td', { class: 'num', text: mins === null ? '—' : fmtMinutes(mins) }),
    h('td', { class: 'num', text: (live === null || live === undefined) ? '—' : fmtMinutes(live) }),
    h('td', { class: 'num', text: density === null ? '—' : fmtDensity(density) }),
  ]);
}
