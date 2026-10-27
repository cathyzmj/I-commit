// /api/notify — reminders through Telegram, sent while the app is closed.
//   GET    /api/notify            -> { prefs, telegram: { name } | null, bot, setup }
//   PUT    /api/notify/prefs      { prefs }   what to send and when
//   PUT    /api/notify/plan       { plan }    the next 8 days, as the app sees them
//   POST   /api/notify/telegram   { code }    the app is opening t.me/<bot>?start=<code>: link that chat
//   DELETE /api/notify/telegram               unlink Telegram
//   POST   /api/notify/test       { summary } a test message now (or today's summary)
//   POST   /api/telegram/webhook  <- Telegram: /start <code> links a chat, /today, /stop (webhook())
// Requests to /api/notify carry "Authorization: Bearer <data key>" of a signed-in account.
//
// The server can't work out your days itself (routines, ticks and imported calendars live in the
// app), so every device sends a small plan after each change: timed tasks and meetings, application
// deadlines, and each day's to-dos and routines. A job every minute (run(), the Worker's cron) turns
// the plan and your settings into Telegram messages:
//   • `lead` minutes before a timed task or meeting
//   • the day before an application deadline (at `deadlineTime`)
//   • at `nudgeTime` if that day's routines aren't all ticked
//   • at `summaryTime`: the day ahead
// Times are wall-clock times in the time zone of the device that sent the plan. Each message is
// sent once (remembered for 3 days); a message more than 20 minutes late is dropped.
// Secret: TELEGRAM_BOT_TOKEN (server/telegram.mjs).
import { accountOf } from './account.mjs';
import { CODE_RE, ensureBot, startLink, finishLink, unlink, linkedChat, accountOfChat, sendTelegram, sendToChat, webhookSecret } from './telegram.mjs';

const json = (status, body) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/, TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/, KEY_RE = /^[a-z]:[A-Za-z0-9_.:-]{1,120}$/;
const LEADS = [0, 5, 10, 15, 30, 60, 120];
const GRACE_MS = 20 * 60e3, SENT_KEEP_MS = 3 * 864e5;
const MAX_PLAN_BYTES = 200 * 1024;
const BUDGET = 45; // outgoing requests per run (the Worker allows 50)
export const DEFAULT_PREFS = { timed: true, lead: 10, deadlines: true, deadlineTime: '09:00', routines: true, nudgeTime: '20:00', summary: true, summaryTime: '07:30' };

const str = (s, n) => String(s ?? '').trim().slice(0, n);
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

export function cleanPrefs(p = {}) {
  const t = (v, d) => (TIME_RE.test(v || '') ? v : d);
  const b = (v, d) => (typeof v === 'boolean' ? v : d);
  const D = DEFAULT_PREFS;
  return {
    timed: b(p.timed, D.timed), lead: LEADS.includes(Number(p.lead)) ? Number(p.lead) : D.lead,
    deadlines: b(p.deadlines, D.deadlines), deadlineTime: t(p.deadlineTime, D.deadlineTime),
    routines: b(p.routines, D.routines), nudgeTime: t(p.nudgeTime, D.nudgeTime),
    summary: b(p.summary, D.summary), summaryTime: t(p.summaryTime, D.summaryTime),
  };
}

