// Cliente mínimo de Supabase (Auth + REST + Edge Functions) usando fetch.
// Sin librerías externas. Solo se usa la clave PÚBLICA (publishable/anon);
// la seguridad real la imponen las políticas RLS de la base de datos.

const CFG_KEY = 'xb.cloud';
const SES_KEY = 'xb.session';

export function getConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem(CFG_KEY) || 'null');
    if (saved?.url && saved?.key) return saved;
  } catch { /* nada */ }
  const def = globalThis.XB_DEFAULT_CONFIG; // de config.js (opcional)
  if (def?.supabaseUrl && def?.supabaseKey) return { url: def.supabaseUrl, key: def.supabaseKey };
  return null;
}

/** Rechaza claves secretas: nunca deben llegar al navegador. */
export function validateKey(key) {
  key = String(key || '').trim();
  if (!key) return 'Falta la clave.';
  if (key.startsWith('sb_secret_')) return 'Esa es la clave SECRETA. Usá la clave "Publishable" (sb_publishable_…) o la "anon".';
  if (key.split('.').length === 3) {
    try {
      const payload = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (payload.role === 'service_role') return 'Esa es la clave service_role (secreta). Usá la clave "anon" o "Publishable".';
    } catch { /* formato raro: se deja pasar */ }
  }
  return null;
}

export function setConfig(url, key) {
  url = String(url || '').trim().replace(/\/+$/, '');
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(url) && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url)) {
    throw new Error('La URL debe ser del tipo https://xxxx.supabase.co');
  }
  const err = validateKey(key);
  if (err) throw new Error(err);
  localStorage.setItem(CFG_KEY, JSON.stringify({ url, key: key.trim() }));
}

export function clearConfig() {
  localStorage.removeItem(CFG_KEY);
  localStorage.removeItem(SES_KEY);
}

export function getSession() {
  try { return JSON.parse(localStorage.getItem(SES_KEY) || 'null'); } catch { return null; }
}
function saveSession(s) {
  if (!s?.access_token) return null;
  const ses = {
    access_token: s.access_token,
    refresh_token: s.refresh_token,
    expires_at: s.expires_at || Math.floor(Date.now() / 1000) + (s.expires_in || 3600),
    user: { id: s.user?.id, email: s.user?.email },
  };
  localStorage.setItem(SES_KEY, JSON.stringify(ses));
  return ses;
}

async function authFetch(path, body, token) {
  const cfg = getConfig();
  if (!cfg) throw new Error('Nube no configurada');
  const r = await fetch(`${cfg.url}/auth/v1/${path}`, {
    method: 'POST',
    headers: {
      apikey: cfg.key,
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body || {}),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = data.error_description || data.msg || data.message || `Error ${r.status}`;
    const e = new Error(msg === 'Invalid login credentials' ? 'Email o contraseña incorrectos' : msg);
    e.status = r.status;
    throw e;
  }
  return data;
}

export async function signIn(email, password) {
  const data = await authFetch('token?grant_type=password', { email, password });
  return saveSession(data);
}

export async function signOut() {
  const s = getSession();
  localStorage.removeItem(SES_KEY);
  if (s) { try { await authFetch('logout', {}, s.access_token); } catch { /* sin conexión */ } }
}

let refreshing = null;
/** Devuelve un token válido, renovándolo si está por vencer. */
export async function getToken() {
  const s = getSession();
  if (!s) return null;
  if (s.expires_at - 90 > Date.now() / 1000) return s.access_token;
  if (!refreshing) {
    refreshing = authFetch('token?grant_type=refresh_token', { refresh_token: s.refresh_token })
      .then(saveSession)
      .catch((e) => {
        if (e.status === 400 || e.status === 401 || e.status === 403) localStorage.removeItem(SES_KEY);
        throw e;
      })
      .finally(() => { refreshing = null; });
  }
  const ns = await refreshing;
  return ns?.access_token || null;
}

export const isReady = () => !!(getConfig() && getSession());

/** Llamada a la API REST (PostgREST) del proyecto. */
export async function rest(path, { method = 'GET', body, prefer } = {}) {
  const cfg = getConfig();
  const token = await getToken();
  if (!cfg || !token) { const e = new Error('Sin sesión'); e.status = 401; throw e; }
  const r = await fetch(`${cfg.url}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: cfg.key,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    const e = new Error(d.message || `Error ${r.status}`);
    e.status = r.status; e.code = d.code;
    throw e;
  }
  if (r.status === 204) return null;
  const txt = await r.text();
  return txt ? JSON.parse(txt) : null;
}

/** Invoca una Edge Function del proyecto. */
export async function invoke(fn, body) {
  const cfg = getConfig();
  const token = await getToken();
  if (!cfg || !token) throw new Error('Sin sesión');
  const r = await fetch(`${cfg.url}/functions/v1/${fn}`, {
    method: 'POST',
    headers: { apikey: cfg.key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(d.error || d.message || `Error ${r.status}`); e.status = r.status; throw e; }
  return d;
}
