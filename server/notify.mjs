// /api/notify — reminders, sent while the app is closed.
//   GET  /api/notify/config        -> { publicKey }   (public; the app needs it to turn push on)
//   GET  /api/notify               -> { prefs, devices, gmail }
//   PUT  /api/notify/prefs         { prefs }          what to send and when
//   POST /api/notify/subscribe     { subscription, device }   this device gets push notifications
//   POST /api/notify/unsubscribe   { endpoint }
//   PUT  /api/notify/plan          { plan }           the next 8 days, as the app sees them
//   POST /api/notify/test          { email }          a test push now (and the summary email)
// Requests carry "Authorization: Bearer <data key>" of a signed-in account.
//
// The server can't work out your days itself (routines, ticks and imported calendars live in the
// app), so every device sends a small plan after each change: timed tasks and meetings, application
// deadlines, and each day's to-dos and routines. A job every minute (run(), the Worker's cron) turns
// the plan and your settings into messages:
//   • push, `lead` minutes before a timed task or meeting
//   • push, the day before an application deadline (at `deadlineTime`)
//   • push, at `nudgeTime` if that day's routines aren't all ticked
//   • email to your Gmail, at `summaryTime`: the day ahead (sent through Gmail, from you to you)
// Times are wall-clock times in the time zone of the device that sent the plan. Each message is
// sent once (remembered for 3 days); a message more than 20 minutes late is dropped.
import { accountOf, sendGmail, GoogleError } from './google.mjs';
import { sendPush, validSubscription } from './webpush.mjs';

const json = (status, body) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/, TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/, KEY_RE = /^[a-z]:[A-Za-z0-9_.:-]{1,120}$/;
const LEADS = [0, 5, 10, 15, 30, 60, 120];
const GRACE_MS = 20 * 60e3, SENT_KEEP_MS = 3 * 864e5;
const MAX_SUBS = 10, MAX_PLAN_BYTES = 200 * 1024;
const BUDGET = 45; // outgoing requests per run (the Worker allows 50)
export const DEFAULT_PREFS = { timed: true, lead: 10, deadlines: true, deadlineTime: '09:00', routines: true, nudgeTime: '20:00', summary: true, summaryTime: '07:30' };

const str = (s, n) => String(s ?? '').trim().slice(0, n);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

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

const validTz = (tz) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return typeof tz === 'string' && tz.length <= 64; } catch { return false; } };
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
const dayBefore = (iso) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };
const dayLabel = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const list = (names, n = 4) => (names.length > n ? `${names.slice(0, n).join(', ')} and ${names.length - n} more` : names.join(', '));

// The messages due at `now` that haven't been sent yet.
export function dueMessages(plan, prefs, now, sent = {}) {
  const out = [];
  const add = (m) => { if (!sent[m.id] && m.at <= now && m.at > now - GRACE_MS) out.push(m); };
  const tz = plan.tz;
  if (prefs.timed) for (const x of plan.timed) {
    const lead = prefs.lead;
    add({ id: `t:${x.key}:${x.date}T${x.time}`, kind: 'push', at: zonedTime(x.date, x.time, tz) - lead * 60e3,
      title: x.title, body: `${lead ? `In ${lead} min` : 'Now'} · ${x.time}${x.where ? ` · ${x.where}` : ''}`, url: '#/today', tag: x.key });
  }
  if (prefs.deadlines) for (const x of plan.deadlines) {
    add({ id: `d:${x.key}:${x.date}`, kind: 'push', at: zonedTime(dayBefore(x.date), prefs.deadlineTime, tz),
      title: `Tomorrow: ${x.title}`, body: dayLabel(x.date), url: `#/apps/${x.date}`, tag: x.key });
  }
  for (const d of plan.days) {
    const open = d.routines.filter((r) => !r.done).map((r) => r.t);
    if (prefs.routines && open.length) {
      add({ id: `r:${d.date}`, kind: 'push', at: zonedTime(d.date, prefs.nudgeTime, tz),
        title: open.length === 1 ? '1 routine still to tick' : `${open.length} routines still to tick`, body: list(open), url: '#/today', tag: `r:${d.date}` });
    }
    if (prefs.summary) add({ id: `s:${d.date}`, kind: 'email', at: zonedTime(d.date, prefs.summaryTime, tz), day: d });
  }
  return out;
}

