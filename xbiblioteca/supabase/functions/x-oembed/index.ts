// =====================================================================
//  Edge Function "x-oembed" — obtiene texto y autor de una publicación
//  pública de X usando el endpoint OFICIAL y gratuito de oEmbed
//  (https://publish.twitter.com/oembed). No usa la API paga de X ni
//  hace scraping. Solo responde a usuarios autenticados de tu proyecto.
//
//  Crear en: Supabase Dashboard → Edge Functions → Deploy a new function
//            → Via Editor → nombre: x-oembed → pegar este código → Deploy
// =====================================================================

const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "*"; // opcional: https://tuusuario.github.io

const cors = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
  });

const STATUS_RE =
  /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d{1,25})/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  // 1) Verificar que quien llama es un usuario autenticado de ESTE proyecto.
  const auth = req.headers.get("authorization") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const apiKey = Deno.env.get("SUPABASE_ANON_KEY") ?? req.headers.get("apikey") ?? "";
  if (!auth.startsWith("Bearer ") || !supabaseUrl) return json({ error: "No autorizado" }, 401);
  const who = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: auth, apikey: apiKey },
  });
  if (!who.ok) return json({ error: "Sesión inválida" }, 401);

  // 2) Validar la URL: solo publicaciones de x.com / twitter.com.
  let body: { url?: string } = {};
  try { body = await req.json(); } catch { /* vacío */ }
  const m = STATUS_RE.exec(String(body.url ?? "").trim());
  if (!m) return json({ error: "La URL no parece una publicación de X" }, 400);
  const canonical = `https://twitter.com/${m[1]}/status/${m[2]}`;

  // 3) Consultar oEmbed oficial (sin script, sin tracking).
  const oembed = `https://publish.twitter.com/oembed?omit_script=1&dnt=true&lang=en&url=${encodeURIComponent(canonical)}`;
  try {
    const r = await fetch(oembed, { headers: { Accept: "application/json" } });
    if (r.status === 404) return json({ error: "Publicación no encontrada, privada o eliminada" }, 404);
    if (!r.ok) return json({ error: `oEmbed respondió ${r.status}` }, 502);
    const d = await r.json();
    return json({
      author_name: d.author_name ?? null,
      author_url: d.author_url ?? null,
      html: typeof d.html === "string" ? d.html.slice(0, 20000) : null,
      tweet_id: m[2],
      handle: m[1],
    });
  } catch (e) {
    return json({ error: "No se pudo contactar a X: " + (e as Error).message }, 502);
  }
});
