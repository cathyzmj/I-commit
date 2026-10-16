// /api/buddy — Work Buddy pacts: a few people doing the same routine, each ticking their own day.
//
//   POST { action: 'create', me, name }   starts a pact        -> { token, pact }
//   POST { action: 'join', invite, me }    joins with a code    -> { token, pact }
//   GET                                    reads the pact       -> { pact }
//   POST { action: 'tick', date, done, note }                   -> { pact }
//   POST { action: 'leave' }               leaves (the pact is deleted when the last person leaves)
//   POST { action: 'invite-email', email }   invites someone by their Google (Gmail) address
//   POST { action: 'uninvite', email }        takes an email invite back
//   POST { action: 'invites' }                 + X-Data-Key: your invites, found by your Google sign-in
//   POST { action: 'accept', pactId } / { action: 'decline', pactId }   + X-Data-Key
//   POST { action: 'calendar', events, detail }   shares (or, with events: null, stops sharing) your
//                                          calendar with the pact: [{ d, s, e, n }] for the next few weeks;
//                                          detail 'busy' drops the names so only the times are shared
//
// Everything except create/join carries "Authorization: Bearer <token>". Each member has their
// own random token; only its SHA-256 hash is stored. Invite codes are short and only let someone
// join. `store` has getWithMetadata / setJSON (conditional) / delete, like the sync store.
// Email invites: the invitee is recognised by their Google sign-in. The app sends its data key
// (X-Data-Key); /api/login's store maps that key to the Google account and its email.

const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;
const INVITE_RE = /^[a-z0-9]{10}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_MEMBERS = 6;
const KEEP_DAYS = 120;
const MAX_EVENTS = 600;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/;
const MAX_INVITES = 10;
const MAX_ATTEMPTS = 6;

const json = (status, body) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const text = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

async function sha256(s) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function randomString(n, alphabet) {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
}
const newToken = () => randomString(43, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_');
const newCode = () => randomString(10, 'abcdefghijkmnpqrstuvwxyz23456789');
const dayDiff = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 864e5);

// What members see: names and days, never token hashes.
function view(pact, memberId) {
  return {
    id: pact.id, name: pact.name, invite: pact.invite, created: pact.created, invited: pact.emailInvites || [],
    members: Object.entries(pact.members).map(([id, m]) => ({ id, name: m.name, me: id === memberId, joined: m.joined, days: m.days, ...(m.cal ? { cal: m.cal } : {}) })),
  };
}

// Reads, changes and writes a pact with a conditional write, retrying if someone else wrote first.
async function update(store, pactId, change) {
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const cur = await store.getWithMetadata(`pact:${pactId}`);
    if (!cur) return null;
    const pact = cur.data;
    const result = await change(pact);
    if (result === false) return pact;
    const r = Object.keys(pact.members).length
      ? await store.setJSON(`pact:${pactId}`, pact, { onlyIfMatch: cur.etag })
      : (await store.delete(`pact:${pactId}`), await store.delete(`invite:${pact.invite}`), { modified: true });
    if (r.modified) return pact;
  }
  throw new Error('busy');
}

async function member(store, req) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!TOKEN_RE.test(token)) return null;
  const hash = await sha256(`buddy:${token}`);
  const link = await store.getWithMetadata(`member:${hash}`);
  return link ? { hash, ...link.data } : null;
}

async function addMember(store, pactId, name) {
  const token = newToken();
  const hash = await sha256(`buddy:${token}`);
  const id = randomString(8, 'abcdefghijklmnopqrstuvwxyz0123456789');
  await store.setJSON(`member:${hash}`, { pactId, memberId: id }, { onlyIfNew: true });
  return { token, hash, id, entry: { name, tokenHash: hash, joined: new Date().toISOString(), days: {} } };
}

