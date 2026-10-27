// The signed-in account a data key belongs to ("Authorization: Bearer <data key>"), from the
// records Sign in with Google keeps (server/login.mjs): { sub, email, name } or null.
const hex = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function accountOf(req, loginStore) {
  const key = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!key) return null;
  const link = await loginStore.getWithMetadata(`key:${await hex(key)}`);
  const user = link && await loginStore.getWithMetadata(`user:${link.data.sub}`);
  return user ? { sub: String(user.data.sub), email: user.data.email, name: user.data.name || '' } : null;
}
