/* views/analysis.js — what the drills are doing to the squad, over time.
 *
 * The unit of this screen is the DRILL and the DAY, not the session. That is
 * the coach's own framing: he plans a week by choosing drills and by deciding
 * what a day two days out from a game should look like. A list of sessions
 * answers neither question.
 *
 * Order on the screen is the order he asks the questions in:
 *   1. Is this week heavy?                     — the week strip
 *   2. What does my week before a game look like? — game days
 *   3. Where is that load coming from?         — categories, then drills
 *   4. Who is carrying it?                     — the squad
 *
 * Every total on this screen can be incomplete, because an unrated drill
 * contributes no load. Coverage therefore travels with the numbers rather than
 * living in a footnote: a week that is 30% unrated is not a light week, and
 * the difference is the whole point of the app.
 */

import * as db from '../db.js';
import * as seasonsLib from '../seasons.js';
import { h, mount, emptyState, openModal } from '../ui.js';
import { TISSUE, formatDate, GAME_DAY_ORDER, toDateKey } from '../models.js';
import {
  fmtLoad, fmtMinutes, fmtRatio, fmtDensity,
  acwrSeries, monotonySeries, acwrFlag, monotonyFlag, provisionalNote,
  blockMinutes, blockLoad, blockLiveDensity,
} from '../load.js';
import * as hist from '../history.js';

let rootEl = null;
let rangeKey = '4w';        // survives a re-render, resets when the app reloads
let selectedGD = 'GD-1';    // which game day the category breakdown is showing

export async function render(root) {
  rootEl = root;

  const [sessions, blocks, players, drills, seasonList] = await Promise.all([
    db.getAll(db.STORES.sessions),
    db.getAll(db.STORES.blocks),
    db.getAll(db.STORES.players),
    db.getAll(db.STORES.drills),
    db.getMeta('seasons', []),
  ]);
  /* Analysis is about NOW, so "Season" is the season today is in — not the
     one Reports happens to be showing. Outside every season it falls back to
     all history, as before seasons existed. */
  const currentSeason = seasonsLib.seasonFor(seasonList, toDateKey(new Date()));
  const seasonFrom = currentSeason ? currentSeason.start : null;

  const head = h('div', { class: 'page-head' }, [
    h('div', {}, [
      h('h1', { text: 'Analysis' }),
      h('p', { class: 'sub', style: { margin: '2px 0 0' }, text: 'Prescribed load. Arbitrary units — only ever compared against your own.' }),
    ]),
  ]);

  if (!sessions.length || !blocks.length) {
    mount(root, head, emptyState('📈', 'Nothing recorded yet',
      'Once you have run a practice or two with the stopwatch, this is where the weekly picture, your game-day pattern and your drill totals will appear.'));
    return;
  }

  /* The maths runs on the WHOLE season, not on the visible window. ACWR and
     monotony both count backwards from a day, so a 4-week view computed on
     4 weeks of series would think the season started a month ago. Compute
     once over everything, then slice for display. */
  const seasonRange = hist.rangeFor(sessions, 'season');
  const seasonDays = hist.dayRollups(sessions, blocks, seasonRange);
  const acwr = acwrSeries(hist.loadSeries(seasonDays));
  const monotony = monotonySeries(hist.loadSeries(seasonDays));

  const range = hist.rangeFor(sessions, rangeKey, undefined, seasonFrom);
  const days = seasonDays.filter((d) => d.date >= range.from && d.date <= range.to);

  const windowBlocks = days.flatMap((d) => d.blocks);
  const windowSessions = sessions.filter((s) => s.date >= range.from && s.date <= range.to);
  const rolls = hist.drillRollups(windowSessions, windowBlocks, drills);
  const cov = hist.windowCoverage(days);
  const rollups = hist.sessionRollups(windowSessions, windowBlocks, drills);

  /* Week / month / season averages are computed over EVERYTHING, not over the
     visible window: the whole point is checking a drill's recent behaviour
     against its own longer history, so the window must not clip it. */
  const winByKey = new Map(
    hist.drillWindowAverages(sessions, blocks, drills, undefined, seasonFrom).map((w) => [w.key, w.windows]));
  rolls.forEach((r) => { r.windows = winByKey.get(r.key) || null; });

  mount(root,
    head,
    rangeBar(),
    weekPanel(days, acwr, monotony, cov),
    coverageNote(cov),
    gameWeekPanel(rollups),
    categoryByGameDayPanel(rollups),
    categoryPanel(rolls),
    drillPanel(rolls),
    squadPanel(windowSessions, windowBlocks, players, range, days),
  );
}

/* ---- range switcher ---------------------------------------------------- */

function rangeBar() {
  return h('div', { class: 'util' }, hist.RANGES.map((r) => h('button', {
    class: r.key === rangeKey ? 'btn btn-sm btn-primary' : 'btn btn-sm',
    onclick: () => { rangeKey = r.key; render(rootEl); },
  }, r.label)));
}

/* ---- 1. the week ------------------------------------------------------- */

