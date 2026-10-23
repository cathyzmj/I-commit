// /api/moodle: reads your courses from Moodle (LSE Moodle by default) for the Academics tab.
//
//   POST /api/moodle  { action: "connect", token }   check your Moodle key and store it (never sent back)
//                     { action: "status" }            connected? and whose Moodle
//                     { action: "disconnect" }        forget the key
//                     { action: "courses" }           your enrolled courses
//                     { action: "contents", courseId } one course: weeks, items, files
//   GET  /api/moodle/f?…                              a signed, short-lived "Open" link for one file
//
// Everything needs the sign-in key of a Google-signed-in account. Moodle itself is only ever asked to
// READ (site info, course list, course contents, a file download); nothing is changed in Moodle.
// The key is the one under Moodle → Preferences → Security keys ("Moodle mobile web service"), stored
// per account in the "moodle" store, and files are fetched by the server so the key never reaches the
// browser: the page only ever sees links signed with a hash of the key, valid for a day.
const DEFAULT_SITE = 'https://moodle.lse.ac.uk';
const LINK_TTL_MS = 24 * 3600e3;
const MAX_FILE_BYTES = 80 * 1024 * 1024;
const SKIP_TYPES = new Set(['label', 'forum']); // not things you study

const json = (status, body) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256Hex = async (s) => toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
async function hmacHex(secret, data) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)));
}
const b64url = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));
const safeEqual = (a, b) => a.length === b.length && [...a].reduce((n, c, i) => n | (c.charCodeAt(0) ^ b.charCodeAt(i)), 0) === 0;

class MoodleError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// One Moodle web service call (a POST, so the key stays out of the address).
async function call(site, token, fn, params, fetchImpl) {
  const body = new URLSearchParams({ wstoken: token, wsfunction: fn, moodlewsrestformat: 'json' });
  for (const [k, v] of Object.entries(params || {})) body.set(k, String(v));
  let res;
  try {
    res = await fetchImpl(`${site}/webservice/rest/server.php`, { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(25000) });
  } catch { throw new MoodleError('unreachable', 'Couldn’t reach Moodle. Try again in a moment.'); }
  let data;
  try { data = await res.json(); } catch { throw new MoodleError('badreply', 'Moodle sent an answer I couldn’t read.'); }
  if (data && data.exception) throw new MoodleError(data.errorcode || 'error', data.message || 'Moodle refused the request.');
  return data;
}

const friendly = (e) => (e.code === 'invalidtoken' ? { status: 401, error: 'Moodle doesn’t accept that key (it may have been reset). Copy a new one from Moodle → Preferences → Security keys.', expired: true }
  : e.code === 'unreachable' ? { status: 502, error: e.message }
  : { status: 502, error: `Moodle said: ${e.message}` });

// Which teaching week a section is, from its title. Moodle courses label this in different ways:
//   "Week 4: Consumer choice" · "Lecture 3" / "Topic 2" · "1. Introduction" / "2) Demand" / "03 - Costs" · "1 Introduction"
// A leading number is taken as the week (that's how courses that don't say "week" usually number them).
// "General", "Welcome", "Revision" and dates like "12 October" have none (0 isn't a week).
const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*';
const WEEK_PATTERNS = [
  /\bweeks?\s*(\d{1,2})\b/i,
  /^\s*(?:lectures?|topics?|sessions?|units?|modules?|chapters?|parts?|seminars?|classes|class|w)\s*[.#]?\s*(\d{1,2})\b/i,
  /^\s*(\d{1,2})\s*[.):\-–—]\s*\S/,
  new RegExp(`^\\s*(\\d{1,2})\\s+(?!${MONTH}\\b)(?!hours?\\b)[A-Za-z]`, 'i'),
];
export function weekOf(name) {
  const t = String(name || '');
  for (const re of WEEK_PATTERNS) { const m = re.exec(t); if (m && +m[1] >= 1 && +m[1] <= 52) return +m[1]; }
  return null;
}

const TYPE_LABEL = { resource: 'File', url: 'Link', page: 'Page', folder: 'Folder', assign: 'Assignment', quiz: 'Quiz', lesson: 'Lesson', book: 'Book', lti: 'Recording or tool', scorm: 'Package', h5pactivity: 'Activity', choice: 'Poll', glossary: 'Glossary', wiki: 'Wiki', workshop: 'Workshop' };

