// Tests /api/google against a fake Google: connecting Calendar and Gmail (through the sign-in
// callback), copying items into the "I Commit!" calendar (add, change, delete, in parts, and
// recovering when you delete events or the whole calendar in Google), and token refresh.
import assert from 'node:assert';
import { handle, connectCallback, eventBody, SCOPE_CAL, SCOPE_MAIL } from '../server/google.mjs';
import { memoryStore } from './sync-fn-store.mjs';

const ORIGIN = 'https://commit.example';
const env = { GOOGLE_CLIENT_ID: 'client-123.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'shh' };
const KEY = 'k'.repeat(43), SUB = 'g-cathy';
const hex = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');
const loginStore = memoryStore(), store = memoryStore();
await loginStore.setJSON(`key:${await hex(KEY)}`, { sub: SUB });
await loginStore.setJSON(`user:${SUB}`, { sub: SUB, email: 'cathy@example.com', name: 'Cathy' });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

// ---- a fake Google: token endpoint and a Calendar with one user's calendars
const google = { calendars: new Map(), tokenCalls: 0, apiCalls: 0, refreshOk: true, grant: null, revoked: null };
let nextId = 1;
async function fakeGoogle(url, opts = {}) {
  url = String(url);
  if (url === 'https://oauth2.googleapis.com/token') {
    google.tokenCalls++;
    const b = new URLSearchParams(opts.body);
    if (b.get('grant_type') === 'authorization_code') return Response.json(google.grant);
    if (!google.refreshOk) return Response.json({ error: 'invalid_grant' }, { status: 400 });
    assert.equal(b.get('refresh_token'), 'refresh-1');
    return Response.json({ access_token: `acc-${google.tokenCalls}`, expires_in: 3600 });
  }
  if (url === 'https://oauth2.googleapis.com/revoke') { google.revoked = new URLSearchParams(opts.body).get('token'); return new Response(''); }
  const m = /^https:\/\/www\.googleapis\.com\/calendar\/v3\/calendars(?:\/([^/]+)\/events(?:\/([^/]+))?)?$/.exec(url);
  assert(m, `unexpected ${url}`);
  assert.match(opts.headers.authorization, /^Bearer acc-/);
  google.apiCalls++;
  const body = opts.body ? JSON.parse(opts.body) : null;
  if (!m[1]) { const id = `cal${nextId++}@group.calendar.google.com`; google.calendars.set(id, { meta: body, events: new Map() }); return Response.json({ id }); }
  const cal = google.calendars.get(decodeURIComponent(m[1]));
  if (!cal) return Response.json({ error: { code: 404 } }, { status: 404 });
  const evId = m[2] && decodeURIComponent(m[2]);
  if (opts.method === 'POST') { const id = `ev${nextId++}`; cal.events.set(id, body); return Response.json({ id }); }
  if (!cal.events.has(evId)) return Response.json({ error: { code: 404 } }, { status: 410 });
  if (opts.method === 'PUT') { cal.events.set(evId, body); return Response.json({ id: evId }); }
  if (opts.method === 'DELETE') { cal.events.delete(evId); return new Response(null, { status: 204 }); }
  throw new Error('unexpected method');
}
const ctx = { store, loginStore, env, fetchImpl: fakeGoogle };
const call = async (method, path, body, key = KEY) => {
  const r = await handle(new Request(`${ORIGIN}/api/google${path}`, { method, headers: key ? { authorization: `Bearer ${key}` } : {}, body: body ? JSON.stringify(body) : undefined }), ctx);
  return { status: r.status, body: await r.json() };
};
const S = (n) => String(n).repeat(43).slice(0, 43);

// ---- events as Google sees them
assert.deepEqual(eventBody({ key: 'c:1', date: '2026-10-26', time: '10:00', endTime: null, title: 'Chat', notes: '', url: '' }, 'Europe/London').end,
  { dateTime: '2026-10-26T11:00:00', timeZone: 'Europe/London' }, 'an hour long by default');
assert.equal(eventBody({ key: 'c:1', date: '2026-10-26', time: '23:30', title: 'Late' }, 'UTC').end.dateTime, '2026-10-27T00:30:00', 'across midnight');
assert.equal(eventBody({ key: 'c:1', date: '2026-10-26', time: '22:00', endTime: '01:00', title: 'Night' }, 'UTC').end.dateTime, '2026-10-27T01:00:00');
assert.deepEqual(eventBody({ key: 'a:1', date: '2026-10-31', title: 'Closes' }, 'UTC').end, { date: '2026-11-01' }, 'all day');

// ---- not signed in / not connected
assert.equal((await call('GET', '', null, 'z'.repeat(43))).status, 401);
assert.equal((await handle(new Request(`${ORIGIN}/api/google`), { ...ctx, env: {} })).status, 503);
assert.deepEqual((await call('GET', '')).body, { connected: false, email: 'cathy@example.com', reconnect: false, calendar: false, gmail: false, lastSync: null, lastError: null });
const ev = (key, src, date, extra = {}) => ({ key, src, date, title: `Item ${key}`, ...extra });
const syncBody = (events, sources = ['task', 'meet', 'app'], from = '2026-10-20') => ({ tz: 'Europe/London', from, sources, events });
assert.equal((await call('POST', '/calendar', syncBody([]))).body.reconnect, true, 'needs connecting first');

// ---- connecting: Google comes back to the sign-in callback, which hands over to us
const start = await call('POST', '/connect', { state: S(1) });
const authUrl = new URL(start.body.url);
assert.equal(authUrl.searchParams.get('access_type'), 'offline');
assert.equal(authUrl.searchParams.get('redirect_uri'), `${ORIGIN}/api/login/callback`);
assert.equal(authUrl.searchParams.get('scope'), `openid email ${SCOPE_CAL} ${SCOPE_MAIL}`);
assert.equal(authUrl.searchParams.get('login_hint'), 'cathy@example.com');
assert.equal(await connectCallback(new Request(`${ORIGIN}/api/login/callback?state=${S(9)}&code=x`), ctx), null, 'a sign-in state is left to sign-in');
google.grant = { access_token: 'acc-0', expires_in: 3600, refresh_token: 'refresh-1', scope: `openid email ${SCOPE_CAL}`, id_token: `${b64({})}.${b64({ sub: 'g-someone-else' })}.x` };
assert.match(await (await connectCallback(new Request(`${ORIGIN}/api/login/callback?state=${S(1)}&code=x`), ctx)).text(), /different Google account/);
await call('POST', '/connect', { state: S(2) });
google.grant.id_token = `${b64({})}.${b64({ sub: SUB })}.x`;
assert.match(await (await connectCallback(new Request(`${ORIGIN}/api/login/callback?state=${S(2)}&code=x`), ctx)).text(), /Google Calendar connected/);
let st = (await call('GET', '')).body;
assert.equal(st.calendar, true);
assert.equal(st.gmail, false, 'Gmail box left unticked on Google\'s page');

// ---- the first copy: makes the I Commit! calendar and adds everything
const events = [
  ev('c:t1', 'task', '2026-10-26', { time: '10:00', endTime: '11:30', notes: 'Bring CV', url: 'https://example.com/x' }),
  ev('m:mt1', 'meet', '2026-10-27', { time: '14:00' }),
  ev('a:gs:close', 'app', '2026-10-31'),
  ev('c:old', 'task', '2026-09-01', { time: '09:00' }),
  { key: 'bad', src: 'task', date: '2026-10-26', title: 'x' }, ev('c:other', 'nope', '2026-10-26'),
];
let r = await call('POST', '/calendar', syncBody(events));
assert.deepEqual(r.body, { created: 4, updated: 0, deleted: 0, more: false });
const [[calId, cal]] = [...google.calendars];
assert.equal(cal.meta.summary, 'I Commit!');
const byTitle = (t) => [...cal.events.values()].find((e) => e.summary === t);
assert.deepEqual(byTitle('Item c:t1').start, { dateTime: '2026-10-26T10:00:00', timeZone: 'Europe/London' });
assert.equal(byTitle('Item c:t1').description, 'Bring CV\n\nhttps://example.com/x');
assert.equal(byTitle('Item a:gs:close').transparency, 'transparent');
assert.equal(google.tokenCalls, 2, 'two code exchanges, no refresh: the access token from connecting is used');

// ---- nothing changed: no calls to Google
const before = google.apiCalls;
assert.deepEqual((await call('POST', '/calendar', syncBody(events))).body, { created: 0, updated: 0, deleted: 0, more: false });
assert.equal(google.apiCalls, before);

// ---- a change, a removal, and kinds this device didn't load
const changed = [ev('c:t1', 'task', '2026-10-26', { time: '11:00' }), ev('c:new', 'task', '2026-10-28', { time: '08:00' })];
r = await call('POST', '/calendar', syncBody(changed, ['task']));
assert.deepEqual(r.body, { created: 1, updated: 1, deleted: 0, more: false }, 'the meeting and the deadline stay (not sent), the old one stays (before `from`)');
assert.equal(byTitle('Item c:t1').start.dateTime, '2026-10-26T11:00:00');
r = await call('POST', '/calendar', syncBody([changed[1]], ['task', 'meet', 'app']));
assert.deepEqual(r.body, { created: 0, updated: 0, deleted: 3, more: false });
assert.deepEqual([...cal.events.values()].map((e) => e.summary).sort(), ['Item c:new', 'Item c:old']);

// ---- an event deleted by hand in Google comes back when it changes
for (const [id, e] of cal.events) if (e.summary === 'Item c:new') cal.events.delete(id);
r = await call('POST', '/calendar', syncBody([{ ...changed[1], time: '08:30' }], ['task']));
assert.deepEqual(r.body, { created: 0, updated: 1, deleted: 0, more: false });
assert.equal(byTitle('Item c:new').start.dateTime, '2026-10-28T08:30:00');

// ---- a big first copy goes in parts
const many = Array.from({ length: 70 }, (_, i) => ev(`a:x${i}:close`, 'app', '2026-11-02'));
r = await call('POST', '/calendar', syncBody([changed[1], ...many], ['app']));
assert.equal(r.body.more, true);
assert.equal(r.body.created, 40);
r = await call('POST', '/calendar', syncBody([changed[1], ...many], ['app']));
assert.deepEqual(r.body, { created: 30, updated: 0, deleted: 0, more: false });

// ---- two devices at once: the second waits
await store.setJSON(`lock:${SUB}`, { at: Date.now() });
assert.deepEqual((await call('POST', '/calendar', syncBody([]))).body, { busy: true, more: true });
await store.setJSON(`lock:${SUB}`, { at: Date.now() - 120e3 });
assert.equal((await call('POST', '/calendar', syncBody(many, ['app']))).status, 200, 'a stale lock is taken over');

// ---- the whole calendar deleted in Google: a new one is made
google.calendars.delete(calId);
r = await call('POST', '/calendar', syncBody([ev('c:z', 'task', '2026-10-29', { time: '12:00' })], ['task']));
assert.equal(r.body.more, true);
r = await call('POST', '/calendar', syncBody([ev('c:z', 'task', '2026-10-29', { time: '12:00' })], ['task']));
assert.deepEqual(r.body, { created: 1, updated: 0, deleted: 0, more: false });
assert.equal(google.calendars.size, 1);

// ---- token refresh, and access ending (removed in Google, or the 7-day testing limit)
const tok = (await store.getWithMetadata(`tok:${SUB}`)).data;
await store.setJSON(`tok:${SUB}`, { ...tok, accessExp: Date.now() - 1 });
await call('POST', '/calendar', syncBody([ev('c:z', 'task', '2026-10-29', { time: '12:30' })], ['task']));
assert.equal(google.tokenCalls, 3, 'refreshed once');
await store.setJSON(`tok:${SUB}`, { ...(await store.getWithMetadata(`tok:${SUB}`)).data, accessExp: Date.now() - 1 });
google.refreshOk = false;
r = await call('POST', '/calendar', syncBody([], ['task']));
assert.equal(r.status, 409);
assert.equal(r.body.reconnect, true);
st = (await call('GET', '')).body;
assert.equal(st.reconnect, true);
assert.match(st.lastError, /Connect Google again/);

// ---- disconnecting revokes the token; connecting again keeps the same calendar
assert.deepEqual((await call('DELETE', '')).body, { ok: true });
assert.equal(google.revoked, 'refresh-1');
assert.equal((await call('GET', '')).body.connected, false);
assert(await store.getWithMetadata(`cal:${SUB}`), 'the calendar record stays');

console.log('ALL GOOGLE TESTS PASSED');
