// Sincronización "local primero":
//  - Cada cambio se guarda en el dispositivo con la marca _dirty.
//  - Subida: se envían los registros _dirty (upsert por id).
//  - Bajada: se piden los registros cambiados en el servidor desde la última vez.
//  - Conflictos: gana la edición con updated_at más reciente (el servidor
//    también lo garantiza con un trigger).
//  - Los borrados son lógicos (deleted_at) para que se propaguen.

import * as db from './db.js';
import * as cloud from './cloud.js';

const FIELDS = {
  posts: ['id', 'url', 'tweet_id', 'author_name', 'author_handle', 'text', 'posted_at', 'note',
    'categories', 'tags', 'favorite', 'status', 'created_at', 'updated_at', 'deleted_at'],
  categories: ['id', 'name', 'color', 'created_at', 'updated_at', 'deleted_at'],
};
const PAGE = 1000;
const OVERLAP_MS = 2 * 60 * 1000; // re-descarga 2 min hacia atrás por seguridad

let running = null;
const listeners = new Set();
export const onStatus = (fn) => listeners.add(fn);
let status = { state: 'idle', at: null, error: null };
function setStatus(s) { status = { ...status, ...s }; listeners.forEach((fn) => fn(status)); }
export const getStatus = () => status;

const toRemote = (table, rec, userId) => {
  const o = { user_id: userId };
  for (const f of FIELDS[table]) o[f] = rec[f] ?? (f === 'categories' || f === 'tags' ? [] : null);
  return o;
};

async function push(table, userId) {
  const all = await db.getAll(table);
  const dirty = all.filter((r) => r._dirty);
  for (let i = 0; i < dirty.length; i += 200) {
    const chunk = dirty.slice(i, i + 200);
    await cloud.rest(`${table}?on_conflict=id`, {
      method: 'POST',
      body: chunk.map((r) => toRemote(table, r, userId)),
      prefer: 'resolution=merge-duplicates,return=minimal',
    });
    // Limpia _dirty solo si el registro no cambió mientras se subía.
    const fresh = await Promise.all(chunk.map((r) => db.get(table, r.id)));
    const done = fresh.filter((f, k) => f && f.updated_at === chunk[k].updated_at).map((f) => ({ ...f, _dirty: false }));
    await db.putMany(table, done);
  }
  return dirty.length;
}

async function pull(table) {
  const cursors = (await db.metaGet('cursors')) || {};
  let since = cursors[table] ? new Date(new Date(cursors[table]).getTime() - OVERLAP_MS).toISOString() : '1970-01-01T00:00:00Z';
  let received = 0;
  for (;;) {
    const cols = ['server_updated_at', ...FIELDS[table]].join(',');
    const rows = await cloud.rest(
      `${table}?select=${cols}&server_updated_at=gt.${encodeURIComponent(since)}&order=server_updated_at.asc,id.asc&limit=${PAGE}`);
    if (!rows?.length) break;
    const merged = [];
    for (const row of rows) {
      const local = await db.get(table, row.id);
      const t = (v) => (v ? new Date(v).getTime() : 0);
      const changed = !local || t(local.updated_at) !== t(row.updated_at) || t(local.deleted_at) !== t(row.deleted_at);
      if (changed && (!local || !local._dirty || new Date(row.updated_at) >= new Date(local.updated_at))) {
        const { server_updated_at, ...rest } = row;
        merged.push({ ...rest, _dirty: false });
      }
    }
    if (table === 'posts') merged.forEach((m) => { m.categories ??= []; m.tags ??= []; });
    await db.putMany(table, merged);
    received += merged.length;
    since = rows[rows.length - 1].server_updated_at;
    cursors[table] = since;
    await db.metaSet('cursors', cursors);
    if (rows.length < PAGE) break;
  }
  return received;
}

/** Ejecuta una sincronización completa. Devuelve {pushed, pulled}. */
export function syncNow() {
  if (!cloud.isReady()) return Promise.resolve(null);
  if (!navigator.onLine) { setStatus({ state: 'offline' }); return Promise.resolve(null); }
  if (running) return running;
  running = (async () => {
    setStatus({ state: 'syncing', error: null });
    try {
      const userId = cloud.getSession()?.user?.id;
      const prevUser = await db.metaGet('cloudUser');
      if (prevUser && prevUser !== userId) {
        // Cambió la cuenta: se reinician cursores y se re-suben los datos locales.
        await db.metaSet('cursors', {});
        for (const t of ['categories', 'posts']) {
          const all = await db.getAll(t);
          await db.putMany(t, all.map((r) => ({ ...r, _dirty: true })));
        }
      }
      await db.metaSet('cloudUser', userId);
      let pushed = 0, pulled = 0;
      for (const t of ['categories', 'posts']) pushed += await push(t, userId);
      for (const t of ['categories', 'posts']) pulled += await pull(t);
      const at = new Date().toISOString();
      await db.metaSet('lastSync', at);
      setStatus({ state: 'ok', at });
      return { pushed, pulled };
    } catch (e) {
      const msg = e.status === 401 ? 'Sesión vencida: volvé a iniciar sesión'
        : e.code === '42P01' || e.status === 404 ? 'Faltan las tablas: ejecutá schema.sql en Supabase'
        : e.status === 503 || e.status === 540 ? 'El proyecto de Supabase parece pausado: reactivalo desde el panel'
        : !navigator.onLine ? 'Sin conexión' : e.message;
      setStatus({ state: 'error', error: msg });
      throw new Error(msg);
    } finally {
      running = null;
    }
  })();
  return running;
}

/** Marca todo como pendiente de subir (útil tras importar un respaldo). */
export async function markAllDirty() {
  for (const t of ['categories', 'posts']) {
    const all = await db.getAll(t);
    await db.putMany(t, all.map((r) => ({ ...r, _dirty: true })));
  }
}

export async function pendingCount() {
  let n = 0;
  for (const t of ['categories', 'posts']) n += (await db.getAll(t)).filter((r) => r._dirty).length;
  return n;
}
