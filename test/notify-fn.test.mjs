// Tests push notifications and reminders: Web Push encryption and VAPID signing (a fake push
// service decrypts each message the way a browser would), time zones, which reminders fall due
// when, the /api/notify endpoints, and the every-minute run (push, Gmail summary, gone devices).
import assert from 'node:assert';
import { encrypt, sendPush, b64u, unb64u } from '../server/webpush.mjs';
import { handle, run, dueMessages, zonedTime, cleanPrefs, cleanPlan, summaryEmail, DEFAULT_PREFS } from '../server/notify.mjs';
import { memoryStore } from './sync-fn-store.mjs';

const enc = new TextEncoder();
const hex = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');
async function hkdf(salt, ikm, info, n) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, n * 8));
}

// ---- a browser: its push keys, and how it decrypts (RFC 8291)
async function makeBrowser(endpoint) {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return {
    sub: { endpoint, keys: { p256dh: b64u(pub), auth: b64u(auth) } },
    async decrypt(body) {
      const salt = body.slice(0, 16), idlen = body[20], asPub = body.slice(21, 21 + idlen), ct = body.slice(21 + idlen);
      assert.equal(new DataView(body.buffer, body.byteOffset).getUint32(16), 4096, 'record size');
      const as = await crypto.subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
      const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: as }, pair.privateKey, 256));
      const info = new Uint8Array([...enc.encode('WebPush: info\0'), ...pub, ...asPub]);
      const ikm = await hkdf(auth, shared, info, 32);
      const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
      const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
      const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
      const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ct));
      assert.equal(plain[plain.length - 1], 2, 'last-record delimiter');
      return JSON.parse(new TextDecoder().decode(plain.slice(0, -1)));
    },
  };
}

// ---- VAPID keys, as scripts/vapid-keys.mjs makes them
const vpair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const vapid = { publicKey: b64u(await crypto.subtle.exportKey('raw', vpair.publicKey)), privateKey: (await crypto.subtle.exportKey('jwk', vpair.privateKey)).d, subject: 'mailto:me@example.com' };

// ---- a push service that checks the VAPID signature and decrypts
const browsers = new Map();
const delivered = [];
let goneEndpoints = new Set();
async function pushService(url, opts) {
  const b = browsers.get(url);
  const [, t, k] = /^vapid t=([^,]+), k=(.+)$/.exec(opts.headers.authorization);
  assert.equal(k, vapid.publicKey);
  const [h, c, sig] = t.split('.');
  const claims = JSON.parse(Buffer.from(c, 'base64url'));
  assert.equal(claims.aud, new URL(url).origin, 'audience is the push service');
  assert.equal(claims.sub, vapid.subject);
  assert(claims.exp > Date.now() / 1000);
  const verKey = await crypto.subtle.importKey('raw', unb64u(k), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  assert(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verKey, unb64u(sig), enc.encode(`${h}.${c}`)), 'VAPID signature');
  assert.equal(opts.headers['content-encoding'], 'aes128gcm');
  if (goneEndpoints.has(url)) return new Response('', { status: 410 });
  delivered.push({ url, msg: await b.decrypt(new Uint8Array(opts.body)) });
  return new Response('', { status: 201 });
}

const phone = await makeBrowser('https://web.push.apple.com/abc');
const laptop = await makeBrowser('https://fcm.googleapis.com/fcm/send/xyz');
browsers.set(phone.sub.endpoint, phone); browsers.set(laptop.sub.endpoint, laptop);

// --- encryption round trip, and a long (multi-kilobyte) message
assert.deepEqual(await phone.decrypt(await encrypt(phone.sub, JSON.stringify({ hi: 'there ✓' }))), { hi: 'there ✓' });
assert.equal(await sendPush(phone.sub, { title: 'x'.repeat(3000) }, { vapid, fetchImpl: pushService }), 'sent');
assert.equal(delivered.pop().msg.title.length, 3000);
goneEndpoints.add(laptop.sub.endpoint);
assert.equal(await sendPush(laptop.sub, { title: 'x' }, { vapid, fetchImpl: pushService }), 'gone');
goneEndpoints = new Set();

// --- time zones: wall-clock time in the plan's zone, across a clock change
assert.equal(new Date(zonedTime('2026-10-24', '07:30', 'Europe/London')).toISOString(), '2026-10-24T06:30:00.000Z', 'BST');
assert.equal(new Date(zonedTime('2026-10-25', '07:30', 'Europe/London')).toISOString(), '2026-10-25T07:30:00.000Z', 'clocks went back overnight');
assert.equal(new Date(zonedTime('2026-10-25', '09:00', 'Asia/Shanghai')).toISOString(), '2026-10-25T01:00:00.000Z');
assert.equal(new Date(zonedTime('2026-03-29', '01:30', 'Europe/London')).toISOString(), '2026-03-29T01:30:00.000Z', 'a time skipped by the clock change moves an hour later');

