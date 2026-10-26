// Local dev server: serves the app and runs the server endpoints with in-memory storage.
//   node test/dev-server.mjs [port]
// Open http://localhost:<port> and http://127.0.0.1:<port> to act as two separate devices
// (different origins keep separate browser storage).
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { handle as syncHandle } from '../server/sync.mjs';
import { handle as widgetHandle } from '../server/widget.mjs';
import { handle as loginHandle } from '../server/login.mjs';
import { handle as googleHandle, connectCallback } from '../server/google.mjs';
import { handle as notifyHandle, run as sendReminders } from '../server/notify.mjs';
import { memoryStore } from './sync-fn-store.mjs';

const root = path.resolve(path.dirname(decodeURIComponent(new URL(import.meta.url).pathname)), '..');
const port = Number(process.argv[2]) || 8766;
const syncStore = memoryStore();
const loginStore = memoryStore();
// A stand-in for Google: /api/login/dev?state=…&email=… "signs in" as that email (and grants
// Calendar and Gmail when connecting). Calendar and Gmail calls are kept in memory and logged.
const devCalendar = new Map();
let devId = 1;
const devGoogle = async (url, opts = {}) => {
  url = String(url);
  if (url === 'https://oauth2.googleapis.com/token') {
    const b = new URLSearchParams(opts.body);
    if (b.get('grant_type') === 'refresh_token') return Response.json({ access_token: 'dev-access', expires_in: 3600 });
    const email = b.get('code');
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    return Response.json({ id_token: `${b64({})}.${b64({ iss: 'https://accounts.google.com', aud: 'dev-client.apps.googleusercontent.com', sub: `dev-${email}`, email, name: email.split('@')[0], email_verified: true })}.x`,
      access_token: 'dev-access', expires_in: 3600, refresh_token: 'dev-refresh', scope: 'openid email https://www.googleapis.com/auth/calendar.app.created https://www.googleapis.com/auth/gmail.send' });
  }
  if (url === 'https://oauth2.googleapis.com/revoke') return new Response('');
  if (url.startsWith('https://gmail.googleapis.com/')) { console.log('[gmail] sent', Buffer.from(JSON.parse(opts.body).raw, 'base64url').toString().split('\r\n')[1]); return Response.json({ id: 'm' }); }
  if (url.startsWith('https://www.googleapis.com/calendar/v3/')) {
    const body = opts.body ? JSON.parse(opts.body) : null;
    if (url.endsWith('/calendars')) return Response.json({ id: 'dev-cal' });
    const id = url.split('/events/')[1];
    if (opts.method === 'POST') { const n = `ev${devId++}`; devCalendar.set(n, body); console.log('[calendar] add', body.summary, JSON.stringify(body.start)); return Response.json({ id: n }); }
    if (opts.method === 'PUT') { devCalendar.set(id, body); console.log('[calendar] change', body.summary, JSON.stringify(body.start)); return Response.json({ id }); }
    if (opts.method === 'DELETE') { console.log('[calendar] delete', devCalendar.get(id)?.summary); devCalendar.delete(id); return new Response(null, { status: 204 }); }
  }
  return fetch(url, opts); // real push services
};
const loginEnv = { GOOGLE_CLIENT_ID: 'dev-client.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'dev', DEV_AUTH_URL: '/api/login/dev' };
const vapidPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const notifyEnv = { ...loginEnv, VAPID_PUBLIC_KEY: Buffer.from(await crypto.subtle.exportKey('raw', vapidPair.publicKey)).toString('base64url'),
  VAPID_PRIVATE_KEY: (await crypto.subtle.exportKey('jwk', vapidPair.privateKey)).d, VAPID_SUBJECT: 'mailto:dev@example.com' };
const googleStore = memoryStore(), notifyStore = memoryStore();
const notifyCtx = { store: notifyStore, loginStore, googleStore, env: notifyEnv, fetchImpl: devGoogle };
setInterval(() => sendReminders(notifyCtx).then((s) => { if (s.pushed || s.emailed) console.log('[reminders]', s); }).catch((e) => console.error(e)), 60e3);
const widgetMem = new Map();
const widgetStore = { get: async (k) => widgetMem.get(k) ?? null, set: async (k, v) => { widgetMem.set(k, v); }, delete: async (k) => { widgetMem.delete(k); } };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.ics': 'text/calendar' };

async function toRequest(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  return new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body });
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    let response;
    if (url.pathname === '/api/sync') response = await syncHandle(await toRequest(req), syncStore);
    else if (url.pathname === '/api/widget') response = await widgetHandle(await toRequest(req), widgetStore);
    else if (url.pathname === '/api/login/dev') {
      response = new Response(`<form action="/api/login/callback"><input type="hidden" name="state" value="${url.searchParams.get('state')}"><p>Pretend Google sign-in</p><input name="code" value="cathy@example.com"><button>Continue</button></form>`, { headers: { 'content-type': 'text/html' } });
    } else if (url.pathname.startsWith('/api/google')) response = await googleHandle(await toRequest(req), { store: googleStore, loginStore, env: loginEnv, fetchImpl: devGoogle });
    else if (url.pathname.startsWith('/api/notify')) response = await notifyHandle(await toRequest(req), notifyCtx);
    else if (url.pathname === '/api/login/callback' && (response = await connectCallback(await toRequest(req), { store: googleStore, env: loginEnv, fetchImpl: devGoogle }))) { /* connecting Google */ }
    else if (url.pathname.startsWith('/api/login')) response = await loginHandle(await toRequest(req), { store: loginStore, syncStore, env: loginEnv, fetchImpl: devGoogle });
    if (response) {
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    let file = path.join(root, decodeURIComponent(url.pathname));
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    if (url.pathname.endsWith('/')) file = path.join(file, 'index.html');
    const data = await fs.readFile(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  } catch (e) {
    res.writeHead(e.code === 'ENOENT' ? 404 : 500).end(String(e.message));
  }
}).listen(port, () => console.log(`dev server on http://localhost:${port} and http://127.0.0.1:${port}`));
