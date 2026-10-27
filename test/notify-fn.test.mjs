// Tests reminders through Telegram against a fake Telegram: linking a chat (/start <code>), the
// bot's commands, time zones, which reminders fall due when, the /api/notify endpoints, and the
// every-minute run (including a chat that blocked the bot).
import assert from 'node:assert';
import { handle, run, webhook, dueMessages, zonedTime, cleanPrefs, cleanPlan, summaryText, DEFAULT_PREFS } from '../server/notify.mjs';
import { webhookSecret } from '../server/telegram.mjs';
import { memoryStore } from './sync-fn-store.mjs';

const hex = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');
const ORIGIN = 'https://commit.example';
const env = { TELEGRAM_BOT_TOKEN: '123456:ABC-test-token' };

// ---- a fake Telegram Bot API
const tg = { sent: [], webhook: null, blocked: new Set(), calls: [] };
async function fakeTelegram(url, opts) {
  const m = /^https:\/\/api\.telegram\.org\/bot([^/]+)\/(\w+)$/.exec(url);
  assert(m, `unexpected ${url}`);
  tg.calls.push(m[2]);
  if (m[1] !== env.TELEGRAM_BOT_TOKEN) return Response.json({ ok: false, error_code: 401, description: 'Unauthorized' }, { status: 401 });
  const body = JSON.parse(opts.body);
  if (m[2] === 'getMe') return Response.json({ ok: true, result: { id: 1, is_bot: true, username: 'ICommitBot' } });
  if (m[2] === 'setWebhook') { tg.webhook = body; return Response.json({ ok: true, result: true }); }
  if (m[2] === 'sendMessage') {
    if (tg.blocked.has(body.chat_id)) return Response.json({ ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' }, { status: 403 });
    assert.equal(body.parse_mode, 'HTML');
    tg.sent.push(body);
    return Response.json({ ok: true, result: { message_id: tg.sent.length } });
  }
  throw new Error(`unexpected method ${m[2]}`);
}

// --- time zones: wall-clock time in the plan's zone, across a clock change
assert.equal(new Date(zonedTime('2026-10-24', '07:30', 'Europe/London')).toISOString(), '2026-10-24T06:30:00.000Z', 'BST');
assert.equal(new Date(zonedTime('2026-10-25', '07:30', 'Europe/London')).toISOString(), '2026-10-25T07:30:00.000Z', 'clocks went back overnight');
assert.equal(new Date(zonedTime('2026-10-25', '09:00', 'Asia/Shanghai')).toISOString(), '2026-10-25T01:00:00.000Z');
assert.equal(new Date(zonedTime('2026-03-29', '01:30', 'Europe/London')).toISOString(), '2026-03-29T01:30:00.000Z', 'a time skipped by the clock change moves an hour later');

// --- settings and plans are cleaned
assert.deepEqual(cleanPrefs({ lead: 7, nudgeTime: '25:00', summary: false, x: 1 }), { ...DEFAULT_PREFS, summary: false });
assert.equal(cleanPlan({ tz: 'Not/AZone' }), null);
const plan = cleanPlan({
  tz: 'Europe/London',
  days: [{ date: '2026-10-26', tasks: [{ t: 'Coffee chat', time: '10:00' }, { t: 'Write CV' }], routines: [{ t: 'Gym', done: true }, { t: 'Read' }, { t: 'Duolingo' }],
    schedule: [{ t: 'EC1A1 lecture', time: '09:00' }], meetings: [{ t: 'Kick-off · Consulting', time: '14:00' }], apps: [{ t: 'Goldman Sachs closes' }], junk: 1 }],
  timed: [{ key: 'c:abc', date: '2026-10-26', time: '10:00', title: 'Coffee chat', where: 'Library' }, { key: 'bad key', date: '2026-10-26', time: '10:00', title: 'x' }],
  deadlines: [{ key: 'a:gs:close', date: '2026-10-27', title: 'Goldman Sachs closes' }],
});
assert.equal(plan.timed.length, 1, 'bad keys are dropped');

// --- what falls due when (London is on GMT from 25 Oct)
const at = (iso) => Date.parse(iso);
const ids = (now, prefs = DEFAULT_PREFS, sent) => dueMessages(plan, prefs, at(now), sent).map((m) => m.id);
assert.deepEqual(ids('2026-10-26T07:29:00Z'), []);
assert.deepEqual(ids('2026-10-26T07:30:00Z'), ['s:2026-10-26'], 'morning summary at 07:30');
assert.deepEqual(ids('2026-10-26T09:50:00Z'), ['t:c:abc:2026-10-26T10:00'], '10 minutes before');
assert.deepEqual(ids('2026-10-26T09:50:00Z', { ...DEFAULT_PREFS, timed: false }), []);
assert.deepEqual(ids('2026-10-26T09:45:00Z', { ...DEFAULT_PREFS, lead: 15 }), ['t:c:abc:2026-10-26T10:00']);
assert.deepEqual(ids('2026-10-26T09:50:00Z', DEFAULT_PREFS, { 't:c:abc:2026-10-26T10:00': 1 }), [], 'sent once');
assert.deepEqual(ids('2026-10-26T10:11:00Z'), [], 'over 20 minutes late: dropped');
assert.deepEqual(ids('2026-10-26T09:00:00Z'), ['d:a:gs:close:2026-10-27'], 'the day before a deadline at 09:00');
assert.deepEqual(dueMessages(plan, DEFAULT_PREFS, at('2026-10-26T20:00:00Z')).map((m) => [m.id, m.text]),
  [['r:2026-10-26', '<b>☑️ 2 routines still to tick</b>\nRead, Duolingo']]);
assert.equal(dueMessages(plan, DEFAULT_PREFS, at('2026-10-26T09:50:00Z'))[0].text, '<b>⏰ Coffee chat</b>\nIn 10 min · 10:00 · Library');

// --- the morning summary
const sum = summaryText(plan.days[0], ORIGIN);
assert.equal(sum, ['☀️ <b>Mon 26 Oct</b>', '', '<b>Timeline</b>', '09:00  EC1A1 lecture', '10:00  Coffee chat', '14:00  Kick-off · Consulting',
  '', '<b>To do</b>', '• Write CV', '', '<b>Routines</b>', '• Gym ✓', '• Read', '• Duolingo', '', '<b>Applications</b>', '• Goldman Sachs closes',
  '', `<a href="${ORIGIN}/#/today">Open I Commit!</a>`].join('\n'));
assert.match(summaryText({ date: '2026-10-26', tasks: [{ t: 'A & <B>' }], routines: [], schedule: [], meetings: [], apps: [] }, ''), /A &amp; &lt;B&gt;/, 'escaped');
assert.match(summaryText({ date: '2026-10-26', tasks: [], routines: [], schedule: [], meetings: [], apps: [] }, ''), /Nothing planned/);

// ---- the endpoints
const KEY = 'k'.repeat(43), SUB = 'g-cathy';
const loginStore = memoryStore();
await loginStore.setJSON(`key:${await hex(KEY)}`, { sub: SUB });
await loginStore.setJSON(`user:${SUB}`, { sub: SUB, email: 'cathy@example.com', name: 'Cathy' });
const store = memoryStore();
const ctx = { store, loginStore, env, fetchImpl: fakeTelegram };
const call = async (method, path, body, key = KEY, c = ctx) => {
  const r = await handle(new Request(`${ORIGIN}/api/notify${path}`, { method, headers: key ? { authorization: `Bearer ${key}` } : {}, body: body ? JSON.stringify(body) : undefined }), c);
  return { status: r.status, body: await r.json() };
};
const secret = await webhookSecret(env);
const say = async (text, chat = { id: 777, username: 'cathy_z' }, s = secret) => (await webhook(new Request(`${ORIGIN}/api/telegram/webhook`, {
  method: 'POST', headers: s ? { 'x-telegram-bot-api-secret-token': s } : {}, body: JSON.stringify({ update_id: 1, message: { message_id: 1, chat, text } }) }), ctx)).status;
const lastText = () => tg.sent.at(-1).text;

assert.equal((await call('GET', '', null, 'z'.repeat(43))).status, 401, 'needs a signed-in account');
assert.deepEqual((await call('GET', '', null, KEY, { ...ctx, env: {} })).body, { prefs: DEFAULT_PREFS, telegram: null, bot: null, setup: true });
const st = (await call('GET', '')).body;
assert.equal(st.bot, 'ICommitBot', 'the bot\'s name, for the t.me link');
assert.deepEqual(tg.webhook, { url: `${ORIGIN}/api/telegram/webhook`, secret_token: secret, allowed_updates: ['message'] }, 'the webhook registers itself');
tg.calls.length = 0;
await call('GET', '');
assert.deepEqual(tg.calls, [], 'asked once, then remembered');
assert.equal((await call('GET', '', null, KEY, { ...ctx, env: { TELEGRAM_BOT_TOKEN: 'wrong' } })).body.error.match(/token on the server is wrong/)?.length, 1);

// --- linking a chat
assert.equal(await say('/start whatever', undefined, 'not-the-secret'), 403, 'only Telegram can call the webhook');
assert.equal((await call('POST', '/telegram', { code: 'short' })).status, 400);
const CODE = 'c'.repeat(32);
assert.deepEqual((await call('POST', '/telegram', { code: CODE })).body, { bot: 'ICommitBot' });
await say('/today');
assert.match(lastText(), /isn’t linked yet/, 'before linking');
await say(`/start ${CODE}`);
assert.match(lastText(), /Connected to I Commit!/);
assert.deepEqual((await call('GET', '')).body.telegram, { name: '@cathy_z' });
await say(`/start ${CODE}`);
assert.match(lastText(), /expired/, 'a code works once');
await say('hello');
assert.match(lastText(), /\/today/, 'help');

// --- settings, plan, test messages, /today
assert.equal((await call('PUT', '/prefs', { prefs: { lead: 30 } })).body.prefs.lead, 30);
await call('PUT', '/prefs', { prefs: DEFAULT_PREFS });
assert.equal((await call('PUT', '/plan', { plan: { tz: 'nope' } })).status, 400);
await say('/today');
assert.match(lastText(), /Open I Commit! once/, 'no plan yet');
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
assert.deepEqual((await call('PUT', '/plan', { plan: { ...plan, days: [{ ...plan.days[0], date: today }, ...plan.days] } })).body, { ok: true });
await say('/today');
assert.match(lastText(), /Write CV[\s\S]*Open I Commit!/);
assert.deepEqual((await call('POST', '/test', {})).body, { sent: true, error: null });
assert.match(lastText(), /Reminders will arrive here/);
await call('POST', '/test', { summary: true });
assert.match(lastText(), /☀️/);
assert.equal(tg.sent.at(-1).chat_id, 777, 'to the linked chat');

// ---- the minute job
await call('PUT', '/plan', { plan });
const before = tg.sent.length;
assert.deepEqual(await run({ store, env, fetchImpl: fakeTelegram, now: at('2026-10-26T07:30:30Z') }), { sent: 1 });
assert.match(lastText(), /☀️ <b>Mon 26 Oct<\/b>[\s\S]*https:\/\/commit\.example\/#\/today/, 'morning summary links back to the app');
assert.deepEqual(await run({ store, env, fetchImpl: fakeTelegram, now: at('2026-10-26T07:31:30Z') }), { sent: 0 }, 'not again next minute');
await run({ store, env, fetchImpl: fakeTelegram, now: at('2026-10-26T09:50:00Z') });
assert.equal(tg.sent.length, before + 2);
assert.deepEqual(await run({ store, env: {}, fetchImpl: fakeTelegram, now: at('2026-10-26T20:00:00Z') }), { sent: 0 }, 'no bot: nothing sent');

// You blocked the bot: the chat is unlinked and nothing more is tried.
tg.blocked.add(777);
assert.deepEqual(await run({ store, env, fetchImpl: fakeTelegram, now: at('2026-10-26T20:00:00Z') }), { sent: 0 });
assert.equal((await call('GET', '')).body.telegram, null);
tg.calls.length = 0;
await run({ store, env, fetchImpl: fakeTelegram, now: at('2026-10-27T09:00:00Z') });
assert.deepEqual(tg.calls, [], 'not linked: Telegram isn\'t called');
tg.blocked.clear();

// /stop unlinks; a chat moves to the account that links it last
await call('POST', '/telegram', { code: 'd'.repeat(32) });
await say(`/start ${'d'.repeat(32)}`);
await say('/stop');
assert.match(lastText(), /Reminders stopped/);
assert.equal((await call('GET', '')).body.telegram, null);
await call('POST', '/telegram', { code: 'e'.repeat(32) });
await say(`/start ${'e'.repeat(32)}`);
assert.deepEqual((await call('DELETE', '/telegram')).body.telegram, null, 'disconnect from the app');
await say('/today');
assert.match(lastText(), /isn’t linked yet/);

console.log('ALL NOTIFY TESTS PASSED');
