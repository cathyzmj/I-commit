// Tests server/moodle.mjs against a fake Moodle: connecting, reading courses and weeks, signed file
// links (and refusing forged, expired or off-site ones), and that Moodle is only ever read.
import assert from 'node:assert';
import { handle, weekOf } from '../server/moodle.mjs';
import { memoryStore } from './sync-fn-store.mjs';

const ORIGIN = 'https://commit.example', SITE = 'https://moodle.test', NOW = 1_800_000_000_000;
const hex = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');
const loginStore = { getWithMetadata: async (k) => (k === `key:${await hex('good-key')}` ? { data: { sub: 'sub-1' } } : null) };
const store = memoryStore();
const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

const calls = [];
const FILE = `${SITE}/webservice/pluginfile.php/55/mod_resource/content/1/Week%204%20slides.pdf?forcedownload=1`;
const fakeMoodle = async (url, opts = {}) => {
  url = String(url);
  if (url.startsWith(`${SITE}/webservice/rest/server.php`)) {
    const b = new URLSearchParams(opts.body);
    calls.push(b.get('wsfunction'));
    if (b.get('wstoken') !== TOKEN) return Response.json({ exception: 'moodle_exception', errorcode: 'invalidtoken', message: 'Invalid token - token not found' });
    switch (b.get('wsfunction')) {
      case 'core_webservice_get_site_info': return Response.json({ userid: 77, fullname: 'Cathy Zhang', functions: [{ name: 'core_enrol_get_users_courses' }, { name: 'core_course_get_contents' }] });
      case 'core_enrol_get_users_courses': return Response.json([
        { id: 11, shortname: 'EC1A1', fullname: 'Microeconomics I', startdate: 1790000000, enddate: 0, visible: 1, progress: 12.4 },
        { id: 12, shortname: 'OLD', fullname: 'Hidden course', startdate: 1, visible: 0 }]);
      case 'core_course_get_contents': return Response.json([
        { id: 1, section: 0, name: 'General', modules: [{ id: 900, modname: 'forum', name: 'Announcements', visible: 1 }, { id: 901, modname: 'label', name: 'Welcome', visible: 1 }] },
        { id: 2, section: 4, name: 'Week 4: Consumer choice', modules: [
          { id: 1001, modname: 'resource', name: 'Lecture slides', visible: 1, url: `${SITE}/mod/resource/view.php?id=1001`, completiondata: { state: 1 },
            contents: [{ type: 'file', filename: 'Week 4 slides.pdf', filesize: 2048, mimetype: 'application/pdf', fileurl: FILE }] },
          { id: 1002, modname: 'url', name: 'Reading: Varian ch.2', visible: 1, url: `${SITE}/mod/url/view.php?id=1002`, contents: [{ type: 'url', fileurl: 'https://example.org/varian.pdf' }] },
          { id: 1003, modname: 'assign', name: 'Problem set 3', visible: 1, url: `${SITE}/mod/assign/view.php?id=1003`, dates: [{ label: 'Due:', timestamp: 1_800_500_000 }] },
          { id: 1004, modname: 'resource', name: 'Hidden file', visible: 0 },
          { id: 1005, modname: 'resource', name: 'Offsite', visible: 1, contents: [{ type: 'file', filename: 'x.pdf', fileurl: 'https://evil.example/x.pdf' }] }] },
      ]);
    }
  }
  if (url.startsWith(`${SITE}/webservice/pluginfile.php/`)) {
    calls.push(`file:${new URL(url).searchParams.get('token') === TOKEN}:${new URL(url).searchParams.has('forcedownload')}`);
    return new Response('%PDF-1.4 fake', { headers: { 'content-type': 'application/pdf' } });
  }
  return new Response('nope', { status: 404 });
};
const post = (body, key = 'good-key', env = {}) => handle(new Request(`${ORIGIN}/api/moodle`, { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: JSON.stringify(body) }),
  { loginStore, store, fetchImpl: fakeMoodle, now: NOW, env: { MOODLE_URL: SITE, ...env } });
