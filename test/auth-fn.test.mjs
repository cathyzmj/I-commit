// Tests /api/auth: a passkey is registered with a real P-256 key pair, then used to sign in.
import assert from 'node:assert';
import { handle, b64u, fromB64u } from '../server/auth.mjs';
import { syncStorageName } from '../server/sync.mjs';
import { memoryStore } from './sync-fn-store.mjs';

const ORIGIN = 'https://commit.example';
const store = memoryStore(), syncStore = memoryStore();
const KEY = 's'.repeat(43);
await syncStore.setJSON(await syncStorageName(KEY), { version: 1, records: {}, tombs: {} }, { onlyIfNew: true });
const call = (body, key) => handle(new Request(`${ORIGIN}/api/auth`, {
  method: body ? 'POST' : 'GET', headers: key ? { authorization: `Bearer ${key}` } : {}, body: body ? JSON.stringify(body) : undefined,
}), { store, syncStore }).then(async (r) => ({ status: r.status, body: await r.json() }));
const enc = new TextEncoder();
const sha = async (b) => new Uint8Array(await crypto.subtle.digest('SHA-256', b));
const clientData = (type, challenge, origin = ORIGIN) => enc.encode(JSON.stringify({ type, challenge, origin }));
// A DER-encoded ECDSA signature, as authenticators send it.
const toDer = (raw) => {
  const int = (b) => { let i = 0; while (i < b.length - 1 && b[i] === 0) i++; let v = b.slice(i); if (v[0] & 0x80) v = Uint8Array.of(0, ...v); return Uint8Array.of(2, v.length, ...v); };
  const r = int(raw.slice(0, 32)), s = int(raw.slice(32));
  return Uint8Array.of(0x30, r.length + s.length, ...r, ...s);
};

// --- registration needs a sync key with data behind it
assert.equal((await call({ action: 'register-options' })).status, 401);
assert.equal((await call({ action: 'register-options' }, 'x'.repeat(43))).status, 401, 'a key without synced data is refused');
assert.equal((await call(null, KEY)).body.account, false);

const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const spki = new Uint8Array(await crypto.subtle.exportKey('spki', keys.publicKey));
const credId = b64u(crypto.getRandomValues(new Uint8Array(16)));
const opts = await call({ action: 'register-options' }, KEY);
assert.equal(opts.status, 200);
assert.equal(opts.body.rp.id, 'commit.example');
const reg = (o = {}) => call({ action: 'register', challenge: opts.body.challenge, id: credId, publicKey: b64u(spki), alg: -7, name: 'iPhone',
  clientDataJSON: b64u(clientData('webauthn.create', opts.body.challenge)), ...o }, KEY);
assert.equal((await reg({ clientDataJSON: b64u(clientData('webauthn.create', opts.body.challenge, 'https://evil.example')) })).status, 400, 'wrong origin refused');
const opts2 = await call({ action: 'register-options' }, KEY);
const ok = await call({ action: 'register', challenge: opts2.body.challenge, id: credId, publicKey: b64u(spki), alg: -7, name: 'iPhone',
  clientDataJSON: b64u(clientData('webauthn.create', opts2.body.challenge)) }, KEY);
assert.equal(ok.status, 200, JSON.stringify(ok.body));
assert.equal((await call(null, KEY)).body.passkeys.length, 1);
assert.equal((await reg()).status, 400, 'a challenge works once');

// --- sign in
const signIn = async ({ origin = ORIGIN, rp = 'commit.example', key = keys.privateKey, id = credId, flags = 0x05 } = {}) => {
  const o = await call({ action: 'login-options' });
  const authData = Uint8Array.of(...(await sha(enc.encode(rp))), flags, 0, 0, 0, 1);
  const cd = clientData('webauthn.get', o.body.challenge, origin);
  const signed = Uint8Array.of(...authData, ...(await sha(cd)));
  const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, signed));
  return call({ action: 'login', challenge: o.body.challenge, id, authenticatorData: b64u(authData), clientDataJSON: b64u(cd), signature: b64u(toDer(raw)) });
};
const good = await signIn();
assert.equal(good.status, 200, JSON.stringify(good.body));
assert.equal(good.body.syncKey, KEY, 'signing in hands back the sync key');
const other = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
assert.equal((await signIn({ key: other.privateKey })).status, 401, 'someone else\'s key fails');
assert.equal((await signIn({ origin: 'https://evil.example' })).status, 400, 'another site fails');
assert.equal((await signIn({ rp: 'evil.example' })).status, 400, 'another relying party fails');
assert.equal((await signIn({ flags: 0x04 })).status, 400, 'user presence required');
assert.equal((await signIn({ id: 'unknown' })).status, 404, 'unknown passkey');
assert.equal((await call({ action: 'login', challenge: 'nope' })).status, 400, 'unknown challenge');
assert.deepEqual([...fromB64u(b64u(Uint8Array.of(0, 255, 7)))], [0, 255, 7]);
console.log('ALL AUTH FUNCTION TESTS PASSED');