function weekPanel(days, acwr, monotony, cov) {
  const cmp = hist.comparePeriods(days, 7);
  const today = acwr[acwr.length - 1] || {};
  const mono = monotony[monotony.length - 1] || {};

  const stats = h('div', { class: 'grid four' }, [
    h('div', { class: 'stat' }, [
      h('div', { class: 'k', text: 'Last 7 days' }),
      h('div', { class: 'v' }, [fmtLoad(cmp ? cmp.load : 0), h('span', { class: 'u', text: 'AU' })]),
      h('div', { class: 'n', text: cmp && cmp.change !== null
        ? `${cmp.change > 0 ? '+' : ''}${Math.round(cmp.change)}% vs the week before`
        : 'no earlier week to compare' }),
    ]),
    h('div', { class: 'stat' }, [
      h('div', { class: 'k', text: 'Training days' }),
      h('div', { class: 'v', text: String(cmp ? cmp.trainingDays : 0) }),
      h('div', { class: 'n', text: `of the last 7 · ${Math.round((cmp ? cmp.minutes : 0))} min on court` }),
    ]),
    monotonyStat(mono),
    acwrStat(today),
  ]);

  return h('div', {}, [
    stats,
    h('h3', { style: { marginTop: '18px' }, text: 'Day by day' }),
    dayChart(days),
  ]);
}

function monotonyStat(mono) {
  const flag = monotonyFlag(mono.monotony);
  return h('div', { class: 'stat' }, [
    h('div', { class: 'k', text: 'Monotony' }),
    h('div', { class: 'v', text: fmtRatio(mono.monotony) }),
    h('span', { class: `flag ${flag.level}`, text: flag.text }),
  ]);
}

/**
 * The acute:chronic ratio, with an early reading before 28 days of history.
 *
 * Showing it early was asked for deliberately. It is marked provisional every
 * time it appears rather than once underneath, and it stays blank for the
 * first week — not out of caution but because the acute and chronic windows
 * are literally the same days then, so the answer can only be 1.00.
 */
function acwrStat(today) {
  const real = today.acwr;
  const prov = today.provisional;
  const value = real !== null && real !== undefined ? real : prov;
  const flag = acwrFlag(value);
  const note = provisionalNote(today.daysOfHistory || 0);

  return h('div', { class: 'stat' }, [
    h('div', { class: 'k' }, [
      'Acute:chronic',
      (real === null || real === undefined) && value != null
        ? h('span', { class: 'chip', style: { marginLeft: '6px' }, text: 'provisional' })
        : null,
    ]),
    h('div', { class: 'v', style: (real === null || real === undefined) ? { opacity: '.72' } : {} },
      value == null ? '—' : fmtRatio(value)),
    value == null
      ? h('div', { class: 'n', text: note || 'Not enough history yet' })
      : h('span', { class: `flag ${flag.level}`, text: flag.text }),
    (value != null && note) ? h('div', { class: 'n', text: note }) : null,
  ]);
}

/** One bar per day, or per week once the window is too long to read. */
function dayChart(days) {
  const weekly = days.length > 70;
  const points = weekly ? toWeeks(days) : days.map((d) => ({
    key: d.date,
    label: formatDate(d.date),
    load: d.load,
    isGame: d.types.includes('Game'),
    sub: d.drillCount
      ? `${d.drillCount} drill${d.drillCount === 1 ? '' : 's'} · ${Math.round(d.minutes)} min${d.coverage < 1 ? ` · ${Math.round((1 - d.coverage) * 100)}% unrated` : ''}`
      : 'rest day',
    partial: d.coverage < 1,
  }));

  const max = Math.max(1, ...points.map((p) => p.load));
  const readout = h('div', { class: 'tiny', style: { minHeight: '18px', marginTop: '6px' } },
    weekly ? 'Each bar is one week. Tap for the total.' : 'Tap a bar for that day. Bars with a stripe have unrated drills in them.');

  const chart = h('div', { class: 'chart' }, points.map((p) => {
    const bar = h('div', {
      class: `bar${p.isGame ? ' game' : ''}${p.partial ? ' partial' : ''}${p.load ? '' : ' zero'}`,
      style: { height: `${p.load ? Math.max(2, (p.load / max) * 100) : 0}%` },
      title: `${p.label} — ${fmtLoad(p.load)} AU`,
      onclick: () => {
        readout.textContent = `${p.label} — ${fmtLoad(p.load)} AU · ${p.sub}${p.isGame ? ' · GAME' : ''}`;
      },
    });
    return h('div', { class: 'bar-slot' }, [bar]);
  }));

  return h('div', { class: 'card tight' }, [
    chart,
    h('div', { class: 'chart-axis' }, [
      h('span', { text: formatDate(points[0].key, { weekday: false }) }),
      h('span', { class: 'spacer' }),
      h('span', { text: formatDate(points[points.length - 1].key, { weekday: false }) }),
    ]),
    readout,
  ]);
}

