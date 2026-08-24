/* views/rpe.js — what the players said.
 *
 * Stage 3. The coach's rating says what he ASKED for; this says what the body
 * on the receiving end actually felt. A persistent gap between the two means
 * his intensity ratings and his players disagree, and the players are the ones
 * who get injured.
 *
 * Not a tab. It opens from a finished session, because that is when it is
 * asked — about 30 minutes after practice, per Foster et al. Asked on the
 * floor, the last drill dominates the answer instead of the whole session.
 *
 * The whole design constraint here is that this happens in a corridor with
 * players leaving. One tap per player, no modal per player, no scrolling back
 * and forth. Anything slower does not get collected in February.
 */

import * as db from '../db.js';
import { makePlayerSession, rpeInfo, RPE_SCALE, intensityBand } from '../models.js';
import { feltVsPrescribed, rpeCoverage, sessionGap, gapFlag, fmtLoad } from '../load.js';
import { h, toast, openModal } from '../ui.js';

/**
 * Collect a rating for every player who trained.
 * Returns true if anything was saved.
 */
export async function collectRPE(session, roster) {
  const existing = await db.getBy(db.STORES.playerSessions, 'sessionId', session.id);
  const byPlayer = new Map(existing.map((ps) => [ps.playerId, ps]));

  // playerId -> 1-10, or undefined for "hasn't answered".
  const answers = new Map();
  roster.forEach((p) => {
    const ps = byPlayer.get(p.id);
    if (ps && ps.rpe != null) answers.set(p.id, Number(ps.rpe));
  });

  const result = await openModal('How hard was that?', (body, done) => {
    const counter = h('div', { class: 'tiny' });

    function paintCounter() {
      counter.textContent = `${answers.size} of ${roster.length} answered`;
    }

    const list = h('div', {});
    roster.forEach((p) => {
      const scale = h('div', { class: 'iscale' });
      const legend = h('div', { class: 'tiny', style: { minHeight: '18px', marginTop: '3px' } });

      function paintRow() {
        [...scale.children].forEach((btn) => {
          const on = Number(btn.dataset.v) === answers.get(p.id);
          btn.setAttribute('aria-pressed', on ? 'true' : 'false');
          // Same colour bands as everywhere else, so a 7 looks like a 7.
          btn.className = on ? intensityBand(Number(btn.dataset.v)) : '';
        });
        const v = answers.get(p.id);
        legend.textContent = v ? `${v} — ${rpeInfo(v).label}: ${rpeInfo(v).example}` : '';
        paintCounter();
      }

      RPE_SCALE.forEach((r) => {
        scale.appendChild(h('button', {
          type: 'button', 'data-v': r.value,
          onclick: () => {
            // Tapping the same number again clears it — a mistap must be
            // undoable without hunting for a separate control.
            if (answers.get(p.id) === r.value) answers.delete(p.id);
            else answers.set(p.id, r.value);
            paintRow();
          },
        }, String(r.value)));
      });

      list.append(
        h('div', { style: { padding: '10px 0', borderTop: '1px solid var(--line)' } }, [
          h('div', { style: { fontWeight: '650', marginBottom: '6px' } },
            `${p.number ? `#${p.number} ` : ''}${p.name}`),
          scale,
          legend,
        ]),
      );
      paintRow();
    });

    paintCounter();

    body.append(
      h('p', { class: 'small', style: { marginTop: 0 } }, [
        h('strong', { text: 'Ask each player: how hard was that session, 1 to 10? ' }),
        'Their answer, not yours — the whole value is that it disagrees with you sometimes.',
      ]),
      h('p', { class: 'tiny' },
        'Best asked about half an hour after you finish. Ask on the floor and the last drill drowns out the rest of practice.'),
      h('div', { class: 'note', style: { marginBottom: '6px' } }, [
        counter,
        h('div', { class: 'tiny' },
          'Anyone you skip stays blank, not zero. Missing is missing — it is never counted as an easy day.'),
      ]),
      list,
    );

    return () => done({ answers: [...answers.entries()] });
  }, { confirmLabel: 'Save ratings', wide: true });

  if (!result) return false;

  for (const p of roster) {
    const value = new Map(result.answers).get(p.id);
    const ps = byPlayer.get(p.id);
    if (value == null && !ps) continue;           // nothing to record
    const record = ps
      ? { ...ps, rpe: value == null ? null : value }
      : makePlayerSession({ sessionId: session.id, playerId: p.id, rpe: value });
    await db.put(db.STORES.playerSessions, record);
  }

  const n = new Map(result.answers).size;
  toast(n ? `${n} rating${n === 1 ? '' : 's'} saved` : 'Ratings cleared');
  return true;
}

/**
 * The comparison, for the session summary. Returns null when nobody has
 * answered, so the summary shows a prompt instead of an empty table.
 */
export function feltPanel(session, roster, blocks, playerSessions) {
  const ids = roster.map((p) => p.id);
  const rows = feltVsPrescribed(blocks, ids, playerSessions);
  const cov = rpeCoverage(ids, playerSessions);
  if (!cov.answered) return null;

  const gap = sessionGap(rows);
  const flag = gapFlag(gap);
  const nameOf = (id) => {
    const p = roster.find((x) => x.id === id);
    return p ? `${p.number ? `#${p.number} ` : ''}${p.name}` : id;
  };

  const answered = rows.filter((r) => r.gap != null)
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));

  return h('div', {}, [
    h('h3', { style: { marginTop: '18px' }, text: 'What you asked for vs what they felt' }),

    h('div', { class: `note ${flag.level === 'watch' ? 'warn' : ''}`, style: { marginBottom: '10px' } }, [
      h('div', {}, [
        h('strong', { text: `${flag.label}` }),
        gap == null ? '' : ` — the middle player was ${gap > 0 ? '+' : ''}${gap.toFixed(1)} against the plan. `,
        flag.note,
      ]),
      cov.fraction < 1
        ? h('div', { class: 'tiny', style: { marginTop: '5px' } },
          `${cov.answered} of ${cov.total} players answered. The players who did not are not in this comparison at all.`)
        : null,
    ]),

    h('div', { class: 'table-wrap' }, [
      h('table', {}, [
        h('thead', {}, h('tr', {}, [
          h('th', { text: 'Player' }),
          h('th', { class: 'num', text: 'You said' }),
          h('th', { class: 'num', text: 'He said' }),
          h('th', { class: 'num', text: 'Gap' }),
          h('th', { class: 'num', text: 'Felt AU' }),
        ])),
        h('tbody', {}, answered.map((r) => h('tr', {}, [
          h('td', { text: nameOf(r.playerId) }),
          h('td', { class: 'num', text: r.prescribedIntensity.toFixed(1) }),
          h('td', { class: 'num', text: String(r.rpe) }),
          h('td', { class: 'num' }, [
            h('span', {
              style: { fontWeight: Math.abs(r.gap) >= 2 ? '700' : '400' },
              text: `${r.gap > 0 ? '+' : ''}${r.gap.toFixed(1)}`,
            }),
          ]),
          h('td', { class: 'num', text: fmtLoad(r.feltLoad) }),
        ]))),
      ]),
    ]),

    h('p', { class: 'tiny', style: { marginTop: '6px' } },
      'One session proves nothing on its own — a player can have a bad night’s sleep. It is the same name showing up week after week that is worth acting on.'),
  ]);
}
