/* db.js — the app's filing cabinet on the device.
 *
 * Everything lives in IndexedDB, which is browser storage that survives closing
 * the app, rebooting the iPad, and having no internet. Nothing is ever sent to
 * a server. There is no server.
 *
 * Deliberately dependency-free: a thin promise wrapper over the raw API rather
 * than a library, so this file will still work years from now with no upkeep.
 */

const DB_NAME = 'drill-load';
const DB_VERSION = 1;

export const STORES = {
  players: 'players',
  drills: 'drills',
  sessions: 'sessions',
  blocks: 'blocks',          // one drill run inside a practice
  playerSessions: 'playerSessions', // per-player post-practice data (RPE etc.)
  customFields: 'customFields',
  meta: 'meta',
};

let _db = null;

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = req.result;
      const from = event.oldVersion;

      if (from < 1) {
        db.createObjectStore(STORES.players, { keyPath: 'id' });

        const drills = db.createObjectStore(STORES.drills, { keyPath: 'id' });
        drills.createIndex('category', 'category');

        const sessions = db.createObjectStore(STORES.sessions, { keyPath: 'id' });
        sessions.createIndex('date', 'date');

        const blocks = db.createObjectStore(STORES.blocks, { keyPath: 'id' });
        blocks.createIndex('sessionId', 'sessionId');

        const ps = db.createObjectStore(STORES.playerSessions, { keyPath: 'id' });
        ps.createIndex('sessionId', 'sessionId');
        ps.createIndex('playerId', 'playerId');

        db.createObjectStore(STORES.customFields, { keyPath: 'id' });
        db.createObjectStore(STORES.meta, { keyPath: 'key' });
      }
    };

    req.onsuccess = () => {
      _db = req.result;
      // If another tab upgrades the schema, step aside rather than wedge.
      _db.onversionchange = () => { _db.close(); _db = null; };
      resolve(_db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Database is blocked by another open copy of the app.'));
  });
}

function tx(storeNames, mode, fn) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(storeNames, mode);
    let result;
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transaction aborted'));
    try {
      result = fn(t);
      // Allow fn to hand back a request or a promise-of-value.
      if (result && typeof result.then !== 'function' && 'onsuccess' in result) {
        const req = result;
        req.onsuccess = () => { result = req.result; };
      }
    } catch (err) {
      t.abort();
      reject(err);
    }
  }));
}

function reqAsPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/* ---- generic CRUD -------------------------------------------------- */

export async function getAll(store) {
  const db = await openDB();
  return reqAsPromise(db.transaction(store, 'readonly').objectStore(store).getAll());
}

export async function get(store, id) {
  const db = await openDB();
  return reqAsPromise(db.transaction(store, 'readonly').objectStore(store).get(id));
}

export async function getBy(store, indexName, value) {
  const db = await openDB();
  const idx = db.transaction(store, 'readonly').objectStore(store).index(indexName);
  return reqAsPromise(idx.getAll(value));
}

export async function put(store, record) {
  await tx(store, 'readwrite', (t) => t.objectStore(store).put(record));
  return record;
}

export async function putMany(store, records) {
  await tx(store, 'readwrite', (t) => {
    const os = t.objectStore(store);
    records.forEach((r) => os.put(r));
  });
  return records;
}

export async function remove(store, id) {
  await tx(store, 'readwrite', (t) => t.objectStore(store).delete(id));
}

export async function removeBy(store, indexName, value) {
  const db = await openDB();
  const ids = await reqAsPromise(
    db.transaction(store, 'readonly').objectStore(store).index(indexName).getAllKeys(value)
  );
  if (ids.length) await tx(store, 'readwrite', (t) => {
    const os = t.objectStore(store);
    ids.forEach((id) => os.delete(id));
  });
  return ids.length;
}

export async function clearAll() {
  const names = Object.values(STORES);
  await tx(names, 'readwrite', (t) => names.forEach((n) => t.objectStore(n).clear()));
}

/* ---- meta (small key/value settings) -------------------------------- */

export async function getMeta(key, fallback = null) {
  const row = await get(STORES.meta, key);
  return row === undefined || row === null ? fallback : row.value;
}

export async function setMeta(key, value) {
  return put(STORES.meta, { key, value });
}

/* ---- ids ------------------------------------------------------------ */

export function newId(prefix = 'id') {
  // `crypto` is missing entirely in some contexts, so check the binding
  // exists before reaching for it rather than relying on the fallback.
  const hasCrypto = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function';
  const rand = hasCrypto
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
    : Math.random().toString(36).slice(2, 14).padEnd(12, '0');
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

/* ---- whole-database backup ------------------------------------------ */

export async function exportAll() {
  const out = { format: 'drill-load-backup', version: DB_VERSION, exportedAt: new Date().toISOString(), data: {} };
  for (const name of Object.values(STORES)) out.data[name] = await getAll(name);
  return out;
}

/**
 * Add ONLY the drills from a backup file, leaving everything else alone.
 *
 * This is deliberately separate from importAll: restoring a full backup
 * replaces the database, which would wipe every recorded practice. Loading a
 * drill library must never do that. Drills whose name already exists are
 * skipped, so it is safe to run on a library the coach has already started and
 * safe to run twice.
 */
export async function importDrills(payload) {
  if (!payload || payload.format !== 'drill-load-backup') {
    throw new Error('That file is not a backup from this app.');
  }
  const incoming = (payload.data && payload.data.drills) || [];
  if (!Array.isArray(incoming) || !incoming.length) {
    return { added: 0, skipped: 0, total: 0 };
  }

  const existing = await getAll(STORES.drills);
  const takenNames = new Set(existing.map((d) => String(d.name || '').trim().toLowerCase()));
  const takenIds = new Set(existing.map((d) => d.id));

  const toAdd = [];
  for (const drill of incoming) {
    const key = String(drill.name || '').trim().toLowerCase();
    if (!key || takenNames.has(key)) continue;
    takenNames.add(key);
    // A colliding id would overwrite an unrelated drill, so re-key if needed.
    const id = takenIds.has(drill.id) ? newId('drl') : drill.id;
    takenIds.add(id);
    toAdd.push({ ...drill, id });
  }

  if (toAdd.length) await putMany(STORES.drills, toAdd);
  return { added: toAdd.length, skipped: incoming.length - toAdd.length, total: incoming.length };
}

export async function importAll(payload, { replace = true } = {}) {
  if (!payload || payload.format !== 'drill-load-backup') {
    throw new Error('That file is not a backup from this app.');
  }
  if (replace) await clearAll();
  for (const [name, rows] of Object.entries(payload.data || {})) {
    if (!Object.values(STORES).includes(name)) continue;
    if (Array.isArray(rows) && rows.length) await putMany(name, rows);
  }
}
