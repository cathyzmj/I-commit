// Tests server/d1-store.mjs against real SQLite (node:sqlite) behind a minimal D1-style wrapper,
// then runs the sync handler on it, including two devices writing at the same moment.
import assert from 'node:assert';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1Store } from '../server/d1-store.mjs';
import { handle as sync } from '../server/sync.mjs';

// The subset of the D1 API the store uses: prepare(sql).bind(...).first() / .run()
function fakeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8'));
  return {
    prepare(sql) {
      const stmt = db.prepare(sql);
      let args = [];
      const api = {
        bind(...a) { args = a; return api; },
        async first() { return stmt.get(...args) ?? null; },
        async run() { const r = stmt.run(...args); return { meta: { changes: Number(r.changes) } }; },
        async all() { return { results: stmt.all(...args) }; },
      };
      return api;
    },
  };
}

const db = fakeD1();
const s = d1Store(db, 'sync');
const other = d1Store(db, 'widget');

// plain values
assert.equal(await other.get('a'), null);
await other.set('a', '{"v":1}');
assert.equal(await other.get('a'), '{"v":1}');
assert.equal(await s.get('a'), null, 'stores are separate');
await other.delete('a');
assert.equal(await other.get('a'), null);

// conditional JSON writes
assert.deepEqual(await s.getWithMetadata('doc'), null);
assert.equal((await s.setJSON('doc', { n: 1 }, { onlyIfNew: true })).modified, true);
assert.equal((await s.setJSON('doc', { n: 99 }, { onlyIfNew: true })).modified, false, 'onlyIfNew refuses to overwrite');
const cur = await s.getWithMetadata('doc');
assert.deepEqual(cur.data, { n: 1 });
assert.equal((await s.setJSON('doc', { n: 2 }, { onlyIfMatch: 'stale-etag' })).modified, false, 'stale ETag is refused');
assert.equal((await s.setJSON('doc', { n: 2 }, { onlyIfMatch: cur.etag })).modified, true);
assert.equal((await s.setJSON('doc', { n: 3 }, { onlyIfMatch: cur.etag })).modified, false, 'ETag changes after each write');
assert.deepEqual((await s.getWithMetadata('doc')).data, { n: 2 });

// listing by key prefix (reminders): only that store, only that prefix, % and _ taken literally
await s.setJSON('plan:1', { a: 1 });
await s.setJSON('plan:2', { a: 2 });
await s.setJSON('planX', { a: 3 });
await s.setJSON('p%n:1', { a: 4 });
await other.setJSON('plan:9', { a: 9 });
assert.deepEqual((await s.list('plan:')).map((r) => r.key).sort(), ['plan:1', 'plan:2']);
assert.deepEqual((await s.list('p%n:')).map((r) => r.data), [{ a: 4 }]);
assert.deepEqual(await s.list('pla_'), []);

// the sync handler on D1, with two devices racing
const KEY = 'q'.repeat(43), T = Date.now();
const post = (body) => sync(new Request('https://x/api/sync', { method: 'POST', headers: { authorization: `Bearer ${KEY}` }, body: JSON.stringify(body) }), s)
  .then((r) => r.json());
await post({ since: 0, records: { 'c:a': { p: { id: 'a' }, m: T } } });
const results = await Promise.all([1, 2, 3, 4, 5].map((i) => post({ since: 1, records: { [`c:n${i}`]: { p: { id: `n${i}` }, m: T + i } } })));
assert(results.every((r) => r.version >= 2));
const all = await post({ since: 0 });
assert.deepEqual(Object.keys(all.records).sort(), ['c:a', 'c:n1', 'c:n2', 'c:n3', 'c:n4', 'c:n5'], 'no concurrent write was lost');
console.log('ALL D1 STORE TESTS PASSED');