// A file's link: signed for this account, so it opens without a Moodle login and without exposing the key.
async function signedLink(origin, acct, token, fileurl, name, now) {
  const exp = now + LINK_TTL_MS;
  const u = new URL(fileurl);
  const p = b64url(u.pathname + u.search);
  const s = await hmacHex(token, `${acct}|${exp}|${p}`);
  return `${origin}/api/moodle/f?u=${acct}&e=${exp}&p=${p}&n=${encodeURIComponent(name || 'file')}&s=${s}`;
}

// Moodle's section description is HTML; keep just its words (it often holds the week's topic).
const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ', '&rsquo;': '’', '&lsquo;': '‘', '&ndash;': '–', '&mdash;': '—' };
export const plainText = (html) => String(html || '').replace(/<(br|\/p|\/li|\/div|\/h\d)[^>]*>/gi, '\n').replace(/<[^>]*>/g, ' ')
  .replace(/&[a-z#0-9]+;/gi, (e) => ENTITIES[e.toLowerCase()] || ' ').replace(/[ \t\u00a0]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim().slice(0, 300);

async function normaliseSections(sections, { origin, acct, token, site, now }) {
  const out = [];
  for (const sec of sections || []) {
    const items = [];
    for (const m of sec.modules || []) {
      if (SKIP_TYPES.has(m.modname) || m.visible === 0 || m.uservisible === false) continue;
      const files = [];
      let link = m.url || null, external = null;
      for (const c of m.contents || []) {
        if (c.type === 'file' && c.fileurl) {
          try {
            if (new URL(c.fileurl).origin !== new URL(site).origin) continue;
            files.push({ name: c.filename || m.name, size: c.filesize || 0, type: c.mimetype || '', link: await signedLink(origin, acct, token, c.fileurl, c.filename, now) });
          } catch { /* skip a malformed address */ }
        } else if (c.type === 'url' && /^https?:\/\//i.test(c.fileurl || '')) external = c.fileurl;
      }
      if (external) link = external; // a "Link" item goes straight to its page
      const state = m.completiondata && m.completiondata.state;
      items.push({
        id: m.id, name: m.name || 'Untitled', type: m.modname, label: TYPE_LABEL[m.modname] || m.modname,
        link, files, moodleDone: state === 1 || state === 2, trackable: true,
        due: m.dates && (m.dates.find((d) => /due/i.test(d.label || '')) || {}).timestamp || null,
      });
    }
    out.push({ id: sec.id, no: sec.section, name: sec.name || `Section ${sec.section}`, week: weekOf(sec.name), weekFrom: 'name', summary: plainText(sec.summary), items });
  }
  // No section says which week it is anywhere in the course: take the order of the sections instead
  // (section 1 = week 1, section 2 = week 2 …), and say so.
  if (!out.some((x) => x.week != null)) {
    for (const x of out) if (x.no >= 1 && x.no <= 52) { x.week = x.no; x.weekFrom = 'order'; }
  }
  return out;
}

async function account(req, loginStore) {
  const key = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!key) return null;
  const link = await loginStore.getWithMetadata(`key:${await sha256Hex(key)}`);
  return link ? (await sha256Hex(String(link.data.sub))).slice(0, 32) : null;
}

async function download(url, { store, fetchImpl, now }) {
  const q = url.searchParams, acct = q.get('u') || '', exp = +q.get('e'), p = q.get('p') || '', sig = q.get('s') || '';
  if (!/^[0-9a-f]{32}$/.test(acct) || !p || !exp) return json(400, { error: 'Bad link' });
  if (exp < now) return json(410, { error: 'This link has expired. Reopen the course to get a fresh one.' });
  const rec = await store.getWithMetadata(`m:${acct}`);
  if (!rec) return json(404, { error: 'Moodle isn’t connected.' });
  if (!safeEqual(await hmacHex(rec.data.token, `${acct}|${exp}|${p}`), sig)) return json(403, { error: 'Bad link' });
  let target;
  try { target = new URL(rec.data.site + unb64url(p)); } catch { return json(400, { error: 'Bad link' }); }
  if (target.origin !== new URL(rec.data.site).origin || !target.pathname.startsWith('/webservice/pluginfile.php/')) return json(400, { error: 'Bad link' });
  target.searchParams.delete('forcedownload');
  target.searchParams.set('token', rec.data.token);
  let res;
  try { res = await fetchImpl(target.href, { redirect: 'follow', signal: AbortSignal.timeout(60000) }); } catch { return json(502, { error: 'Couldn’t reach Moodle.' }); }
  const type = res.headers.get('content-type') || 'application/octet-stream';
  if (!res.ok || /json/i.test(type)) return json(502, { error: 'Moodle wouldn’t give that file. It may have been moved or removed.' });
  if (+res.headers.get('content-length') > MAX_FILE_BYTES) return json(413, { error: 'That file is too big to open here.' });
  const name = (q.get('n') || 'file').replace(/[^\w.\- ()]+/g, '_').slice(0, 120);
  return new Response(res.body, { headers: { 'content-type': type, 'content-disposition': `inline; filename="${name}"; filename*=UTF-8''${encodeURIComponent(q.get('n') || name)}`, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } });
}

export async function handle(req, { loginStore, store, env = {}, fetchImpl = fetch, now = Date.now() }) {
  const url = new URL(req.url);
  if (req.method === 'GET' && url.pathname === '/api/moodle/f') return download(url, { store, fetchImpl, now });
  if (req.method !== 'POST') return json(405, { error: 'Use POST' });
  const acct = await account(req, loginStore);
  if (!acct) return json(401, { error: 'Sign in with Google to use Academics.' });
  let body;
  try { body = await req.json(); } catch { return json(400, { error: 'Expected JSON body' }); }
  const site = String(env.MOODLE_URL || DEFAULT_SITE).replace(/\/+$/, '');
  const rec = await store.getWithMetadata(`m:${acct}`);

  if (body.action === 'status') return json(200, { connected: !!rec, name: rec ? rec.data.name : null, site });
  if (body.action === 'disconnect') { await store.delete(`m:${acct}`); return json(200, { connected: false }); }

  if (body.action === 'connect') {
    const token = String(body.token || '').trim();
    if (!/^[A-Za-z0-9]{16,64}$/.test(token)) return json(400, { error: 'That doesn’t look like a Moodle key. It’s a string of letters and numbers (about 32 characters) from Moodle → Preferences → Security keys.' });
    try {
      const info = await call(site, token, 'core_webservice_get_site_info', {}, fetchImpl);
      const fns = new Set((info.functions || []).map((f) => f.name));
      const need = ['core_enrol_get_users_courses', 'core_course_get_contents'].filter((f) => !fns.has(f));
      if (need.length) return json(403, { error: 'That key can’t read your courses (Moodle hasn’t allowed it for this service).', missing: need });
      await store.setJSON(`m:${acct}`, { token, site, userid: info.userid, name: info.fullname || info.username || 'Moodle', at: now });
      return json(200, { connected: true, name: info.fullname || info.username || 'Moodle', site });
    } catch (e) { if (!(e instanceof MoodleError)) throw e; const f = friendly(e); return json(f.status, { error: f.error, expired: f.expired }); }
  }

  if (!rec) return json(409, { error: 'Connect Moodle first.', notConnected: true });
  const { token, userid } = rec.data;
  try {
    if (body.action === 'courses') {
      const list = await call(rec.data.site, token, 'core_enrol_get_users_courses', { userid }, fetchImpl);
      return json(200, { courses: (list || []).filter((c) => c.visible !== 0).map((c) => ({
        id: c.id, shortname: c.shortname || '', fullname: c.fullname || c.shortname || `Course ${c.id}`, start: c.startdate || 0, end: c.enddate || 0,
        progress: typeof c.progress === 'number' ? Math.round(c.progress) : null,
      })).sort((a, b) => b.start - a.start) });
    }
    if (body.action === 'contents') {
      const courseId = +body.courseId;
      if (!Number.isInteger(courseId) || courseId < 1) return json(400, { error: 'Which course?' });
      const sections = await call(rec.data.site, token, 'core_course_get_contents', { courseid: courseId }, fetchImpl);
      return json(200, { courseId, sections: await normaliseSections(sections, { origin: url.origin, acct, token, site: rec.data.site, now }), at: now });
    }
  } catch (e) { if (!(e instanceof MoodleError)) throw e; const f = friendly(e); return json(f.status, { error: f.error, expired: f.expired }); }
  return json(400, { error: 'Unknown action' });
}
