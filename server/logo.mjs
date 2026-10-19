// POST /api/logo  { "site": "castore.com" }  ->  { "dataUrl": "data:image/png;base64,…" }
// Finds a company's icon for a Gallery project. The browser can't read another site's images
// (CORS), so this fetches it: first the site's own apple-touch-icon (the large app icon most
// sites publish), then Google's public favicon service, which also works for sites that block
// automated visits. Only signed-in people can use it, and only small images come back, so it
// can't be used as a general-purpose proxy. Nothing is stored.
const MAX_BYTES = 300 * 1024;
const IMAGE_TYPES = /^image\/(png|jpeg|webp|gif)$/;

const json = (status, body) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

// "castore.com", "https://www.castore.com/pages/about" -> "castore.com"; null for anything else.
export function siteHost(raw) {
  let s = String(raw || '').trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  let url;
  try { url = new URL(s); } catch { return null; }
  const h = url.hostname.toLowerCase().replace(/^www\./, '');
  if (url.port || url.username || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h) || /\.(local|internal|localhost)$/.test(h) || /^\d+(\.\d+){3}$/.test(h)) return null;
  return h;
}

async function sha256Hex(s) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Reads a response body up to MAX_BYTES (or null if it's bigger).
async function readCapped(res) {
  const reader = res.body.getReader();
  const parts = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BYTES) { reader.cancel(); return null; }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

async function fetchImage(url, fetchImpl) {
  try {
    const res = await fetchImpl(url, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (I Commit! logo finder)' }, signal: AbortSignal.timeout(8000) });
    const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!res.ok || !IMAGE_TYPES.test(type)) return null;
    const bytes = await readCapped(res);
    if (!bytes || bytes.length < 100) return null;
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return `data:${type};base64,${btoa(bin)}`;
  } catch { return null; }
}

// The site's own large icon, if its home page lists one.
async function siteIcon(host, fetchImpl) {
  let html;
  try {
    const res = await fetchImpl(`https://${host}/`, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (I Commit! logo finder)', accept: 'text/html' }, signal: AbortSignal.timeout(6000) });
    if (!res.ok || !/text\/html/i.test(res.headers.get('content-type') || '')) return null;
    const bytes = await readCapped(res);
    if (!bytes) return null;
    html = new TextDecoder().decode(bytes);
    const links = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
    const attr = (tag, name) => { const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*["']?([^"'\\s>]+)`, 'i')); return m ? m[1] : ''; };
    const icon = links.find((t) => /rel=["']?apple-touch-icon/i.test(t) && attr(t, 'href'));
    if (!icon) return null;
    const href = new URL(attr(icon, 'href').replace(/&amp;/g, '&'), res.url || `https://${host}/`);
    if (href.protocol !== 'https:') return null;
    return await fetchImage(href.href, fetchImpl);
  } catch { return null; }
}

export async function handle(req, { loginStore, fetchImpl = fetch }) {
  if (req.method !== 'POST') return json(405, { error: 'Use POST' });
  const key = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!key || !(await loginStore.getWithMetadata(`key:${await sha256Hex(key)}`))) return json(401, { error: 'Sign in with Google to find logos.' });
  let body;
  try { body = await req.json(); } catch { return json(400, { error: 'Expected JSON body' }); }
  const host = siteHost(body && body.site);
  if (!host) return json(400, { error: 'Type a website, e.g. castore.com' });
  const dataUrl = await siteIcon(host, fetchImpl) ||
    await fetchImage(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=256`, fetchImpl);
  if (!dataUrl) return json(404, { error: `Couldn’t find a logo for ${host}. Upload a picture instead.` });
  return json(200, { dataUrl, host });
}
