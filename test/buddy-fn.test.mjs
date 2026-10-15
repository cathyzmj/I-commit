// Tests /api/buddy with an in-memory store.
import assert from 'node:assert';
import { handle } from '../server/buddy.mjs';
import { memoryStore } from './sync-fn-store.mjs';

const store = memoryStore();
const call = (body, token) => handle(new Request('https://x/api/buddy', {
  method: body ? 'POST' : 'GET',
  headers: token ? { authorization: `Bearer ${token}` } : {},
  body: body ? JSON.stringify(body) : undefined,
}), store).then(async (r) => ({ status: r.status, body: await r.json() }));
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

// --- leave
assert.equal((await call({ action: 'leave' }, b.body.token)).status, 200);
assert.equal((await call(null, b.body.token)).status, 401, 'left members lose access');
assert.equal((await call(null, a.body.token)).body.pact.members.length, 1);
await call({ action: 'leave' }, a.body.token);
assert.equal(store.mem.size, 0, 'the last person leaving deletes everything');
console.log('ALL BUDDY FUNCTION TESTS PASSED');
