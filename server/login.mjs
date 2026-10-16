// /api/login — Sign in with Google. A Google account owns the app's synced data: signing in on any
// device (iPhone app, a browser, the Mac app) hands that device the account's data key, and sync
// does the rest. The first sign-in on a device that already syncs keeps that device's data.
//
//   GET  /api/login/config        -> { clientId }         (public; the app builds Google's sign-in link)
//   GET  /api/login/callback      <- Google, after you pick your account: ?code=…&state=…
//   POST /api/login { state }     -> { pending } until Google is done, then { syncKey, email, name, fresh }
//        (+ "Authorization: Bearer <data key>" when the device already syncs)
//
// The app makes a random `state`, opens Google's page with it, and asks /api/login until the
// callback has stored the result under that state (one use, 10 minutes). This works the same in a
// browser tab, the iPhone home-screen app and the Mac app, which all open Google in a separate window.
// Secrets: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET.
import { syncStorageName } from './sync.mjs';

const KEY_RE = /^[A-Za-z0-9_-]{32,128}$/;
const STATE_RE = /^[A-Za-z0-9_-]{32,64}$/;
const STATE_MS = 10 * 60e3;
const json = (status, body) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const enc = new TextEncoder();
const hex = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');
const newKey = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export const redirectUri = (req) => `${new URL(req.url).origin}/api/login/callback`;

// The ID token comes straight from Google's token endpoint over HTTPS, so its claims can be read
// without checking the signature; the audience, issuer, expiry and email are still checked.
function claims(idToken, clientId) {
  const part = String(idToken || '').split('.')[1];
  if (!part) return null;
  const c = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((part.length + 3) % 4)));
  if (c.aud !== clientId || !['accounts.google.com', 'https://accounts.google.com'].includes(c.iss)) return null;
  if (!c.sub || !c.email || c.email_verified === false || (c.exp && c.exp * 1000 < Date.now() - 60e3)) return null;
  return { sub: String(c.sub), email: String(c.email).toLowerCase(), name: String(c.name || c.given_name || '').slice(0, 80) };
}

function page(title, body) {
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<body style="margin:0;font:16px/1.45 -apple-system,system-ui,sans-serif;background:#f4f7fb;color:#1b1f1d;display:flex;min-height:90vh;align-items:center;justify-content:center;text-align:center;padding:24px">
<div style="max-width:360px"><div style="font-size:42px">${title.startsWith('You') ? '✅' : '⚠️'}</div><h2 style="margin:8px 0">${esc(title)}</h2><p style="color:#5f6763">${body}</p></div>
<script>setTimeout(function(){window.close()},1500)</script></body>`, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

export async function handle(req, { store, syncStore, env, fetchImpl = fetch }) {
  const url = new URL(req.url);
  const clientId = env.GOOGLE_CLIENT_ID, secret = env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !secret) return json(503, { error: 'Google sign-in isn’t set up on the server yet.', setup: true });
  if (!/\.apps\.googleusercontent\.com$/.test(clientId)) return json(503, { error: 'The Google Client ID on the server looks wrong (it should end in .apps.googleusercontent.com). Set GOOGLE_CLIENT_ID again.', setup: true });

  // devAuthUrl: only on the local test server, which stands in for Google's sign-in page.
  if (url.pathname.endsWith('/config')) return json(200, { clientId, redirectUri: redirectUri(req), ...(env.DEV_AUTH_URL ? { devAuthUrl: env.DEV_AUTH_URL } : {}) });

  if (url.pathname.endsWith('/callback')) {
    const state = url.searchParams.get('state') || '', code = url.searchParams.get('code') || '';
    if (url.searchParams.get('error')) return page('Sign-in cancelled', 'You can close this window and try again in I Commit!.');
    if (!STATE_RE.test(state) || !code) return page('Something went wrong', 'Start again from I Commit!.');
    const r = await fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: secret, redirect_uri: redirectUri(req), grant_type: 'authorization_code' }),
    });
    const tok = await r.json().catch(() => ({}));
    const who = r.ok && claims(tok.id_token, clientId);
    if (!who) {
      const why = tok.error === 'invalid_client' ? 'The server\'s Google Client secret doesn\'t match. Set GOOGLE_CLIENT_SECRET again.'
        : tok.error === 'redirect_uri_mismatch' ? 'The redirect address in Google Cloud doesn\'t match.' : 'Close this window and try again in I Commit!.';
      return page('Google sign-in failed', esc(why));
    }
    await store.setJSON(`state:${state}`, { ...who, at: Date.now() });
    return page(`You're signed in as ${who.email}`, 'Go back to I Commit! — it will open your data in a moment. You can close this window.');
  }

  if (req.method !== 'POST') return json(405, { error: 'Method not allowed.' });
  let body;
  try { body = await req.json(); } catch { return json(400, { error: 'Expected JSON.' }); }
  const state = String(body.state || '');
  if (!STATE_RE.test(state)) return json(400, { error: 'Start the sign-in again.' });
  const rec = await store.getWithMetadata(`state:${state}`);
  if (!rec) return json(200, { pending: true });
  await store.delete(`state:${state}`);
  if (Date.now() - rec.data.at > STATE_MS) return json(400, { error: 'That sign-in took too long. Try again.' });
  const { sub, email, name } = rec.data;

  const user = await store.getWithMetadata(`user:${sub}`);
  if (user) {
    if (user.data.email !== email || user.data.name !== name) await store.setJSON(`user:${sub}`, { ...user.data, email, name });
    return json(200, { syncKey: user.data.syncKey, email, name, fresh: false });
  }
  // A new account. A device that already syncs (and whose data isn't someone else's account) keeps
  // its data; otherwise the account starts with a new, empty data key and this device uploads to it.
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  let syncKey = null;
  if (KEY_RE.test(bearer) && await syncStore.getWithMetadata(await syncStorageName(bearer)) && !(await store.getWithMetadata(`key:${await hex(bearer)}`))) syncKey = bearer;
  const fresh = !syncKey;
  if (fresh) syncKey = newKey();
  const made = await store.setJSON(`user:${sub}`, { sub, email, name, syncKey, created: new Date().toISOString() }, { onlyIfNew: true });
  if (!made.modified) return json(200, { syncKey: (await store.getWithMetadata(`user:${sub}`)).data.syncKey, email, name, fresh: false });
  await store.setJSON(`key:${await hex(syncKey)}`, { sub });
  return json(200, { syncKey, email, name, fresh });
}