// ---- the morning email
export function summaryEmail(d, origin) {
  const byTime = (a, b) => (a.time || '99').localeCompare(b.time || '99');
  const timed = [...d.schedule.map((x) => ({ ...x, k: 'sched' })), ...d.meetings.map((x) => ({ ...x, k: 'meet' })), ...d.tasks.filter((x) => x.time).map((x) => ({ ...x, k: 'task' }))].sort(byTime);
  const untimed = d.tasks.filter((x) => !x.time);
  const n = d.tasks.length, r = d.routines.length;
  const subject = `Today · ${dayLabel(d.date)}: ${n} task${n === 1 ? '' : 's'}${r ? `, ${r} routine${r === 1 ? '' : 's'}` : ''}`;
  const sections = [
    ['Timeline', timed.map((x) => [`${x.time ? `${x.time}  ` : ''}${x.t}`, x.k === 'task' ? '' : x.k === 'meet' ? 'meeting' : ''])],
    ['To do', untimed.map((x) => [x.t, ''])],
    ['Routines', d.routines.map((x) => [x.t, ''])],
    ['Applications', d.apps.map((x) => [x.t, ''])],
  ].filter(([, rows]) => rows.length);
  const text = [`${dayLabel(d.date)}`, '', ...sections.flatMap(([h, rows]) => [h, ...rows.map(([t, s]) => `  • ${t}${s ? ` (${s})` : ''}`), '']),
    sections.length ? '' : 'Nothing planned. Enjoy the day.', `Open I Commit!: ${origin}/#/today`].join('\n');
  const html = `<div style="font:15px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#1b1f1d;max-width:520px">
  <h2 style="margin:0 0 4px">${esc(dayLabel(d.date))}</h2>
  ${sections.length ? sections.map(([h, rows]) => `<h3 style="margin:18px 0 6px;font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:#5f6763">${esc(h)}</h3>
  <ul style="margin:0;padding-left:20px">${rows.map(([t, s]) => `<li>${esc(t)}${s ? ` <span style="color:#5f6763">· ${esc(s)}</span>` : ''}</li>`).join('')}</ul>`).join('')
    : '<p>Nothing planned. Enjoy the day.</p>'}
  <p style="margin-top:22px"><a href="${esc(origin)}/#/today" style="color:#185FA5">Open I Commit!</a></p></div>`;
  return { subject, text, html };
}

// ---- storage helpers (one record per account and kind; the cron and the app write different ones)
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
export async function run({ store, loginStore, googleStore, env, fetchImpl = fetch, now = Date.now() }) {
  const vapid = env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY ? { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT || 'mailto:noreply@example.com' } : null;
  let budget = BUDGET;
  const stats = { pushed: 0, emailed: 0 };
  for (const { key, data: plan } of await store.list('plan:')) {
    if (budget <= 0) break;
    const sub = key.slice(5);
    const prefs = cleanPrefs(await getData(store, `prefs:${sub}`, {}));
    const sent = await getData(store, `sent:${sub}`, {});
    const due = dueMessages(plan, prefs, now, sent);
    if (!due.length) continue;
    const subs = await getData(store, `subs:${sub}`, []);
    const done = {}, gone = new Set();
    for (const m of due) {
      if (budget <= 0) break;
      if (m.kind === 'push') {
        if (!vapid || !subs.length) { done[m.id] = now; continue; }
        let ok = false;
        for (const s of subs) {
          if (gone.has(s.endpoint) || budget-- <= 0) continue;
          const r = await sendPush(s, { title: m.title, body: m.body, url: m.url, tag: m.tag }, { vapid, fetchImpl });
          if (r === 'gone') gone.add(s.endpoint);
          if (r === 'sent') ok = true;
        }
        if (ok || subs.every((s) => gone.has(s.endpoint))) { done[m.id] = now; if (ok) stats.pushed++; }
      } else {
        const user = await loginStore.getWithMetadata(`user:${sub}`);
        if (!user) { done[m.id] = now; continue; }
        budget -= 2;
        try {
          await sendGmail(googleStore, sub, { to: user.data.email, ...summaryEmail(m.day, plan.origin || '') }, { env, fetchImpl });
          done[m.id] = now; stats.emailed++;
        } catch (e) {
          if (!(e instanceof GoogleError)) throw e;
          if (e.reconnect) done[m.id] = now; // Gmail isn't connected: skip, don't retry every minute
        }
      }
    }
    if (Object.keys(done).length) {
      await update(store, `sent:${sub}`, (s) => {
        const next = {};
        for (const [id, t] of Object.entries({ ...s, ...done })) if (t > now - SENT_KEEP_MS) next[id] = t;
        return next;
      }, {});
    }
    if (gone.size) await update(store, `subs:${sub}`, (list) => list.filter((s) => !gone.has(s.endpoint)), []);
  }
  return stats;
}

