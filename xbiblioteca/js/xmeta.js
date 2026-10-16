// Datos de una publicación de X a partir de su URL.
//  - Sin red: usuario (@handle), ID y fecha exacta (el ID de X codifica la fecha).
//  - Con la Edge Function "x-oembed": texto y nombre del autor vía oEmbed oficial.

import * as cloud from './cloud.js';

const STATUS_RE = /https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d{1,25})/i;

/** Busca un enlace a una publicación dentro de cualquier texto (útil al compartir). */
export function parseXUrl(input) {
  const m = STATUS_RE.exec(String(input || ''));
  if (!m) return null;
  return { handle: m[1], tweetId: m[2], url: `https://x.com/${m[1]}/status/${m[2]}` };
}

/** Fecha de creación a partir del ID (snowflake). Válido para IDs desde nov-2010. */
export function dateFromTweetId(id) {
  try {
    const ms = Number((BigInt(id) >> 22n) + 1288834974657n);
    if (ms < Date.parse('2010-11-04') || ms > Date.now() + 86400000) return null;
    return new Date(ms).toISOString();
  } catch { return null; }
}

/** Extrae texto plano del HTML de oEmbed sin ejecutar nada (DOMParser es inerte). */
export function parseOembedHtml(html) {
  if (!html) return {};
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const p = doc.querySelector('blockquote p');
  let text = '';
  if (p) {
    p.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
    // Los enlaces acortados se muestran con su texto visible (pic.twitter.com/…, etc.)
    text = p.textContent.replace(/ /g, ' ').trim();
  }
  return { text };
}

/** Obtiene metadatos. Nunca falla: devuelve lo que pudo conseguir y un aviso. */
export async function fetchMeta(url) {
  const parsed = parseXUrl(url);
  if (!parsed) return { error: 'La URL no parece una publicación de X (x.com/usuario/status/…)' };
  const base = {
    url: parsed.url,
    tweet_id: parsed.tweetId,
    author_handle: parsed.handle,
    posted_at: dateFromTweetId(parsed.tweetId),
  };
  if (!cloud.isReady()) return { ...base, warning: 'Modo local: completá el texto a mano (o activá la nube + la función x-oembed).' };
  if (!navigator.onLine) return { ...base, warning: 'Sin conexión: completá el texto a mano.' };
  try {
    const d = await cloud.invoke('x-oembed', { url: parsed.url });
    const { text } = parseOembedHtml(d.html);
    return { ...base, author_name: d.author_name || null, text: text || '', fetched: true };
  } catch (e) {
    const hint = e.status === 404 && /function/i.test(e.message || '') ? 'No encontré la función x-oembed (ver guía).' : e.message;
    return { ...base, warning: `No se pudo traer el texto automáticamente: ${hint}. Podés pegarlo a mano.` };
  }
}
