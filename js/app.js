/* app.js — the shell: navigation, routing, first-run setup.
 *
 * Routing is by URL hash (#/drills) so the back button works and the app can
 * be launched straight to a tab from the home screen if we ever want that.
 */

import * as db from './db.js';
import { h, mount, toast } from './ui.js';

const ROUTES = [
  { id: 'practice', label: 'Practice', icon: '⏱', module: () => import('./views/practice.js') },
  { id: 'drills',   label: 'Drills',   icon: '📋', module: () => import('./views/drills.js') },
  { id: 'roster',   label: 'Roster',   icon: '👥', module: () => import('./views/roster.js') },
  { id: 'analysis', label: 'Analysis', icon: '📈', module: () => import('./views/analysis.js') },
  { id: 'settings', label: 'Settings', icon: '⚙️', module: () => import('./views/settings.js') },
];

const DEFAULT_ROUTE = 'practice';

let mainEl = null;
let navEl = null;
let currentRoute = null;

function routeId() {
  const id = (location.hash || '').replace(/^#\/?/, '').split('/')[0];
  return ROUTES.some((r) => r.id === id) ? id : DEFAULT_ROUTE;
}

function buildNav() {
  const nav = h('nav', { class: 'rail' }, [
    h('div', { class: 'brand', html: 'Load<br>Tracker' }),
    ...ROUTES.map((r) => h('a', { href: `#/${r.id}`, 'data-route': r.id }, [
      h('span', { class: 'ic', text: r.icon }),
      r.label,
    ])),
  ]);
  return nav;
}

function markActive(id) {
  navEl.querySelectorAll('a').forEach((a) => {
    if (a.dataset.route === id) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

async function navigate() {
  const id = routeId();
  const route = ROUTES.find((r) => r.id === id);

  // Let the outgoing view stop timers, listeners, etc.
  if (currentRoute && currentRoute.id !== id && currentRoute.teardown) {
    try { currentRoute.teardown(); } catch (_) { /* never block navigation */ }
  }

  markActive(id);
  mount(mainEl, h('div', { class: 'muted small', text: 'Loading…' }));

  try {
    const mod = await route.module();
    currentRoute = { id, teardown: mod.teardown };
    await mod.render(mainEl);
    if (id !== (currentRoute && currentRoute.id)) return; // navigated away mid-load
    mainEl.scrollTop = 0;
    window.scrollTo(0, 0);
  } catch (err) {
    console.error(err);
    mount(mainEl, h('div', { class: 'card' }, [
      h('h2', { text: 'Something went wrong' }),
      h('p', { class: 'muted small', text: String(err && err.message || err) }),
      h('button', { class: 'btn', onclick: () => navigate() }, 'Try again'),
    ]));
  }
}

/** Views call this to re-render themselves after a change. */
export function refresh() { return navigate(); }

/** Views call this to move to another tab. */
export function goTo(id) { location.hash = `#/${id}`; }

async function boot() {
  const app = document.getElementById('app');
  navEl = buildNav();
  mainEl = h('main', {});
  mount(app, navEl, mainEl);

  window.addEventListener('hashchange', navigate);

  // Ask the browser not to evict our data if storage gets tight.
  if (navigator.storage && navigator.storage.persist) {
    try { await navigator.storage.persist(); } catch (_) { /* best effort */ }
  }

  await db.getMeta('installedAt').then(async (v) => {
    if (!v) await db.setMeta('installedAt', new Date().toISOString());
  });

  await navigate();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* offline cache is a bonus, not a requirement */ });
  }
}

window.addEventListener('error', (e) => {
  console.error(e.error || e.message);
});

boot();