export async function handle(req, { store, loginStore, googleStore, env, fetchImpl = fetch }) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/notify\/?/, '');
  const vapid = env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY ? { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT || 'mailto:noreply@example.com' } : null;
  if (path === 'config') return vapid ? json(200, { publicKey: vapid.publicKey }) : json(503, { error: 'Push notifications aren’t set up on the server yet.', setup: true });
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
    const tok = googleStore && (await googleStore.getWithMetadata(`tok:${sub}`))?.data;
    return {
      prefs: cleanPrefs(await getData(store, `prefs:${sub}`, {})), devices: (await getData(store, `subs:${sub}`, [])).map((s) => ({ device: s.device, added: s.added })),
      push: !!vapid, gmail: !!(tok && !tok.reconnect && tok.scopes.some((s) => /gmail\.send$/.test(s))),
    };
  };
  switch (`${req.method} ${path}`) {
    case 'GET ': return json(200, await status());
    case 'PUT prefs':
      await store.setJSON(`prefs:${sub}`, cleanPrefs(body.prefs));
      return json(200, await status());
    case 'POST subscribe': {
      const s = body.subscription;
      if (!validSubscription(s)) return json(400, { error: 'That isn’t a push subscription.' });
      const rec = { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth }, device: str(body.device, 60) || 'Device', added: new Date().toISOString() };
      await update(store, `subs:${sub}`, (list) => [...list.filter((x) => x.endpoint !== rec.endpoint), rec].slice(-MAX_SUBS), []);
      return json(200, await status());
    }
    case 'POST unsubscribe':
      await update(store, `subs:${sub}`, (list) => list.filter((x) => x.endpoint !== body.endpoint), []);
      return json(200, await status());
    case 'PUT plan': {
      const plan = cleanPlan(body.plan);
      if (!plan) return json(400, { error: 'Unexpected plan.' });
      await store.setJSON(`plan:${sub}`, { ...plan, origin: url.origin, updatedAt: new Date().toISOString() });
      return json(200, { ok: true });
    }
    case 'POST test': {
      const subs = await getData(store, `subs:${sub}`, []);
      let pushed = 0, emailed = false, error = null;
      if (vapid) for (const s of subs) if (await sendPush(s, { title: 'I Commit!', body: 'Notifications are on.', url: '#/today', tag: 'test' }, { vapid, fetchImpl }) === 'sent') pushed++;
      if (body.email) {
        const plan = await getData(store, `plan:${sub}`, null);
        const tz = plan ? plan.tz : 'UTC';
        const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
        const day = (plan && plan.days.find((d) => d.date === today)) || { date: today, tasks: [], routines: [], schedule: [], meetings: [], apps: [] };
        try { await sendGmail(googleStore, sub, { to: acct.email, ...summaryEmail(day, url.origin) }, { env, fetchImpl }); emailed = true; }
        catch (e) { if (!(e instanceof GoogleError)) throw e; error = e.message; }
      }
      return json(200, { pushed, emailed, error });
    }
    default: return json(405, { error: 'Method not allowed.' });
  }
}