function toWeeks(days) {
  const out = [];
  for (let i = 0; i < days.length; i += 7) {
    const chunk = days.slice(i, i + 7);
    out.push({
      key: chunk[0].date,
      label: `Week of ${formatDate(chunk[0].date, { weekday: false })}`,
      load: chunk.reduce((s, d) => s + d.load, 0),
      isGame: chunk.some((d) => d.types.includes('Game')),
      sub: `${chunk.filter((d) => d.drillCount).length} training days`,
      partial: chunk.some((d) => d.coverage < 1),
    });
  }
  return out;
}

function coverageNote(cov) {
  if (cov.fraction >= 0.999) return null;
  const missing = Math.round((1 - cov.fraction) * 100);
  return h('div', { class: 'note warn', style: { marginTop: '14px' } }, [
    h('strong', { text: `${missing}% of this window's court time has no intensity behind it. ` }),
    `${cov.unratedRuns} drill run${cov.unratedRuns === 1 ? '' : 's'} still need rating, so every load total on this screen is `,
    h('strong', { text: 'incomplete, not low' }),
    '. Rate them from the Practice tab and these numbers will fill in.',
  ]);
}

/* ---- 2. the game week ---------------------------------------------------
 *
 * Three questions, in the order he asked them:
 *   how long is a GD-1, compared to every other GD-1?   (the comparison table)
 *   where does that time go?                            (categories, below)
 *   and is any of it drifting?                          (the drill windows)
 *
 * The label is his, set when the practice starts. An earlier version derived
 * it from recorded games plus a list of upcoming fixtures; that could only
 * label the past without the second list, and gave two sources of truth for
 * one fact he already knows.
 */

function gameWeekPanel(rollups) {
  const wrap = h('div', { style: { marginTop: '22px' } });
  wrap.append(h('h3', { text: 'The game week' }));

  const cov = hist.gameDayCoverage(rollups);
  const buckets = hist.gameWeekComparison(rollups);

  if (!buckets.length) {
    wrap.append(h('div', { class: 'note' }, [
      h('strong', { text: 'No practice in this window is marked with a game day yet. ' }),
      'Set it when you start a practice, or open a finished one and tap Set game day. Once two practices share a label, every GD-1 of the season can be compared against each other.',
    ]));
    if (cov.unset) {
      wrap.append(h('p', { class: 'tiny', style: { marginTop: '8px' } },
        `${cov.unset} practice${cov.unset === 1 ? '' : 's'} in this window ${cov.unset === 1 ? 'is' : 'are'} waiting for one.`));
    }
    return wrap;
  }

  const maxMin = Math.max(1, ...buckets.map((b) => b.meanMinutes || 0));

  wrap.append(h('p', { class: 'tiny', style: { marginTop: 0 } },
    'Averaged per practice. GD-X is left out on purpose — there is no game week to compare it against.'));

  wrap.append(h('div', { class: 'table-wrap' }, [
    h('table', {}, [
      h('thead', {}, h('tr', {}, [
        h('th', { text: 'Day' }),
        h('th', { text: 'Average length' }),
        h('th', { class: 'num', text: 'Min' }),
        h('th', { class: 'num', text: 'Range' }),
        h('th', { class: 'num', text: 'Live' }),
        h('th', { class: 'num', text: 'AU' }),
        h('th', { class: 'num', text: 'Drills' }),
        h('th', { class: 'num', text: 'Sessions' }),
      ])),
      h('tbody', {}, buckets.map((b) => h('tr', {
        class: 'clickable',
        title: `Every ${b.label} in this window`,
        onclick: () => openGameDay(b),
      }, [
        h('td', {}, [h('strong', { text: b.label })]),
        h('td', {}, [
          h('div', { class: 'meter' }, [
            h('div', { class: `meter-fill${b.key === 'GD' ? ' game' : ''}`, style: { width: `${((b.meanMinutes || 0) / maxMin) * 100}%` } }),
          ]),
        ]),
        h('td', { class: 'num', text: b.meanMinutes == null ? '—' : String(Math.round(b.meanMinutes)) }),
        h('td', { class: 'num tiny', text: b.n > 1 ? `${Math.round(b.minMinutes)}–${Math.round(b.maxMinutes)}` : '—' }),
        h('td', { class: 'num' }, [
          fmtDensity(b.liveDensity),
          b.liveDensity != null && b.liveCoverage < 0.999
            ? h('div', { class: 'tiny', text: `of ${Math.round(b.liveCoverage * 100)}%` })
            : null,
        ]),
        h('td', { class: 'num', text: fmtLoad(b.meanLoad) }),
        h('td', { class: 'num', text: b.meanDrills == null ? '—' : b.meanDrills.toFixed(1) }),
        h('td', { class: 'num' }, [
          String(b.n),
          b.n < 3 ? h('div', { class: 'tiny', text: 'few' }) : null,
        ]),
      ]))),
    ]),
  ]));

  /* A GD row with nothing clocked reads as 0 AU, and 0 next to a 384 AU GD-3
     says games are free. They are the heaviest day of the week. Nobody runs a
     stopwatch on a game, so the app genuinely does not know what one cost and
     has to say so rather than let the row speak. */
  const gdRow = buckets.find((b) => b.key === 'GD' && (b.meanLoad || 0) < 1);
  if (gdRow) {
    wrap.append(h('div', { class: 'note warn', style: { marginTop: '10px' } }, [
      h('strong', { text: 'Game day shows 0 because nothing was clocked in it. ' }),
      'That is not what a game costs — it is almost certainly the heaviest day of the week. Everything on this screen counts training only, so weekly totals, monotony and the acute:chronic ratio all exclude games. Compare training against training, not against the zero.',
    ]));
  }

  const thin = buckets.filter((b) => b.n < 3);
  if (thin.length) {
    wrap.append(h('div', { class: 'note', style: { marginTop: '10px' } }, [
      h('strong', { text: `${thin.map((b) => b.label).join(', ')} ${thin.length === 1 ? 'is' : 'are'} built on fewer than three practices. ` }),
      'That is not a pattern yet. The row is there so you can watch it fill up.',
    ]));
  }

  if (cov.unset) {
    wrap.append(h('div', { class: 'note warn', style: { marginTop: '10px' } }, [
      h('strong', { text: `${cov.unset} practice${cov.unset === 1 ? '' : 's'} in this window ${cov.unset === 1 ? 'has' : 'have'} no game day set. ` }),
      'They are missing from every row above, so these averages are drawn on part of the picture. Open a practice and tap Set game day to include it.',
    ]));
  }

  if (cov.excluded) {
    wrap.append(h('p', { class: 'tiny', style: { marginTop: '8px' } },
      `${cov.excluded} practice${cov.excluded === 1 ? '' : 's'} marked GD-X ${cov.excluded === 1 ? 'is' : 'are'} left out of this table, as you asked. They still count everywhere else on this screen.`));
  }

  wrap.append(h('p', { class: 'tiny', style: { marginTop: '8px' } },
    'Length is clocked drill time — the total of the stopwatches, not wall clock. When practice splits into groups two clocks run at once, so it can exceed how long you were in the gym. Live % is pooled across the practices and covers only the drills you timed.'));

  return wrap;
}

