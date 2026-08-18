/* tests/harness.js — just enough browser to run the app's views in
 * JavaScriptCore, so render paths can be exercised without a real browser.
 *
 * This is a smoke harness, not a browser. It proves a view builds its DOM
 * without throwing and puts the expected text on screen. It cannot prove
 * anything about layout, styling or touch targets — only a real device can.
 */

/* ---------------- DOM ---------------- */

const VOID_TEXT = new Set(['input', 'img', 'br', 'hr', 'meta', 'link']);

class Node {
  constructor(tag) {
    this.tagName = String(tag || '').toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = {};
    this.style = {};
    this.dataset = {};
    this.listeners = {};
    this._text = '';
    this.className = '';
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.files = null;
    this.classList = {
      add: (c) => { if (!this.className.split(' ').includes(c)) this.className = (this.className + ' ' + c).trim(); },
      remove: (c) => { this.className = this.className.split(' ').filter((x) => x && x !== c).join(' '); },
      contains: (c) => this.className.split(' ').includes(c),
      toggle: (c, force) => {
        const on = force === undefined ? !this.classList.contains(c) : force;
        if (on) this.classList.add(c); else this.classList.remove(c);
      },
    };
  }

  appendChild(child) {
    if (child == null) return child;
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  append(...nodes) {
    nodes.flat().forEach((n) => {
      if (n == null || n === false) return;
      this.appendChild(typeof n === 'string' || typeof n === 'number' ? textNode(String(n)) : n);
    });
  }
  removeChild(child) {
    const i = this.children.indexOf(child);
    if (i >= 0) this.children.splice(i, 1);
    child.parentNode = null;
    return child;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }

  get firstChild() { return this.children[0] || null; }

  setAttribute(k, v) {
    this.attributes[k] = String(v);
    if (k.startsWith('data-')) this.dataset[camel(k.slice(5))] = String(v);
    if (k === 'class') this.className = String(v);
    if (k === 'value') this.value = String(v);
  }
  getAttribute(k) { return this.attributes[k] === undefined ? null : this.attributes[k]; }
  removeAttribute(k) { delete this.attributes[k]; }
  hasAttribute(k) { return k in this.attributes; }

  set textContent(v) { this.children = []; this._text = String(v); }
  get textContent() {
    if (this.children.length === 0) return this._text;
    return this.children.map((c) => c.textContent).join('');
  }

  set innerHTML(v) {
    this.children = [];
    this._text = v ? String(v).replace(/<[^>]*>/g, '') : '';
  }
  get innerHTML() { return this.textContent; }

  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  removeEventListener(type, fn) {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter((f) => f !== fn);
  }
  dispatch(type, event = {}) {
    const e = { type, target: this, stopPropagation() {}, preventDefault() {}, ...event };
    (this.listeners[type] || []).slice().forEach((fn) => fn(e));
    return e;
  }
  click() { return this.dispatch('click'); }
  focus() {}

  /* --- minimal selector engine: tag, .class, [attr], [attr="v"], comma lists --- */
  matches(sel) {
    return sel.split(',').map((s) => s.trim()).filter(Boolean).some((part) => {
      if (part.startsWith('.')) return this.className.split(' ').includes(part.slice(1));
      if (part.startsWith('[')) {
        const m = part.match(/^\[([\w-]+)(?:=["']?([^\]"']*)["']?)?\]$/);
        if (!m) return false;
        if (m[2] === undefined) return m[1] in this.attributes;
        return this.attributes[m[1]] === m[2];
      }
      return this.tagName === part.toUpperCase();
    });
  }
  querySelectorAll(sel) {
    const out = [];
    const walk = (n) => n.children.forEach((c) => { if (c.matches && c.matches(sel)) out.push(c); if (c.children) walk(c); });
    walk(this);
    out.forEach = Array.prototype.forEach.bind(out);
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }

  /* test helpers */
  get allText() { return this.textContent; }
  findAll(sel) { return this.querySelectorAll(sel); }
}

function camel(s) { return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase()); }

function textNode(text) {
  const n = new Node('#text');
  n._text = text;
  n.matches = () => false;
  return n;
}

const document = {
  createElement: (tag) => new Node(tag),
  createTextNode: (t) => textNode(t),
  getElementById(id) { return document.body.querySelector(`[id=${id}]`); },
  addEventListener() {}, removeEventListener() {},
  body: new Node('body'),
  documentElement: new Node('html'),
};

/* ---------------- IndexedDB ---------------- */

function makeRequest(resultFn) {
  const req = { onsuccess: null, onerror: null, result: undefined };
  Promise.resolve().then(() => {
    try { req.result = resultFn(); if (req.onsuccess) req.onsuccess({ target: req }); }
    catch (err) { req.error = err; if (req.onerror) req.onerror({ target: req }); }
  });
  return req;
}

