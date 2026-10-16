// XBiblioteca — interfaz principal
import * as db from './db.js';
import * as cloud from './cloud.js';
import * as sync from './sync.js';
import * as backup from './backup.js';
import { search, highlightTerms } from './search.js';
import { fetchMeta, parseXUrl, dateFromTweetId } from './xmeta.js';
import { $, $$, h, uuid, nowIso, norm, fmtDate, timeAgo, cleanTags, toast, debounce, confirmDialog } from './util.js';

const APP_VERSION = '1.1.1';
const STATUS_LABEL = { pendiente: 'Pendiente de leer', leido: 'Leído', archivado: 'Archivado' };
const PALETTE = ['#4f7cff', '#e5484d', '#30a46c', '#f76b15', '#8e4ec6', '#0d9488', '#d6409f', '#a18072', '#ffb224', '#6e56cf'];

const state = {
  posts: [],          // sin borrados
  cats: [],           // sin borrados
  q: '',
  f: { category: '', tag: '', status: '', fav: false, sort: 'saved_desc' },
  limit: 50,
  prefill: null,      // datos recibidos por "Compartir" o bookmarklet
  installEvt: null,
};

// ---------------------------------------------------------------- datos
async function load() {
  state.posts = (await db.getAll('posts')).filter((p) => !p.deleted_at);
  state.cats = (await db.getAll('categories')).filter((c) => !c.deleted_at).sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

const scheduleSync = debounce(() => sync.syncNow().then(afterSync).catch(() => {}), 1500);

async function savePost(rec) {
  rec.updated_at = nowIso();
  rec._dirty = true;
  await db.put('posts', rec);
  await load();
  scheduleSync();
}

async function saveCat(rec) {
  rec.updated_at = nowIso();
  rec._dirty = true;
  await db.put('categories', rec);
  await load();
  scheduleSync();
}

async function afterSync(res) {
  if (res && res.pulled) {
    await load();
    // No redibujar si el usuario está escribiendo (formulario abierto o campo con foco).
    const editing = ['nuevo', 'editar'].includes(currentRoute().name) || $('#view').contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
    if (!editing) render();
  }
  updateSyncBadge();
}

const catById = (id) => state.cats.find((c) => c.id === id);

// ---------------------------------------------------------------- router
const routes = {
  panel: viewPanel,
  biblioteca: viewLibrary,
  nuevo: () => viewForm(null),
  editar: (id) => viewForm(id),
  categorias: viewCategories,
  guardado: viewSaved,
  ajustes: viewSettings,
};

function currentRoute() {
  const [name, arg] = location.hash.replace(/^#\/?/, '').split('/');
  return { name: routes[name] ? name : 'panel', arg: arg ? decodeURIComponent(arg) : null };
}

function render() {
  const { name, arg } = currentRoute();
  $$('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === (name === 'editar' ? 'nuevo' : name)));
  const view = $('#view');
  view.replaceChildren(routes[name](arg));
  view.focus({ preventScroll: true });
}

export function go(hash) {
  if (location.hash === hash) render(); else location.hash = hash;
}

// ---------------------------------------------------------------- componentes
function highlight(text, terms) {
  text = String(text || '');
  if (!terms.length) return [text];
  // mapa índice normalizado → índice original (para ignorar acentos)
  let normStr = '';
  const map = [];
  for (let i = 0; i < text.length; i++) {
    const n = norm(text[i]);
    for (let k = 0; k < n.length; k++) { normStr += n[k]; map.push(i); }
  }
  const marks = [];
  for (const t of terms) {
    let idx = 0;
    while (t && (idx = normStr.indexOf(t, idx)) !== -1) {
      marks.push([map[idx], map[idx + t.length - 1] + 1]);
      idx += t.length;
    }
  }
  if (!marks.length) return [text];
  marks.sort((a, b) => a[0] - b[0]);
  const out = [];
  let pos = 0;
  for (const [s, e] of marks) {
    if (s < pos) continue;
    out.push(text.slice(pos, s), h('mark', {}, text.slice(s, e)));
    pos = e;
  }
  out.push(text.slice(pos));
  return out;
}

function catChip(c, onClick) {
  return h(onClick ? 'button' : 'span', {
    class: 'chip cat', type: onClick ? 'button' : undefined, style: { '--c': c.color }, onclick: onClick,
  }, c.name);
}

function tagChip(t, onClick) {
  return h(onClick ? 'button' : 'span', { class: 'chip tag', type: onClick ? 'button' : undefined, onclick: onClick }, '#' + t);
}

function postCard(p, terms = [], compact = false) {
  const author = h('div', { class: 'author' },
    h('div', { class: 'avatar', 'aria-hidden': 'true' }, (p.author_name || p.author_handle || '?').trim()[0]?.toUpperCase() || '?'),
    h('div', { class: 'who' },
      h('strong', {}, highlight(p.author_name || (p.author_handle ? '@' + p.author_handle : 'Autor desconocido'), terms)),
      h('span', { class: 'muted' },
        p.author_handle ? h('button', { class: 'linklike', type: 'button', onclick: () => searchFor('@' + p.author_handle) }, '@' + p.author_handle) : '',
        p.posted_at ? ' · ' + fmtDate(p.posted_at) : '')));

  const favBtn = h('button', {
    class: 'icon-btn fav' + (p.favorite ? ' on' : ''), type: 'button',
    title: p.favorite ? 'Quitar de favoritos' : 'Marcar como favorito', 'aria-pressed': String(!!p.favorite),
    onclick: async () => { await savePost({ ...p, favorite: !p.favorite }); render(); },
  }, p.favorite ? '★' : '☆');

  const textEl = h('p', { class: 'text' + (compact ? ' clamp' : '') }, highlight(p.text || '(sin texto guardado)', terms));
  if (!p.text) textEl.classList.add('muted');

  const statusSel = h('select', {
    class: 'status-sel s-' + p.status, 'aria-label': 'Estado',
    onchange: async (e) => { await savePost({ ...p, status: e.target.value }); render(); },
  }, Object.entries(STATUS_LABEL).map(([v, l]) => h('option', { value: v, selected: p.status === v }, l)));

  return h('article', { class: 'card post' + (compact ? ' compact' : '') },
    h('header', { class: 'post-head' }, author, favBtn),
    textEl,
    p.note ? h('p', { class: 'note' }, h('span', { class: 'note-label' }, 'Nota: '), highlight(p.note, terms)) : null,
    (p.categories?.length || p.tags?.length) ? h('div', { class: 'chips' },
      (p.categories || []).map(catById).filter(Boolean).map((c) => catChip(c, () => filterBy({ category: c.id }))),
      (p.tags || []).map((t) => tagChip(t, () => filterBy({ tag: t })))) : null,
    compact ? null : h('footer', { class: 'post-foot' },
      statusSel,
      h('span', { class: 'spacer' }),
      h('a', { class: 'btn ghost sm', href: p.url, target: '_blank', rel: 'noopener noreferrer' }, 'Abrir en X ↗'),
      h('a', { class: 'btn ghost sm', href: '#/editar/' + encodeURIComponent(p.id) }, 'Editar'),
      h('button', {
        class: 'btn ghost sm danger-text', type: 'button',
        onclick: async () => {
          if (!(await confirmDialog('¿Eliminar esta publicación de tu biblioteca? Se borrará en todos tus dispositivos.', 'Eliminar'))) return;
          await savePost({ ...p, deleted_at: nowIso() });
          toast('Publicación eliminada');
          render();
        },
      }, 'Eliminar')));
}

function searchFor(q) { state.q = q; state.f = { ...state.f, category: '', tag: '', status: '', fav: false }; state.limit = 50; go('#/biblioteca'); }
function filterBy(patch) { state.q = ''; state.f = { ...state.f, category: '', tag: '', status: '', fav: false, ...patch }; state.limit = 50; go('#/biblioteca'); }

function emptyState(msg, action) {
  return h('div', { class: 'empty' }, h('p', {}, msg), action || null);
}

// ---------------------------------------------------------------- vista: panel
function viewPanel() {
  const P = state.posts;
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
  const stats = [
    ['Publicaciones', P.length, () => filterBy({})],
    ['Pendientes', P.filter((p) => p.status === 'pendiente').length, () => filterBy({ status: 'pendiente' })],
    ['Favoritas', P.filter((p) => p.favorite).length, () => filterBy({ fav: true })],
    ['Esta semana', P.filter((p) => p.created_at >= weekAgo).length, () => filterBy({ sort: 'saved_desc' })],
  ];

  const count = (arr) => { const m = new Map(); arr.forEach((k) => m.set(k, (m.get(k) || 0) + 1)); return [...m].sort((a, b) => b[1] - a[1]); };
  const topCats = count(P.flatMap((p) => p.categories || [])).filter(([id]) => catById(id)).slice(0, 8);
  const topAuthors = count(P.map((p) => p.author_handle).filter(Boolean)).slice(0, 8);
  const topTags = count(P.flatMap((p) => p.tags || [])).slice(0, 15);
  const maxCat = topCats[0]?.[1] || 1;

  // actividad: guardados por semana (12 semanas)
  const weeks = Array.from({ length: 12 }, (_, i) => {
    const end = Date.now() - i * 7 * 864e5, start = end - 7 * 864e5;
    return { label: fmtDate(new Date(start).toISOString()), n: P.filter((p) => { const t = Date.parse(p.created_at); return t > start && t <= end; }).length };
  }).reverse();
  const maxW = Math.max(1, ...weeks.map((w) => w.n));

  const recent = [...P].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 6);

  const wrap = h('section', { class: 'panel' },
    h('div', { class: 'view-head' }, h('h1', {}, 'Panel'),
      h('a', { class: 'btn primary', href: '#/nuevo' }, '+ Guardar publicación')),
    healthBox(),
    h('div', { class: 'stats' }, stats.map(([label, n, fn]) =>
      h('button', { class: 'stat card', type: 'button', onclick: fn }, h('span', { class: 'stat-n' }, n), h('span', { class: 'stat-l' }, label)))),
    P.length === 0
      ? emptyState('Tu biblioteca está vacía. Pegá la URL de una publicación de X para empezar.', h('a', { class: 'btn primary', href: '#/nuevo' }, 'Guardar la primera'))
      : h('div', { class: 'grid2' },
        h('div', { class: 'card pad' }, h('h2', {}, 'Categorías'),
          topCats.length ? h('ul', { class: 'bars' }, topCats.map(([id, n]) => {
            const c = catById(id);
            return h('li', {}, h('button', { class: 'bar-row', type: 'button', onclick: () => filterBy({ category: id }) },
              h('span', { class: 'bar-label' }, c.name),
              h('span', { class: 'bar-track' }, h('span', { class: 'bar-fill', style: { width: (n / maxCat * 100) + '%', background: c.color } })),
              h('span', { class: 'bar-n' }, n)));
          })) : h('p', { class: 'muted' }, 'Todavía no clasificaste publicaciones.')),
        h('div', { class: 'card pad' }, h('h2', {}, 'Actividad (12 semanas)'),
          h('div', { class: 'spark', role: 'img', 'aria-label': 'Publicaciones guardadas por semana' },
            weeks.map((w) => h('span', { class: 'spark-col', title: `Semana del ${w.label}: ${w.n}` },
              h('span', { class: 'spark-bar', style: { height: Math.max(3, w.n / maxW * 100) + '%' } })))),
          h('p', { class: 'muted small' }, `Total en 12 semanas: ${weeks.reduce((s, w) => s + w.n, 0)}`)),
        h('div', { class: 'card pad' }, h('h2', {}, 'Autores más guardados'),
          topAuthors.length ? h('ol', { class: 'rank' }, topAuthors.map(([a, n]) =>
            h('li', {}, h('button', { class: 'linklike', type: 'button', onclick: () => searchFor('@' + a) }, '@' + a), h('span', { class: 'muted' }, n)))) : h('p', { class: 'muted' }, '—')),
        h('div', { class: 'card pad' }, h('h2', {}, 'Etiquetas'),
          topTags.length ? h('div', { class: 'chips' }, topTags.map(([t, n]) => tagChip(`${t} (${n})`, () => filterBy({ tag: t })))) : h('p', { class: 'muted' }, 'Sin etiquetas todavía.'))),
    recent.length ? h('div', {}, h('div', { class: 'view-head' }, h('h2', {}, 'Recientes'), h('a', { href: '#/biblioteca', class: 'btn ghost sm' }, 'Ver todo →')),
      h('div', { class: 'list' }, recent.map((p) => postCard(p, [], true)))) : null);
  return wrap;
}

function healthBox() {
  const box = h('div', { class: 'health' });
  (async () => {
    const lastBackup = await db.metaGet('lastBackup');
    const pending = await sync.pendingCount();
    const items = [];
    if (!cloud.getConfig()) items.push(h('span', { class: 'pill' }, '💾 Modo local (sin sincronización) · ', h('a', { href: '#/ajustes' }, 'activar nube')));
    else if (!cloud.getSession()) items.push(h('span', { class: 'pill warn' }, '🔒 Iniciá sesión para sincronizar · ', h('a', { href: '#/ajustes' }, 'Ajustes')));
    else {
      const st = sync.getStatus();
      items.push(h('span', { class: 'pill' + (st.state === 'error' ? ' warn' : '') },
        st.state === 'error' ? '⚠️ ' + st.error : `☁️ Sincronizado ${timeAgo(st.at || (await db.metaGet('lastSync')))}`));
    }
    if (pending && cloud.getConfig()) items.push(h('span', { class: 'pill' }, `⏳ ${pending} cambio(s) por subir`));
    const days = lastBackup ? (Date.now() - Date.parse(lastBackup)) / 864e5 : Infinity;
    if (state.posts.length && days > 14) items.push(h('span', { class: 'pill warn' }, lastBackup ? `🗂️ Último respaldo ${timeAgo(lastBackup)} · ` : '🗂️ Nunca exportaste un respaldo · ',
      h('button', { class: 'linklike', type: 'button', onclick: async () => { const c = await backup.exportJSON(); toast(`Respaldo descargado (${c.posts} publicaciones)`); render(); } }, 'exportar ahora')));
    box.replaceChildren(...items);
  })();
  return box;
}

// ---------------------------------------------------------------- vista: biblioteca
function viewLibrary() {
  const resultsBox = h('div', { class: 'list' });
  const countEl = h('p', { class: 'muted small', 'aria-live': 'polite' });
  const allTags = [...new Set(state.posts.flatMap((p) => p.tags || []))].sort();

  const update = () => {
    const res = search(state.posts, state.cats, state.q, state.f);
    const terms = highlightTerms(state.q);
    countEl.textContent = `${res.length} de ${state.posts.length} publicaciones`;
    const shown = res.slice(0, state.limit);
    resultsBox.replaceChildren(
      ...(res.length ? shown.map((p) => postCard(p, terms)) : [emptyState(state.posts.length ? 'No hay resultados con esos filtros.' : 'Todavía no guardaste publicaciones.')]),
      ...(res.length > state.limit ? [h('button', { class: 'btn ghost wide', type: 'button', onclick: () => { state.limit += 50; update(); } }, `Mostrar más (${res.length - state.limit} restantes)`)] : []));
  };

  const input = h('input', {
    type: 'search', class: 'search-input', placeholder: 'Buscar: palabras, @usuario, #etiqueta, cat:nombre, pendiente, fav…',
    value: state.q, 'aria-label': 'Buscar', autocomplete: 'off',
    oninput: debounce((e) => { state.q = e.target.value; state.limit = 50; update(); }, 120),
  });

  const sel = (key, label, options) => h('label', { class: 'filter' }, h('span', {}, label),
    h('select', { onchange: (e) => { state.f[key] = e.target.value; state.limit = 50; update(); } },
      options.map(([v, l]) => h('option', { value: v, selected: state.f[key] === v }, l))));

  const favToggle = h('label', { class: 'filter check' },
    h('input', { type: 'checkbox', checked: state.f.fav, onchange: (e) => { state.f.fav = e.target.checked; update(); } }), h('span', {}, '★ Solo favoritas'));

  const view = h('section', {},
    h('div', { class: 'view-head' }, h('h1', {}, 'Biblioteca'), h('a', { class: 'btn primary', href: '#/nuevo' }, '+ Guardar')),
    h('div', { class: 'searchbar' }, input,
      h('details', { class: 'help' }, h('summary', {}, '¿Cómo buscar?'),
        h('ul', {},
          h('li', {}, h('code', {}, 'clima energía'), ' → contiene ambas palabras (ignora acentos)'),
          h('li', {}, h('code', {}, '@usuario'), ' → por autor'),
          h('li', {}, h('code', {}, '#etiqueta'), ' → por etiqueta'),
          h('li', {}, h('code', {}, 'cat:Economía'), ' o ', h('code', {}, 'cat:"Dos palabras"'), ' → por categoría'),
          h('li', {}, h('code', {}, 'pendiente'), ', ', h('code', {}, 'leido'), ', ', h('code', {}, 'fav'), ' → por estado'),
          h('li', {}, h('code', {}, '-palabra'), ' → excluye')))),
    h('div', { class: 'filters' },
      sel('category', 'Categoría', [['', 'Todas'], ...state.cats.map((c) => [c.id, c.name]), ['__none__', 'Sin categoría']]),
      sel('tag', 'Etiqueta', [['', 'Todas'], ...allTags.map((t) => [t, '#' + t])]),
      sel('status', 'Estado', [['', 'Todos'], ...Object.entries(STATUS_LABEL)]),
      sel('sort', 'Orden', [['saved_desc', 'Guardadas recientes'], ['saved_asc', 'Guardadas antiguas'], ['posted_desc', 'Publicadas recientes'], ['posted_asc', 'Publicadas antiguas'], ['author', 'Autor A-Z']]),
      favToggle,
      h('button', { class: 'btn ghost sm', type: 'button', onclick: () => { state.q = ''; state.f = { category: '', tag: '', status: '', fav: false, sort: 'saved_desc' }; render(); } }, 'Limpiar')),
    countEl, resultsBox);
  update();
  setTimeout(() => { if (matchMedia('(min-width: 800px)').matches) input.focus(); }, 0);
  return view;
}

// ---------------------------------------------------------------- vista: formulario
function viewForm(id) {
  const existing = id ? state.posts.find((p) => p.id === id) : null;
  if (id && !existing) return emptyState('No encontré esa publicación (¿fue eliminada?).', h('a', { class: 'btn', href: '#/biblioteca' }, 'Volver'));

  const pre = !existing && state.prefill ? state.prefill : null;
  state.prefill = null;
  const p = existing ? { ...existing } : {
    id: uuid(), url: pre?.url || '', tweet_id: null, author_name: '', author_handle: '', text: pre?.text || '', posted_at: null,
    note: '', categories: [], tags: [], favorite: false, status: 'pendiente', created_at: nowIso(), deleted_at: null,
  };

  const f = {};
  const field = (key, label, el, hint) => { f[key] = el; return h('label', { class: 'field' }, h('span', { class: 'label' }, label), el, hint ? h('span', { class: 'hint' }, hint) : null); };
  const metaMsg = h('p', { class: 'meta-msg small', 'aria-live': 'polite' });
  const dupMsg = h('p', { class: 'meta-msg warn small' });

  const urlInput = h('input', { type: 'url', required: true, placeholder: 'https://x.com/usuario/status/123…', value: p.url, inputmode: 'url', autocomplete: 'off' });
  const fetchBtn = h('button', { class: 'btn', type: 'button', onclick: () => doFetch(true) }, 'Obtener datos');

  let lastFetched = '';
  async function doFetch(force = false) {
    const parsed = parseXUrl(urlInput.value);
    dupMsg.textContent = '';
    if (!parsed) { if (urlInput.value.trim()) metaMsg.textContent = 'Pegá un enlace del tipo x.com/usuario/status/123…'; return; }
    urlInput.value = parsed.url;
    const dup = state.posts.find((x) => x.tweet_id === parsed.tweetId && x.id !== p.id);
    if (dup) dupMsg.replaceChildren('Ya guardaste esta publicación. ', h('a', { href: '#/editar/' + dup.id }, 'Abrir la existente'));
    if (!force && lastFetched === parsed.url) return;
    lastFetched = parsed.url;
    // datos que no requieren red
    if (!f.author_handle.value) f.author_handle.value = parsed.handle;
    if (!f.posted_at.value) { const d = dateFromTweetId(parsed.tweetId); if (d) f.posted_at.value = d.slice(0, 10); }
    metaMsg.textContent = 'Buscando datos…';
    fetchBtn.disabled = true;
    const m = await fetchMeta(parsed.url);
    fetchBtn.disabled = false;
    if (m.error) { metaMsg.textContent = m.error; return; }
    if (m.author_name && (force || !f.author_name.value)) f.author_name.value = m.author_name;
    if (m.text && (force || !f.text.value)) f.text.value = m.text;
    metaMsg.textContent = m.fetched ? '✓ Texto y autor obtenidos de X (oEmbed oficial).' : (m.warning || '');
    metaMsg.className = 'meta-msg small ' + (m.fetched ? 'ok' : 'warn');
  }
  urlInput.addEventListener('paste', () => setTimeout(() => doFetch(), 0));
  urlInput.addEventListener('change', () => doFetch());

  // categorías como chips seleccionables
  const selected = new Set(p.categories || []);
  const catBox = h('div', { class: 'chips selectable' });
  const drawCats = () => catBox.replaceChildren(
    ...state.cats.map((c) => h('button', {
      type: 'button', class: 'chip cat' + (selected.has(c.id) ? ' on' : ''), style: { '--c': c.color }, 'aria-pressed': String(selected.has(c.id)),
      onclick: () => { selected.has(c.id) ? selected.delete(c.id) : selected.add(c.id); drawCats(); },
    }, (selected.has(c.id) ? '✓ ' : '') + c.name)),
    h('button', {
      type: 'button', class: 'chip add', onclick: async () => {
        const name = prompt('Nombre de la nueva categoría:');
        if (!name?.trim()) return;
        const exists = state.cats.find((c) => norm(c.name) === norm(name.trim()));
        if (exists) { selected.add(exists.id); drawCats(); return; }
        const c = { id: uuid(), name: name.trim().slice(0, 60), color: PALETTE[state.cats.length % PALETTE.length], created_at: nowIso(), deleted_at: null };
        await saveCat(c);
        selected.add(c.id); drawCats();
      },
    }, '+ Nueva categoría'));
  drawCats();

  const allTags = [...new Set(state.posts.flatMap((x) => x.tags || []))].sort();
  const tagList = h('datalist', { id: 'tag-suggest' }, allTags.map((t) => h('option', { value: t })));

  const form = h('form', { class: 'card pad form', novalidate: true },
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'URL de la publicación *'),
      h('div', { class: 'row' }, urlInput, fetchBtn), metaMsg, dupMsg),
    h('div', { class: 'grid2 tight' },
      field('author_name', 'Autor (nombre)', h('input', { type: 'text', value: p.author_name || '', maxlength: 200 })),
      field('author_handle', 'Usuario', h('input', { type: 'text', value: p.author_handle ? '@' + p.author_handle : '', maxlength: 51, placeholder: '@usuario' }))),
    field('posted_at', 'Fecha de publicación', h('input', { type: 'date', value: p.posted_at ? p.posted_at.slice(0, 10) : '' })),
    field('text', 'Texto de la publicación', h('textarea', { rows: 5, maxlength: 10000 }, p.text || ''), 'Se completa solo si activaste la función x-oembed; si no, pegalo a mano.'),
    field('note', 'Nota personal', h('textarea', { rows: 3, maxlength: 20000, placeholder: '¿Por qué la guardás?' }, p.note || '')),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Categorías'), catBox),
    field('tags', 'Etiquetas', h('input', { type: 'text', value: (p.tags || []).join(', '), list: 'tag-suggest', placeholder: 'ia, hilo, datos', autocapitalize: 'none' }), 'Separadas por comas o espacios.'),
    tagList,
    h('div', { class: 'grid2 tight' },
      field('status', 'Estado', h('select', {}, Object.entries(STATUS_LABEL).map(([v, l]) => h('option', { value: v, selected: p.status === v }, l)))),
      h('label', { class: 'field check big' }, (f.favorite = h('input', { type: 'checkbox', checked: !!p.favorite })), h('span', {}, '★ Favorita'))),
    h('div', { class: 'row end sticky-actions' },
      h('a', { class: 'btn ghost', href: existing ? '#/biblioteca' : '#/panel' }, 'Cancelar'),
      existing ? null : h('button', { class: 'btn', type: 'submit', value: 'again' }, 'Guardar y otra'),
      h('button', { class: 'btn primary', type: 'submit', value: 'save' }, existing ? 'Guardar cambios' : 'Guardar')));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const parsed = parseXUrl(urlInput.value);
    if (!parsed) { metaMsg.textContent = 'La URL debe ser de una publicación de X (x.com/usuario/status/…).'; metaMsg.className = 'meta-msg small warn'; urlInput.focus(); return; }
    const dup = state.posts.find((x) => x.tweet_id === parsed.tweetId && x.id !== p.id);
    if (dup && !(await confirmDialog('Esta publicación ya está en tu biblioteca. ¿Guardar un duplicado igualmente?', 'Guardar duplicado'))) return;
    const dateVal = f.posted_at.value;
    const rec = {
      ...p,
      url: parsed.url,
      tweet_id: parsed.tweetId,
      author_name: f.author_name.value.trim() || null,
      author_handle: f.author_handle.value.trim().replace(/^@/, '') || parsed.handle,
      posted_at: dateVal ? (p.posted_at && p.posted_at.slice(0, 10) === dateVal ? p.posted_at : new Date(dateVal + 'T12:00:00').toISOString()) : null,
      text: f.text.value.trim() || null,
      note: f.note.value.trim() || null,
      categories: [...selected].filter((cid) => catById(cid)),
      tags: cleanTags(f.tags.value),
      status: f.status.value,
      favorite: f.favorite.checked,
    };
    await savePost(rec);
    toast(existing ? 'Cambios guardados' : 'Publicación guardada ✓', 'ok');
    if (e.submitter?.value === 'again') { go('#/nuevo'); } else go(existing ? '#/biblioteca' : '#/panel');
  });

  if (pre?.url) setTimeout(() => doFetch(), 0);
  else if (!existing) setTimeout(() => urlInput.focus(), 0);

  return h('section', {},
    h('div', { class: 'view-head' }, h('h1', {}, existing ? 'Editar publicación' : 'Guardar publicación')),
    form);
}

