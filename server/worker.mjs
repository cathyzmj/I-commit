// Cloudflare Worker: serves the app (static files from dist/) and its server endpoints.
//   /api/ics     calendar feed relay            (server/ics.mjs)
//   /api/sync    sync between devices           (server/sync.mjs)
//   /api/widget  widget summary mailbox         (server/widget.mjs)
//   /api/apps    Notion application tracker     (server/apps.mjs; secret NOTION_TOKEN)
//   /api/login   Sign in with Google            (server/login.mjs; secrets GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET)
//   /api/logo    find a company's icon          (server/logo.mjs)
//   /api/moodle  read courses from Moodle       (server/moodle.mjs; optional env MOODLE_URL)
//   /api/notify  reminders through Telegram     (server/notify.mjs; secret TELEGRAM_BOT_TOKEN)
//   /api/telegram/webhook  messages to the bot   (server/notify.mjs)
//   /api/feed    private calendar link (.ics)   (server/feed.mjs)
// A cron every minute sends the reminders that are due (scheduled() below; wrangler.toml [triggers]).
//   /google….html  proves to Google Search Console that this site is yours (optional var
//                  GOOGLE_SITE_VERIFICATION: the file name Search Console gives, e.g. google1a2b3c4d.html)
// Storage is the D1 database bound as DB (server/schema.sql).
import { handle as ics } from './ics.mjs';
import { handle as sync } from './sync.mjs';
import { handle as widget } from './widget.mjs';
import { handle as apps } from './apps.mjs';
import { handle as login } from './login.mjs';
import { handle as logo } from './logo.mjs';
import { handle as moodle } from './moodle.mjs';
import { handle as notify, run as sendReminders, webhook as telegramWebhook } from './notify.mjs';
import { handle as feed } from './feed.mjs';
import { d1Store } from './d1-store.mjs';

const notifyEnv = (env) => ({ TELEGRAM_BOT_TOKEN: (env.TELEGRAM_BOT_TOKEN || '').trim() });

export default {
  async fetch(req, env) {
    const { pathname } = new URL(req.url);
    try {
      if (pathname === '/api/notify' || pathname.startsWith('/api/notify/')) {
        return await notify(req, { store: d1Store(env.DB, 'notify'), loginStore: d1Store(env.DB, 'login'), env: notifyEnv(env) });
      }
      if (pathname === '/api/telegram/webhook') return await telegramWebhook(req, { store: d1Store(env.DB, 'notify'), env: notifyEnv(env) });
      if (pathname === '/api/feed' || pathname.startsWith('/api/feed/')) {
        return await feed(req, { store: d1Store(env.DB, 'feed'), loginStore: d1Store(env.DB, 'login') });
      }
      if (pathname === '/api/login' || pathname.startsWith('/api/login/')) {
        return await login(req, { store: d1Store(env.DB, 'login'), syncStore: d1Store(env.DB, 'sync'),
          env: { GOOGLE_CLIENT_ID: (env.GOOGLE_CLIENT_ID || '').trim(), GOOGLE_CLIENT_SECRET: (env.GOOGLE_CLIENT_SECRET || '').trim(),
            SUPABASE_URL: (env.SUPABASE_URL || '').trim(), SUPABASE_KEY: (env.SUPABASE_KEY || '').trim() } });
      }
      if (pathname === '/api/moodle' || pathname === '/api/moodle/f') {
        return await moodle(req, { loginStore: d1Store(env.DB, 'login'), store: d1Store(env.DB, 'moodle'), env: { MOODLE_URL: (env.MOODLE_URL || '').trim() } });
      }
      switch (pathname) {
        case '/api/ics': return await ics(req);
        case '/api/sync': return await sync(req, d1Store(env.DB, 'sync'));
        case '/api/widget': return await widget(req, d1Store(env.DB, 'widget'));
        case '/api/logo': return await logo(req, { loginStore: d1Store(env.DB, 'login') });
        case '/api/apps': return await apps(req, {
          syncStore: d1Store(env.DB, 'sync'), loginStore: d1Store(env.DB, 'login'),
          env: { NOTION_TOKEN: env.NOTION_TOKEN, NOTION_APPS_DATABASE: env.NOTION_APPS_DATABASE, APPS_OWNER_EMAIL: env.APPS_OWNER_EMAIL },
        });
      }
    } catch (e) {
      return Response.json({ error: 'Server error. Try again shortly.' }, { status: 500, headers: { 'cache-control': 'no-store' } });
    }
    if (pathname.startsWith('/api/')) return Response.json({ error: 'Not found' }, { status: 404 });
    const verify = (env.GOOGLE_SITE_VERIFICATION || '').trim().replace(/^\/+/, '').replace(/(\.html)?$/, '.html');
    if (/^google[0-9a-f]+\.html$/.test(verify) && pathname === `/${verify}`) {
      return new Response(`google-site-verification: ${verify}`, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    return env.ASSETS.fetch(req);
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(sendReminders({ store: d1Store(env.DB, 'notify'), env: notifyEnv(env), now: event.scheduledTime }));
  },
};
