// A small key-value store on Cloudflare D1 (SQLite), with the same interface the handlers use:
//   get / set / delete                      plain values (widget summaries)
//   getWithMetadata / setJSON(onlyIfMatch | onlyIfNew)   JSON with an ETag for conditional writes (sync)
//   list(prefix)                            every JSON value whose key starts with prefix (reminders)
// Every value lives in one table, separated by `store` name. Schema: server/schema.sql.
export function d1Store(db, store) {
  const newEtag = () => crypto.randomUUID();
  return {
    async get(key) {
      const row = await db.prepare('SELECT value FROM kv WHERE store = ? AND key = ?').bind(store, key).first();
      return row ? row.value : null;
    },
    async set(key, value) {
      await db.prepare(
        `INSERT INTO kv (store, key, value, etag, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (store, key) DO UPDATE SET value = excluded.value, etag = excluded.etag, updated_at = excluded.updated_at`,
      ).bind(store, key, String(value), newEtag(), Date.now()).run();
      return { modified: true };
    },
    async delete(key) {
      await db.prepare('DELETE FROM kv WHERE store = ? AND key = ?').bind(store, key).run();
    },
    async list(prefix) {
      const { results } = await db.prepare("SELECT key, value FROM kv WHERE store = ? AND key LIKE ? ESCAPE '\\'")
        .bind(store, prefix.replace(/[\\%_]/g, '\\$&') + '%').all();
      return results.map((r) => ({ key: r.key, data: JSON.parse(r.value) }));
    },
    async getWithMetadata(key) {
      const row = await db.prepare('SELECT value, etag FROM kv WHERE store = ? AND key = ?').bind(store, key).first();
      return row ? { data: JSON.parse(row.value), etag: row.etag, metadata: {} } : null;
    },
    async setJSON(key, data, opts = {}) {
      const value = JSON.stringify(data);
      const etag = newEtag();
      let result;
      if (opts.onlyIfNew) {
        result = await db.prepare('INSERT OR IGNORE INTO kv (store, key, value, etag, updated_at) VALUES (?, ?, ?, ?, ?)')
          .bind(store, key, value, etag, Date.now()).run();
      } else if (opts.onlyIfMatch) {
        result = await db.prepare('UPDATE kv SET value = ?, etag = ?, updated_at = ? WHERE store = ? AND key = ? AND etag = ?')
          .bind(value, etag, Date.now(), store, key, opts.onlyIfMatch).run();
      } else {
        await this.set(key, value);
        return { modified: true, etag };
      }
      const modified = (result.meta && result.meta.changes) > 0;
      return modified ? { modified, etag } : { modified: false };
    },
  };
}