/** Every practice behind one game-day row. */
function openGameDay(bucket) {
  return openModal(`Every ${bucket.label}`, (body) => {
    body.append(
      h('div', { class: 'grid three', style: { marginBottom: '14px' } }, [
        h('div', { class: 'stat' }, [
          h('div', { class: 'k', text: 'Average length' }),
          h('div', { class: 'v', text: bucket.meanMinutes == null ? '—' : String(Math.round(bucket.meanMinutes)) }),
          h('div', { class: 'n', text: bucket.sdMinutes == null ? `from ${bucket.n} practice${bucket.n === 1 ? '' : 's'}` : `minutes, give or take ${Math.round(bucket.sdMinutes)}` }),
        ]),
        h('div', { class: 'stat' }, [
          h('div', { class: 'k', text: 'Average load' }),
          h('div', { class: 'v' }, [fmtLoad(bucket.meanLoad), h('span', { class: 'u', text: 'AU' })]),
          h('div', { class: 'n', text: bucket.n > 1 ? `${fmtLoad(bucket.minLoad)}–${fmtLoad(bucket.maxLoad)} across them` : 'one practice so far' }),
        ]),
        h('div', { class: 'stat' }, [
          h('div', { class: 'k', text: 'Live' }),
          h('div', { class: 'v', text: fmtDensity(bucket.liveDensity) }),
          h('div', { class: 'n', text: bucket.liveDensity == null ? 'nothing timed yet' : `measured over ${Math.round(bucket.liveCoverage * 100)}% of the time` }),
        ]),
      ]),
      h('div', { class: 'table-wrap' }, [
        h('table', {}, [
          h('thead', {}, h('tr', {}, [
            h('th', { text: 'Date' }), h('th', { text: 'Practice' }),
            h('th', { class: 'num', text: 'Min' }), h('th', { class: 'num', text: 'Drills' }),
            h('th', { class: 'num', text: 'Live' }), h('th', { class: 'num', text: 'AU' }),
          ])),
          h('tbody', {}, bucket.sessions.map((r) => h('tr', {}, [
            h('td', { text: formatDate(r.date) }),
            h('td', { class: 'tiny', text: r.session.label || r.session.type }),
            h('td', { class: 'num', text: String(Math.round(r.minutes)) }),
            h('td', { class: 'num', text: String(r.runs) }),
            h('td', { class: 'num', text: fmtDensity(r.liveDensity) }),
            h('td', { class: 'num', text: fmtLoad(r.load) }),
          ]))),
        ]),
      ]),
    );
    return null;
  }, { cancelLabel: 'Close', wide: true });
}

/* ---- 2b. what a game day is made of ------------------------------------- */

