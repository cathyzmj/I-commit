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
import { handle as notifyHandle, run as sendReminders, webhook as telegramWebhook } from '../server/notify.mjs';
import { webhookSecret } from '../server/telegram.mjs';
import { handle as feedHandle } from '../server/feed.mjs';
import { memoryStore } from './sync-fn-store.mjs';

const root = path.resolve(path.dirname(decodeURIComponent(new URL(import.meta.url).pathname)), '..');
const port = Number(process.argv[2]) || 8766;
const syncStore = memoryStore();
const loginStore = memoryStore();
// A stand-in for Google: /api/login/dev?state=…&email=… "signs in" as that email.
const devGoogle = async (url, opts) => {
  const email = new URLSearchParams(opts.body).get('code');
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return new Response(JSON.stringify({ id_token: `${b64({})}.${b64({ iss: 'https://accounts.google.com', aud: 'dev-client.apps.googleusercontent.com', sub: `dev-${email}`, email, name: email.split('@')[0], email_verified: true })}.x` }));
};
const loginEnv = { GOOGLE_CLIENT_ID: 'dev-client.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'dev', DEV_AUTH_URL: '/api/login/dev' };
// A stand-in for Telegram: the bot is @DevICommitBot, and messages are printed here.
// /api/dev/telegram-start?code=… acts as pressing Start in Telegram (the app opens t.me instead).
const devTelegram = async (url, opts) => {
  const method = String(url).split('/').pop(), body = JSON.parse(opts.body);
  if (method === 'getMe') return Response.json({ ok: true, result: { username: 'DevICommitBot' } });
  if (method === 'sendMessage') console.log(`[telegram → ${body.chat_id}]\n${body.text}\n`);
  return Response.json({ ok: true, result: true });
};
const notifyEnv = { TELEGRAM_BOT_TOKEN: 'dev:token' };
const notifyStore = memoryStore(), feedStore = memoryStore();
const notifyCtx = { store: notifyStore, loginStore, env: notifyEnv, fetchImpl: devTelegram };
setInterval(() => sendReminders(notifyCtx).then((s) => { if (s.sent) console.log('[reminders]', s); }).catch((e) => console.error(e)), 60e3);
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
    } else if (url.pathname.startsWith('/api/notify')) response = await notifyHandle(await toRequest(req), notifyCtx);
    else if (url.pathname.startsWith('/api/feed')) response = await feedHandle(await toRequest(req), { store: feedStore, loginStore });
    else if (url.pathname === '/api/telegram/webhook') response = await telegramWebhook(await toRequest(req), notifyCtx);
    else if (url.pathname === '/api/dev/telegram-start') {
      response = await telegramWebhook(new Request(`http://${req.headers.host}/api/telegram/webhook`, { method: 'POST', headers: { 'x-telegram-bot-api-secret-token': await webhookSecret(notifyEnv) },
        body: JSON.stringify({ message: { chat: { id: 4242, username: 'dev_user' }, text: `/start ${url.searchParams.get('code')}` } }) }), notifyCtx);
    } else if (url.pathname.startsWith('/api/login')) response = await loginHandle(await toRequest(req), { store: loginStore, syncStore, env: loginEnv, fetchImpl: devGoogle });
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
