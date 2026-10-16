// Búsqueda en el dispositivo (instantánea, funciona sin conexión).
// Sintaxis: palabras libres, @usuario, #etiqueta, cat:nombre (o cat:"dos palabras"),
// fav, pendiente, leido, archivado. Las palabras se combinan con Y; "-palabra" excluye.

import { norm } from './util.js';

export function parseQuery(q) {
  const out = { words: [], not: [], users: [], tags: [], cats: [], fav: false, status: null };
  const re = /(-?)(cat:"[^"]+"|cat:\S+|"[^"]+"|\S+)/gi;
  let m;
  while ((m = re.exec(String(q || '')))) {
    const neg = m[1] === '-';
    let t = m[2];
    const lower = norm(t);
    if (lower.startsWith('cat:')) { out.cats.push(norm(t.slice(4).replace(/"/g, ''))); continue; }
    if (t.startsWith('@') && t.length > 1) { out.users.push(norm(t.slice(1))); continue; }
    if (t.startsWith('#') && t.length > 1) { out.tags.push(norm(t.slice(1))); continue; }
    if (!neg && ['fav', 'favorito', 'favoritos', 'is:fav'].includes(lower)) { out.fav = true; continue; }
    if (!neg && ['pendiente', 'pendientes', 'is:pendiente'].includes(lower)) { out.status = 'pendiente'; continue; }
    if (!neg && ['leido', 'leidos', 'is:leido'].includes(lower)) { out.status = 'leido'; continue; }
    if (!neg && ['archivado', 'archivados', 'is:archivado'].includes(lower)) { out.status = 'archivado'; continue; }
    t = norm(t.replace(/"/g, ''));
    if (t) (neg ? out.not : out.words).push(t);
  }
  return out;
}

/** Texto indexable de una publicación (en minúsculas y sin acentos). */
function haystack(p, catNames) {
  return norm([p.text, p.note, p.author_name, p.author_handle, (p.tags || []).join(' '),
    (p.categories || []).map((id) => catNames.get(id) || '').join(' '), p.url].join(' \u0001 '));
}

/**
 * @param posts   lista completa (sin borrados)
 * @param cats    lista de categorías
 * @param q       texto de búsqueda
 * @param f       filtros de la interfaz {category, tag, status, fav, sort, from, to}
 */
export function search(posts, cats, q, f = {}) {
  const catNames = new Map(cats.map((c) => [c.id, c.name]));
  const catByName = new Map(cats.map((c) => [norm(c.name), c.id]));
  const pq = parseQuery(q);
  const wantCatIds = pq.cats.map((n) => catByName.get(n) ?? [...catByName].find(([k]) => k.startsWith(n))?.[1] ?? '__none__');

  const res = posts.filter((p) => {
    if (f.category === '__none__') { if ((p.categories || []).length) return false; }
    else if (f.category && !(p.categories || []).includes(f.category)) return false;
    if (f.tag && !(p.tags || []).includes(f.tag)) return false;
    if (f.status && p.status !== f.status) return false;
    if (f.fav && !p.favorite) return false;
    if (pq.fav && !p.favorite) return false;
    if (pq.status && p.status !== pq.status) return false;
    if (f.from && (p.posted_at || p.created_at) < f.from) return false;
    if (f.to && (p.posted_at || p.created_at) > f.to + 'T23:59:59') return false;
    for (const u of pq.users) {
      if (!norm(p.author_handle).includes(u) && !norm(p.author_name).includes(u)) return false;
    }
    for (const t of pq.tags) if (!(p.tags || []).some((x) => norm(x).startsWith(t))) return false;
    for (const id of wantCatIds) if (!(p.categories || []).includes(id)) return false;
    if (pq.words.length || pq.not.length) {
      const hs = haystack(p, catNames);
      for (const w of pq.words) if (!hs.includes(w)) return false;
      for (const w of pq.not) if (hs.includes(w)) return false;
    }
    return true;
  });

  const key = {
    saved_desc: (a, b) => (b.created_at || '').localeCompare(a.created_at || ''),
    saved_asc: (a, b) => (a.created_at || '').localeCompare(b.created_at || ''),
    posted_desc: (a, b) => (b.posted_at || '').localeCompare(a.posted_at || ''),
    posted_asc: (a, b) => (a.posted_at || '').localeCompare(b.posted_at || ''),
    author: (a, b) => norm(a.author_handle).localeCompare(norm(b.author_handle)),
  }[f.sort || 'saved_desc'];
  return res.sort(key);
}

/** Palabras a resaltar en los resultados. */
export const highlightTerms = (q) => parseQuery(q).words;
