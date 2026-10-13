// Local dev server: serves the app and runs the server endpoints with in-memory storage.
//   node test/dev-server.mjs [port]
// Open http://localhost:<port> and http://127.0.0.1:<port> to act as two separate devices
// (different origins keep separate browser storage).
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { handle as syncHandle } from '../server/sync.mjs';
import { handle as widgetHandle } from '../server/widget.mjs';
import { handle as buddyHandle } from '../server/buddy.mjs';
import { handle as authHandle } from '../server/auth.mjs';
import { memoryStore } from './sync-fn-store.mjs';

const root = path.resolve(path.dirname(decodeURIComponent(new URL(import.meta.url).pathname)), '..');
const port = Number(process.argv[2]) || 8766;
const syncStore = memoryStore();
const buddyStore = memoryStore();
const authStore = memoryStore();
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
    else if (url.pathname === '/api/buddy') response = await buddyHandle(await toRequest(req), buddyStore);
    else if (url.pathname === '/api/auth') response = await authHandle(await toRequest(req), { store: authStore, syncStore });
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