// ---------------------------------------------------------------- vista: categorías
function viewCategories() {
  const counts = new Map();
  state.posts.forEach((p) => (p.categories || []).forEach((id) => counts.set(id, (counts.get(id) || 0) + 1)));
  const nameIn = h('input', { type: 'text', placeholder: 'Nueva categoría (ej. Economía)', maxlength: 60, required: true });
  const colorIn = h('input', { type: 'color', value: PALETTE[state.cats.length % PALETTE.length], 'aria-label': 'Color' });

  const addForm = h('form', { class: 'row card pad', onsubmit: async (e) => {
    e.preventDefault();
    const name = nameIn.value.trim();
    if (!name) return;
    if (state.cats.some((c) => norm(c.name) === norm(name))) { toast('Ya existe una categoría con ese nombre', 'error'); return; }
    await saveCat({ id: uuid(), name, color: colorIn.value, created_at: nowIso(), deleted_at: null });
    toast('Categoría creada', 'ok');
    render();
  } }, nameIn, colorIn, h('button', { class: 'btn primary', type: 'submit' }, 'Agregar'));

  const rows = state.cats.map((c) => {
    const nm = h('input', { type: 'text', value: c.name, maxlength: 60, 'aria-label': 'Nombre' });
    const col = h('input', { type: 'color', value: c.color, 'aria-label': 'Color' });
    const saveIfChanged = async () => {
      const name = nm.value.trim();
      if (!name) { nm.value = c.name; return; }
      if (name === c.name && col.value === c.color) return;
      if (state.cats.some((o) => o.id !== c.id && norm(o.name) === norm(name))) { toast('Ese nombre ya existe', 'error'); nm.value = c.name; return; }
      await saveCat({ ...c, name, color: col.value });
      toast('Categoría actualizada', 'ok');
    };
    nm.addEventListener('change', saveIfChanged);
    col.addEventListener('change', saveIfChanged);
    return h('li', { class: 'cat-row card' },
      col, nm,
      h('button', { class: 'btn ghost sm', type: 'button', onclick: () => filterBy({ category: c.id }) }, `${counts.get(c.id) || 0} publ.`),
      h('button', { class: 'btn ghost sm danger-text', type: 'button', onclick: async () => {
        const n = counts.get(c.id) || 0;
        if (!(await confirmDialog(`¿Eliminar la categoría "${c.name}"? ${n ? `Se quitará de ${n} publicación(es); las publicaciones NO se borran.` : ''}`, 'Eliminar'))) return;
        const affected = state.posts.filter((p) => (p.categories || []).includes(c.id));
        const ts = nowIso();
        await db.putMany('posts', affected.map((p) => ({ ...p, categories: p.categories.filter((x) => x !== c.id), updated_at: ts, _dirty: true })));
        await saveCat({ ...c, deleted_at: ts });
        toast('Categoría eliminada');
        render();
      } }, 'Eliminar'));
  });

  return h('section', {},
    h('div', { class: 'view-head' }, h('h1', {}, 'Categorías')),
    h('p', { class: 'muted' }, 'Creá tus propias categorías. Una publicación puede tener varias. Los cambios se guardan al salir de cada campo.'),
    addForm,
    rows.length ? h('ul', { class: 'cat-list' }, rows) : emptyState('Todavía no creaste categorías.'));
}