function categoryByGameDayPanel(rollups) {
  const available = GAME_DAY_ORDER.filter((k) => rollups.some((r) => r.gameDay === k));
  if (!available.length) return null;
  if (!available.includes(selectedGD)) selectedGD = available[available.length - 1];

  const data = hist.categoryByGameDay(rollups, selectedGD);
  const maxMin = Math.max(1, ...data.categories.map((c) => c.meanMinutes));

  return h('div', { style: { marginTop: '22px' } }, [
    h('h3', { text: 'What a game day is made of' }),
    h('div', { class: 'util' }, available.map((k) => h('button', {
      class: k === selectedGD ? 'btn btn-sm btn-primary' : 'btn btn-sm',
      onclick: () => { selectedGD = k; render(rootEl); },
    }, k))),
    h('p', { class: 'tiny', style: { marginTop: 0 } },
      `Averaged across ${data.sessions} ${selectedGD} practice${data.sessions === 1 ? '' : 's'}. Minutes are per practice — a category you skip on some of them averages lower, which is the honest answer to "how much of this do I actually do".`),
    h('div', { class: 'table-wrap' }, [
      h('table', {}, [
        h('thead', {}, h('tr', {}, [
          h('th', { text: 'Category' }),
          h('th', { text: 'Average time' }),
          h('th', { class: 'num', text: 'Min' }),
          h('th', { class: 'num', text: 'Per run' }),
          h('th', { class: 'num', text: 'Live' }),
          h('th', { class: 'num', text: 'AU' }),
          h('th', { class: 'num', text: 'Used in' }),
        ])),
        h('tbody', {}, data.categories.map((c) => h('tr', {}, [
          h('td', { text: c.category }),
          h('td', {}, [
            h('div', { class: 'meter' }, [
              h('div', { class: 'meter-fill', style: { width: `${(c.meanMinutes / maxMin) * 100}%` } }),
            ]),
          ]),
          h('td', { class: 'num', text: c.meanMinutes.toFixed(1) }),
          h('td', { class: 'num', text: c.meanRunMinutes == null ? '—' : fmtMinutes(c.meanRunMinutes) }),
          h('td', { class: 'num' }, [
            fmtDensity(c.liveDensity),
            c.liveDensity != null && c.liveCoverage < 0.999
              ? h('div', { class: 'tiny', text: `of ${Math.round(c.liveCoverage * 100)}%` })
              : null,
          ]),
          h('td', { class: 'num', text: fmtLoad(c.meanLoad) }),
          h('td', { class: 'num tiny', text: `${c.sessionsUsedIn} of ${data.sessions}` }),
        ]))),
      ]),
    ]),
    h('p', { class: 'tiny', style: { marginTop: '6px' } },
      'Live % is measured, not rated — the only observed number here — and covers only the drills you ran the second stopwatch on. A dash means none of that category was ever timed.'),
  ]);
}

/* ---- 3. where the load went --------------------------------------------- */

function categoryPanel(rolls) {
  const mix = hist.categoryMix(rolls);
  if (!mix.length) return null;
  const max = Math.max(...mix.map((c) => c.load), 1);

  return h('div', { style: { marginTop: '22px' } }, [
    h('h3', { text: 'Where the load went' }),
    h('div', { class: 'card tight' }, mix.map((c) => h('div', { class: 'mix-row' }, [
      h('div', { class: 'mix-label', text: c.category }),
      h('div', { class: 'meter' }, [
        h('div', { class: 'meter-fill', style: { width: `${(c.load / max) * 100}%` } }),
      ]),
      h('div', { class: 'mix-val nums', text: `${Math.round(c.share * 100)}%` }),
    ]))),
    h('p', { class: 'tiny', style: { marginTop: '6px' } },
      'Share of rated load. A drill run before the app knew its category shows as "Not in the library" — new runs record their own category, so that shrinks over time.'),
  ]);
}

/* ---- 4. the drills ------------------------------------------------------ */

function drillPanel(rolls) {
  if (!rolls.length) return null;

  return h('div', { style: { marginTop: '22px' } }, [
    h('h3', { text: 'Your drills' }),
    h('div', { class: 'table-wrap' }, [
      h('table', {}, [
        h('thead', {}, h('tr', {}, [
          h('th', { text: 'Drill' }),
          h('th', { class: 'num', text: 'Runs' }),
          h('th', { class: 'num', text: 'Min' }),
          h('th', { class: 'num', text: 'Avg run' }),
          h('th', { class: 'num', text: 'Int' }),
          h('th', { class: 'num', text: 'Avg AU' }),
          h('th', { class: 'num', text: 'AU' }),
          h('th', { class: 'num', text: 'Live' }),
        ])),
        h('tbody', {}, rolls.map((r) => h('tr', {
          class: 'clickable',
          title: 'Every time you have run this',
          onclick: () => openDrillHistory(r),
        }, [
          h('td', {}, [
            r.name,
            r.unratedRuns ? h('span', { class: 'chip', style: { marginLeft: '7px' }, text: `${r.unratedRuns} unrated` }) : null,
            r.category ? h('div', { class: 'tiny', text: r.category }) : null,
          ]),
          h('td', { class: 'num', text: String(r.runCount) }),
          h('td', { class: 'num', text: String(Math.round(r.minutes)) }),
          h('td', { class: 'num', text: r.meanMinutes == null ? '—' : fmtMinutes(r.meanMinutes) }),
          h('td', { class: 'num', text: r.meanIntensity == null ? '—' : r.meanIntensity.toFixed(1) }),
          h('td', { class: 'num', text: r.runCount ? fmtLoad(r.load / r.runCount) : '—' }),
          h('td', { class: 'num', text: fmtLoad(r.load) }),
          h('td', { class: 'num', text: fmtDensity(r.liveDensity) }),
        ]))),
      ]),
    ]),
    h('p', { class: 'tiny', style: { marginTop: '6px' } },
      'Sorted by how much load each drill has actually contributed. Tap one to see every run of it.'),
  ]);
}

