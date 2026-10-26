// /api/google — Google Calendar and Gmail for a signed-in account (on top of Sign in with Google).
//   POST   /api/google/connect { state }  -> { url }   Google's consent page; Google comes back to
//          /api/login/callback (the address already registered for sign-in), which hands over to
//          connectCallback() here when the state is a connect request.
//   GET    /api/google                    -> { connected, email, calendar, gmail, reconnect, lastSync, lastError }
//   DELETE /api/google                    -> disconnects (revokes Google's token; the calendar stays in Google)
//   POST   /api/google/calendar { tz, from, sources, events }
//          Copies your items into a calendar called "I Commit!" that the app makes in your Google
//          Calendar: new items are added, changed ones updated, removed ones deleted. Only items
//          dated on or after `from`, and only the kinds in `sources`, are compared, so past events
//          and kinds this device couldn't load stay as they are. -> { created, updated, deleted, more }
//          (more: a big first copy goes in parts; the app asks again.)
// Every request carries "Authorization: Bearer <data key>"; the key must belong to a Google account.
// Scopes: calendar.app.created (only calendars this app makes) and gmail.send (the morning summary,
// from you to you). Secrets: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (the same as sign-in).
import { redirectUri } from './login.mjs';
import { b64, b64u } from './webpush.mjs';

export const SCOPE_CAL = 'https://www.googleapis.com/auth/calendar.app.created';
export const SCOPE_MAIL = 'https://www.googleapis.com/auth/gmail.send';
const STATE_RE = /^[A-Za-z0-9_-]{32,64}$/;
const STATE_MS = 10 * 60e3;
const SOURCES = ['task', 'meet', 'app'];
const EVENT_KEY_RE = /^[a-z]:[A-Za-z0-9_.:-]{1,120}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/, TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_OPS = 40;          // Calendar calls per request (the Worker allows 50 outgoing requests)
const MAX_EVENTS = 1500;
const LOCK_MS = 60e3;
const CAL_API = 'https://www.googleapis.com/calendar/v3';

const json = (status, body) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const enc = new TextEncoder();
const hex = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export class GoogleError extends Error {
  constructor(message, { reconnect = false, status = 0 } = {}) { super(message); this.reconnect = reconnect; this.status = status; }
}

// The signed-in account a data key belongs to: { sub, email, name } or null.
export async function accountOf(req, loginStore) {
  const key = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!key) return null;
  const link = await loginStore.getWithMetadata(`key:${await hex(key)}`);
  const user = link && await loginStore.getWithMetadata(`user:${link.data.sub}`);
  return user ? { sub: String(user.data.sub), email: user.data.email, name: user.data.name || '' } : null;
}