// ---------------------------------------------------------------- vista: ajustes
function viewSettings() {
  const cfg = cloud.getConfig();
  const ses = cloud.getSession();
  const appUrl = location.origin + location.pathname;

  // --- nube
  const cloudCard = h('div', { class: 'card pad' }, h('h2', {}, '☁️ Sincronización (Supabase, plan gratuito)'));
  if (!cfg) {
    const u = h('input', { type: 'url', placeholder: 'https://xxxxxxxx.supabase.co', required: true, autocomplete: 'off' });
    const k = h('input', { type: 'text', placeholder: 'sb_publishable_… (o clave anon)', required: true, autocomplete: 'off', spellcheck: 'false' });
    cloudCard.append(
      h('p', { class: 'muted' }, 'Opcional. Sin esto la app funciona igual, pero solo en este dispositivo. Seguí la guía (README) para crear tu proyecto gratis.'),
      h('form', { class: 'form', onsubmit: (e) => {
        e.preventDefault();
        try { cloud.setConfig(u.value, k.value); toast('Nube configurada. Ahora iniciá sesión.', 'ok'); render(); }
        catch (err) { toast(err.message, 'error'); }
      } },
      h('label', { class: 'field' }, h('span', { class: 'label' }, 'Project URL'), u),
      h('label', { class: 'field' }, h('span', { class: 'label' }, 'Clave pública (Publishable / anon)'), k,
        h('span', { class: 'hint' }, 'Nunca pegues la clave secreta ni la service_role: la app las rechaza.')),
      h('button', { class: 'btn primary', type: 'submit' }, 'Guardar configuración')));
  } else if (!ses) {
    const em = h('input', { type: 'email', required: true, autocomplete: 'username' });
    const pw = h('input', { type: 'password', required: true, autocomplete: 'current-password' });
    cloudCard.append(
      h('p', { class: 'muted small' }, 'Proyecto: ', h('code', {}, cfg.url)),
      h('form', { class: 'form', onsubmit: async (e) => {
        e.preventDefault();
        const btn = e.submitter; btn.disabled = true;
        try {
          await cloud.signIn(em.value.trim(), pw.value);
        } catch (err) { toast(err.message, 'error'); btn.disabled = false; pw.select(); return; }
        toast('Sesión iniciada. Sincronizando…', 'ok');
        try { await sync.syncNow().then(afterSync); toast('Sincronización completa ✓', 'ok'); }
        catch (err) { toast(err.message, 'error'); }
        await load(); render();
      } },
      h('label', { class: 'field' }, h('span', { class: 'label' }, 'Email'), em),
      h('label', { class: 'field' }, h('span', { class: 'label' }, 'Contraseña'), pw),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'submit' }, 'Iniciar sesión'),
        h('button', { class: 'btn ghost', type: 'button', onclick: () => { cloud.clearConfig(); render(); } }, 'Cambiar proyecto'))));
  } else {
    const st = sync.getStatus();
    const info = h('p', {}, 'Conectado como ', h('strong', {}, ses.user?.email || '—'), '.');
    const stEl = h('p', { class: 'muted small' }, st.state === 'error' ? '⚠️ ' + st.error : 'Última sincronización: ' + timeAgo(st.at));
    (async () => { if (!st.at) stEl.textContent = 'Última sincronización: ' + timeAgo(await db.metaGet('lastSync')); })();
    cloudCard.append(info, stEl,
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn primary', type: 'button', onclick: async (e) => {
          e.target.disabled = true;
          try { const r = await sync.syncNow(); await afterSync(r); toast(`Sincronizado ✓ (subidos ${r?.pushed ?? 0}, recibidos ${r?.pulled ?? 0})`, 'ok'); }
          catch (err) { toast(err.message, 'error'); }
          e.target.disabled = false; render();
        } }, 'Sincronizar ahora'),
        h('button', { class: 'btn ghost', type: 'button', onclick: async () => { await cloud.signOut(); toast('Sesión cerrada. Tus datos siguen en este dispositivo.'); render(); } }, 'Cerrar sesión'),
        h('button', { class: 'btn ghost', type: 'button', onclick: () => {
          const link = `${appUrl}#cfg=${btoa(JSON.stringify({ u: cfg.url, k: cfg.key }))}`;
          navigator.clipboard?.writeText(link).then(() => toast('Enlace copiado: abrilo en tu otro dispositivo', 'ok'), () => prompt('Copiá este enlace:', link));
        } }, 'Copiar enlace de configuración para otro dispositivo')),
      h('p', { class: 'hint' }, 'El enlace de configuración contiene solo la URL y la clave PÚBLICA (no tu contraseña).'));
  }

  // --- respaldo
  const fileIn = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  const modeSel = h('select', {}, h('option', { value: 'merge' }, 'Combinar con lo actual (recomendado)'), h('option', { value: 'replace' }, 'Reemplazar todo por el archivo'));
  fileIn.addEventListener('change', async () => {
    const file = fileIn.files[0];
    if (!file) return;
    try {
      if (modeSel.value === 'replace' && !(await confirmDialog('Esto eliminará tu biblioteca actual (en todos los dispositivos) y dejará solo el contenido del archivo. ¿Continuar?', 'Reemplazar'))) return;
      const r = await backup.importJSON(await file.text(), modeSel.value);
      await load();
      scheduleSync();
      toast(`Importado: ${r.added} nuevas, ${r.updated} actualizadas, ${r.skipped} sin cambios`, 'ok');
      render();
    } catch (err) { toast(err.message, 'error'); }
    fileIn.value = '';
  });
  const backupCard = h('div', { class: 'card pad' }, h('h2', {}, '🗂️ Copias de seguridad'),
    h('p', { class: 'muted' }, 'El respaldo JSON contiene toda tu biblioteca (publicaciones, notas, categorías y etiquetas) en un formato abierto. Guardalo en tu PC, un pendrive o tu nube personal.'),
    h('div', { class: 'row wrap' },
      h('button', { class: 'btn primary', type: 'button', onclick: async () => { const c = await backup.exportJSON(); toast(`Respaldo descargado (${c.posts} publicaciones)`, 'ok'); } }, 'Exportar respaldo (.json)'),
      h('button', { class: 'btn', type: 'button', onclick: () => backup.exportCSV() }, 'Exportar planilla (.csv)')),
    h('div', { class: 'row wrap' }, modeSel, h('button', { class: 'btn', type: 'button', onclick: () => fileIn.click() }, 'Importar respaldo…'), fileIn));

  // --- guardado rápido
  const bookmarklet = `javascript:(()=>{const u=location.href;window.open('${appUrl}?url='+encodeURIComponent(u),'_blank')})()`;
  const bmLink = h('a', { class: 'btn bookmarklet', href: '#', title: 'Arrastrame a la barra de marcadores' }, '＋ Guardar en XBiblioteca');
  bmLink.setAttribute('href', bookmarklet); // se asigna aparte: el navegador lo trata como marcador al arrastrar
  bmLink.addEventListener('click', (e) => { e.preventDefault(); toast('Arrastrá este botón a tu barra de marcadores'); });

  const quickCard = h('div', { class: 'card pad' }, h('h2', {}, '⚡ Guardado rápido'),
    h('label', { class: 'field check' },
      h('input', { type: 'checkbox', checked: quickEnabled(), onchange: (e) => { setQuickEnabled(e.target.checked); toast(e.target.checked ? 'Compartir guarda al instante' : 'Compartir abre el formulario'); } }),
      h('span', {}, h('strong', {}, 'Guardar al instante al compartir'), ' (sin formulario; las categorías se eligen después)')),
    h('h3', {}, 'En la PC (cualquier navegador)'),
    h('p', {}, 'Arrastrá este botón a tu barra de marcadores. Cuando estés viendo una publicación en x.com, hacé clic en él:'),
    h('p', {}, bmLink),
    h('details', {}, h('summary', {}, 'Si no podés arrastrarlo'),
      h('p', { class: 'small' }, 'Creá un marcador nuevo, poné de nombre "Guardar en XBiblioteca" y pegá esto como URL:'),
      h('textarea', { class: 'mono', rows: 3, readonly: true, onclick: (e) => e.target.select() }, bookmarklet)),
    h('h3', {}, 'En Android'),
    h('p', {}, 'Instalá la app (botón de abajo o menú ⋮ → "Instalar app" / "Agregar a pantalla principal"). Después, en la app de X tocá ', h('em', {}, 'Compartir → XBiblioteca'), '.'),
    h('h3', {}, 'En iPhone / iPad'),
    h('p', {}, 'iOS no permite que una web aparezca en el menú Compartir; se usa un Atajo gratuito de Apple. En la app Atajos: nuevo atajo → activar "Mostrar en hoja para compartir" (acepta URL y texto) → acción "Abrir URL" con:'),
    h('textarea', { class: 'mono', rows: 2, readonly: true, onclick: (e) => e.target.select() }, `${appUrl}?url=[Entrada del atajo]`),
    h('p', { class: 'hint' }, 'Detalle paso a paso en la guía (README). Alternativa: copiar el enlace en X y tocar "Pegar" en Guardar.'));

  const installBtn = h('button', { class: 'btn primary', type: 'button', hidden: !state.installEvt, onclick: async () => {
    state.installEvt?.prompt(); await state.installEvt?.userChoice; state.installEvt = null; render();
  } }, 'Instalar XBiblioteca en este dispositivo');

  // --- datos locales
  const localCard = h('div', { class: 'card pad' }, h('h2', {}, '📱 Este dispositivo'),
    installBtn,
    h('p', { class: 'muted small' }, `Versión ${APP_VERSION} · ${state.posts.length} publicaciones guardadas localmente.`),
    h('button', { class: 'btn ghost danger-text', type: 'button', onclick: async () => {
      if (!(await confirmDialog('Borra los datos de ESTE dispositivo (no los de la nube). Si no usás la nube, exportá un respaldo antes. ¿Continuar?', 'Borrar datos locales'))) return;
      await db.clear('posts'); await db.clear('categories'); await db.metaSet('cursors', {}); await db.metaSet('cloudUser', null);
      await load(); toast('Datos locales borrados'); render();
    } }, 'Borrar datos de este dispositivo'),
    cfg ? h('button', { class: 'btn ghost', type: 'button', onclick: async () => {
      if (!(await confirmDialog('¿Desconectar la nube en este dispositivo? Se cierra la sesión y se olvida la configuración; tus datos locales quedan.', 'Desconectar'))) return;
      await cloud.signOut(); cloud.clearConfig(); render();
    } }, 'Desconectar la nube') : null);

  return h('section', { class: 'settings' }, h('div', { class: 'view-head' }, h('h1', {}, 'Ajustes')), cloudCard, backupCard, quickCard, localCard);
}

