// In-memory key-value store with ETag conditional writes (used by tests and the dev server).
export function memoryStore({ beforeWrite } = {}) {
  const mem = new Map();
  let n = 0;
  return {
    mem,
    async getWithMetadata(k) {
      const e = mem.get(k);
      return e ? { data: JSON.parse(e.value), etag: e.etag, metadata: {} } : null;
    },
    async setJSON(k, data, opts = {}) {
      if (beforeWrite) await beforeWrite(k);
      const e = mem.get(k);
      if (opts.onlyIfNew && e) return { modified: false };
      if (opts.onlyIfMatch && (!e || e.etag !== opts.onlyIfMatch)) return { modified: false };
      const etag = `e${++n}`;
      mem.set(k, { value: JSON.stringify(data), etag });
      return { modified: true, etag };
    },
    async delete(k) { mem.delete(k); },
    async list(prefix) { return [...mem].filter(([k]) => k.startsWith(prefix)).map(([key, e]) => ({ key, data: JSON.parse(e.value) })); },
  };
}
