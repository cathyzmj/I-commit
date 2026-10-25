# Commitments

A personal commitment tracker: tick off daily and weekly commitments, see planned vs actual hours,
follow your timetable and application deadlines. Works as a home-screen web app on iPhone, in any
browser, and as a native Mac app with a desktop widget.

## Features
- **Commitments:** daily, weekly or one-off (dated); either a *task* (done or not) or a *counter*
  (e.g. 3 messages, 10 hours). Each has a page for notes, links and a Notion page.
- **Today / Week / Calendar:** fast ticking (tap to tick, hold to log minutes), a Mon–Sun grid with
  % ticked and planned vs actual hours, and a day or week timeline.
- **Calendar import:** paste any iCal (.ics) link (Google, Outlook, iCloud, school timetables).
  Repeating events become *schedule* (shown, not counted as to-dos); one-offs become *tasks*. Mark a
  calendar as "my timetable" to treat all its events as schedule.
- **Applications:** reads an application tracker database from Notion (read-only) and shows openings,
  deadlines and next steps on a month calendar, with apply links.
- **Reminders:** push notifications (iPhone Home Screen app, Mac/PC browsers) before timed tasks and
  meetings, the day before application deadlines, and in the evening for routines not yet ticked; plus a
  morning summary email sent through your own Gmail. They arrive even when the app is closed.
- **Google Calendar copy:** timed one-offs, project meetings and application dates are copied into an
  "I Commit!" calendar in your Google Calendar and kept up to date (adds, changes and deletes).
- **Sync** between devices with a private key (no accounts). Per-record merge, so edits on two
  devices don't overwrite each other.
- **Widgets:** a Scriptable widget for iPhone and a native macOS widget (`mac/`).
- **Offline-first:** data lives in IndexedDB on each device; Excel export and JSON backup/restore.

## Layout
| Path | What it is |
|---|---|
| `index.html`, `app.js`, `styles.css` | The app (plain HTML/CSS/JS, no build step, no dependencies) |
| `ics.js`, `xlsx.js` | Calendar parser (recurrence, time zones, exceptions) and a tiny Excel writer |
| `sw.js`, `manifest.webmanifest`, `icons/` | Offline support and home-screen install |
| `widget/commitments-widget.js` | Scriptable widget (the app fills in your key and address when you copy it) |
| `server/` | Cloudflare Worker: `/api/ics` (calendar relay), `/api/sync`, `/api/widget`, `/api/apps` (Notion), `/api/google` (Calendar copy, Gmail), `/api/notify` (reminders, sent by a cron every minute), storage on D1 |
| `mac/` | Native Mac app and desktop widget (see `mac/README.md`) |
| `scripts/build.mjs` | Copies only the public files into `dist/` for deployment |
| `test/` | `npm test`; `npm run dev` runs the Worker locally |

## Deploy (Cloudflare Workers, free plan)
```bash
npm install
npx wrangler login
npx wrangler d1 create commitments          # put the id in wrangler.toml
npx wrangler d1 execute commitments --remote --file server/schema.sql
npm run deploy
```
Optional Notion applications tab: create a read-only Notion integration, share your database with it, then
```bash
npx wrangler secret put NOTION_TOKEN
npx wrangler secret put NOTION_APPS_DATABASE   # the database link or ID
```

Optional reminders and Google Calendar copy (need Sign in with Google to be set up already):
```bash
node scripts/vapid-keys.mjs                    # prints a key pair for push notifications
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put VAPID_SUBJECT          # optional: mailto:you@example.com
```
Then, in the same Google Cloud project as sign-in:
1. **APIs & Services → Library:** enable **Google Calendar API** and **Gmail API**.
2. **OAuth consent screen → Data access:** add the scopes `.../auth/calendar.app.created` (only calendars
   the app makes) and `.../auth/gmail.send`. No new redirect URI is needed.
3. While the app is in **Testing**, add your Gmail as a test user. Google ends a Testing app's access
   after 7 days (the app then asks you to connect again). For lasting access, press **Publish app**; for
   your own use you can skip verification and click through Google's "unverified app" warning.

The cron in `wrangler.toml` deploys with `npm run deploy`. On iPhone, push works in the Home Screen app
(Share → Add to Home Screen, iOS 16.4 or later); the Mac app's window can't show push, so use a browser
there. Open **⋯ → Reminders & Google Calendar** to turn things on.

## Privacy
Your data stays on your devices. With sync on, a copy is stored in your own Cloudflare D1 database
under a hash of your private sync key. With reminders on, a plan of your next 8 days (item names and
times) is stored there too; with Google connected, so is Google's access token for the I Commit!
calendar and for sending the summary email to yourself. Calendar links, the sync key and the widget key are stored on
the device (and in JSON backups), never in this repository.