// The signed-in Google account behind a data key, or null.
async function accountOf(req, loginStore) {
  const key = String(req.headers.get('x-data-key') || '').trim();
  if (!loginStore || !TOKEN_RE.test(key)) return null;
  const link = await loginStore.getWithMetadata(`key:${await sha256(key)}`);
  const user = link && await loginStore.getWithMetadata(`user:${link.data.sub}`);
  return user ? { email: user.data.email, name: user.data.name || user.data.email.split('@')[0] } : null;
}
// Pacts that invited this email address (an index kept beside the pacts).
async function invitesFor(store, email) {
  const rec = await store.getWithMetadata(`einv:${email}`);
  return rec ? rec.data.pacts || [] : [];
}
async function setInvite(store, email, pactId, on) {
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const cur = await store.getWithMetadata(`einv:${email}`);
    const pacts = new Set(cur ? cur.data.pacts : []);
    if (on) pacts.add(pactId); else pacts.delete(pactId);
    if (!pacts.size) { if (cur) await store.delete(`einv:${email}`); return; }
    const r = cur ? await store.setJSON(`einv:${email}`, { pacts: [...pacts] }, { onlyIfMatch: cur.etag })
      : await store.setJSON(`einv:${email}`, { pacts: [...pacts] }, { onlyIfNew: true });
    if (r.modified) return;
  }
}

