// Copias de seguridad: exportar / importar la biblioteca completa.
// Formato JSON abierto y documentado (ver README) + CSV para planillas.

import * as db from './db.js';
import { download, nowIso, uuid, cleanTags, fmtDate } from './util.js';

const STATUSES = ['pendiente', 'leido', 'archivado'];
const strip = ({ _dirty, ...r }) => r;
const str = (v, max) => (v === null || v === undefined || v === '' ? null : String(v).slice(0, max));
const iso = (v) => { if (!v) return null; const d = new Date(v); return isNaN(d) ? null : d.toISOString(); };
const isUuid = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export async function buildBackup() {
  const posts = (await db.getAll('posts')).filter((p) => !p.deleted_at).map(strip);
  const categories = (await db.getAll('categories')).filter((c) => !c.deleted_at).map(strip);
  return { app: 'xbiblioteca', version: 1, exported_at: nowIso(), counts: { posts: posts.length, categories: categories.length }, categories, posts };
}

export async function exportJSON() {
  const data = await buildBackup();
  const stamp = new Date().toISOString().slice(0, 10);
  download(`xbiblioteca-respaldo-${stamp}.json`, JSON.stringify(data, null, 2), 'application/json');
  await db.metaSet('lastBackup', nowIso());
  return data.counts;
}

export async function exportCSV() {
  const { posts, categories } = await buildBackup();
  const names = new Map(categories.map((c) => [c.id, c.name]));
  const cols = ['url', 'autor', 'usuario', 'fecha_publicacion', 'texto', 'nota', 'categorias', 'etiquetas', 'favorito', 'estado', 'guardado'];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = posts.map((p) => [p.url, p.author_name, p.author_handle ? '@' + p.author_handle : '', fmtDate(p.posted_at),
    p.text, p.note, (p.categories || []).map((id) => names.get(id)).filter(Boolean).join(' | '),
    (p.tags || []).join(' '), p.favorite ? 'sí' : 'no', p.status, fmtDate(p.created_at)].map(esc).join(','));
  const stamp = new Date().toISOString().slice(0, 10);
  download(`xbiblioteca-${stamp}.csv`, '﻿' + [cols.join(','), ...rows].join('\r\n'), 'text/csv;charset=utf-8');
}

function cleanCategory(c) {
  if (!c || typeof c !== 'object' || !c.name) return null;
  return {
    id: isUuid(c.id) ? c.id : uuid(),
    name: String(c.name).trim().slice(0, 60),
    color: /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : '#4f7cff',
    created_at: iso(c.created_at) || nowIso(),
    updated_at: iso(c.updated_at) || nowIso(),
    deleted_at: null,
  };
}

function cleanPost(p, validCats) {
  if (!p || typeof p !== 'object' || !p.url) return null;
  return {
    id: isUuid(p.id) ? p.id : uuid(),
    url: String(p.url).slice(0, 500),
    tweet_id: /^\d{1,25}$/.test(p.tweet_id || '') ? String(p.tweet_id) : null,
    author_name: str(p.author_name, 200),
    author_handle: str(p.author_handle, 50)?.replace(/^@/, '') ?? null,
    text: str(p.text, 10000),
    posted_at: iso(p.posted_at),
    note: str(p.note, 20000),
    categories: Array.isArray(p.categories) ? p.categories.filter((id) => validCats.has(id)) : [],
    tags: cleanTags(p.tags || []),
    favorite: !!p.favorite,
    status: STATUSES.includes(p.status) ? p.status : 'pendiente',
    created_at: iso(p.created_at) || nowIso(),
    updated_at: iso(p.updated_at) || nowIso(),
    deleted_at: null,
  };
}

/**
 * Importa un respaldo.
 * mode "merge": agrega lo nuevo y actualiza lo que esté más reciente en el archivo.
 * mode "replace": elimina la biblioteca actual (también en la nube al sincronizar) y deja solo el archivo.
 */
export async function importJSON(text, mode = 'merge') {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('El archivo no es un JSON válido.'); }
  if (data?.app !== 'xbiblioteca' || !Array.isArray(data.posts)) throw new Error('El archivo no es un respaldo de XBiblioteca.');

  const now = nowIso();
  if (mode === 'replace') {
    for (const t of ['posts', 'categories']) {
      const all = await db.getAll(t);
      await db.putMany(t, all.filter((r) => !r.deleted_at).map((r) => ({ ...r, deleted_at: now, updated_at: now, _dirty: true })));
    }
  }
  // En "replace" se fuerza la fecha de edición para que el contenido importado gane.
  const bump = (r) => (mode === 'replace' ? { ...r, updated_at: new Date(Date.now() + 1).toISOString() } : r);

  const cats = (data.categories || []).map(cleanCategory).filter(Boolean).map(bump);
  const validCats = new Set([...cats.map((c) => c.id), ...(await db.getAll('categories')).filter((c) => !c.deleted_at).map((c) => c.id)]);
  const posts = data.posts.map((p) => cleanPost(p, validCats)).filter(Boolean).map(bump);

  let added = 0, updated = 0, skipped = 0;
  for (const [table, list] of [['categories', cats], ['posts', posts]]) {
    const out = [];
    for (const rec of list) {
      const local = await db.get(table, rec.id);
      if (!local) { out.push({ ...rec, _dirty: true }); if (table === 'posts') added++; }
      else if (mode === 'replace' || new Date(rec.updated_at) > new Date(local.updated_at) || local.deleted_at) {
        out.push({ ...rec, updated_at: mode === 'replace' ? rec.updated_at : (local.deleted_at ? now : rec.updated_at), _dirty: true });
        if (table === 'posts') updated++;
      } else if (table === 'posts') skipped++;
    }
    await db.putMany(table, out);
  }
  return { added, updated, skipped };
}