// ---------------------------------------------------------------- arranque
function updateSyncBadge() {
  const b = $('#sync-btn');
  if (!b) return;
  const st = sync.getStatus();
  const map = {
    local: ['💾', 'Modo local'], login: ['🔒', 'Iniciá sesión'], syncing: ['🔄', 'Sincronizando…'],
    ok: ['☁️', 'Sincronizado'], error: ['⚠️', st.error || 'Error'], offline: ['📴', 'Sin conexión'], idle: ['☁️', 'Sincronizar'],
  };
  const key = !cloud.getConfig() ? 'local' : !cloud.getSession() ? 'login' : !navigator.onLine ? 'offline' : st.state;
  const [icon, label] = map[key] || map.idle;
  b.replaceChildren(h('span', { 'aria-hidden': 'true' }, icon), h('span', { class: 'sync-label' }, label));
  b.title = label;
  b.classList.toggle('spin', key === 'syncing');
  b.classList.toggle('warn', key === 'error' || key === 'login');
}

function handleIncoming() {
  // 1) configuración compartida desde otro dispositivo (#cfg=…)
  const m = /#cfg=([A-Za-z0-9+/=]+)/.exec(location.hash);
  if (m) {
    try {
      const { u, k } = JSON.parse(atob(m[1]));
      cloud.setConfig(u, k);
      toast('Nube configurada. Iniciá sesión para sincronizar.', 'ok');
    } catch (e) { toast('Enlace de configuración inválido: ' + e.message, 'error'); }
    history.replaceState(null, '', location.pathname + '#/ajustes');
    return;
  }
  // 2) URL compartida (Compartir de Android, Atajo de iOS o bookmarklet)
  const params = new URLSearchParams(location.search);
  if (params.has('url') || params.has('text') || params.has('title')) {
    // Se revisan todos los parámetros y la dirección completa (los Atajos de iOS
    // a veces mandan el enlace sin codificar o partido en varios parámetros).
    let full = location.search + ' ' + location.hash;
    try { full = decodeURIComponent(full); } catch { /* texto con % sueltos */ }
    const blob = [...params.values(), full].filter(Boolean).join(' ');
    const parsed = parseXUrl(blob);
    if (!parsed) {
      const got = [...params.values()].join(' ').trim();
      state.received = got ? got.slice(0, 120) : '(vacío: el Atajo no envió nada)';
    }
    if (parsed && quickEnabled()) {
      state.quick = parsed;               // guardado instantáneo, sin formulario
      history.replaceState(null, '', location.pathname + '#/guardado');
    } else {
      state.prefill = parsed ? { url: parsed.url } : null;
      history.replaceState(null, '', location.pathname + '#/nuevo');
      if (!parsed) toast(`Lo compartido no contiene un enlace de publicación de X. Recibido: ${state.received}`, 'error');
    }
  }
}