export const validTz = (tz) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return typeof tz === 'string' && tz.length <= 64; } catch { return false; } };
export function cleanPlan(p) {
  if (!p || typeof p !== 'object' || !validTz(p.tz)) return null;
  const arr = (a, n) => (Array.isArray(a) ? a.slice(0, n) : []);
  const time = (v) => (TIME_RE.test(v || '') ? v : null);
  const item = (x) => ({ t: str(x && x.t, 120), time: time(x && x.time), done: !!(x && x.done) });
  return {
    tz: p.tz,
    days: arr(p.days, 14).filter((d) => d && DATE_RE.test(d.date || '')).map((d) => ({
      date: d.date,
      tasks: arr(d.tasks, 60).map(item).filter((x) => x.t),
      routines: arr(d.routines, 60).map(item).filter((x) => x.t),
      schedule: arr(d.schedule, 30).map(item).filter((x) => x.t),
      meetings: arr(d.meetings, 20).map(item).filter((x) => x.t),
      apps: arr(d.apps, 30).map(item).filter((x) => x.t),
    })),
    timed: arr(p.timed, 300).filter((x) => x && KEY_RE.test(x.key || '') && DATE_RE.test(x.date || '') && TIME_RE.test(x.time || ''))
      .map((x) => ({ key: x.key, date: x.date, time: x.time, title: str(x.title, 120), where: str(x.where, 80) })).filter((x) => x.title),
    deadlines: arr(p.deadlines, 200).filter((x) => x && KEY_RE.test(x.key || '') && DATE_RE.test(x.date || ''))
      .map((x) => ({ key: x.key, date: x.date, title: str(x.title, 120) })).filter((x) => x.title),
  };
}

// ---- time zones: "2026-10-25" "07:30" in Europe/London -> epoch ms
function tzOffset(ms, tz) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms));
  const g = (type) => Number(parts.find((x) => x.type === type).value);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - Math.floor(ms / 1000) * 1000;
}
export function zonedTime(date, time, tz) {
  const guess = Date.parse(`${date}T${time}:00Z`);
  const first = guess - tzOffset(guess, tz);
  return guess - tzOffset(first, tz);
}
export const todayIn = (tz, now = Date.now()) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
const dayBefore = (iso) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };
const dayLabel = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const list = (names, n = 4) => (names.length > n ? `${names.slice(0, n).join(', ')} and ${names.length - n} more` : names.join(', '));
const alert = (title, body) => `<b>${esc(title)}</b>\n${esc(body)}`;

// The messages due at `now` that haven't been sent yet: { id, at, text } (text is Telegram HTML).
export function dueMessages(plan, prefs, now, sent = {}, origin = '') {
  const out = [];
  const add = (m) => { if (!sent[m.id] && m.at <= now && m.at > now - GRACE_MS) out.push(m); };
  const tz = plan.tz;
  if (prefs.timed) for (const x of plan.timed) {
    const lead = prefs.lead;
    add({ id: `t:${x.key}:${x.date}T${x.time}`, at: zonedTime(x.date, x.time, tz) - lead * 60e3,
      text: alert(`⏰ ${x.title}`, `${lead ? `In ${lead} min` : 'Now'} · ${x.time}${x.where ? ` · ${x.where}` : ''}`) });
  }
  if (prefs.deadlines) for (const x of plan.deadlines) {
    add({ id: `d:${x.key}:${x.date}`, at: zonedTime(dayBefore(x.date), prefs.deadlineTime, tz), text: alert(`📌 Tomorrow: ${x.title}`, dayLabel(x.date)) });
  }
  for (const d of plan.days) {
    const open = d.routines.filter((r) => !r.done).map((r) => r.t);
    if (prefs.routines && open.length) {
      add({ id: `r:${d.date}`, at: zonedTime(d.date, prefs.nudgeTime, tz),
        text: alert(open.length === 1 ? '☑️ 1 routine still to tick' : `☑️ ${open.length} routines still to tick`, list(open)) });
    }
    if (prefs.summary) add({ id: `s:${d.date}`, at: zonedTime(d.date, prefs.summaryTime, tz), text: summaryText(d, origin) });
  }
  return out;
}

