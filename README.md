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
- **Reminders in Telegram:** messages from the app's bot before timed tasks and meetings, the day
  before application deadlines, in the evening for routines not yet ticked, and a morning briefing of
  the day. They arrive even when the app is closed; send the bot `/today` any time.
- **Calendar link:** timed one-offs, project meetings and application dates as a private calendar link
  you add to Google Calendar (or Apple Calendar, Outlook). No Google permissions needed; Google reads
  the link every few hours.
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
| `server/` | Cloudflare Worker: `/api/ics` (calendar relay), `/api/sync`, `/api/widget`, `/api/apps` (Notion), `/api/notify` (Telegram reminders, sent by a cron every minute), `/api/feed` (calendar link), storage on D1 |
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

Optional Telegram reminders (need Sign in with Google to be set up already): in Telegram, message
**@BotFather**, send `/newbot`, pick a name and a username ending in `bot`, and copy the token it gives:
```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
```
The bot's webhook registers itself the first time someone connects. The calendar link needs no setup.
Sign-in uses only Google's basic scopes (openid, email, profile), so the app can be published without
Google's verification review.

For Google's branding verification, prove the site is yours in [Search Console](https://search.google.com/search-console):
add a **URL prefix** property for your app's address, choose **HTML file**, and store the file's name:
`npx wrangler secret put GOOGLE_SITE_VERIFICATION` (e.g. `google1a2b3c4d.html`). The home page links to
`privacy.html` and `terms.html`, which Google asks for.

The cron in `wrangler.toml` deploys with `npm run deploy`. Open **⋯ → Reminders & Google Calendar** to
connect Telegram and make the calendar link.

## Privacy
Your data stays on your devices. With sync on, a copy is stored in your own Cloudflare D1 database
under a hash of your private sync key. With reminders on, a plan of your next 8 days (item names and
times) is stored there too, with your Telegram chat ID; with the calendar link on, so are the items
the link shows. Calendar links, the sync key and the widget key are stored on
the device (and in JSON backups), never in this repository.
