// /api/feed — your I Commit! items as a private calendar link, for Google Calendar ("Other
// calendars → From URL"), Apple Calendar or Outlook. No Google permissions are needed: Google
// fetches the link itself, every few hours (Google decides how often).
//   GET    /api/feed                -> { url, updatedAt }     (url: null until you make the link)
//   PUT    /api/feed { tz, from, sources, events }  -> { url }   makes the link the first time
//          Replaces the events of the kinds in `sources` dated on or after `from`; kinds this device
//          couldn't load, and older events, stay as they were.
//   POST   /api/feed/reset          -> { url }   a new link (the old one stops working)
//   DELETE /api/feed                              stop sharing
//   GET    /api/feed/<token>.ics    the calendar itself (public; the random token is the secret)
// Requests other than the .ics carry "Authorization: Bearer <data key>" of a signed-in account.
// Records, in the feed store: feed:<account> { token, tz, events, updatedAt }, tok:<token> { sub }.
import { accountOf } from './account.mjs';
import { zonedTime, validTz } from './notify.mjs';

const json = (status, body) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const SOURCES = ['task', 'meet', 'app'];
const KEY_RE = /^[a-z]:[A-Za-z0-9_.:-]{1,120}$/, DATE_RE = /^\d{4}-\d{2}-\d{2}$/, TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const MAX_EVENTS = 2000, KEEP_DAYS = 180, MAX_BYTES = 1024 * 1024;
const newToken = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const feedUrl = (origin, token) => `${origin}/api/feed/${token}.ics`;

function cleanEvents(list, sources) {
  const out = [];
  for (const e of Array.isArray(list) ? list.slice(0, MAX_EVENTS) : []) {
    if (!e || !KEY_RE.test(e.key || '') || !sources.includes(e.src) || !DATE_RE.test(e.date || '')) continue;
    const title = String(e.title || '').trim().slice(0, 200);
    if (!title) continue;
    out.push({
      key: e.key, src: e.src, date: e.date, title,
      time: TIME_RE.test(e.time || '') ? e.time : null,
      endTime: TIME_RE.test(e.endTime || '') ? e.endTime : null,
      notes: String(e.notes || '').slice(0, 2000),
      url: /^https:\/\//.test(e.url || '') ? String(e.url).slice(0, 500) : '',
    });
  }
  return out;
}

// ---- iCalendar (RFC 5545)
const icsText = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const utc = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
// Lines longer than 75 bytes are folded (a line break and a space), never inside a character.
function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts = [];
  let cur = '', n = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (n + b > (parts.length ? 74 : 75)) { parts.push(cur); cur = ''; n = 0; }
    cur += ch; n += b;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}
export function toIcs(feed, now = Date.now()) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//I Commit!//Calendar link//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:I Commit!', `X-WR-TIMEZONE:${feed.tz}`, 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H'];
  for (const e of feed.events) {
    lines.push('BEGIN:VEVENT', `UID:${e.key.replace(/:/g, '-')}@icommit`, `DTSTAMP:${utc(now)}`);
    if (e.time) {
      const start = zonedTime(e.date, e.time, feed.tz);
      let end;
      if (e.endTime && e.endTime > e.time) end = zonedTime(e.date, e.endTime, feed.tz);
      else if (e.endTime) end = zonedTime(addDays(e.date, 1), e.endTime, feed.tz); // past midnight
      else end = start + 60 * 60e3;
      lines.push(`DTSTART:${utc(start)}`, `DTEND:${utc(end)}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${e.date.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${addDays(e.date, 1).replace(/-/g, '')}`, 'TRANSP:TRANSPARENT');
    }
    lines.push(`SUMMARY:${icsText(e.title)}`);
    const desc = [e.notes, e.url].filter(Boolean).join('\n\n');
    if (desc) lines.push(`DESCRIPTION:${icsText(desc)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

export async function handle(req, { store, loginStore }) {
  const url = new URL(req.url);
  const m = /^\/api\/feed\/([A-Za-z0-9_-]+)\.ics$/.exec(url.pathname);
  if (m) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(405, { error: 'Use GET' });
    const link = TOKEN_RE.test(m[1]) && await store.getWithMetadata(`tok:${m[1]}`);
    const feed = link && (await store.getWithMetadata(`feed:${link.data.sub}`))?.data;
    if (!feed || feed.token !== m[1]) return new Response('Not found', { status: 404 });
    return new Response(req.method === 'HEAD' ? null : toIcs(feed), { headers: {
      'content-type': 'text/calendar; charset=utf-8', 'cache-control': 'no-cache', 'content-disposition': 'inline; filename="i-commit.ics"' } });
  }
  const acct = await accountOf(req, loginStore);
  if (!acct) return json(401, { error: 'Sign in with Google first.' });
  const key = `feed:${acct.sub}`;
  const cur = (await store.getWithMetadata(key))?.data || null;
  const path = url.pathname.replace(/^\/api\/feed\/?/, '');
  const issue = async (feed) => {
    if (cur && cur.token && cur.token !== feed.token) await store.delete(`tok:${cur.token}`);
    await store.setJSON(`tok:${feed.token}`, { sub: acct.sub });
    await store.setJSON(key, feed);
    return json(200, { url: feedUrl(url.origin, feed.token), updatedAt: feed.updatedAt });
  };
  switch (`${req.method} ${path}`) {
    case 'GET ': return json(200, { url: cur ? feedUrl(url.origin, cur.token) : null, updatedAt: cur ? cur.updatedAt : null });
    case 'PUT ': {
      const text = await req.text();
      if (text.length > MAX_BYTES) return json(413, { error: 'Too much at once.' });
      let body;
      try { body = JSON.parse(text); } catch { return json(400, { error: 'Expected JSON.' }); }
      const sources = (Array.isArray(body.sources) ? body.sources : []).filter((s) => SOURCES.includes(s));
      if (!validTz(body.tz) || !DATE_RE.test(body.from || '')) return json(400, { error: 'Missing time zone or start date.' });
      const oldest = addDays(body.from, -KEEP_DAYS);
      const kept = (cur ? cur.events : []).filter((e) => e.date >= oldest && (!sources.includes(e.src) || e.date < body.from));
      const fresh = cleanEvents(body.events, sources).filter((e) => e.date >= body.from);
      const seen = new Set(fresh.map((e) => e.key));
      const events = [...kept.filter((e) => !seen.has(e.key)), ...fresh].sort((a, b) => a.date.localeCompare(b.date)).slice(-MAX_EVENTS);
      return issue({ token: (cur && cur.token) || newToken(), tz: body.tz, events, updatedAt: new Date().toISOString() });
    }
    case 'POST reset':
      if (!cur) return json(404, { error: 'There’s no calendar link yet.' });
      return issue({ ...cur, token: newToken() });
    case 'DELETE ':
      if (cur) { await store.delete(`tok:${cur.token}`); await store.delete(key); }
      return json(200, { url: null });
    default: return json(405, { error: 'Method not allowed.' });
  }
}