// ---------------------------------------------------------------- guardado instantáneo
const QUICK_KEY = 'xb.quickSave';
function quickEnabled() { try { return localStorage.getItem(QUICK_KEY) !== '0'; } catch { return true; } }
function setQuickEnabled(on) { try { localStorage.setItem(QUICK_KEY, on ? '1' : '0'); } catch { /* nada */ } }

function setQuickStatus(text, kind = '') {
  state.quickStatus = { text, kind };
  const el = $('#quick-status');
  if (el) { el.textContent = text; el.className = 'quick-status ' + kind; }
}

/** Guarda la publicación al instante y completa texto/autor en segundo plano. */
async function quickSave(parsed) {
  const dup = state.posts.find((p) => p.tweet_id === parsed.tweetId);
  if (dup) {
    state.quickId = dup.id;
    setQuickStatus('Esta publicación ya estaba en tu biblioteca.', 'warn');
    return;
  }
  const rec = {
    id: uuid(), url: parsed.url, tweet_id: parsed.tweetId, author_name: null, author_handle: parsed.handle,
    text: null, posted_at: dateFromTweetId(parsed.tweetId), note: null, categories: [], tags: [],
    favorite: false, status: 'pendiente', created_at: nowIso(), deleted_at: null,
  };
  state.quickId = rec.id;
  await savePost(rec);
  setQuickStatus('✓ Guardada. Buscando el texto…', 'ok');

  (async () => {
    const m = await fetchMeta(parsed.url);
    const cur = await db.get('posts', rec.id);
    if (cur && !cur.deleted_at && m.fetched) {
      await savePost({ ...cur, author_name: cur.author_name || m.author_name || null, text: cur.text || m.text || null });
    }
    let msg = m.fetched ? '✓ Guardada con texto y autor.' : '✓ Guardada (sin texto: podés agregarlo al editar).';
    if (cloud.isReady()) {
      try { await sync.syncNow(); msg += ' ☁️ Sincronizada.'; }
      catch { msg += ' Se sincronizará cuando haya conexión.'; }
    }
    setQuickStatus(msg, 'ok');
    if (currentRoute().name === 'guardado') render();
  })();
}

