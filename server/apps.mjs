// GET  /api/apps — your application tracker from Notion (opening dates, deadlines, apply links,
//                  Done and the Materials checklist).
// POST /api/apps  { id, done?, materialsDone?, status?, next? } — tick an application or its
//                  materials, set its status or next deadline (YYYY-MM-DD or null); writes the
//                  page in Notion (needs the integration's "Update content" capability). Only pages
//                  in the configured database can be changed.
//
// Reads a Notion database through the official API with a read-only internal integration whose
// secret is stored as the server secret NOTION_TOKEN (never sent to the browser).
// NOTION_APPS_DATABASE is the database to read (its link or ID), also kept as a server secret.
//
// Access: only devices that use sync can call this. The request carries the sync key
// ("Authorization: Bearer <key>"), and the key is accepted if a synced copy exists for it.
import { syncStorageName } from './sync.mjs';

const KEY_RE = /^[A-Za-z0-9_-]{32,128}$/;
const NOTION_VERSION = '2022-06-28';
const MAX_PAGES = 10; // 1,000 rows is plenty

const json = (status, body) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

// ---------- Reading Notion property values ----------
const plain = (rich) => (Array.isArray(rich) ? rich.map((t) => t.plain_text || '').join('').trim() : '');
function value(prop) {
  if (!prop) return null;
  switch (prop.type) {
    case 'title': return plain(prop.title);
    case 'rich_text': return plain(prop.rich_text);
    case 'url': return prop.url || null;
    case 'select': return prop.select ? prop.select.name : null;
    case 'status': return prop.status ? prop.status.name : null;
    case 'multi_select': return (prop.multi_select || []).map((o) => o.name);
    case 'date': return prop.date ? { start: prop.date.start, end: prop.date.end || null } : null;
    case 'checkbox': return !!prop.checkbox;
    default: return null;
  }
}
// Finds a property by preferred names first, then by a name pattern of the right type.
function find(props, type, names, pattern) {
  for (const n of names) if (props[n] && props[n].type === type) return props[n];
  if (pattern) for (const [n, p] of Object.entries(props)) if (p.type === type && pattern.test(n)) return p;
  return null;
}
const day = (d) => (d && d.start ? d.start.slice(0, 10) : null);
const time = (d) => (d && d.start && d.start.length > 10 ? d.start.slice(11, 16) : null);

export function toApplication(page) {
  const p = page.properties || {};
  const title = Object.values(p).find((x) => x.type === 'title');
  const open = value(find(p, 'date', ['Opening Date', 'Open Date', 'Opens'], /open/i));
  const close = value(find(p, 'date', ['Closing Date', 'Deadline', 'Closes'], /clos|deadline/i));
  const next = value(find(p, 'date', ['Next ddl', 'Next deadline'], /next|ddl/i));
  return {
    id: page.id,
    company: value(title) || 'Untitled',
    programme: value(find(p, 'rich_text', ['Programme Name', 'Program Name', 'Role'], /programme|program|role/i)) || '',
    status: value(find(p, 'select', ['My Status', 'Status', 'Stage'], /status|stage/i)) || value(find(p, 'status', [], /./)) || '',
    sector: value(find(p, 'select', ['Sector', 'Track'], /sector|track/i)) || '',
    rolling: value(find(p, 'select', ['Rolling'], /rolling/i)) || '',
    materials: value(find(p, 'multi_select', ['Materials'], /^materials?$/i)) || [],
    materialsDone: value(find(p, 'multi_select', ['Materials done'], /done|complete/i)) || [],
    done: !!value(find(p, 'checkbox', ['Done'], /done|complete|finished/i)),
    url: value(find(p, 'url', ['URL', 'Apply', 'Link'], /url|link|apply/i)) || '',
    open: day(open), openTime: time(open),
    close: day(close), closeTime: time(close),
    next: day(next), nextTime: time(next),
    notionUrl: page.url || '',
  };
}

async function queryNotion({ token, database, fetchImpl }) {
  const rows = [];
  let cursor;
  for (let i = 0; i < MAX_PAGES; i++) {
    const res = await fetchImpl(`https://api.notion.com/v1/databases/${database}/query`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'notion-version': NOTION_VERSION, 'content-type': 'application/json' },
      body: JSON.stringify({ page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }),
      signal: AbortSignal.timeout(20000),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 401) throw Object.assign(new Error('Notion rejected the connection. Check the NOTION_TOKEN secret.'), { status: 502 });
    if (res.status === 404) throw Object.assign(new Error('Notion can’t see the database. In Notion, open it → ••• → Connections → add your integration.'), { status: 502 });
    if (!res.ok) throw Object.assign(new Error(body.message || `Notion returned an error (${res.status}).`), { status: 502 });
    rows.push(...(body.results || []));
    if (!body.has_more) break;
    cursor = body.next_cursor;
  }
  return rows;
}

// Accepts a database ID or a Notion link and returns the 32-character ID.
export function databaseId(value) {
  const m = String(value || '').replace(/-/g, '').match(/[0-9a-f]{32}/i);
  return m ? m[0].toLowerCase() : null;
}

