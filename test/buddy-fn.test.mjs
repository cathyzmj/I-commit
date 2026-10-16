// Tests /api/buddy with an in-memory store.
import assert from 'node:assert';
import { handle } from '../server/buddy.mjs';
import { memoryStore } from './sync-fn-store.mjs';

const store = memoryStore(), loginStore = memoryStore();
const call = (body, token, dataKey) => handle(new Request('https://x/api/buddy', {
  method: body ? 'POST' : 'GET',
  headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(dataKey ? { 'x-data-key': dataKey } : {}) },
  body: body ? JSON.stringify(body) : undefined,
}), store, loginStore).then(async (r) => ({ status: r.status, body: await r.json() }));
// Google accounts as /api/login stores them: key:<sha256(data key)> -> sub, user:<sub> -> email.
const sha = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');
const account = async (sub, email, name, key) => {
  await loginStore.setJSON(`user:${sub}`, { sub, email, name, syncKey: key });
  await loginStore.setJSON(`key:${await sha(key)}`, { sub });
};
const today = new Date().toISOString().slice(0, 10);

// --- create
assert.equal((await call({ action: 'create', me: '' })).status, 400, 'a name is needed');
const a = await call({ action: 'create', me: 'Cathy', name: 'Daily online test' });
assert.equal(a.status, 200);
assert.match(a.body.token, /^[A-Za-z0-9_-]{43}$/);
assert.match(a.body.pact.invite, /^[a-z0-9]{10}$/);
assert.equal(a.body.pact.members.length, 1);
assert.equal(a.body.pact.members[0].me, true);
assert(!JSON.stringify([...store.mem.values()]).includes(a.body.token), 'tokens are never stored');
assert(!JSON.stringify(a.body).includes('tokenHash'), 'token hashes are not shown');

// --- join
assert.equal((await call({ action: 'join', invite: 'zzzzzzzzzz', me: 'Alex' })).status, 404);
const b = await call({ action: 'join', invite: a.body.pact.invite.toUpperCase(), me: 'Alex' });
assert.equal(b.status, 200);
assert.deepEqual(b.body.pact.members.map((m) => [m.name, m.me]), [['Cathy', false], ['Alex', true]]);

// --- access
assert.equal((await call(null)).status, 401);
assert.equal((await call(null, 'x'.repeat(43))).status, 401, 'unknown token');
assert.equal((await call({ action: 'tick', date: today, done: true })).status, 401);

// --- ticks
const t1 = await call({ action: 'tick', date: today, done: true, note: '  SHL numerical\n14/18 ' }, a.body.token);
assert.equal(t1.status, 200);
const cathy = t1.body.pact.members.find((m) => m.me);
assert.equal(cathy.days[today].d, 1);
assert.equal(cathy.days[today].n, 'SHL numerical 14/18');
assert.equal((await call({ action: 'tick', date: '2020-01-01', done: true }, a.body.token)).status, 400, 'old dates refused');
const seen = await call(null, b.body.token);
assert.equal(seen.body.pact.members.find((m) => m.name === 'Cathy').days[today].d, 1, 'the partner sees it');
const untick = await call({ action: 'tick', date: today, done: false }, a.body.token);
assert.equal(untick.body.pact.members.find((m) => m.me).days[today], undefined);

// --- concurrent ticks both survive
await Promise.all([
  call({ action: 'tick', date: today, done: true }, a.body.token),
  call({ action: 'tick', date: today, done: true }, b.body.token),
]);
const both = await call(null, a.body.token);
assert(both.body.pact.members.every((m) => m.days[today]), 'both ticks kept');

// --- calendar sharing
const ev = [{ d: today, s: '10:00', e: '12:00', n: 'Microeconomics lecture' }, { d: today, s: '25:00', n: 'bad time' }, { d: 'x', n: 'bad date' }];
let shared = await call({ action: 'calendar', events: ev, detail: 'names' }, a.body.token);
let mine = shared.body.pact.members.find((m) => m.me);
assert.equal(mine.cal.events.length, 2, 'bad dates dropped');
assert.equal(mine.cal.events[1].s, null, 'bad times dropped');
assert.equal((await call(null, b.body.token)).body.pact.members.find((m) => m.name === 'Cathy').cal.events[0].n, 'Microeconomics lecture', 'the buddy sees it');
shared = await call({ action: 'calendar', events: ev, detail: 'busy' }, a.body.token);
assert.equal(shared.body.pact.members.find((m) => m.me).cal.events[0].n, '', 'busy-only hides names');
shared = await call({ action: 'calendar', events: null }, a.body.token);
assert.equal(shared.body.pact.members.find((m) => m.me).cal, undefined, 'sharing can be turned off');
assert.equal((await call(null, b.body.token)).body.pact.members.find((m) => m.name === 'Alex').cal, undefined, 'nothing shared unless turned on');

// --- invite by Gmail
const HAN = 'h'.repeat(43), EVE = 'e'.repeat(43);
await account('g-han', 'han@gmail.com', 'Han', HAN);
await account('g-eve', 'eve@gmail.com', 'Eve', EVE);
assert.equal((await call({ action: 'invite-email', email: 'not an email' }, a.body.token)).status, 400);
const inv = await call({ action: 'invite-email', email: ' Han@Gmail.com ' }, a.body.token);
assert.deepEqual(inv.body.pact.invited, ['han@gmail.com'], 'members see who is invited');
assert.equal((await call({ action: 'invites' })).status, 401, 'invites need a Google sign-in');
const seen2 = await call({ action: 'invites' }, null, HAN);
assert.equal(seen2.body.invites.length, 1);
assert.deepEqual(seen2.body.invites[0].from.sort(), ['Alex', 'Cathy']);
assert.equal((await call({ action: 'invites' }, null, EVE)).body.invites.length, 0, 'only the invited email sees it');
assert.equal((await call({ action: 'accept', pactId: seen2.body.invites[0].pactId }, null, EVE)).status, 409, 'someone else can\'t accept it');
const acc = await call({ action: 'accept', pactId: seen2.body.invites[0].pactId }, null, HAN);
assert.equal(acc.status, 200);
assert.match(acc.body.token, /^[A-Za-z0-9_-]{43}$/);
assert(acc.body.pact.members.some((x) => x.name === 'Han' && x.me));
assert.deepEqual(acc.body.pact.invited, [], 'the invite is used up');
assert.equal((await call({ action: 'invites' }, null, HAN)).body.invites.length, 0);
await call({ action: 'invite-email', email: 'eve@gmail.com' }, a.body.token);
await call({ action: 'decline', pactId: seen2.body.invites[0].pactId }, null, EVE);
assert.deepEqual((await call(null, a.body.token)).body.pact.invited, [], 'declining removes the invite');
await call({ action: 'invite-email', email: 'eve@gmail.com' }, a.body.token);
await call({ action: 'uninvite', email: 'eve@gmail.com' }, a.body.token);
assert.equal((await call({ action: 'invites' }, null, EVE)).body.invites.length, 0, 'taken back');
await call({ action: 'leave' }, acc.body.token);

// --- leave
assert.equal((await call({ action: 'leave' }, b.body.token)).status, 200);
assert.equal((await call(null, b.body.token)).status, 401, 'left members lose access');
assert.equal((await call(null, a.body.token)).body.pact.members.length, 1);
await call({ action: 'leave' }, a.body.token);
assert.equal(store.mem.size, 0, 'the last person leaving deletes everything');
console.log('ALL BUDDY FUNCTION TESTS PASSED');