// ---- the morning summary (also /today)
export function summaryText(d, origin) {
  const byTime = (a, b) => (a.time || '99').localeCompare(b.time || '99');
  const timed = [...d.schedule, ...d.meetings, ...d.tasks.filter((x) => x.time)].sort(byTime);
  const sections = [
    ['Timeline', timed.map((x) => `${x.time ? `${x.time}  ` : ''}${x.t}`)],
    ['To do', d.tasks.filter((x) => !x.time).map((x) => `• ${x.t}`)],
    ['Routines', d.routines.map((x) => `• ${x.t}${x.done ? ' ✓' : ''}`)],
    ['Applications', d.apps.map((x) => `• ${x.t}`)],
  ].filter(([, rows]) => rows.length);
  return [`☀️ <b>${esc(dayLabel(d.date))}</b>`,
    ...(sections.length ? sections.map(([h, rows]) => `\n<b>${h}</b>\n${rows.map(esc).join('\n')}`) : ['\nNothing planned. Enjoy the day.']),
    ...(origin ? [`\n<a href="${esc(origin)}/#/today">Open I Commit!</a>`] : [])].join('\n');
}
const blankDay = (date) => ({ date, tasks: [], routines: [], schedule: [], meetings: [], apps: [] });
async function todayText(store, sub, origin) {
  const plan = await getData(store, `plan:${sub}`, null);
  if (!plan) return 'Open I Commit! once so it can send your plan here.';
  const today = todayIn(plan.tz);
  return summaryText(plan.days.find((d) => d.date === today) || blankDay(today), origin || plan.origin || '');
}

// ---- storage helpers
async function update(store, key, fn, empty) {
  for (let i = 0; i < 5; i++) {
    const cur = await store.getWithMetadata(key);
    const next = fn(cur ? cur.data : empty);
    const r = cur ? await store.setJSON(key, next, { onlyIfMatch: cur.etag }) : await store.setJSON(key, next, { onlyIfNew: true });
    if (r.modified) return next;
  }
  throw new Error('Busy, try again.');
}
const getData = async (store, key, empty) => (await store.getWithMetadata(key))?.data ?? empty;

// The Worker's cron, every minute: send what's due for every account.
export async function run({ store, env, fetchImpl = fetch, now = Date.now() }) {
  const stats = { sent: 0 };
  if (!env.TELEGRAM_BOT_TOKEN) return stats;
  let budget = BUDGET;
  for (const { key, data: plan } of await store.list('plan:')) {
    if (budget <= 0) break;
    const sub = key.slice(5);
    const prefs = cleanPrefs(await getData(store, `prefs:${sub}`, {}));
    const sent = await getData(store, `sent:${sub}`, {});
    const due = dueMessages(plan, prefs, now, sent, plan.origin || '');
    if (!due.length || !(await linkedChat(store, sub))) continue;
    const done = {};
    for (const m of due) {
      if (budget-- <= 0) break;
      const r = await sendTelegram(store, sub, m.text, { env, fetchImpl });
      if (r === 'failed') continue; // tried again next minute, until it's 20 minutes late
      done[m.id] = now;
      if (r === 'sent') stats.sent++;
      else break; // unlinked: nothing more to send
    }
    if (Object.keys(done).length) {
      await update(store, `sent:${sub}`, (s) => {
        const next = {};
        for (const [id, t] of Object.entries({ ...s, ...done })) if (t > now - SENT_KEEP_MS) next[id] = t;
        return next;
      }, {});
    }
  }
  return stats;
}

// Messages to the bot.
export async function webhook(req, { store, env, fetchImpl = fetch }) {
  if (!env.TELEGRAM_BOT_TOKEN || req.headers.get('x-telegram-bot-api-secret-token') !== await webhookSecret(env)) return json(403, { error: 'Forbidden' });
  const update = await req.json().catch(() => ({}));
  const msg = update.message;
  if (!msg || !msg.chat || typeof msg.text !== 'string') return json(200, { ok: true });
  const chat = { id: msg.chat.id, name: str(msg.chat.username ? `@${msg.chat.username}` : msg.chat.first_name, 60) };
  const [cmd, arg] = msg.text.trim().split(/\s+/);
  const origin = new URL(req.url).origin;
  const reply = (text) => sendToChat(store, chat.id, text, { env, fetchImpl });
  const sub = await accountOfChat(store, chat.id);
  if (/^\/start(@\w+)?$/.test(cmd) && arg) {
    const linked = await finishLink(store, arg, chat);
    await reply(linked ? '✅ <b>Connected to I Commit!</b>\nYour reminders will arrive here.\n\n/today — today’s plan\n/stop — stop reminders'
      : 'That link has expired. In I Commit!, open ⋯ → Reminders and tap <b>Connect Telegram</b> again.');
  } else if (/^\/today(@\w+)?$/.test(cmd)) {
    await reply(sub ? await todayText(store, sub, origin) : 'This chat isn’t linked yet. In I Commit!, open ⋯ → Reminders and tap <b>Connect Telegram</b>.');
  } else if (/^\/stop(@\w+)?$/.test(cmd)) {
    if (sub) await unlink(store, sub);
    await reply(sub ? 'Reminders stopped. Connect again any time from I Commit! → Reminders.' : 'This chat isn’t linked, so there’s nothing to stop.');
  } else {
    await reply(sub ? 'I send your I Commit! reminders here.\n\n/today — today’s plan\n/stop — stop reminders'
      : 'Hi! To get your I Commit! reminders here, open ⋯ → Reminders in the app and tap <b>Connect Telegram</b>.');
  }
  return json(200, { ok: true });
}