function openDrillHistory(roll) {
  const runs = roll.runs.slice().sort((a, b) => b.date.localeCompare(a.date));

  return openModal(roll.name, (body) => {
    body.append(
      h('div', { class: 'grid three', style: { marginBottom: '14px' } }, [
        h('div', { class: 'stat' }, [
          h('div', { class: 'k', text: 'Run' }),
          h('div', { class: 'v', text: String(roll.runCount) }),
          h('div', { class: 'n', text: `times since ${formatDate(roll.firstDate, { weekday: false })}` }),
        ]),
        h('div', { class: 'stat' }, [
          h('div', { class: 'k', text: 'Average length' }),
          h('div', { class: 'v', text: roll.meanMinutes == null ? '—' : fmtMinutes(roll.meanMinutes) }),
          h('div', { class: 'n', text: roll.sdMinutes == null ? 'one run so far' : `give or take ${fmtMinutes(roll.sdMinutes)}` }),
        ]),
        h('div', { class: 'stat' }, [
          h('div', { class: 'k', text: 'Total load' }),
          h('div', { class: 'v' }, [fmtLoad(roll.load), h('span', { class: 'u', text: 'AU' })]),
          h('div', { class: 'n', text: `${Math.round(roll.minutes)} minutes of court time` }),
        ]),
      ]),

      /* The club's own repeated measurements put a drill's run-to-run spread
         at +/-0.64 intensity points. This is that same figure, for his drills,
         from his own stopwatch — and the reason the intensity formula is not
         worth refining further. */
      roll.sdIntensity != null && roll.sdIntensity > 0
        ? h('div', { class: 'note' }, [
          h('strong', { text: `This drill has been rated between ${Math.min(...roll.runs.map((r) => Number(r.block.intensity)).filter(Number.isFinite)).toFixed(1)} and ${Math.max(...roll.runs.map((r) => Number(r.block.intensity)).filter(Number.isFinite)).toFixed(1)}. ` }),
          `Run to run it varies by about ${roll.sdIntensity.toFixed(2)} points. That is normal — the same drill is not the same drill twice — and it is worth remembering before reading much into a single number.`,
        ])
        : null,

      roll.liveTimedRuns
        ? h('div', { class: 'note', style: { marginTop: '10px' } }, [
          h('strong', { text: `${fmtDensity(roll.liveDensity)} live. ` }),
          `Measured on ${roll.liveTimedRuns} of ${roll.runCount} runs with the second stopwatch — the one genuinely observed number here.`,
        ])
        : null,

      windowTable(roll),

      h('h3', { style: { marginTop: '18px' }, text: 'Every run' }),
      h('div', { class: 'table-wrap' }, [
        h('table', {}, [
          h('thead', {}, h('tr', {}, [
            h('th', { text: 'Date' }), h('th', { text: 'Group' }),
            h('th', { class: 'num', text: 'Min' }), h('th', { class: 'num', text: 'Int' }),
            h('th', { class: 'num', text: 'AU' }), h('th', { class: 'num', text: 'Live' }),
          ])),
          h('tbody', {}, runs.map(({ block, date }) => h('tr', {}, [
            h('td', {}, [
              formatDate(date),
              block.note ? h('div', { class: 'tiny', text: block.note }) : null,
            ]),
            h('td', { class: 'tiny', text: block.group || 'Team' }),
            h('td', { class: 'num', text: fmtMinutes(blockMinutes(block)) }),
            h('td', { class: 'num', text: block.intensity == null ? '—' : String(block.intensity) }),
            h('td', { class: 'num', text: blockLoad(block) === null ? '—' : fmtLoad(blockLoad(block)) }),
            h('td', { class: 'num', text: fmtDensity(blockLiveDensity(block)) }),
          ]))),
        ]),
      ]),

      movementProfile(roll),
    );
    return null;
  }, { cancelLabel: 'Close', wide: true });
}

/**
 * The same drill over three timescales, side by side rather than behind a
 * selector — the comparison IS the point. A drill that ran 12 minutes in
 * October and runs 20 now is a different drill, and a season average hides it.
 *
 * Windows are counted back from today, so a drill not run this week shows an
 * honest empty row rather than borrowing its season figures.
 */