function viewSaved() {
  const p = state.posts.find((x) => x.id === state.quickId);
  if (!p) return emptyState('No hay una publicación recién guardada.', h('a', { class: 'btn', href: '#/panel' }, 'Ir al panel'));
  const sel = new Set(p.categories || []);
  const chips = h('div', { class: 'chips selectable' },
    state.cats.map((c) => h('button', {
      type: 'button', class: 'chip cat' + (sel.has(c.id) ? ' on' : ''), style: { '--c': c.color }, 'aria-pressed': String(sel.has(c.id)),
      onclick: async () => {
        const cur = state.posts.find((x) => x.id === p.id);
        const set = new Set(cur.categories || []);
        set.has(c.id) ? set.delete(c.id) : set.add(c.id);
        await savePost({ ...cur, categories: [...set] });
        render();
      },
    }, (sel.has(c.id) ? '✓ ' : '') + c.name)));
  const st = state.quickStatus || { text: '', kind: '' };
  return h('section', { class: 'saved-view' },
    h('div', { class: 'view-head' }, h('h1', {}, 'Publicación guardada')),
    h('p', { id: 'quick-status', class: 'quick-status ' + st.kind, 'aria-live': 'polite' }, st.text),
    postCard(p, [], true),
    h('div', { class: 'card pad' },
      h('h2', {}, 'Categorías (opcional)'),
      state.cats.length ? chips : h('p', { class: 'muted' }, 'Todavía no creaste categorías. ', h('a', { href: '#/categorias' }, 'Crear una')),
      h('p', { class: 'hint' }, 'Se guardan al tocarlas. Ya podés volver a X.')),
    h('div', { class: 'row wrap' },
      h('a', { class: 'btn', href: '#/editar/' + encodeURIComponent(p.id) }, 'Agregar nota o etiquetas'),
      h('a', { class: 'btn ghost', href: '#/biblioteca' }, 'Ir a la biblioteca')));
}

