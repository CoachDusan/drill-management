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
import { toDateKey, addDays, MATCHUP_BANDS, formatDate } from '../models.js';
import { fmtMinutes, fmtLoad, fmtDensity } from '../load.js';
import * as hist from '../history.js';
import * as seasonsLib from '../seasons.js';
import { h, mount, emptyState, toast, openModal, field } from '../ui.js';

let rootEl = null;

/* Screen state. Deliberately module-level and not in the URL: he taps between
   periods constantly and a hash change per tap would fill the back stack. */
let period = 'week';
let anchor = toDateKey(new Date());
let custom = null;                       // { from, to } once he picks dates
let drillQuery = '';
let openDrill = null;                    // which drill's game-day split is open
let phase = null;                        // 'all' | 'preseason' | 'inseason' | 'offseason'; remembered
let gameDayFilter = null;                // null = all days, else 'GD-6' … 'GD-1'

export function teardown() {}

export async function render(root) {
  rootEl = root;

  const [allSessions, blocks, drills, categories, seasonList, pickedSeason, savedPhase] = await Promise.all([
    db.getAll(db.STORES.sessions),
    db.getAll(db.STORES.blocks),
    db.getAll(db.STORES.drills),
    db.getMeta('categories', null),
    db.getMeta('seasons', []),
    db.getMeta('viewSeasonId', null),
    db.getMeta('reportPhase', null),
  ]);

  /* SEASON AND PHASE COME FIRST, then the period inside them. "Only inseason
     practices count" is his rule, so a week that straddles 21.9 shows only
     its inseason days — and says how many practices it left out. With no
     season set up, everything counts exactly as it always did. */
  const season = seasonsLib.viewedSeason(seasonList, pickedSeason);
  if (phase === null) phase = savedPhase || defaultPhase(season, seasonList);
  if (season && !seasonsLib.phaseRange(season, phase, seasonList)) phase = 'all';
  const scope = season ? seasonsLib.phaseRange(season, phase, seasonList) : null;
  const sessions = season ? allSessions.filter((s) => seasonsLib.inRange(scope, s.date)) : allSessions;
  if (!season && period === 'season') period = 'week';

  const head = h('div', { class: 'page-head' }, [
    h('div', {}, [
      h('h1', { text: 'Reports' }),
      h('p', { class: 'sub', style: { margin: '2px 0 0' },
        text: 'Minutes by category and by drill, over dates you choose. Full time and live time side by side.' }),
    ]),
  ]);

  if (!allSessions.length || !blocks.length) {
    mount(root, head, emptyState('🗓', 'Nothing to report yet',
      'Run a practice or two with the stopwatch and this becomes the week-by-week picture of what you actually did.'));
    return;
  }

  const range = period === 'season'
    ? { ...seasonsLib.closeRange(scope, sessions), period, label: `${season.label} · ${seasonsLib.phaseLabel(phase)}` }
    : hist.periodRange(period, anchor, custom);
  const unit = (period === 'custom' || period === 'season') ? customUnit(range) : hist.columnUnitFor(period);
  /* THE GAME-DAY FILTER COMES LAST: season and phase, then the period, then
     which day before the game. Counts on the buttons are for the dates on
     screen, so he sees how many practices a GD-1 picture stands on before he
     taps it. */
  const periodSessions = sessions.filter((s) => s.date >= range.from && s.date <= range.to);
  const gdCounts = hist.gameDayCounts(periodSessions);
  const shown = gameDayFilter ? sessions.filter((s) => s.gameDay === gameDayFilter) : sessions;

  const table = hist.reportTable(shown, blocks, drills, range, unit, {
    categories: categories && categories.length ? categories : null,
  });
  const inRange = shown.filter((s) => s.date >= range.from && s.date <= range.to);
  const rangeBlocks = blocks.filter((b) => inRange.some((s) => s.id === b.sessionId));
  const totals = hist.aggregate(rangeBlocks);
  const perDrill = hist.drillReport(shown, blocks, drills, range);
  // Only a game-day report averages per practice: "what does a GD-1 look
  // like" is the question. A plain week is read as totals, as before.
  const perN = gameDayFilter ? inRange.length : null;

  const leftOut = season
    ? allSessions.filter((s) => s.date >= range.from && s.date <= range.to && !seasonsLib.inRange(scope, s.date))
    : [];

  mount(root,
    head,
    scopeBar(season, seasonList),
    periodBar(season, gdCounts, range),
    rangeHeading(range, inRange, gdCounts),
    leftOutNote(leftOut, season, seasonList),
    totalsPanel(totals, inRange, perN),
    tablePanel(table, perN),
    unclassifiedNote(table.unclassified),
    drillPanel(perDrill),
  );
}