function windowTable(roll) {
  if (!roll.windows) return null;

  return h('div', { style: { marginTop: '18px' } }, [
    h('h3', { text: 'Week, month, season' }),
    h('div', { class: 'table-wrap' }, [
      h('table', {}, [
        h('thead', {}, h('tr', {}, [
          h('th', { text: 'Window' }),
          h('th', { class: 'num', text: 'Runs' }),
          h('th', { class: 'num', text: 'Avg length' }),
          h('th', { class: 'num', text: 'Avg AU' }),
          h('th', { class: 'num', text: 'Live' }),
          h('th', { class: 'num', text: 'Total AU' }),
        ])),
        h('tbody', {}, hist.DRILL_WINDOWS.map((w) => {
          const d = roll.windows[w.key];
          const empty = !d || !d.runs;
          return h('tr', { style: empty ? { opacity: '.5' } : {} }, [
            h('td', { text: w.label }),
            h('td', { class: 'num', text: empty ? '—' : String(d.runs) }),
            h('td', { class: 'num', text: empty || d.meanMinutes == null ? '—' : fmtMinutes(d.meanMinutes) }),
            h('td', { class: 'num', text: empty || d.meanLoad == null ? '—' : fmtLoad(d.meanLoad) }),
            h('td', { class: 'num' }, empty ? '—' : [
              fmtDensity(d.liveDensity),
              d.liveDensity != null && d.liveCoverage < 0.999
                ? h('div', { class: 'tiny', text: `of ${Math.round(d.liveCoverage * 100)}%` })
                : null,
            ]),
            h('td', { class: 'num', text: empty ? '—' : fmtLoad(d.load) }),
          ]);
        })),
      ]),
    ]),
    h('p', { class: 'tiny', style: { marginTop: '6px' } },
      'Averages are per run. Live % is measured on the runs you timed only — the "of x%" underneath is how much of the drill that covers. An empty row means the drill was not run in that window.'),
  ]);
}

function movementProfile(roll) {
  const last = roll.runs[roll.runs.length - 1].block;
  const tagged = TISSUE.filter((t) => last.tissue && last.tissue[t.key] != null);
  if (!tagged.length) {
    return h('div', { class: 'note', style: { marginTop: '14px' } }, [
      h('strong', { text: 'No movement tags on this drill. ' }),
      'Its jumping, sprinting and change of direction are missing from every movement total. Tag it once in the drill library and it counts from then on.',
    ]);
  }
  return h('div', { style: { marginTop: '14px' } }, [
    h('h3', { text: 'Movement demands' }),
    h('div', { class: 'grid three' }, TISSUE.map((t) => {
      const total = roll.runs.reduce((s, r) => {
        const lvl = r.block.tissue ? r.block.tissue[t.key] : null;
        return lvl == null ? s : s + Number(lvl) * blockMinutes(r.block);
      }, 0);
      return h('div', { class: 'stat' }, [
        h('div', { class: 'k', text: t.label }),
        h('div', { class: 'v', text: Math.round(total).toLocaleString() }),
        h('div', { class: 'n', text: t.why }),
      ]);
    })),
  ]);
}

/* ---- 5. the squad -------------------------------------------------------
 *
 * Contact minutes sit beside load rather than inside it. The measured data
 * says live defence barely moves intensity, so folding it into the load number
 * would invent an effect that is not there — but contact is where the ankle
 * sprains come from, and "his contact minutes are up 80%" is a different
 * warning from "his load is up 20%".
 */