function page(title, body, ok) {
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<body style="margin:0;font:16px/1.45 -apple-system,system-ui,sans-serif;background:#f4f7fb;color:#1b1f1d;display:flex;min-height:90vh;align-items:center;justify-content:center;text-align:center;padding:24px">
<div style="max-width:360px"><div style="font-size:42px">${ok ? '✅' : '⚠️'}</div><h2 style="margin:8px 0">${esc(title)}</h2><p style="color:#5f6763">${esc(body)}</p></div>
<script>setTimeout(function(){window.close()},1500)</script></body>`, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

// ---- tokens
// An access token lasts an hour; the refresh token Google gave when you connected makes new ones.
export async function accessToken(store, sub, { env, fetchImpl = fetch }) {
  const rec = await store.getWithMetadata(`tok:${sub}`);
  if (!rec) throw new GoogleError('Google Calendar and Gmail aren’t connected.', { reconnect: true });
  const t = rec.data;
  if (t.reconnect) throw new GoogleError('Connect Google again.', { reconnect: true });
  if (t.access && t.accessExp > Date.now() + 60e3) return { token: t.access, tok: t };
  const r = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: t.refresh, grant_type: 'refresh_token' }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || !body.access_token) {
    // invalid_grant: you removed the app's access in your Google account, or (while the Google
    // Cloud app is still in "Testing") the 7-day refresh token ran out.
    if (body.error === 'invalid_grant') {
      await store.setJSON(`tok:${sub}`, { ...t, access: null, reconnect: true });
      throw new GoogleError('Google access has ended. Connect Google again.', { reconnect: true });
    }
    throw new GoogleError('Couldn’t reach Google. Trying again soon.');
  }
  const next = { ...t, access: body.access_token, accessExp: Date.now() + (Number(body.expires_in) || 3600) * 1000 };
  await store.setJSON(`tok:${sub}`, next);
  return { token: next.access, tok: next };
}

async function gapi(fetchImpl, token, method, url, body) {
  const res = await fetchImpl(url, {
    method, headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

// ---- Gmail: a message from you to you
const mimeWord = (s) => `=?UTF-8?B?${b64(enc.encode(s))}?=`;
const b64lines = (s) => b64(enc.encode(s)).replace(/.{76}/g, '$&\r\n');
export async function sendGmail(store, sub, { to, subject, text, html }, ctx) {
  const { token, tok } = await accessToken(store, sub, ctx);
  if (!tok.scopes.includes(SCOPE_MAIL)) throw new GoogleError('Gmail isn’t connected.', { reconnect: true });
  const boundary = `ic${crypto.randomUUID().replace(/-/g, '')}`;
  const raw = [
    `To: ${to}`, `Subject: ${mimeWord(subject)}`, 'MIME-Version: 1.0', `Content-Type: multipart/alternative; boundary="${boundary}"`, '',
    `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64lines(text),
    `--${boundary}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64lines(html),
    `--${boundary}--`, '',
  ].join('\r\n');
  const r = await gapi(ctx.fetchImpl || fetch, token, 'POST', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { raw: b64u(enc.encode(raw)) });
  if (r.status === 401 || r.status === 403) throw new GoogleError('Gmail refused the summary. Connect Google again.', { reconnect: true, status: r.status });
  if (!r.ok) throw new GoogleError('Gmail didn’t send the summary.', { status: r.status });
}

// ---- Calendar events
const nextDay = (iso) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
// "2026-10-25" + "23:30" + 60 min -> "2026-10-26T00:30:00" (wall-clock time; Google applies the time zone)
function plusMinutes(date, time, mins) {
  const d = new Date(`${date}T${time}:00Z`);
  d.setUTCMinutes(d.getUTCMinutes() + mins);
  return d.toISOString().slice(0, 19);
}
export function eventBody(e, tz) {
  const description = [e.notes, e.url].filter(Boolean).join('\n\n');
  const b = { summary: e.title, description, extendedProperties: { private: { icommit: e.key } } };
  if (e.time) {
    const start = `${e.date}T${e.time}:00`;
    let end;
    if (e.endTime && e.endTime > e.time) end = `${e.date}T${e.endTime}:00`;
    else if (e.endTime) end = `${nextDay(e.date)}T${e.endTime}:00`; // past midnight
    else end = plusMinutes(e.date, e.time, 60);
    b.start = { dateTime: start, timeZone: tz };
    b.end = { dateTime: end, timeZone: tz };
  } else {
    b.start = { date: e.date };
    b.end = { date: nextDay(e.date) };
    b.transparency = 'transparent'; // an all-day deadline doesn't make you look busy
  }
  return b;
}

const validTz = (tz) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return typeof tz === 'string' && tz.length <= 64; } catch { return false; } };
function cleanEvents(list, sources) {
  const out = new Map();
  for (const e of Array.isArray(list) ? list.slice(0, MAX_EVENTS) : []) {
    if (!e || !EVENT_KEY_RE.test(e.key || '') || !sources.includes(e.src) || !DATE_RE.test(e.date || '')) continue;
    const title = String(e.title || '').trim().slice(0, 200);
    if (!title) continue;
    out.set(e.key, {
      key: e.key, src: e.src, date: e.date, title,
      time: TIME_RE.test(e.time || '') ? e.time : null,
      endTime: TIME_RE.test(e.endTime || '') ? e.endTime : null,
      notes: String(e.notes || '').slice(0, 2000),
      url: /^https:\/\//.test(e.url || '') ? String(e.url).slice(0, 500) : '',
    });
  }
  return out;
}

async function syncCalendar(req, acct, { store, env, fetchImpl }) {
  let body;
  try { body = await req.json(); } catch { return json(400, { error: 'Expected JSON.' }); }
  const tz = body.tz, from = body.from;
  const sources = (Array.isArray(body.sources) ? body.sources : []).filter((s) => SOURCES.includes(s));
  if (!validTz(tz) || !DATE_RE.test(from || '')) return json(400, { error: 'Missing time zone or start date.' });
  const want = cleanEvents(body.events, sources);

  // One copy at a time per account (two devices may both send the same changes).
  const lockKey = `lock:${acct.sub}`;
  if (!(await store.setJSON(lockKey, { at: Date.now() }, { onlyIfNew: true })).modified) {
    const lock = await store.getWithMetadata(lockKey);
    if (lock && Date.now() - lock.data.at < LOCK_MS) return json(200, { busy: true, more: true });
    await store.setJSON(lockKey, { at: Date.now() });
  }
  const calKey = `cal:${acct.sub}`;
  const cal = (await store.getWithMetadata(calKey))?.data || { calendarId: null, events: {} };
  let counts = { created: 0, updated: 0, deleted: 0 }, more = false;
  try {
    const { token, tok } = await accessToken(store, acct.sub, { env, fetchImpl });
    if (!tok.scopes.includes(SCOPE_CAL)) throw new GoogleError('Google Calendar isn’t connected.', { reconnect: true });
    let ops = 0;
    if (!cal.calendarId) {
      const r = await gapi(fetchImpl, token, 'POST', `${CAL_API}/calendars`, { summary: 'I Commit!', description: 'Copied from I Commit!. Changes here are overwritten; edit in the app.', timeZone: tz });
      ops++;
      if (!r.ok) throw new GoogleError(r.status === 403 ? 'Google Calendar refused. Connect Google again.' : 'Couldn’t make the I Commit! calendar.', { reconnect: r.status === 403, status: r.status });
      cal.calendarId = r.data.id;
      cal.events = {};
    }
    const base = `${CAL_API}/calendars/${encodeURIComponent(cal.calendarId)}/events`;
    const todo = [];
    for (const [key, e] of want) {
      const b = eventBody(e, tz), h = await hex(JSON.stringify(b));
      const have = cal.events[key];
      if (!have) todo.push({ op: 'create', key, b, h, d: e.date, src: e.src });
      else if (have.h !== h) todo.push({ op: 'update', key, b, h, d: e.date, src: e.src, id: have.id });
    }
    for (const [key, have] of Object.entries(cal.events)) {
      if (!want.has(key) && sources.includes(have.src) && have.d >= from) todo.push({ op: 'delete', key, id: have.id });
    }
    for (const t of todo) {
      if (ops >= MAX_OPS) { more = true; break; }
      ops++;
      if (t.op === 'delete') {
        const r = await gapi(fetchImpl, token, 'DELETE', `${base}/${encodeURIComponent(t.id)}`);
        if (!r.ok && r.status !== 404 && r.status !== 410) throw new GoogleError('Google Calendar didn’t take a change. Trying again soon.', { status: r.status });
        delete cal.events[t.key];
        counts.deleted++;
        continue;
      }
      let r = t.op === 'update' ? await gapi(fetchImpl, token, 'PUT', `${base}/${encodeURIComponent(t.id)}`, t.b) : null;
      if (!r || r.status === 404 || r.status === 410) {
        // New, or deleted by hand in Google: add it (again).
        r = await gapi(fetchImpl, token, 'POST', base, t.b);
        if (r.status === 404) {
          // The whole I Commit! calendar was deleted in Google: make a new one next time.
          cal.calendarId = null; cal.events = {}; more = true;
          break;
        }
      }
      if (!r.ok) throw new GoogleError('Google Calendar didn’t take a change. Trying again soon.', { status: r.status });
      cal.events[t.key] = { id: r.data.id, h: t.h, d: t.d, src: t.src };
      counts[t.op === 'create' ? 'created' : 'updated']++;
    }
    // Forget events long in the past (they stay in Google).
    const old = new Date(`${from}T00:00:00Z`); old.setUTCDate(old.getUTCDate() - 60);
    for (const [key, have] of Object.entries(cal.events)) if (have.d < old.toISOString().slice(0, 10)) delete cal.events[key];
    cal.lastSync = new Date().toISOString(); cal.lastError = null;
  } catch (e) {
    if (!(e instanceof GoogleError)) throw e;
    cal.lastError = e.message;
    await store.setJSON(calKey, cal);
    await store.delete(lockKey);
    return json(e.reconnect ? 409 : 502, { error: e.message, reconnect: e.reconnect, ...counts });
  }
  await store.setJSON(calKey, cal);
  await store.delete(lockKey);
  return json(200, { ...counts, more });
}

// ---- connecting
async function startConnect(req, acct, { store, env }) {
  let body;
  try { body = await req.json(); } catch { return json(400, { error: 'Expected JSON.' }); }
  const state = String(body.state || '');
  if (!STATE_RE.test(state)) return json(400, { error: 'Start again.' });
  await store.setJSON(`connect:${state}`, { sub: acct.sub, at: Date.now() });
  const params = {
    client_id: env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri(req), response_type: 'code', state,
    scope: `openid email ${SCOPE_CAL} ${SCOPE_MAIL}`, access_type: 'offline', prompt: 'consent',
    include_granted_scopes: 'true', login_hint: acct.email,
  };
  const url = env.DEV_AUTH_URL ? `${env.DEV_AUTH_URL}?state=${state}` : `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams(params)}`;
  return json(200, { url });
}

// Google's answer arrives at /api/login/callback. Returns a page when the state is a connect
// request made here, or null to let sign-in handle it.
export async function connectCallback(req, { store, env, fetchImpl = fetch }) {
  const url = new URL(req.url);
  const state = url.searchParams.get('state') || '';
  if (!STATE_RE.test(state)) return null;
  const pending = await store.getWithMetadata(`connect:${state}`);
  if (!pending) return null;
  await store.delete(`connect:${state}`);
  if (url.searchParams.get('error')) return page('Not connected', 'You can close this window and try again in I Commit!.', false);
  if (Date.now() - pending.data.at > STATE_MS) return page('That took too long', 'Start again from I Commit!.', false);
  const r = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: url.searchParams.get('code') || '', client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: redirectUri(req), grant_type: 'authorization_code' }),
  });
  const tok = await r.json().catch(() => ({}));
  const part = String(tok.id_token || '').split('.')[1];
  let sub = null;
  try { sub = String(JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((part.length + 3) % 4))).sub); } catch { /* checked below */ }
  if (!r.ok || !tok.access_token) return page('Google didn’t connect', 'Close this window and try again in I Commit!.', false);
  if (sub !== pending.data.sub) return page('A different Google account', 'Pick the same Google account you sign in to I Commit! with.', false);
  const old = (await store.getWithMetadata(`tok:${sub}`))?.data;
  const refresh = tok.refresh_token || (old && old.refresh);
  if (!refresh) return page('Google didn’t connect', 'Google didn’t give lasting access. Try again in I Commit!.', false);
  const scopes = String(tok.scope || '').split(/\s+/).filter(Boolean);
  await store.setJSON(`tok:${sub}`, { refresh, scopes, access: tok.access_token, accessExp: Date.now() + (Number(tok.expires_in) || 3600) * 1000, connected: new Date().toISOString(), reconnect: false });
  const what = [scopes.includes(SCOPE_CAL) && 'Google Calendar', scopes.includes(SCOPE_MAIL) && 'Gmail'].filter(Boolean).join(' and ');
  return what ? page(`${what} connected`, 'Go back to I Commit!. You can close this window.', true)
    : page('Nothing was connected', 'Tick the Calendar and Gmail boxes on Google’s page. Try again in I Commit!.', false);
}

export async function handle(req, { store, loginStore, env, fetchImpl = fetch }) {
  const url = new URL(req.url);
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return json(503, { error: 'Google isn’t set up on the server yet.', setup: true });
  const acct = await accountOf(req, loginStore);
  if (!acct) return json(401, { error: 'Sign in with Google first.' });
  if (url.pathname.endsWith('/connect')) return req.method === 'POST' ? startConnect(req, acct, { store, env }) : json(405, { error: 'Use POST' });
  if (url.pathname.endsWith('/calendar')) return req.method === 'POST' ? syncCalendar(req, acct, { store, env, fetchImpl }) : json(405, { error: 'Use POST' });
  const tok = (await store.getWithMetadata(`tok:${acct.sub}`))?.data;
  const cal = (await store.getWithMetadata(`cal:${acct.sub}`))?.data;
  if (req.method === 'GET') {
    return json(200, {
      connected: !!tok, email: acct.email, reconnect: !!(tok && tok.reconnect),
      calendar: !!(tok && tok.scopes.includes(SCOPE_CAL)), gmail: !!(tok && tok.scopes.includes(SCOPE_MAIL)),
      lastSync: (cal && cal.lastSync) || null, lastError: (cal && cal.lastError) || null,
    });
  }
  if (req.method === 'DELETE') {
    if (tok) {
      await fetchImpl('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: tok.refresh }) }).catch(() => {});
      await store.delete(`tok:${acct.sub}`);
    }
    // The calendar's record stays, so connecting again carries on with the same I Commit! calendar.
    return json(200, { ok: true });
  }
  return json(405, { error: 'Method not allowed.' });
}
