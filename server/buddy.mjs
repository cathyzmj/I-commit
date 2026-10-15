// /api/buddy — Work Buddy pacts: a few people doing the same routine, each ticking their own day.
//
//   POST { action: 'create', me, name }   starts a pact        -> { token, pact }
//   POST { action: 'join', invite, me }    joins with a code    -> { token, pact }
//   GET                                    reads the pact       -> { pact }
//   POST { action: 'tick', date, done, note }                   -> { pact }
//   POST { action: 'leave' }               leaves (the pact is deleted when the last person leaves)
//   POST { action: 'calendar', events, detail }   shares (or, with events: null, stops sharing) your
//                                          calendar with the pact: [{ d, s, e, n }] for the next few weeks;
//                                          detail 'busy' drops the names so only the times are shared
//
// Everything except create/join carries "Authorization: Bearer <token>". Each member has their
// own random token; only its SHA-256 hash is stored. Invite codes are short and only let someone
// join. `store` has getWithMetadata / setJSON (conditional) / delete, like the sync store.

const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;
const INVITE_RE = /^[a-z0-9]{10}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_MEMBERS = 6;
const KEEP_DAYS = 120;
const MAX_EVENTS = 600;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
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
    id: pact.id, name: pact.name, invite: pact.invite, created: pact.created,
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

export async function handle(req, store) {
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
