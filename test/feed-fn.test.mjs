// Tests /api/feed, the private calendar link: making the link, the .ics Google Calendar reads
// (times, all-day dates, escaping, long lines), updating only what a device sent, a new link,
// and stopping.
import assert from 'node:assert';
import { handle, toIcs } from '../server/feed.mjs';
import { memoryStore } from './sync-fn-store.mjs';

const hex = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');
const ORIGIN = 'https://commit.example';
const KEY = 'k'.repeat(43), SUB = 'g-cathy';
const loginStore = memoryStore(), store = memoryStore();
await loginStore.setJSON(`key:${await hex(KEY)}`, { sub: SUB });
await loginStore.setJSON(`user:${SUB}`, { sub: SUB, email: 'cathy@example.com' });
const ctx = { store, loginStore };
const call = async (method, path, body, key = KEY) => {
  const r = await handle(new Request(`${ORIGIN}/api/feed${path}`, { method, headers: key ? { authorization: `Bearer ${key}` } : {}, body: body ? JSON.stringify(body) : undefined }), ctx);
  return { status: r.status, body: await r.json() };
};
const fetchIcs = async (url) => { const r = await handle(new Request(url), ctx); return { status: r.status, type: r.headers.get('content-type'), text: await r.text() }; };
const ev = (key, src, date, extra = {}) => ({ key, src, date, title: `Item ${key}`, ...extra });
const body = (events, sources = ['task', 'meet', 'app'], from = '2026-10-20') => ({ tz: 'Europe/London', from, sources, events });
const unfold = (t) => t.replace(/\r\n /g, '');

// --- not signed in / nothing yet
assert.equal((await call('GET', '', null, 'z'.repeat(43))).status, 401);
assert.deepEqual((await call('GET', '')).body, { url: null, updatedAt: null });
assert.equal((await call('PUT', '', { tz: 'nope', from: '2026-10-20' })).status, 400);

// --- making the link
let r = await call('PUT', '', body([
  ev('c:t1', 'task', '2026-10-26', { time: '10:00', endTime: '11:30', notes: 'Bring CV; and pen, please\nRoom 2', url: 'https://example.com/x' }),
  ev('c:t2', 'task', '2026-10-26', { time: '23:30' }),
  ev('c:t3', 'task', '2026-10-24', { time: '22:00', endTime: '01:00' }),
  ev('m:mt1', 'meet', '2026-10-27', { time: '14:00' }),
  ev('a:gs:close', 'app', '2026-10-31'),
  { key: 'bad key', src: 'task', date: '2026-10-26', title: 'x' }, ev('c:other', 'nope', '2026-10-26'), ev('c:old', 'task', '2026-09-01'),
]));
const url = r.body.url;
assert.match(url, /^https:\/\/commit\.example\/api\/feed\/[A-Za-z0-9_-]{43}\.ics$/);
let ics = await fetchIcs(url);
assert.equal(ics.status, 200);
assert.equal(ics.type, 'text/calendar; charset=utf-8');
const text = unfold(ics.text);
assert.match(text, /^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\n/);
assert.match(text, /X-WR-CALNAME:I Commit!\r\n/);
assert.equal((text.match(/BEGIN:VEVENT/g) || []).length, 5, 'bad keys, unknown kinds and dates before `from` are left out');
assert.match(text, /UID:c-t1@icommit\r\nDTSTAMP:\d{8}T\d{6}Z\r\nDTSTART:20261026T100000Z\r\nDTEND:20261026T113000Z\r\n/, 'GMT after the clocks change');
assert.match(text, /SUMMARY:Item c:t1\r\nDESCRIPTION:Bring CV\\; and pen\\, please\\nRoom 2\\n\\nhttps:\/\/example\.com\/x\r\nURL:https:\/\/example\.com\/x\r\n/, 'escaped');
assert.match(text, /UID:c-t2@icommit\r\nDTSTAMP:\S+\r\nDTSTART:20261026T233000Z\r\nDTEND:20261027T003000Z/, 'an hour long by default, past midnight');
assert.match(text, /UID:c-t3@icommit\r\nDTSTAMP:\S+\r\nDTSTART:20261024T210000Z\r\nDTEND:20261025T010000Z/, 'BST start, GMT end, the next day');
assert.match(text, /DTSTART;VALUE=DATE:20261031\r\nDTEND;VALUE=DATE:20261101\r\nTRANSP:TRANSPARENT/, 'all day');
assert(ics.text.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75), 'lines are folded at 75 bytes');
const long = toIcs({ tz: 'UTC', events: [{ key: 'c:x', date: '2026-10-26', title: '会议'.repeat(60), notes: '', url: '' }] });
assert(long.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75));
assert.match(unfold(long), new RegExp(`SUMMARY:${'会议'.repeat(60)}\r\n`), 'never folded inside a character');
assert.equal((await call('GET', '')).body.url, url);

// --- a device that couldn't load projects: meetings stay; removed tasks go; old history stays
r = await call('PUT', '', body([ev('c:t1', 'task', '2026-10-26', { time: '11:00' }), ev('c:new', 'task', '2026-10-28', { time: '08:00' })], ['task', 'app'], '2026-10-25'));
assert.equal(r.body.url, url, 'same link');
const t2 = unfold((await fetchIcs(url)).text);
assert.match(t2, /UID:m-mt1@icommit/, 'meeting kept (not sent)');
assert.match(t2, /UID:c-t3@icommit/, 'before `from`: kept');
assert.doesNotMatch(t2, /UID:c-t2@icommit/, 'deleted');
assert.doesNotMatch(t2, /UID:a-gs-close@icommit/, 'deleted');
assert.match(t2, /UID:c-t1@icommit\r\nDTSTAMP:\S+\r\nDTSTART:20261026T110000Z/, 'changed');
assert.match(t2, /UID:c-new@icommit/, 'added');

// --- a new link: the old one stops
const fresh = (await call('POST', '/reset')).body.url;
assert.notEqual(fresh, url);
assert.equal((await fetchIcs(url)).status, 404);
assert.match((await fetchIcs(fresh)).text, /UID:c-new@icommit/);
assert.equal((await fetchIcs(`${ORIGIN}/api/feed/${'x'.repeat(43)}.ics`)).status, 404, 'made-up link');
assert.equal((await fetchIcs(`${ORIGIN}/api/feed/short.ics`)).status, 404);

// --- stop sharing
assert.deepEqual((await call('DELETE', '')).body, { url: null });
assert.equal((await fetchIcs(fresh)).status, 404);
assert.deepEqual((await call('GET', '')).body, { url: null, updatedAt: null });
assert.equal((await call('POST', '/reset')).status, 404);

console.log('ALL FEED TESTS PASSED');