// --- settings and plans are cleaned
assert.deepEqual(cleanPrefs({ lead: 7, nudgeTime: '25:00', summary: false, x: 1 }), { ...DEFAULT_PREFS, summary: false });
assert.equal(cleanPlan({ tz: 'Not/AZone' }), null);
const TZ = 'Europe/London';
const plan = cleanPlan({
  tz: TZ,
  days: [{ date: '2026-10-26', tasks: [{ t: 'Coffee chat', time: '10:00' }, { t: 'Write CV' }], routines: [{ t: 'Gym', done: true }, { t: 'Read' }, { t: 'Duolingo' }],
    schedule: [{ t: 'EC1A1 lecture', time: '09:00' }], meetings: [{ t: 'Kick-off · Consulting', time: '14:00' }], apps: [{ t: 'Goldman Sachs closes' }], junk: 1 }],
  timed: [{ key: 'c:abc', date: '2026-10-26', time: '10:00', title: 'Coffee chat', where: 'Library' }, { key: 'bad key', date: '2026-10-26', time: '10:00', title: 'x' }],
  deadlines: [{ key: 'a:gs:close', date: '2026-10-27', title: 'Goldman Sachs closes' }],
});
assert.equal(plan.timed.length, 1, 'bad keys are dropped');

// --- what falls due when (London is on GMT from 25 Oct)
const at = (iso) => Date.parse(iso);
const ids = (now, prefs = DEFAULT_PREFS, sent) => dueMessages(plan, prefs, at(now), sent).map((m) => m.id);
assert.deepEqual(ids('2026-10-26T07:29:00Z'), []);
assert.deepEqual(ids('2026-10-26T07:30:00Z'), ['s:2026-10-26'], 'morning email at 07:30');
assert.deepEqual(ids('2026-10-26T09:50:00Z'), ['t:c:abc:2026-10-26T10:00'], '10 minutes before');
assert.deepEqual(ids('2026-10-26T09:50:00Z', { ...DEFAULT_PREFS, timed: false }), []);
assert.deepEqual(ids('2026-10-26T09:45:00Z', { ...DEFAULT_PREFS, lead: 15 }), ['t:c:abc:2026-10-26T10:00']);
assert.deepEqual(ids('2026-10-26T09:50:00Z', DEFAULT_PREFS, { 't:c:abc:2026-10-26T10:00': 1 }), [], 'sent once');
assert.deepEqual(ids('2026-10-26T10:11:00Z'), [], 'over 20 minutes late: dropped');
assert.deepEqual(ids('2026-10-26T09:00:00Z'), ['d:a:gs:close:2026-10-27'], 'the day before a deadline at 09:00');
const nudge = dueMessages(plan, DEFAULT_PREFS, at('2026-10-26T20:00:00Z'));
assert.deepEqual(nudge.map((m) => [m.id, m.title, m.body]), [['r:2026-10-26', '2 routines still to tick', 'Read, Duolingo']]);
const timedMsg = dueMessages(plan, DEFAULT_PREFS, at('2026-10-26T09:50:00Z'))[0];
assert.equal(timedMsg.body, 'In 10 min · 10:00 · Library');

// --- the morning email
const mail = summaryEmail(plan.days[0], 'https://commit.example');
assert.equal(mail.subject, 'Today · Mon 26 Oct: 2 tasks, 3 routines');
assert.match(mail.text, /Timeline\n {2}• 09:00 {2}EC1A1 lecture\n {2}• 10:00 {2}Coffee chat\n {2}• 14:00 {2}Kick-off · Consulting \(meeting\)/);
assert.match(mail.text, /To do\n {2}• Write CV/);
assert.match(mail.html, /Goldman Sachs closes/);
assert.match(summaryEmail({ date: '2026-10-26', tasks: [], routines: [], schedule: [], meetings: [{ t: '<b>x</b>' }], apps: [] }, '').html, /&lt;b&gt;x&lt;\/b&gt;/, 'escaped');

// ---- the endpoints
const ORIGIN = 'https://commit.example';
const KEY = 'k'.repeat(43), SUB = 'g-cathy';
const loginStore = memoryStore();
await loginStore.setJSON(`key:${await hex(KEY)}`, { sub: SUB });
await loginStore.setJSON(`user:${SUB}`, { sub: SUB, email: 'cathy@example.com', name: 'Cathy' });
const store = memoryStore(), googleStore = memoryStore();
const env = { VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey, VAPID_SUBJECT: vapid.subject, GOOGLE_CLIENT_ID: 'c.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 's' };
const gmailSent = [];
async function fakeNet(url, opts) {
  if (browsers.has(url)) return pushService(url, opts);
  if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'acc-2', expires_in: 3600 });
  if (url.startsWith('https://gmail.googleapis.com/')) {
    assert.equal(opts.headers.authorization, 'Bearer acc-2');
    gmailSent.push(Buffer.from(JSON.parse(opts.body).raw, 'base64url').toString());
    return Response.json({ id: 'm1' });
  }
  throw new Error(`unexpected ${url}`);
}
const ctx = { store, loginStore, googleStore, env, fetchImpl: fakeNet };
const call = async (method, path, body, key = KEY) => {
  const r = await handle(new Request(`${ORIGIN}/api/notify${path}`, { method, headers: key ? { authorization: `Bearer ${key}` } : {}, body: body ? JSON.stringify(body) : undefined }), ctx);
  return { status: r.status, body: await r.json() };
};