// Name of the page property matching a type and preferred names/pattern (used for writing).
function propName(props, type, names, pattern) {
  for (const n of names) if (props[n] && props[n].type === type) return n;
  for (const [n, p] of Object.entries(props)) if (p.type === type && pattern.test(n)) return n;
  return null;
}

async function notion(fetchImpl, token, path, method = 'GET', body) {
  const res = await fetchImpl(`https://api.notion.com/v1/${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'notion-version': NOTION_VERSION, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  return { res, body: await res.json().catch(() => ({})) };
}

async function updateApplication(req, { token, database, fetchImpl }) {
  let input;
  try { input = await req.json(); } catch { return json(400, { error: 'Expected JSON.' }); }
  const id = String((input && input.id) || '').replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(id)) return json(400, { error: 'Unknown application.' });
  const page = await notion(fetchImpl, token, `pages/${id}`);
  if (page.res.status === 404) return json(404, { error: 'Notion can’t find that application.' });
  if (!page.res.ok) return json(502, { error: page.body.message || 'Couldn’t reach Notion.' });
  const parent = String((page.body.parent && page.body.parent.database_id) || '').replace(/-/g, '');
  if (parent !== database) return json(403, { error: 'That page isn’t in your applications database.' });

  const props = page.body.properties || {};
  const properties = {};
  if (typeof input.done === 'boolean') {
    const n = propName(props, 'checkbox', ['Done'], /done|complete|finished/i);
    if (!n) return json(400, { error: 'Add a “Done” checkbox to the database in Notion first.' });
    properties[n] = { checkbox: input.done };
  }
  if (Array.isArray(input.materialsDone)) {
    const n = propName(props, 'multi_select', ['Materials done'], /done|complete/i);
    if (!n) return json(400, { error: 'Add a “Materials done” field to the database in Notion first.' });
    const names = [...new Set(input.materialsDone.map((x) => String(x).slice(0, 100)))].slice(0, 25);
    properties[n] = { multi_select: names.map((name) => ({ name })) };
  }
  if (typeof input.status === 'string' && input.status.trim()) {
    const n = propName(props, 'select', ['My Status', 'Status', 'Stage'], /status|stage/i)
      || propName(props, 'status', ['Status'], /./);
    if (n) properties[n] = props[n].type === 'status' ? { status: { name: input.status.slice(0, 100) } } : { select: { name: input.status.slice(0, 100) } };
  }
  if (input.next === null || (typeof input.next === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.next))) {
    const n = propName(props, 'date', ['Next ddl', 'Next deadline'], /next|ddl/i);
    if (n) properties[n] = { date: input.next ? { start: input.next } : null };
  }
  if (!Object.keys(properties).length) return json(400, { error: 'Nothing to change.' });

  const upd = await notion(fetchImpl, token, `pages/${id}`, 'PATCH', { properties });
  if (upd.res.status === 403 || upd.body.code === 'restricted_resource') {
    return json(403, { error: 'Notion didn’t allow the change. In Notion → Integrations → Commitments → Capabilities, turn on “Update content”.' });
  }
  if (!upd.res.ok) return json(502, { error: upd.body.message || `Notion returned an error (${upd.res.status}).` });
  return json(200, { app: toApplication(upd.body) });
}

// The tracker is one person's Notion database, so only that person's Google account (APPS_OWNER_EMAIL)
// may read or change it. A data key maps to its Google account through /api/login's store.
async function accountEmail(loginStore, key) {
  if (!loginStore) return null;
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const link = await loginStore.getWithMetadata(`key:${hash}`);
  const user = link && await loginStore.getWithMetadata(`user:${link.data.sub}`);
  return user ? user.data.email : null;
}

export async function handle(req, { syncStore, loginStore = null, env, fetchImpl = fetch }) {
  if (req.method !== 'GET' && req.method !== 'POST') return json(405, { error: 'Use GET or POST' });
  const key = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!KEY_RE.test(key)) return json(401, { error: 'Turn on sync to see your applications.' });
  if (!(await syncStore.getWithMetadata(await syncStorageName(key), { type: 'json' }))) {
    return json(403, { error: 'Turn on sync to see your applications.' });
  }
  const owner = String(env.APPS_OWNER_EMAIL || '').trim().toLowerCase();
  if (owner && (await accountEmail(loginStore, key)) !== owner) {
    return json(403, { error: 'Applications shows the owner’s own Notion tracker, so it isn’t available on your account yet.', notOwner: true });
  }
  const token = env.NOTION_TOKEN;
  if (!token) return json(503, { error: 'Notion isn’t connected yet (see Applications → Set up).', setup: true });
  try {
    const database = databaseId(env.NOTION_APPS_DATABASE);
    if (!database) return json(503, { error: 'Notion isn’t connected yet (see Applications → Set up).', setup: true });
    if (req.method === 'POST') return await updateApplication(req, { token, database, fetchImpl });
    const pages = await queryNotion({ token, database, fetchImpl });
    const apps = pages.filter((pg) => !pg.archived && !pg.in_trash).map(toApplication);
    return json(200, { fetchedAt: new Date().toISOString(), apps });
  } catch (e) {
    return json(e.status || 502, { error: e.message || 'Couldn’t reach Notion.' });
  }
}

