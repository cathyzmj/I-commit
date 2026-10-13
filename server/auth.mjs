// /api/auth — passkey sign-in (WebAuthn). An account holds your sync key, so signing in with a passkey
// on any browser, the home-screen app or a new phone brings all your data there (everything else,
// Work Buddy membership included, then arrives through sync).
//
//   POST { action: 'register-options' }  + Bearer <sync key>  -> options for navigator.credentials.create
//   POST { action: 'register', … }        + Bearer <sync key>  -> stores the new passkey
//   POST { action: 'login-options' }                           -> options for navigator.credentials.get
//   POST { action: 'login', … }                                -> { syncKey } once the passkey's signature checks out
//   GET                                   + Bearer <sync key>  -> { account, passkeys }
//
// Registration needs the sync key, i.e. a device already holding the data. The passkey's public key
// comes from the browser (getPublicKey(), "none" attestation); sign-in checks the signature, the
// challenge, the page's origin and the relying-party id. `store`: getWithMetadata / setJSON / delete.
import { syncStorageName } from './sync.mjs';

const KEY_RE = /^[A-Za-z0-9_-]{32,128}$/;
const B64U_RE = /^[A-Za-z0-9_-]+$/;
const CHALLENGE_MS = 5 * 60e3;
const MAX_PASSKEYS = 10;
const ALGS = { '-7': { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' }, '-257': { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } };

const json = (status, body) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const enc = new TextEncoder();
export const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const fromB64u = (s) => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(s).length + 3) % 4)), (c) => c.charCodeAt(0));
const sha256 = async (bytes) => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
const random = (n) => b64u(crypto.getRandomValues(new Uint8Array(n)));
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// WebAuthn ECDSA signatures are DER; WebCrypto wants r and s as two 32-byte numbers.
function derToRaw(der) {
  if (der[0] !== 0x30) throw new Error('bad signature');
  let i = 2;
  const part = () => {
    if (der[i] !== 0x02) throw new Error('bad signature');
    const len = der[i + 1];
    let v = der.slice(i + 2, i + 2 + len);
    i += 2 + len;
    while (v.length > 32 && v[0] === 0) v = v.slice(1);
    if (v.length > 32) throw new Error('bad signature');
    const out = new Uint8Array(32);
    out.set(v, 32 - v.length);
    return out;
  };
  const r = part(), s = part();
  const raw = new Uint8Array(64);
  raw.set(r); raw.set(s, 32);
  return raw;
}
const importKey = (spki, alg) => crypto.subtle.importKey('spki', spki, ALGS[alg], false, ['verify']);

async function takeChallenge(store, challenge, purpose) {
  if (!B64U_RE.test(String(challenge || ''))) return null;
  const rec = await store.getWithMetadata(`chal:${challenge}`);
  if (!rec) return null;
  await store.delete(`chal:${challenge}`);
  if (rec.data.purpose !== purpose || Date.now() - rec.data.at > CHALLENGE_MS) return null;
  return rec.data;
}
function checkClientData(clientDataJSON, type, challenge, origin) {
  let cd;
  try { cd = JSON.parse(new TextDecoder().decode(clientDataJSON)); } catch { return 'Unreadable sign-in data.'; }
  if (cd.type !== type) return 'Wrong kind of passkey response.';
  if (cd.challenge !== challenge) return 'This sign-in has expired. Try again.';
  if (cd.origin !== origin) return 'This passkey belongs to a different website.';
  return null;
}
async function syncKeyOf(req, syncStore) {
  const key = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!KEY_RE.test(key)) return null;
  const doc = await syncStore.getWithMetadata(await syncStorageName(key));
  return doc ? key : null; // only keys with synced data can hold an account
}
async function accountFor(store, syncKey, create) {
  const link = await store.getWithMetadata(`bysync:${hex(await sha256(enc.encode(syncKey)))}`);
  if (link) return (await store.getWithMetadata(`acct:${link.data.account}`))?.data || null;
  if (!create) return null;
  const acct = { id: random(16), syncKey, creds: [], created: new Date().toISOString() };
  await store.setJSON(`acct:${acct.id}`, acct, { onlyIfNew: true });
  await store.setJSON(`bysync:${hex(await sha256(enc.encode(syncKey)))}`, { account: acct.id }, { onlyIfNew: true });
  return acct;
}

