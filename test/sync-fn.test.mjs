// Tests /api/sync with an in-memory stand-in for the server store that supports ETag conditional writes.
import assert from 'node:assert';
import { handle } from '../server/sync.mjs';
import { memoryStore } from './sync-fn-store.mjs';


const KEY = 'k'.repeat(43);
const T = Date.now(); // realistic timestamps (old tombstones are pruned)
const send = (store, body, { key = KEY, method = 'POST' } = {}) => handle(new Request('https://x/api/sync', {
  method, body: method === 'POST' ? JSON.stringify(body) : undefined,
  headers: key ? { authorization: `Bearer ${key}` } : {},
}), store).then(async (r) => ({ status: r.status, body: await r.json() }));

// --- auth & validation
let store = memoryStore();
assert.equal((await send(store, {}, { key: '' })).status, 401);
assert.equal((await send(store, {}, { method: 'GET' })).status, 405);
assert.equal((await send(store, { join: true })).status, 404, 'joining a key with no data');

// --- phone uploads everything
const phone1 = await send(store, { since: 0, records: {
  'c:a': { p: { id: 'a', name: 'Practice questions' }, m: T + 100 },
  'wp:2026-09-28:a': { p: { ticks: [1, 0, 0, 0, 0, 0, 0] }, m: T + 100 },
  'ws:2026-09-28:a': { p: { name: 'Practice questions' }, m: T + 100 },
  'bad key!': { p: 1, m: T + 1 },
}, tombs: {} });
assert.equal(phone1.status, 200);
assert.equal(phone1.body.version, 1);
assert.equal(Object.keys(phone1.body.records).length, 3, 'invalid record keys are ignored');
assert(![...store.mem.keys()].some((k) => k.includes(KEY)), 'raw key is not used as the storage name');

// --- Mac joins and gets everything
const mac1 = await send(store, { since: 0, join: true, records: {}, tombs: {} });
assert.equal(mac1.body.full, true);
assert.deepEqual(Object.keys(mac1.body.records).sort(), ['c:a', 'wp:2026-09-28:a', 'ws:2026-09-28:a']);

// --- newest change wins, per record
await send(store, { since: 1, records: { 'ws:2026-09-28:a': { p: { name: 'Practice questions (daily)' }, m: T + 300 } } }); // Mac renames
const phone2 = await send(store, { since: 1, records: { 'wp:2026-09-28:a': { p: { ticks: [1, 1, 0, 0, 0, 0, 0] }, m: T + 200 } } }); // phone ticks (earlier)
assert.equal(phone2.body.records['ws:2026-09-28:a'].p.name, 'Practice questions (daily)', 'phone receives the rename');
assert.deepEqual(phone2.body.records['wp:2026-09-28:a'].p.ticks, [1, 1, 0, 0, 0, 0, 0], 'rename did not wipe the tick');
const stale = await send(store, { since: 0, records: { 'c:a': { p: { id: 'a', name: 'OLD' }, m: T + 50 } } });
assert.equal(stale.body.records['c:a'].p.name, 'Practice questions', 'older change does not overwrite a newer one');

// --- only changes since the device's version are returned
const v = phone2.body.version;
const quiet = await send(store, { since: v, records: {}, tombs: {} });
assert.equal(Object.keys(quiet.body.records).length, 0);
assert.equal(quiet.body.version, v, 'no-op sync does not bump the version');

// --- deletions
await send(store, { since: v, tombs: { 'c:a': T + 400 } });
const afterDel = await send(store, { since: v, records: {}, tombs: {} });
assert.equal(afterDel.body.tombs['c:a'], T + 400, 'other devices learn about the deletion');
const resurrectOld = await send(store, { since: 0, records: { 'c:a': { p: { id: 'a' }, m: T + 350 } } });
assert(!('c:a' in resurrectOld.body.records), 'an edit made before the deletion does not bring it back');
const resurrectNew = await send(store, { since: 0, records: { 'c:a': { p: { id: 'a', name: 'Back' }, m: T + 500 } } });
assert.equal(resurrectNew.body.records['c:a'].p.name, 'Back', 'an edit made after the deletion wins');

// --- two devices writing at the same instant: neither change is lost
let raced = false;
const racing = memoryStore({
  async beforeWrite() {
    if (raced) return;
    raced = true; // sneak in a write from the "other device" between this request's read and write
    await handle(new Request('https://x/api/sync', { method: 'POST', headers: { authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ since: 0, records: { 'c:mac': { p: { id: 'mac' }, m: T + 10 } } }) }), racing);
  },
});
const raceRes = await send(racing, { since: 0, records: { 'c:phone': { p: { id: 'phone' }, m: T + 10 } } });
assert.equal(raceRes.status, 200);
assert.deepEqual(Object.keys(raceRes.body.records).sort(), ['c:mac', 'c:phone'], 'both concurrent writes survive');

// --- turning sync off
await send(store, null, { method: 'DELETE' });
assert.equal((await send(store, { since: 5, records: {} })).status, 410, 'device learns sync was turned off');
console.log('ALL SYNC FUNCTION TESTS PASSED');

// --- older devices can't delete kinds of record they don't know
{
  const { handle: h } = await import('../server/sync.mjs');
  const { memoryStore: ms } = await import('./sync-fn-store.mjs');
  const st = ms(), K = 'q'.repeat(43);
  const call = (body) => h(new Request('https://x/api/sync', { method: 'POST', headers: { authorization: `Bearer ${K}` }, body: JSON.stringify(body) }), st).then((r) => r.json());
  await call({ since: 0, records: { 'n:a': { p: { id: 'a', text: 'GONG' }, m: 1 } }, tombs: {}, kinds: ['c', 'ws', 'wp', 'f', 'n'] });
  let r = await call({ since: 0, records: {}, tombs: { 'n:a': 5 } }); // an old device (no kinds)
  if (!r.records['n:a']) throw new Error('old device deleted a note');
  r = await call({ since: 0, records: {}, tombs: { 'n:a': 6 }, kinds: ['c', 'ws', 'wp', 'f', 'n'] });
  if (r.records['n:a']) throw new Error('new device could not delete a note');
  console.log('UNKNOWN-KIND DELETION GUARD PASSED');
}