export async function handle(req, { store, loginStore, env, fetchImpl = fetch }) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/notify\/?/, '');
  const acct = await accountOf(req, loginStore);
  if (!acct) return json(401, { error: 'Sign in with Google first.' });
  const sub = acct.sub;
  let body = {};
  if (req.method !== 'GET') {
    const text = await req.text();
    if (text.length > MAX_PLAN_BYTES) return json(413, { error: 'Too much at once.' });
    try { body = text ? JSON.parse(text) : {}; } catch { return json(400, { error: 'Expected JSON.' }); }
  }
  const status = async () => {
    const chat = await linkedChat(store, sub);
    const bot = (await getData(store, 'tgbot', null));
    return { prefs: cleanPrefs(await getData(store, `prefs:${sub}`, {})), telegram: chat ? { name: chat.name } : null,
      bot: bot ? bot.username : null, setup: !env.TELEGRAM_BOT_TOKEN };
  };
  const needBot = () => json(503, { error: 'Telegram isn’t set up on the server yet (TELEGRAM_BOT_TOKEN).', setup: true });
  switch (`${req.method} ${path}`) {
    case 'GET ': {
      const s = await status();
      // The app needs the bot's name to open it: asked from Telegram the first time (and after a new token).
      if (!s.setup) { try { s.bot = (await ensureBot(store, env, url.origin, fetchImpl)).username; } catch (e) { s.bot = null; s.error = e.message; } }
      return json(200, s);
    }
    case 'PUT prefs':
      await store.setJSON(`prefs:${sub}`, cleanPrefs(body.prefs));
      return json(200, await status());
    case 'PUT plan': {
      const plan = cleanPlan(body.plan);
      if (!plan) return json(400, { error: 'Unexpected plan.' });
      await store.setJSON(`plan:${sub}`, { ...plan, origin: url.origin, updatedAt: new Date().toISOString() });
      return json(200, { ok: true });
    }
    case 'POST telegram': {
      if (!env.TELEGRAM_BOT_TOKEN) return needBot();
      if (!CODE_RE.test(body.code || '')) return json(400, { error: 'Start again.' });
      let bot;
      try { bot = await ensureBot(store, env, url.origin, fetchImpl); } catch (e) { return json(502, { error: e.message }); }
      await startLink(store, sub, body.code);
      return json(200, { bot: bot.username });
    }
    case 'DELETE telegram':
      await unlink(store, sub);
      return json(200, await status());
    case 'POST test': {
      if (!env.TELEGRAM_BOT_TOKEN) return needBot();
      const text = body.summary ? await todayText(store, sub, url.origin) : '✅ <b>I Commit!</b>\nReminders will arrive here.';
      const r = await sendTelegram(store, sub, text, { env, fetchImpl });
      return json(200, { sent: r === 'sent', error: r === 'sent' ? null : r === 'failed' ? 'Telegram didn’t take the message. Try again.' : 'Telegram isn’t connected.' });
    }
    default: return json(405, { error: 'Method not allowed.' });
  }
}