const j = async (r) => ({ status: r.status, ...(await r.json()) });

assert.equal(weekOf('Week 4: Consumer choice'), 4);
assert.equal(weekOf('Weeks 3-4'), 3);
assert.equal(weekOf('General'), null);

// signed in only
assert.equal((await post({ action: 'status' }, 'nope')).status, 401);
assert.equal((await post({ action: 'courses' })).status, 409, 'connect first');
assert.deepEqual(await j(await post({ action: 'status' })), { status: 200, connected: false, name: null, site: SITE });

// connecting
assert.equal((await post({ action: 'connect', token: 'too short' })).status, 400);
let r = await j(await post({ action: 'connect', token: 'f'.repeat(32) }));
assert.equal(r.status, 401); assert(r.expired, 'a wrong key says so');
r = await j(await post({ action: 'connect', token: TOKEN }));
assert.deepEqual([r.status, r.connected, r.name], [200, true, 'Cathy Zhang']);
assert(!JSON.stringify(r).includes(TOKEN), 'the key is never sent back');
assert.equal((await j(await post({ action: 'status' }))).connected, true);

// courses
r = await j(await post({ action: 'courses' }));
assert.deepEqual(r.courses.map((c) => [c.id, c.shortname, c.progress]), [[11, 'EC1A1', 12]], 'hidden courses are left out');

// one course
r = await j(await post({ action: 'contents', courseId: 11 }));
assert.equal(r.status, 200);
const [general, wk4] = r.sections;
assert.deepEqual(general.items, [], 'forums and labels are skipped');
assert.equal(wk4.week, 4);
assert.deepEqual(wk4.items.map((i) => i.name), ['Lecture slides', 'Reading: Varian ch.2', 'Problem set 3', 'Offsite'], 'hidden items are skipped');
const [slides, reading, pset, offsite] = wk4.items;
assert.equal(slides.moodleDone, true); assert.equal(slides.label, 'File');
assert.equal(reading.link, 'https://example.org/varian.pdf', 'a Link item goes straight to its page');
assert.equal(pset.due, 1_800_500_000);
assert.equal(offsite.files.length, 0, 'files from another site are never linked');
assert(!JSON.stringify(r).includes(TOKEN), 'the key is not in the course data');
assert.match(slides.files[0].link, /^https:\/\/commit\.example\/api\/moodle\/f\?u=[0-9a-f]{32}&e=\d+&p=/);

// opening a file through its signed link
const open = (link, n = NOW) => handle(new Request(link), { loginStore, store, fetchImpl: fakeMoodle, now: n, env: {} });
calls.length = 0;
let f = await open(slides.files[0].link);
assert.equal(f.status, 200);
assert.equal(await f.text(), '%PDF-1.4 fake');
assert.match(f.headers.get('content-disposition'), /^inline; filename="Week 4 slides.pdf"/);
assert.deepEqual(calls, ['file:true:false'], 'the key is added server-side and forced download is dropped');
assert.equal((await open(slides.files[0].link, NOW + 25 * 3600e3)).status, 410, 'links expire after a day');
assert.equal((await open(slides.files[0].link.replace(/&s=[0-9a-f]+/, '&s=' + '0'.repeat(64)))).status, 403, 'a forged signature is refused');
const other = new URL(slides.files[0].link);
other.searchParams.set('p', Buffer.from('/webservice/pluginfile.php/99/other.pdf').toString('base64url'));
assert.equal((await open(other.href)).status, 403, 'changing the file invalidates the signature');

// only reading: no write function is ever called
assert(calls.every((c) => !/update|create|delete|set_|mark|submit/.test(c)));

// disconnect
await post({ action: 'disconnect' });
assert.equal((await post({ action: 'courses' })).status, 409);
assert.equal((await open(slides.files[0].link)).status, 404, 'old links stop working once disconnected');
console.log('ALL MOODLE FUNCTION TESTS PASSED');
