// Utilidades generales (sin dependencias)

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Crea un elemento. Los textos siempre se insertan como texto (nunca HTML). */
export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) sk.startsWith('--') ? node.style.setProperty(sk, sv) : (node.style[sk] = sv);
    }
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export const uuid = () =>
  crypto.randomUUID ? crypto.randomUUID()
    : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c =>
        (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));

export const nowIso = () => new Date().toISOString();

/** Minúsculas y sin acentos, para búsquedas. */
export const norm = (s) => String(s ?? '')
  .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function fmtDate(iso, withTime = false) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('es-AR', {
    day: 'numeric', month: 'short', year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

export function timeAgo(iso) {
  if (!iso) return 'nunca';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'hace instantes';
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  const d = Math.floor(s / 86400);
  return d === 1 ? 'hace 1 día' : `hace ${d} días`;
}

/** Normaliza una lista de etiquetas: sin #, minúsculas, sin repetidos. */
export function cleanTags(input) {
  const arr = Array.isArray(input) ? input : String(input ?? '').split(/[,\s]+/);
  const out = [];
  for (let t of arr) {
    t = String(t).trim().replace(/^#+/, '').toLowerCase().slice(0, 40);
    if (t && !out.includes(t)) out.push(t);
  }
  return out.slice(0, 30);
}

let toastTimer;
export function toast(msg, kind = 'info') {
  let box = $('#toast');
  if (!box) { box = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' }); document.body.append(box); }
  box.textContent = msg;
  box.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (box.className = ''), kind === 'error' ? 6000 : 3000);
}

export function download(filename, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export function debounce(fn, ms = 200) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function confirmDialog(message, okText = 'Aceptar') {
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: 'dialog' },
      h('p', {}, message),
      h('div', { class: 'row end' },
        h('button', { class: 'btn ghost', value: 'no' }, 'Cancelar'),
        h('button', { class: 'btn danger', value: 'yes' }, okText)));
    document.body.append(dlg);
    dlg.addEventListener('click', (e) => {
      if (e.target.tagName === 'BUTTON') { dlg.close(e.target.value); }
    });
    dlg.addEventListener('close', () => { resolve(dlg.returnValue === 'yes'); dlg.remove(); });
    dlg.showModal();
  });
}