/* ---- choosing the stretch of dates -------------------------------------- */

function defaultPhase(season, list) {
  // He reports inseason. Once inseason has started, that is where the screen
  // opens; before it has, there is nothing to show there yet.
  if (!season || !season.inseason) return 'all';
  return toDateKey(new Date()) >= season.inseason ? 'inseason' : 'all';
}

function scopeBar(season, list) {
  if (!season) {
    return h('div', { class: 'note', style: { marginBottom: '12px' } }, [
      h('strong', { text: 'No season set up — every practice is included. ' }),
      'Set the season and its Preseason / Inseason dates on the Practice screen, and reports can show one phase at a time.',
    ]);
  }
  return h('div', { style: { marginBottom: '10px' } }, [
    h('div', { class: 'util' }, [
      list.length > 1
        ? h('select', {
          style: { width: 'auto', minHeight: '40px' },
          onchange: async (e) => { await db.setMeta('viewSeasonId', e.target.value); render(rootEl); },
        }, seasonsLib.sortSeasons(list).reverse().map((sea) =>
          h('option', { value: sea.id, selected: sea.id === season.id }, sea.label)))
        : h('span', { class: 'chip on', style: { alignSelf: 'center' }, text: season.label }),
      ...['all', 'preseason', 'inseason', 'offseason'].map((k) => {
        const r = seasonsLib.phaseRange(season, k, list);
        return h('button', {
          class: k === phase ? 'btn btn-sm btn-primary' : 'btn btn-sm',
          disabled: !r,
          title: r ? '' : 'No start date yet — set it on the Practice screen',
          onclick: async () => { phase = k; await db.setMeta('reportPhase', k); render(rootEl); },
        }, r ? seasonsLib.phaseLabel(k) : `${seasonsLib.phaseLabel(k)} · no date`);
      }),
    ]),
  ]);
}

/* Said out loud: a week that looks light may simply be half preseason. */
function leftOutNote(leftOut, season, list) {
  if (!leftOut.length) return null;
  const byPhase = new Map();
  for (const s of leftOut) {
    const sea = seasonsLib.seasonFor(list, s.date);
    const key = sea ? `${seasonsLib.phaseLabel(seasonsLib.phaseOn(sea, s.date, list))}${sea.id === season.id ? '' : ` ${sea.label}`}` : 'outside every season';
    byPhase.set(key, (byPhase.get(key) || 0) + 1);
  }
  return h('div', { class: 'note', style: { marginBottom: '12px' } }, [
    h('strong', { text: `${seasonsLib.phaseLabel(phase)} only. ` }),
    `${leftOut.length} practice${leftOut.length === 1 ? '' : 's'} in these dates ${leftOut.length === 1 ? 'is' : 'are'} left out (${[...byPhase.entries()].map(([k, n]) => `${n} ${k}`).join(', ')}).`,
  ]);
}

function periodBar(season, gdCounts, range) {
  return h('div', {}, [
    h('div', { class: 'util' }, hist.REPORT_PERIODS.filter((p) => p.key !== 'season' || season).map((p) => h('button', {
      class: p.key === period ? 'btn btn-sm btn-primary' : 'btn btn-sm',
      onclick: () => {
        period = p.key;
        if (p.key === 'custom' && !custom) return pickDates();
        render(rootEl);
      },
    }, p.label))),

    gameDayBar(gdCounts, range),

    (period === 'custom' || period === 'season') ? null : h('div', { class: 'btn-row', style: { margin: '10px 0 4px' } }, [
      h('button', { class: 'btn btn-sm', onclick: () => { anchor = step(-1); render(rootEl); } }, '‹ Earlier'),
      h('button', { class: 'btn btn-sm', onclick: () => { anchor = toDateKey(new Date()); render(rootEl); } }, 'Today'),
      h('button', { class: 'btn btn-sm', onclick: () => { anchor = step(1); render(rootEl); } }, 'Later ›'),
    ]),

    period === 'custom' ? h('div', { class: 'btn-row', style: { margin: '10px 0 4px' } }, [
      h('button', { class: 'btn btn-sm', onclick: () => pickDates() }, custom ? 'Change dates' : 'Pick dates'),
    ]) : null,
  ]);
}

