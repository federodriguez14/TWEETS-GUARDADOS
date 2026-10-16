// Almacenamiento local en IndexedDB: la app funciona sin conexión y
// la nube (si está configurada) es una copia sincronizada.

const DB_NAME = 'xbiblioteca';
const DB_VERSION = 1;
export const STORES = ['posts', 'categories'];
let dbp;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then((r) => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const getAll = (store) => tx(store, 'readonly', (s) => reqP(s.getAll()));
export const get = (store, id) => tx(store, 'readonly', (s) => reqP(s.get(id)));
export const put = (store, obj) => tx(store, 'readwrite', (s) => { s.put(obj); });
export const putMany = (store, arr) => tx(store, 'readwrite', (s) => { for (const o of arr) s.put(o); });
export const clear = (store) => tx(store, 'readwrite', (s) => { s.clear(); });

export const metaGet = (key) => tx('meta', 'readonly', (s) => reqP(s.get(key)));
export const metaSet = (key, val) => tx('meta', 'readwrite', (s) => { s.put(val, key); });

/** Pide al navegador que no borre los datos locales si falta espacio. */
export async function requestPersistence() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch { /* no disponible */ }
}