export async function handle(req, store, loginStore = null) {
  if (req.method === 'GET') {
    const m = await member(store, req);
    if (!m) return json(401, { error: 'Not part of this pact any more.' });
    const cur = await store.getWithMetadata(`pact:${m.pactId}`);
    if (!cur || !cur.data.members[m.memberId]) return json(404, { error: 'This pact no longer exists.' });
    return json(200, { pact: view(cur.data, m.memberId) });
  }
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed.' });
  let body;
  try { body = await req.json(); } catch { return json(400, { error: 'Expected JSON.' }); }
  if (!body || typeof body !== 'object') return json(400, { error: 'Expected JSON.' });

  if (body.action === 'create') {
    const me = text(body.me, 40), name = text(body.name, 60) || 'Daily routine';
    if (!me) return json(400, { error: 'Add your name.' });
    const id = newCode() + newCode();
    let invite = newCode();
    for (let i = 0; i < 4 && !(await store.setJSON(`invite:${invite}`, { pactId: id }, { onlyIfNew: true })).modified; i++) invite = newCode();
    const a = await addMember(store, id, me);
    const pact = { id, name, invite, created: new Date().toISOString(), members: { [a.id]: a.entry } };
    await store.setJSON(`pact:${id}`, pact, { onlyIfNew: true });
    return json(200, { token: a.token, pact: view(pact, a.id) });
  }

  if (['invites', 'accept', 'decline'].includes(body.action)) {
    const acct = await accountOf(req, loginStore);
    if (!acct) return json(401, { error: 'Sign in with Google to see invites.' });
    if (body.action === 'invites') {
      const out = [];
      for (const pactId of await invitesFor(store, acct.email)) {
        const cur = await store.getWithMetadata(`pact:${pactId}`);
        if (!cur || !(cur.data.emailInvites || []).includes(acct.email)) { await setInvite(store, acct.email, pactId, false); continue; }
        out.push({ pactId, name: cur.data.name, from: Object.values(cur.data.members).map((x) => x.name) });
      }
      return json(200, { email: acct.email, invites: out });
    }
    const pactId = String(body.pactId || '');
    if (body.action === 'decline') {
      await update(store, pactId, (p) => { p.emailInvites = (p.emailInvites || []).filter((e) => e !== acct.email); });
      await setInvite(store, acct.email, pactId, false);
      return json(200, { ok: true });
    }
    const a = await addMember(store, pactId, acct.name);
    let problem = null;
    const pact = await update(store, pactId, (p) => {
      if (!(p.emailInvites || []).includes(acct.email)) { problem = 'This invite was taken back.'; return false; }
      if (Object.keys(p.members).length >= MAX_MEMBERS) { problem = 'This pact is full.'; return false; }
      p.members[a.id] = a.entry;
      p.emailInvites = p.emailInvites.filter((e) => e !== acct.email);
    });
    await setInvite(store, acct.email, pactId, false);
    if (!pact || problem) {
      await store.delete(`member:${a.hash}`);
      return json(pact ? 409 : 404, { error: problem || 'This pact no longer exists.' });
    }
    return json(200, { token: a.token, pact: view(pact, a.id) });
  }

  if (body.action === 'join') {
    const me = text(body.me, 40), code = String(body.invite || '').toLowerCase().trim();
    if (!me) return json(400, { error: 'Add your name.' });
    if (!INVITE_RE.test(code)) return json(400, { error: 'That invite code doesn’t look right.' });
    const inv = await store.getWithMetadata(`invite:${code}`);
    if (!inv) return json(404, { error: 'This invite is no longer valid. Ask for a new link.' });
    const a = await addMember(store, inv.data.pactId, me);
    let full = false;
    const pact = await update(store, inv.data.pactId, (p) => {
      if (Object.keys(p.members).length >= MAX_MEMBERS) { full = true; return false; }
      p.members[a.id] = a.entry;
    });
    if (!pact || full) {
      await store.delete(`member:${a.hash}`);
      return json(pact ? 409 : 404, { error: pact ? 'This pact is full.' : 'This pact no longer exists.' });
    }
    return json(200, { token: a.token, pact: view(pact, a.id) });
  }

  const m = await member(store, req);
  if (!m) return json(401, { error: 'Not part of this pact any more.' });

  if (body.action === 'tick') {
    const date = String(body.date || '');
    const today = new Date().toISOString().slice(0, 10);
    if (!DATE_RE.test(date) || Math.abs(dayDiff(date, today)) > 2) return json(400, { error: 'You can only tick today or yesterday.' });
    const pact = await update(store, m.pactId, (p) => {
      const me = p.members[m.memberId];
      if (!me) return false;
      if (body.done) me.days[date] = { d: 1, n: text(body.note, 140), at: new Date().toISOString() };
      else delete me.days[date];
      for (const d of Object.keys(me.days)) if (dayDiff(today, d) > KEEP_DAYS) delete me.days[d];
    });
    if (!pact || !pact.members[m.memberId]) return json(404, { error: 'This pact no longer exists.' });
    return json(200, { pact: view(pact, m.memberId) });
  }

  if (body.action === 'invite-email' || body.action === 'uninvite') {
    const email = String(body.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return json(400, { error: 'That doesn’t look like an email address.' });
    const on = body.action === 'invite-email';
    let full = false;
    const pact = await update(store, m.pactId, (p) => {
      const list = new Set(p.emailInvites || []);
      if (on) { if (list.size >= MAX_INVITES && !list.has(email)) { full = true; return false; } list.add(email); } else list.delete(email);
      p.emailInvites = [...list];
    });
    if (!pact) return json(404, { error: 'This pact no longer exists.' });
    if (full) return json(409, { error: 'Too many open invites. Take one back first.' });
    await setInvite(store, email, m.pactId, on);
    return json(200, { pact: view(pact, m.memberId) });
  }

  if (body.action === 'calendar') {
    let cal = null;
    if (Array.isArray(body.events)) {
      const busy = body.detail !== 'names';
      const events = body.events.slice(0, MAX_EVENTS).filter((x) => x && DATE_RE.test(x.d)).map((x) => ({
        d: x.d, s: TIME_RE.test(x.s) ? x.s : null, e: TIME_RE.test(x.e) ? x.e : null, n: busy ? '' : text(x.n, 80),
      }));
      cal = { detail: busy ? 'busy' : 'names', updated: new Date().toISOString(), events };
    }
    const pact = await update(store, m.pactId, (p) => {
      const me = p.members[m.memberId];
      if (!me) return false;
      if (cal) me.cal = cal; else delete me.cal;
    });
    if (!pact || !pact.members[m.memberId]) return json(404, { error: 'This pact no longer exists.' });
    return json(200, { pact: view(pact, m.memberId) });
  }

  if (body.action === 'leave') {
    await update(store, m.pactId, (p) => { if (!p.members[m.memberId]) return false; delete p.members[m.memberId]; });
    await store.delete(`member:${m.hash}`);
    return json(200, { ok: true });
  }
  return json(400, { error: 'Unknown action.' });
}
