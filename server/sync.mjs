// POST/DELETE /api/sync — keeps the app's data in step across devices (e.g. iPhone and Mac).
// `store` is any key-value store with getWithMetadata / setJSON (conditional) / delete; see
// server/d1-store.mjs (Cloudflare D1) and test/sync-fn-store.mjs (in memory).
//
// The app's data is split into small records ("c:<id>" commitment, "ws:<week>:<id>" week item
// details, "wp:<week>:<id>" week item progress, "f:<id>" calendar feed, "t:<id>" knowledge tree,
// "x:<id>" test result, "b:<id>" Work Buddy membership, "n:<id>" whiteboard note). Each record carries the
// time it was last changed on a device (m). Deletions are kept as tombstones for a while.
//
//   POST   { since, records: { key: { p, m } }, tombs: { key: t } }
//          Merges the device's changes (newest change per record wins) and returns everything
//          that changed on the server after version `since`: { version, records, tombs, full }.
//   DELETE Removes the synced copy.
//
// Requests carry "Authorization: Bearer <key>" (a random secret shared by your devices); only a
// SHA-256 hash of it is used as the storage name. Writes are conditional (ETag), so two devices
// syncing at the same moment can't overwrite each other.

const KEY_RE = /^[A-Za-z0-9_-]{32,128}$/;
const RECORD_KEY_RE = /^(c|ws|wp|f|t|x|b|n):[A-Za-z0-9_.:-]{1,160}$/;
const MAX_BYTES = 5 * 1024 * 1024;
const TOMBSTONE_DAYS = 180;
const MAX_ATTEMPTS = 6;

const json = (status, body) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

export async function syncStorageName(key) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`sync:${key}`));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Applies incoming changes to doc in place. Returns true if anything changed.
export function mergeInto(doc, records, tombs) {
  const version = doc.version + 1;
  let changed = false;
  for (const [k, r] of Object.entries(records)) {
    if (!RECORD_KEY_RE.test(k) || !r || typeof r.m !== 'number' || r.p === undefined) continue;
    const existing = doc.records[k], tomb = doc.tombs[k];
    if (tomb && tomb.t >= r.m) continue;           // deleted after this change was made
    if (existing && existing.m >= r.m) continue;   // server already has a newer (or same) change
    doc.records[k] = { p: r.p, m: r.m, v: version };
    delete doc.tombs[k];
    changed = true;
  }
  for (const [k, t] of Object.entries(tombs)) {
    if (!RECORD_KEY_RE.test(k) || typeof t !== 'number') continue;
    const existing = doc.records[k], tomb = doc.tombs[k];
    if (existing && existing.m > t) continue;      // edited again after the deletion
    if (tomb && tomb.t >= t) continue;
    delete doc.records[k];
    doc.tombs[k] = { t, v: version };
    changed = true;
  }
  if (changed) {
    doc.version = version;
    doc.updatedAt = new Date().toISOString();
    const cutoff = Date.now() - TOMBSTONE_DAYS * 864e5;
    for (const [k, tomb] of Object.entries(doc.tombs)) if (tomb.t < cutoff) delete doc.tombs[k];
  }
  return changed;
}

export function changesSince(doc, since) {
  // A device that is ahead of the server (the synced copy was deleted and recreated) gets everything.
  const full = !(since > 0) || since > doc.version;
  const from = full ? 0 : since;
  const records = {}, tombs = {};
  for (const [k, r] of Object.entries(doc.records)) if (r.v > from) records[k] = { p: r.p, m: r.m };
  if (!full) for (const [k, t] of Object.entries(doc.tombs)) if (t.v > from) tombs[k] = t.t;
  return { version: doc.version, records, tombs, full };
}

export async function handle(req, store) {
  const key = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!KEY_RE.test(key)) return json(401, { error: 'Missing or invalid sync key.' });
  const name = await syncStorageName(key);

  if (req.method === 'DELETE') {
    await store.delete(name);
    return json(200, { ok: true });
  }
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed.' });

  const text = await req.text();
  if (text.length > MAX_BYTES) return json(413, { error: 'Too much data in one sync.' });
  let body;
  try { body = JSON.parse(text); } catch { return json(400, { error: 'Expected JSON.' }); }
  const since = Number(body.since) || 0;
  const records = body.records && typeof body.records === 'object' ? body.records : {};
  const tombs = body.tombs && typeof body.tombs === 'object' ? body.tombs : {};
  const joining = body.join === true;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const current = await store.getWithMetadata(name, { type: 'json' });
    if (!current && joining) return json(404, { error: 'No synced data for this key. Check the key, or turn sync on from the device that has your data.' });
    if (!current && since > 0) return json(410, { error: 'Sync was turned off on another device. Turn it on again to keep syncing.' });
    const doc = current ? current.data : { version: 0, records: {}, tombs: {} };
    if (mergeInto(doc, records, tombs)) {
      const result = current
        ? await store.setJSON(name, doc, { onlyIfMatch: current.etag })
        : await store.setJSON(name, doc, { onlyIfNew: true });
      if (!result.modified) continue; // someone else wrote first: re-read and merge again
    }
    return json(200, changesSince(doc, since));
  }
  return json(409, { error: 'Sync is busy. It will try again shortly.' });
}