async function init() {
  handleIncoming();
  await db.requestPersistence();
  await load();
  sync.onStatus(updateSyncBadge);
  $('#sync-btn').addEventListener('click', async () => {
    if (!cloud.isReady()) { go('#/ajustes'); return; }
    try { const r = await sync.syncNow(); await afterSync(r); toast('Sincronizado ✓', 'ok'); }
    catch (e) { toast(e.message, 'error'); }
  });
  window.addEventListener('hashchange', render);
  window.addEventListener('online', () => { updateSyncBadge(); scheduleSync(); });
  window.addEventListener('offline', updateSyncBadge);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') scheduleSync(); });
  setInterval(() => { if (document.visibilityState === 'visible') sync.syncNow().then(afterSync).catch(() => {}); }, 120000);
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); state.installEvt = e; if (currentRoute().name === 'ajustes') render(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) { e.preventDefault(); go('#/biblioteca'); }
  });
  updateSyncBadge();
  if (state.quick) {
    const q = state.quick; state.quick = null;
    await quickSave(q);
    render();
  } else {
    render();
    if (cloud.isReady()) sync.syncNow().then(afterSync).catch(() => {});
  }
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('./sw.js').catch(() => {});
}

init().catch((e) => {
  console.error(e);
  $('#view').replaceChildren(h('div', { class: 'empty' }, h('p', {}, 'No se pudo iniciar la app: ' + e.message),
    h('p', { class: 'small muted' }, 'Si usás navegación privada, IndexedDB puede estar deshabilitado.')));
});