assert.deepEqual((await call('GET', '/config', null, null)).body, { publicKey: vapid.publicKey });
assert.equal((await handle(new Request(`${ORIGIN}/api/notify/config`), { ...ctx, env: {} })).status, 503);
assert.equal((await call('GET', '', null, 'z'.repeat(43))).status, 401, 'needs a signed-in account');
assert.deepEqual((await call('GET', '')).body, { prefs: DEFAULT_PREFS, devices: [], push: true, gmail: false });
assert.equal((await call('POST', '/subscribe', { subscription: { endpoint: 'http://insecure', keys: phone.sub.keys } })).status, 400);
await call('POST', '/subscribe', { subscription: phone.sub, device: 'iPhone' });
await call('POST', '/subscribe', { subscription: phone.sub, device: 'iPhone' });
const st = (await call('POST', '/subscribe', { subscription: laptop.sub, device: 'Mac' })).body;
assert.deepEqual(st.devices.map((d) => d.device), ['iPhone', 'Mac'], 'one entry per device');
assert.equal((await call('PUT', '/prefs', { prefs: { lead: 30, summary: true } })).body.prefs.lead, 30);
await call('PUT', '/prefs', { prefs: { ...DEFAULT_PREFS } });
assert.equal((await call('PUT', '/plan', { plan: { tz: 'nope' } })).status, 400);
assert.deepEqual((await call('PUT', '/plan', { plan })).body, { ok: true });
const test = await call('POST', '/test', {});
assert.equal(test.body.pushed, 2);
assert.deepEqual(delivered.splice(0).map((d) => d.msg.body), ['Notifications are on.', 'Notifications are on.']);

// ---- the minute job
const runAt = (iso) => run({ ...ctx, now: at(iso) });
assert.deepEqual(await runAt('2026-10-26T09:50:30Z'), { pushed: 1, emailed: 0 });
assert.deepEqual(delivered.splice(0).map((d) => [d.url, d.msg.title, d.msg.url]),
  [[phone.sub.endpoint, 'Coffee chat', '#/today'], [laptop.sub.endpoint, 'Coffee chat', '#/today']], 'to every device');
assert.deepEqual(await runAt('2026-10-26T09:51:30Z'), { pushed: 0, emailed: 0 }, 'not again next minute');

// The laptop's browser dropped its subscription: it's forgotten.
goneEndpoints.add(laptop.sub.endpoint);
await runAt('2026-10-26T20:01:00Z');
assert.deepEqual(delivered.splice(0).map((d) => d.msg.title), ['2 routines still to tick']);
assert.deepEqual((await call('GET', '')).body.devices.map((d) => d.device), ['iPhone']);

// Ticking a routine on any device sends a new plan, and the nudge follows it.
const ticked = structuredClone(plan); ticked.days[0].routines.forEach((r) => { r.done = true; }); ticked.days[0].date = '2026-10-27';
await call('PUT', '/plan', { plan: ticked });
await runAt('2026-10-27T20:00:00Z');
assert.equal(delivered.length, 0, 'all ticked: no nudge');

// Morning email: skipped without Gmail, sent through Gmail once it's connected.
assert.deepEqual(await runAt('2026-10-27T07:30:00Z'), { pushed: 0, emailed: 0 });
await call('PUT', '/plan', { plan });
await googleStore.setJSON(`tok:${SUB}`, { refresh: 'r1', scopes: ['openid', 'https://www.googleapis.com/auth/gmail.send'], access: null, accessExp: 0 });
assert.equal((await call('GET', '')).body.gmail, true);
assert.deepEqual(await runAt('2026-10-26T07:31:00Z'), { pushed: 0, emailed: 1 });
assert.match(gmailSent[0], /^To: cathy@example\.com\r\n/);
assert.match(gmailSent[0], /Subject: =\?UTF-8\?B\?/);
const htmlPart = gmailSent[0].split('Content-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n')[1].split('\r\n--')[0];
assert.match(Buffer.from(htmlPart.replace(/\r\n/g, ''), 'base64').toString(), /Write CV[\s\S]*https:\/\/commit\.example\/#\/today/);
const mailTest = await call('POST', '/test', { email: true });
assert.equal(mailTest.body.emailed, true);

console.log('ALL NOTIFY TESTS PASSED');
