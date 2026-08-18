/* views/analysis.js — the charts. Built after the stopwatch. */

import { h, mount, emptyState } from '../ui.js';

export async function render(root) {
  mount(root,
    h('div', { class: 'page-head' }, [h('div', {}, [h('h1', { text: 'Analysis' })])]),
    emptyState('📈', 'Coming after the stopwatch',
      'Once practices are being recorded, this is where weekly load, per-player trends and spike warnings will live.'),
  );
}
