// Tests server/logo.mjs with a fake web: sign-in check, the site's own icon, the Google fallback
// for sites that block bots, and refusing odd input or big files.
import assert from 'node:assert';
import { handle, siteHost } from '../server/logo.mjs';

const hex = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');
const keys = new Set([await hex('good-key')]);
const loginStore = { getWithMetadata: async (k) => (keys.has(k.replace(/^key:/, '')) ? { data: { sub: 'x' } } : null) };
const png = (n = 500) => new Uint8Array(n).fill(7);
const pages = {
  'https://acme.com/': () => new Response('<html><head><link rel="icon" href="/f.ico"><link rel="apple-touch-icon" sizes="180x180" href="/apple.png"></head></html>', { headers: { 'content-type': 'text/html' } }),
  'https://acme.com/apple.png': () => new Response(png(), { headers: { 'content-type': 'image/png' } }),
  'https://castore.com/': () => new Response('Attention Required! | Cloudflare', { status: 403, headers: { 'content-type': 'text/html' } }),
  'https://www.google.com/s2/favicons?domain=castore.com&sz=256': () => new Response(png(800), { headers: { 'content-type': 'image/png' } }),
  'https://huge.com/': () => new Response('<link rel="apple-touch-icon" href="https://huge.com/big.png">', { headers: { 'content-type': 'text/html' } }),
  'https://huge.com/big.png': () => new Response(png(400 * 1024), { headers: { 'content-type': 'image/png' } }),
};
const seen = [];
const fetchImpl = async (url) => { seen.push(String(url)); const f = pages[String(url)]; return f ? f() : new Response('nope', { status: 404 }); };
const call = (site, key = 'good-key') => handle(new Request('https://x/api/logo', { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: JSON.stringify({ site }) }), { loginStore, fetchImpl });

assert.equal(siteHost('https://www.Castore.com/pages/about'), 'castore.com');
for (const bad of ['localhost', '127.0.0.1', 'intranet', 'a.local', 'https://x.com:8080', '']) assert.equal(siteHost(bad), null, bad);

assert.equal((await call('castore.com', 'wrong-key')).status, 401, 'signed-in people only');
let r = await call('acme.com');
assert.equal(r.status, 200);
assert.match((await r.json()).dataUrl, /^data:image\/png;base64,/, "the site's own app icon");
assert(seen.includes('https://acme.com/apple.png'));
r = await call('https://www.castore.com/');
assert.equal(r.status, 200, 'falls back to Google when the site blocks bots');
assert.equal((await r.json()).host, 'castore.com');
r = await call('huge.com');
assert.equal(r.status, 404, 'big files are refused (and the fallback had nothing)');
assert.equal((await call('127.0.0.1')).status, 400);
console.log('ALL LOGO FUNCTION TESTS PASSED');
