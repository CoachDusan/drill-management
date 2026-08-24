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
import { h, mount, emptyState, openModal } from '../ui.js';
import { TISSUE, formatDate, toDateKey, addDays } from '../models.js';
import {
  fmtLoad, fmtMinutes, fmtRatio, fmtDensity,
  acwrSeries, monotonySeries, acwrFlag, monotonyFlag, provisionalNote,
  blockMinutes, blockLoad, blockLiveDensity,
} from '../load.js';
import * as hist from '../history.js';

let rootEl = null;
let rangeKey = '4w';        // survives a re-render, resets when the app reloads

export async function render(root) {
  rootEl = root;

  const [sessions, blocks, players, drills, fixtures] = await Promise.all([
    db.getAll(db.STORES.sessions),
    db.getAll(db.STORES.blocks),
    db.getAll(db.STORES.players),
    db.getAll(db.STORES.drills),
    db.getMeta('fixtures', []),
  ]);

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

  const range = hist.rangeFor(sessions, rangeKey);
  const days = seasonDays.filter((d) => d.date >= range.from && d.date <= range.to);
  const games = hist.gameDates(sessions, fixtures);

  const windowBlocks = days.flatMap((d) => d.blocks);
  const windowSessions = sessions.filter((s) => s.date >= range.from && s.date <= range.to);
  const rolls = hist.drillRollups(windowSessions, windowBlocks, drills);
  const cov = hist.windowCoverage(days);

  mount(root,
    head,
    rangeBar(),
    weekPanel(days, acwr, monotony, cov),
    coverageNote(cov),
    gameDayPanel(days, games, sessions, fixtures),
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

/* ---- 2. game days -------------------------------------------------------
 *
 * The panel the coach asked for. A week is not Monday to Sunday, it is a
 * countdown to the next game, and the question is whether every GD-1 of the
 * season actually looks like a GD-1.
 */

function gameDayPanel(days, games, sessions, fixtures) {
  const wrap = h('div', { style: { marginTop: '22px' } });
  wrap.append(h('div', { class: 'card-head' }, [
    h('h3', { style: { margin: 0 }, text: 'Days around a game' }),
    h('button', { class: 'btn btn-sm', onclick: () => editFixtures(fixtures) }, 'Upcoming games'),
  ]));

  if (!games.length) {
    wrap.append(h('div', { class: 'note' }, [
      h('div', {}, [
        h('strong', { text: 'No games recorded yet. ' }),
        'Record a game the same way you record a practice — Start a practice, and set Type to Game. It needs no drills. Once there is one, every training day gets labelled by how far it sits from the next game, and you can compare every GD-1 of the season against each other.',
      ]),
      h('div', { class: 'tiny', style: { marginTop: '6px' } },
        'For a game that has not happened yet, add it under Upcoming games and today will start reading GD-1, GD-2 and so on.'),
    ]));
    return wrap;
  }

  const buckets = hist.gameDayBuckets(days, games);
  if (!buckets.length) {
    wrap.append(h('div', { class: 'note' },
      'No day in this window sits within a week of a game. Widen the range, or add your upcoming fixtures.'));
    return wrap;
  }

  const todayLabel = hist.gameDayLabel(toDateKey(new Date()), games);
  const max = Math.max(1, ...buckets.map((b) => b.meanLoad || 0));

  wrap.append(h('p', { class: 'tiny', style: { marginTop: 0 } },
    todayLabel
      ? `Today is ${todayLabel.label}. Averages below are for every ${'day'} in this window at each point in the countdown.`
      : 'Averages are for every day in this window at each point in the countdown to a game.'));

  wrap.append(h('div', { class: 'table-wrap' }, [
    h('table', {}, [
      h('thead', {}, h('tr', {}, [
        h('th', { text: 'Day' }),
        h('th', { text: 'Average load' }),
        h('th', { class: 'num', text: 'AU' }),
        h('th', { class: 'num', text: 'Range' }),
        h('th', { class: 'num', text: 'Avg drill' }),
        h('th', { class: 'num', text: 'Drills' }),
        h('th', { class: 'num', text: 'Days' }),
      ])),
      h('tbody', {}, buckets.map((b) => {
        const isToday = todayLabel && todayLabel.key === b.key;
        return h('tr', { style: isToday ? { background: 'var(--accent-soft)' } : {} }, [
          h('td', {}, [
            h('strong', { text: b.label }),
            isToday ? h('div', { class: 'tiny', text: 'today' }) : null,
            b.restDays ? h('div', { class: 'tiny', text: `${b.restDays} with no practice` }) : null,
          ]),
          h('td', {}, [
            h('div', { class: 'meter' }, [
              h('div', { class: `meter-fill${b.key === 'GD' ? ' game' : ''}`, style: { width: `${((b.meanLoad || 0) / max) * 100}%` } }),
            ]),
          ]),
          h('td', { class: 'num', text: fmtLoad(b.meanLoad) }),
          h('td', { class: 'num tiny', text: b.n > 1 ? `${fmtLoad(b.minLoad)}–${fmtLoad(b.maxLoad)}` : '—' }),
          h('td', { class: 'num', text: b.meanDrillMinutes == null ? '—' : fmtMinutes(b.meanDrillMinutes) }),
          h('td', { class: 'num', text: b.meanDrillCount == null ? '—' : b.meanDrillCount.toFixed(1) }),
          h('td', { class: 'num' }, [
            String(b.n),
            b.n < 3 ? h('div', { class: 'tiny', text: 'few' }) : null,
          ]),
        ]);
      })),
    ]),
  ]));

  /* A game day with no clocked drills reads as 0 AU, and 0 AU next to a
     384 AU Monday says games are free. They are the heaviest day of the week.
     The app genuinely does not know what a game cost — nobody runs a stopwatch
     on a game — so it has to say that rather than let the row speak. */
  const gdRow = buckets.find((b) => b.key === 'GD');
  if (gdRow && gdRow.n && (gdRow.meanLoad || 0) < 1) {
    wrap.append(h('div', { class: 'note warn', style: { marginTop: '10px' } }, [
      h('strong', { text: 'Game day shows 0 AU because nothing was clocked in it. ' }),
      'That is not what a game costs — it is almost certainly the heaviest day of the week. Everything on this screen counts training only, so weekly totals, monotony and the acute:chronic ratio are all missing the games. Compare training against training, not against the zero.',
    ]));
  }

  const thin = buckets.filter((b) => b.n < 3);
  if (thin.length) {
    wrap.append(h('div', { class: 'note', style: { marginTop: '10px' } }, [
      h('strong', { text: `${thin.map((b) => b.label).join(', ')} ${thin.length === 1 ? 'is' : 'are'} built on fewer than three days. ` }),
      'That is one or two practices, not a pattern. The column is there so you can watch it fill up, not so you can read it yet.',
    ]));
  }

  wrap.append(h('p', { class: 'tiny', style: { marginTop: '8px' } },
    'Average drill is the mean length of one drill run that day, not the length of the session — when practice splits into groups, two clocks run at once. Days with no practice are counted as a zero, because a rest day before a game is a decision, not a gap.'));

  return wrap;
}

/** Games that have not happened yet, so today can be labelled in advance. */
async function editFixtures(current) {
  const list = (current || []).map((f) => (typeof f === 'string' ? { date: f, label: '' } : f))
    .filter((f) => f && f.date)
    .sort((a, b) => a.date.localeCompare(b.date));

  const result = await openModal('Upcoming games', (body, done) => {
    const rows = h('div', { class: 'list' });

    function paint() {
      rows.innerHTML = '';
      if (!list.length) {
        rows.appendChild(h('p', { class: 'tiny', text: 'Nothing scheduled. Add a date and today starts counting down to it.' }));
      }
      list.forEach((f, i) => {
        rows.appendChild(h('div', { class: 'row' }, [
          h('div', { class: 'grow' }, [
            h('div', { class: 'name', text: formatDate(f.date) }),
            f.label ? h('div', { class: 'tiny', text: f.label }) : null,
          ]),
          h('button', {
            class: 'btn btn-sm btn-danger',
            onclick: () => { list.splice(i, 1); paint(); },
          }, 'Remove'),
        ]));
      });
    }
    paint();

    const date = h('input', { type: 'date', value: addDays(toDateKey(new Date()), 1) });
    const label = h('input', { type: 'text', placeholder: 'Optional — e.g. away at Partizan' });

    body.append(
      h('p', { class: 'tiny', style: { marginTop: 0 } },
        'A game you have already played does not belong here — record it as a session with Type set to Game, and it counts automatically. This list is only so the app knows what is coming, and can tell you that today is GD-2.'),
      rows,
      h('div', { class: 'form-row', style: { marginTop: '14px' } }, [
        h('label', { class: 'field' }, [h('span', { class: 'lbl', text: 'Date' }), date]),
        h('label', { class: 'field' }, [h('span', { class: 'lbl', text: 'Opponent' }), label]),
      ]),
      h('button', {
        class: 'btn btn-sm',
        onclick: () => {
          if (!date.value) return;
          if (!list.some((f) => f.date === date.value)) {
            list.push({ date: date.value, label: label.value.trim() });
            list.sort((a, b) => a.date.localeCompare(b.date));
          }
          label.value = '';
          paint();
        },
      }, 'Add this game'),
    );

    return () => done({ fixtures: list });
  }, { confirmLabel: 'Save' });

  if (!result) return;
  // Yesterday's fixtures are noise; a played game is a session by then.
  const today = toDateKey(new Date());
  await db.setMeta('fixtures', result.fixtures.filter((f) => f.date >= today));
  await render(rootEl);
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
