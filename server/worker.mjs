// Cloudflare Worker: serves the app (static files from dist/) and its server endpoints.
//   /api/ics     calendar feed relay            (server/ics.mjs)
//   /api/sync    sync between devices           (server/sync.mjs)
//   /api/widget  widget summary mailbox         (server/widget.mjs)
//   /api/apps    Notion application tracker     (server/apps.mjs; secret NOTION_TOKEN)
//   /api/login   Sign in with Google            (server/login.mjs; secrets GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET)
//   /api/logo    find a company's icon          (server/logo.mjs)
//   /api/moodle  read courses from Moodle       (server/moodle.mjs; optional env MOODLE_URL)
//   /api/google  Google Calendar copy + Gmail   (server/google.mjs; the same Google secrets as sign-in)
//   /api/notify  push reminders, morning email  (server/notify.mjs; secrets VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
// A cron every minute sends the reminders that are due (scheduled() below; wrangler.toml [triggers]).
// Storage is the D1 database bound as DB (server/schema.sql).
import { handle as ics } from './ics.mjs';
import { handle as sync } from './sync.mjs';
import { handle as widget } from './widget.mjs';
import { handle as apps } from './apps.mjs';
import { handle as login } from './login.mjs';
import { handle as logo } from './logo.mjs';
import { handle as moodle } from './moodle.mjs';
import { handle as google, connectCallback } from './google.mjs';
import { handle as notify, run as sendReminders } from './notify.mjs';
import { d1Store } from './d1-store.mjs';

const googleEnv = (env) => ({ GOOGLE_CLIENT_ID: (env.GOOGLE_CLIENT_ID || '').trim(), GOOGLE_CLIENT_SECRET: (env.GOOGLE_CLIENT_SECRET || '').trim() });
const notifyEnv = (env) => ({ ...googleEnv(env), VAPID_PUBLIC_KEY: (env.VAPID_PUBLIC_KEY || '').trim(), VAPID_PRIVATE_KEY: (env.VAPID_PRIVATE_KEY || '').trim(), VAPID_SUBJECT: (env.VAPID_SUBJECT || '').trim() });

export default {
  async fetch(req, env) {
    const { pathname } = new URL(req.url);
    try {
      // Google comes back here both after sign-in and after connecting Calendar and Gmail.
      if (pathname === '/api/login/callback') {
        const page = await connectCallback(req, { store: d1Store(env.DB, 'google'), env: googleEnv(env) });
        if (page) return page;
      }
      if (pathname === '/api/google' || pathname.startsWith('/api/google/')) {
        return await google(req, { store: d1Store(env.DB, 'google'), loginStore: d1Store(env.DB, 'login'), env: googleEnv(env) });
      }
      if (pathname === '/api/notify' || pathname.startsWith('/api/notify/')) {
        return await notify(req, { store: d1Store(env.DB, 'notify'), loginStore: d1Store(env.DB, 'login'), googleStore: d1Store(env.DB, 'google'), env: notifyEnv(env) });
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
    return env.ASSETS.fetch(req);
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(sendReminders({ store: d1Store(env.DB, 'notify'), loginStore: d1Store(env.DB, 'login'), googleStore: d1Store(env.DB, 'google'), env: notifyEnv(env), now: event.scheduledTime }));
  },
};