class FakeStore {
  constructor(name, opts) {
    this.name = name;
    this.keyPath = (opts && opts.keyPath) || 'id';
    this.rows = new Map();
    this.indexes = {};
  }
  createIndex(name, keyPath) { this.indexes[name] = keyPath; return { name, keyPath }; }
}

class FakeDB {
  constructor(name) { this.name = name; this.stores = new Map(); this.objectStoreNames = []; }
  createObjectStore(name, opts) {
    const s = new FakeStore(name, opts);
    this.stores.set(name, s);
    this.objectStoreNames.push(name);
    return s;
  }
  transaction(names, mode) {
    const list = [].concat(names);
    const db = this;
    let pending = 0;
    let settled = false;
    const t = {
      mode, oncomplete: null, onerror: null, onabort: null, error: null,
      abort() { settled = true; if (t.onabort) t.onabort(); },
      objectStore(name) { return wrapStore(db.stores.get(name), track); },
    };
    function track(p) { pending++; p.then(finish, finish); }
    function finish() {
      pending--;
      if (pending === 0 && !settled) queue();
    }
    function queue() {
      settled = true;
      Promise.resolve().then(() => { if (t.oncomplete) t.oncomplete(); });
    }
    // If no operation is queued in the same tick, complete anyway.
    Promise.resolve().then(() => Promise.resolve()).then(() => {
      if (pending === 0 && !settled) queue();
    });
    return t;
  }
  close() {}
}

function wrapStore(store, track) {
  if (!store) throw new Error('No such object store');
  const run = (fn) => {
    const req = makeRequest(fn);
    if (track) track(Promise.resolve().then(() => {}));
    return req;
  };
  return {
    getAll: () => run(() => [...store.rows.values()].map(clone)),
    get: (id) => run(() => { const v = store.rows.get(id); return v ? clone(v) : undefined; }),
    put: (rec) => run(() => { store.rows.set(rec[store.keyPath], clone(rec)); return rec[store.keyPath]; }),
    delete: (id) => run(() => { store.rows.delete(id); }),
    clear: () => run(() => { store.rows.clear(); }),
    index: (name) => {
      const keyPath = store.indexes[name];
      return {
        getAll: (value) => run(() => [...store.rows.values()].filter((r) => r[keyPath] === value).map(clone)),
        getAllKeys: (value) => run(() => [...store.rows.values()].filter((r) => r[keyPath] === value).map((r) => r[store.keyPath])),
      };
    },
  };
}

function clone(o) { return JSON.parse(JSON.stringify(o)); }

const databases = new Map();

const indexedDB = {
  open(name, version) {
    const req = { onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null, result: null };
    Promise.resolve().then(() => {
      let db = databases.get(name);
      const fresh = !db;
      if (fresh) { db = new FakeDB(name); databases.set(name, db); }
      req.result = db;
      if (fresh && req.onupgradeneeded) req.onupgradeneeded({ oldVersion: 0, newVersion: version, target: req });
      if (req.onsuccess) req.onsuccess({ target: req });
    });
    return req;
  },
  deleteDatabase(name) { databases.delete(name); return makeRequest(() => {}); },
};

/* ---------------- window & friends ---------------- */

const timers = new Map();
let timerId = 1;

const windowObj = {
  document,
  indexedDB,
  location: { hash: '', protocol: 'http:' },
  addEventListener() {}, removeEventListener() {},
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  scrollTo() {},
  innerWidth: 1280, innerHeight: 800, devicePixelRatio: 2,
  navigator: { userAgent: 'harness', storage: { persist: () => Promise.resolve(true) }, maxTouchPoints: 10 },
};

globalThis.window = windowObj;
globalThis.document = document;
globalThis.indexedDB = indexedDB;
globalThis.navigator = windowObj.navigator;
globalThis.location = windowObj.location;
globalThis.crypto = { randomUUID: () => 'xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16)) };
globalThis.setInterval = (fn, ms) => { const id = timerId++; timers.set(id, fn); return id; };
globalThis.clearInterval = (id) => { timers.delete(id); };
globalThis.setTimeout = (fn) => { const id = timerId++; timers.set(id, fn); return id; };
globalThis.clearTimeout = (id) => { timers.delete(id); };
globalThis.Blob = function Blob(parts, opts) { this.parts = parts; this.type = opts && opts.type; };
globalThis.URL = { createObjectURL: () => 'blob:fake', revokeObjectURL: () => {} };

/** Run every pending interval callback once — used to test the practice clock. */
export function runTimers() { [...timers.values()].forEach((fn) => fn()); }

/** Let queued database microtasks settle. */
export function flush(rounds = 40) {
  let p = Promise.resolve();
  for (let i = 0; i < rounds; i++) p = p.then(() => {});
  return p;
}

/** Wipe all fake databases between tests. */
export function resetDatabases() { databases.clear(); }

export { document, Node };
