// Tests /api/login (Sign in with Google) with a fake Google token endpoint.
import assert from 'node:assert';
import { handle } from '../server/login.mjs';
import { syncStorageName } from '../server/sync.mjs';
import { memoryStore } from './sync-fn-store.mjs';

const ORIGIN = 'https://commit.example';
const env = { GOOGLE_CLIENT_ID: 'client-123.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'shh' };
const store = memoryStore(), syncStore = memoryStore();
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const idToken = (c) => `${b64({ alg: 'RS256' })}.${b64({ iss: 'https://accounts.google.com', aud: env.GOOGLE_CLIENT_ID, exp: Date.now() / 1000 + 3600, email_verified: true, ...c })}.sig`;
let google = null, sent = null;
const fetchImpl = async (url, opts) => { sent = { url, body: new URLSearchParams(opts.body) }; return new Response(JSON.stringify(google), { status: google.error ? 400 : 200 }); };
const ctx = (e = env) => ({ store, syncStore, env: e, fetchImpl });
const get = (path) => handle(new Request(`${ORIGIN}${path}`), ctx());
const finish = (state, key) => handle(new Request(`${ORIGIN}/api/login`, { method: 'POST', headers: key ? { authorization: `Bearer ${key}` } : {}, body: JSON.stringify({ state }) }), ctx())
  .then(async (r) => ({ status: r.status, body: await r.json() }));
const S = (n) => String(n).repeat(43).slice(0, 43);

// --- setup
assert.equal((await handle(new Request(`${ORIGIN}/api/login/config`), ctx({}))).status, 503, 'not set up yet');
assert.match((await (await handle(new Request(`${ORIGIN}/api/login/config`), ctx({ GOOGLE_CLIENT_ID: '5027', GOOGLE_CLIENT_SECRET: 'x' }))).json()).error, /looks wrong/, 'a cut-off client ID is caught');
const cfg = await (await get('/api/login/config')).json();
assert.equal(cfg.clientId, env.GOOGLE_CLIENT_ID);
assert.equal(cfg.redirectUri, `${ORIGIN}/api/login/callback`);

// --- a device that already syncs signs in for the first time: its data becomes the account's
const OLD = 'k'.repeat(43);
await syncStore.setJSON(await syncStorageName(OLD), { version: 3, records: {}, tombs: {} }, { onlyIfNew: true });
assert.deepEqual((await finish(S(1), OLD)).body, { pending: true }, 'waits for Google');
google = { id_token: idToken({ sub: 'g-cathy', email: 'Cathy@Example.com', name: 'Cathy' }) };
const cb = await get(`/api/login/callback?state=${S(1)}&code=abc`);
assert.match(await cb.text(), /signed in as cathy@example\.com/);
assert.equal(sent.body.get('code'), 'abc');
assert.equal(sent.body.get('redirect_uri'), `${ORIGIN}/api/login/callback`);
const first = await finish(S(1), OLD);
assert.deepEqual(first.body, { syncKey: OLD, email: 'cathy@example.com', name: 'Cathy', fresh: false }, 'keeps this device\'s data');
assert.deepEqual((await finish(S(1), OLD)).body, { pending: true }, 'a state works once');

// --- the same account on a new device gets the same data
await get(`/api/login/callback?state=${S(2)}&code=def`);
assert.equal((await finish(S(2))).body.syncKey, OLD);

// --- a new person with no data gets a fresh key
google = { id_token: idToken({ sub: 'g-han', email: 'han@example.com', name: 'Han' }) };
await get(`/api/login/callback?state=${S(3)}&code=ghi`);
const han = await finish(S(3));
assert.equal(han.body.fresh, true);
assert.match(han.body.syncKey, /^[A-Za-z0-9_-]{43}$/);
assert.notEqual(han.body.syncKey, OLD);

// --- someone else can't claim a data key that already belongs to an account
google = { id_token: idToken({ sub: 'g-mallory', email: 'm@example.com' }) };
await get(`/api/login/callback?state=${S(4)}&code=jkl`);
const mal = await finish(S(4), OLD);
assert.notEqual(mal.body.syncKey, OLD, 'an account\'s data key stays with that account');

// --- tokens for another app, unverified email, or Google errors are refused
google = { id_token: idToken({ sub: 'x', email: 'x@example.com', aud: 'someone-else' }) };
assert.match(await (await get(`/api/login/callback?state=${S(5)}&code=x`)).text(), /failed/);
google = { id_token: idToken({ sub: 'x', email: 'x@example.com', email_verified: false }) };
assert.match(await (await get(`/api/login/callback?state=${S(5)}&code=x`)).text(), /failed/);
google = { error: 'invalid_grant' };
assert.match(await (await get(`/api/login/callback?state=${S(5)}&code=x`)).text(), /failed/);
assert.deepEqual((await finish(S(5))).body, { pending: true });
assert.match(await (await get(`/api/login/callback?state=${S(6)}&error=access_denied`)).text(), /cancelled/);
assert.equal((await finish('short')).status, 400);
console.log('ALL LOGIN FUNCTION TESTS PASSED');