function squadPanel(sessions, blocks, players, range, days) {
  const active = players.filter((p) => p.status !== 'inactive');
  if (!active.length) return null;

  const totals = hist.playerTotals(sessions, blocks, active, range).filter((t) => t.minutes > 0);
  if (!totals.length) return null;

  const median = medianOf(totals.map((t) => t.load));
  const tissueTotals = {};
  for (const t of TISSUE) tissueTotals[t.key] = days.reduce((s, d) => s + d.tissue[t.key], 0);
  const tissueCov = days.reduce((s, d) => s + d.minutes * d.tissueCoverage, 0)
    / Math.max(1, days.reduce((s, d) => s + d.minutes, 0));

  return h('div', { style: { marginTop: '22px' } }, [
    h('h3', { text: 'The squad' }),
    h('div', { class: 'table-wrap' }, [
      h('table', {}, [
        h('thead', {}, h('tr', {}, [
          h('th', { text: 'Player' }),
          h('th', { class: 'num', text: 'AU' }),
          h('th', { class: 'num', text: 'vs squad' }),
          h('th', { class: 'num', text: 'Days' }),
          h('th', { class: 'num', text: 'Min' }),
          h('th', { class: 'num', text: 'Contact' }),
        ])),
        h('tbody', {}, totals.map((t) => {
          const rel = median > 0 ? ((t.load - median) / median) * 100 : null;
          return h('tr', {
            class: 'clickable',
            title: 'Open this player',
            onclick: () => openPlayer(t, range, median),
          }, [
            h('td', { text: `${t.player.number ? `#${t.player.number} ` : ''}${t.player.name}` }),
            h('td', { class: 'num', text: fmtLoad(t.load) }),
            h('td', { class: 'num', text: rel == null ? '—' : `${rel > 0 ? '+' : ''}${Math.round(rel)}%` }),
            h('td', { class: 'num', text: String(t.daysTrained) }),
            h('td', { class: 'num', text: String(Math.round(t.minutes)) }),
            h('td', { class: 'num', text: `${Math.round(t.contactMinutes)}` }),
          ]);
        })),
      ]),
    ]),
    h('p', { class: 'tiny', style: { marginTop: '6px' } },
      'Compared against the squad median, not the average, so one player doing double does not move everyone else. Contact is minutes in contested work — counted separately from load on purpose, because it is where collisions and awkward landings come from.'),

    h('h3', { style: { marginTop: '18px' }, text: 'Movement across the squad' }),
    h('div', { class: 'grid three' }, TISSUE.map((t) => h('div', { class: 'stat' }, [
      h('div', { class: 'k', text: t.label }),
      h('div', { class: 'v', text: Math.round(tissueTotals[t.key]).toLocaleString() }),
      h('div', { class: 'n', text: t.why }),
    ]))),
    /* Both notes, always. The coverage warning used to REPLACE the units
       caveat, which removed the caveat at exactly the moment the totals
       deserved it least. */
    tissueCov < 0.999
      ? h('div', { class: 'note warn', style: { marginTop: '10px' } }, [
        h('strong', { text: `${Math.round((1 - tissueCov) * 100)}% of this window is not in those movement totals. ` }),
        'Those drills have no movement tags, so their jumping, sprinting and change of direction are missing entirely. Tag them in the drill library.',
      ])
      : null,
    h('p', { class: 'tiny', style: { marginTop: '6px' } },
      'Each score is level x minutes. The units are arbitrary and are NOT comparable between tissues — a jump score of 400 and a sprint score of 400 do not mean the same amount of anything. Each is only ever compared against itself over time.'),
  ]);
}

function medianOf(values) {
  const v = values.slice().sort((a, b) => a - b);
  if (!v.length) return 0;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

function openPlayer(total, range, median) {
  const p = total.player;
  const acwr = acwrSeries(total.series.map((d) => ({ date: d.date, load: d.load })));
  const today = acwr[acwr.length - 1] || {};
  const mono = monotonySeries(total.series.map((d) => ({ date: d.date, load: d.load })));
  const monoToday = mono[mono.length - 1] || {};
  const rel = median > 0 ? ((total.load - median) / median) * 100 : null;

  return openModal(`${p.number ? `#${p.number} ` : ''}${p.name}`, (body) => {
    body.append(
      h('div', { class: 'grid four', style: { marginBottom: '14px' } }, [
        h('div', { class: 'stat' }, [
          h('div', { class: 'k', text: 'Load' }),
          h('div', { class: 'v' }, [fmtLoad(total.load), h('span', { class: 'u', text: 'AU' })]),
          h('div', { class: 'n', text: rel == null ? '' : `${rel > 0 ? '+' : ''}${Math.round(rel)}% vs the squad` }),
        ]),
        h('div', { class: 'stat' }, [
          h('div', { class: 'k', text: 'On court' }),
          h('div', { class: 'v', text: String(Math.round(total.minutes)) }),
          h('div', { class: 'n', text: `minutes over ${total.daysTrained} days` }),
        ]),
        h('div', { class: 'stat' }, [
          h('div', { class: 'k', text: 'Contact' }),
          h('div', { class: 'v', text: String(Math.round(total.contactMinutes)) }),
          h('div', { class: 'n', text: 'minutes contested' }),
        ]),
        acwrStat(today),
      ]),

      h('h3', { text: 'Day by day' }),
      dayChart(total.series.map((d) => ({
        ...d, blocks: [], types: [], drillCount: d.minutes > 0 ? 1 : 0, coverage: d.coverage,
      }))),

      h('div', { class: 'grid three', style: { marginTop: '14px' } }, TISSUE.map((t) => h('div', { class: 'stat' }, [
        h('div', { class: 'k', text: t.label }),
        h('div', { class: 'v', text: Math.round(total.tissue[t.key]).toLocaleString() }),
        h('div', { class: 'n', text: t.why }),
      ]))),

      h('div', { class: 'note', style: { marginTop: '14px' } }, [
        h('strong', { text: 'This is what he was asked to do, not what his body did. ' }),
        'Everyone in a drill gets the same number whether he took twelve possessions or three. It answers how much you asked of him and how that compares to his own last few weeks — nothing more.',
      ]),

      monoToday.monotony != null
        ? h('div', { class: 'note', style: { marginTop: '10px' } }, [
          h('strong', { text: `Monotony ${fmtRatio(monoToday.monotony)}. ` }),
          monotonyFlag(monoToday.monotony).text, '.',
        ])
        : null,
    );
    return null;
  }, { cancelLabel: 'Close', wide: true });
}