export async function handle(req, { store, syncStore }) {
  const url = new URL(req.url);
  const origin = url.origin, rpId = url.hostname;
  if (req.method === 'GET') {
    const key = await syncKeyOf(req, syncStore);
    if (!key) return json(401, { error: 'Turn on sync first.' });
    const acct = await accountFor(store, key, false);
    return json(200, { account: !!acct, passkeys: acct ? acct.creds.map((c) => ({ name: c.name, created: c.created })) : [] });
  }
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed.' });
  let body;
  try { body = await req.json(); } catch { return json(400, { error: 'Expected JSON.' }); }

  if (body.action === 'login-options') {
    const challenge = random(32);
    await store.setJSON(`chal:${challenge}`, { purpose: 'login', at: Date.now() });
    return json(200, { challenge, rpId });
  }

  if (body.action === 'login') {
    if (!(await takeChallenge(store, body.challenge, 'login'))) return json(400, { error: 'This sign-in has expired. Try again.' });
    let authData, clientData, signature;
    try { authData = fromB64u(body.authenticatorData); clientData = fromB64u(body.clientDataJSON); signature = fromB64u(body.signature); } catch { return json(400, { error: 'Unreadable sign-in data.' }); }
    const bad = checkClientData(clientData, 'webauthn.get', body.challenge, origin);
    if (bad) return json(400, { error: bad });
    if (authData.length < 37 || !same(authData.slice(0, 32), await sha256(enc.encode(rpId)))) return json(400, { error: 'This passkey belongs to a different website.' });
    if (!(authData[32] & 0x01)) return json(400, { error: 'The passkey was not confirmed.' });
    const link = B64U_RE.test(String(body.id || '')) && await store.getWithMetadata(`cred:${body.id}`);
    const acct = link && (await store.getWithMetadata(`acct:${link.data.account}`))?.data;
    const cred = acct && acct.creds.find((c) => c.id === body.id);
    if (!cred) return json(404, { error: 'No account uses this passkey. Create one on the device that has your data (⋯ → Account).' });
    const signed = new Uint8Array(authData.length + 32);
    signed.set(authData); signed.set(await sha256(clientData), authData.length);
    let ok = false;
    try {
      const key = await importKey(fromB64u(cred.pk), cred.alg);
      ok = await crypto.subtle.verify(ALGS[cred.alg], key, cred.alg === '-7' ? derToRaw(signature) : signature, signed);
    } catch { ok = false; }
    if (!ok) return json(401, { error: 'The passkey signature did not check out.' });
    return json(200, { syncKey: acct.syncKey });
  }

  const key = await syncKeyOf(req, syncStore);
  if (!key) return json(401, { error: 'Turn on sync first, so there is data to sign in to.' });

  if (body.action === 'register-options') {
    const acct = await accountFor(store, key, true);
    const challenge = random(32);
    await store.setJSON(`chal:${challenge}`, { purpose: 'reg', account: acct.id, at: Date.now() });
    return json(200, { challenge, rp: { id: rpId, name: 'I Commit!' }, user: { id: acct.id }, exclude: acct.creds.map((c) => c.id) });
  }

  if (body.action === 'register') {
    const ch = await takeChallenge(store, body.challenge, 'reg');
    const acct = await accountFor(store, key, false);
    if (!ch || !acct || ch.account !== acct.id) return json(400, { error: 'This sign-up has expired. Try again.' });
    let clientData, pk;
    try { clientData = fromB64u(body.clientDataJSON); pk = fromB64u(body.publicKey); } catch { return json(400, { error: 'Unreadable passkey data.' }); }
    const bad = checkClientData(clientData, 'webauthn.create', body.challenge, origin);
    if (bad) return json(400, { error: bad });
    const alg = String(body.alg);
    if (!ALGS[alg] || !B64U_RE.test(String(body.id || ''))) return json(400, { error: 'This kind of passkey is not supported.' });
    try { await importKey(pk, alg); } catch { return json(400, { error: 'Unreadable passkey.' }); }
    if (acct.creds.length >= MAX_PASSKEYS) return json(409, { error: 'This account already has the most passkeys allowed.' });
    if (!acct.creds.some((c) => c.id === body.id)) {
      acct.creds.push({ id: body.id, pk: b64u(pk), alg, name: String(body.name || 'Passkey').slice(0, 60), created: new Date().toISOString() });
    }
    await store.setJSON(`acct:${acct.id}`, acct);
    await store.setJSON(`cred:${body.id}`, { account: acct.id });
    return json(200, { ok: true, passkeys: acct.creds.length });
  }
  return json(400, { error: 'Unknown action.' });
}