/* His second row: the day before the game, with how many practices each has
   in the dates on screen. When one is picked, the from–till it covers sits
   right under it with a way to change it — "GD-1, from … till …". */
function gameDayBar(counts, range) {
  const btn = (key, label) => h('button', {
    class: key === gameDayFilter ? 'btn btn-sm btn-primary' : 'btn btn-sm',
    onclick: () => { gameDayFilter = key; render(rootEl); },
  }, label);
  return h('div', { style: { marginTop: '8px' } }, [
    h('div', { class: 'util' }, [
      btn(null, 'All days'),
      ...hist.REPORT_GAME_DAYS.map((g) => btn(g, `${g} · ${counts[g] || 0}`)),
    ]),
    gameDayFilter ? h('div', { class: 'btn-row', style: { margin: '8px 0 0', alignItems: 'center' } }, [
      h('span', { class: 'tiny', text: `${gameDayFilter} practices from ${formatDate(range.from, { weekday: false })} till ${formatDate(range.to, { weekday: false })}` }),
      h('button', { class: 'btn btn-sm', onclick: () => pickDates() }, 'Change dates'),
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

function rangeHeading(range, sessions, counts) {
  if (gameDayFilter) {
    const n = sessions.length;
    return h('div', { style: { margin: '14px 0 12px' } }, [
      h('h2', { style: { margin: '0 0 2px' }, text: `${gameDayFilter} · ${range.label}` }),
      h('div', { class: 'tiny', text: n
        ? `Taken from ${n} practice${n === 1 ? '' : 's'}${n < 3 ? ' — too few to call it a pattern yet' : ''}`
        : `No ${gameDayFilter} practices in these dates` }),
      // Unlabelled practices cannot be reached by any game-day filter, and a
      // GD-1 count that is short because of them must say so.
      counts.unset ? h('div', { class: 'tiny', style: { color: 'var(--watch)' },
        text: `${counts.unset} practice${counts.unset === 1 ? ' has' : 's have'} no game-day label in these dates and cannot be included. Label them from the session summary.` }) : null,
    ]);
  }
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

function totalsPanel(t, sessions, perN = null) {
  if (!t.runs) {
    return h('div', { class: 'note' },
      'No drills recorded between these dates. Step back a period, or choose different dates.');
  }
  return h('div', {}, [
    h('div', { class: 'grid four' }, [
      h('div', { class: 'stat' }, [
        h('div', { class: 'k', text: 'Court time' }),
        h('div', { class: 'v', text: fmtMinutes(t.minutes) }),
        h('div', { class: 'n', text: perN
          ? `${fmtMinutes(t.minutes / perN)} per practice, across ${perN}`
          : `${t.runs} drill run${t.runs === 1 ? '' : 's'} across ${sessions.length} session${sessions.length === 1 ? '' : 's'}` }),
      ]),
      h('div', { class: 'stat' }, [
        h('div', { class: 'k', text: 'Live time' }),
        h('div', { class: 'v', text: t.timedRuns ? fmtMinutes(t.liveMinutes) : '—' }),
        h('div', { class: 'n', text: t.timedRuns
          ? `${perN ? `${fmtMinutes(t.liveMinutes / perN)} per practice · ` : ''}${fmtDensity(t.liveDensity)} of the ${fmtMinutes(t.timedMinutes)} you timed`
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

function tablePanel(table, perN = null) {
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
          perN ? h('th', { class: 'num', text: 'Per practice' }) : null,
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
          perN ? cell(hist.perPractice(row, perN), true) : null,
        ]))),
        h('tfoot', {}, h('tr', {}, [
          h('td', { text: 'Everything' }),
          ...table.columns.map((c) => cell(c.total)),
          h('td', { class: 'num' }, cellText(sumOf(table.columns.map((c) => c.total)))),
          perN ? h('td', { class: 'num' }, cellText(hist.perPractice(sumOf(table.columns.map((c) => c.total)), perN))) : null,
        ])),
      ]),
    ]),

    h('p', { class: 'tiny', style: { marginTop: '8px' } },
      'Contact rows come from the matchup on the drill, not from its category, so a drill appears in one category row and one contact row. “Whole contact” is the two contact rows added together — it is not a third bucket.'),
    perN ? h('p', { class: 'tiny' },
      `“Per practice” divides by all ${perN} ${gameDayFilter} practice${perN === 1 ? '' : 's'} in these dates — including the ones that did not use that row. A category you skipped on one of them counts as zero there, which is how much of it a ${gameDayFilter} really has.`) : null,
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
