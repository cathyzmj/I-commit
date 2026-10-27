// Telegram: how reminders reach you. One bot (made with @BotFather; its token is the secret
// TELEGRAM_BOT_TOKEN) messages everyone who links their chat to their I Commit! account.
//
// Linking: the app opens t.me/<bot>?start=<code> and tells the server the code (startLink). You
// press Start, Telegram sends "/start <code>" to the webhook (/api/telegram/webhook, checked with a
// secret header), and the chat is linked to the account that made the code (10 minutes, one use).
// The webhook is registered with Telegram by itself the first time someone links.
//
// Records, in the reminders store: tg:<account> { chatId, name }, tgchat:<chat> { sub },
// tglink:<code> { sub, at }, tgbot { username, webhook, token } (token: a hash, to notice a new bot).
const enc = new TextEncoder();
const hex = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');
export const CODE_RE = /^[A-Za-z0-9_-]{24,64}$/;
const LINK_MS = 10 * 60e3;

export async function tgCall(env, method, body, fetchImpl = fetch) {
  try {
    const r = await fetchImpl(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}),
    });
    return await r.json().catch(() => ({ ok: false, error_code: r.status }));
  } catch { return { ok: false, error_code: 0 }; }
}
export const webhookSecret = async (env) => (await hex(`webhook:${env.TELEGRAM_BOT_TOKEN}`)).slice(0, 48);

// The bot's @name, and its webhook pointed at this site (asked once, then remembered).
export async function ensureBot(store, env, origin, fetchImpl = fetch) {
  const token = (await hex(env.TELEGRAM_BOT_TOKEN)).slice(0, 16), webhook = `${origin}/api/telegram/webhook`;
  const cur = (await store.getWithMetadata('tgbot'))?.data;
  if (cur && cur.token === token && cur.webhook === webhook) return cur;
  const me = await tgCall(env, 'getMe', {}, fetchImpl);
  if (!me.ok) throw new Error(me.error_code === 401 || me.error_code === 404 ? 'The Telegram bot token on the server is wrong. Set TELEGRAM_BOT_TOKEN again.' : 'Couldn’t reach Telegram. Try again.');
  const hook = await tgCall(env, 'setWebhook', { url: webhook, secret_token: await webhookSecret(env), allowed_updates: ['message'] }, fetchImpl);
  if (!hook.ok) throw new Error('Telegram didn’t accept the webhook. Try again.');
  const rec = { username: me.result.username, webhook, token };
  await store.setJSON('tgbot', rec);
  return rec;
}

export async function startLink(store, sub, code) {
  await store.setJSON(`tglink:${code}`, { sub, at: Date.now() });
}
// "/start <code>" arrived from a chat: link it. -> the account, or null (unknown or expired code)
export async function finishLink(store, code, chat) {
  if (!CODE_RE.test(code || '')) return null;
  const rec = await store.getWithMetadata(`tglink:${code}`);
  if (!rec) return null;
  await store.delete(`tglink:${code}`);
  if (Date.now() - rec.data.at > LINK_MS) return null;
  const sub = rec.data.sub;
  await unlink(store, sub);
  const old = (await store.getWithMetadata(`tgchat:${chat.id}`))?.data;
  if (old && old.sub !== sub) await store.delete(`tg:${old.sub}`); // this chat moves to the new account
  await store.setJSON(`tg:${sub}`, { chatId: chat.id, name: chat.name || '', linked: new Date().toISOString() });
  await store.setJSON(`tgchat:${chat.id}`, { sub });
  return sub;
}
export async function unlink(store, sub) {
  const cur = (await store.getWithMetadata(`tg:${sub}`))?.data;
  if (!cur) return;
  await store.delete(`tg:${sub}`);
  await store.delete(`tgchat:${cur.chatId}`);
}
export const linkedChat = async (store, sub) => (await store.getWithMetadata(`tg:${sub}`))?.data || null;
export const accountOfChat = async (store, chatId) => (await store.getWithMetadata(`tgchat:${chatId}`))?.data?.sub || null;

// -> 'sent' | 'gone' (you blocked the bot or deleted the chat: unlinked) | 'none' (not linked) | 'failed'
export async function sendTelegram(store, sub, html, { env, fetchImpl = fetch }) {
  const chat = await linkedChat(store, sub);
  if (!chat) return 'none';
  return sendToChat(store, chat.chatId, html, { env, fetchImpl });
}
export async function sendToChat(store, chatId, html, { env, fetchImpl = fetch }) {
  const r = await tgCall(env, 'sendMessage', { chat_id: chatId, text: html, parse_mode: 'HTML', link_preview_options: { is_disabled: true } }, fetchImpl);
  if (r.ok) return 'sent';
  if (r.error_code === 403 || (r.error_code === 400 && /chat not found/i.test(r.description || ''))) {
    const sub = await accountOfChat(store, chatId);
    if (sub) await unlink(store, sub);
    return 'gone';
  }
  return 'failed';
}
