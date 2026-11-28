'use strict';

// ---------- Defaults ----------
// A commitment has a frequency (daily / weekly / once) and a kind:
//   task    – done or not done (planned time = `hours`)
//   counter – count towards `target` `unit`s in `step`s (e.g. 3 emails; 15 h)
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const FREQS = ['daily', 'weekly', 'periodic', 'once'];
const FREQ_LABEL = { daily: 'Daily', weekly: 'Weekly', periodic: 'Periodic', once: 'One-off' };
const LONG_PRESS_MS = 450;

// ---------- Dates ----------
const pad = (n) => String(n).padStart(2, '0');
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const startOfToday = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };
const todayISO = () => isoDate(startOfToday());
const mondayOf = (d) => addDays(d, -((d.getDay() + 6) % 7));
const weekOf = (iso) => isoDate(mondayOf(parseISO(iso)));
const currentWeekKey = () => isoDate(mondayOf(startOfToday()));
const shiftWeek = (key, n) => isoDate(addDays(parseISO(key), 7 * n));
const weekEnd = (key) => isoDate(addDays(parseISO(key), 6));
const weeksBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / (7 * 864e5));
const dayDate = (key, i) => addDays(parseISO(key), i);
const dayIndexOf = (iso) => Math.round((parseISO(iso) - mondayOf(parseISO(iso))) / 864e5);
const fmtDay = (d, opts) => d.toLocaleDateString('en-GB', opts);
const fmtShort = (iso) => fmtDay(parseISO(iso), { weekday: 'short', day: 'numeric', month: 'short' });
function todayIndex(key) {
  const diff = Math.round((startOfToday() - parseISO(key)) / 864e5);
  return diff >= 0 && diff < 7 ? diff : -1;
}
function weekRange(key) {
  const a = parseISO(key), b = addDays(a, 6);
  const start = a.getMonth() === b.getMonth() ? fmtDay(a, { day: 'numeric' }) : fmtDay(a, { day: 'numeric', month: 'short' });
  return `${start} to ${fmtDay(b, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

// ---------- Formatting ----------
const round2 = (x) => Math.round(x * 100) / 100;
const fmtH = (x) => `${round2(x)}h`;
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10);
// Short stable hash (cyrb53) used for ids that must come out the same on every device.
function hash36(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
const num = (v, d = 0) => { const n = parseFloat(v); return isFinite(n) && n >= 0 ? n : d; };
const validTime = (t) => (/^\d{2}:\d{2}$/.test(String(t || '')) ? t : null);
const timeRange = (x) => (x.time ? `${x.time}${x.endTime ? '–' + x.endTime : ''}` : '');
const isHourUnit = (u) => /^(h|hr|hrs|hour|hours)$/i.test(String(u || '').trim());
const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// Only allow web and Notion links (also guards against javascript: URLs in imported data).
function cleanUrl(u) {
  u = String(u || '').trim();
  if (!u) return '';
  if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = 'https://' + u;
  try {
    const p = new URL(u);
    return ['http:', 'https:', 'notion:'].includes(p.protocol) ? p.href : '';
  } catch { return ''; }
}
function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } }
// Notion web links open in the browser from a home-screen app; notion:// opens the Notion app.
const notionAppUrl = (u) => u.replace(/^https:\/\/(www\.)?notion\.so\//, 'notion://www.notion.so/');
function linkify(text) {
  return escapeHtml(text).replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g,
    (m) => `<a href="${m}" target="_blank" rel="noopener">${m}</a>`);
}

// ---------- Storage (IndexedDB) ----------
const DB_NAME = 'commitment-tracker', STORE = 'kv', STATE_KEY = 'state';
let dbPromise;
function openDb() {
  dbPromise = dbPromise || new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}
async function loadState() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).get(STATE_KEY);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
let writeState = async function () {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(state, STATE_KEY);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
};

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 150);
}
function flush() {
  if (saveTimer === null) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  const changed = stampChanges();
  writeState().catch((e) => toast('Could not save: ' + e.message));
  scheduleWidgetPush();
  scheduleOutbound();
  buddyAutoTick();
  if (myProfile && (myProfile.share_calendar !== 'off' || calPeople.length)) scheduleShare();
  if (changed) scheduleSync();
}

// ---------- State & migration ----------
let state;
let viewKey = currentWeekKey();
let lastCurrentKey = viewKey;
let reorderMode = false;

function newCommitment(fields) {
  return {
    id: uid(), name: '', section: 'Other', freq: 'daily', kind: 'task', target: 1, unit: '', step: 1,
    hours: 1, everyDays: 7, date: null, time: null, endTime: null, notes: '', notionUrl: '', links: [], source: null, schedule: false, track: false,
    archived: false, order: 0, ...fields,
  };
}
function defaultState() {
  return {
    version: 2,
    commitments: [], // new people start with an empty list and add their own
    weeks: {},
    calendars: { feeds: [] },
    widget: { enabled: false, token: null, lastPush: null, lastError: null },
    sync: freshSync(),
    apps: { items: [], fetchedAt: null, error: null, setup: false },
    trees: [], tests: [], notes: [], buddy: null, testRoutine: null, account: null,
  };
}
const fit7 = (a, fill) => (Array.isArray(a) ? a.slice(0, 7) : []).concat(Array(7).fill(fill)).slice(0, 7);

function normaliseCommitment(c) {
  const n = newCommitment(c);
  n.freq = FREQS.includes(n.freq) ? n.freq : 'daily';
  n.kind = n.kind === 'counter' && n.freq !== 'periodic' ? 'counter' : 'task';
  n.everyDays = Math.min(365, Math.max(1, Math.round(num(n.everyDays, 7)) || 7));
  if (n.freq === 'periodic' && !n.date) n.date = todayISO(); // first due date
  n.links = (Array.isArray(n.links) ? n.links : []).map((l) => ({ label: String(l.label || ''), url: cleanUrl(l.url) })).filter((l) => l.url);
  n.notionUrl = cleanUrl(n.notionUrl);
  n.stageUrl = cleanUrl(n.stageUrl); // test / interview link for application follow-ups
  n.time = validTime(n.time); n.endTime = validTime(n.endTime);
  n.tbc = n.freq === 'once' && !n.date; // date to be confirmed
  if (n.stage === 'IV') { n.stage = 'IT'; n.name = n.name.replace(/ · IV$/, ' · IT'); } // interview was IV briefly
  return n;
}
function normaliseItem(it) {
  it.ticks = fit7(it.ticks, false).map(Boolean);
  it.counts = fit7(it.counts, 0).map((n) => num(n));
  it.mins = fit7(it.mins, null).map((m) => (m == null ? null : num(m)));
  it.focus = fit7(it.focus, 0).map((m) => num(m)); // focus-time minutes per day
  it.count = num(it.count);
  it.done = !!it.done;
  return it;
}

function migrate(s) {
  if (!s || !Array.isArray(s.commitments) || typeof s.weeks !== 'object' || s.weeks === null) {
    throw new Error("This doesn't look like a Commitments backup.");
  }
  if ((s.version || 1) < 2) {
    // v1: every commitment was hours-based; weekly ones logged hours in 0.5h steps.
    const convert = (o) => {
      const freq = o.type === 'weekly' ? 'weekly' : 'daily';
      const hours = num(o.target);
      if (freq === 'weekly') return { freq, kind: 'counter', target: hours, unit: 'h', step: 0.5, hours, name: o.name };
      return { freq, kind: 'task', target: 1, unit: '', step: 1, hours, name: o.name };
    };
    for (const c of s.commitments) { Object.assign(c, convert(c)); delete c.type; }
    for (const w of Object.values(s.weeks)) {
      for (const it of Object.values(w.items || {})) {
        const v1Hours = num(it.hours);
        const conv = convert(it);
        const ticks = fit7(it.ticks, false);
        it.counts = conv.kind === 'counter' && conv.freq === 'daily' ? ticks.map((t) => (t ? conv.target : 0)) : Array(7).fill(0);
        it.count = conv.freq === 'weekly' ? v1Hours : 0;
        Object.assign(it, conv, { date: null });
        delete it.type;
      }
    }
    s.version = 2;
  }
  s.commitments = s.commitments.map(normaliseCommitment);
  const feeds = s.calendars && Array.isArray(s.calendars.feeds) ? s.calendars.feeds : [];
  const obj = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? o : {});
  const wd = obj(s.widget);
  s.widget = {
    enabled: !!wd.enabled && /^[A-Za-z0-9_-]{32,128}$/.test(wd.token || ''), token: wd.token || null,
    lastPush: wd.lastPush || null, lastError: wd.lastError || null,
  };
  const ap = obj(s.apps);
  s.apps = { items: Array.isArray(ap.items) ? ap.items : [], fetchedAt: ap.fetchedAt || null, error: ap.error || null, setup: !!ap.setup };
  const sy = obj(s.sync);
  s.sync = {
    ...freshSync(),
    enabled: !!sy.enabled && /^[A-Za-z0-9_-]{32,128}$/.test(sy.key || ''), key: sy.key || null,
    version: Number(sy.version) || 0, stamps: obj(sy.stamps), dirty: obj(sy.dirty), tombs: obj(sy.tombs),
    lastSync: sy.lastSync || null, lastError: sy.lastError || null,
  };
  if (!s.sync.enabled) s.sync = freshSync();
  // knowledge trees and test results are no longer shown; keep what was saved, as it was
  s.trees = Array.isArray(s.trees) ? s.trees : [];
  s.tests = Array.isArray(s.tests) ? s.tests : [];
  s.notes = (Array.isArray(s.notes) ? s.notes : []).map(normaliseNote);
  s.account = s.account && s.account.email && s.sync.enabled ? { email: String(s.account.email), name: String(s.account.name || '') } : null;
  s.buddy = s.buddy ? { commitmentId: s.buddy.commitmentId || null, links: s.buddy.links || {} } : null; // Work Buddy itself lives in Supabase
  s.calendars = {
    feeds: feeds.filter((f) => f && f.url).map((f) => ({
      id: f.id || uid(), name: String(f.name || 'Calendar'), url: String(f.url), section: String(f.section || 'Calendar'),
      lastSync: f.lastSync || null, lastError: f.lastError || null,
      decisions: obj(f.decisions), skipped: obj(f.skipped), pending: Array.isArray(f.pending) ? f.pending : [], ask: !!f.ask,
      allSchedule: !!f.allSchedule,
      color: /^#[0-9a-f]{6}$/i.test(f.color || '') ? f.color : null,
    })),
  };
  // Old versions misfiled records they didn't know as "weeks"; real weeks are keyed by a date.
  for (const key of Object.keys(s.weeks)) if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) delete s.weeks[key];
  for (const [key, w] of Object.entries(s.weeks)) {
    w.start = w.start || key;
    w.items = w.items || {};
    for (const it of Object.values(w.items)) {
      normaliseItem(it);
      it.kind = it.kind === 'counter' ? 'counter' : 'task';
      it.freq = FREQS.includes(it.freq) ? it.freq : 'daily';
    }
  }
  return s;
}

// ---------- Weeks ----------
// A week stores a snapshot of each commitment so past weeks keep the plan they had.
const SNAPSHOT_FIELDS = ['name', 'section', 'freq', 'kind', 'target', 'unit', 'step', 'hours', 'order', 'date', 'time', 'endTime', 'schedule', 'timeUnit', 'everyDays', 'track'];
function blankItem(c) {
  const it = { ticks: Array(7).fill(false), counts: Array(7).fill(0), mins: Array(7).fill(null), focus: Array(7).fill(0), count: 0, done: false };
  for (const f of SNAPSHOT_FIELDS) it[f] = c[f];
  return it;
}
const hasData = (it) => it.ticks.some(Boolean) || it.counts.some((n) => n > 0) || it.mins.some((m) => m != null) || it.count > 0 || it.done;

function applyCommitment(it, c) {
  if (it.kind !== c.kind) {
    // Carry progress across when a task becomes a counter or vice versa.
    if (c.kind === 'counter') {
      it.counts = it.counts.map((n, i) => (it.ticks[i] ? Math.max(n, c.target) : n));
      if (it.done) it.count = Math.max(it.count, c.target);
    } else {
      it.ticks = it.ticks.map((t, i) => t || reached(it.counts[i], it.target));
      it.done = it.done || reached(it.count, it.target);
    }
  }
  for (const f of SNAPSHOT_FIELDS) it[f] = c[f];
  it.archived = false;
}
function belongs(c, w) {
  if (c.archived) return false;
  if (c.freq === 'once') return !!c.date && c.date >= w.start && c.date <= weekEnd(w.start);
  return true;
}
// Live weeks (current/future) follow every commitment edit. Past weeks stay frozen,
// except one-off items, which always live in the week of their date.
function syncWeek(w, live) {
  const byId = new Map(state.commitments.map((c) => [c.id, c]));
  for (const c of state.commitments) {
    if (!live && c.freq !== 'once') continue;
    if (!belongs(c, w)) continue;
    if (w.items[c.id]) applyCommitment(w.items[c.id], c);
    else w.items[c.id] = blankItem(c);
  }
  for (const [id, it] of Object.entries(w.items)) {
    const c = byId.get(id);
    if (!it.freq) continue;
    if (!live && it.freq !== 'once') continue;
    if (c && belongs(c, w)) continue;
    if (!hasData(it)) delete w.items[id];
    else it.archived = true;
  }
}
const isLiveWeek = (key) => key >= currentWeekKey();
function getWeek(key, create = isLiveWeek(key)) {
  let w = state.weeks[key];
  if (!w && create) { w = state.weeks[key] = { start: key, items: {} }; save(); }
  if (w) syncWeek(w, isLiveWeek(key));
  return w;
}

// ---------- Progress maths ----------
const reached = (n, target) => (target > 0 ? n >= target - 1e-9 : n > 0);
const plannedHours = (it) => (it.kind === 'counter' && isHourUnit(it.unit) ? it.target : it.hours);
const counterHours = (it, n) => (isHourUnit(it.unit) ? n : it.target > 0 ? (it.hours * n) / it.target : 0);
const dayDone = (it, i) => (it.kind === 'task' ? it.ticks[i] : reached(it.counts[i], it.target));
const dayStarted = (it, i) => (it.kind === 'task' ? it.ticks[i] : it.counts[i] > 0);
function dayHours(it, i) {
  if (it.track && it.focus && it.focus[i] > 0) return it.focus[i] / 60; // recorded focus time is the real time spent
  if (it.mins[i] != null && dayStarted(it, i)) return it.mins[i] / 60;
  return it.kind === 'task' ? (it.ticks[i] ? it.hours : 0) : counterHours(it, it.counts[i]);
}
const periodDone = (it) => (it.kind === 'task' ? it.done : reached(it.count, it.target));
const periodHours = (it) => (it.track && it.focus && it.focus.some((m) => m > 0) ? it.focus.reduce((a, b) => a + b, 0) / 60 : it.kind === 'task' ? (it.done ? it.hours : 0) : counterHours(it, it.count));

// ---------- Periodic routines ----------
// e.g. laundry every 7 days: due on its first date, then N days after it was last done.
// Missed ones stay due (overdue) until ticked.
const addDaysISO = (iso, n) => { const d = parseISO(iso); d.setDate(d.getDate() + n); return isoDate(d); };
const tickedOn = (id, iso) => { const it = state.weeks[weekOf(iso)] && state.weeks[weekOf(iso)].items[id]; return !!(it && it.ticks[dayIndexOf(iso)]); };
function lastDoneISO(id, before) {
  let last = null;
  for (const w of Object.values(state.weeks)) {
    const it = w.items[id];
    if (!it) continue;
    it.ticks.forEach((t, i) => {
      if (!t) return;
      const d = isoDate(dayDate(w.start, i));
      if (d < before && (!last || d > last)) last = d;
    });
  }
  return last;
}
// Next due date counting only ticks before `before`.
function nextDueISO(id, x, before) {
  const last = lastDoneISO(id, before);
  return last ? addDaysISO(last, x.everyDays || 7) : (x.date || todayISO());
}
// 'done' | 'due' | 'overdue' | null for one day.
function periodicOn(id, x, iso) {
  if (tickedOn(id, iso)) return 'done';
  const today = todayISO();
  if (iso < today) return null;
  let due = nextDueISO(id, x, iso);
  if (iso === today) return due <= today ? (due < today ? 'overdue' : 'due') : null;
  if (due < today) due = today;
  return due === iso ? 'due' : null;
}
// Upcoming due date (today if overdue or due today and not yet done).
function periodicNext(id, x) {
  const today = todayISO();
  const st = periodicOn(id, x, today);
  if (st === 'due' || st === 'overdue') return today;
  const due = nextDueISO(id, x, addDaysISO(today, 1));
  return due < today ? today : due;
}
const everyLabel = (n) => (n % 7 === 0 ? (n === 7 ? 'week' : `${n / 7} weeks`) : n === 1 ? 'day' : `${n} days`);
function periodicSub(id, x) {
  const today = todayISO();
  const st = periodicOn(id, x, today);
  if (st === 'done') return `done today · next ${fmtShort(addDaysISO(today, x.everyDays || 7))}`;
  if (st === 'overdue') { const n = -daysUntil(nextDueISO(id, x, today)); return `<span class="err">overdue ${n} day${n === 1 ? '' : 's'}</span>`; }
  if (st === 'due') return 'due today';
  const next = periodicNext(id, x);
  return `next ${daysUntil(next) === 1 ? 'tomorrow' : fmtShort(next)}`;
}

function weekStats(w, { routine = false } = {}) {
  const cur = currentWeekKey();
  const ti = todayIndex(w.start);
  const daysElapsed = w.start < cur ? 7 : w.start > cur ? 0 : ti + 1;
  const today = todayISO();
  let planned = 0, actual = 0, pace = 0, ticked = 0, total = 0;
  for (const [id, it] of Object.entries(w.items)) {
    if (!it.freq || it.schedule || (routine && it.freq === 'once')) continue;
    const ph = plannedHours(it);
    if (it.freq === 'periodic') {
      for (let i = 0; i < 7; i++) {
        const d = isoDate(dayDate(w.start, i));
        const st = periodicOn(id, it, d);
        if (!st) continue;
        planned += ph; total++;
        if (d <= today) pace += ph;
        if (st === 'done') { ticked++; actual += dayHours(it, i); }
      }
    } else if (it.freq === 'daily') {
      planned += ph * 7; pace += ph * daysElapsed; total += 7;
      for (let i = 0; i < 7; i++) { if (dayDone(it, i)) ticked++; actual += dayHours(it, i); }
    } else {
      planned += ph; total += 1;
      pace += it.freq === 'weekly' ? (ph * daysElapsed) / 7 : it.date <= today ? ph : 0;
      if (periodDone(it)) ticked++;
      actual += periodHours(it);
    }
  }
  return { planned, actual, pace, ticked, total, pct: total ? ticked / total : 0 };
}
function dayStats(w, i) {
  const iso = isoDate(dayDate(w.start, i));
  let planned = 0, actual = 0, done = 0, total = 0;
  for (const [id, it] of Object.entries(w.items)) {
    if (!it.freq || it.schedule) continue;
    if (it.freq === 'daily') {
      planned += plannedHours(it); actual += dayHours(it, i); total++; if (dayDone(it, i)) done++;
    } else if (it.freq === 'periodic') {
      const st = periodicOn(id, it, iso);
      if (st) { planned += plannedHours(it); total++; if (st === 'done') { done++; actual += dayHours(it, i); } }
    } else if (it.freq === 'once' && it.date === iso) {
      planned += plannedHours(it); actual += periodHours(it); total++; if (periodDone(it)) done++;
    }
  }
  return { planned, actual, done, total };
}

function itemsOf(w, freq) {
  return Object.entries(w.items).filter(([, it]) => it.freq === freq)
    .sort((a, b) => (freq === 'once' ? onceSortKey(a[1]).localeCompare(onceSortKey(b[1])) : 0) || a[1].order - b[1].order);
}
// Schedule items are repeating calendar events (e.g. lectures): shown on the calendar and in the
// day's schedule, but not to-dos, so they don't count towards % ticked or planned/actual hours.
const isTask = ([, it]) => !it.schedule;
const locationOf = (x) => ((x.notes || '').startsWith('📍') ? x.notes.split('\n')[0].replace('📍', '').trim() : '');
// Week items don't carry notes, so look the location up on the commitment itself.
const stageUrlById = (id) => { const c = state.commitments.find((x) => x.id === id); return (c && c.stageUrl) || ''; };
// Colour of an event's calendar (manual one-offs use light green).
function eventColor(id) {
  const c = state.commitments.find((x) => x.id === id);
  const i = c && c.source ? state.calendars.feeds.findIndex((f) => f.id === c.source.feed) : -1;
  if (i < 0) return CAL_COLORS[3];
  return state.calendars.feeds[i].color || CAL_COLORS[i % CAL_COLORS.length];
}
const locationById = (id) => { const c = state.commitments.find((x) => x.id === id); return c ? locationOf(c) : ''; };
const onceSortKey = (x) => `${x.date || ''} ${x.time || '  :  '}`;
function groupBySection(entries, getSection = (e) => e[1].section) {
  const sections = new Map();
  for (const e of entries) {
    const s = getSection(e) || 'Other';
    if (!sections.has(s)) sections.set(s, []);
    sections.get(s).push(e);
  }
  return sections;
}

// Short descriptions such as "3 emails/day", "15h/week", "1h".
// Planned time is stored in hours; timeUnit 'min' just shows it in minutes (e.g. 45m).
const fmtPlan = (x) => (x.timeUnit === 'min' ? `${Math.round((x.hours || 0) * 60)}m` : fmtH(x.hours || 0));
function targetLabel(x) {
  if (x.freq === 'periodic') return `${fmtPlan(x)} · every ${everyLabel(x.everyDays || 7)}`;
  const per = x.freq === 'daily' ? '/day' : x.freq === 'weekly' ? '/week' : '';
  if (x.kind === 'counter') {
    return isHourUnit(x.unit) ? `${round2(x.target)}h${per}` : `${round2(x.target)} ${x.unit || ''}`.trim() + per + (x.hours ? ` · ≈${fmtPlan(x)}` : '');
  }
  return `${fmtPlan(x)}${per}`;
}
function countLabel(it, n) {
  return isHourUnit(it.unit) ? `${round2(n)} of ${fmtH(it.target)}` : `${round2(n)}/${round2(it.target)} ${it.unit || ''}`.trim();
}

// ---------- Routing ----------
// #/home (the donut, where the app opens)  #/plan (this week)  #/reminders  #/today  #/cal  #/routine (was #/week)  #/academics  #/academics/<course id>  #/apps  #/buddy  #/gallery  #/gallery/<id>[/edit]  #/commitments  #/c/<id>  #/c/<id>/edit  #/new/<freq>
function parseHash() {
  const [a, b, c] = location.hash.replace(/^#\/?/, '').split('/');
  if (a === 'c' && b) return { tab: 'commitments', id: b, edit: c === 'edit' };
  if (a === 'apps') return { tab: 'apps', day: /^\d{4}-\d{2}-\d{2}$/.test(b || '') ? b : null };
  if (a === 'widget') return { tab: 'commitments', page: 'widget' };
  if (a === 'sync') return { tab: 'commitments', page: 'sync' };
  if (a === 'account') return { tab: 'commitments', page: 'account' };
  if (a === 'reminders') return { tab: 'commitments', page: 'notify' };
  if (a === 'calendar') return { tab: 'commitments', page: b === 'review' ? 'review' : 'calendar' };
  if (a === 'new') return { tab: 'commitments', id: 'new', edit: true, freq: FREQS.includes(b) ? b : 'daily' };
  if (a === 'week' || a === 'knowledge' || a === 'tests') return { tab: 'routine' };
  if (a === 'today' || a === 'board') return { tab: 'plan' };
  if (a === 'academics') return /^\d+$/.test(b || '') ? { tab: 'academics', page: 'course', courseId: +b } : { tab: 'academics' };
  if (a === 'puzzle') return { tab: 'plan', page: 'puzzle' };
  if (a === 'gallery' && b) return { tab: 'gallery', page: b === 'new' || c === 'edit' ? 'project-edit' : 'project', projId: b };
  if (a === 'join') return { tab: 'buddy', invite: /^[a-z0-9]{10}$/i.test(b || '') ? b.toLowerCase() : '' };
  return { tab: ['home', 'plan', 'routine', 'cal', 'buddy', 'gallery', 'academics', 'commitments'].includes(a) ? a : 'plan' };
}
// The app always opens on This week, at today (an invite link, or a deadline notification, still opens its page). A refresh stays where you were.
const isReload = (() => { try { return performance.getEntriesByType('navigation')[0].type === 'reload'; } catch { return false; } })();
if (!isReload && !/^#\/(join|apps)\//.test(location.hash) && location.hash && location.hash !== '#/plan') history.replaceState(null, '', '#/plan');
let route = parseHash();
window.addEventListener('hashchange', () => {
  route = parseHash();
  wbPick = null;
  planJump = route.tab === 'plan';
  if (route.tab === 'buddy') refreshBuddy();
  if (route.tab === 'gallery' && projects !== null && !route.page) loadProjects();
  if (route.tab === 'academics') acadLoad();
  if (route.page === 'account') loadLoginConfig();
  if (route.page === 'notify') loadOutboundStatus();
  if (route.tab === 'apps') {
    if (route.day) { appsDay = route.day; appsMonth = route.day.slice(0, 7); }
    refreshApps();
  }
  closeSheet();
  render();
  window.scrollTo(0, 0);
});
// Pages that are mostly a form being filled in: background refreshes leave them alone, so
// switching to another window and back never wipes what you've typed.
const formOpen = () => !!(route.edit || /-edit$/.test(route.page || '') || (route.tab === 'academics' && !route.page && acad.conn === false));
function goBack(fallback = '#/plan') {
  if (history.length > 1) history.back(); else location.hash = fallback;
}

// ---------- Rendering ----------
const $app = document.getElementById('app');
const $sheet = document.getElementById('sheet');

function render() {
  if (!state) return; // still loading saved data
  puzMemo = null; // pieces earned are worked out again from the latest ticks
  let html;
  if (route.page === 'sync') html = syncPageHtml();
  else if (route.page === 'account') html = accountPageHtml();
  else if (route.page === 'notify') html = notifyPageHtml();
  else if (route.page === 'widget') html = widgetPageHtml();
  else if (route.page === 'calendar') html = calendarPageHtml();
  else if (route.page === 'review') html = reviewPageHtml();
  else if (route.page === 'project') html = projectPageHtml();
  else if (route.page === 'course') html = courseHtml();
  else if (route.page === 'puzzle') html = puzzlePageHtml();
  else if (route.page === 'project-edit') html = projectEditHtml();
  else if (route.id && route.edit) html = editPageHtml();
  else if (route.id) html = detailPageHtml(route.id);
  else if (route.tab === 'routine') html = weekTabHtml();
  else if (route.tab === 'buddy') html = buddyTabHtml();
  else if (route.tab === 'cal') html = calendarTabHtml();
  else if (route.tab === 'apps') html = appsTabHtml();
  else if (route.tab === 'gallery') html = galleryHtml();
  else if (route.tab === 'academics') html = academicsHtml();
  else if (route.tab === 'home') html = homeHtml();
  else if (route.tab === 'plan') html = planHtml();
  else if (route.tab === 'commitments') html = commitmentsTabHtml();
  else html = planHtml();
  $app.dataset.tab = route.id || route.page ? 'page' : route.tab;
  $app.dataset.page = route.page || '';
  $app.innerHTML = html + floatDonutHtml() + focusBarHtml(); // the floating donut replaces the sidebar
  if (route.tab === 'plan' && planJump) { // arriving on This week: bring today into view
    planJump = false;
    setTimeout(() => { const t = $app.querySelector('.wday.today'); if (t) t.scrollIntoView({ block: 'center' }); }, 30); // after the page's own jump to the top
  }
  fillSideSections();
  if (route.page === 'puzzle') layoutPuzzle();
  document.body.classList.toggle('gardening', route.tab === 'buddy');
  layoutGarden();
  if (['plan', 'today', 'home'].includes(route.tab)) puzzleNotify();
  if (route.page === 'project') scrollTimeline();
}

// ---------- Side navigation (wide screens, e.g. the Mac app) ----------
function pageSections() {
  return [...$app.querySelectorAll(':scope > section.card, :scope > details.card, :scope > form.card')].map((el, i) => {
    const title = el.dataset.section || el.querySelector('.card-head h2')?.textContent || el.querySelector(':scope > summary')?.textContent || '';
    el.id = el.id || `sec-${i}`;
    return { el, title: title.trim() };
  }).filter((x) => x.title);
}
function fillSideSections() {
  const holder = $app.querySelector('.sn-sections');
  if (!holder) return;
  const secs = pageSections();
  holder.innerHTML = secs.length > 1 ? secs.map((x) => `<button data-jump="${x.el.id}">${escapeHtml(x.title)}</button>`).join('') : '';
  highlightSection();
}
// Marks the section currently at the top of the window.
let jumpHoldUntil = 0;
function highlightSection() {
  const links = [...$app.querySelectorAll('.sn-sections [data-jump]')];
  if (!links.length || Date.now() < jumpHoldUntil) return;
  let current = links[0].dataset.jump;
  for (const l of links) {
    const el = document.getElementById(l.dataset.jump);
    if (el && el.getBoundingClientRect().top < 140) current = l.dataset.jump;
  }
  if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) current = links[links.length - 1].dataset.jump;
  links.forEach((l) => l.classList.toggle('on', l.dataset.jump === current));
}
document.addEventListener('toggle', (e) => {
  const d = e.target;
  if (d.dataset && d.dataset.fold) { if (d.open) appsExpanded.add(`open:${d.dataset.fold}`); else appsExpanded.delete(`open:${d.dataset.fold}`); }
}, true);
let scrollTick = false;
window.addEventListener('scroll', () => {
  if (scrollTick) return;
  scrollTick = true;
  requestAnimationFrame(() => { scrollTick = false; highlightSection(); });
}, { passive: true });

function topBar({ left = '', label = '', title = '', right = '', titleAct = '' }) {
  const t = `<span class="lbl">${label}</span><span class="range">${title}</span>`;
  return `<div class="nav">${left || '<span class="icon-spacer"></span>'}
    ${titleAct ? `<button class="wk" ${titleAct}>${t}</button>` : `<div class="wk">${t}</div>`}
    ${right || '<span class="icon-spacer"></span>'}</div>`;
}
const menuBtn = '<button class="icon-btn" data-act="menu" aria-label="Menu">⋯</button>';

// --- daily cells (shared by Week grid, Today list and detail page) ---
function cellInner(it, i) {
  if (it.kind === 'task') return it.ticks[i] ? (it.mins[i] != null ? `<span class="m">${it.mins[i]}</span>` : CHECK) : '';
  const n = it.counts[i];
  return n > 0 ? `<span class="m">${round2(n)}</span>` : '';
}
function cellClass(it, i) {
  if (dayDone(it, i)) return 'on';
  return dayStarted(it, i) ? 'part' : '';
}
function cellLabel(it, i) {
  const what = it.kind === 'task' ? (it.ticks[i] ? 'done' : 'not done') : countLabel(it, it.counts[i]);
  return `${it.name}, ${DAY_NAMES[i]}: ${what}${it.mins[i] != null ? `, ${it.mins[i]} minutes` : ''}`;
}
function dayCellsHtml(wk, id, it) {
  const ti = todayIndex(wk);
  const today = startOfToday();
  return it.ticks.map((_, i) => `<button class="cell ${cellClass(it, i)} ${i === ti ? 'today' : ''} ${dayDate(wk, i) > today ? 'future' : ''}"
      data-cell="${wk}:${id}:${i}" aria-label="${escapeHtml(cellLabel(it, i))}"><span class="box">${cellInner(it, i)}</span></button>`).join('');
}
function dayHeadHtml(wk) {
  const ti = todayIndex(wk);
  return `<div class="row head">${DAY_NAMES.map((d, i) =>
    `<div class="dh ${i === ti ? 'today' : ''}"><span>${d[0]}</span><b>${dayDate(wk, i).getDate()}</b></div>`).join('')}</div>`;
}

// --- weekly / one-off rows (shared) ---
function periodRowHtml(wk, id, it, { showDate = false } = {}) {
  const done = periodDone(it);
  const sub = [showDate && it.date ? fmtShort(it.date) : '', timeRange(it),
    it.kind === 'counter' ? countLabel(it, it.count) : fmtPlan(it)].filter(Boolean).join(' · ');
  const pct = it.kind === 'counter' ? (it.target ? Math.min(100, (it.count / it.target) * 100) : it.count > 0 ? 100 : 0) : 0;
  const check = it.kind === 'task'
    ? `<button class="chk ${done ? 'on' : ''}" data-act="pdone" data-wk="${wk}" data-id="${id}" aria-pressed="${done}" aria-label="${escapeHtml(it.name)} done">${done ? CHECK : ''}</button>`
    : `<span class="chk ring ${done ? 'on' : ''}" aria-hidden="true">${done ? CHECK : ''}</span>`;
  const stepper = it.kind === 'counter' ? `
    <div class="stepper">
      <button data-act="pstep" data-wk="${wk}" data-id="${id}" data-dir="-1" aria-label="Minus ${it.step}" ${it.count <= 0 ? 'disabled' : ''}>−</button>
      <button data-act="pstep" data-wk="${wk}" data-id="${id}" data-dir="1" aria-label="Plus ${it.step}">+</button>
    </div>` : '<span></span>';
  return `
    <div class="wrow ${done ? 'is-done' : ''} ${it.archived ? 'archived' : ''}">
      ${check}
      <a class="name" href="#/c/${id}">
        <div class="n">${escapeHtml(it.name)}</div>
        <div class="sub">${sub}</div>
        ${it.kind === 'counter' ? `<div class="mini"><i style="width:${pct}%"></i></div>` : ''}
      </a>
      ${focusBtn(id, wk, Math.max(0, todayIndex(wk)), it)}${stageUrlById(id) ? `<a class="mini-btn go-link" href="${escapeHtml(stageUrlById(id))}" target="_blank" rel="noopener" title="Open link">↗</a>` : stepper}
    </div>`;
}

function statsHtml(s, { showPace }) {
  const barW = s.planned ? Math.min(100, (s.actual / s.planned) * 100) : 0;
  const paceX = s.planned ? Math.min(100, (s.pace / s.planned) * 100) : 0;
  return `
    <div class="stats">
      <div class="stat"><b>${Math.round(s.pct * 100)}%</b><span>ticked · ${s.ticked}/${s.total}</span></div>
      <div class="stat right"><b>${fmtH(s.actual)} <small>/ ${fmtH(s.planned)}</small></b><span>actual / planned</span></div>
    </div>
    <div class="hbar" role="img" aria-label="${fmtH(s.actual)} of ${fmtH(s.planned)} planned">
      <i style="width:${barW}%"></i>${showPace && s.pace > 0 ? `<em style="left:${paceX}%"></em>` : ''}
    </div>
    ${showPace && s.pace > 0 ? `<div class="pace">Pace for end of today: ${fmtH(s.pace)} · ${s.actual >= s.pace - 1e-9 ? 'on track' : fmtH(s.pace - s.actual) + ' behind'}</div>` : ''}`;
}

// On a device that isn't synced (e.g. the website in a new browser), offer to sign in.
function signInHintHtml() {
  let off = false;
  try { off = localStorage.getItem('signinHint') === 'off'; } catch {}
  if (state.account || off) return '';
  return `<section class="card banner-card signin-hint"><b>Sign in with Google</b>
    <p class="small">Keep your data in your Google account, the same on your iPhone, Mac and any browser.</p>
    <div class="btn-row"><a class="btn primary" href="#/account">Sign in</a><button class="btn" data-act="signin-hide">Not now</button></div></section>`;
}
// ---------- Week tab ----------
function weekLabel(key) {
  const n = weeksBetween(currentWeekKey(), key);
  if (n === 0) return 'This week';
  if (n === -1) return 'Last week';
  if (n === 1) return 'Next week';
  return n < 0 ? `${-n} weeks ago` : `In ${n} weeks`;
}

function weekTabHtml() {
  const w = getWeek(viewKey);
  const isCurrent = viewKey === currentWeekKey();
  const header = `
    <header class="top">
      ${topBar({
        left: '<button class="icon-btn" data-act="prev" aria-label="Previous week">‹</button>',
        label: 'Routine · ' + weekLabel(viewKey) + (isCurrent ? '' : ' · tap for this week'),
        title: weekRange(viewKey),
        titleAct: `data-act="thisweek" ${isCurrent ? 'disabled' : ''}`,
        right: '<button class="icon-btn" data-act="next" aria-label="Next week">›</button>' + menuBtn,
      })}
      <div class="plan-links"><a href="#/commitments">Edit routines and tasks</a></div>
      ${w ? statsHtml(weekStats(w, { routine: true }), { showPace: isCurrent }) : ''}
    </header>`;
  const hasRecurring = w && Object.values(w.items).some((it) => it.freq !== 'once');
  const startCard = !hasRecurring && !isLiveWeek(viewKey) ? `
    <section class="card empty">
      <p>No record of routines for this week.</p>
      <button class="btn primary" data-act="start-week">Fill it in with current commitments</button>
    </section>` : '';
  if (!w) return header + startCard;

  let grid = '';
  for (const [section, entries] of groupBySection(itemsOf(w, 'daily'))) {
    grid += `<div class="sec">${escapeHtml(section)}</div>`;
    for (const [id, it] of entries) {
      const daysDone = it.ticks.filter((_, i) => dayDone(it, i)).length;
      const hrs = it.ticks.reduce((s, _, i) => s + dayHours(it, i), 0);
      grid += `
        <div class="row ${it.archived ? 'archived' : ''}">
          <a class="name" href="#/c/${id}"><span class="n">${escapeHtml(it.name)}</span>
            <span class="sub">${daysDone}/7 · ${fmtH(hrs)} of ${fmtH(plannedHours(it) * 7)}</span></a>
          ${dayCellsHtml(viewKey, id, it)}
        </div>`;
    }
  }
  const weekly = itemsOf(w, 'weekly');
  const periodic = itemsOf(w, 'periodic');
  const pgrid = periodic.map(([id, it]) => {
    const times = it.ticks.filter(Boolean).length;
    return `
      <div class="row ${it.archived ? 'archived' : ''}">
        <a class="name" href="#/c/${id}"><span class="n">${escapeHtml(it.name)}</span>
          <span class="sub">every ${everyLabel(it.everyDays || 7)} · ${times}× this week${isCurrent ? ` · ${periodicSub(id, it)}` : ''}</span></a>
        ${dayCellsHtml(viewKey, id, it)}
      </div>`;
  }).join('');
  return header + startCard + (grid ? `
    <section class="card daily">
      <div class="card-head"><h2>Daily</h2><span class="hint">Tap to log · hold for minutes</span></div>
      ${dayHeadHtml(viewKey)}${grid}
    </section>` : '') +
    (weekly.length ? `<section class="card weekly"><div class="card-head"><h2>Weekly</h2><span class="hint">± logs progress</span></div>
      ${[...groupBySection(weekly)].map(([s, es]) => `<div class="sec">${escapeHtml(s)}</div>` +
        es.map(([id, it]) => periodRowHtml(viewKey, id, it)).join('')).join('')}</section>` : '') +
    (pgrid ? `<section class="card daily">
      <div class="card-head"><h2>Periodic</h2><span class="hint">Tick the day you did it</span></div>
      ${dayHeadHtml(viewKey)}${pgrid}
    </section>` : '');
}

// ---------- Calendar tab ----------
// A time grid of one-off events (lectures, seminars, meetings). Phones show one day at a time
// with a day strip to switch; wide screens show the whole week (CSS hides the other days on phones).
const HOUR_PX = 52;
let calViewDay = todayISO(); // selected day (phone view)
// Whose calendar the grid shows when a buddy shares theirs: 'me', 'buddy' or 'both' (kept on this device).
let calWho = 'me';
try { const v = localStorage.getItem('calWho'); calWho = v === 'both' ? 'ours' : v && v !== 'buddy' ? v : 'me'; } catch {}

const toMinutes = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const fmtTime = (mins) => `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`;

// Side-by-side columns for overlapping events.
function layoutDay(events) {
  const sorted = [...events].sort((a, b) => a.start - b.start || b.end - a.end);
  let cluster = [], clusterEnd = -1;
  const lanesEnd = [];
  const finish = () => { const n = Math.max(...cluster.map((e) => e.lane)) + 1; cluster.forEach((e) => { e.lanes = n; }); };
  for (const e of sorted) {
    if (cluster.length && e.start >= clusterEnd) { finish(); cluster = []; lanesEnd.length = 0; }
    let lane = lanesEnd.findIndex((end) => end <= e.start);
    if (lane < 0) lane = lanesEnd.length;
    lanesEnd[lane] = e.end;
    e.lane = lane;
    cluster.push(e);
    clusterEnd = Math.max(clusterEnd, e.end);
  }
  if (cluster.length) finish();
  return sorted;
}

function calendarTabHtml() {
  const wk = weekOf(calViewDay);
  const w = getWeek(wk);
  const today = todayISO();
  const days = DAY_NAMES.map((_, i) => isoDate(dayDate(wk, i)));
  const once = w ? itemsOf(w, 'once') : [];

  // A time grid of your one-off tasks and imported events, project meetings, application dates and
  // pinned notes, and (when they share theirs) your buddy's calendar, on its own or together with yours.
  const timed = {}, untimed = {};
  for (const d of days) { timed[d] = []; untimed[d] = []; }
  const people = sharedPeople(wk);
  const who = calWho === 'ours' ? (people.length ? 'ours' : 'me') : people.some((p) => p.id === calWho) ? calWho : 'me';
  const person = people.find((p) => p.id === who);
  for (const b of who === 'me' ? [] : who === 'ours' ? people : [person]) {
    for (const x of b.cal.events) {
      if (!timed[x.d]) continue;
      const label = x.n || 'Busy';
      if (x.s) {
        const start = toMinutes(x.s), end = x.e && toMinutes(x.e) > start ? toMinutes(x.e) : start + 60;
        timed[x.d].push({ buddy: b, label, start, end });
      } else untimed[x.d].push({ buddy: b, label });
    }
  }
  // things that open elsewhere: project meetings and deadlines, application dates, pinned notes
  for (const d of person ? [] : days) {
    for (const x of projectItemsOn(d)) {
      const ext = { href: `#/gallery/${x.p.id}`, label: x.title, color: pcol(x.p)[2] };
      if (x.time) timed[d].push({ ext, start: toMinutes(x.time), end: toMinutes(x.time) + 60 });
      else untimed[d].push({ ext });
    }
    for (const e of appEvents().filter((e) => e.date === d)) untimed[d].push({ ext: { href: `#/apps/${d}`, label: `${e.a.company} ${APP_CHIP_LABEL[e.kind]}`, color: '#b58900' } });
    for (const n of notesOn(d)) {
      const ext = { href: '#/plan', label: n.text.split('\n')[0] || 'Note', color: '#8a8f87' };
      if (n.time && d === n.date) timed[d].push({ ext, start: toMinutes(n.time), end: toMinutes(n.time) + 60 });
      else untimed[d].push({ ext });
    }
  }
  for (const [id, it] of person ? [] : once) {
    if (!timed[it.date]) continue;
    if (it.time) {
      const start = toMinutes(it.time);
      const end = it.endTime && toMinutes(it.endTime) > start ? toMinutes(it.endTime) : start + Math.max(30, Math.round((it.hours || 1) * 60));
      timed[it.date].push({ id, it, start, end });
    } else {
      untimed[it.date].push([id, it]);
    }
  }
  // Show 08:00–20:00 at least, widened to fit the week's events.
  const all = days.flatMap((d) => timed[d]);
  const startHour = Math.min(8, ...all.map((e) => Math.floor(e.start / 60)));
  const endHour = Math.max(20, ...all.map((e) => Math.ceil(e.end / 60)));
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const gridH = hours.length * HOUR_PX;
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const strip = days.map((d, i) => {
    const n = timed[d].length + untimed[d].length;
    return `<button class="cday ${d === calViewDay ? 'sel' : ''} ${d === today ? 'today' : ''}" data-act="cal-day" data-date="${d}">
      <span>${DAY_NAMES[i][0]}</span><b>${parseISO(d).getDate()}</b><i class="${n ? 'dot' : ''}"></i></button>`;
  }).join('');

  const cols = days.map((d) => {
    const evs = layoutDay(timed[d]).map((e) => {
      if (e.buddy) {
        const top = ((e.start - startHour * 60) / 60) * HOUR_PX, height = Math.max(22, ((e.end - e.start) / 60) * HOUR_PX - 2);
        return `<div class="cev buddy ${height < 40 ? 'short' : ''}" role="button" tabindex="0" data-act="buddy-ev" data-who="${escapeHtml(e.buddy.name)}" data-what="${escapeHtml(e.label)}" data-day="${d}" data-s="${e.start}" data-e="${e.end}" title="${escapeHtml(`${e.buddy.name}: ${e.label} · ${fmtTime(e.start)}–${fmtTime(e.end)}`)}"
          style="top:${top}px;height:${height}px;left:calc(${(e.lane / e.lanes) * 100}% + 2px);width:calc(${100 / e.lanes}% - 4px)">
          <div class="cev-body"><b><span class="who">${escapeHtml(e.buddy.name.slice(0, 1).toUpperCase())}</span>${escapeHtml(e.label)}</b></div></div>`;
      }
      if (e.ext) {
        const top = ((e.start - startHour * 60) / 60) * HOUR_PX, height = Math.max(22, ((e.end - e.start) / 60) * HOUR_PX - 2);
        return `<a class="cev ext ${height < 40 ? 'short' : ''}" href="${e.ext.href}" title="${escapeHtml(`${e.ext.label} · ${fmtTime(e.start)}`)}"
          style="--ev:${e.ext.color};top:${top}px;height:${height}px;left:calc(${(e.lane / e.lanes) * 100}% + 2px);width:calc(${100 / e.lanes}% - 4px)"><div class="cev-body"><b>${escapeHtml(e.ext.label)}</b></div></a>`;
      }
      const sched = !!e.it.schedule;
      const done = !sched && periodDone(e.it);
      const top = ((e.start - startHour * 60) / 60) * HOUR_PX;
      const height = Math.max(22, ((e.end - e.start) / 60) * HOUR_PX - 2);
      const where = locationById(e.id);
      const tip = `${e.it.name} · ${fmtTime(e.start)}–${fmtTime(e.end)}${where ? ' · ' + where : ''}`;
      return `<div class="cev ${sched ? 'sched' : ''} ${done ? 'done' : ''} ${height < 40 ? 'short' : ''}" data-open="#/c/${e.id}" title="${escapeHtml(tip)}"
          style="--ev:${eventColor(e.id)};top:${top}px;height:${height}px;left:calc(${(e.lane / e.lanes) * 100}% + 2px);width:calc(${100 / e.lanes}% - 4px)">
        ${sched ? '' : `<button class="cev-chk" data-act="pdone" data-wk="${wk}" data-id="${e.id}" aria-label="${escapeHtml(e.it.name)} done" aria-pressed="${done}">${done ? CHECK : ''}</button>`}
        <div class="cev-body"><b>${escapeHtml(e.it.name)}</b></div>
      </div>`;
    }).join('');
    const nowLine = d === today && nowMin >= startHour * 60 && nowMin <= endHour * 60
      ? `<div class="cnow" style="top:${((nowMin - startHour * 60) / 60) * HOUR_PX}px"></div>` : '';
    return `<div class="ccol ${d === calViewDay ? 'sel' : ''} ${d === today ? 'today' : ''}" style="height:${gridH}px">${evs}${nowLine}</div>`;
  }).join('');

  const hasAllDay = days.some((d) => untimed[d].length);
  const allDay = days.map((d) => `<div class="call ${d === calViewDay ? 'sel' : ''}">
      ${untimed[d].map((x) => { if (x.buddy) return `<div class="cuntimed buddy" role="button" tabindex="0" data-act="buddy-ev" data-who="${escapeHtml(x.buddy.name)}" data-what="${escapeHtml(x.label)}" data-day="${d}" title="${escapeHtml(`${x.buddy.name}: ${x.label}`)}"><span><span class="who">${escapeHtml(x.buddy.name.slice(0, 1).toUpperCase())}</span>${escapeHtml(x.label)}</span></div>`;
        if (x.ext) return `<a class="cuntimed ext" href="${x.ext.href}" style="--ev:${x.ext.color}"><span>${escapeHtml(x.ext.label)}</span></a>`;
        const [id, it] = x; const sched = !!it.schedule; const done = !sched && periodDone(it); return `<div class="cuntimed ${sched ? 'sched' : ''} ${done ? 'done' : ''}" data-open="#/c/${id}" style="--ev:${eventColor(id)}">
        ${sched ? '' : `<button class="cev-chk" data-act="pdone" data-wk="${wk}" data-id="${id}" aria-label="${escapeHtml(it.name)} done">${done ? CHECK : ''}</button>`}
        <span>${escapeHtml(it.name)}</span></div>`; }).join('')}
    </div>`).join('');

  const heads = (cls) => days.map((d, i) => `<button class="chead ${cls} ${d === today ? 'today' : ''} ${d === calViewDay ? 'sel' : ''}" data-act="cal-day" data-date="${d}"><span>${DAY_NAMES[i]}</span><b>${parseISO(d).getDate()}</b></button>`).join('');
  const isThisWeek = wk === currentWeekKey();

  return `
    <header class="top">
      ${topBar({
        left: '<button class="icon-btn" data-act="cal-prev" aria-label="Previous week">‹</button>',
        label: isThisWeek ? 'Calendar' : 'Calendar · tap for this week',
        title: weekRange(wk),
        titleAct: `data-act="cal-today" ${isThisWeek && calViewDay === today ? 'disabled' : ''}`,
        right: '<button class="icon-btn" data-act="cal-next" aria-label="Next week">›</button>' + menuBtn,
      })}
      ${calBarHtml(people, who)}
      <div class="cstrip">${strip}</div>
    </header>
    ${calInvitesHtml()}
    <section class="card cal" data-section="${person ? 'Their calendar' : 'Events'}">
      <div class="card-head"><h2>${person ? `${escapeHtml(person.name)}'s calendar` : who === 'ours' ? 'Our calendars' : 'Events'}</h2>
        <a class="txt-btn" href="#/calendar">Calendars ›</a></div>
      <div class="cgrid-head"><div class="ctimes-gap"></div>${heads('')}</div>
      ${hasAllDay ? `<div class="call-row"><div class="ctimes-gap small muted">all day</div>${allDay}</div>` : ''}
      <div class="cgrid">
        <div class="ctimes">${hours.map((h) => `<div style="height:${HOUR_PX}px">${pad(h)}:00</div>`).join('')}</div>
        <div class="ccols" style="height:${gridH}px;background-size:100% ${HOUR_PX}px">${cols}</div>
      </div>
      ${all.length || hasAllDay ? '' : '<p class="muted small pad center">Nothing on the calendar this week.</p>'}
      ${state.calendars.feeds.length ? '' : '<p class="muted small pad center"><a href="#/calendar">Connect your timetable or another calendar</a></p>'}
    </section>`;
}

// ---------- Applications (from Notion) ----------
// /api/apps reads your Notion tracker (see server/apps.mjs). The list is cached on this
// device and refreshed every 30 minutes while the app is open, or with the refresh button.
const APPS_REFRESH_MS = 30 * 60e3;
let appsLoading = false;
let appsMonth = todayISO().slice(0, 7); // month shown in the Applications calendar (YYYY-MM)
let appsDay = null;                     // day picked in that calendar
const APPS_PREVIEW = 6;                 // roles shown per section before "Show all"
const appsExpanded = new Set();         // sections showing everything (and folds left open)

const APP_INACTIVE = /^(not applicable|rejected|withdrawn|n\/a)$/i;
const APP_IN_PROGRESS = /submitted|applied|online test|video|interview|assessment|final|\bot\b|\bvi\b/i;
// done · open · upcoming · unknown (no opening date yet) · closed · inprogress · offer · inactive
function appPhase(a, today = todayISO()) {
  const s = a.status || '';
  if (a.done) return 'done';
  if (APP_INACTIVE.test(s)) return 'inactive';
  if (/offer/i.test(s)) return 'offer';
  if (APP_IN_PROGRESS.test(s)) return 'inprogress';
  if (a.close && a.close < today) return 'closed';
  if (!a.open) return 'unknown'; // only roles that have actually opened count as open
  if (a.open > today) return 'upcoming';
  return 'open';
}
const daysUntil = (iso) => Math.round((parseISO(iso) - startOfToday()) / 864e5);
function relDay(iso) {
  const n = daysUntil(iso);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}
const fmtDayShort = (iso) => fmtDay(parseISO(iso), { day: 'numeric', month: 'short' });

// Dated events for calendars: openings and deadlines you still care about.
function appEvents() {
  const out = [];
  for (const a of state.apps.items) {
    const phase = appPhase(a);
    if (phase === 'inactive' || phase === 'offer') continue;
    if (a.open && (phase === 'open' || phase === 'upcoming')) out.push({ date: a.open, kind: 'open', a });
    if (a.close && ['open', 'upcoming', 'unknown', 'closed'].includes(phase)) out.push({ date: a.close, kind: 'close', a });
    // A follow-up task on that day already shows it, so skip the extra "next step" chip.
    if (a.next && phase === 'inprogress' && !followupsFor(a.id).some((c) => c.date === a.next)) out.push({ date: a.next, kind: 'next', a });
    if (a.assess && a.assess >= todayISO()) out.push({ date: a.assess, kind: 'assess', a }); // online test / video interview deadline from your email
  }
  return out;
}
const APP_EVENT_LABEL = { open: 'opens', close: 'closes', next: 'next step due', assess: 'assessment due' };
const APP_CHIP_LABEL = { open: 'opens', close: 'closes', next: 'due', assess: 'assessment' };

async function refreshApps({ force = false } = {}) {
  if (!state || !state.sync.enabled || appsLoading) return;
  if (!force && state.apps.fetchedAt && Date.now() - new Date(state.apps.fetchedAt) < APPS_REFRESH_MS && !state.apps.error) return;
  appsLoading = true;
  if (route.tab === 'apps') render();
  try {
    const res = await fetch('/api/apps', { headers: { authorization: `Bearer ${state.sync.key}` } });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      state.apps = { items: Array.isArray(body.apps) ? body.apps : [], fetchedAt: body.fetchedAt || new Date().toISOString(), error: null, setup: false };
    } else {
      state.apps.error = body.error || `Couldn’t load applications (${res.status})`;
      state.apps.setup = !!body.setup;
      if (body.notOwner) { state.apps.items = []; state.apps.fetchedAt = null; }
    }
  } catch {
    state.apps.error = 'Offline. Showing the last copy from Notion.';
  } finally {
    appsLoading = false;
    writeState().catch(() => {});
    scheduleOutbound();
    if (!formOpen() && !sheetCtx && ['apps', 'cal', 'today'].includes(route.tab) && !route.id && !route.page) render();
  }
}

const appTodayBtn = (a) => (todayTaskFor(a.id)
  ? `<button class="mini-btn done-on" data-act="app-today" data-id="${a.id}" aria-pressed="true" title="Tap again to remove from today">✓ On today</button>`
  : `<button class="mini-btn" data-act="app-today" data-id="${a.id}" aria-pressed="false">+ Today</button>`);
// Everything else you can do with an application.
function openAppMore(id) {
  const a = state.apps.items.find((x) => x.id === id);
  if (!a) return;
  const notion = a.notionUrl ? notionAppUrl(a.notionUrl) : '';
  openSheet(`<div class="sheet-head"><h3>${escapeHtml(a.company)}</h3><p class="muted">${escapeHtml(a.programme || '')}</p></div>
    <div class="menu">
      ${a.done ? '' : appPhase(a) === 'inprogress' ? appTodayBtn(a) : `<button class="btn" data-act="app-followup" data-id="${a.id}">Add a follow-up</button>`}
      <button class="btn" data-act="app-done" data-id="${a.id}">${a.done ? 'Not done after all' : 'Mark as done'}</button>
      ${notion ? `<a class="btn" href="${escapeHtml(notion)}" target="_blank" rel="noopener">Open in Notion</a>` : ''}
      <button class="btn" data-act="close">Close</button></div>`);
}
function appRowHtml(a) {
  const phase = appPhase(a);
  const dates = [
    a.open ? `${a.open > todayISO() ? 'Opens' : 'Opened'} ${fmtDayShort(a.open)}` : '',
    a.close ? `${a.close >= todayISO() ? 'Closes' : 'Closed'} ${fmtDayShort(a.close)}${a.close >= todayISO() ? ` (${relDay(a.close)})` : ''}` : '',
    a.next && phase === 'inprogress' ? `Next step ${fmtDayShort(a.next)} (${relDay(a.next)})` : '',
  ].filter(Boolean).join(' · ');
  const assessOn = a.assess && a.assess >= todayISO();
  const assessLine = a.assess ? `<div class="aassess ${assessOn && daysUntil(a.assess) <= 3 ? 'soon' : ''} ${assessOn ? '' : 'past'}">📝 Assessment ${assessOn ? 'due' : 'was due'} ${fmtDayShort(a.assess)}${a.assessTime ? ` ${escapeHtml(a.assessTime)}` : ''}${assessOn ? ` (${relDay(a.assess)})` : ''}${a.assessUrl && cleanUrl(a.assessUrl) ? ` · <a href="${escapeHtml(cleanUrl(a.assessUrl))}" target="_blank" rel="noopener">Open ↗</a>` : ''}</div>` : '';
  const urgent = a.close && phase === 'open' && daysUntil(a.close) <= 7 && daysUntil(a.close) >= 0;
  const mats = a.materials || [];
  const ticked = new Set(a.materialsDone || []);
  const followChips = followupsFor(a.id).map((c) => `<span class="fchip-wrap"><a class="fchip ${onceDone(c) ? 'on' : ''}" href="#/c/${c.id}">
    ${onceDone(c) ? '✓ ' : ''}${escapeHtml(c.stage)} · ${c.date ? fmtDayShort(c.date) : 'TBC'}</a>${c.stageUrl
    ? `<a class="fchip go" href="${escapeHtml(c.stageUrl)}" target="_blank" rel="noopener" title="Open ${escapeHtml(c.stage)} link">↗</a>` : ''}</span>`).join('');
  const checklist = mats.length ? `<div class="achecklist">
      ${mats.map((m) => `<button class="mchk ${ticked.has(m) ? 'on' : ''}" data-act="app-mat" data-id="${a.id}" data-m="${escapeHtml(m)}" aria-pressed="${ticked.has(m)}">
        <span class="mbox">${ticked.has(m) ? CHECK : ''}</span>${escapeHtml(m)}</button>`).join('')}
      <span class="mprog">${mats.filter((m) => ticked.has(m)).length}/${mats.length}</span>${followChips}</div>` : (followChips ? `<div class="achecklist">${followChips}</div>` : '');
  return `
    <div class="arow2 ${urgent ? 'urgent' : ''} ${a.done ? 'is-done' : ''}">
      <div class="ctext">
        <div class="n">${escapeHtml(a.company)}</div>
        ${a.programme ? `<div class="sub">${escapeHtml(a.programme)}</div>` : ''}
        <div class="achips">
          ${a.status ? `<span class="achip st-${phase}">${escapeHtml(a.status)}</span>` : ''}
          ${/^yes$/i.test(a.rolling) && (phase === 'open' || phase === 'upcoming') ? '<span class="achip rolling">Rolling · apply early</span>' : ''}
          ${a.sector ? `<span class="achip">${escapeHtml(a.sector)}</span>` : ''}
        </div>
        ${dates ? `<div class="adates">${dates}</div>` : ''}
        ${assessLine}
        ${checklist}
      </div>
      <div class="abtns">
        ${a.url ? `<a class="mini-btn primary-mini" href="${escapeHtml(cleanUrl(a.url))}" target="_blank" rel="noopener">Apply ↗</a>` : ''}
        ${a.done ? `<button class="mini-btn done-on" data-act="app-done" data-id="${a.id}" aria-pressed="true">✓ Done</button>`
          : phase === 'inprogress' ? `<button class="mini-btn" data-act="app-followup" data-id="${a.id}">+ Follow-up</button>`
            : appTodayBtn(a)}
        <button class="mini-btn" data-act="app-more" data-id="${a.id}" aria-label="More for ${escapeHtml(a.company)}">⋯</button>
      </div>
    </div>`;
}

function appsMonthHtml(events) {
  const [y, m] = appsMonth.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const startPad = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(y, m, 0).getDate();
  const byDay = {};
  for (const e of events) (byDay[e.date] = byDay[e.date] || []).push(e);
  const today = todayISO();
  let cells = '';
  for (let i = 0; i < startPad; i++) cells += '<span class="mday blank"></span>';
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${y}-${pad(m)}-${pad(d)}`;
    const evs = byDay[iso] || [];
    const dots = ['open', 'close', 'next', 'assess'].filter((k) => evs.some((e) => e.kind === k)).map((k) => `<i class="dot-${k}"></i>`).join('');
    cells += `<button class="mday ${iso === today ? 'today' : ''} ${iso === appsDay ? 'sel' : ''} ${evs.length ? 'has' : ''}" data-act="apps-day" data-date="${iso}">
      <b>${d}</b><span class="mdots">${dots}</span></button>`;
  }
  const title = first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const dayList = appsDay ? (byDay[appsDay] || []) : null;
  return `
    <section class="card" data-section="Calendar">
      <div class="mhead">
        <button class="icon-btn" data-act="apps-month" data-dir="-1" aria-label="Previous month">‹</button>
        <b>${title}</b>
        <button class="icon-btn" data-act="apps-month" data-dir="1" aria-label="Next month">›</button>
      </div>
      <div class="mgrid">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((x) => `<span class="mdow">${x}</span>`).join('')}${cells}</div>
      <div class="mlegend"><span><i class="dot-open"></i>Opens</span><span><i class="dot-close"></i>Deadline</span><span><i class="dot-next"></i>Next step</span><span><i class="dot-assess"></i>Assessment</span></div>
      ${dayList ? `<div class="mdaylist"><div class="sec">${fmtDay(parseISO(appsDay), { weekday: 'long', day: 'numeric', month: 'long' })}</div>
        ${dayList.length ? dayList.map((e) => appRowHtml(e.a)).join('') : '<p class="muted small pad">Nothing on this day.</p>'}</div>` : ''}
    </section>`;
}

function appsSetupHtml() {
  return `
    <section class="card howto">
      <div class="card-head"><h2>Connect your Notion tracker</h2></div>
      <p class="small pad">One-time setup (about 3 minutes). The connection is <b>read-only</b>: the app can see your tracker but never change it.</p>
      <ol>
        <li>Open <b>notion.so/profile/integrations</b> → <b>New integration</b>. Name it <b>Commitments</b>, type <b>Internal</b>, pick your workspace → <b>Save</b>.</li>
        <li>Under <b>Capabilities</b>, keep only <b>Read content</b> (untick Update and Insert) → Save. Copy the <b>Internal Integration Secret</b>.</li>
        <li>In Notion, open your applications database → <b>•••</b> (top right) → <b>Connections</b> → add <b>Commitments</b>. Copy the database link too.</li>
        <li>On the computer you deploy from, run <b>npx wrangler secret put NOTION_TOKEN</b> (paste the secret) and <b>npx wrangler secret put NOTION_APPS_DATABASE</b> (paste the database link or ID).</li>
      </ol>
    </section>`;
}

function appsTabHtml() {
  const A = state.apps;
  const today = todayISO();
  const header = `
    <header class="top">
      ${topBar({
        left: '<span class="icon-spacer"></span>',
        label: appsLoading ? 'Updating from Notion…' : A.fetchedAt ? `From Notion · updated ${ago(A.fetchedAt)}` : 'From Notion',
        title: 'Applications',
        right: '<button class="icon-btn" data-act="apps-refresh" aria-label="Refresh from Notion">↻</button>' + menuBtn,
      })}
    </header>`;
  if (!state.sync.enabled) {
    return header + `<section class="card empty"><p>Applications come from your Notion tracker and need sync turned on, so only your devices can read them.</p>
      <a class="btn primary" href="#/sync">Set up sync</a></section>`;
  }
  const items = A.items;
  const warn = A.error && !A.setup ? `<p class="small pad err">⚠️ ${escapeHtml(A.error)}</p>` : '';
  if (!items.length) return header + (A.setup ? appsSetupHtml() : '') + (warn ? `<section class="card">${warn}</section>` : '') +
    (!A.setup && !A.error && !appsLoading ? '<section class="card empty"><p>No applications found in Notion yet.</p></section>' : '');

  const withPhase = items.map((a) => ({ a, phase: appPhase(a, today) }));
  const by = (key) => (x, y) => (x.a[key] || '9999').localeCompare(y.a[key] || '9999');
  const closingSoon = withPhase.filter((x) => x.phase === 'open' && x.a.close && daysUntil(x.a.close) <= 14).sort(by('close'));
  const openNow = withPhase.filter((x) => x.phase === 'open' && !closingSoon.includes(x)).sort(by('close'));
  const upcoming = withPhase.filter((x) => x.phase === 'upcoming').sort(by('open'));
  const progress = withPhase.filter((x) => x.phase === 'inprogress' || x.phase === 'offer').sort(by('next'));
  const rest = withPhase.filter((x) => x.phase === 'closed' || x.phase === 'inactive');
  const finished = withPhase.filter((x) => x.phase === 'done');
  const unknown = withPhase.filter((x) => x.phase === 'unknown').sort(by('close'));
  const grid = (key, list) => {
    const all = appsExpanded.has(key) || list.length <= APPS_PREVIEW;
    return `<div class="apps-grid">${(all ? list : list.slice(0, APPS_PREVIEW)).map((x) => appRowHtml(x.a)).join('')}</div>
      ${list.length > APPS_PREVIEW ? `<button class="txt-btn show-all" data-act="apps-more" data-key="${key}">${all ? 'Show less' : `Show all (${list.length})`}</button>` : ''}`;
  };
  const section = (title, list, hint = '') => (list.length ? `<section class="card apps-list"><div class="card-head"><h2>${title}</h2><span class="hint">${hint || list.length}</span></div>
    ${grid(title, list)}</section>` : '');
  const fold = (title, list) => (list.length ? `<details class="card fold apps-list" ${appsExpanded.has(`open:${title}`) ? 'open' : ''} data-fold="${title}">
    <summary>${title} (${list.length})</summary>${grid(title, list)}</details>` : '');
  return header + (warn ? `<section class="card">${warn}</section>` : '') +
    appsMonthHtml(appEvents()) +
    section('Closing soon', closingSoon, 'next 2 weeks') +
    section('In progress', progress) +
    section('Open now', openNow) +
    section('Opening soon', upcoming) +
    fold('No opening date yet', unknown) + fold('Done', finished) + fold('Closed or not applying', rest);
}

// ---------- Application follow-ups (OT, HV, interviews…) ----------
// A follow-up is a one-off task in the Applications section, linked to its application (appRef)
// and tagged with a stage. It can also set the role's Next ddl and status in Notion.
const FOLLOWUP_STAGES = [
  // [abbreviation, name, planned hours, matching Notion status]
  ['OT', 'Online test', 1, 'Online test'],
  ['HV', 'HireVue', 0.5, 'Video interview'],
  ['VI', 'Video interview', 0.5, 'Video interview'],
  ['PI', 'Phone interview', 0.5, ''],
  ['IT', 'Interview', 1, ''],
  ['AC', 'Assessment centre', 4, ''],
  ['SD', 'Superday', 4, ''],
  ['GA', 'Game-based assessment', 0.5, 'Online test'],
  ['SJT', 'Situational judgement test', 0.5, 'Online test'],
  ['Other', 'Other', 1, ''],
];
const stageInfo = (abbr) => FOLLOWUP_STAGES.find((x) => x[0] === abbr) || ['Other', abbr, 1, ''];
const followupsFor = (appId) => state.commitments.filter((c) => c.appRef === appId && c.stage && !c.archived)
  .sort((x, y) => onceSortKey(x).localeCompare(onceSortKey(y)));
function onceDone(c) {
  const it = c.date && state.weeks[weekOf(c.date)] && state.weeks[weekOf(c.date)].items[c.id];
  return !!(it && periodDone(it));
}

function openFollowupSheet(appId) {
  const a = state.apps.items.find((x) => x.id === appId);
  if (!a) return;
  openSheet(`
    <div class="sheet-head"><h3>Follow-up · ${escapeHtml(a.company)}</h3>
      <p class="muted">${escapeHtml(a.programme || '')}</p></div>
    <form class="form flat" data-form="followup" data-app="${a.id}" data-tbc="false" data-freq="once">
      <div class="stage-grid">${FOLLOWUP_STAGES.map(([ab, name], i) => `<label class="stage"><input type="radio" name="stage" value="${ab}" ${i === 0 ? 'checked' : ''}>
        <span><b>${ab === 'Other' ? '…' : ab}</b><small>${name}</small></span></label>`).join('')}</div>
      <label class="f stage-other" hidden>Label<input name="label" placeholder="e.g. Case study"></label>
      <label class="toggle-row only-once"><input type="checkbox" name="tbc"><span>Date to be confirmed</span></label>
      <div class="f2 tbc-hide">
        <label class="f">Due / date<input type="date" name="date" value="${todayISO()}"></label>
        <label class="f">Time (optional)<input type="time" name="time"></label>
      </div>
      <label class="f">Test / interview link (optional)<input name="url" inputmode="url" autocapitalize="off" autocorrect="off" placeholder="HireVue invite, test portal, Zoom…"></label>
      <label class="toggle-row"><input type="checkbox" name="notion" checked>
        <span>Update Notion<small>Set Next ddl to this date, and the status where it matches (e.g. HV → Video interview).</small></span></label>
      <button class="btn primary" type="submit">Add follow-up</button>
    </form>`, { followup: appId });
}

function saveFollowup(form) {
  const f = new FormData(form);
  const a = state.apps.items.find((x) => x.id === form.dataset.app);
  if (!a) return;
  const [abbr, stageName, hours, notionStatus] = stageInfo(f.get('stage'));
  const label = abbr === 'Other' ? (String(f.get('label') || '').trim() || 'Follow-up') : abbr;
  const tbc = f.get('tbc') === 'on';
  const date = tbc ? null : (f.get('date') || todayISO());
  state.commitments.push(newCommitment({
    name: `${a.company} · ${label}`, section: 'Applications', freq: 'once', kind: 'task',
    date, tbc, time: tbc ? null : validTime(f.get('time')), hours,
    notes: [`${abbr === 'Other' ? label : stageName} for ${a.company}${a.programme ? ` – ${a.programme}` : ''}`,
      a.close ? `Application closes ${fmtDayShort(a.close)}` : ''].filter(Boolean).join('\n'),
    notionUrl: cleanUrl(a.notionUrl), links: a.url && cleanUrl(a.url) ? [{ label: 'Application', url: cleanUrl(a.url) }] : [],
    appRef: a.id, stage: label, stageUrl: cleanUrl(f.get('url')), order: nextOrder(),
  }));
  save();
  closeSheet();
  if (f.get('notion') === 'on') {
    const change = {};
    if (date) change.next = date;
    if (notionStatus && notionStatus !== a.status) change.status = notionStatus;
    if (Object.keys(change).length) updateApp(a.id, change);
  }
  render();
  toast(`Added ${a.company} · ${label}${date ? ` for ${fmtDayShort(date)}` : ' (date TBC)'}`);
}

// "+ Today": a one-off task for today that links back to the application.
const todayTaskFor = (appId) => state.commitments.find((c) => c.appRef === appId && c.freq === 'once' && c.date === todayISO() && !c.archived);
// Tapping "+ Today" again (now "✓ On today") takes the task off today.
function toggleAppToday(appId) {
  const task = todayTaskFor(appId);
  if (!task) return addAppToToday(appId);
  const it = state.weeks[weekOf(task.date)] && state.weeks[weekOf(task.date)].items[task.id];
  if (it && hasData(it) && !confirm(`“${task.name}” is already ticked off today. Remove it anyway?`)) return;
  removeCommitment(task.id);
  save();
  render();
  toast(`Removed “${task.name}” from today`);
}
function addAppToToday(appId) {
  const a = state.apps.items.find((x) => x.id === appId);
  if (!a || todayTaskFor(appId)) return;
  const left = (a.materials || []).filter((m) => !(a.materialsDone || []).includes(m));
  const notes = [a.programme, left.length ? `Still to do: ${left.join(', ')}` : '', a.close ? `Closes ${fmtDayShort(a.close)} (${relDay(a.close)})` : '']
    .filter(Boolean).join('\n');
  state.commitments.push(newCommitment({
    name: `Apply: ${a.company}`, section: 'Applications', freq: 'once', kind: 'task', date: todayISO(), hours: 1,
    notes, notionUrl: cleanUrl(a.notionUrl), links: a.url && cleanUrl(a.url) ? [{ label: 'Apply', url: cleanUrl(a.url) }] : [],
    appRef: appId, order: nextOrder(),
  }));
  save();
  render();
  toast(`Added “Apply: ${a.company}” to today`);
}

// Ticking Done or a material writes to Notion. The screen updates straight away and goes back if
// Notion refuses. Changes to one application are sent one after another so they arrive in order.
const appQueues = {};
function updateApp(id, change) {
  const a = state.apps.items.find((x) => x.id === id);
  if (!a) return;
  const before = { done: !!a.done, materialsDone: [...(a.materialsDone || [])] };
  Object.assign(a, change);
  render();
  const send = async () => {
    try {
      const res = await fetch('/api/apps', {
        method: 'POST',
        headers: { authorization: `Bearer ${state.sync.key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ id, ...change }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Couldn’t update Notion (${res.status})`);
      writeState().catch(() => {});
    } catch (e) {
      Object.assign(a, before);
      toast(e.message === 'Failed to fetch' ? 'Offline. Couldn’t update Notion.' : e.message);
      if (route.tab === 'apps' || route.tab === 'today') render();
    }
  };
  appQueues[id] = (appQueues[id] || Promise.resolve()).then(send);
}


// ---------- Commitments tab ----------
function sortedCommitments(freq, archived = false) {
  return state.commitments.filter((c) => c.freq === freq && !!c.archived === archived)
    .sort((a, b) => (freq === 'once' ? onceSortKey(a).localeCompare(onceSortKey(b)) : 0) || a.order - b.order);
}
// Orders only need to be distinct, not consecutive. Only missing or duplicate orders are repaired, so
// adding or deleting one commitment doesn't change every other one (which sync would treat as edits).
const nextOrder = () => state.commitments.reduce((m, c) => (Number.isFinite(c.order) ? Math.max(m, c.order) : m), -1) + 1;
function renumber() {
  const seen = new Set();
  for (const c of [...state.commitments].sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity))) {
    if (!Number.isFinite(c.order) || seen.has(c.order)) c.order = nextOrder();
    seen.add(c.order);
  }
}
function sectionNames() {
  return [...new Set(state.commitments.filter((c) => !c.archived).map((c) => c.section))];
}
function metaLine(c) {
  const parts = [c.kind === 'counter' ? 'Counter' : 'Task', targetLabel(c)];
  if (c.freq === 'once' && c.date) parts.unshift(...[fmtShort(c.date), timeRange(c)].filter(Boolean));
  if (c.freq === 'once' && !c.date) parts.unshift('Date TBC');
  if (c.freq === 'periodic' && !c.archived) parts.push(periodicSub(c.id, c));
  if (c.source) parts.push('📅');
  return parts.join(' · ');
}

function commitmentsTabHtml() {
  const row = (c, i, list) => reorderMode && c.freq !== 'once'
    ? `<div class="crow" data-cid="${c.id}"><div class="ctext"><div class="n">${escapeHtml(c.name)}</div><div class="sub">${escapeHtml(c.section)}</div></div>
        <span class="reorder"><button class="mini-btn" data-act="up" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
        <button class="mini-btn" data-act="down" ${i === list.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button></span></div>`
    : `<a class="crow" href="#/c/${c.id}"><div class="ctext"><div class="n">${escapeHtml(c.name)}</div>
        <div class="sub">${metaLine(c)}${c.notionUrl || c.links.length ? ' · 🔗' : ''}</div></div><span class="chev">›</span></a>`;
  const block = (freq, title, list) => {
    let body = '';
    if (freq === 'once') body = list.map((c, i) => row(c, i, list)).join('');
    else for (const [s, cs] of groupBySection(list, (c) => c.section)) body += `<div class="sec">${escapeHtml(s)}</div>` + cs.map((c) => row(c, list.indexOf(c), list)).join('');
    return `<section class="card">
      <div class="card-head"><h2>${title}</h2><a class="txt-btn" href="#/new/${freq}">+ Add</a></div>
      ${body || '<p class="muted pad small">None yet.</p>'}</section>`;
  };
  const today = todayISO();
  const once = sortedCommitments('once').filter((c) => !c.schedule && !c.appRef);
  const tbcList = once.filter((c) => !c.date);
  const upcoming = [...tbcList, ...once.filter((c) => c.date && c.date >= today)];
  const past = once.filter((c) => c.date && c.date < today).reverse();
  const archived = state.commitments.filter((c) => c.archived);
  return `
    <header class="top">
      ${topBar({ left: '<a class="icon-btn" href="#/routine" aria-label="Back to Routine">‹</a>', label: `${state.commitments.filter((c) => !c.archived).length} active`, title: 'Edit', right: `<button class="txt-btn" data-act="reorder">${reorderMode ? 'Done' : 'Reorder'}</button>` })}
    </header>
    ${reviewBannerHtml()}
    ${block('daily', 'Daily', sortedCommitments('daily'))}
    ${block('weekly', 'Weekly', sortedCommitments('weekly'))}
    ${block('periodic', 'Periodic', sortedCommitments('periodic'))}
    ${block('once', 'One-off', upcoming)}
    ${applicationsCardHtml()}
    ${calendarsCardHtml()}
    ${past.length ? `<details class="card fold"><summary>Past one-offs (${past.length})</summary>${past.map((c) => row(c, 0, [c])).join('')}</details>` : ''}
    ${archived.length ? `<details class="card fold"><summary>Archived (${archived.length})</summary>
      ${archived.map((c) => `<div class="crow" data-cid="${c.id}"><div class="ctext"><div class="n">${escapeHtml(c.name)}</div>
        <div class="sub">${FREQ_LABEL[c.freq]} · ${metaLine(c)}</div></div><button class="mini-btn" data-act="restore">Restore</button></div>`).join('')}
    </details>` : ''}`;
}

function moveCommitment(id, dir) {
  const c = state.commitments.find((x) => x.id === id);
  const list = sortedCommitments(c.freq);
  const i = list.indexOf(c), j = i + dir;
  if (j < 0 || j >= list.length) return;
  [list[i].order, list[j].order] = [list[j].order, list[i].order];
  renumber();
}

// ---------- Shared helpers ----------
const clip = (t, n) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
const routineChoices = () => state.commitments.filter((c) => !c.archived && c.freq !== 'once').sort((a, b) => a.order - b.order);
const routineSelect = (name, cur, empty = 'None') => `<select name="${name}"><option value="">${empty}</option>${routineChoices()
  .map((c) => `<option value="${c.id}" ${c.id === cur ? 'selected' : ''}>${escapeHtml(c.name)} · ${FREQ_LABEL[c.freq]}</option>`).join('')}</select>`;
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied'); }
  catch { window.prompt('Copy this:', text); }
}

// ---------- Work Buddy (on Supabase) ----------
// A pact is a small group (usually two people) doing the same routine. Each of you ticks your own
// day, optionally with a note; the streak grows only on days everyone finished. You invite a buddy
// by their Gmail; they accept after signing in with Google. You can each share your calendar.
// Everything lives in the Supabase database (supabase/schema.sql), whose rules decide who sees
// what; changes arrive live. state.buddy only keeps this device's preference for auto-ticking.
const BUDDY_POLL_MS = 2 * 60e3;
let sb = null, sbUser = null, myProfile = null, sbLastError = '';
let buddyView = null, buddyError = null, buddyBusy = false, buddyAutoDate = null;
let myInvites = [];
let calPeople = []; // calendar_people(): link_id, user_id, name, email, accepted, incoming, my_level, their_level
const typing = () => { const a = document.activeElement; return a && $app.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName); };
const rerenderBuddy = () => { if (['buddy', 'today', 'cal', 'plan', 'home'].includes(route.tab) && !route.id && !typing() && !wDrag) render(); };

// The Supabase client, made once the server has said where the database is.
async function getSb() {
  if (sb) return sb;
  const cfg = await loadLoginConfig();
  if (!cfg || !cfg.supabase || !window.supabase) return null;
  sb = window.supabase.createClient(cfg.supabase.url, cfg.supabase.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  sb.auth.onAuthStateChange((event, session) => {
    const before = sbUser && sbUser.id;
    sbUser = session ? session.user : null;
    if ((sbUser && sbUser.id) !== before) setTimeout(refreshBuddy, 0);
  });
  return sb;
}
// Google's sign-in token (from Continue with Google) signs you in to Supabase as well.
async function sbSignIn(idToken) {
  const db = await getSb();
  if (!db) { sbLastError = 'Couldn’t reach the Work Buddy database (no settings from the server).'; return false; }
  if (!idToken) { sbLastError = 'Google didn’t hand over a sign-in token. Try again.'; return false; }
  const { data, error } = await db.auth.signInWithIdToken({ provider: 'google', token: idToken });
  if (error) { sbLastError = error.message || String(error); toast(`Work Buddy sign-in: ${sbLastError}`); return false; }
  sbLastError = '';
  sbUser = data.user;
  return true;
}
async function sbSignOut() {
  if (sb) { try { await sb.auth.signOut(); } catch { /* offline */ } }
  sbUser = null; myProfile = null; buddyView = null; myInvites = []; calPeople = []; sharedCache.clear(); unsubscribeBuddy();
  projects = null; projectsError = null; projBoards.clear(); acadReset();
}
const sbErr = (error) => (error && error.message ? error.message.replace(/^.*?exception:\s*/i, '') : 'Something went wrong.');

// Loads your profile, invites and pact (with members and the last 120 days of ticks).
async function refreshBuddy() {
  const db = await getSb();
  if (!db) return;
  if (!sbUser) { const { data } = await db.auth.getSession(); sbUser = data.session ? data.session.user : null; }
  if (!sbUser) { buddyView = null; myInvites = []; myProfile = null; rerenderBuddy(); return; }
  try {
    const [prof, inv, mem, people] = await Promise.all([
      db.from('profiles').select('*').eq('id', sbUser.id).maybeSingle(),
      db.rpc('my_invites'),
      db.from('pact_members').select('pact_id, joined_at').eq('user_id', sbUser.id).order('joined_at'),
      db.rpc('calendar_people'),
    ]);
    if (prof.error || inv.error || mem.error) throw prof.error || inv.error || mem.error;
    myProfile = prof.data;
    calPeople = people.error ? [] : people.data || [];
    refreshCalSheet();
    myInvites = (inv.data || []).map((x) => ({ pactId: x.pact_id, name: x.pact_name, from: x.from_names || [] }));
    const pactId = mem.data[0] && mem.data[0].pact_id;
    if (!pactId) { buddyView = null; unsubscribeBuddy(); subscribeInvites(); }
    else {
      const [pact, members, days, invites] = await Promise.all([
        db.from('pacts').select('*').eq('id', pactId).single(),
        db.from('pact_members').select('user_id, joined_at, profiles(name, email, share_calendar)').eq('pact_id', pactId).order('joined_at'),
        db.from('pact_days').select('user_id, day, note, done_at').eq('pact_id', pactId).gte('day', [TREE_EPOCH, addDaysISO(todayISO(), -120)].sort()[0]).order('day', { ascending: false }),
        db.from('pact_invites').select('email').eq('pact_id', pactId).order('created_at'),
      ]);
      const err = pact.error || members.error || days.error || invites.error;
      if (err) throw err;
      buddyView = {
        id: pactId, name: pact.data.name, invited: invites.data.map((i) => i.email),
        members: members.data.map((m) => ({
          id: m.user_id, me: m.user_id === sbUser.id, joined: m.joined_at ? isoDate(new Date(m.joined_at)) : '', name: (m.profiles && m.profiles.name) || 'Buddy', email: m.profiles && m.profiles.email,
          share: (m.profiles && m.profiles.share_calendar) || 'off',
          days: Object.fromEntries(days.data.filter((d) => d.user_id === m.user_id).map((d) => [d.day, { d: 1, n: d.note, at: d.done_at }])),
        })),
      };
      await loadPactTasks(buddyView);
      subscribeBuddy(pactId, !!buddyView.tasks);
    }
    buddyError = null;
    if (projects === null) loadProjects();
    puzLoadCloud();
    acadEnsure();
    buddyAutoTick();
    treeSyncDay();
    scheduleShare(500);
  } catch (e) { buddyError = sbErr(e); }
  rerenderBuddy();
}
// Live updates: a buddy's tick, someone joining or a new invite shows up straight away.
let rtChannel = null, rtKey = null, refreshTimer = null;
const refreshSoon = () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(refreshBuddy, 400); };
function subscribeBuddy(pactId, withTasks) {
  const key = `${pactId}${withTasks ? ':tasks' : ''}`;
  if (rtKey === key || !sb) return;
  unsubscribeBuddy();
  rtKey = key;
  const f = `pact_id=eq.${pactId}`;
  rtChannel = sb.channel(`pact-${pactId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pact_days', filter: f }, refreshSoon)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pact_members', filter: f }, refreshSoon)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pact_invites' }, refreshSoon)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' }, () => { sharedCache.clear(); refreshSoon(); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'calendar_links' }, () => { sharedCache.clear(); refreshSoon(); });
  if (withTasks) for (const table of ['pact_tasks', 'pact_task_ticks']) rtChannel.on('postgres_changes', { event: '*', schema: 'public', table, filter: f }, refreshSoon);
  rtChannel.subscribe();
}
function subscribeInvites() {
  if (rtKey === 'invites' || !sb) return;
  unsubscribeBuddy();
  rtKey = 'invites';
  rtChannel = sb.channel('my-invites').on('postgres_changes', { event: '*', schema: 'public', table: 'pact_invites' }, refreshSoon)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'calendar_links' }, () => { sharedCache.clear(); refreshSoon(); }).subscribe();
}
function unsubscribeBuddy() {
  if (rtChannel && sb) sb.removeChannel(rtChannel);
  rtChannel = null; rtKey = null;
}

// ---- actions
async function createPact(form) {
  const f = new FormData(form);
  const email = String(f.get('email') || '').trim();
  const { data: pactId, error } = await sb.rpc('create_pact', { pact_name: String(f.get('name') || '') });
  if (error) { toast(sbErr(error)); return; }
  state.buddy = { commitmentId: f.get('routine') || null };
  save();
  if (email) await inviteByEmail(email, pactId); else toast('Pact started. Invite your buddy by Gmail below.');
  await refreshBuddy();
}
async function inviteByEmail(email, pactId = buddyView && buddyView.id) {
  email = String(email || '').trim().toLowerCase();
  if (!email || !pactId) return;
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(email)) { toast('That doesn’t look like an email address.'); return; }
  const { error } = await sb.from('pact_invites').insert({ pact_id: pactId, email });
  if (error && error.code !== '23505') { toast(sbErr(error)); return; }
  toast(`Invited ${email}. They'll see it when they sign in with Google.`);
  refreshBuddy();
}
async function takeBackInvite(email) {
  const { error } = await sb.from('pact_invites').delete().eq('pact_id', buddyView.id).eq('email', email);
  if (error) toast(sbErr(error));
  refreshBuddy();
}
async function acceptInvite(pactId) {
  const old = buddyView && buddyView.id;
  const { error } = await sb.rpc('accept_invite', { p: pactId });
  if (error) { toast(sbErr(error)); refreshBuddy(); return; }
  if (old && old !== pactId) await sb.rpc('leave_pact', { p: old });
  if (!state.buddy) { state.buddy = { commitmentId: (routineChoices().find((c) => /test/i.test(c.name)) || {}).id || null }; save(); }
  location.hash = '#/buddy';
  await refreshBuddy();
  toast(`You're in “${buddyView ? buddyView.name : 'the pact'}”`);
}
async function declineInvite(pactId) {
  const { error } = await sb.from('pact_invites').delete().eq('pact_id', pactId).eq('email', (myProfile && myProfile.email) || '');
  if (error) toast(sbErr(error));
  refreshBuddy();
}
async function buddyTick(done, note = '') {
  if (!buddyView || buddyBusy) return;
  buddyBusy = true;
  const day = todayISO();
  const { error } = done
    ? await sb.from('pact_days').upsert({ pact_id: buddyView.id, user_id: sbUser.id, day, note: String(note || '').slice(0, 140), done_at: new Date().toISOString() })
    : await sb.from('pact_days').delete().eq('pact_id', buddyView.id).eq('user_id', sbUser.id).eq('day', day);
  buddyBusy = false;
  if (error) { toast(sbErr(error)); return; }
  await refreshBuddy();
}
async function leavePact() {
  if (!buddyView || !confirm('Leave this pact? Your ticks in it are removed. If you are the last person, the pact is deleted.')) return;
  const { error } = await sb.rpc('leave_pact', { p: buddyView.id });
  if (error) { toast(sbErr(error)); return; }
  buddyView = null;
  await refreshBuddy();
}
async function setShareCalendar(level) {
  const { error } = await sb.from('profiles').update({ share_calendar: level }).eq('id', sbUser.id);
  if (error) { toast(sbErr(error)); return; }
  if (myProfile) myProfile.share_calendar = level;
  shareSig = null;
  await shareCalendar();
  toast(level === 'off' ? 'Stopped sharing your calendar' : 'Your calendar is shared with your buddy');
  refreshBuddy();
}
// ---- Build a tree together
// You and your buddy keep a short list of daily tasks. Each task is for one of you or for you together
// (owner_id empty: you both tick it). A day is good when everyone in the pact has ticked their own tasks
// and the shared ones. Each good day grows the tree one step: seed, sprout … flower, and on the 7th a mature tree whose
// fruit was a mystery until then. A missed day makes it wilt; 3 missed days in a row and it stops growing.
// Grown (and stopped) trees are kept in the yard. The tree is worked out from the days, so nothing extra is stored.
const TREE_EPOCH = '2026-11-25', TREE_DAYS = 7, TREE_MISS = 3;
const TREE_STAGES = ['Seed', 'Sprout', 'Seedling', 'Sapling', 'Young tree', 'In flower', 'Setting fruit', 'Mature tree'];
const TREE_FRUITS = [['apple', '#d9483b'], ['orange', '#f29a2e'], ['lemon', '#f2d13a'], ['cherry', '#b3203a'], ['peach', '#f6a481'], ['plum', '#7c4a8c'], ['pear', '#b9cc4a'], ['pomegranate', '#c8334b'], ['blueberry', '#4a63b8'], ['fig', '#7d4a6e'], ['mango', '#f5b23d']];
const TREE_DEFAULT_TASKS = ['Career prep practice', 'Five things'];
function treeFruit(seed) { // what's in the mystery box: the same for both of you, with a rare golden one
  const r = rngFrom(`fruit${seed}`)();
  const [name, color] = r < 0.06 ? ['golden apple', '#e9b824'] : TREE_FRUITS[Math.min(TREE_FRUITS.length - 1, Math.floor(((r - 0.06) / 0.94) * TREE_FRUITS.length))];
  return { name, color };
}
function treeHistory(p, today = todayISO()) {
  const good = (d) => { const ms = p.members.filter((m) => !m.joined || m.joined <= d); return ms.length > 0 && ms.every((m) => m.days[d]); };
  const yard = [];
  const fresh = () => ({ planted: null, good: 0, missed: 0, ended: null, state: 'seed' });
  let t = fresh();
  const finish = (d, state) => {
    t.ended = d; t.state = state; t.seed = `${p.id}${t.planted}`; t.fruit = treeFruit(t.seed);
    yard.push(t); t = fresh();
  };
  for (let d = TREE_EPOCH; d <= today; d = addDaysISO(d, 1)) {
    if (good(d)) {
      if (!t.planted) t.planted = d;
      t.good++; t.missed = 0;
      if (t.good >= TREE_DAYS) finish(d, 'fruit');
    } else if (t.planted && d < today) {
      if (++t.missed >= TREE_MISS) finish(d, 'withered');
    }
  }
  const last = yard[yard.length - 1];
  let cur;
  if (last && last.state === 'fruit' && last.ended === today) cur = last; // grown today: enjoy it until tomorrow
  else {
    cur = t;
    cur.state = !t.planted ? 'seed' : t.missed ? 'wilted' : 'growing';
    cur.seed = `${p.id}${t.planted || 'next'}`;
    cur.fruit = treeFruit(cur.seed);
  }
  return { cur, yard, goodToday: good(today) };
}
async function loadPactTasks(p) { // p.tasks stays null until supabase/tree.sql has been run
  const day = todayISO();
  let cols = 'id, title, created_at, owner_id';
  const list = () => sb.from('pact_tasks').select(cols).eq('pact_id', p.id).order('created_at').order('title');
  p.tasks = null; p.allTasks = []; p.ticks = {}; p.day = day; p.owners = false;
  try {
    let t = await list();
    if (t.error) { cols = 'id, title, created_at'; t = await list(); } // a tree.sql from before tasks had owners
    if (t.error) return;
    if (!t.data.length) {
      await sb.from('pact_tasks').upsert(TREE_DEFAULT_TASKS.map((title) => ({ pact_id: p.id, title })), { onConflict: 'pact_id,title', ignoreDuplicates: true });
      t = await list();
    }
    const k = await sb.from('pact_task_ticks').select('task_id, user_id').eq('pact_id', p.id).eq('day', day);
    if (t.error || k.error) return;
    const here = new Set(p.members.map((m) => m.id));
    p.owners = cols.includes('owner_id');
    p.allTasks = t.data;
    p.tasks = t.data.filter((x) => !x.owner_id || here.has(x.owner_id)); // someone who left takes their own tasks with them
    for (const r of k.data) (p.ticks[r.user_id] || (p.ticks[r.user_id] = new Set())).add(r.task_id);
  } catch { /* offline */ }
}
const taskFor = (t, uid) => !t.owner_id || t.owner_id === uid;
const tasksOf = (p, uid) => (p.tasks || []).filter((t) => taskFor(t, uid));
const myTasks = (p) => (sbUser ? tasksOf(p, sbUser.id) : []);
// The list as shown: yours, the shared ones, then your buddy's.
function taskGroups(p, others) {
  if (!p.owners || !others.length) return [['', p.tasks]];
  const of = (id) => p.tasks.filter((t) => (t.owner_id || null) === id);
  return [['Yours', of(sbUser.id)], ['Together', of(null)], ...others.map((m) => [`${m.name}’s`, of(m.id)])].filter((g) => g[1].length);
}
const myTicks = (p) => (p.day === todayISO() && sbUser && p.ticks && p.ticks[sbUser.id]) || new Set();
// Your day counts for the tree once all your tasks (your own and the shared ones) are ticked. Only unticking
// takes it back: a task added after you've finished doesn't undo your day (it counts from tomorrow).
async function treeSyncDay(unticked = false) {
  const p = buddyView;
  if (!p || !p.tasks || !myTasks(p).length || p.day !== todayISO() || buddyBusy) return;
  const me = p.members.find((m) => m.me);
  if (!me) return;
  const all = myTasks(p).every((t) => myTicks(p).has(t.id));
  const has = !!me.days[p.day];
  if (all && !has) await buddyTick(true, '');
  else if (unticked && !all && has) await buddyTick(false);
}
async function treeTick(taskId, on) {
  const p = buddyView;
  if (!p || !p.tasks || !sbUser || !myTasks(p).some((t) => t.id === taskId)) return;
  const day = todayISO();
  if (p.day !== day) { await refreshBuddy(); return; }
  const mine = p.ticks[sbUser.id] || (p.ticks[sbUser.id] = new Set());
  if (on) mine.add(taskId); else mine.delete(taskId);
  rerenderBuddy();
  const { error } = on
    ? await sb.from('pact_task_ticks').upsert({ task_id: taskId, pact_id: p.id, user_id: sbUser.id, day }, { onConflict: 'task_id,user_id,day', ignoreDuplicates: true })
    : await sb.from('pact_task_ticks').delete().eq('task_id', taskId).eq('user_id', sbUser.id).eq('day', day);
  if (error) { toast(sbErr(error)); refreshBuddy(); return; }
  await treeSyncDay(!on);
}
let treeNewOwner = ''; // who the next task is for ('' = together), kept while the page redraws
async function treeAddTask(form) {
  const title = String(new FormData(form).get('title') || '').trim().slice(0, 80);
  const p = buddyView;
  if (!title || !p || !p.tasks) return;
  const owner = p.owners && p.members.some((m) => m.id === treeNewOwner) && p.members.length > 1 ? treeNewOwner : null;
  const old = p.allTasks.find((x) => x.title.toLowerCase() === title.toLowerCase());
  const listed = old && p.tasks.some((x) => x.id === old.id);
  let error, said = '';
  if (listed) { // one of you had it and now the other does too: it becomes a shared task
    if (!old.owner_id || old.owner_id === owner) { toast('That task is already on the list'); return; }
    ({ error } = await sb.from('pact_tasks').update({ owner_id: null }).eq('id', old.id));
    said = `“${old.title}” is now for you together`;
  } else if (old) ({ error } = await sb.from('pact_tasks').update({ owner_id: owner }).eq('id', old.id));
  else ({ error } = await sb.from('pact_tasks').insert({ pact_id: p.id, title, ...(p.owners ? { owner_id: owner } : {}) }));
  if (error) { toast(error.code === '23505' ? 'That task is already on the list' : sbErr(error)); return; }
  if (said) toast(said);
  form.reset(); document.activeElement.blur();
  await refreshBuddy();
}
async function treeRemoveTask(id) {
  const p = buddyView;
  const t = p && p.tasks && p.tasks.find((x) => x.id === id);
  if (!t) return;
  const rest = p.tasks.filter((x) => x.id !== id);
  const bare = p.members.find((m) => taskFor(t, m.id) && !rest.some((x) => taskFor(x, m.id)));
  if (bare) { toast(`${bare.me ? 'You' : bare.name} would have no task left, so the tree couldn’t grow. Add another first.`); return; }
  const owner = p.members.find((m) => m.id === t.owner_id);
  if (!confirm(!owner ? `Remove “${t.title}” for both of you?` : owner.me ? `Remove your task “${t.title}”?` : `Remove ${owner.name}’s task “${t.title}”?`)) return;
  const { error } = await sb.from('pact_tasks').delete().eq('id', id);
  if (error) { toast(sbErr(error)); return; }
  await refreshBuddy();
}
// Done today on a routine of yours?
function routineDoneToday(id) {
  const w = id && state.weeks[currentWeekKey()];
  const it = w && w.items[id];
  if (!it) return null;
  return it.freq === 'weekly' || it.freq === 'once' ? periodDone(it) : dayDone(it, todayIndex(currentWeekKey()));
}
// Ticks a task of yours when the routine you linked to it is finished (and unticks only what it ticked).
const autoTicked = new Set();
function buddyAutoTick() {
  if (!buddyView || buddyBusy || !sbUser) return;
  const prefs = state.buddy || {};
  if (!buddyView.tasks) { // before tree.sql: one routine ticks the whole day
    const done = routineDoneToday(prefs.commitmentId);
    if (done == null) return;
    const mine = buddyView.members.find((m) => m.me), has = !!(mine && mine.days[todayISO()]);
    if (done && !has) { buddyAutoDate = todayISO(); buddyTick(true, ''); }
    else if (!done && has && buddyAutoDate === todayISO()) { buddyAutoDate = null; buddyTick(false); }
    return;
  }
  for (const t of myTasks(buddyView)) {
    const done = routineDoneToday((prefs.links || {})[t.id]);
    if (done == null) continue;
    const key = `${todayISO()}:${t.id}`, has = myTicks(buddyView).has(t.id);
    if (done && !has) { autoTicked.add(key); setTimeout(treeTick, 0, t.id, true); }
    else if (!done && has && autoTicked.has(key)) { autoTicked.delete(key); setTimeout(treeTick, 0, t.id, false); }
  }
}

// ---- calendars
// When you share, your one-off events and timetable (60 days back to 6 months ahead) are kept in the
// events table; "busy" hides their names from your buddy inside the database. Turning sharing off
// removes them.
let shareSig = null, shareTimer = null;
function myEventRows() {
  const from = addDaysISO(todayISO(), -60), to = addDaysISO(todayISO(), 183);
  return state.commitments.filter((c) => c.freq === 'once' && !c.archived && c.date && c.date >= from && c.date <= to).map((c) => {
    const s0 = c.time ? toMinutes(c.time) : null;
    const e0 = c.time ? (c.endTime && toMinutes(c.endTime) > s0 ? toMinutes(c.endTime) : s0 + Math.max(30, Math.round((c.hours || 1) * 60))) : null;
    return { id: c.id, day: c.date, starts: c.time || null, ends: e0 != null ? fmtTime(Math.min(e0, 23 * 60 + 59)) : null, title: c.name.slice(0, 120) };
  });
}
function scheduleShare(delay = 3000) {
  clearTimeout(shareTimer);
  shareTimer = setTimeout(shareCalendar, delay);
}
async function shareCalendar() {
  if (!sbUser || !myProfile) return;
  const on = myProfile.share_calendar !== 'off' || calPeople.length > 0;
  const rows = on ? myEventRows() : [];
  const sig = JSON.stringify([on, rows]);
  if (sig === shareSig) return;
  try {
    const { data: have, error } = await sb.from('events').select('id');
    if (error) return;
    const keep = new Set(rows.map((r) => r.id));
    const gone = have.map((r) => r.id).filter((id) => !keep.has(id));
    for (let i = 0; i < gone.length; i += 200) await sb.from('events').delete().in('id', gone.slice(i, i + 200));
    for (let i = 0; i < rows.length; i += 200) {
      const { error: e2 } = await sb.from('events').upsert(rows.slice(i, i + 200).map((r) => ({ ...r, user_id: sbUser.id, updated_at: new Date().toISOString() })));
      if (e2) return;
    }
    shareSig = sig;
  } catch { /* tries again next time */ }
}
// Calendars shared with you, one week at a time (Monday key): people you share calendars with,
// plus Work Buddy members who share theirs. Fetched when the calendar shows that week.
const sharedCache = new Map(); // week -> { at, list }
async function loadSharedWeek(wk) {
  if (!sb || !sbUser) return;
  const { data, error } = await sb.rpc('shared_events', { day_from: wk, day_to: addDaysISO(wk, 6) });
  if (error) return;
  sharedCache.set(wk, { at: Date.now(), list: data || [] });
  if (route.tab === 'cal' && !typing()) render();
}
// Everyone whose calendar you can see.
function calendarPeople() {
  const map = new Map();
  for (const p of calPeople) if (p.accepted && p.user_id) map.set(p.user_id, { id: p.user_id, name: p.name || p.email });
  if (buddyView) for (const m of buddyView.members) if (!m.me && m.share !== 'off' && !map.has(m.id)) map.set(m.id, { id: m.id, name: m.name });
  return [...map.values()];
}
// Those people with their events for the week shown.
function sharedPeople(wk) {
  const people = calendarPeople();
  if (!people.length) return [];
  const cached = sharedCache.get(wk);
  if (!cached || Date.now() - cached.at > 60e3) loadSharedWeek(wk);
  const list = cached ? cached.list : [];
  return people.map((p) => ({
    ...p,
    cal: { events: list.filter((x) => x.user_id === p.id).map((x) => ({ d: x.day, s: x.starts ? x.starts.slice(0, 5) : null, e: x.ends ? x.ends.slice(0, 5) : null, n: x.title || '' })) },
  }));
}
// Tapping an event on someone's shared calendar: what it is, when, and what you have on then.
function openBuddyEvent(ds) {
  const day = ds.day, s = ds.s ? +ds.s : null, e = ds.e ? +ds.e : null;
  const busy = ds.what === 'Busy';
  const w = getWeek(weekOf(day));
  const mineThen = (w ? itemsOf(w, 'once') : []).filter(([, it]) => it.date === day).map(([id, it]) => {
    const a = it.time ? toMinutes(it.time) : null;
    const b = a == null ? null : it.endTime && toMinutes(it.endTime) > a ? toMinutes(it.endTime) : a + Math.max(30, Math.round((it.hours || 1) * 60));
    return { id, it, a, b };
  }).filter((x) => (s == null ? true : x.a == null ? false : x.a < e && x.b > s));
  const len = s != null && e != null ? e - s : null;
  openSheet(`<div class="sheet-head"><h3>${escapeHtml(busy ? `${ds.who} is busy` : ds.what)}</h3></div>
    <div class="sev">
      <p><b>${escapeHtml(ds.who)}’s calendar</b>${busy ? '<br><span class="muted small">They share times only, not what it is.</span>' : ''}</p>
      <p>${fmtDay(parseISO(day), { weekday: 'long', day: 'numeric', month: 'long' })}<br>
        ${s != null ? `${fmtTime(s)} to ${fmtTime(e)}<span class="muted"> · ${len >= 60 ? `${Math.floor(len / 60)}h${len % 60 ? ` ${len % 60}m` : ''}` : `${len}m`}</span>` : 'All day'}</p>
      <h4>${s != null ? 'You at the same time' : 'You that day'}</h4>
      ${mineThen.length ? mineThen.map((x) => `<a class="sev-mine" href="#/c/${x.id}">${x.a != null ? `<small>${fmtTime(x.a)}</small> ` : ''}${escapeHtml(x.it.name)}</a>`).join('')
        : `<p class="muted small">${s != null ? 'Nothing on your calendar then, so you’re free.' : 'Nothing on your calendar that day.'}</p>`}
    </div>
    <button class="btn" data-act="close">Close</button>`);
}
// The switch in the calendar bar: Only me · each person · Ours, and the Share button.
function calBarHtml(people, who) {
  if (!state.account) return '';
  const opts = [['me', 'Only me'], ...people.map((p) => [p.id, p.name]), ...(people.length ? [['ours', 'Ours']] : [])];
  const pending = calPeople.filter((p) => !p.accepted && !p.incoming).length;
  return `<div class="calbar"><div class="seg-mini">${opts.map(([v, l]) => `<button data-act="cal-who" data-v="${escapeHtml(v)}" class="${who === v ? 'on' : ''}">${escapeHtml(l)}</button>`).join('')}</div>
    <button class="mini-btn" data-act="cal-share">${people.length || pending ? `Sharing${pending ? ` · ${pending} waiting` : ''}` : '＋ Share my calendar'}</button></div>`;
}
function calInvitesHtml() {
  return calPeople.filter((p) => p.incoming && !p.accepted).map((p) => `<section class="card banner-card">
    <b>📅 ${escapeHtml(p.name || p.email)} wants to share calendars with you</b>
    <p class="small">You'll each see the other's calendar. ${escapeHtml(p.name || 'They')} shares ${p.their_level === 'busy' ? 'busy times only' : 'event names and times'}; you choose how much of yours they see.</p>
    <div class="btn-row"><button class="btn primary" data-act="cal-accept" data-id="${p.link_id}">Accept</button><button class="btn" data-act="cal-remove" data-id="${p.link_id}">Decline</button></div></section>`).join('');
}
const calInviteMail = (email) => `mailto:${encodeURIComponent(email)}?${new URLSearchParams({
  subject: 'Share calendars with me on I Commit!',
  body: `Hi! I've invited you (${email}) to share calendars on I Commit!, so we can see when we're both free.\n\n1. Open ${location.origin}\n2. Sign in with Google using this Gmail\n3. Go to Calendar and tap Accept\n`,
}).toString().replace(/\+/g, '%20')}`;
function calShareHtml() {
  const lvl = (id, cur) => `<select data-cal-level="${id}"><option value="names" ${cur === 'names' ? 'selected' : ''}>Names and times</option><option value="busy" ${cur === 'busy' ? 'selected' : ''}>Busy times only</option></select>`;
  return `<div class="sheet-head"><h3>Share your calendar</h3></div>
    <form class="form flat" data-form="cal-invite">
      <p class="small muted">Invite someone by Gmail. When they accept, you'll each see the other's calendar: “Only me”, theirs, or “Ours” in the calendar bar.</p>
      <label class="f">Their Gmail<input name="email" type="email" inputmode="email" autocapitalize="off" autocorrect="off" required placeholder="e.g. han@gmail.com"></label>
      <label class="f">What they see of yours<select name="level"><option value="names">Event names and times</option><option value="busy">Busy times only</option></select></label>
      <button class="btn primary" type="submit">Invite</button>
    </form>
    ${calPeople.length ? `<div class="label" style="margin-top:14px">Sharing with</div>${calPeople.map((p) => `<div class="cpeople">
      <div class="cp-who"><b>${escapeHtml(p.name || p.email)}</b><span>${p.accepted ? `sees your ${p.my_level === 'busy' ? 'busy times' : 'events'} · shares ${p.their_level === 'busy' ? 'busy times' : 'events'}` : p.incoming ? 'wants to share with you' : `${escapeHtml(p.email)} · waiting to accept`}</span></div>
      ${p.incoming && !p.accepted ? `<button class="mini-btn" data-act="cal-accept" data-id="${p.link_id}">Accept</button>` : lvl(p.link_id, p.my_level)}
      ${!p.accepted && !p.incoming ? `<a class="mini-btn" href="${escapeHtml(calInviteMail(p.email))}">Email</a>` : ''}
      <button class="mini-btn" data-act="cal-remove" data-id="${p.link_id}">${p.accepted ? 'Stop' : p.incoming ? 'Decline' : 'Take back'}</button></div>`).join('')}` : ''}
    <button class="btn full" data-act="close" style="margin-top:14px">Done</button>`;
}
function openCalShare() {
  if (!sbUser) { location.hash = '#/buddy'; toast('Sign in with Google once more to share calendars.'); return; }
  openSheet(calShareHtml(), { calShare: true });
}
function refreshCalSheet() { if (sheetCtx && sheetCtx.calShare) openSheet(calShareHtml(), { calShare: true }); }
async function calInvite(form) {
  const f = new FormData(form);
  const email = String(f.get('email') || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(email)) { toast('That doesn’t look like an email address.'); return; }
  if (myProfile && email === myProfile.email) { toast('That’s your own Gmail.'); return; }
  const { error } = await sb.from('calendar_links').insert({ to_email: email, from_level: f.get('level') === 'busy' ? 'busy' : 'names' });
  if (error) { toast(error.code === '23505' ? 'You already invited them.' : sbErr(error)); return; }
  toast(`Invited ${email}. They'll see it when they sign in with Google.`);
  await refreshBuddy();
  scheduleShare(0);
}
async function calAccept(id) {
  const { error } = await sb.rpc('accept_calendar_link', { l: id });
  if (error) { toast(sbErr(error)); return; }
  sharedCache.clear();
  await refreshBuddy();
  scheduleShare(0);
  toast('Calendars shared. Use the calendar bar to see theirs or ours.');
}
async function calRemove(id) {
  const { error } = await sb.from('calendar_links').delete().eq('id', id);
  if (error) { toast(sbErr(error)); return; }
  sharedCache.clear();
  if (calWho !== 'me' && calWho !== 'ours') calWho = 'me';
  await refreshBuddy();
}
async function calSetLevel(id, level) {
  const { error } = await sb.rpc('set_calendar_level', { l: id, level });
  if (error) toast(sbErr(error)); else toast(level === 'busy' ? 'They now see busy times only' : 'They now see your event names');
  refreshBuddy();
}

function pactStreak(p) {
  if (p.members.length < 2) return 0;
  const all = (d) => p.members.every((m) => m.days[d]);
  let d = todayISO();
  if (!all(d)) d = addDaysISO(d, -1);
  let n = 0;
  while (all(d) && n < 400) { n++; d = addDaysISO(d, -1); }
  return n;
}
async function shareText(text, url) {
  if (navigator.share) { try { await navigator.share({ text, url }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  copyText(`${text} ${url}`);
}
const inviteMail = (email) => `mailto:${encodeURIComponent(email)}?${new URLSearchParams({
  subject: 'Join me on I Commit!',
  body: `Hi! I've invited you (${email}) to our "${buddyView ? buddyView.name : 'Work Buddy'}" tree on I Commit!, so we can grow it by keeping each other on track.\n\n1. Open ${location.origin}\n2. Sign in with Google using this Gmail\n3. Go to Our Tree and tap Accept\n`,
}).toString().replace(/\+/g, '%20')}`;
function invitesHtml(inPact) {
  if (!myInvites.length) return '';
  return myInvites.map((x) => `<section class="card banner-card" data-section="Invite">
    <b>${escapeHtml(x.from.join(' & ') || 'Someone')} invited you to “${escapeHtml(x.name)}”</b>
    <p class="small">${inPact ? 'Accepting moves you out of your current pact.' : 'Do it together: each of you ticks your own day, and the streak grows on days you both finish.'}</p>
    <div class="btn-row"><button class="btn primary" data-act="invite-accept" data-id="${x.pactId}">Accept</button><button class="btn" data-act="invite-decline" data-id="${x.pactId}">Decline</button></div></section>`).join('');
}
function buddyTodayLine() {
  const calInv = calPeople.find((p) => p.incoming && !p.accepted);
  if (calInv) return `<div class="pace"><a href="#/cal">📅 ${escapeHtml(calInv.name || calInv.email)} wants to share calendars · open ›</a></div>`;
  if (myInvites.length) return `<div class="pace"><a href="#/buddy">✉️ ${escapeHtml(myInvites[0].from.join(' & ') || 'Someone')} invited you to build a tree · open ›</a></div>`;
  if (!buddyView) return '';
  const others = buddyView.members.filter((m) => !m.me), { cur } = treeHistory(buddyView);
  return `<div class="pace"><a href="#/buddy">🌳 Our tree · day ${cur.good}/${TREE_DAYS}${cur.state === 'wilted' ? ' · wilting' : ''} · ${others.length ? others.map((m) => `${escapeHtml(m.name)} ${m.days[todayISO()] ? '✅' : '⬜'}`).join(' · ') : 'waiting for your buddy'} ›</a></div>`;
}
const has3d = () => !!(window.Garden3D && Garden3D.supported());
// What the 3D garden shows: the tree's state, who's done, the grown trees and the words on its labels and cards.
function gardenData() {
  const p = buddyView && sbUser ? buddyView : null;
  if (!p) return { stage: 4, wilt: false, fruit: '#d9483b', people: { me: false, buddy: null }, yard: [], who: '<b>Our Tree</b><small>Plant a seed together</small>', side: '', places: [], panels: {} };
  const today = todayISO(), h = treeHistory(p), { cur, yard } = h, streak = pactStreak(p);
  const me = p.members.find((m) => m.me) || { days: {} }, buddy = p.members.find((m) => !m.me);
  const others = p.members.filter((m) => !m.me), name = buddy ? buddy.name : '';
  const grown = cur.state === 'fruit', fruit = cur.fruit.name[0].toUpperCase() + cur.fruit.name.slice(1);
  const mine = myTicks(p);
  const status = cur.state === 'wilted' ? 'wilting' : me.days[today] && others.every((m) => m.days[today]) && others.length ? 'both done today' : me.days[today] ? 'you’re done today' : others.some((m) => m.days[today]) ? `${others.find((m) => m.days[today]).name} is done today` : 'today’s still open';
  const dot = (done) => `<span class="g3-state ${done ? 'on' : ''}">${done ? 'done ✓' : 'not yet'}</span>`;
  const ticked = (m, id) => !!(p.day === today && p.ticks[m.id] && p.ticks[m.id].has(id));
  const g3Task = (t) => {
    if (sbUser && !taskFor(t, sbUser.id)) { // your buddy's own task: shown, not tickable
      const m = others.find((x) => x.id === t.owner_id);
      return m ? `<div class="g3-row theirs"><span class="gd-mark ${ticked(m, t.id) ? 'on' : ''}">${ticked(m, t.id) ? CHECK : ''}</span><span>${escapeHtml(t.title)}</span>${dot(ticked(m, t.id))}</div>` : '';
    }
    return `<div class="g3-row"><button class="chk ${mine.has(t.id) ? 'on' : ''}" data-act="tree-tick" data-id="${t.id}" aria-pressed="${mine.has(t.id)}" aria-label="${escapeHtml(t.title)}">${mine.has(t.id) ? CHECK : ''}</button><span>${escapeHtml(t.title)}</span>
        ${buddy && !t.owner_id ? `<span class="g3-state ${ticked(buddy, t.id) ? 'on' : ''}">${escapeHtml(name)} ${ticked(buddy, t.id) ? '✓' : '…'}</span>` : ''}</div>`;
  };
  const rows = p.tasks
    ? taskGroups(p, others).map(([label, list]) => `${label ? `<h3 class="gd-group">${escapeHtml(label)}</h3>` : ''}${list.map(g3Task).join('')}`).join('')
    : `<div class="g3-row"><button class="chk ${me.days[today] ? 'on' : ''}" data-act="buddy-tick" aria-pressed="${!!me.days[today]}" aria-label="I did today’s tasks">${me.days[today] ? CHECK : ''}</button><span>I did today’s tasks</span></div>`;
  const trees = yard.slice().reverse().slice(0, 6).map((t) => `<div class="g3-row"><i class="g3-dot" style="background:${t.state === 'fruit' ? t.fruit.color : '#a8926a'}"></i><span>${t.state === 'fruit' ? `${t.fruit.name[0].toUpperCase()}${t.fruit.name.slice(1)} tree` : `Stopped at day ${t.good}`}</span><span class="g3-state">${fmtShort(t.ended)}</span></div>`).join('');
  const places = [
    { key: 'tree', title: 'Our tree', sub: `Day ${cur.good} of ${TREE_DAYS}`, nav: 'Tree' },
    { key: 'tasks', title: 'Cottage', sub: 'Today’s tasks', nav: 'Tasks' },
    { key: 'yard', title: 'Orchard yard', sub: yard.length ? `${yard.length} tree${yard.length === 1 ? '' : 's'}` : 'Grown trees', nav: 'Yard' },
    { key: 'box', title: grown ? fruit : 'Mystery box', sub: grown ? 'Revealed!' : 'What fruit?', nav: 'Box' },
    { key: 'mail', title: 'Mailbox', sub: buddy ? `Nudge ${name}` : 'Invite a buddy', nav: 'Mail' },
  ];
  const panels = {
    tree: `<h2>${cur.state === 'wilted' ? 'Wilting' : TREE_STAGES[cur.good]}</h2><p>${gardenSay(h)}</p><div class="g3-row"><span>Good days</span><span class="g3-state">${cur.good} of ${TREE_DAYS}</span></div>${others.map((m) => `<div class="g3-row"><span>${escapeHtml(m.name)}</span>${dot(!!m.days[today])}</div>`).join('')}`,
    tasks: `<h2>Today’s tasks</h2><p>The tree grows when you${buddy ? ' both finish yours' : ' finish them all'}.</p>${rows}`,
    yard: `<h2>Orchard yard</h2><p>${yard.length ? 'Every tree you grow together is planted here.' : 'Your first grown tree will be planted here.'}</p>${trees}`,
    box: grown ? `<h2>It’s a ${cur.fruit.name}!</h2><p>The box opened because your tree is fully grown.</p>` : `<h2>Mystery box</h2><p>It opens on day ${TREE_DAYS} and shows which fruit your tree makes.</p><div class="g3-row"><span>Good days to go</span><span class="g3-state">${TREE_DAYS - cur.good}</span></div>`,
    mail: !buddy ? '<h2>Mailbox</h2><p>Invite your buddy by Gmail under “Invite &amp; settings” below.</p>'
      : buddy.days[today] ? `<h2>Mailbox</h2><p>${escapeHtml(name)} has finished today. Nothing to nudge.</p>`
        : `<h2>Mailbox</h2><p>${escapeHtml(name)} hasn’t finished today yet.</p><button class="g3-go" data-act="buddy-nudge">Nudge ${escapeHtml(name)} 👀</button>`,
  };
  return {
    stage: cur.good, wilt: cur.state === 'wilted', fruit: cur.fruit.color,
    people: { me: !!me.days[today], buddy: buddy ? !!buddy.days[today] : null },
    yard: yard.map((t) => ({ state: t.state, good: t.good, fruit: t.fruit.color, seed: t.seed })),
    who: `<b>${escapeHtml(p.name)}</b><small><i class="${cur.state === 'wilted' ? 'dry' : ''}"></i>Day ${cur.good} of ${TREE_DAYS} · ${escapeHtml(status)}</small>`,
    side: `<span class="g3-card g3-pill">${streak ? `🔥 ${streak}` : '🌱'}</span><span class="g3-card g3-pill">${menuBtn}</span>`,
    places, panels,
  };
}
const gardenScene = (kind, labels, hint) => `<section class="gd-scene ${kind}"><canvas data-garden="${kind}" role="img" aria-label="${kind === 'yard' ? 'Your yard of grown trees' : 'Your tree on a floating island'}"></canvas>${labels}<span class="gd-hint">${hint || 'Drag to spin'}</span></section>`;
function gardenSay(h) {
  const { cur, yard, goodToday } = h;
  if (cur.state === 'fruit') return `<b>Fully grown!</b> The mystery box held a <b>${cur.fruit.name}</b>. The tree is in your yard, and a new seed is planted tomorrow.`;
  if (cur.state === 'wilted') return `<b>Your tree is wilting.</b> ${cur.missed} day${cur.missed === 1 ? '' : 's'} missed. Finish today together to revive it; after ${TREE_MISS - cur.missed} more missed day${TREE_MISS - cur.missed === 1 ? '' : 's'} it stops growing.`;
  if (cur.state === 'seed') {
    const last = yard[yard.length - 1];
    return `${last && last.state === 'withered' ? 'Your last tree stopped growing after 3 missed days. ' : ''}<b>A new seed.</b> Finish your tasks today, both of you, to plant it.`;
  }
  return goodToday ? '<b>Everyone is done today ✓</b> Your tree grew one step.' : '<b>Today’s still open.</b> When you both finish your tasks, the tree grows.';
}
function gardenTasksHtml(p, me, others) {
  const today = todayISO(), mineToday = me.days[today];
  const timeOf = (d) => (d && d.at ? new Date(d.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');
  const waiting = others.filter((m) => !m.days[today]);
  const mine = myTicks(p);
  const theirs = (m, id) => p.day === today && p.ticks[m.id] && p.ticks[m.id].has(id);
  const del = (t) => `<button class="gd-x" data-act="tree-task-del" data-id="${t.id}" aria-label="Remove ${escapeHtml(t.title)}">×</button>`;
  const row = (t) => {
    if (sbUser && !taskFor(t, sbUser.id)) {
      const m = others.find((x) => x.id === t.owner_id), done = m && theirs(m, t.id);
      return `<div class="gd-task theirs ${done ? 'done' : ''}"><span class="gd-mark ${done ? 'on' : ''}">${done ? CHECK : ''}</span>
        <div class="bm-body"><b>${escapeHtml(t.title)}</b><span>${done ? 'Done today' : 'Not yet'}</span></div>${del(t)}</div>`;
    }
    const both = !t.owner_id;
    return `<div class="gd-task ${mine.has(t.id) ? 'done' : ''}">
        <button class="chk ${mine.has(t.id) ? 'on' : ''}" data-act="tree-tick" data-id="${t.id}" aria-pressed="${mine.has(t.id)}" aria-label="${escapeHtml(t.title)}">${mine.has(t.id) ? CHECK : ''}</button>
        <div class="bm-body"><b>${escapeHtml(t.title)}</b>${both ? `<span>${others.length ? others.map((m) => `<i class="gd-who ${theirs(m, t.id) ? 'on' : ''}">${escapeHtml(m.name)} ${theirs(m, t.id) ? '✓' : '…'}</i>`).join('') : 'Your buddy’s tick shows here'}</span>` : ''}</div>
        ${del(t)}</div>`;
  };
  const choose = p.tasks && p.owners && others.length;
  const forWhom = choose ? `<div class="gd-for" role="radiogroup" aria-label="Who is the task for?"><span>For</span>${[[sbUser.id, 'Me'], ...others.map((m) => [m.id, m.name]), ['', 'Together']]
    .map(([v, label]) => `<label><input type="radio" name="owner" value="${v}" ${v === (others.some((m) => m.id === treeNewOwner) || treeNewOwner === sbUser.id ? treeNewOwner : '') ? 'checked' : ''}><i>${escapeHtml(label)}</i></label>`).join('')}</div>` : '';
  const idle = choose ? [me, ...others].filter((m) => m.id && !tasksOf(p, m.id).length) : [];
  const rows = p.tasks
    ? taskGroups(p, others).map(([label, list]) => `${label ? `<h3 class="gd-group">${escapeHtml(label)}</h3>` : ''}${list.map(row).join('')}`).join('')
      + idle.map((m) => `<p class="gd-warn">${m.me ? 'You have' : `${escapeHtml(m.name)} has`} no task yet. Add one for ${m.me ? 'yourself' : escapeHtml(m.name)} or for you together, or the tree can’t grow.</p>`).join('')
      + `<form class="gd-add" data-form="tree-task"><div class="inline"><input name="title" maxlength="80" placeholder="Add a daily task" aria-label="New daily task"><button class="mini-btn" type="submit">Add</button></div>${forWhom}</form>`
      + (!p.owners ? '<p class="help">To give a task to just one of you, run <b>supabase/tree.sql</b> again in Supabase.</p>'
        : !others.length ? '<p class="help">When your buddy joins, you can give a task to just one of you.</p>' : '')
    : `<div class="gd-task ${mineToday ? 'done' : ''}"><button class="chk ${mineToday ? 'on' : ''}" data-act="buddy-tick" aria-pressed="${!!mineToday}" aria-label="I did today’s tasks">${mineToday ? CHECK : ''}</button>
        <div class="bm-body"><b>I did today’s tasks</b><span>${TREE_DEFAULT_TASKS.join(' · ')}</span></div></div>
      <p class="help">To share a task list you can tick one by one, run <b>supabase/tree.sql</b> once in Supabase.</p>`;
  return `<section class="gd-card" data-section="Today"><div class="card-head"><h2>Today’s tasks</h2><span class="hint">${p.tasks ? `${myTasks(p).filter((t) => mine.has(t.id)).length}/${myTasks(p).length} yours` : ''}</span></div>
    ${rows}
    <div class="gd-people">${[me, ...others].map((m) => { const d = m.days[today]; return `<div class="gd-person ${d ? 'done' : ''}"><b>${m.me ? 'You' : escapeHtml(m.name)}</b><span>${d ? `All done ${timeOf(d)}${d.n ? ` · “${escapeHtml(d.n)}”` : ''}` : 'Not finished yet'}</span></div>`; }).join('')}</div>
    ${mineToday ? `<form class="inline bnote" data-form="buddy-note"><input name="note" maxlength="140" placeholder="Leave a note, e.g. SHL numerical 14/18" value="${escapeHtml(mineToday.n || '')}"><button class="mini-btn" type="submit">Save note</button></form>` : ''}
    ${waiting.length ? `<button class="btn full" data-act="buddy-nudge">Nudge ${escapeHtml(waiting.map((m) => m.name).join(' & '))} 👀</button>` : ''}
  </section>`;
}
function gardenYardHtml(yard, three) {
  const grown = yard.filter((t) => t.state === 'fruit').length;
  const list = yard.slice().reverse().map((t) => `<li><i style="background:${t.state === 'fruit' ? t.fruit.color : '#a8926a'}"></i>
    <b>${t.state === 'fruit' ? `${t.fruit.name[0].toUpperCase()}${t.fruit.name.slice(1)} tree` : `Stopped at day ${t.good}`}</b><span>${fmtShort(t.planted)} to ${fmtShort(t.ended)}</span></li>`).join('');
  return `<section class="gd-card" data-section="Yard"><div class="card-head"><h2>Our yard</h2><span class="hint">${yard.length ? `${grown} grown${yard.length - grown ? ` · ${yard.length - grown} stopped` : ''}` : ''}</span></div>
    ${yard.length ? `${three ? '' : gardenScene('yard', '')}<ul class="gd-list">${list}</ul>` : '<p class="small muted">Every tree you grow is planted here, with its fruit.</p>'}</section>`;
}
function buddyTabHtml() {
  const three = has3d(); // the 3D garden carries its own title card; the fallback has a header
  const head = (title, right = menuBtn) => (three ? '' : `<header class="gd-head"><div><small>Build a tree together</small><h1>${title}</h1></div>${right}</header>`);
  const slot = '<div class="g3-slot" data-garden-hero></div>';
  const hero = () => (three ? '' : gardenScene('tree', ''));
  const wrap = (inner) => `${three ? slot : ''}<div class="garden">${inner}</div>`;
  if (!state.account) {
    return wrap(head('Our tree') + hero() + `<section class="gd-card"><b>Sign in with Google to plant a tree</b>
      <p class="small">Invite your buddy by their Gmail, or accept their invite. The tree belongs to your accounts, so it’s there on every device.</p>
      <div class="btn-row"><a class="btn primary" href="#/account">Sign in with Google</a></div></section>`);
  }
  if (!sbUser) {
    return wrap(head('Our tree') + hero() + `<section class="gd-card"><b>One more Google sign-in</b>
      <p class="small">Sign in with Google once more on this device to see your tree.</p>
      <div class="btn-row"><button class="btn primary" data-act="google-signin">Continue with Google</button></div>
      ${loginWait ? '<p class="small muted">Finish signing in in the Google window…</p>' : ''}
      ${sbLastError && !loginWait ? `<p class="small err">Last try didn’t work: ${escapeHtml(sbLastError)}</p>` : ''}</section>`);
  }
  if (!buddyView) {
    return wrap(head('Our tree') + invitesHtml(false) + hero() + `
      ${buddyError ? `<section class="gd-card"><p class="err">${escapeHtml(buddyError)}</p><button class="btn" data-act="buddy-refresh">Try again</button></section>` : ''}
      <form class="gd-card form" data-form="buddy-create" data-section="Plant a seed">
        <div class="card-head"><h2>Plant a seed together</h2></div>
        <p class="small muted">Pick a buddy. Each day you both finish your tasks, your tree grows: 7 good days take it from seed to fruit.</p>
        <label class="f">Your buddy’s Gmail<input name="email" type="email" inputmode="email" autocapitalize="off" autocorrect="off" placeholder="e.g. han@gmail.com"><span class="help">They see your invite when they open I Commit! signed in with that Gmail.</span></label>
        <label class="f">Name your tree<input name="name" maxlength="60" value="Our tree"></label>
        <button class="btn primary" type="submit">Plant and invite</button>
      </form>`);
  }
  const p = buddyView, today = todayISO();
  const me = p.members.find((m) => m.me) || { days: {} };
  const others = p.members.filter((m) => !m.me);
  const h = treeHistory(p), { cur } = h, streak = pactStreak(p);
  const prefs = state.buddy || { commitmentId: null };
  const share = (myProfile && myProfile.share_calendar) || 'off';
  const grown = cur.state === 'fruit';
  const labels = `<div class="gd-label" data-anchor="tree"><b>${cur.state === 'wilted' ? 'Wilting' : TREE_STAGES[cur.good]}</b><small>Day ${cur.good} of ${TREE_DAYS}</small></div>
    <div class="gd-label small" data-anchor="box"><b>${grown ? cur.fruit.name : 'Mystery fruit'}</b><small>${grown ? 'revealed' : '? ? ?'}</small></div>`;
  const links = p.tasks ? myTasks(p).map((t) => `<label class="f">Tick “${escapeHtml(t.title)}” when I finish${routineSelect(`link:${t.id}`, (prefs.links || {})[t.id], 'Nothing, I’ll tick here')}</label>`).join('')
    : `<label class="f">Tick me automatically when I finish${routineSelect('routine', prefs.commitmentId, 'Nothing, I’ll tick here')}</label>`;
  return wrap(head(escapeHtml(p.name), `<span class="gd-pill">${streak ? `🔥 ${streak}` : '🌱'}</span>${menuBtn}`) + invitesHtml(true) + `
    ${three ? '' : gardenScene('tree', labels)}
    <ol class="gd-steps" aria-label="Day ${cur.good} of ${TREE_DAYS}">${Array.from({ length: TREE_DAYS }, (_, i) => `<li class="${i < cur.good ? (cur.state === 'wilted' ? 'dry' : 'on') : ''}"><i></i><span>${['🌰', '🌱', '🌿', '🪴', '🌳', '🌸', '🍎'][i]}</span></li>`).join('')}</ol>
    <p class="gd-say ${cur.state}">${gardenSay(h)}${!others.length ? ` ${p.invited.length ? `Waiting for ${escapeHtml(p.invited.join(' & '))} to accept; until then your own days grow it.` : 'Invite your buddy below.'}` : ''}</p>
    ${gardenTasksHtml(p, me, others)}
    ${gardenYardHtml(h.yard, three)}
    <details class="gd-card" data-section="Settings" ${others.length || p.invited.length ? '' : 'open'}>
      <summary><h2>Invite & settings</h2></summary>
      <form class="inline binvite" data-form="buddy-email"><input name="email" type="email" inputmode="email" autocapitalize="off" autocorrect="off" placeholder="Invite by Gmail, e.g. han@gmail.com"><button class="btn primary" type="submit">Invite</button></form>
      ${p.invited.map((e) => `<div class="binv"><span>✉️ ${escapeHtml(e)} · invited</span><a class="mini-btn" href="${escapeHtml(inviteMail(e))}">Email them</a><button class="mini-btn" data-act="invite-takeback" data-email="${escapeHtml(e)}">Take back</button></div>`).join('')}
      <p class="help">They see the invite when they open I Commit! signed in with that Gmail. “Email them” opens a ready-made email in your Mail app.</p>
      <form class="form flat" data-form="buddy-routine">${links}
        <label class="f">Share my calendar with my buddy<select name="share">
          <option value="off" ${share === 'off' ? 'selected' : ''}>Off</option>
          <option value="busy" ${share === 'busy' ? 'selected' : ''}>Busy times only</option>
          <option value="names" ${share === 'names' ? 'selected' : ''}>With event names</option></select>
          <span class="help">Your timetable and one-off events. You see theirs only if they share too.</span></label></form>
      <div class="danger"><button class="btn warn" data-act="buddy-leave">Leave this tree</button></div>
    </details>`);
}
// The 3D pictures are painted after the page is on screen.
function layoutGarden() {
  if (route.tab !== 'buddy') return;
  const slot = $app.querySelector('[data-garden-hero]');
  if (slot) {
    let ok = false;
    try { ok = Garden3D.attach(slot, gardenData()); } catch (e) { console.error(e); }
    if (!ok) { window.Garden3D = null; render(); } // couldn't start: use the simpler picture
    return;
  }
  if (!window.Garden) return;
  const h = buddyView && sbUser ? treeHistory(buddyView) : null;
  $app.querySelectorAll('canvas[data-garden]').forEach((cv) => {
    const kind = cv.dataset.garden;
    const scene = kind === 'yard'
      ? Garden.yardScene((h ? h.yard : []).map((t) => ({ state: t.state, good: t.good, fruit: t.fruit.color, seed: t.seed })))
      : Garden.treeScene(h ? { stage: h.cur.good, wilt: h.cur.state === 'wilted', fruit: h.cur.fruit.color, seed: h.cur.seed } : { stage: 4, wilt: false, fruit: '#d9483b', seed: 'preview' });
    Garden.mount(cv, scene, kind);
  });
}
window.addEventListener('resize', () => layoutGarden());

// ---------- Whiteboard ----------
// Sticky notes for things that pop into your head ("order pizza for Aurum"). Two views:
//   Free      notes sit anywhere; drag the corner to resize; drop one on a day in the strip to pin it.
//   Calendar  the board is a week (dashed lines between days, plus a "Not pinned" column); a note's
//             column is its date, and dragging its right edge makes it last several days.
// Pinned notes show in My plan and on Today with a tick box.
// Note: { id, text, color, x (0–1), y, w, h (free view), cy (calendar view), rot, date, endDate, time, done }.
const NOTE_COLORS = { gold: '#fff1a6', salmon: '#ffd5cc', sky: '#d3ecf8', mint: '#d5f5d1', lilac: '#e7ddfb' };
const isoOk = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : null);
function normaliseNote(n) {
  const date = isoOk(n.date);
  const end = date && isoOk(n.endDate) && n.endDate > date ? n.endDate : null;
  const size = (v, lo, hi) => (Number(v) ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : null);
  return {
    id: String(n.id || uid()), text: String(n.text || '').slice(0, 400), color: NOTE_COLORS[n.color] ? n.color : 'gold',
    x: Math.min(0.95, Math.max(0, Number(n.x) || 0)), y: Math.max(0, Math.round(Number(n.y) || 0)),
    w: size(n.w, 90, 420), h: size(n.h, 70, 420), cy: n.cy == null ? null : Math.max(0, Math.round(Number(n.cy) || 0)),
    rot: Math.max(-4, Math.min(4, Number(n.rot) || 0)),
    date, endDate: end, time: validTime(n.time), done: !!n.done, created: n.created || todayISO(),
  };
}
const shortDay = (iso) => (iso === todayISO() ? 'Today' : daysUntil(iso) === 1 ? 'Tomorrow'
  : fmtDay(parseISO(iso), { weekday: 'short', day: 'numeric', ...(Math.abs(daysUntil(iso)) > 6 ? { month: 'short' } : {}) }));


// A note becomes a one-off task (Today only / the calendar) with the same date and time; the first
// line is its name and the rest goes into "What to do". Without a date it becomes "Date to be confirmed".
function noteToTask(id) {
  const n = state.notes.find((x) => x.id === id);
  if (!n || !n.text.trim()) { toast('Write something on the note first'); return; }
  const [first, ...rest] = n.text.trim().split(/\n/);
  const notes = [rest.join('\n').trim(), n.endDate ? `Until ${fmtShort(n.endDate)}` : ''].filter(Boolean).join('\n\n');
  const c = newCommitment({ name: first.slice(0, 120), section: 'Notes', freq: 'once', kind: 'task', date: n.date, time: n.date ? n.time : null,
    hours: 0.5, timeUnit: 'min', notes, order: nextOrder() });
  state.commitments.push(normaliseCommitment(c));
  state.notes = state.notes.filter((x) => x !== n);
  renumber();
  save();
  closeSheet();
  render();
  toast(n.date ? `Now a task on ${shortDay(n.date)}${n.time ? ` at ${n.time}` : ''}` : 'Now a task (date to be confirmed)');
}
// Notes pinned to a day, including ones lasting several days.
const notesOn = (iso) => state.notes.filter((n) => n.date && n.date <= iso && iso <= (n.endDate || n.date))
  .sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));

// ---------- Commitment detail page ----------
function weekKeyFor(c) { return c.freq === 'once' && c.date ? weekOf(c.date) : currentWeekKey(); }

function scheduleDetailHtml(c) {
  const feed = c.source && state.calendars.feeds.find((f) => f.id === c.source.feed);
  const where = locationOf(c);
  const extra = (c.notes || '').split('\n').filter((l, i) => !(i === 0 && l.startsWith('📍'))).join('\n').trim();
  return `
    <header class="top">
      ${topBar({ left: '<button class="icon-btn" data-act="back" aria-label="Back">‹</button>', label: `Schedule · ${escapeHtml(feed ? feed.name : 'Calendar')}`, title: escapeHtml(c.name) })}
    </header>
    <section class="card">
      <div class="sched-facts">
        <div><span>When</span><b>${fmtDay(parseISO(c.date), { weekday: 'long', day: 'numeric', month: 'long' })}${c.time ? ` · ${escapeHtml(timeRange(c))}` : ''}</b></div>
        ${where ? `<div><span>Where</span><b>${escapeHtml(where)}</b></div>` : ''}
      </div>
      ${extra ? `<div class="notes small">${linkify(extra)}</div>` : ''}
      <p class="help pad">Part of your timetable from ${escapeHtml(feed ? feed.name : 'your calendar')}. It's shown on your calendar but isn't a to-do. To tick these off instead, set the series to <b>Task</b> in <a href="#/calendar">Calendars</a>.</p>
    </section>`;
}

function detailPageHtml(id) {
  const c = state.commitments.find((x) => x.id === id);
  if (c && c.schedule) return scheduleDetailHtml(c);
  if (!c) return `<header class="top">${topBar({ left: '<button class="icon-btn" data-act="back">‹</button>', title: 'Not found' })}</header>
    <section class="card empty"><p>This commitment no longer exists.</p><a class="btn" href="#/plan">This week</a></section>`;
  const wk = weekKeyFor(c);
  const w = c.archived ? state.weeks[wk] : getWeek(wk, true);
  const it = w && w.items[id];

  let progress = '';
  if (it && c.freq === 'periodic') {
    progress = `<div class="card-head"><h2>This week</h2><span class="hint">${periodicSub(id, c)}</span></div>
      ${dayHeadHtml(wk)}<div class="row">${dayCellsHtml(wk, id, it)}</div>
      <p class="muted small pad">Last done: ${lastDoneISO(id, addDaysISO(todayISO(), 1)) ? fmtShort(lastDoneISO(id, addDaysISO(todayISO(), 1))) : 'not yet'}</p>`;
  } else if (it && c.freq === 'daily') {
    const daysDone = it.ticks.filter((_, i) => dayDone(it, i)).length;
    const hrs = it.ticks.reduce((s, _, i) => s + dayHours(it, i), 0);
    progress = `<div class="card-head"><h2>This week</h2><span class="hint">${daysDone}/7 days · ${fmtH(hrs)} of ${fmtH(plannedHours(it) * 7)}</span></div>
      ${dayHeadHtml(wk)}<div class="row">${dayCellsHtml(wk, id, it)}</div>`;
  } else if (it) {
    progress = `<div class="card-head"><h2>${c.freq === 'once' ? fmtDay(parseISO(c.date), { weekday: 'long', day: 'numeric', month: 'long' }) : 'This week'}</h2></div>
      ${periodRowHtml(wk, id, it)}`;
  }

  const stageCard = !c.stage ? '' : c.stageUrl
    ? `<section class="card"><a class="btn primary full" href="${escapeHtml(c.stageUrl)}" target="_blank" rel="noopener">Open ${escapeHtml(c.stage)} link ↗</a>
        <p class="small muted center pad">${escapeHtml(hostOf(c.stageUrl))} · <a href="#/c/${id}/edit">change</a></p></section>`
    : `<form class="card form" data-form="stage-link" data-id="${id}">
        <label class="f">${escapeHtml(c.stage)} link<input name="url" inputmode="url" autocapitalize="off" autocorrect="off" placeholder="Paste the test or interview link"></label>
        <button class="btn primary" type="submit">Save link</button></form>`;
  if (c.freq === 'once' && !c.date) {
    progress = `<div class="card-head"><h2>Date to be confirmed</h2></div>
      <p class="small muted pad">Not on your calendar yet. Set a date when it's fixed.</p>
      <a class="btn primary full" href="#/c/${id}/edit">Set date</a>`;
  }
  const links = [];
  if (c.notionUrl) {
    const appUrl = notionAppUrl(c.notionUrl);
    links.push(`<a class="link-btn notion" href="${escapeHtml(appUrl)}" ${appUrl === c.notionUrl ? 'target="_blank" rel="noopener"' : ''}>
      <span class="li">N</span><span><b>Open in Notion</b><small>${escapeHtml(hostOf(c.notionUrl))}</small></span></a>`);
    if (appUrl !== c.notionUrl) links.push(`<a class="small muted web-link" href="${escapeHtml(c.notionUrl)}" target="_blank" rel="noopener">Open Notion page in browser instead</a>`);
  }
  for (const l of c.links) {
    links.push(`<a class="link-btn" href="${escapeHtml(l.url)}" target="_blank" rel="noopener">
      <span class="li">↗</span><span><b>${escapeHtml(l.label || hostOf(l.url))}</b><small>${escapeHtml(hostOf(l.url))}</small></span></a>`);
  }

  const past = Object.values(state.weeks)
    .filter((hw) => hw.items[id] && hw.start < currentWeekKey() && c.freq !== 'once')
    .sort((a, b) => (a.start < b.start ? 1 : -1)).slice(0, 8)
    .map((hw) => {
      const h = hw.items[id];
      const txt = h.freq === 'periodic' ? `${h.ticks.filter(Boolean).length}× done`
        : h.freq === 'daily'
        ? `${h.ticks.filter((_, i) => dayDone(h, i)).length}/7 days · ${fmtH(h.ticks.reduce((s, _, i) => s + dayHours(h, i), 0))}`
        : h.kind === 'counter' ? countLabel(h, h.count) : h.done ? 'Done' : 'Not done';
      return `<div class="hrow"><span>w/c ${fmtDay(parseISO(hw.start), { day: 'numeric', month: 'short' })}</span><span>${txt}</span></div>`;
    }).join('');

  return `
    <header class="top">
      ${topBar({
        left: '<button class="icon-btn" data-act="back" aria-label="Back">‹</button>',
        label: `${FREQ_LABEL[c.freq]} · ${escapeHtml(c.section)}`,
        title: escapeHtml(c.name),
        right: `<a class="txt-btn" href="#/c/${id}/edit">Edit</a>`,
      })}
      <div class="chips-meta"><span>${c.kind === 'counter' ? 'Counter' : 'Task'}</span><span>${targetLabel(c)}</span>${c.archived ? '<span>Archived</span>' : ''}</div>
      ${sourceNoteHtml(c)}
    </header>
    ${stageCard}
    ${progress ? `<section class="card">${progress}</section>` : ''}
    <section class="card">
      <div class="card-head"><h2>What to do</h2></div>
      ${c.notes ? `<div class="notes">${linkify(c.notes)}</div>` : `<p class="muted small pad">Nothing yet. Tap <a href="#/c/${id}/edit">Edit</a> to add what to do and any links.</p>`}
      ${links.length ? `<div class="links">${links.join('')}</div>` : ''}
    </section>
    ${past ? `<section class="card"><div class="card-head"><h2>Previous weeks</h2></div>${past}</section>` : ''}`;
}

// ---------- Edit / new commitment page ----------
function editPageHtml() {
  const isNew = route.id === 'new';
  const c = isNew
    ? newCommitment({ freq: route.freq, date: route.freq === 'once' ? todayISO() : null, hours: route.freq === 'weekly' ? 2 : 1 })
    : state.commitments.find((x) => x.id === route.id);
  if (!c) return detailPageHtml(route.id);
  const radio = (name, value, label, cur) =>
    `<label><input type="radio" name="${name}" value="${value}" ${cur === value ? 'checked' : ''}><span>${label}</span></label>`;
  const linkRow = (l = { label: '', url: '' }) => `
    <div class="linkrow"><input name="linkLabel" placeholder="Label (e.g. Course website)" value="${escapeHtml(l.label)}">
      <input name="linkUrl" inputmode="url" autocapitalize="off" autocorrect="off" placeholder="https://…" value="${escapeHtml(l.url)}">
      <button type="button" class="mini-btn" data-act="rmlink" aria-label="Remove link">×</button></div>`;
  const allLinks = [...(c.notionUrl ? [{ label: 'Notion page', url: c.notionUrl }] : []), ...c.links];
  return `
    <header class="top">
      ${topBar({
        left: '<button class="txt-btn" data-act="back">Cancel</button>',
        title: isNew ? 'New commitment' : 'Edit',
        right: '<button class="txt-btn strong" type="submit" form="cform">Save</button>',
      })}
    </header>
    <datalist id="sections">${sectionNames().map((s) => `<option value="${escapeHtml(s)}">`).join('')}</datalist>
    <form id="cform" class="card form" data-form="commitment" data-id="${isNew ? '' : c.id}"
      data-freq="${c.freq}" data-kind="${c.kind}" data-hourunit="${isHourUnit(c.unit)}" data-tbc="${!!c.tbc}" data-unit="${c.timeUnit === 'min' ? 'min' : 'h'}">
      <label class="f">Name<input name="name" required value="${escapeHtml(c.name)}" placeholder="e.g. Practice questions"></label>
      <div class="f">How often<div class="seg seg4">${radio('freq', 'daily', 'Daily', c.freq)}${radio('freq', 'weekly', 'Weekly', c.freq)}${radio('freq', 'periodic', 'Periodic', c.freq)}${radio('freq', 'once', 'One-off', c.freq)}</div></div>
      <div class="f only-periodic"><span>Repeat every</span>
        <div class="time-row">
          <input name="everyN" type="number" inputmode="numeric" min="1" max="365" step="1" value="${(c.everyDays || 7) % 7 === 0 ? (c.everyDays || 7) / 7 : c.everyDays}" aria-label="Repeat every">
          <div class="seg">${radio('everyUnit', 'd', 'days', (c.everyDays || 7) % 7 === 0 ? 'w' : 'd')}${radio('everyUnit', 'w', 'weeks', (c.everyDays || 7) % 7 === 0 ? 'w' : 'd')}</div>
        </div>
        <span class="help">Comes back that long after you last did it. Missed ones stay due until ticked.</span></div>
      <label class="f only-periodic">First due<input type="date" name="firstDue" value="${c.freq === 'periodic' && c.date ? c.date : todayISO()}"></label>
      ${c.source ? '' : `<label class="toggle-row only-once"><input type="checkbox" name="tbc" ${c.tbc ? 'checked' : ''}>
        <span>Date to be confirmed<small>Keep it on your list without a date; set one when it's fixed.</small></span></label>`}
      <label class="f only-once tbc-hide">Date<input type="date" name="date" value="${c.date || todayISO()}"></label>
      <div class="f2 only-once tbc-hide">
        <label class="f">Start time<input type="time" name="time" value="${c.time || ''}"></label>
        <label class="f">End time<input type="time" name="endTime" value="${c.endTime || ''}"></label>
      </div>
      ${c.source ? '<p class="help">📅 Synced from your calendar: date, time and name will follow the calendar.</p>' : ''}
      <details class="more" ${c.kind === 'counter' || (!isNew && (c.notes || allLinks.length || c.stage)) ? 'open' : ''}>
        <summary>More options</summary>
      <label class="f">Section<input name="section" list="sections" value="${escapeHtml(c.section === 'Other' && isNew ? '' : c.section)}" placeholder="e.g. Career prep"></label>
      <div class="f kind-field">Type<div class="seg">${radio('kind', 'task', 'Task', c.kind)}${radio('kind', 'counter', 'Counter', c.kind)}</div>
        <span class="help only-task">Done or not done, e.g. a lecture, seminar, coffee chat or study block.</span>
        <span class="help only-counter">Count towards a number, e.g. send 3 emails or log 15 hours.</span></div>
      <div class="f3 only-counter">
        <label class="f">Target<input name="target" type="number" inputmode="decimal" min="0" step="any" value="${round2(c.target)}"></label>
        <label class="f">Unit<input name="unit" value="${escapeHtml(c.unit)}" placeholder="emails / h"></label>
        <label class="f">Step<input name="step" type="number" inputmode="decimal" min="0" step="any" value="${round2(c.step)}"></label>
      </div>
      <div class="f only-time"><span>Planned time <span class="per-day">per day</span><span class="per-week">per week</span><span class="per-once">in total</span><span class="per-periodic">each time</span></span>
        <div class="time-row">
          <input name="hours" type="number" inputmode="decimal" min="0" step="${c.timeUnit === 'min' ? 5 : 0.25}" value="${c.timeUnit === 'min' ? Math.round(c.hours * 60) : round2(c.hours)}" aria-label="Planned time">
          <div class="seg">${radio('timeUnit', 'min', 'minutes', c.timeUnit === 'min' ? 'min' : 'h')}${radio('timeUnit', 'h', 'hours', c.timeUnit === 'min' ? 'min' : 'h')}</div>
        </div></div>
      <div class="f">Time tracking<div class="seg">${radio('track', 'no', 'Just tick', c.track ? 'yes' : 'no')}${radio('track', 'yes', 'Record focus time', c.track ? 'yes' : 'no')}</div>
        <span class="help">With “Record focus time” the task gets a ▶ button: run a stopwatch or a countdown and the minutes are saved on its day.</span></div>
      <label class="f">What to do<textarea name="notes" rows="5" placeholder="Steps, chapter you're on, checklist…">${escapeHtml(c.notes)}</textarea></label>
      ${c.stage ? `<label class="f">Test / interview link<input name="stageUrl" inputmode="url" autocapitalize="off" autocorrect="off" value="${escapeHtml(c.stageUrl || '')}" placeholder="HireVue invite, test portal, Zoom…"></label>` : ''}
      <div class="f">Links<div class="linklist">${(allLinks.length ? allLinks : [undefined]).map(linkRow).join('')}</div>
        <button type="button" class="mini-btn add-link" data-act="addlink">+ Add link</button></div>
      </details>
      <button class="btn primary" type="submit">Save</button>
      ${isNew ? '' : `<div class="danger">
        ${c.archived ? '<button type="button" class="btn" data-act="restore-one">Restore</button>' : '<button type="button" class="btn" data-act="archive-one">Archive</button>'}
        <button type="button" class="btn warn" data-act="delete-one">Delete</button></div>`}
    </form>
    <template id="linkRowTpl">${linkRow()}</template>`;
}

function saveCommitmentForm(form) {
  const f = new FormData(form);
  const name = String(f.get('name') || '').trim();
  if (!name) { toast('Give it a name'); return; }
  const freq = FREQS.includes(f.get('freq')) ? f.get('freq') : 'daily';
  const kind = f.get('kind') === 'counter' && freq !== 'periodic' ? 'counter' : 'task';
  const everyDays = Math.min(365, Math.max(1, Math.round(num(f.get('everyN'), 1)) * (f.get('everyUnit') === 'w' ? 7 : 1)));
  const unit = kind === 'counter' ? String(f.get('unit') || '').trim() : '';
  const target = kind === 'counter' ? num(f.get('target'), 1) : 1;
  const fields = {
    name, freq, kind, unit, target,
    section: String(f.get('section') || '').trim() || 'Other',
    date: freq === 'periodic' ? (f.get('firstDue') || todayISO()) : freq === 'once' && f.get('tbc') !== 'on' ? (f.get('date') || todayISO()) : null,
    everyDays,
    tbc: freq === 'once' && f.get('tbc') === 'on',
    time: freq === 'once' && f.get('tbc') !== 'on' ? validTime(f.get('time')) : null,
    endTime: freq === 'once' && f.get('tbc') !== 'on' ? validTime(f.get('endTime')) : null,
    step: kind === 'counter' ? num(f.get('step'), 0) || (isHourUnit(unit) ? 0.5 : 1) : 1,
    timeUnit: f.get('timeUnit') === 'min' ? 'min' : 'h',
    hours: kind === 'counter' && isHourUnit(unit) ? target : (f.get('timeUnit') === 'min' ? num(f.get('hours')) / 60 : num(f.get('hours'))),
    notes: String(f.get('notes') || '').trim(),
    track: f.get('track') === 'yes',
    ...(f.has('stageUrl') ? { stageUrl: cleanUrl(f.get('stageUrl')) } : {}),
  };
  // a Notion link among the links is kept as the task's Notion page (it gets its own button)
  const links = f.getAll('linkUrl').map((u, i) => ({ label: String(f.getAll('linkLabel')[i] || '').trim(), url: cleanUrl(u) })).filter((l) => l.url);
  const notion = links.findIndex((l) => /^https:\/\/([\w-]+\.)?notion\.(so|site|com)\//i.test(l.url));
  fields.notionUrl = notion < 0 ? '' : links.splice(notion, 1)[0].url;
  fields.links = links;
  let c = state.commitments.find((x) => x.id === form.dataset.id);
  if (c) {
    if (c.freq === 'once' && fields.freq === 'once') moveOnceItem(c.id, c.date, fields.date);
    if (c.freq !== fields.freq) fields.order = nextOrder();
    Object.assign(c, fields);
  } else {
    c = newCommitment({ ...fields, order: nextOrder() });
    state.commitments.push(c);
  }
  renumber();
  save();
  location.replace(`#/c/${c.id}`);
}

// A one-off's progress lives in the week of its date: move it if the date changes week.
function moveOnceItem(id, oldDate, newDate) {
  if (!oldDate || !newDate || weekOf(oldDate) === weekOf(newDate)) return;
  const from = state.weeks[weekOf(oldDate)];
  if (!from || !from.items[id]) return;
  const to = state.weeks[weekOf(newDate)] || (state.weeks[weekOf(newDate)] = { start: weekOf(newDate), items: {} });
  to.items[id] = from.items[id];
  delete from.items[id];
}
function removeCommitment(id) {
  state.commitments = state.commitments.filter((x) => x.id !== id);
  for (const w of Object.values(state.weeks)) delete w.items[id];
}

function deleteCommitment(id) {
  const c = state.commitments.find((x) => x.id === id);
  if (!c) return;
  const used = Object.values(state.weeks).some((w) => w.items[id] && hasData(w.items[id]));
  const msg = used
    ? `Delete “${c.name}” and all its logged progress? (Archive keeps the history instead.)`
    : `Delete “${c.name}”?`;
  if (!confirm(msg)) return;
  // Don't let the next calendar sync bring a deleted event back.
  const feed = c.source && state.calendars.feeds.find((f) => f.id === c.source.feed);
  if (feed) feed.skipped[c.source.key] = true;
  removeCommitment(id);
  renumber(); save();
  location.replace('#/commitments');
}

// ---------- Calendar import ----------
// Calendar feeds (.ics links) are fetched through /api/ics (server/ics.mjs) and their events
// become one-off tasks. Each recurring series is reviewed once (import or skip); after that,
// syncs keep imported events up to date for the current week plus the next three.
const SYNC_EVERY_MS = 20 * 60e3; // calendars refresh at most every 20 minutes (on open and while open)
const SYNC_DAYS = 28;
const calCache = {}; // feedId -> instances from the last fetch (memory only)
const pendingCount = () => state.calendars.feeds.reduce((n, f) => n + f.pending.length, 0);
function syncWindow() {
  const from = parseISO(currentWeekKey());
  return { from, to: addDays(from, SYNC_DAYS) };
}
function ago(iso) {
  if (!iso) return 'never';
  const m = Math.round((Date.now() - new Date(iso)) / 6e4);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 24 * 60) return `${Math.round(m / 60)} h ago`;
  return fmtDay(new Date(iso), { day: 'numeric', month: 'short' });
}

async function fetchIcs(url) {
  let res;
  try {
    res = await fetch('/api/ics', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }) });
  } catch {
    throw new Error('No connection. Calendar sync needs the internet.');
  }
  if (!res.ok) {
    let msg = '';
    try { msg = (await res.json()).error; } catch { /* not JSON */ }
    throw new Error(msg || `Calendar sync failed (${res.status})`);
  }
  return res.text();
}

function describeSeries(list) {
  const first = list[0];
  const days = [...new Set(list.map((i) => DAY_NAMES[dayIndexOf(i.date)]))];
  return {
    uid: first.uid, name: first.summary, count: list.length, first: first.date,
    when: first.allDay ? 'All day' : timeRange(first), days: days.join('/'), location: first.location,
    suggested: defaultDecision(list),
  };
}
const defaultDecision = (list) => (list.some((i) => i.recurring) ? 'schedule' : 'task');
const DECISION_LABEL = { schedule: 'Schedule', task: 'Task', skip: 'Skip' };

// Turn fetched instances into one-off commitments according to the feed's decisions.
function applyFeed(feed, insts) {
  const { from, to } = syncWindow();
  const fromISO = isoDate(from), lastISO = isoDate(addDays(to, -1));
  const series = new Map();
  for (const i of insts) {
    if (!series.has(i.uid)) series.set(i.uid, []);
    series.get(i.uid).push(i);
  }
  const seen = new Set();
  let added = 0, decided = 0;
  feed.pending = [];
  for (const [seriesUid, list] of series) {
    let d = feed.decisions[seriesUid];
    if (!d) {
      // New series: import straight away (repeating → schedule, single → task) unless you asked to review first.
      if (feed.ask) { feed.pending.push(describeSeries(list)); continue; }
      d = feed.decisions[seriesUid] = { d: defaultDecision(list), name: list[0].summary };
      decided++;
    }
    if (d.name !== list[0].summary) d.name = list[0].summary;
    if (d.d === 'import') d.d = defaultDecision(list); // decisions made before schedule/task existed
    const recurring = list.some((i) => i.recurring);
    if (d.recurring !== recurring) d.recurring = recurring;
    if (d.d === 'skip') continue;
    // A timetable calendar (e.g. school courses) is all schedule, whatever each event looks like.
    const schedule = feed.allSchedule || d.d === 'schedule';
    for (const inst of list) {
      if (feed.skipped[inst.key]) continue;
      seen.add(inst.key);
      const fields = { name: inst.summary, date: inst.date, time: inst.time, endTime: inst.endTime, hours: inst.hours, schedule };
      const c = state.commitments.find((x) => x.source && x.source.feed === feed.id && x.source.key === inst.key);
      if (c) {
        moveOnceItem(c.id, c.date, fields.date);
        Object.assign(c, fields);
      } else {
        const notes = [inst.location && `📍 ${inst.location}`, inst.description.slice(0, 1000)].filter(Boolean).join('\n\n');
        state.commitments.push(newCommitment({
          ...fields, id: `cal-${hash36(`${feed.id}|${inst.key}`)}`, freq: 'once', kind: 'task', section: feed.section || 'Calendar', notes,
          order: nextOrder(), source: { feed: feed.id, key: inst.key, uid: seriesUid },
        }));
        added++;
      }
    }
  }
  // Events that disappeared from the calendar (cancelled, deleted, or series skipped):
  // remove them from the window unless something was already logged.
  for (const c of [...state.commitments]) {
    if (!c.source || c.source.feed !== feed.id || seen.has(c.source.key)) continue;
    if (!c.date || c.date < fromISO || c.date > lastISO) continue;
    const it = state.weeks[weekOf(c.date)] && state.weeks[weekOf(c.date)].items[c.id];
    if (!it || !hasData(it)) removeCommitment(c.id);
  }
  renumber();
  return added;
}

async function syncFeed(feed) {
  try {
    const text = await fetchIcs(feed.url);
    calCache[feed.id] = parseIcs(text, syncWindow());
    const added = applyFeed(feed, calCache[feed.id]);
    feed.lastSync = new Date().toISOString();
    feed.lastError = null;
    return added;
  } catch (e) {
    feed.lastError = e.message;
    throw e;
  } finally {
    save();
  }
}

let syncing = false;
async function syncAll({ quiet = false, force = false, feedId = null } = {}) {
  if (syncing || !navigator.onLine && quiet) return;
  const due = state.calendars.feeds.filter((f) => (feedId ? f.id === feedId : true) &&
    (force || !f.lastSync || Date.now() - new Date(f.lastSync) > SYNC_EVERY_MS));
  if (!due.length) return;
  syncing = true;
  if (!quiet) toast('Syncing calendar…');
  let added = 0, error = null;
  for (const f of due) {
    try { added += await syncFeed(f); } catch (e) { error = e; }
  }
  syncing = false;
  if (!sheetCtx && !formOpen()) render();
  const pending = pendingCount();
  if (error && !quiet) toast(error.message);
  else if (added) toast(`Added ${added} calendar event${added === 1 ? '' : 's'}`);
  else if (!quiet) toast(pending ? `${pending} new event series to review` : 'Calendar up to date');
}

function addFeed(form) {
  const f = new FormData(form);
  const raw = String(f.get('url') || '').trim().replace(/^webcals?:\/\//i, 'https://');
  let url;
  try { url = new URL(raw); } catch { toast('Paste the full calendar link (starts with https:// or webcal://)'); return; }
  if (url.protocol !== 'https:') { toast('The calendar link must start with https:// or webcal://'); return; }
  const hint = calendarLinkHint(url);
  if (hint) { alert(hint); return; }
  const feed = {
    id: uid(), name: String(f.get('name') || '').trim() || 'Calendar', url: url.href,
    section: String(f.get('section') || '').trim() || 'Calendar',
    lastSync: null, lastError: null, decisions: {}, skipped: {}, pending: [], ask: false,
    allSchedule: f.get('allSchedule') === 'on',
    color: CAL_COLORS[state.calendars.feeds.length % CAL_COLORS.length],
  };
  state.calendars.feeds.push(feed);
  save();
  form.reset();
  render();
  syncAll({ force: true, feedId: feed.id }).then(() => {
    if (feed.pending.length && !feed.lastError) location.hash = '#/calendar/review';
  });
}

// Catch links that are clearly not a usable calendar feed before trying to sync.
function calendarLinkHint(url) {
  if (url.hostname !== 'calendar.google.com') return '';
  const p = decodeURIComponent(url.pathname);
  if (!p.includes('/ical/')) return 'That’s a Google Calendar sharing or settings link, not the iCal address.\n\nIn Google Calendar settings, open the calendar → Integrate calendar → copy “Secret address in iCal format”.';
  if (p.includes('@import.calendar.google.com')) return 'This is a calendar you subscribed to in Google (e.g. a school timetable). Google can’t share those again.\n\nUse the original link you subscribed with, e.g. the iCal/subscribe link from your school timetable.';
  if (p.endsWith('/public/basic.ics')) return 'That’s the public address, which only works if the calendar is public.\n\nUse “Secret address in iCal format” instead. For a calendar you subscribed to (like a school timetable), use the original link you subscribed with.';
  return '';
}

function removeFeed(id) {
  const feed = state.calendars.feeds.find((f) => f.id === id);
  if (!feed || !confirm(`Disconnect “${feed.name}”? Imported events you haven't ticked are removed; logged ones are kept.`)) return;
  for (const c of [...state.commitments]) {
    if (!c.source || c.source.feed !== id) continue;
    const it = c.date && state.weeks[weekOf(c.date)] && state.weeks[weekOf(c.date)].items[c.id];
    if (it && hasData(it)) c.source = null;
    else removeCommitment(c.id);
  }
  state.calendars.feeds = state.calendars.feeds.filter((f) => f.id !== id);
  delete calCache[id];
  renumber(); save(); render();
}

function setDecision(feedId, seriesUid, d) {
  const feed = state.calendars.feeds.find((f) => f.id === feedId);
  if (!feed || !feed.decisions[seriesUid] || !DECISION_LABEL[d]) return;
  feed.decisions[seriesUid].d = d;
  save();
  if (calCache[feed.id]) { applyFeed(feed, calCache[feed.id]); save(); render(); }
  else syncAll({ force: true, feedId });
  toast(d === 'skip' ? 'Stopped importing this series' : `Importing as ${DECISION_LABEL[d].toLowerCase()}`);
}

function submitReview(form) {
  const fd = new FormData(form);
  let imported = 0, needSync = false;
  for (const feed of state.calendars.feeds) {
    if (!feed.pending.length) continue;
    for (const p of feed.pending) {
      const d = DECISION_LABEL[fd.get(`d:${feed.id}|${p.uid}`)] ? fd.get(`d:${feed.id}|${p.uid}`) : p.suggested || 'task';
      feed.decisions[p.uid] = { d, name: p.name };
      if (d !== 'skip') imported++;
    }
    if (calCache[feed.id]) applyFeed(feed, calCache[feed.id]);
    else needSync = true;
  }
  save();
  if (needSync) syncAll({ force: true });
  toast(imported ? `Importing ${imported} series` : 'Skipped');
  location.hash = '#/plan';
}

function reviewBannerHtml() {
  const n = pendingCount();
  return n ? `<a class="banner" href="#/calendar/review"><span>📅</span><span><b>${n} new calendar event${n === 1 ? '' : 's'}</b>
    <small>Choose which to track</small></span><span class="chev">›</span></a>` : '';
}

function sourceNoteHtml(c) {
  if (!c.source) return '';
  const feed = state.calendars.feeds.find((f) => f.id === c.source.feed);
  return `<p class="source-note">📅 From ${escapeHtml(feed ? feed.name : 'your calendar')}. Date and time follow the calendar.</p>`;
}

// Tasks linked to applications (+ Today and follow-ups), grouped by application.
function applicationsCardHtml() {
  const linked = state.commitments.filter((c) => c.appRef && !c.archived);
  if (!linked.length) return '';
  const groups = new Map();
  for (const c of linked.sort((x, y) => onceSortKey(x).localeCompare(onceSortKey(y)))) {
    if (!groups.has(c.appRef)) groups.set(c.appRef, []);
    groups.get(c.appRef).push(c);
  }
  const companyOf = (id, list) => (state.apps.items.find((a) => a.id === id) || {}).company || list[0].name.split(' · ')[0].replace(/^Apply: /, '');
  return `<section class="card">
    <div class="card-head"><h2>Applications</h2><a class="txt-btn" href="#/apps">All roles ›</a></div>
    ${[...groups].map(([id, list]) => `<div class="sec">${escapeHtml(companyOf(id, list))}</div>
      ${list.map((c) => `<a class="crow" href="#/c/${c.id}"><div class="ctext"><div class="n">${onceDone(c) ? '✓ ' : ''}${escapeHtml(c.stage ? `${c.stage}${stageInfo(c.stage)[1] !== c.stage ? ` · ${stageInfo(c.stage)[1]}` : ''}` : c.name)}</div>
        <div class="sub">${c.date ? `${fmtShort(c.date)}${c.time ? ` · ${c.time}` : ''}` : 'Date TBC'}</div></div><span class="chev">›</span></a>`).join('')}`).join('')}
  </section>`;
}

function calendarsCardHtml() {
  const feeds = state.calendars.feeds;
  return `<section class="card">
    <div class="card-head"><h2>Calendars</h2><a class="txt-btn" href="#/calendar">${feeds.length ? 'Manage' : '+ Connect'}</a></div>
    ${feeds.length ? feeds.map((f) => `<a class="crow" href="#/calendar"><div class="ctext"><div class="n">${escapeHtml(f.name)}</div>
      <div class="sub ${f.lastError ? 'err' : ''}">${f.lastError ? escapeHtml(f.lastError) : `Synced ${ago(f.lastSync)}`}</div></div><span class="chev">›</span></a>`).join('')
      : '<p class="muted small pad">Import lectures, seminars and meetings from Google, Apple or Outlook as one-off tasks.</p>'}
  </section>`;
}

function calendarPageHtml() {
  const feeds = state.calendars.feeds;
  const feedCard = (f) => {
    const entries = Object.entries(f.decisions).sort((a, b) => (a[1].name || '').localeCompare(b[1].name || ''));
    const counts = { schedule: 0, task: 0, skip: 0 };
    for (const [, v] of entries) counts[v.d === 'import' ? 'task' : v.d] = (counts[v.d === 'import' ? 'task' : v.d] || 0) + 1;
    const row = ([u, v]) => {
      let cur = v.d === 'import' ? (v.recurring ? 'schedule' : 'task') : v.d;
      if (f.allSchedule && cur !== 'skip') cur = 'schedule';
      return `<div class="crow"><div class="ctext"><div class="n">${escapeHtml(v.name || u)}</div>
        <div class="sub">${v.recurring ? 'Repeating' : 'One-off'}</div></div>
        <span class="seg-mini">${['schedule', 'task', 'skip'].filter((d) => !(f.allSchedule && d === 'task')).map((d) => `<button class="${d === cur ? 'on' : ''}" data-act="cal-decide" data-feed="${f.id}" data-uid="${escapeHtml(u)}" data-d="${d}">${DECISION_LABEL[d]}</button>`).join('')}</span></div>`;
    };
    return `<section class="card">
      <div class="card-head"><h2>${escapeHtml(f.name)}</h2><span class="hint">→ section “${escapeHtml(f.section)}”</span></div>
      <p class="small pad ${f.lastError ? 'err' : 'muted'}">${f.lastError ? '⚠️ ' + escapeHtml(f.lastError) : `Synced ${ago(f.lastSync)} · updates automatically while the app is open`}</p>
      <div class="btn-row">
        <button class="btn" data-act="cal-sync" data-feed="${f.id}">Sync now</button>
        ${f.pending.length ? `<a class="btn primary" href="#/calendar/review">Review ${f.pending.length} new</a>` : ''}
      </div>
      <div class="swatches" role="radiogroup" aria-label="Calendar colour">${CAL_COLORS.map((c, i) => {
        const cur = f.color || CAL_COLORS[state.calendars.feeds.indexOf(f) % CAL_COLORS.length];
        return `<button class="swatch ${c === cur ? 'on' : ''}" style="--sw:${c}" data-act="cal-color" data-feed="${f.id}" data-color="${c}" aria-label="Colour ${i + 1}" aria-pressed="${c === cur}"></button>`;
      }).join('')}</div>
      <label class="toggle-row"><input type="checkbox" data-act="cal-allsched" data-feed="${f.id}" ${f.allSchedule ? 'checked' : ''}>
        <span>This is my timetable<small>All its events show as schedule (not one-off tasks): on the calendar and in Today's schedule, and not counted in your hours.</small></span></label>
      <label class="toggle-row"><input type="checkbox" data-act="cal-ask" data-feed="${f.id}" ${f.ask ? 'checked' : ''}>
        <span>Ask me before importing new events<small>Off: repeating events become schedule, one-offs become tasks.</small></span></label>
      ${entries.length ? `<details class="fold-in"><summary>Series (${counts.schedule} schedule · ${counts.task} task · ${counts.skip} skipped)</summary>${entries.map(row).join('')}</details>` : ''}
      <button class="btn warn full" data-act="cal-remove" data-feed="${f.id}">Disconnect</button>
    </section>`;
  };
  return `
    <header class="top">
      ${topBar({ left: '<button class="icon-btn" data-act="back" aria-label="Back">‹</button>', label: 'Your timetable and events', title: 'Calendars' })}
    </header>
    ${feeds.map(feedCard).join('')}
    <form class="card form" data-form="calendar-add">
      <div class="card-head"><h2>${feeds.length ? 'Add another calendar' : 'Connect a calendar'}</h2></div>
      <label class="f">Calendar link (iCal / .ics)<input name="url" required inputmode="url" autocapitalize="off" autocorrect="off" placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"></label>
      <label class="toggle-row"><input type="checkbox" name="allSchedule">
        <span>This is my timetable<small>All its events are schedule (classes, lectures), never one-off tasks.</small></span></label>
      <div class="f2">
        <label class="f">Name<input name="name" placeholder="e.g. Google Calendar"></label>
        <label class="f">Put events in section<input name="section" list="sections" placeholder="Calendar"></label>
      </div>
      <datalist id="sections">${sectionNames().map((s) => `<option value="${escapeHtml(s)}">`).join('')}</datalist>
      <button class="btn primary" type="submit">Connect</button>
      <p class="help">🔒 The link is stored only on this phone. Anyone with it can read that calendar, so treat it like a password.</p>
    </form>
    <section class="card howto">
      <div class="card-head"><h2>Where to find the link</h2></div>
      <details class="fold-in" open><summary>Google Calendar</summary><ol>
        <li>On a computer, open calendar.google.com → ⚙️ <b>Settings</b>.</li>
        <li>Under <b>Settings for my calendars</b>, click your calendar → <b>Integrate calendar</b>.</li>
        <li>Copy <b>Secret address in iCal format</b> and paste it above (AirDrop or Notes to get it to your phone).</li></ol>
        <p class="help">Calendars you <b>subscribed to</b> in Google (under “Other calendars”, e.g. a school timetable) have no secret address. Use the original link instead (see below).</p></details>
      <details class="fold-in"><summary>School timetable (or any subscribed calendar)</summary><ol>
        <li>Go back to where you got the calendar link, e.g. your timetable’s <b>Subscribe</b> / <b>iCal</b> / <b>Add to calendar</b> option.</li>
        <li>Copy that link (it often starts with <b>webcal://</b> or ends in <b>.ics</b>) and paste it above.</li>
        <li>You can keep it in Google Calendar too; the two don’t interfere.</li></ol></details>
      <details class="fold-in"><summary>Outlook / school email calendar</summary><ol>
        <li>Open outlook.office.com → ⚙️ <b>Settings</b> → <b>Calendar</b> → <b>Shared calendars</b>.</li>
        <li>Under <b>Publish a calendar</b>, pick your calendar and <b>Can view all details</b> → <b>Publish</b>.</li>
        <li>Copy the <b>ICS</b> link.</li></ol></details>
      <details class="fold-in"><summary>Apple iCloud Calendar</summary><ol>
        <li>iPhone <b>Calendar</b> app → <b>Calendars</b> → ⓘ next to the calendar.</li>
        <li>Turn on <b>Public Calendar</b> → <b>Share Link</b> → Copy.</li>
        <li>Note: anyone with this link can see the calendar.</li></ol></details>
    </section>`;
}

function reviewPageHtml() {
  const feeds = state.calendars.feeds.filter((f) => f.pending.length);
  if (!feeds.length) {
    return `<header class="top">${topBar({ left: '<button class="icon-btn" data-act="back" aria-label="Back">‹</button>', title: 'New calendar events' })}</header>
      <section class="card empty"><p>Nothing new to review.</p><a class="btn" href="#/calendar">Calendars</a></section>`;
  }
  return `
    <header class="top">
      ${topBar({ left: '<button class="icon-btn" data-act="back" aria-label="Back">‹</button>', label: 'Next 4 weeks', title: 'New calendar events' })}
    </header>
    <form data-form="review">
      ${feeds.map((f) => `<section class="card">
        <div class="card-head"><h2>${escapeHtml(f.name)}</h2></div>
        ${f.pending.map((p) => `<div class="rrow">
          <span class="ctext"><span class="n">${escapeHtml(p.name)}</span>
          <span class="sub">${p.count > 1 ? `${p.days} · ${escapeHtml(p.when)} · ${p.count}×` : `${fmtShort(p.first)} · ${escapeHtml(p.when)}`}${p.location ? ' · ' + escapeHtml(p.location) : ''}</span></span>
          <select name="d:${f.id}|${escapeHtml(p.uid)}" aria-label="Import as">
            ${['schedule', 'task', 'skip'].map((d) => `<option value="${d}" ${d === (p.suggested || 'task') ? 'selected' : ''}>${DECISION_LABEL[d]}</option>`).join('')}
          </select></div>`).join('')}
      </section>`).join('')}
      <div class="sticky-actions">
        <button class="btn primary full" type="submit">Save</button>
        <p class="help center"><b>Schedule</b>: shown on your calendar (lectures, classes). <b>Task</b>: something to tick off (a coffee chat). Decided once per series; change it anytime in All commitments → Calendars.</p>
      </div>
    </form>`;
}

// ---------- Phone widget (Scriptable) ----------
// The widget can't read this app's storage, so the app sends a compact summary to /api/widget
// under a random key; the Scriptable script (widget/commitments-widget.js) reads it back.
const WIDGET_PUSH_DELAY = 3000;
let widgetTimer = null;
let lastWidgetSig = '';
let widgetTemplate = null;

function newWidgetKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function widgetSnapshot() {
  const wk = currentWeekKey();
  const w = getWeek(wk);
  const ws = weekStats(w);
  return {
    v: 1,
    updatedAt: new Date().toISOString(),
    week: wk,
    days: DAY_NAMES.map((_, i) => {
      const d = dayStats(w, i);
      return { done: d.done, total: d.total, actual: round2(d.actual), planned: round2(d.planned) };
    }),
    stats: { planned: round2(ws.planned), actual: round2(ws.actual), pct: Math.round(ws.pct * 100) },
    daily: itemsOf(w, 'daily').map(([, it]) => ({
      n: it.name, k: it.kind === 'counter' ? 'c' : 't', tg: it.target, u: it.unit,
      d: it.ticks.map((t, i) => (it.kind === 'task' ? (t ? 1 : 0) : it.counts[i])),
    })),
    once: itemsOf(w, 'once').filter(isTask).map(([, it]) => ({
      n: it.name, date: it.date, time: it.time, endTime: it.endTime, done: periodDone(it) ? 1 : 0,
    })),
    weekly: itemsOf(w, 'weekly').map(([, it]) => ({
      n: it.name, k: it.kind === 'counter' ? 'c' : 't', tg: it.kind === 'counter' ? it.target : 1, u: it.unit,
      c: it.kind === 'counter' ? it.count : it.done ? 1 : 0, done: periodDone(it) ? 1 : 0,
    })),
  };
}

function scheduleWidgetPush(delay = WIDGET_PUSH_DELAY) {
  if (!state.widget.enabled) return;
  clearTimeout(widgetTimer);
  widgetTimer = setTimeout(() => pushWidget(), delay);
}

async function pushWidget({ force = false } = {}) {
  clearTimeout(widgetTimer);
  widgetTimer = null;
  const wd = state.widget;
  if (!wd.enabled || !wd.token) return false;
  const snap = widgetSnapshot();
  const { updatedAt, ...rest } = snap;
  const sig = JSON.stringify(rest);
  if (!force && sig === lastWidgetSig) return true;
  try {
    const res = await fetch('/api/widget', {
      method: 'PUT', keepalive: true, body: JSON.stringify(snap),
      headers: { authorization: `Bearer ${wd.token}`, 'content-type': 'application/json' },
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Widget update failed (${res.status})`);
    lastWidgetSig = sig;
    wd.lastPush = updatedAt;
    wd.lastError = null;
    return true;
  } catch (e) {
    wd.lastError = navigator.onLine ? e.message : 'Offline. Will send when you are back online.';
    return false;
  } finally {
    writeState().catch(() => {});
    if (route.page === 'widget') render();
  }
}

async function deleteWidgetData(token) {
  const res = await fetch('/api/widget', { method: 'DELETE', headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error('Couldn’t reach the server. Try again when online.');
}

function widgetScript() {
  return widgetTemplate && widgetTemplate.replaceAll('__WIDGET_KEY__', state.widget.token).replaceAll('__ORIGIN__', location.origin);
}
async function loadWidgetTemplate() {
  if (widgetTemplate) return;
  try {
    widgetTemplate = await (await fetch('widget/commitments-widget.js')).text();
    if (route.page === 'widget') render();
  } catch { /* shown as unavailable on the page */ }
}

async function widgetAction(act) {
  const wd = state.widget;
  if (act === 'widget-on') {
    wd.enabled = true;
    wd.token = wd.token || newWidgetKey();
    save(); render();
    if (await pushWidget({ force: true })) toast('Widget sharing is on');
  } else if (act === 'widget-send') {
    toast((await pushWidget({ force: true })) ? 'Sent to widget' : wd.lastError);
  } else if (act === 'widget-off' || act === 'widget-reset') {
    if (act === 'widget-reset' && !confirm('Make a new widget key? Widgets using the old script stop working until you paste the new script.')) return;
    try { await deleteWidgetData(wd.token); } catch (e) { toast(e.message); return; }
    lastWidgetSig = '';
    if (act === 'widget-off') { wd.enabled = false; wd.token = null; wd.lastPush = null; wd.lastError = null; save(); render(); toast('Widget sharing is off'); }
    else { wd.token = newWidgetKey(); save(); render(); await pushWidget({ force: true }); toast('New key made. Copy the script again.'); }
  } else if (act === 'widget-copy') {
    const script = widgetScript();
    if (!script) { toast('Script still loading…'); return; }
    navigator.clipboard.writeText(script)
      .then(() => toast('Widget script copied'))
      .catch(() => { const d = document.getElementById('scriptBox'); if (d) { d.open = true; d.querySelector('textarea').select(); } toast('Select the script below and copy it'); });
  }
}

function widgetPageHtml() {
  const wd = state.widget;
  const back = '<button class="icon-btn" data-act="back" aria-label="Back">‹</button>';
  if (!wd.enabled) {
    return `
      <header class="top">${topBar({ left: back, label: 'Scriptable', title: 'Phone widget' })}</header>
      <section class="card">
        <div class="card-head"><h2>Today on your Home Screen</h2></div>
        <p class="pad">See today's progress and what's left, on your Home Screen, Lock Screen or Mac desktop, using the free <b>Scriptable</b> app.</p>
        <p class="pad small muted">How it works: when you log something, this app sends a short summary (commitment names and today's and this week's progress) to your own site under a private random key. The widget reads it from there. Nothing else leaves your phone.</p>
        <button class="btn primary full" data-act="widget-on">Turn on</button>
      </section>`;
  }
  loadWidgetTemplate();
  const script = widgetScript();
  return `
    <header class="top">${topBar({ left: back, label: 'Scriptable', title: 'Phone widget' })}</header>
    <section class="card">
      <div class="card-head"><h2>Sharing is on</h2></div>
      <p class="small pad ${wd.lastError ? 'err' : 'muted'}">${wd.lastError ? '⚠️ ' + escapeHtml(wd.lastError) : `Last sent ${ago(wd.lastPush)}. Updates a few seconds after each change.`}</p>
      <div class="btn-row"><button class="btn" data-act="widget-send">Send now</button><button class="btn" data-act="widget-off">Turn off</button></div>
    </section>
    <section class="card howto">
      <div class="card-head"><h2>Set up the widget</h2></div>
      <ol>
        <li>Install <b>Scriptable</b> from the App Store (free).</li>
        <li><button class="btn primary" data-act="widget-copy" ${script ? '' : 'disabled'}>Copy widget script</button></li>
        <li>Open Scriptable → tap <b>+</b> → paste → tap the title at the top, rename it <b>Commitments</b> → <b>Done</b>.</li>
        <li>Long-press your Home Screen → <b>Edit</b> → <b>Add Widget</b> → search <b>Scriptable</b> → pick a size → <b>Add Widget</b>.</li>
        <li>Long-press the new widget → <b>Edit Widget</b> → <b>Script</b>: <b>Commitments</b>.</li>
      </ol>
      <details class="fold-in"><summary>Lock Screen</summary><ol>
        <li>Long-press the Lock Screen → <b>Customize</b> → <b>Lock Screen</b> → tap the widget area.</li>
        <li>Add a <b>Scriptable</b> widget, tap it, and choose <b>Commitments</b>.</li></ol></details>
      <details class="fold-in"><summary>Mac desktop (macOS Sonoma or later)</summary><ol>
        <li>Your Mac must use the same Apple ID as your iPhone.</li>
        <li>Right-click the desktop → <b>Edit Widgets</b> → find <b>Scriptable</b> under your iPhone → drag a widget onto the desktop.</li>
        <li>Then right-click it → <b>Edit</b> → choose <b>Commitments</b>.</li></ol></details>
      <details class="fold-in" id="scriptBox"><summary>Show script</summary>
        <textarea readonly rows="8" class="code">${escapeHtml(script || 'Loading…')}</textarea></details>
      <p class="help">The widget shows what this app last sent, so it updates when you use the app. Tapping the widget opens Scriptable.</p>
    </section>
    <section class="card">
      <div class="card-head"><h2>Private key</h2></div>
      <p class="small pad muted">The script contains a private key. If you shared it by mistake, make a new one; old copies stop working.</p>
      <button class="btn warn full" data-act="widget-reset">Make a new key</button>
    </section>`;
}

// ---------- Sync between devices ----------
// The data is split into records: "c:<id>" commitments, "ws:<week>:<id>" week item details,
// "wp:<week>:<id>" week item progress and "f:<id>" calendar feeds. Each local change is stamped
// with the time it was made; only changed records are sent, and the server keeps the newest
// version of each (see server/sync.mjs). Splitting progress from details means that
// renaming something on one device can't undo a tick made on the other.
const SYNC_DEBOUNCE_MS = 2000;
const SYNC_POLL_MS = 120000; // data sync check while the app sits open (changes still sync ~2s after you make them)
const PROGRESS_FIELDS = ['ticks', 'counts', 'mins', 'count', 'done'];
const FEED_FIELDS = ['id', 'name', 'url', 'section', 'decisions', 'skipped', 'ask', 'allSchedule', 'color'];
// Calendar colours (the theme's light blue, salmon, gold and light green, plus a few more).
const CAL_COLORS = ['#add8e6', '#fa8072', '#ffd700', '#90ee90', '#c7b8f5', '#f7a8c8', '#9fe3d6', '#c9c9c9'];
const RECORD_ORDER = { c: 0, f: 1, ws: 2, wp: 3, t: 4, x: 5, b: 6, n: 7 };
let recordHashes = null; // record key -> JSON of the record as last stamped or received
let syncTimer = null;
let syncInFlight = null;
let syncAgain = false;

const freshSync = () => ({ enabled: false, key: null, version: 0, stamps: {}, dirty: {}, tombs: {}, lastSync: null, lastError: null });
function stableStringify(v) {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v === undefined ? null : v);
}
const pick = (o, fields) => { const r = {}; for (const f of fields) if (o[f] !== undefined) r[f] = o[f]; return r; };
const omit = (o, fields) => { const r = {}; for (const [k, v] of Object.entries(o)) if (!fields.includes(k)) r[k] = v; return r; };
const progressHasData = (p) => (p.ticks || []).some(Boolean) || (p.counts || []).some((n) => n > 0) ||
  (p.mins || []).some((m) => m != null) || p.count > 0 || !!p.done;
function splitKey(k) {
  const i = k.indexOf(':');
  const type = k.slice(0, i), rest = k.slice(i + 1);
  if (type === 'ws' || type === 'wp') { const j = rest.indexOf(':'); return [type, rest.slice(0, j), rest.slice(j + 1)]; }
  return [type, rest];
}

function recordPayloads() {
  const out = new Map();
  for (const c of state.commitments) out.set(`c:${c.id}`, c);
  for (const [wk, w] of Object.entries(state.weeks)) {
    for (const [id, it] of Object.entries(w.items)) {
      out.set(`ws:${wk}:${id}`, omit(it, PROGRESS_FIELDS));
      out.set(`wp:${wk}:${id}`, pick(it, PROGRESS_FIELDS));
    }
  }
  for (const f of state.calendars.feeds) out.set(`f:${f.id}`, pick(f, FEED_FIELDS));
  for (const t of state.trees) out.set(`t:${t.id}`, t);
  for (const x of state.tests) out.set(`x:${x.id}`, x);
  for (const n of state.notes) out.set(`n:${n.id}`, n);
  if (state.buddy) out.set('b:pact', state.buddy);
  return out;
}
function payloadFor(k) {
  const [type, a, b] = splitKey(k);
  if (type === 'c') return state.commitments.find((x) => x.id === a);
  if (type === 'f') { const f = state.calendars.feeds.find((x) => x.id === a); return f && pick(f, FEED_FIELDS); }
  if (type === 't') return state.trees.find((x) => x.id === a);
  if (type === 'x') return state.tests.find((x) => x.id === a);
  if (type === 'n') return state.notes.find((x) => x.id === a);
  if (type === 'b') return state.buddy || undefined;
  const it = state.weeks[a] && state.weeks[a].items[b];
  if (!it) return undefined;
  return type === 'ws' ? omit(it, PROGRESS_FIELDS) : pick(it, PROGRESS_FIELDS);
}
function rememberHash(k) {
  const p = payloadFor(k);
  if (p === undefined) recordHashes.delete(k); else recordHashes.set(k, stableStringify(p));
}
function resetRecordHashes() {
  recordHashes = new Map();
  for (const [k, p] of recordPayloads()) recordHashes.set(k, stableStringify(p));
}

// Compares every record with how it looked last time and stamps the ones that changed.
function stampChanges() {
  const S = state.sync;
  if (!S.enabled) return false;
  if (!recordHashes) resetRecordHashes();
  const now = Date.now();
  const current = recordPayloads();
  let changed = false;
  for (const [k, p] of current) {
    const h = stableStringify(p);
    const prev = recordHashes.get(k);
    if (prev === h) continue;
    // A week freshly created on this device starts empty; that must never beat real ticks from elsewhere.
    const emptyNew = prev === undefined && k.startsWith('wp:') && !progressHasData(p);
    S.stamps[k] = emptyNew ? 0 : now;
    S.dirty[k] = 1;
    delete S.tombs[k];
    recordHashes.set(k, h);
    changed = true;
  }
  for (const k of [...recordHashes.keys()]) {
    if (current.has(k) || !(splitKey(k)[0] in RECORD_ORDER)) continue;
    recordHashes.delete(k);
    S.tombs[k] = now;
    delete S.dirty[k];
    delete S.stamps[k];
    changed = true;
  }
  return changed;
}

function applyRecord(k, p) {
  const [type, a, b] = splitKey(k);
  if (type === 'c') {
    const c = normaliseCommitment(p);
    const i = state.commitments.findIndex((x) => x.id === c.id);
    if (i >= 0) state.commitments[i] = c; else state.commitments.push(c);
  } else if (type === 't' || type === 'x' || type === 'n') {
    const list = type === 't' ? state.trees : type === 'x' ? state.tests : state.notes;
    const v = type === 'n' ? normaliseNote(p) : p; // tree and test records are only kept
    const i = list.findIndex((x) => x.id === v.id);
    if (i >= 0) list[i] = v; else list.push(v);
  } else if (type === 'b') {
    state.buddy = { commitmentId: p.commitmentId || null };
  } else if (type === 'f') {
    const f = state.calendars.feeds.find((x) => x.id === p.id);
    if (f) Object.assign(f, pick(p, FEED_FIELDS));
    else state.calendars.feeds.push({ lastSync: null, lastError: null, pending: [], decisions: {}, skipped: {}, ...pick(p, FEED_FIELDS) });
  } else {
    const w = state.weeks[a] || (state.weeks[a] = { start: a, items: {} });
    const it = w.items[b] || (w.items[b] = {});
    if (type === 'ws') {
      for (const f of Object.keys(it)) if (!PROGRESS_FIELDS.includes(f)) delete it[f];
      Object.assign(it, omit(p, PROGRESS_FIELDS));
    } else {
      Object.assign(it, pick(p, PROGRESS_FIELDS));
    }
    normaliseItem(it);
  }
}
function removeRecord(k) {
  const [type, a, b] = splitKey(k);
  if (type === 'c') state.commitments = state.commitments.filter((x) => x.id !== a);
  else if (type === 'f') state.calendars.feeds = state.calendars.feeds.filter((x) => x.id !== a);
  else if (type === 't') state.trees = state.trees.filter((x) => x.id !== a);
  else if (type === 'x') state.tests = state.tests.filter((x) => x.id !== a);
  else if (type === 'n') state.notes = state.notes.filter((x) => x.id !== a);
  else if (type === 'b') state.buddy = null;
  else if (state.weeks[a]) delete state.weeks[a].items[b];
}

// Applies changes from the server, unless this device has a newer unsent change to the same record.
function applyRemote({ records = {}, tombs = {} }) {
  const S = state.sync;
  stampChanges(); // anything edited while the request was in flight counts as a local change
  let applied = 0;
  // Records of a kind this version doesn't know (from a newer version on another device) are left
  // alone: applying them would misfile them, and forgetting them later would delete them everywhere.
  const known = (k) => splitKey(k)[0] in RECORD_ORDER;
  const keys = Object.keys(records).filter(known).sort((x, y) => RECORD_ORDER[splitKey(x)[0]] - RECORD_ORDER[splitKey(y)[0]]);
  for (const k of keys) {
    const { p, m } = records[k];
    if (S.dirty[k] && (S.stamps[k] || 0) > m) continue;
    applyRecord(k, p);
    S.stamps[k] = m;
    delete S.dirty[k];
    delete S.tombs[k];
    const [type, a, b] = splitKey(k);
    if (type === 'ws' || type === 'wp') { rememberHash(`ws:${a}:${b}`); rememberHash(`wp:${a}:${b}`); } else rememberHash(k);
    applied++;
  }
  for (const [k, t] of Object.entries(tombs)) {
    if (!known(k)) continue;
    if (S.dirty[k] && (S.stamps[k] || 0) > t) continue;
    removeRecord(k);
    delete S.stamps[k];
    delete S.dirty[k];
    const [type, a, b] = splitKey(k);
    if (type === 'ws' || type === 'wp') { rememberHash(`ws:${a}:${b}`); rememberHash(`wp:${a}:${b}`); } else rememberHash(k);
    applied++;
  }
  return applied;
}

function scheduleSync(delay = SYNC_DEBOUNCE_MS) {
  if (!state.sync.enabled) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncNow(), delay);
}

async function syncNow({ join = false } = {}) {
  const S = state.sync;
  if (!S.enabled || !S.key) return 0;
  if (syncInFlight) { syncAgain = true; return syncInFlight; }
  clearTimeout(syncTimer);
  syncInFlight = (async () => {
    if (saveTimer !== null) flush(); else stampChanges();
    const payloads = recordPayloads();
    const records = {}, sentStamps = {}, tombs = { ...S.tombs };
    for (const k of Object.keys(S.dirty)) {
      const p = payloads.get(k);
      if (p === undefined) { delete S.dirty[k]; continue; }
      records[k] = { p, m: S.stamps[k] || 0 };
      sentStamps[k] = S.stamps[k] || 0;
    }
    let res, body;
    try {
      res = await fetch('/api/sync', {
        method: 'POST',
        headers: { authorization: `Bearer ${S.key}`, 'content-type': 'application/json' },
        // kinds: the record kinds this version understands (the server ignores deletions of other kinds).
        body: JSON.stringify({ since: S.version, join, records, tombs, kinds: Object.keys(RECORD_ORDER) }),
      });
      body = await res.json().catch(() => ({}));
    } catch {
      S.lastError = 'Offline. Will sync when you’re back online.';
      return -1;
    }
    if (res.status === 410) { stopSync(); S.lastError = body.error; toast(body.error); return -1; }
    if (!res.ok) { S.lastError = body.error || `Sync failed (${res.status})`; return -1; }
    // What was sent is now on the server, unless it changed again while the request was in flight.
    for (const k of Object.keys(sentStamps)) if ((S.stamps[k] || 0) === sentStamps[k]) delete S.dirty[k];
    for (const [k, t] of Object.entries(tombs)) if (S.tombs[k] === t) delete S.tombs[k];
    const applied = applyRemote(body);
    S.version = body.version;
    S.lastSync = new Date().toISOString();
    S.lastError = null;
    return applied;
  })();
  try {
    const applied = await syncInFlight;
    writeState().catch(() => {});
    if (applied > 0) {
      scheduleWidgetPush();
      scheduleOutbound();
      if (!formOpen() && !sheetCtx && !typing()) render();
    } else if (route.page === 'sync') {
      render();
    }
    return applied;
  } finally {
    syncInFlight = null;
    if (syncAgain) { syncAgain = false; scheduleSync(300); }
  }
}

function stopSync() {
  clearTimeout(syncTimer);
  state.sync = freshSync();
  recordHashes = null;
  save();
  render();
}

async function startSync(key = newWidgetKey()) {
  state.sync = { ...freshSync(), enabled: true, key };
  recordHashes = new Map(); // everything on this device counts as new
  stampChanges();
  save();
  render();
  toast('Uploading your data…');
  const r = await syncNow();
  if (!state.account) toast(r >= 0 ? 'Sync is on. Copy the key to your other device.' : state.sync.lastError);
}

async function joinSync(form) {
  const key = String(new FormData(form).get('key') || '').trim();
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(key)) { toast('That doesn’t look like a sync key. Copy it again from your other device.'); return; }
  return joinWithKey(key);
}
// Replaces this device's data with the synced data behind `key` (from the sync form or a passkey sign-in).
async function joinWithKey(key, { done = 'Synced with your other device' } = {}) {
  const hasProgress = Object.values(state.weeks).some((w) => Object.values(w.items).some(hasData)) || state.notes.length || state.tests.length || state.trees.length;
  if (hasProgress && !confirm('Replace everything on this device with your synced data?')) return;
  const before = JSON.parse(JSON.stringify(state));
  state.commitments = [];
  state.weeks = {};
  state.calendars.feeds = [];
  state.trees = []; state.tests = []; state.notes = []; state.buddy = null; buddyView = null;
  state.apps = { items: [], fetchedAt: null, error: null, setup: false };
  state.sync = { ...freshSync(), enabled: true, key };
  recordHashes = new Map();
  toast('Joining…');
  const r = await syncNow({ join: true });
  if (r < 0) {
    const err = state.sync.lastError;
    state = before;
    recordHashes = null;
    save(); render();
    toast(err || 'Couldn’t join');
    return;
  }
  save();
  toast(done);
  location.hash = '#/plan';
  refreshBuddy();
}

async function syncAction(act) {
  if (act === 'sync-on') return startSync();
  if (act === 'sync-now') {
    const r = await syncNow();
    toast(r < 0 ? state.sync.lastError : r ? `Synced · ${r} change${r === 1 ? '' : 's'}` : 'Up to date');
  } else if (act === 'sync-copy') {
    navigator.clipboard.writeText(state.sync.key).then(() => toast('Sync key copied'), () => {
      const i = document.getElementById('syncKey'); if (i) { i.select(); } toast('Select the key and copy it');
    });
  } else if (act === 'sync-off') {
    if (!confirm('Stop syncing on this device? Your data stays here; your other devices keep syncing.')) return;
    stopSync();
    toast('Sync is off on this device');
  } else if (act === 'sync-delete') {
    if (!confirm('Delete the synced copy from the server? Every device stops syncing. Data already on each device is kept.')) return;
    try {
      const res = await fetch('/api/sync', { method: 'DELETE', headers: { authorization: `Bearer ${state.sync.key}` } });
      if (!res.ok) throw new Error();
    } catch { toast('Couldn’t reach the server. Try again when online.'); return; }
    stopSync();
    toast('Synced copy deleted');
  }
}

function syncPageHtml() {
  const S = state.sync;
  const back = '<button class="icon-btn" data-act="back" aria-label="Back">‹</button>';
  if (!S.enabled) {
    return `
      <header class="top">${topBar({ left: back, label: 'iPhone ↔ Mac', title: 'Sync' })}</header>
      <section class="card">
        <div class="card-head"><h2>Use the app on all your devices</h2></div>
        <p class="pad">Keep your commitments, ticks and calendars the same on your iPhone and Mac. No account needed: your data is copied to your own site under a private key.</p>
        <p class="small pad">Easier: <a href="#/account">sign in with Google</a> instead of copying a key.</p>
      </section>
      <section class="card">
        <div class="card-head"><h2>1 · On the device with your data</h2></div>
        <p class="small pad muted">Usually your iPhone. This uploads everything and gives you a sync key.</p>
        <button class="btn primary full" data-act="sync-on">Turn on sync</button>
      </section>
      <form class="card form" data-form="sync-join">
        <div class="card-head"><h2>2 · On your other device</h2></div>
        <p class="small muted">Paste the sync key from your first device. This device's current data is replaced by the synced data.</p>
        <label class="f">Sync key<input name="key" class="mono" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Paste key"></label>
        <button class="btn primary" type="submit">Join</button>
      </form>`;
  }
  return `
    <header class="top">${topBar({ left: back, label: 'iPhone ↔ Mac', title: 'Sync' })}</header>
    <section class="card">
      <div class="card-head"><h2>Sync is on</h2></div>
      <p class="small pad ${S.lastError ? 'err' : 'muted'}">${S.lastError ? '⚠️ ' + escapeHtml(S.lastError) : `Last synced ${ago(S.lastSync)}. Syncs when you open the app, after changes, and every minute or so while it's open.`}</p>
      <div class="btn-row"><button class="btn" data-act="sync-now">Sync now</button></div>
    </section>
    <section class="card">
      <div class="card-head"><h2>Sync key</h2></div>
      <input id="syncKey" class="mono full-input" readonly value="${escapeHtml(S.key)}" aria-label="Sync key">
      <div class="btn-row"><button class="btn primary" data-act="sync-copy">Copy key</button></div>
      <p class="small muted pad">On your other device: open the app → ⋯ → <b>Sync</b> → paste the key → <b>Join</b>. Anyone with this key can see and change your data, so only send it to yourself (AirDrop, Notes).</p>
    </section>
    <section class="card howto">
      <div class="card-head"><h2>Set up your Mac</h2></div>
      <ol>
        <li>Open <b>${escapeHtml(location.host)}</b> in <b>Safari</b> → <b>File</b> → <b>Add to Dock</b>. (Chrome: ⋮ → <b>Cast, save and share</b> → <b>Install page as app</b>.)</li>
        <li>Open the app from the Dock → ⋯ → <b>Sync</b> → paste the key → <b>Join</b>.</li>
      </ol>
    </section>
    <section class="card">
      <div class="btn-row"><button class="btn" data-act="sync-off">Turn off on this device</button></div>
      <button class="btn warn full" data-act="sync-delete">Delete synced copy</button>
    </section>`;
}

// ---------- Account (Sign in with Google) ----------
// Your Google account owns your data. "Continue with Google" opens Google's sign-in in a separate
// window (a browser tab, a sheet on iPhone, your browser on the Mac); the app waits for the server
// to see it finish (/api/login), then loads your data and keeps it in sync. The first sign-in on a
// device that already syncs keeps that device's data.
let loginCfg = null, loginWait = null; // loginWait = { state, timer, until }
// A "not set up" answer is never kept: the next look (or tap) asks the server again.
async function loadLoginConfig() {
  if (loginCfg && !loginCfg.error) return loginCfg;
  try { const r = await fetch('/api/login/config', { cache: 'no-store' }); loginCfg = await r.json(); if (!r.ok) loginCfg = { error: loginCfg.error || 'Sign-in is unavailable.' }; }
  catch { loginCfg = null; }
  if (route.page === 'account') render();
  return loginCfg;
}
function startGoogleSignIn() {
  const cfg = loginCfg;
  if (!cfg || cfg.error) {
    // Ask again; if the server is ready now, the button works on the next tap.
    toast('Connecting to Google… tap again in a moment.');
    loginCfg = null;
    loadLoginConfig().then((c) => { if (c && c.error) toast(c.error); });
    return;
  }
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const url = cfg.devAuthUrl ? `${cfg.devAuthUrl}?state=${nonce}` : `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
    client_id: cfg.clientId, redirect_uri: cfg.redirectUri, response_type: 'code', scope: 'openid email profile', state: nonce, prompt: 'select_account' })}`;
  window.open(url, '_blank'); // opened straight from the tap, so it isn't blocked as a pop-up
  stopGoogleWait();
  loginWait = { state: nonce, until: Date.now() + 10 * 60e3 };
  loginWait.timer = setInterval(pollGoogle, 2000);
  render();
}
function stopGoogleWait() {
  if (loginWait) clearInterval(loginWait.timer);
  loginWait = null;
}
async function pollGoogle() {
  const w = loginWait;
  if (!w || w.busy) return;
  if (Date.now() > w.until) { stopGoogleWait(); render(); toast('Sign-in timed out. Try again.'); return; }
  w.busy = true;
  try {
    const headers = { 'content-type': 'application/json' };
    if (state.sync.enabled) headers.authorization = `Bearer ${state.sync.key}`;
    const r = await fetch('/api/login', { method: 'POST', headers, body: JSON.stringify({ state: w.state }), cache: 'no-store' });
    const data = await r.json().catch(() => ({}));
    if (loginWait !== w) return;
    if (!r.ok) { stopGoogleWait(); render(); toast(data.error || 'Sign-in failed.'); return; }
    if (data.pending) return;
    stopGoogleWait();
    await finishGoogleSignIn(data);
  } catch { /* offline for a moment: try again */ } finally { w.busy = false; }
}
async function finishGoogleSignIn(r) {
  const account = { email: r.email, name: r.name || '' };
  await sbSignIn(r.idToken);
  if (state.sync.enabled && r.syncKey === state.sync.key) {
    state.account = account; save(); render(); toast(`Signed in as ${r.email}`);
  } else if (r.fresh) {
    state.account = account;
    await startSync(r.syncKey); // a new account: this device's data becomes the account's
    toast(`Signed in as ${r.email}. Your data is saved to your account.`);
  } else {
    await joinWithKey(r.syncKey, { done: `Signed in as ${r.email}. Your data is here.` });
    if (state.sync.key === r.syncKey) { state.account = account; save(); render(); }
  }
  refreshBuddy();
  loadOutboundStatus();
}
function signOut() {
  if (!confirm('Sign out on this device? Your data stays in your Google account; this device starts empty until you sign in again.')) return;
  stopGoogleWait();
  sbSignOut();
  notifyInfo = null; feedInfo = null; outboundAsked = false; lastPlanSig = ''; lastFeedSig = ''; tgWaitStop();
  state = defaultState();
  recordHashes = null;
  save();
  location.hash = '#/plan';
  render();
  toast('Signed out');
}
const LEGAL_LINKS = '<p class="help center"><a href="privacy.html" target="_blank" rel="noopener">Privacy Policy</a> · <a href="terms.html" target="_blank" rel="noopener">Terms of Service</a></p>';
function accountPageHtml() {
  const back = '<button class="icon-btn" data-act="back" aria-label="Back">‹</button>';
  const head = `<header class="top">${topBar({ left: back, label: 'Sign-in', title: 'Account' })}</header>`;
  if (state.account) {
    return head + `
      <section class="card" data-section="Account">
        <div class="acct"><span class="acct-g">G</span><div><b>${escapeHtml(state.account.name || state.account.email)}</b><span>${escapeHtml(state.account.email)}</span></div></div>
        <p class="small pad muted">Your data is saved to this Google account and stays the same on every device you sign in on. ${state.sync.lastError ? `<span class="err">${escapeHtml(state.sync.lastError)}</span>` : `Last synced ${ago(state.sync.lastSync)}.`}</p>
        <div class="btn-row"><button class="btn" data-act="sync-now">Sync now</button><button class="btn" data-act="sign-out">Sign out</button></div>
      </section>${LEGAL_LINKS}`;
  }
  const cfg = loginCfg;
  return head + `
    <section class="card signin-card" data-section="Sign in">
      <h2>Sign in to I Commit!</h2>
      <p class="small muted">Keep your routines, notes and Our Tree in your Google account, the same on your iPhone, Mac and any browser.</p>
      ${loginWait ? `<p class="pad"><b>Finish signing in in the Google window…</b><br><span class="small muted">This page continues by itself once you've picked your account.</span></p>
        <button class="btn full" data-act="google-cancel">Cancel</button>`
        : `<button class="btn gbtn full" data-act="google-signin" ${cfg && !cfg.error ? '' : 'disabled'}><span class="glogo">G</span>Continue with Google</button>
        ${cfg && cfg.error ? `<p class="small err pad">${escapeHtml(cfg.error)}</p>` : ''}`}
      ${state.sync.enabled ? '<p class="help">This device\'s data will be kept and saved to your account.</p>' : ''}
    </section>${LEGAL_LINKS}`;
}

// ---------- Reminders (Telegram) and the calendar link ----------
// Reminders come as Telegram messages from the app's bot, sent by the server (server/notify.mjs)
// even when the app is closed. The server can't work out your days itself, so after each change
// the app sends it a small plan of the next 8 days (planForReminders). Timed one-offs, project
// meetings and application dates also go into a private calendar link (server/feed.mjs) that
// Google Calendar subscribes to (calendarCopy); no Google permissions are needed for that.
const OUTBOUND_DELAY = 3000;
let notifyInfo = null;     // { prefs, telegram: { name } | null, bot, setup, error } from the server
let feedInfo = null;       // { url, updatedAt }
let tgWait = null;         // { until, timer } while you press Start in Telegram
let outboundAsked = false; // the Reminders page asked the server at least once
let outboundTimer = null, lastPlanSig = '', lastFeedSig = '';
const authHeaders = () => ({ authorization: `Bearer ${state.sync.key}`, 'content-type': 'application/json' });
const remindersInUse = () => !!(notifyInfo && notifyInfo.telegram);
const feedInUse = () => !!(feedInfo && feedInfo.url);
const safeKey = (s) => String(s).replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 100);
const timeOnly = (t) => (t ? String(t).slice(0, 5) : null);
const randomCode = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function api(path, { method = 'GET', body } = {}) {
  const r = await fetch(path, { method, headers: authHeaders(), body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const err = new Error(data.error || `Request failed (${r.status})`); err.data = data; throw err; }
  return data;
}

// What the server needs to know about the next 8 days.
function planForReminders() {
  const today = todayISO(), days = [], timed = [], deadlines = [];
  const until = addDaysISO(today, 7);
  for (let n = 0; n < 8; n++) {
    const d = addDaysISO(today, n), w = state.weeks[weekOf(d)], i = dayIndexOf(d);
    const tasks = [], schedule = [], routines = [], meetings = [];
    for (const c of state.commitments) {
      if (c.archived || c.schedule && c.freq !== 'once') continue;
      if (c.freq === 'once' && c.date === d) {
        const done = onceDone(c);
        (c.schedule ? schedule : tasks).push({ t: c.name, time: c.time, done });
        if (c.time && !c.schedule && !done) timed.push({ key: `c:${safeKey(c.id)}`, date: d, time: c.time, title: c.name, where: locationOf(c) });
      } else if (c.freq === 'daily') {
        const it = w && w.items[c.id];
        routines.push({ t: c.name, done: !!(it && dayDone(it, i)) });
      } else if (c.freq === 'periodic') {
        const st = periodicOn(c.id, c, d);
        if (st) routines.push({ t: c.name, done: st === 'done' });
      }
    }
    for (const p of projects || []) {
      if (noTime(p)) continue;
      for (const m of p.meetings) {
        if (meetingDate(p, m) !== d) continue;
        const t = `${m.title} · ${p.name}`, time = timeOnly(m.time);
        meetings.push({ t, time });
        if (time) timed.push({ key: `m:${safeKey(m.id)}`, date: d, time, title: t });
      }
    }
    const byTime = (a, b) => (a.time || '99').localeCompare(b.time || '99');
    const apps = appEvents().filter((e) => e.date === d).map((e) => ({ t: `${e.a.company} ${APP_EVENT_LABEL[e.kind]}` }));
    days.push({ date: d, tasks: tasks.sort(byTime), schedule: schedule.sort(byTime), routines, meetings: meetings.sort(byTime), apps });
  }
  for (const e of appEvents()) {
    if ((e.kind === 'close' || e.kind === 'next' || e.kind === 'assess') && e.date > today && e.date <= addDaysISO(until, 1)) {
      deadlines.push({ key: `a:${safeKey(e.a.id)}:${e.kind}`, date: e.date, title: `${e.a.company} ${APP_EVENT_LABEL[e.kind]}` });
    }
  }
  return { tz: Intl.DateTimeFormat().resolvedOptions().timeZone, days, timed, deadlines };
}

// What goes into the calendar link: your own timed one-offs (not ones imported from a calendar,
// which are already in one), project meetings and application dates. Kinds this device hasn't
// loaded are left out of `sources`, so the server keeps those events as they were.
function calendarCopy() {
  const from = addDaysISO(todayISO(), -7), events = [], sources = ['task'];
  for (const c of state.commitments) {
    if (c.archived || c.freq !== 'once' || !c.date || c.date < from || !c.time || c.source || c.schedule) continue;
    const link = (c.links[0] && c.links[0].url) || c.notionUrl || '';
    events.push({ key: `c:${safeKey(c.id)}`, src: 'task', date: c.date, time: c.time, endTime: c.endTime, title: c.name, notes: c.notes, url: /^https:/.test(link) ? link : '' });
  }
  if (projects !== null && !projectsError) {
    sources.push('meet');
    for (const p of projects) {
      if (noTime(p)) continue;
      for (const m of p.meetings) {
        const date = meetingDate(p, m);
        if (date >= from) events.push({ key: `m:${safeKey(m.id)}`, src: 'meet', date, time: timeOnly(m.time), title: `${m.title} · ${p.name}`, notes: MEETING_KINDS[m.kind] || '' });
      }
    }
  }
  if (state.apps.fetchedAt) {
    sources.push('app');
    for (const e of appEvents()) {
      if (e.date < from) continue;
      const url = cleanUrl(e.kind === 'assess' && e.a.assessUrl ? e.a.assessUrl : e.a.url);
      events.push({ key: `a:${safeKey(e.a.id)}:${e.kind}`, src: 'app', date: e.date, title: `${e.a.company} ${APP_EVENT_LABEL[e.kind]}`, notes: e.a.programme || '', url: /^https:/.test(url) ? url : '' });
    }
  }
  return { tz: Intl.DateTimeFormat().resolvedOptions().timeZone, from, sources, events };
}

// Called after every change (and when the day or synced data changes): sends what's new a few
// seconds later. A send already waiting isn't pushed back, so a stream of saves can't hold it off.
function scheduleOutbound(delay = OUTBOUND_DELAY) {
  if (!state || !state.account || !(remindersInUse() || feedInUse())) return;
  if (outboundTimer && delay >= OUTBOUND_DELAY) return;
  clearTimeout(outboundTimer);
  outboundTimer = setTimeout(sendOutbound, delay);
}
async function sendOutbound() {
  clearTimeout(outboundTimer);
  outboundTimer = null;
  if (!state.account || !navigator.onLine) return;
  if (remindersInUse()) {
    const plan = planForReminders(), sig = JSON.stringify(plan);
    if (sig !== lastPlanSig) {
      try { await api('/api/notify/plan', { method: 'PUT', body: { plan } }); lastPlanSig = sig; } catch { /* tried again after the next change */ }
    }
  }
  if (feedInUse()) {
    const body = calendarCopy(), sig = JSON.stringify(body);
    if (sig !== lastFeedSig) {
      try { feedInfo = await api('/api/feed', { method: 'PUT', body }); lastFeedSig = sig; } catch { /* tried again after the next change */ }
      if (route.page === 'notify' && !typing()) render();
    }
  }
}

// What the server has: asked when you sign in, open the app, or open the Reminders page.
async function loadOutboundStatus() {
  if (!state.account || !state.sync.enabled) return;
  const [n, f] = await Promise.allSettled([api('/api/notify'), api('/api/feed')]);
  outboundAsked = true;
  if (n.status === 'fulfilled') notifyInfo = n.value;
  if (f.status === 'fulfilled') feedInfo = f.value;
  if (route.page === 'notify') render();
  scheduleOutbound(500);
}

// Connecting Telegram: the app opens the bot with a one-time code (straight from the tap, so it
// isn't blocked as a pop-up) and tells the server the code; pressing Start there links the chat.
function telegramConnect() {
  const bot = notifyInfo && notifyInfo.bot;
  if (!bot) { toast((notifyInfo && notifyInfo.error) || 'Telegram isn’t ready yet. Try again in a moment.'); loadOutboundStatus(); return; }
  const code = randomCode();
  window.open(`https://t.me/${encodeURIComponent(bot)}?start=${code}`, '_blank');
  api('/api/notify/telegram', { method: 'POST', body: { code } }).catch((e) => toast(e.message));
  tgWaitStop();
  tgWait = { until: Date.now() + 10 * 60e3 };
  tgWait.timer = setInterval(async () => {
    if (Date.now() > tgWait.until) { tgWaitStop(); render(); return; }
    try {
      const n = await api('/api/notify');
      if (n.telegram) {
        tgWaitStop();
        notifyInfo = n;
        lastPlanSig = '';
        scheduleOutbound(0);
        render();
        toast('Telegram connected');
      }
    } catch { /* offline for a moment */ }
  }, 2000);
  render();
}
function tgWaitStop() { if (tgWait) clearInterval(tgWait.timer); tgWait = null; }
async function telegramDisconnect() {
  if (!confirm('Stop reminders in Telegram? You can connect again any time.')) return;
  try { notifyInfo = { ...notifyInfo, ...(await api('/api/notify/telegram', { method: 'DELETE' })) }; render(); toast('Telegram disconnected'); }
  catch (e) { toast(e.message); }
}
async function notifyTest(summary) {
  try {
    await sendOutbound();
    const r = await api('/api/notify/test', { method: 'POST', body: { summary } });
    toast(r.sent ? 'Sent. Check Telegram.' : r.error);
  } catch (e) { toast(e.message); }
}
async function saveNotifyPrefs(form) {
  const f = new FormData(form);
  const prefs = {
    timed: f.has('timed'), lead: Number(f.get('lead')), deadlines: f.has('deadlines'), deadlineTime: f.get('deadlineTime'),
    routines: f.has('routines'), nudgeTime: f.get('nudgeTime'), summary: f.has('summary'), summaryTime: f.get('summaryTime'),
  };
  try { notifyInfo = { ...notifyInfo, ...(await api('/api/notify/prefs', { method: 'PUT', body: { prefs } })) }; toast('Saved'); }
  catch (e) { toast(e.message); }
}

async function feedAction(act) {
  try {
    if (act === 'feed-make') {
      const body = calendarCopy();
      feedInfo = await api('/api/feed', { method: 'PUT', body });
      lastFeedSig = JSON.stringify(body);
      toast('Calendar link made');
    } else if (act === 'feed-copy') {
      await navigator.clipboard.writeText(feedInfo.url).then(() => toast('Link copied'), () => { document.getElementById('feedUrl')?.select(); toast('Select the link and copy it'); });
      return;
    } else if (act === 'feed-reset') {
      if (!confirm('Make a new link? The old one stops working, so you’ll need to add the new one to Google Calendar again (and remove the old calendar there).')) return;
      feedInfo = await api('/api/feed/reset', { method: 'POST' });
      toast('New link made. Add it to Google Calendar again.');
    } else if (act === 'feed-stop') {
      if (!confirm('Stop the calendar link? Google Calendar can’t read it any more; remove the I Commit! calendar there too.')) return;
      feedInfo = await api('/api/feed', { method: 'DELETE' });
      lastFeedSig = '';
      toast('Calendar link stopped');
    }
    render();
  } catch (e) { toast(e.message); }
}
// Google Calendar's own "add this calendar" page, for a calendar link (webcal:).
const googleSubscribeUrl = (url) => `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(url.replace(/^https:/, 'webcal:'))}`;

function notifyPageHtml() {
  const back = '<button class="icon-btn" data-act="back" aria-label="Back">‹</button>';
  const head = `<header class="top">${topBar({ left: back, label: 'Telegram · Google Calendar', title: 'Reminders' })}</header>`;
  if (!state.account) {
    return head + `<section class="card banner-card"><b>Sign in with Google first</b>
      <p class="small">Reminders and the calendar link belong to your account, so they work from any device.</p>
      <div class="btn-row"><a class="btn primary" href="#/account">Sign in with Google</a></div></section>`;
  }
  if (!notifyInfo || !feedInfo) {
    if (!outboundAsked) { loadOutboundStatus(); return head + '<section class="card"><p class="muted pad">Loading…</p></section>'; }
    return head + `<section class="card empty"><p><b>Couldn’t reach the server</b></p><p class="small muted">Check you’re online, then try again.</p>
      <button class="btn" data-act="notify-retry">Try again</button></section>`;
  }
  const n = notifyInfo, p = n.prefs, f = feedInfo;
  const tgCard = n.setup ? '<p class="small pad muted">Telegram isn’t set up on the server yet (the bot token; see the README).</p>'
    : n.telegram ? `<p class="small pad">✅ Connected to <b>${escapeHtml(n.telegram.name || 'your Telegram')}</b>. Send <b>/today</b> to the bot any time for today’s plan.</p>
        <div class="btn-row"><button class="btn" data-act="notify-test">Send a test</button><button class="btn" data-act="tg-disconnect">Disconnect</button></div>`
    : tgWait ? `<p class="pad"><b>Press Start in Telegram…</b><br><span class="small muted">This page carries on by itself once you have.</span></p>
        <div class="btn-row"><button class="btn" data-act="tg-connect">Open Telegram again</button><button class="btn" data-act="tg-cancel">Cancel</button></div>`
    : `${n.error ? `<p class="small pad err">⚠️ ${escapeHtml(n.error)}</p>` : ''}<button class="btn primary full" data-act="tg-connect">Connect Telegram</button>
        <p class="help pad">Opens <b>@${escapeHtml(n.bot || '…')}</b> in Telegram. Press <b>Start</b> there and you’re done.</p>`;
  const sel = (name, opts, cur) => `<select name="${name}">${opts.map(([v, l]) => `<option value="${v}" ${String(v) === String(cur) ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const time = (name, v) => `<input type="time" name="${name}" value="${escapeHtml(v || '')}" required>`;
  const feedCard = !f.url ? `<p class="small pad muted">Makes a private calendar link with your timed one-offs, project meetings and application dates. Add it to Google Calendar once, and it follows your changes here.</p>
      <button class="btn primary full" data-act="feed-make">Make calendar link</button>`
    : `<label class="f pad">Your private calendar link<input id="feedUrl" readonly value="${escapeHtml(f.url)}" onclick="this.select()"></label>
      <div class="btn-row"><a class="btn primary" href="${escapeHtml(googleSubscribeUrl(f.url))}" target="_blank" rel="noopener">Add to Google Calendar</a><button class="btn" data-act="feed-copy">Copy link</button></div>
      <details class="fold-in"><summary>Add it by hand</summary><ol>
        <li>On a computer, open <b>calendar.google.com</b>.</li>
        <li>Next to <b>Other calendars</b>, click <b>+</b> → <b>From URL</b>.</li>
        <li>Paste the link and click <b>Add calendar</b>. It shows as <b>I Commit!</b>; on iPhone it appears in the Google Calendar app by itself.</li></ol></details>
      <p class="small pad muted">Updated here ${ago(f.updatedAt)}. Google Calendar reads the link every few hours (Google decides how often), so changes can take a while to show there.</p>
      <p class="help pad">Keep the link private: anyone with it can see these items. Edit items here, not in Google. Don’t add this link back under Calendars, or everything would show twice.</p>
      <div class="btn-row"><button class="btn" data-act="feed-reset">Make a new link</button><button class="btn" data-act="feed-stop">Stop sharing</button></div>`;
  return head + `
    <section class="card" data-section="Telegram">
      <div class="card-head"><h2>Telegram</h2></div>
      <p class="small pad muted">Your reminders arrive as Telegram messages from the I Commit! bot, even when the app is closed.</p>
      ${tgCard}
    </section>
    <form class="card" data-form="notify-prefs" data-section="What to send">
      <div class="card-head"><h2>What to send</h2></div>
      <label class="toggle-row"><input type="checkbox" name="timed" ${p.timed ? 'checked' : ''}><span>Before a timed task or meeting<small>A message before anything with a start time.</small></span></label>
      <label class="f pad">How long before ${sel('lead', [[0, 'At the start'], [5, '5 minutes'], [10, '10 minutes'], [15, '15 minutes'], [30, '30 minutes'], [60, '1 hour'], [120, '2 hours']], p.lead)}</label>
      <label class="toggle-row"><input type="checkbox" name="deadlines" ${p.deadlines ? 'checked' : ''}><span>Application deadlines<small>The day before an application closes or a next step is due.</small></span></label>
      <label class="f pad">At ${time('deadlineTime', p.deadlineTime)}</label>
      <label class="toggle-row"><input type="checkbox" name="routines" ${p.routines ? 'checked' : ''}><span>Routines not ticked<small>In the evening, listing the day's routines you haven't ticked yet.</small></span></label>
      <label class="f pad">At ${time('nudgeTime', p.nudgeTime)}</label>
      <label class="toggle-row"><input type="checkbox" name="summary" ${p.summary ? 'checked' : ''}><span>Morning briefing<small>The day's timeline, to-dos, routines and application dates.</small></span></label>
      <label class="f pad">At ${time('summaryTime', p.summaryTime)}</label>
      ${n.telegram ? '<div class="btn-row"><button class="btn" type="button" data-act="notify-test-summary">Send today’s briefing now</button></div>' : ''}
      <p class="help pad">Times are this device's time zone. Changes save by themselves.</p>
    </form>
    <section class="card" data-section="Google Calendar">
      <div class="card-head"><h2>Google Calendar</h2></div>
      ${feedCard}
    </section>`;
}

// ---------- Gallery (projects) ----------
// Longer pieces of work (a consulting project, an internship, a society event) with their own
// page: links, and a week-by-week timeline of steps and meetings. Stored in Supabase
// (supabase/projects.sql). Meetings and step deadlines show on This week and the calendar.
// Colours: [dark text, light fill, mid, soft]
const PROJ_COLORS = {
  blue: ['#0C447C', '#E6F1FB', '#185FA5', '#B5D4F4'], purple: ['#3C3489', '#EEEDFE', '#534AB7', '#CECBF6'],
  teal: ['#085041', '#E1F5EE', '#0F6E56', '#9FE1CB'], coral: ['#712B13', '#FAECE7', '#993C1D', '#F5C4B3'],
  pink: ['#72243E', '#FBEAF0', '#993556', '#F4C0D1'], amber: ['#633806', '#FAEEDA', '#854F0B', '#FAC775'],
  green: ['#27500A', '#EAF3DE', '#3B6D11', '#C0DD97'], gray: ['#444441', '#F1EFE8', '#5F5E5A', '#D3D1C7'],
};
const MEETING_KINDS = { kickoff: 'Kick-off', checkin: 'Check-in', mid: 'Mid-project', final: 'Final', other: 'Other' };
let projects = null;                 // [{ ...project, steps, meetings }] once loaded
const projBoards = new Map();        // project id -> { cards, links }

// The database calls, in one place.
const projDb = {
  async list() {
    const [p, s, m] = await Promise.all([
      sb.from('projects').select('*').order('sort').order('created_at'),
      sb.from('project_steps').select('*').order('sort').order('week_from'),
      sb.from('project_meetings').select('*').order('week'),
    ]);
    const err = p.error || s.error || m.error;
    if (err) throw err;
    // References came later (same setup file, run again); without them the rest still works.
    const rf = await sb.from('project_refs').select('*').order('sort').order('created_at');
    refsMissing = !!rf.error;
    const refs = rf.error ? [] : rf.data;
    return p.data.map((x) => {
      const mine = refs.filter((r) => r.project_id === x.id);
      const files = mine.filter((r) => r.kind === 'file');
      if (x.drive_url) files.unshift({ id: 'old-drive', url: x.drive_url, title: '', kind: 'file' }); // from before Files existed
      return { ...x, steps: s.data.filter((r) => r.project_id === x.id), meetings: m.data.filter((r) => r.project_id === x.id),
        refs: mine.filter((r) => r.kind !== 'file'), files };
    });
  },
  async board(id) {
    const [c, l] = await Promise.all([
      sb.from('project_cards').select('*').eq('project_id', id).order('rank').order('created_at'),
      sb.from('project_links').select('*').eq('project_id', id),
    ]);
    if (c.error || l.error) throw c.error || l.error;
    return { cards: c.data, links: l.data };
  },
  async save(table, row) {
    const { id, ...rest } = row;
    const q = id ? sb.from(table).update(rest).eq('id', id) : sb.from(table).insert(rest);
    const { data, error } = await q.select().single();
    if (error) throw error;
    return data;
  },
  async insertMany(table, rows) {
    if (!rows.length) return;
    const { error } = await sb.from(table).insert(rows);
    if (error) throw error;
  },
  async remove(table, match) {
    const { error } = await sb.from(table).delete().match(match);
    if (error) throw error;
  },
  async link(row) {
    const { error } = await sb.from('project_links').insert(row);
    if (error && error.code !== '23505') throw error;
  },
};
let projectsError = null, refsMissing = false;
async function loadProjects() {
  if (!sbUser) return;
  try { projects = await projDb.list(); projectsError = null; } catch (e) {
    // e.g. the projects tables haven't been added to the database yet (supabase/projects.sql)
    projectsError = /does not exist|could not find the table/i.test(e.message || '') ? 'The Gallery isn’t set up in the database yet.' : sbErr(e);
    projects = [];
  }
  scheduleOutbound();
  if (['gallery', 'cal', 'today'].includes(route.tab) && !formOpen() && !sheetCtx && !typing()) render();
}
const projById = (id) => (projects || []).find((p) => p.id === id);
// Any '#rrggbb' colour works too: darker for text, paler for fills, and white or dark text on top.
const isHex = (c) => /^#[0-9a-f]{6}$/i.test(c || '');
function hexPalette(hex) {
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const mix = (t, k) => '#' + rgb.map((v) => Math.round(v + (t - v) * k).toString(16).padStart(2, '0')).join('');
  const light = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255 > 0.62;
  return [mix(0, 0.6), mix(255, 0.86), hex, mix(255, 0.55), light ? mix(0, 0.7) : '#ffffff'];
}
// [dark text, light fill, mid, soft, text on mid]
const pcol = (p) => (isHex(p.color) ? hexPalette(p.color) : [...(PROJ_COLORS[p.color] || PROJ_COLORS.blue), (PROJ_COLORS[p.color] || PROJ_COLORS.blue)[1]]);
const safeLogo = (logo) => (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(logo || '') && logo.length <= 200000 ? logo : '');
// A logo is shrunk to at most 192px so it fits in the database row.
async function logoDataUrl(file) {
  const img = await createImageBitmap(file);
  const k = Math.min(1, 192 / Math.max(img.width, img.height));
  const c = Object.assign(document.createElement('canvas'), { width: Math.max(1, Math.round(img.width * k)), height: Math.max(1, Math.round(img.height * k)) });
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  let url = c.toDataURL('image/png');
  if (url.length > 150000) url = c.toDataURL('image/jpeg', 0.85);
  return url;
}

// The colour picker on a project: choosing a colour also selects the "any colour" circle.
function pickCustomColor(input) {
  const box = input.closest('.pc-custom');
  box.querySelector('input[type="radio"]').checked = true;
  box.querySelector('.pc-ring').style.background = input.value;
}

function setLogo(form, url) {
  if (!safeLogo(url)) { toast('That picture is too big, try a smaller one'); return false; }
  form.logo.value = url;
  document.getElementById('logoPrev').innerHTML = `<img src="${url}" alt="">`;
  form.querySelector('[data-act="logo-remove"]').hidden = false;
  form.querySelector('[data-act="logo-color"]').hidden = false;
  matchLogoColor(form);
  return true;
}
// Any picture (uploaded, pasted or dropped) becomes the logo.
async function useLogoBlob(form, blob) {
  try { setLogo(form, await logoDataUrl(blob)); } catch { toast('Couldn’t read that picture. Try a PNG or JPG.'); }
}

// The logo's main colour: the commonest clearly coloured shade, ignoring the white background and
// see-through pixels. A black-and-white logo gives its dark ink colour. null if there's nothing to go on.
async function logoMainColor(url) {
  const img = new Image();
  img.src = url;
  await img.decode();
  const N = 48, c = Object.assign(document.createElement('canvas'), { width: N, height: N }), g = c.getContext('2d');
  g.drawImage(img, 0, 0, N, N);
  const d = g.getImageData(0, 0, N, N).data, buckets = new Map();
  for (let i = 0; i < d.length; i += 4) {
    const [r, gr, b, a] = [d[i], d[i + 1], d[i + 2], d[i + 3]];
    if (a < 160 || Math.min(r, gr, b) > 228) continue; // see-through or background white
    const key = ((r >> 4) << 8) | ((gr >> 4) << 4) | (b >> 4);
    const e = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    e.n++; e.r += r; e.g += gr; e.b += b;
    buckets.set(key, e);
  }
  let best = null, bestScore = 0;
  for (const e of buckets.values()) {
    const r = e.r / e.n, gr = e.g / e.n, b = e.b / e.n, max = Math.max(r, gr, b), min = Math.min(r, gr, b);
    const colourful = max > 40 && (max - min) / max > 0.25;
    const score = e.n * (colourful ? 4 : 1); // a brand colour beats grey or black outlines
    if (score > bestScore) { bestScore = score; best = [r, gr, b]; }
  }
  return best ? '#' + best.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('') : null;
}
async function matchLogoColor(form) {
  const note = document.getElementById('logoColorNote');
  let hex = null;
  try { hex = form.logo.value && await logoMainColor(form.logo.value); } catch { /* unreadable picture */ }
  if (!hex) { if (note) { note.hidden = false; note.textContent = 'Couldn’t find a main colour in this logo, so the colour stays as it was.'; } return; }
  const input = form.customColor;
  input.value = hex;
  pickCustomColor(input);
  if (note) { note.hidden = false; note.innerHTML = `Colour taken from the logo: <b>${hex}</b>. Pick another circle to change it.`; }
}
// The Paste button (for phones, where there's no ⌘V): reads a picture from the clipboard.
async function pasteLogo(form) {
  if (!navigator.clipboard || !navigator.clipboard.read) { toast('Copy the picture, then press ⌘V on this page'); return; }
  try {
    for (const item of await navigator.clipboard.read()) {
      const type = item.types.find((t) => t.startsWith('image/'));
      if (type) { await useLogoBlob(form, await item.getType(type)); return; }
      if (item.types.includes('text/plain')) {
        const text = (await (await item.getType('text/plain')).text()).trim();
        if (/^https:\/\/\S+$/.test(text)) { form.querySelector('#logoSite').value = text; findLogo(form, form.querySelector('[data-act="logo-find"]')); return; }
      }
    }
    toast('No picture on the clipboard yet. Copy one first (right-click it, then Copy Image).');
  } catch { toast('Pasting wasn’t allowed. Press ⌘V on this page instead.'); }
}
// Fetches a company's icon from its website (through the server, see server/logo.mjs).
async function findLogo(form, btn) {
  const site = form.querySelector('#logoSite').value.trim();
  if (!site) { toast('Type the company’s website, e.g. castore.com'); return; }
  if (!state.sync.key) { toast('Sign in with Google to find logos'); return; }
  btn.disabled = true; btn.textContent = 'Finding…';
  try {
    const res = await fetch('/api/logo', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${state.sync.key}` }, body: JSON.stringify({ site }) });
    const r = await res.json().catch(() => ({}));
    if (!res.ok || !r.dataUrl) { toast(r.error || 'Couldn’t find a logo. Upload a picture instead.'); return; }
    const [head, b64] = r.dataUrl.split(',');
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    setLogo(form, await logoDataUrl(new Blob([bytes], { type: head.slice(5, head.indexOf(';')) })));
  } catch { toast('Couldn’t reach the server. Try again.'); }
  finally { btn.disabled = false; btn.textContent = 'Find logo'; }
}

// ---- months (for projects shown as a monthly calendar)
// Weeks still number the project internally, so meetings and steps work the same in both formats.
const monthStart = (mk) => `${mk}-01`;
const monthEnd = (mk) => { const [y, m] = mk.split('-').map(Number); return isoDate(new Date(y, m, 0)); };
const addMonthKey = (mk, n) => { const [y, m] = mk.split('-').map(Number); return isoDate(new Date(y, m - 1 + n, 1)).slice(0, 7); };
const monthName = (mk, opts = { month: 'long', year: 'numeric' }) => fmtDay(parseISO(monthStart(mk)), opts);
function projMonths(p) {
  const first = (p.starts_on || addDaysISO(p.start_date, 6)).slice(0, 7), last = (p.ends_on || addDaysISO(projEnd(p), -6)).slice(0, 7), out = [];
  for (let mk = first; mk <= last && out.length < 24; mk = addMonthKey(mk, 1)) out.push(mk);
  return out;
}
// The real first and last day: the dates you set, or (for projects made before you could set them)
// whole weeks, or whole months for a monthly project.
const projSpan = (p) => (p.starts_on && p.ends_on ? [p.starts_on, p.ends_on]
  : p.layout === 'months' ? [monthStart(projMonths(p)[0]), monthEnd(projMonths(p).at(-1))] : [p.start_date, projEnd(p)]);
// "30 Sep to 20 Nov", with the year when it isn't this year
function dateRange(a, b) {
  const y = todayISO().slice(0, 4);
  return shortRange(a, b) + (b.slice(0, 4) !== y || a.slice(0, 4) !== y ? ` ${b.slice(0, 4)}` : '');
}
function projRange(p) {
  if (noTime(p)) return 'Ongoing';
  if (p.starts_on && p.ends_on) return dateRange(p.starts_on, p.ends_on);
  if (p.layout !== 'months') return shortRange(p.start_date, projEnd(p));
  const ms = projMonths(p);
  return ms.length === 1 ? monthName(ms[0]) : `${monthName(ms[0], { month: 'short' })} to ${monthName(ms.at(-1), { month: 'short', year: 'numeric' })}`;
}

// ---- weeks
const projWeekStart = (p, w) => addDaysISO(p.start_date, (w - 1) * 7);
const projEnd = (p) => addDaysISO(p.start_date, p.weeks * 7 - 1);
function shortRange(a, b) {
  const A = parseISO(a), B = parseISO(b);
  return A.getMonth() === B.getMonth() ? `${A.getDate()} to ${fmtDay(B, { day: 'numeric', month: 'short' })}`
    : `${fmtDay(A, { day: 'numeric', month: 'short' })} to ${fmtDay(B, { day: 'numeric', month: 'short' })}`;
}
// A week's dates, trimmed to the project's own start and end (e.g. a Wednesday start).
function weekDates(p, w) {
  const [a, z] = projSpan(p), from = projWeekStart(p, w), to = addDaysISO(from, 6);
  return shortRange(from < a ? a : from, to > z ? z : to);
}
// Projects with no timeline (ongoing, e.g. building an app) have no weeks, dates or meetings.
const noTime = (p) => p.layout === 'none';
function projNowWeek(p) {
  if (noTime(p)) return null;
  const n = Math.floor((parseISO(todayISO()) - parseISO(p.start_date)) / (7 * 864e5)) + 1;
  return n >= 1 && n <= p.weeks ? n : null;
}
function projStatus(p) {
  if (noTime(p)) { const open = p.steps.filter((x) => !x.done).length; return p.steps.length ? `Ongoing · ${open} of ${p.steps.length} steps to do` : 'Ongoing'; }
  const [a, z] = projSpan(p), t = todayISO();
  if (t < a) return `Starts ${fmtShort(a)}`;
  if (t > z) return `Finished ${fmtShort(z)}`;
  if (p.layout === 'months') { const ms = projMonths(p), i = ms.indexOf(t.slice(0, 7)); return `Month ${i + 1} of ${ms.length} · ${monthName(ms[i], { month: 'long' })}`; }
  const w = projNowWeek(p);
  return `Week ${w} of ${p.weeks} · ${weekDates(p, w)}`;
}
const meetingDate = (p, m) => addDaysISO(projWeekStart(p, m.week), (m.weekday || 1) - 1);
// The Friday of its last week, or the project's end date if that comes first.
const stepDue = (p, s) => { const fri = addDaysISO(projWeekStart(p, s.week_to), 4), end = projSpan(p)[1]; return fri > end ? end : fri; };
const weekOptions = (p, cur, blank = false) => (blank ? `<option value="">No week</option>` : '') +
  Array.from({ length: p.weeks }, (_, i) => i + 1).map((w) => `<option value="${w}" ${w === cur ? 'selected' : ''}>Week ${w} · ${weekDates(p, w)}</option>`).join('');

// ---- what shows on the calendar and Today
function projectItemsOn(iso) {
  const out = [];
  for (const p of projects || []) {
    if (noTime(p)) continue;
    for (const m of p.meetings) if (meetingDate(p, m) === iso) out.push({ p, kind: m.kind, title: m.title, time: m.time ? m.time.slice(0, 5) : null });
    for (const s of p.steps) if (!s.done && stepDue(p, s) === iso) out.push({ p, kind: 'due', title: `${s.title} due`, time: null });
  }
  return out.sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
}

// ---- pages
const gallerySignIn = (head) => head + `<section class="card banner-card"><b>${state.account ? 'One more Google sign-in' : 'Sign in with Google to use the Gallery'}</b>
  <p class="small">Projects are saved to your account, so they're the same on your phone and Mac.</p>
  <div class="btn-row">${state.account ? '<button class="btn primary" data-act="google-signin">Continue with Google</button>' : '<a class="btn primary" href="#/account">Sign in with Google</a>'}</div></section>`;
function galleryHtml() {
  const head = `<header class="top">${topBar({ label: 'Projects', title: 'Gallery', right: sbUser ? '<a class="txt-btn" href="#/gallery/new">+ New</a>' : menuBtn })}</header>`;
  if (!sbUser) return gallerySignIn(head);
  if (projects === null) { loadProjects(); return head + '<section class="card"><p class="muted pad">Loading…</p></section>'; }
  if (projectsError) {
    return head + `<section class="card empty"><p><b>Couldn’t load your projects</b></p><p class="small muted">${escapeHtml(projectsError)}</p>
      <button class="btn" data-act="projects-retry">Try again</button></section>`;
  }
  if (!projects.length) {
    return head + `<section class="card empty"><p><b>Start your first project</b></p>
      <p class="small muted">A project page keeps its links and a week-by-week timeline in one place.</p>
      <a class="btn primary" href="#/gallery/new">Create project</a></section>`;
  }
  return head + `<div class="pgallery">${projects.map((p) => {
    const [ink, fill, mid, soft] = pcol(p), logo = safeLogo(p.logo);
    const next = noTime(p) ? null : p.meetings.map((m) => ({ m, d: meetingDate(p, m) })).filter((x) => x.d >= todayISO()).sort((a, b) => a.d.localeCompare(b.d))[0];
    const now = projNowWeek(p);
    return `<a class="pgcard" href="#/gallery/${p.id}">
      <div class="pg-cover" style="background:linear-gradient(135deg, ${soft}, ${fill});color:${ink}">${logo ? `<img class="pg-logo" src="${logo}" alt="">` : ''}<span>${projRange(p)}</span>
        ${now ? `<i style="width:${Math.round((now / p.weeks) * 100)}%;background:${mid}"></i>` : ''}</div>
      <div class="pg-body"><b>${escapeHtml(p.name)}</b><span>${projStatus(p)}</span>
        ${next ? `<span class="pg-next" style="color:${ink}">Next: ${escapeHtml(next.m.title)} · ${fmtShort(next.d)}</span>` : ''}
        <div class="pg-icons">${p.notion_url ? '<span title="Notion">N</span>' : ''}<span>${p.steps.length} steps</span>${p.files.length + p.refs.length ? `<span>${p.files.length + p.refs.length} link${p.files.length + p.refs.length === 1 ? '' : 's'}</span>` : ''}</div></div></a>`;
  }).join('')}</div>`;
}

// Reference links: anything worth keeping to hand (articles, reports, decks, briefs).
// An untitled link is named from its address, e.g. notion.so/Market-sizing-1a2b… → "Market sizing".
function refName(r) {
  if (r.title) return r.title;
  try {
    const seg = decodeURIComponent(new URL(r.url).pathname.split('/').filter(Boolean).pop() || '')
      .replace(/\.[a-z0-9]{2,4}$/i, '').replace(/-?[0-9a-f]{32}$/i, '').replace(/[-_+]+/g, ' ').trim();
    return seg && !/^[0-9a-f]{20,}$/i.test(seg) && !/^(view|edit|preview|open|index|home|share|u|d|\d+)$/i.test(seg) ? seg[0].toUpperCase() + seg.slice(1) : hostOf(r.url);
  } catch { return r.url; }
}
// What a file link is, from its address: "Google Slides", "OneDrive", "PDF"…
function linkService(u) {
  const h = hostOf(u), path = (() => { try { return new URL(u).pathname; } catch { return ''; } })();
  if (h === 'docs.google.com') return /\/presentation\//.test(path) ? 'Google Slides' : /\/spreadsheets\//.test(path) ? 'Google Sheets' : /\/forms\//.test(path) ? 'Google Forms' : 'Google Docs';
  if (h === 'drive.google.com') return /\/folders\//.test(path) ? 'Google Drive folder' : 'Google Drive';
  if (/(^|\.)(onedrive\.live\.com|1drv\.ms)$/.test(h)) return 'OneDrive';
  if (/sharepoint\.com$/.test(h)) return 'OneDrive / SharePoint';
  if (/dropbox\.com$/.test(h)) return 'Dropbox';
  if (/(^|\.)notion\.(so|site)$/.test(h)) return 'Notion';
  if (/canva\.com$/.test(h)) return 'Canva';
  if (/figma\.com$/.test(h)) return 'Figma';
  if (/\.pdf$/i.test(path)) return `PDF · ${h}`;
  return h;
}
// Files (Drive, OneDrive, decks…) and References (articles, reports…): the same kind of list.
function linksHtml(p) {
  const list = [...p.files, ...p.refs];
  // Untitled Drive/OneDrive/Docs links have only IDs in their address, so they're named after the service.
  const name = (r) => { const sv = linkService(r.url); return r.title || (sv !== hostOf(r.url) && !sv.startsWith('PDF') && sv !== 'Notion' ? sv : refName(r)); };
  const rows = list.map((r) => `<div class="pref">
      <a class="pref-link" href="${escapeHtml(/notion\.so\//.test(r.url) ? notionAppUrl(r.url) : r.url)}" target="_blank" rel="noopener">
        <b>${escapeHtml(name(r))}</b><small>${escapeHtml(name(r) === linkService(r.url) ? hostOf(r.url) : linkService(r.url))} ↗</small></a>
      <button class="mini-btn" data-act="ref-delete" data-id="${r.id}" aria-label="Remove ${escapeHtml(name(r))}">×</button></div>`).join('');
  return `<section class="card" data-section="Links">
    <div class="card-head"><h2>Links</h2>${list.length ? `<span class="hint">${list.length}</span>` : ''}</div>
    ${refsMissing ? '<p class="help">Run the Gallery setup in Supabase once more to turn links on.</p>' : `${rows}
    <form class="pref-add" data-form="ref">
      <input name="url" inputmode="url" autocapitalize="off" autocorrect="off" placeholder="Paste a file or web link" aria-label="Link" required>
      <input name="title" maxlength="120" placeholder="Name (optional)" aria-label="Name">
      <button class="btn" type="submit">Add</button></form>`}
  </section>`;
}
async function addRef(form) {
  const p = projById(route.projId), f = new FormData(form);
  const url = cleanUrl(f.get('url'));
  if (!p || !url) { toast('Paste a full link (https://…)'); return; }
  try {
    await projDb.save('project_refs', { project_id: p.id, url, kind: 'ref', title: String(f.get('title') || '').trim().slice(0, 120), sort: p.refs.length });
    await loadProjects();
    render();
  } catch (e) { toast(/schema cache|kind/i.test(e.message || '') ? 'Run the Gallery setup in Supabase once more to turn Files on.' : sbErr(e)); }
}
async function deleteRef(id) {
  try {
    if (id === 'old-drive') await projDb.save('projects', { id: route.projId, drive_url: '' });
    else await projDb.remove('project_refs', { id });
  } catch (e) { toast(sbErr(e)); return; }
  await loadProjects();
  render();
}

// No-timeline projects: steps are a plain checklist (no weeks or deadlines).
function stepsChecklistHtml(p) {
  const [, , mid] = pcol(p);
  return `<section class="card" data-section="Steps">
    <div class="card-head"><h2>Steps</h2>${p.steps.length ? `<span class="hint">${p.steps.filter((x) => x.done).length} of ${p.steps.length} done</span>` : ''}</div>
    ${p.steps.map((x) => `<div class="pcheck ${x.done ? 'done' : ''}">
      <button class="pcheck-box" data-act="step-toggle" data-id="${x.id}" aria-pressed="${x.done}" aria-label="${escapeHtml(x.title)} done" style="--pc:${mid}">${x.done ? CHECK : ''}</button>
      <button class="pcheck-title" data-act="step-edit" data-id="${x.id}">${escapeHtml(x.title)}</button></div>`).join('')}
    <form class="pref-add" data-form="step-quick"><input name="title" maxlength="120" placeholder="Add a step, e.g. Ship the Gallery tab" required>
      <button class="btn" type="submit">Add</button></form>
  </section>`;
}
async function toggleStep(id) {
  const p = projById(route.projId), st = p && p.steps.find((x) => x.id === id);
  if (!st) return;
  st.done = !st.done;
  render();
  try { await projDb.save('project_steps', { id, done: st.done }); } catch (e) { st.done = !st.done; render(); toast(sbErr(e)); }
}
async function quickStep(form) {
  const p = projById(route.projId), title = String(new FormData(form).get('title') || '').trim();
  if (!p || !title) return;
  try {
    await projDb.save('project_steps', { project_id: p.id, title: title.slice(0, 120), week_from: 1, week_to: 1, sort: p.steps.length });
    await loadProjects();
    render();
    const box = $app.querySelector('form[data-form="step-quick"] input');
    if (box) box.focus();
  } catch (e) { toast(sbErr(e)); }
}

function timelineHtml(p) {
  const now = projNowWeek(p);
  const cols = `var(--ptl-lab) repeat(${p.weeks}, minmax(96px, 1fr))`;
  // month labels spanning the weeks that start in them
  const months = [];
  for (let w = 1; w <= p.weeks; w++) {
    const m = fmtDay(parseISO(projWeekStart(p, w)), { month: 'long' });
    if (months.length && months[months.length - 1].m === m) months[months.length - 1].n++;
    else months.push({ m, n: 1 });
  }
  let row = 1, html = `<div class="ptl-cell ptl-head" style="grid-row:1;grid-column:1"></div>`;
  let col = 2;
  for (const x of months) { html += `<div class="ptl-cell ptl-head" style="grid-row:1;grid-column:${col} / span ${x.n}">${x.m}</div>`; col += x.n; }
  row = 2;
  html += `<div class="ptl-cell ptl-lab" style="grid-row:2;grid-column:1">Week</div>`;
  for (let w = 1; w <= p.weeks; w++) {
    html += `<div class="ptl-cell ptl-week ${w === now ? 'now' : ''}" style="grid-row:2;grid-column:${w + 1}"><b>Week ${w}</b><small>${weekDates(p, w)}</small></div>`;
  }
  const [ink, , mid, soft, onMid] = pcol(p);
  p.steps.forEach((s, i) => {
    const r = 3 + i;
    if (i === 0) html += `<div class="ptl-cell ptl-lab" style="grid-row:3 / span ${p.steps.length};grid-column:1">Steps</div>`;
    html += `<button class="ptl-bar ${s.done ? 'done' : ''}" data-act="step-edit" data-id="${s.id}" style="grid-row:${r};grid-column:${s.week_from + 1} / ${Math.min(p.weeks, s.week_to) + 2};background:${i % 2 ? soft : mid};color:${i % 2 ? ink : onMid}"><span>${s.done ? '✓ ' : ''}${escapeHtml(s.title)}</span></button>`;
  });
  const mr = 3 + Math.max(1, p.steps.length);
  if (!p.steps.length) html += `<div class="ptl-cell ptl-lab" style="grid-row:3;grid-column:1">Steps</div><div class="ptl-cell muted small" style="grid-row:3;grid-column:2 / span ${p.weeks}">No steps yet.</div>`;
  html += `<div class="ptl-cell ptl-lab ptl-sep" style="grid-row:${mr};grid-column:1">Meetings</div>`;
  for (let w = 1; w <= p.weeks; w++) {
    const ms = p.meetings.filter((m) => m.week === w);
    html += `<div class="ptl-cell ptl-sep ptl-meets" style="grid-row:${mr};grid-column:${w + 1}">${ms.map((m) =>
      `<button class="ptl-meet k-${m.kind}" data-act="meet-edit" data-id="${m.id}"><span>▲</span>${escapeHtml(m.title)}<small>${DAY_NAMES[(m.weekday || 1) - 1]}${m.time ? ` ${m.time.slice(0, 5)}` : ''}</small></button>`).join('')}</div>`;
  }
  return `<div class="ptl-scroll"><div class="ptl" style="grid-template-columns:${cols}">${html}</div></div>`;
}

// The timeline keeps its sideways scroll when the page redraws, and first opens on the current week.
let tlScroll = { id: null, left: 0 };
document.addEventListener('scroll', (e) => {
  if (e.target.classList && e.target.classList.contains('ptl-scroll')) tlScroll = { id: route.projId, left: e.target.scrollLeft };
}, true);
function scrollTimeline() {
  const box = $app.querySelector('.ptl-scroll');
  if (!box) return;
  if (tlScroll.id === route.projId) { box.scrollLeft = tlScroll.left; return; }
  const now = box.querySelector('.ptl-week.now');
  const lab = box.querySelector('.ptl-lab').offsetWidth;
  box.scrollLeft = now ? Math.max(0, now.offsetLeft - lab - (box.clientWidth > 520 ? now.offsetWidth : 0)) : 0;
  tlScroll = { id: route.projId, left: box.scrollLeft };
}

const projMonthView = new Map(); // project id -> the month shown
// Folded Timeline/Calendar cards, remembered per project on this device.
let foldedCal = new Set();
try { foldedCal = new Set(JSON.parse(localStorage.getItem('foldedProjCal') || '[]')); } catch {}
function toggleProjFold(id) {
  if (foldedCal.has(id)) foldedCal.delete(id); else foldedCal.add(id);
  try { localStorage.setItem('foldedProjCal', JSON.stringify([...foldedCal])); } catch {}
  render();
}
// Monthly format: a calendar grid per month with meetings and step deadlines on their days,
// and the steps listed underneath. Tap a date to add a meeting on it.
function monthViewHtml(p) {
  const today = todayISO(), open = noTime(p), [a, z] = open ? ['0000-00-00', '9999-12-31'] : projSpan(p), [ink, fill, mid] = pcol(p);
  const on = {};
  const add = (d, h) => { on[d] = (on[d] || '') + h; };
  if (!open) {
    for (const m of [...p.meetings].sort((x, y) => (x.time || '99').localeCompare(y.time || '99'))) {
      add(meetingDate(p, m), `<button class="pm-ev k-${m.kind}" data-act="meet-edit" data-id="${m.id}" title="${escapeHtml(m.title)}">${m.time ? `<small>${m.time.slice(0, 5)}</small> ` : ''}${escapeHtml(m.title)}</button>`);
    }
    for (const s of p.steps) add(stepDue(p, s), `<button class="pm-ev due ${s.done ? 'done' : ''}" data-act="step-edit" data-id="${s.id}" title="${escapeHtml(s.title)} due">⚑ ${escapeHtml(s.title)}</button>`);
  }
  // one month at a time: the month you moved to, else this month (or the nearest end of the project);
  // an ongoing project has no first or last month
  const now = today.slice(0, 7), all = open ? null : projMonths(p);
  const picked = projMonthView.get(p.id);
  const mk = open ? (picked || now) : all.includes(picked) ? picked : all.includes(now) ? now : now < all[0] ? all[0] : all.at(-1);
  const i = open ? 0 : all.indexOf(mk);
  const prev = open ? addMonthKey(mk, -1) : all[i - 1], next = open ? addMonthKey(mk, 1) : all[i + 1];
  const end = monthEnd(mk);
  let cells = '';
  for (let d = weekOf(monthStart(mk)); !(d > end && parseISO(d).getDay() === 1); d = addDaysISO(d, 1)) {
    const inMonth = d.slice(0, 7) === mk;
    cells += `<div class="pm-day ${inMonth ? '' : 'out'} ${d === today ? 'today' : ''} ${d < a || d > z ? 'off' : ''}">
      ${inMonth ? `${open ? `<span class="pm-num">${parseISO(d).getDate()}</span>` : `<button class="pm-num" data-act="meet-new" data-day="${d}" aria-label="Add a meeting on ${fmtShort(d)}">${parseISO(d).getDate()}</button>`}${on[d] || ''}` : ''}</div>`;
  }
  const month = `<div class="pm-month"><div class="pm-nav">
      <button class="icon-btn" data-act="pm-month" data-mk="${prev || ''}" ${prev ? '' : 'disabled'} aria-label="Previous month">‹</button>
      <h3>${monthName(mk)}${open ? '' : `<small>Month ${i + 1} of ${all.length}</small>`}</h3>
      <button class="icon-btn" data-act="pm-month" data-mk="${next || ''}" ${next ? '' : 'disabled'} aria-label="Next month">›</button>
      ${mk !== now && (open || all.includes(now)) ? `<button class="mini-btn" data-act="pm-month" data-mk="${now}">This month</button>` : ''}</div>
    <div class="pm-grid">${DAY_NAMES.map((n) => `<div class="pm-dn">${n}</div>`).join('')}${cells}</div></div>`;
  const steps = open ? '' : p.steps.map((s) => `<button class="pm-step ${s.done ? 'done' : ''}" data-act="step-edit" data-id="${s.id}" style="--pc:${mid};background:${fill};color:${ink}">
    <b>${s.done ? '✓ ' : ''}${escapeHtml(s.title)}</b><small>${shortRange(projWeekStart(p, s.week_from), stepDue(p, s))}</small></button>`).join('');
  return `<div class="pmonths">${month}</div>${steps ? `<div class="pm-steps"><h3>Steps</h3>${steps}</div>` : ''}`;
}


function projectPageHtml() {
  const back = '<button class="icon-btn" data-act="back" aria-label="Back">‹</button>';
  if (!sbUser) return gallerySignIn(`<header class="top">${topBar({ left: back, title: 'Project' })}</header>`);
  if (projects === null) { loadProjects(); return `<header class="top">${topBar({ left: back, title: 'Project' })}</header><section class="card"><p class="muted pad">Loading…</p></section>`; }
  const p = projById(route.projId);
  if (!p) return `<header class="top">${topBar({ left: back, title: 'Not found' })}</header><section class="card empty"><p>This project no longer exists.</p><a class="btn" href="#/gallery">Gallery</a></section>`;
  const [ink, fill] = pcol(p), logo = safeLogo(p.logo);
  return `
    <header class="top">${topBar({ left: back, label: 'Project', title: escapeHtml(p.name), right: `<a class="txt-btn" href="#/gallery/${p.id}/edit">Edit</a>` })}
      <div class="pmeta">${logo ? `<img class="plogo" src="${logo}" alt="">` : ''}<span class="ppill" style="background:${fill};color:${ink}">${projStatus(p)}</span>
        <button class="mini-btn" data-act="proj-done">${p.done_on ? '✓ Complete · reopen' : `Mark complete · +${puzProjectPieces(p)} pieces`}</button>
        ${p.notion_url ? `<a class="mini-btn" href="${escapeHtml(notionAppUrl(p.notion_url))}" target="_blank" rel="noopener">N Notion page</a>` : `<a class="mini-btn" href="#/gallery/${p.id}/edit">+ Add Notion page</a>`}</div>
    </header>
    ${linksHtml(p)}
    ${noTime(p) ? stepsChecklistHtml(p) : ''}
    <section class="card ${foldedCal.has(p.id) ? 'folded' : ''}" data-section="${p.layout === 'weeks' ? 'Timeline' : 'Calendar'}">
      <div class="card-head"><h2>${p.layout === 'weeks' ? 'Timeline' : 'Calendar'}</h2>
        <span class="hint push">${projRange(p)}</span>
        <button class="mini-btn" data-act="proj-fold" aria-expanded="${!foldedCal.has(p.id)}">${foldedCal.has(p.id) ? 'Show' : 'Hide'}</button></div>
      ${foldedCal.has(p.id) ? '' : `${p.layout === 'weeks' ? timelineHtml(p) : monthViewHtml(p)}
      ${noTime(p) ? '' : '<div class="btn-row"><button class="btn" data-act="step-new">+ Step</button><button class="btn" data-act="meet-new">+ Meeting</button></div>'}`}
    </section>`;
}

// "8 weeks · Week 1 is 28 Sep to 4 Oct" under the start and end dates.
function projLengthLabel(a, b) {
  if (!a || !b) return 'Pick both dates.';
  if (b < a) return 'The end date is before the start date.';
  const days = Math.round((parseISO(b) - parseISO(a)) / 864e5) + 1, weeks = Math.ceil((Math.round((parseISO(b) - parseISO(weekOf(a))) / 864e5) + 1) / 7);
  const len = days < 14 ? `${days} days` : days % 7 === 0 ? `${days / 7} weeks` : `${Math.floor(days / 7)} weeks ${days % 7} days`;
  const sun = addDaysISO(weekOf(a), 6);
  return `${len} · Week 1 is ${shortRange(a, sun < b ? sun : b)}${weeks > 60 ? ' · too long (60 weeks at most)' : ''}`;
}
function projectEditHtml() {
  const isNew = route.projId === 'new';
  const p = isNew ? { name: '', color: 'blue', layout: 'weeks', logo: '', start_date: currentWeekKey(), weeks: 8, notion_url: '', drive_url: '' } : projById(route.projId);
  if (!p) return projectPageHtml();
  const custom = isHex(p.color), logo = safeLogo(p.logo);
  const [from, to] = isNew ? [todayISO(), addDaysISO(todayISO(), 8 * 7 - 1)] : projSpan(p);
  return `
    <header class="top">${topBar({ left: '<button class="txt-btn" data-act="back">Cancel</button>', title: isNew ? 'New project' : 'Edit project',
      right: '<button class="txt-btn strong" type="submit" form="pform">Save</button>' })}</header>
    <form id="pform" class="card form" data-form="project" data-id="${isNew ? '' : p.id}" data-layout="${['months', 'none'].includes(p.layout) ? p.layout : 'weeks'}">
      <label class="f">Name<input name="name" required maxlength="80" value="${escapeHtml(p.name)}" placeholder="e.g. Castore consulting project"></label>
      <div class="f">Colour<div class="pcolors">${Object.entries(PROJ_COLORS).map(([k, c]) => `<label><input type="radio" name="color" value="${k}" ${p.color === k ? 'checked' : ''}><span style="background:${c[2]}"></span></label>`).join('')}
        <span class="pc-custom" title="Pick any colour"><input type="radio" name="color" value="custom" ${custom ? 'checked' : ''} tabindex="-1" aria-hidden="true">
          <span class="pc-ring" style="${custom ? `background:${p.color}` : ''}"></span>
          <input type="color" name="customColor" value="${custom ? p.color : '#ffde01'}" aria-label="Pick any colour"></span></div>
        <span class="help">The last circle opens a picker for any colour.</span></div>
      <div class="f plogo-field">Logo<div class="plogo-row"><span class="plogo-prev" id="logoPrev">${logo ? `<img src="${logo}" alt="">` : '<span class="muted small">None</span>'}</span>
        <label class="mini-btn">Upload picture…<input type="file" id="logoFile" accept="image/png,image/jpeg,image/webp,image/gif" hidden></label>
        <button type="button" class="mini-btn" data-act="logo-paste">Paste</button>
        <button type="button" class="mini-btn" data-act="logo-color" ${logo ? '' : 'hidden'}>Match colour</button>
        <button type="button" class="mini-btn" data-act="logo-remove" ${logo ? '' : 'hidden'}>Remove</button>
        <input type="hidden" name="logo" value="${logo}"></div>
        <div class="plogo-find"><input id="logoSite" inputmode="url" autocapitalize="off" autocorrect="off" placeholder="or a website, e.g. castore.com" aria-label="Company website">
          <button type="button" class="mini-btn" data-act="logo-find">Find logo</button></div>
        <span class="help">You can also drag a picture onto this box, or copy one and paste it here. For an Instagram or LinkedIn
          profile picture: right-click it and choose <b>Copy Image</b>, then press <b>⌘V</b> (on iPhone: press and hold the picture,
          tap <b>Copy</b>, then tap <b>Paste</b> here). The project colour is taken from the logo; pick another circle to change it.</span>
        <span class="help" id="logoColorNote" hidden></span></div>
      <div class="f">Format<div class="pformat">
        <label><input type="radio" name="layout" value="weeks" ${!['months', 'none'].includes(p.layout) ? 'checked' : ''}><span><b>Week by week</b><small>A column per week with step bars, like a consulting Gantt</small></span></label>
        <label><input type="radio" name="layout" value="months" ${p.layout === 'months' ? 'checked' : ''}><span><b>Monthly calendar</b><small>Month grids with your meetings, for longer things like a society</small></span></label>
        <label><input type="radio" name="layout" value="none" ${p.layout === 'none' ? 'checked' : ''}><span><b>No timeline</b><small>Ongoing, with no dates, like building an app</small></span></label></div></div>
      <div class="only-dated"><div class="f2"><label class="f">Start date<input type="date" name="starts" value="${from}" required></label>
        <label class="f">End date<input type="date" name="ends" value="${to}" required></label></div>
        <span class="help" id="projLength">${projLengthLabel(from, to)}</span></div>
      <label class="f">Notion page<input name="notion" inputmode="url" autocapitalize="off" autocorrect="off" value="${escapeHtml(p.notion_url)}" placeholder="https://www.notion.so/…"></label>
      ${isNew ? `<label class="toggle-row only-weeks"><input type="checkbox" name="meetings" checked><span>Add a kick-off, weekly check-ins, a mid-project check-in and a final presentation<small>You can change or delete them afterwards.</small></span></label>
      <div class="only-months"><label class="toggle-row"><input type="checkbox" name="weekly" checked><span>Weekly meeting<small>Same day and time every week; you can move or cancel single weeks later.</small></span></label>
        <div class="f2"><label class="f">Day<select name="wday">${DAY_NAMES.map((d, i) => `<option value="${i + 1}">${d}</option>`).join('')}</select></label>
          <label class="f">Time (optional)<input type="time" name="wtime"></label></div></div>` : ''}
      <button class="btn primary" type="submit">${isNew ? 'Create project' : 'Save'}</button>
      ${isNew ? '' : '<div class="danger"><button type="button" class="btn warn" data-act="project-delete">Delete project</button></div>'}
    </form>`;
}
async function saveProjectForm(form) {
  const f = new FormData(form);
  const name = String(f.get('name') || '').trim();
  if (!name) { toast('Give it a name'); return; }
  const layout = ['months', 'none'].includes(f.get('layout')) ? f.get('layout') : 'weeks';
  const custom = String(f.get('customColor') || '').toLowerCase();
  const row = {
    name, layout, logo: safeLogo(String(f.get('logo') || '')),
    color: f.get('color') === 'custom' && isHex(custom) ? custom : PROJ_COLORS[f.get('color')] ? f.get('color') : 'blue',
    notion_url: cleanUrl(f.get('notion')),
  };
  let span = null;
  if (layout !== 'none') {
    // exact dates; weeks are counted Monday to Sunday from the week holding the start date
    const a = String(f.get('starts') || ''), b = String(f.get('ends') || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) { toast('Pick a start date and an end date'); return; }
    if (b < a) { toast('The end date is before the start date'); return; }
    span = [a, b];
    row.starts_on = a; row.ends_on = b;
    row.start_date = weekOf(a);
    row.weeks = Math.ceil((Math.round((parseISO(b) - parseISO(row.start_date)) / 864e5) + 1) / 7);
    if (row.weeks > 60) { toast('Projects can be up to 60 weeks long'); return; }
  } else {
    // no dates: keep whatever was there (so switching back restores the old timeline)
    const old = form.dataset.id && projById(form.dataset.id);
    row.start_date = old ? old.start_date : currentWeekKey();
    row.weeks = old ? old.weeks : 8;
  }
  try {
    const saved = await projDb.save('projects', { ...(form.dataset.id ? { id: form.dataset.id } : { sort: (projects || []).length }), ...row });
    if (!form.dataset.id && layout === 'weeks' && f.get('meetings') === 'on') {
      const plan = [{ title: 'Kick-off', kind: 'kickoff', week: 1 }];
      const mid = Math.max(2, Math.round(row.weeks / 2));
      for (let w = 2; w < row.weeks; w++) plan.push(w === mid ? { title: 'Mid-project check-in', kind: 'mid', week: w } : { title: 'Weekly check-in', kind: 'checkin', week: w });
      if (row.weeks > 1) plan.push({ title: 'Final presentation', kind: 'final', week: row.weeks });
      // Mondays, except that none falls before the start or after the end date
      const dayIn = (w) => { const mon = addDaysISO(row.start_date, (w - 1) * 7), d = mon < span[0] ? span[0] : mon > span[1] ? span[1] : mon; return (parseISO(d).getDay() + 6) % 7 + 1; };
      await projDb.insertMany('project_meetings', plan.map((m) => ({ project_id: saved.id, weekday: dayIn(m.week), ...m })));
    }
    if (!form.dataset.id && layout === 'months' && f.get('weekly') === 'on') {
      const wd = Math.min(7, Math.max(1, +f.get('wday') || 1)), rows = [];
      for (let w = 1; w <= row.weeks; w++) {
        const d = addDaysISO(row.start_date, (w - 1) * 7 + wd - 1);
        if (d >= span[0] && d <= span[1]) rows.push({ project_id: saved.id, title: 'Weekly meeting', kind: 'checkin', week: w, weekday: wd, time: validTime(f.get('wtime')) });
      }
      await projDb.insertMany('project_meetings', rows);
    }
    await loadProjects();
    location.replace(`#/gallery/${saved.id}`);
  } catch (e) { toast(/schema cache|does not exist|layout_check|starts_on|ends_on/i.test(e.message || '') ? 'Run the Gallery setup in Supabase once more to turn on formats, logos and any colour.' : sbErr(e)); }
}
async function deleteProject() {
  const p = projById(route.projId);
  if (!p || !confirm(`Delete “${p.name}” with its timeline?`)) return;
  try { await projDb.remove('projects', { id: p.id }); } catch (e) { toast(sbErr(e)); return; }
  projBoards.delete(p.id);
  await loadProjects();
  location.replace('#/gallery');
}

// ---- steps and meetings (edited in a sheet)
function openStepSheet(id) {
  const p = projById(route.projId);
  const s = id ? p.steps.find((x) => x.id === id) : { title: '', week_from: projNowWeek(p) || 1, week_to: Math.min(p.weeks, (projNowWeek(p) || 1) + 1), done: false };
  if (!s) return;
  openSheet(`<div class="sheet-head"><h3>${id ? 'Step' : 'New step'}</h3></div>
    <form class="form flat" data-form="step" data-id="${id || ''}">
      <label class="f">Name<input name="title" required maxlength="120" value="${escapeHtml(s.title)}" placeholder="e.g. Step 1A: customer interviews"></label>
      ${noTime(p) ? `<input type="hidden" name="from" value="${s.week_from}"><input type="hidden" name="to" value="${s.week_to}">` : `<div class="f2"><label class="f">From<select name="from">${weekOptions(p, s.week_from)}</select></label>
        <label class="f">To<select name="to">${weekOptions(p, s.week_to)}</select></label></div>`}
      ${id ? `<label class="toggle-row"><input type="checkbox" name="done" ${s.done ? 'checked' : ''}><span>Done</span></label>` : ''}
      ${noTime(p) ? '' : '<p class="help">Due on the Friday of its last week; it shows on your calendar then.</p>'}
      <button class="btn primary" type="submit">Save</button>
      ${id ? '<button type="button" class="btn warn" data-act="step-delete">Delete step</button>' : ''}
    </form>`, { step: id || 'new' });
}
function openMeetSheet(id, day = null) {
  const p = projById(route.projId);
  const m = id ? p.meetings.find((x) => x.id === id) : { title: p.layout === 'months' ? 'Meeting' : 'Weekly check-in', kind: p.layout === 'months' ? 'other' : 'checkin', week: projNowWeek(p) || 1, weekday: 1, time: null };
  if (!m) return;
  if (day) { // tapped a date on the monthly calendar
    const w = Math.floor(Math.round((parseISO(day) - parseISO(p.start_date)) / 864e5) / 7) + 1;
    if (w < 1 || w > p.weeks) { toast('That day is outside this project'); return; }
    m.week = w; m.weekday = (parseISO(day).getDay() + 6) % 7 + 1;
  }
  openSheet(`<div class="sheet-head"><h3>${id ? 'Meeting' : 'New meeting'}</h3></div>
    <form class="form flat" data-form="meeting" data-id="${id || ''}">
      <label class="f">Name<input name="title" required maxlength="120" value="${escapeHtml(m.title)}"></label>
      <div class="f2"><label class="f">Type<select name="kind">${Object.entries(MEETING_KINDS).map(([k, l]) => `<option value="${k}" ${m.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="f">Week<select name="week">${weekOptions(p, m.week)}</select></label></div>
      <div class="f2"><label class="f">Day<select name="weekday">${DAY_NAMES.map((d, i) => `<option value="${i + 1}" ${(m.weekday || 1) === i + 1 ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
        <label class="f">Time (optional)<input type="time" name="time" value="${m.time ? m.time.slice(0, 5) : ''}"></label></div>
      ${id ? '' : '<label class="toggle-row"><input type="checkbox" name="repeat"><span>Every week until the end</span></label>'}
      <button class="btn primary" type="submit">Save</button>
      ${id ? '<button type="button" class="btn warn" data-act="meet-delete">Delete meeting</button>' : ''}
    </form>`, { meet: id || 'new' });
}
async function saveStep(form) {
  const p = projById(route.projId), f = new FormData(form);
  const from = +f.get('from'), to = Math.max(from, +f.get('to'));
  try {
    await projDb.save('project_steps', { ...(form.dataset.id ? { id: form.dataset.id } : { project_id: p.id, sort: p.steps.length }),
      title: String(f.get('title') || '').trim() || 'Step', week_from: from, week_to: to, ...(form.dataset.id ? { done: f.get('done') === 'on' } : {}) });
    closeSheet();
    await loadProjects();
  } catch (e) { toast(sbErr(e)); }
}
async function saveMeeting(form) {
  const p = projById(route.projId), f = new FormData(form);
  const row = { title: String(f.get('title') || '').trim() || 'Meeting', kind: MEETING_KINDS[f.get('kind')] ? f.get('kind') : 'other',
    week: +f.get('week'), weekday: +f.get('weekday') || 1, time: validTime(f.get('time')) };
  try {
    if (!form.dataset.id && f.get('repeat') === 'on') {
      const [, z] = projSpan(p), rows = [];
      for (let w = row.week; w <= p.weeks; w++) if (meetingDate(p, { week: w, weekday: row.weekday }) <= z) rows.push({ project_id: p.id, ...row, week: w });
      await projDb.insertMany('project_meetings', rows);
    } else await projDb.save('project_meetings', { ...(form.dataset.id ? { id: form.dataset.id } : { project_id: p.id }), ...row });
    closeSheet();
    await loadProjects();
  } catch (e) { toast(sbErr(e)); }
}
async function removeFromSheet(table) {
  const id = sheetCtx && (sheetCtx.step || sheetCtx.meet);
  if (!id || id === 'new' || !confirm('Delete it?')) return;
  try { await projDb.remove(table, { id }); } catch (e) { toast(sbErr(e)); return; }
  closeSheet();
  await loadProjects();
}

// ---------- Academics (Moodle) ----------
// Reads your courses from Moodle (through the server, see server/moodle.mjs) so you never have to log
// in and hunt for things: each course shows where the course has got to this term vs what you've
// finished, a progress tree, and a catch-up list. Every item has an Open button (files open straight
// away) and your notes link for the course (e.g. OneNote). Your ticks, notes links and term dates are
// kept in Supabase (supabase/academics.sql); the course contents are only read, never copied.
const ACAD_KEYS = ['blue', 'purple', 'teal', 'coral', 'pink', 'amber', 'green'];
const ACAD_STALE_MS = 3 * 3600e3;          // reload course contents when older than this
const acad = {
  conn: null,            // null = not known yet, false = not connected, true = connected
  name: '', courses: null, contents: new Map(), errors: new Map(),
  progress: new Map(),   // item id -> when you ticked it
  tracked: new Set(), notes: new Map(), kinds: new Map(), lanes: new Map(), offsets: new Map(), lpw: new Map(), termStart: '2026-09-28', haveRows: false,
  at: 0, failAt: 0, loading: false, error: '', expired: false, dbMissing: false, choosing: false, just: null,
};
const acadOpenWeeks = new Map(); // "course:week" -> opened or folded by you

// ---- the database calls and the server calls
const acadDb = {
  async mine() {
    const [p, c, s] = await Promise.all([
      sb.from('academic_progress').select('item_id, done_at'),
      sb.from('academic_courses').select('course_id, notes_url, tracked, kind, lanes, week_offset, lectures_per_week'),
      sb.from('academic_settings').select('term_start').maybeSingle(),
    ]);
    const err = p.error || c.error || s.error;
    if (err) throw err;
    return { progress: p.data, courses: c.data, term: s.data };
  },
  async tick(item, course) {
    const { error } = await sb.from('academic_progress').upsert({ user_id: sbUser.id, item_id: item, course_id: course }, { onConflict: 'user_id,item_id' });
    if (error) throw error;
  },
  async untick(item) {
    const { error } = await sb.from('academic_progress').delete().eq('item_id', item);
    if (error) throw error;
  },
  async tickMany(items, course) {
    if (!items.length) return;
    const { error } = await sb.from('academic_progress').upsert(items.map((item) => ({ user_id: sbUser.id, item_id: item, course_id: course })), { onConflict: 'user_id,item_id' });
    if (error) throw error;
  },
  async untickMany(items) {
    if (!items.length) return;
    const { error } = await sb.from('academic_progress').delete().in('item_id', items);
    if (error) throw error;
  },
  async course(row) {
    const { error } = await sb.from('academic_courses').upsert({ user_id: sbUser.id, ...row }, { onConflict: 'user_id,course_id' });
    if (error) throw error;
  },
  async term(date) {
    const { error } = await sb.from('academic_settings').upsert({ user_id: sbUser.id, term_start: date }, { onConflict: 'user_id' });
    if (error) throw error;
  },
};
async function moodleApi(body) {
  const res = await fetch('/api/moodle', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${state.sync.key}` }, body: JSON.stringify(body) });
  const r = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(r.error || 'Couldn’t reach the server.'), { status: res.status, data: r });
  return r;
}

// ---- remembered between visits, so the tab opens at once (links are refreshed after a few hours)
function acadSaveCache() {
  try {
    localStorage.setItem('acadCache', JSON.stringify({ v: 5, at: acad.at, name: acad.name, courses: acad.courses, contents: [...acad.contents], site: acad.site || '',
      mine: { tracked: [...acad.tracked], progress: [...acad.progress], notes: [...acad.notes], kinds: [...acad.kinds], lanes: [...acad.lanes], offsets: [...acad.offsets], lpw: [...acad.lpw], termStart: acad.termStart } }));
  } catch { /* storage full or blocked */ }
}
(function acadRestore() {
  try {
    const c = JSON.parse(localStorage.getItem('acadCache') || 'null');
    if (!c || c.v !== 5 || !Array.isArray(c.courses)) return;
    acad.conn = true; acad.name = c.name || ''; acad.courses = c.courses; acad.contents = new Map(c.contents || []); acad.at = c.at || 0; acad.site = c.site || acad.site;
    const m = c.mine || {};
    acad.tracked = new Set(m.tracked || []); acad.progress = new Map(m.progress || []); acad.notes = new Map(m.notes || []); acad.kinds = new Map(m.kinds || []);
    acad.lanes = new Map(m.lanes || []); acad.offsets = new Map(m.offsets || []); acad.lpw = new Map(m.lpw || []); acad.termStart = m.termStart || acad.termStart;
  } catch { /* nothing usable */ }
})();
function acadReset() {
  Object.assign(acad, { conn: null, name: '', courses: null, error: '', expired: false, dbMissing: false, at: 0, failAt: 0 });
  acad.contents.clear(); acad.errors.clear(); acad.progress.clear(); acad.tracked.clear(); acad.notes.clear(); acad.kinds.clear(); acad.lanes.clear(); acad.offsets.clear(); acad.lpw.clear();
  try { localStorage.removeItem('acadCache'); } catch {}
}
const rerenderAcad = () => { if (['academics', 'today', 'plan', 'home'].includes(route.tab) && !sheetCtx && !typing() && !wDrag) render(); };

// ---- loading: your choices from Supabase, then Moodle
async function acadLoad({ force = false } = {}) {
  if (acad.loading || !sbUser || !state.sync.key) return;
  if (!force && acad.at && Date.now() - acad.at < ACAD_STALE_MS) return;
  if (!force && acad.failAt && Date.now() - acad.failAt < 10 * 60e3) return;
  acad.loading = true; acad.error = ''; acad.expired = false;
  rerenderAcad();
  try {
    const [st, mine] = await Promise.all([
      moodleApi({ action: 'status' }),
      acadDb.mine().catch((e) => { if (/does not exist|schema cache/i.test(e.message || '')) { acad.dbMissing = true; return null; } throw e; }),
    ]);
    if (mine) {
      acad.dbMissing = false;
      acad.progress = new Map(mine.progress.map((r) => [+r.item_id, r.done_at]));
      acad.notes = new Map(mine.courses.map((r) => [+r.course_id, r.notes_url || '']));
      acad.kinds = new Map(mine.courses.map((r) => [+r.course_id, r.kind === 'qual' ? 'qual' : 'quant']));
      acad.lanes = new Map(mine.courses.map((r) => [+r.course_id, r.lanes && typeof r.lanes === 'object' ? r.lanes : {}]));
      acad.offsets = new Map(mine.courses.map((r) => [+r.course_id, Math.max(0, +r.week_offset || 0)]));
      acad.lpw = new Map(mine.courses.map((r) => [+r.course_id, Math.min(4, Math.max(0, +r.lectures_per_week || 0))]));
      acad.tracked = new Set(mine.courses.filter((r) => r.tracked).map((r) => +r.course_id));
      acad.haveRows = mine.courses.length > 0;
      if (mine.term && mine.term.term_start) acad.termStart = mine.term.term_start;
    }
    acad.conn = st.connected; acad.name = st.name || ''; acad.site = st.site || acad.site;
    if (!st.connected) { acad.courses = null; acad.contents.clear(); try { localStorage.removeItem('acadCache'); } catch {} }
    else {
      acad.courses = (await moodleApi({ action: 'courses' })).courses;
      if (mine && !acad.haveRows) await acadAutoTrack(); // first time: the courses that started recently
      await acadLoadContents();
    }
    acad.at = Date.now(); acad.failAt = 0;
    if (st.connected) acadSaveCache();
  } catch (e) {
    acad.error = e.message; acad.expired = !!(e.data && e.data.expired); acad.failAt = Date.now();
    if (e.data && e.data.notConnected) acad.conn = false;
  } finally { acad.loading = false; rerenderAcad(); }
}
async function acadLoadContents(ids = [...acad.tracked]) {
  await Promise.all(ids.map(async (id) => {
    try { acad.contents.set(id, await moodleApi({ action: 'contents', courseId: id })); acad.errors.delete(id); }
    catch (e) { acad.errors.set(id, e.message); }
  }));
}
// First connection: track the courses that began in the last five months and haven't ended; the
// chooser (Choose courses) is where you change that.
async function acadAutoTrack() {
  const now = Date.now() / 1000;
  const pick = acad.courses.filter((c) => c.start && c.start > now - 150 * 86400 && c.start < now + 14 * 86400 && (!c.end || c.end > now));
  for (const c of pick) { acad.tracked.add(c.id); try { await acadDb.course({ course_id: c.id, tracked: true }); } catch { /* shown next load */ } }
  acad.haveRows = pick.length > 0;
  if (!pick.length) acad.choosing = true;
}
// Today and the Academics tab keep a connected account's courses fresh in the background.
function acadEnsure() { if (acad.conn === true && !acad.loading) acadLoad(); }

// ---- the numbers: where the course is vs where you are
const termWeek = () => Math.floor((parseISO(todayISO()) - parseISO(acad.termStart)) / (7 * 864e5)) + 1; // <= 0 before term
const acadKeyOf = (cid) => ACAD_KEYS[Math.max(0, (acad.courses || []).findIndex((c) => c.id === cid)) % ACAD_KEYS.length];
const acadColor = (cid) => PROJ_COLORS[acadKeyOf(cid)];
// Each week's items fall into lanes: Reading, Lecture, Problem set & quiz (and Other). They're sorted
// by what Moodle calls them, and you can move any item (the choice is remembered for the course).
const LANES = [['reading', 'Reading'], ['lecture', 'Lecture'], ['practice', 'Problem sets'], ['other', 'Other']];
const LANE_NAME = Object.fromEntries(LANES);
const LANE_SHORT = { reading: 'Reading', lecture: 'Lecture', practice: 'Problems', other: 'Other' };
// Sorting an item into a lane uses everything Moodle tells us: the item's title, its type, its file names
// and types (Stata .do/.dta files are workshop work, slides and recordings are lecture), and then the
// week's own title or description as a hint for items that say nothing themselves.
const RE_PRACTICE = /problems?\b|exercises?|quiz|homework|\bhw ?\d|worksheets?|work sheets?|assignments?|formative|summative|past papers?|mock|\bpsets?\b|\bps ?\d|tutorials?|workshops?|\blabs?\b|practicals?|stata|\bpython\b|\br ?studio\b|replication|solutions?|answers?|answer key|example sheets?|question sheets?|\bquestions?\b|problem class|coursework|\bcw ?\d|\bdata ?sets?\b|\bdo[- ]?files?\b/i;
const RE_LECTURE = /lectures?|\blec\b|\blec ?\d|\bl\d{1,2}\b|slides?|slide deck|recordings?|panopto|echo ?360|videos?|webinar|podcast|presentations?|powerpoint|\bppt|screencast|lecture notes?/i;
const RE_READING = /\bread|chapters?|\bch\.? ?\d|articles?|\bpapers?\b|textbook|journal|case study|essay|\bbooks?\b|references?|bibliography|extracts?|\bnotes? on\b/i;
const EXT_PRACTICE = new Set(['do', 'dta', 'ado', 'r', 'rmd', 'py', 'ipynb', 'csv', 'sav', 'xlsx', 'xls', 'sas', 'm']);
const EXT_LECTURE = new Set(['pptx', 'ppt', 'key', 'mp4', 'm4a', 'mp3', 'mov', 'm4v', 'webm']);
const fileExts = (i) => (i.files || []).map((f) => ((String(f.name || '').match(/\.([a-z0-9]{1,5})$/i) || [])[1] || '').toLowerCase()).filter(Boolean);
const fileNames = (i) => (i.files || []).map((f) => f.name || '').join(' ');
function laneFromText(t) {
  t = String(t || '').replace(/reading[- ]week/gi, ' '); // a break, not reading material
  if (RE_PRACTICE.test(t)) return 'practice';
  if (RE_LECTURE.test(t)) return 'lecture';
  if (RE_READING.test(t)) return 'reading';
  return null;
}
function autoLane(i) {
  const name = String(i.name || '').toLowerCase(), exts = fileExts(i), files = fileNames(i).toLowerCase();
  if (['assign', 'quiz', 'workshop'].includes(i.type)) return 'practice';
  if (i.type === 'kalvidres' || i.type === 'panopto') return 'lecture';
  if (i.type === 'lti') return /read|list|leganto|talis|reference|bibliograph/.test(name) ? 'reading' : /lectur|record|panopto|echo|video|capture|replay/.test(name) ? 'lecture' : 'other'; // an external tool: recordings, a reading list, a discussion board…
  const byName = laneFromText(name);              // what the item calls itself wins
  if (byName) return byName;
  if (exts.some((e) => EXT_PRACTICE.has(e))) return 'practice';
  if (exts.some((e) => EXT_LECTURE.has(e))) return 'lecture';
  const byFile = laneFromText(files);             // then what its files are called
  if (byFile) return byFile;
  if (['url', 'book'].includes(i.type)) return 'reading';
  if ((i.files || []).some((f) => /^(video|audio)\//.test(f.type || ''))) return 'lecture';
  return i.hint || 'other';                       // finally, what the week says it is about
}
// "Week 2: Stata workshop" / a description that says "problem set": unlabelled items in that week follow it.
const weekHint = (s) => laneFromText(`${s.name || ''}`.toLowerCase().replace(/^\s*(?:weeks?|lectures?|topics?|sessions?)?\s*\d+\s*[:.)\-–—]?\s*/i, ''));
function laneOf(i) {
  const o = (acad.lanes.get(i.courseId) || {})[i.id];
  return o && LANE_NAME[o] ? o : autoLane(i);
}
// Some courses group Moodle by TYPE ("Lectures", "Problem sets", "Stata Workshops") and put the week in each
// item's own title ("Lecture 3 2026", "Problem set 2"). Then every item goes to the week its title names.
const RE_ITEM_WEEK = /\b(?:weeks?|lectures?|lec|class(?:es)?|seminars?|sessions?|workshops?|tutorials?|labs?|problem sets?|problem sheets?|problems?|psets?|ps|assignments?|homework|hw|quiz(?:zes)?|exercises?|topics?|units?)\s*#?\s*(\d{1,2})(?!\d)|\b[LW](\d{1,2})\b(?![\d.])/i;
const RE_ITEM_LECTURE = /\blectures?\b|\blec\b|\bL\d/i;
function numberInName(i) {
  for (const t of [i.name, ...(i.files || []).map((f) => String(f.name || '').replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[_-]+/g, ' '))]) {
    const m = RE_ITEM_WEEK.exec(String(t || ''));
    if (m) return { n: +(m[1] || m[2]), lecture: RE_ITEM_LECTURE.test(t), workshop: /workshop/i.test(t), explicitWeek: /\bweeks?\s*#?\s*\d/i.test(t) };
  }
  return null;
}
// "Stata Workshops will be on Friday in weeks 1, 2, 4, 6, and 9": workshop 3 is the third of those, week 4.
function parseWeekList(text) {
  const m = /weeks?\s+(\d{1,2}(?:(?:\s*,\s*(?:and\s+)?|\s+and\s+|\s*&\s*)\d{1,2})+)/i.exec(String(text || ''));
  return m ? m[1].match(/\d{1,2}/g).map(Number) : null;
}
function itemWeeks(data, lpwSetting) {
  const found = data.sections.map((s) => ({ s, list: parseWeekList(s.summary), its: s.items.map((i) => ({ i, k: numberInName(i) })) }));
  const maxLecture = Math.max(0, ...found.flatMap((f) => f.its.filter((x) => x.k && x.k.lecture && !x.k.explicitWeek).map((x) => x.k.n)));
  const lpw = lpwSetting || Math.max(1, Math.ceil(maxLecture / 10)); // lectures per week, if not set: ~10 teaching weeks
  const out = new Map();
  for (const f of found) for (const { i, k } of f.its) {
    let w = null;
    if (k) {
      if (k.explicitWeek) w = k.n;
      else if (k.lecture) w = Math.ceil(k.n / lpw);
      else if (k.workshop && f.list && f.list[k.n - 1]) w = f.list[k.n - 1];
      else w = k.n;
    }
    out.set(i.id, w && w >= 1 && w <= 52 ? w : null);
  }
  return { weeks: out, lpw, auto: !lpwSetting, maxLecture };
}
// What an item is called, with its numbers taken out, so "Problem set 3" and "Problem set 4" are alike.
const itemPattern = (name) => String(name || '').toLowerCase().replace(/\b(?:weeks?|wk|w)\s*\d+\b/g, ' ').replace(/\d+/g, '#').replace(/[^a-z#]+/g, ' ').trim();
// "Qualitative" courses (essays, cases) treat the reading as part of the week; for "quantitative" ones it's
// optional, so it isn't counted when working out how far behind you are.
const acadKind = (cid) => acad.kinds.get(cid) || 'quant';
// "Week 4: Consumer choice" / "2. Demand" / "Lecture 3 - Costs" -> the topic without its numbering.
const acadTopicOf = (name) => String(name || '').replace(/^\s*(?:(?:weeks?|lectures?|topics?|sessions?|units?|modules?|chapters?|parts?|seminars?|classes|class|w)\s*[.#]?\s*\d{1,2}|\d{1,2})\s*[:.)\-–—]?\s*/i, '').trim();
const ACAD_TEST_RE = /\b(tests?|quiz(?:zes)?|assessments?|exams?|examinations?|mock|past papers?)\b/i; // same idea as the server's TEST_RE
const LANE_ORDER = ['reading', 'lecture', 'practice', 'other']; // the rows of a week, top to bottom (after the topic)
const countsFor = (i) => !(acadKind(i.courseId) === 'quant' && i.lane === 'reading');
const acadDone = (i) => acad.progress.has(i.id) || i.moodleDone;
function acadCourse(cid) {
  const data = acad.contents.get(cid), meta = (acad.courses || []).find((c) => c.id === cid);
  if (!data || !meta) return null;
  const cur = termWeek(), off = acad.offsets.get(cid) || 0;
  // Do the sections carry weeks (Week 3 / 3. Demand)? If none does, check whether the items' own titles do.
  const guessed = data.sections.some((s) => s.week != null && s.weekFrom === 'order');
  let byItem = null;
  if (guessed) {
    const probe = itemWeeks(data, acad.lpw.get(cid) || 0), known = [...probe.weeks.values()].filter((w) => w != null);
    if (known.length >= 3 && new Set(known).size >= 2) byItem = probe;
  }
  const bump = (w) => (w == null ? null : w + off);
  const weekOfSec = (s) => (byItem ? null : s.week == null ? null : s.week + off);
  const items = data.sections.flatMap((s, si) => s.items.map((i, ii) => {
    const it = { ...i, week: byItem ? bump(byItem.weeks.get(i.id)) : weekOfSec(s), section: s.name, courseId: cid, order: si * 1000 + ii, hint: weekHint(s) };
    it.lane = laneOf(it);
    return it;
  }));
  const weekly = items.filter((i) => i.week != null), counted = weekly.filter(countsFor);
  const past = counted.filter((i) => i.week < cur && !acadDone(i)).sort((a, b) => a.week - b.week || a.order - b.order);
  const now = counted.filter((i) => i.week === cur && !acadDone(i)).sort((a, b) => a.order - b.order);
  const due = counted.filter((i) => i.week <= cur);
  const behind = past.length ? cur - past[0].week : 0;
  // one entry per week, with its items split into lanes
  const byWeek = new Map();
  if (byItem) {
    for (const i of weekly) (byWeek.get(i.week) || byWeek.set(i.week, { week: i.week, topic: '', summary: '', items: [] }).get(i.week)).items.push(i);
  } else {
    for (const s of data.sections) {
      const wk = weekOfSec(s);
      if (wk == null) continue;
      const w = byWeek.get(wk) || byWeek.set(wk, { week: wk, topic: '', summary: '', items: [] }).get(wk);
      if (!w.topic) w.topic = acadTopicOf(s.name);
      if (!w.summary && s.summary) w.summary = s.summary;
      for (const i of items.filter((x) => x.section === s.name && x.week === wk)) if (!w.items.includes(i)) w.items.push(i);
    }
  }
  const weeks = [...byWeek.values()].sort((a, b) => a.week - b.week).map((w) => {
    if (!w.topic && w.summary) { // a section titled just "Week 3": its description holds the topic
      const [first, ...rest] = w.summary.split('\n');
      w = { ...w, topic: first.slice(0, 100), summary: rest.join('\n').trim() };
    }
    w.items.sort((a, b) => a.order - b.order);
    const lanes = Object.fromEntries(LANES.map(([k]) => [k, w.items.filter((i) => i.lane === k)]));
    const left = w.items.filter((i) => countsFor(i) && !acadDone(i)).length;
    return { ...w, lanes, left, state: !w.items.length ? 'empty' : left === 0 ? 'full' : w.week < cur ? 'late' : w.week === cur ? 'now' : 'ahead' };
  });
  // a section for tests/assessment gets its own card; everything else outside the weeks is Course info
  const isTest = (i) => i.week == null && ACAD_TEST_RE.test(i.section);
  const tests = items.filter(isTest), info = items.filter((i) => i.week == null && !isTest(i));
  return { meta, cur, items, weekly, weeks, info, tests, guessed, byItem: !!byItem, lpw: byItem ? byItem.lpw : 0, lpwAuto: byItem ? byItem.auto : true, maxLecture: byItem ? byItem.maxLecture : 0,
    offset: off, catchUp: past, thisWeek: now, behind, next: past[0] || now[0] || null,
    doneSoFar: due.filter(acadDone).length, totalSoFar: due.length, done: items.filter(acadDone).length, sections: data.sections };
}
function acadStatus(c) {
  if (!c) return { text: 'Couldn’t load', cls: 'err' };
  if (c.cur <= 0) return { text: `Term starts ${fmtShort(acad.termStart)}`, cls: '' };
  if (c.behind > 0) return { text: `${c.behind} week${c.behind === 1 ? '' : 's'} behind · ${c.catchUp.length} to catch up`, cls: 'late' };
  if (c.thisWeek.length) return { text: `Week ${c.cur} · ${c.thisWeek.length} to do`, cls: 'now' };
  return { text: 'On track ✓', cls: 'ok' };
}
const fmtBytes = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : n ? `${n} B` : '');

// ---- pieces: an item row (used on the course page, in the catch-up list and on Today)
function acadItemHtml(i, { inWeek = false } = {}) {
  const done = acadDone(i), moodle = i.moodleDone && !acad.progress.has(i.id);
  const f = i.files || [];
  const open = f.length ? `<a class="mini-btn go" href="${escapeHtml(f[0].link)}" target="_blank" rel="noopener">Open</a>`
    : i.link ? `<a class="mini-btn ${/moodle/.test(hostOf(i.link)) ? '' : 'go'}" href="${escapeHtml(i.link)}" target="_blank" rel="noopener">${/moodle/.test(hostOf(i.link)) ? 'Moodle ↗' : 'Open ↗'}</a>` : '';
  const meta = [inWeek ? '' : i.week != null ? `Week ${i.week}` : i.section, i.label, f.length === 1 ? fmtBytes(f[0].size) : f.length > 1 ? `${f.length} files` : '', i.due ? `due ${fmtShort(isoDate(new Date(i.due * 1000)))}` : ''].filter(Boolean).join(' · ');
  return `<div class="aitem ${done ? 'done' : ''}">
    <button class="acheck" data-act="acad-tick" data-id="${i.id}" data-course="${i.courseId}" aria-pressed="${done}" ${moodle ? 'disabled title="Done in Moodle"' : ''}
      aria-label="${escapeHtml(i.name)} ${done ? 'done' : 'not done'}">${done ? CHECK : ''}</button>
    <div class="aitem-main"><b>${escapeHtml(i.name)}</b>${meta ? `<small>${escapeHtml(meta)}</small>` : ''}</div>
    <div class="aitem-go">${open}<button class="mini-btn ghost logo-btn" data-act="acad-wb" data-id="${i.id}" data-course="${i.courseId}" aria-label="Add ${escapeHtml(i.name)} to this week’s whiteboard" title="Add to this week’s whiteboard"><img src="icons/icon-192.png" alt="">＋</button><button class="mini-btn ghost" data-act="acad-more" data-id="${i.id}" data-course="${i.courseId}" data-week="${inWeek ? 1 : ''}" aria-label="More for ${escapeHtml(i.name)}">⋯</button></div>
  </div>`;
}

// ---- the week board: one block per week, with Reading, Lecture and Problem set & quiz side by side
const acadWeekKey = (c, w) => `${c.meta.id}:w${w.week}`;
function acadWeekOpen(c, w) {
  const k = acadWeekKey(c, w);
  return acadOpenWeeks.has(k) ? acadOpenWeeks.get(k) : w.week === c.cur || w.state === 'late';
}
// A week's rows: the topic, then Reading, Lecture and Problem sets (Other only if there is something).
const acadWeekDates = (week) => { const a = addDaysISO(acad.termStart, (week - 1) * 7); return shortRange(a, addDaysISO(a, 6)); };
function acadLaneHtml(c, w, lane) {
  const its = w.lanes[lane];
  if (!its.length && lane === 'other') return '';
  const done = its.filter(acadDone).length, optional = acadKind(c.meta.id) === 'quant' && lane === 'reading';
  const canAll = its.length > 1 && its.some((i) => !acadDone(i) || acad.progress.has(i.id));
  const allDone = its.length > 0 && done === its.length;
  const none = { reading: 'No reading posted', lecture: 'No lecture posted yet', practice: 'No problem set posted', other: '' }[lane];
  return `<div class="arow">
    <div class="arow-l"><b>${LANE_NAME[lane]}</b>${its.length ? `<small>${done}/${its.length}${optional ? ' · optional' : ''}</small>` : ''}
      ${canAll ? `<button class="mini-btn ghost" data-act="acad-lane-all" data-course="${c.meta.id}" data-week="${w.week}" data-lane="${lane}">${allDone ? 'Untick all' : 'Tick all'}</button>` : ''}</div>
    <div class="arow-b">${its.length ? its.map((i) => acadItemHtml(i, { inWeek: true })).join('') : `<p class="arow-none">${none}</p>`}</div></div>`;
}
function acadTopicRow(c, w) {
  const text = w.summary && w.summary.toLowerCase() !== w.topic.toLowerCase() ? w.summary : '';
  return `<div class="arow arow-topic">
    <div class="arow-l"><b>Topic</b></div>
    <div class="arow-b">${w.topic ? `<p class="arow-topic-t">${escapeHtml(w.topic)}</p>` : `<p class="arow-none">${c.byItem ? 'Moodle doesn’t name this week’s topic' : `Week ${w.week}`}</p>`}${text ? `<p class="arow-sum">${escapeHtml(text).replace(/\n/g, '<br>')}</p>` : ''}</div></div>`;
}
function acadWeekHtml(c, w) {
  const open = acadWeekOpen(c, w);
  const chips = LANE_ORDER.filter((l) => w.lanes[l].length).map((l) => {
    const n = w.lanes[l].length, d = w.lanes[l].filter(acadDone).length;
    return `<span class="alchip ${d === n ? 'full' : ''}">${LANE_SHORT[l]} ${d}/${n}</span>`;
  }).join('');
  return `<details class="aweek ${w.state}" data-asec="${acadWeekKey(c, w)}" ${open ? 'open' : ''}>
    <summary><span class="aweek-t"><b>Week ${w.week}</b><small>${acadWeekDates(w.week)}</small>
      ${w.week === c.cur ? '<span class="atw-here">this week</span>' : w.state === 'late' ? '<span class="atw-late">behind</span>' : ''}${w.topic ? `<span class="aweek-topic">${escapeHtml(w.topic)}</span>` : ''}</span>
      <span class="aweek-chips">${chips || '<span class="alchip">Nothing posted yet</span>'}</span></summary>
    <div class="arows">${acadTopicRow(c, w)}${LANE_ORDER.map((l) => acadLaneHtml(c, w, l)).join('')}</div>
  </details>`;
}

// ---- the pages
const acadSignIn = (head) => head + `<section class="card banner-card"><b>${state.account ? 'One more Google sign-in' : 'Sign in with Google to use Academics'}</b>
  <p class="small">Your courses are read from Moodle and your progress is saved to your account, so it’s the same on your phone and Mac.</p>
  <div class="btn-row">${state.account ? '<button class="btn primary" data-act="google-signin">Continue with Google</button>' : '<a class="btn primary" href="#/account">Sign in with Google</a>'}</div></section>`;

function acadConnectHtml() {
  return `<section class="card" data-section="Connect Moodle">
    <div class="card-head"><h2>Connect Moodle</h2></div>
    <p class="small">Once connected, your courses, weekly materials and files show up here by themselves, and every item opens in one tap. No more logging in and hunting.</p>
    <ol class="asteps">
      <li>In Moodle, open your name (top right) → <b>Preferences</b> → <b>Security keys</b>.</li>
      <li>Copy the key for <b>Moodle mobile web service</b>.</li>
      <li>Paste it below. It goes straight to your private server, never back to your screen, and the app only ever <b>reads</b> from Moodle.</li>
    </ol>
    ${acad.error ? `<p class="aerr">${escapeHtml(acad.error)}</p>` : ''}
    <form class="pref-add" data-form="acad-connect" autocomplete="off">
      <input name="token" type="password" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Paste your Moodle key" required>
      <button class="btn primary" type="submit">Connect</button></form>
    <p class="help">You can cancel the key at any time with <b>Reset</b> on that same Moodle page, or press Disconnect here.</p>
  </section>`;
}

function acadChooserHtml() {
  return `<section class="card" data-section="Choose courses">
    <div class="card-head"><h2>Which courses are you studying?</h2><button class="mini-btn" data-act="acad-choose">Done</button></div>
    <p class="help">Only the ticked ones are read and tracked. You can change this any time.</p>
    ${(acad.courses || []).map((c) => `<label class="toggle-row"><input type="checkbox" data-acad-track="${c.id}" ${acad.tracked.has(c.id) ? 'checked' : ''}>
      <span><b>${escapeHtml(c.shortname ? `${c.shortname} · ${c.fullname}` : c.fullname)}</b>${c.start ? `<small>from ${fmtShort(isoDate(new Date(c.start * 1000)))}</small>` : ''}</span></label>`).join('') || '<p class="muted small">No courses found in Moodle.</p>'}
  </section>`;
}

function academicsHtml() {
  const refresh = acad.conn ? `<button class="icon-btn ${acad.loading ? 'spin' : ''}" data-act="acad-refresh" aria-label="Refresh from Moodle">↻</button>` : menuBtn;
  const head = `<header class="top">${topBar({ label: 'Study', title: 'Academics', right: refresh })}</header>`;
  if (!sbUser) return acadSignIn(head);
  if (acad.dbMissing) return head + `<section class="card empty"><p><b>One setup step left</b></p><p class="small muted">Run the Academics setup in Supabase once (SQL Editor), then come back.</p>
    <button class="btn" data-act="acad-refresh">Check again</button></section>`;
  if (acad.conn === null) { acadLoad(); return head + '<section class="card"><p class="muted pad">Loading…</p></section>'; }
  if (acad.conn === false) return head + acadConnectHtml();
  acadEnsure();
  const cur = termWeek(), tracked = (acad.courses || []).filter((c) => acad.tracked.has(c.id));
  const termLine = `<div class="aterm"><span>${cur <= 0 ? `Term starts ${fmtShort(acad.termStart)}` : `<b>Term week ${cur}</b>`}</span>
    <label>Week 1 starts <input type="date" data-acad-term value="${acad.termStart}"></label></div>`;
  const cards = tracked.map((meta) => {
    const c = acadCourse(meta.id), st = acadStatus(c), [ink, fill, mid, soft] = acadColor(meta.id);
    const pct = c && c.totalSoFar ? Math.round((c.doneSoFar / c.totalSoFar) * 100) : 0;
    return `<a class="acard" href="#/academics/${meta.id}" style="--ac:${mid};--acs:${soft};--acf:${fill};--ack:${ink}">
      <div class="acard-top"><b>${escapeHtml(meta.shortname || meta.fullname)}</b><span class="achip ${st.cls}">${escapeHtml(st.text)}</span></div>
      <span class="acard-name">${escapeHtml(meta.fullname)}</span>
      ${c ? `<div class="abar" aria-label="${pct}% of what's been taught so far"><i style="width:${pct}%"></i></div>
        <small>${c.doneSoFar} of ${c.totalSoFar} done so far${c.next ? ` · next: ${escapeHtml(c.next.name)}` : ''}</small>`
        : `<small class="muted">${escapeHtml(acad.errors.get(meta.id) || 'Loading…')}</small>`}</a>`;
  }).join('');
  return head + `
    ${acad.error ? `<p class="aerr card">${escapeHtml(acad.error)}${acad.expired ? ' <a href="#/academics">Reconnect</a>' : ''}</p>` : ''}
    ${acad.choosing ? acadChooserHtml() : ''}
    ${termLine}
    ${tracked.length ? `<div class="agrid">${cards}</div>` : acad.choosing ? '' : `<section class="card empty"><p><b>No courses tracked yet</b></p><button class="btn primary" data-act="acad-choose">Choose courses</button></section>`}
    <div class="btn-row acard-foot">${acad.choosing ? '' : '<button class="btn" data-act="acad-choose">Choose courses</button>'}<button class="btn" data-act="acad-disconnect">Disconnect Moodle</button></div>
    <p class="help acard-foot">Connected as ${escapeHtml(acad.name || 'your Moodle account')}${acad.at ? ` · updated ${new Date(acad.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''}</p>`;
}

function courseHtml() {
  const back = '<button class="icon-btn" data-act="back" aria-label="Back">‹</button>';
  if (!sbUser) return acadSignIn(`<header class="top">${topBar({ left: back, title: 'Course' })}</header>`);
  if (acad.conn === null) { acadLoad(); return `<header class="top">${topBar({ left: back, title: 'Course' })}</header><section class="card"><p class="muted pad">Loading…</p></section>`; }
  const meta = (acad.courses || []).find((c) => c.id === route.courseId);
  if (!meta) return `<header class="top">${topBar({ left: back, title: 'Not found' })}</header><section class="card empty"><p>This course isn’t in your Moodle list.</p><a class="btn" href="#/academics">Academics</a></section>`;
  const c = acadCourse(meta.id), st = acadStatus(c), [ink, fill, mid] = acadColor(meta.id), notes = acad.notes.get(meta.id);
  const header = `<header class="top">${topBar({ left: back, label: 'Course', title: escapeHtml(meta.shortname || meta.fullname), right: '<button class="txt-btn" data-act="acad-course-settings">Settings</button>' })}</header>`;
  if (!c) return header + `<section class="card"><p class="muted pad">${escapeHtml(acad.errors.get(meta.id) || (acad.tracked.has(meta.id) ? 'Loading…' : 'This course isn’t tracked. Choose it on the Academics page.'))}</p></section>`;
  const done = c.items.filter(acadDone).length;
  const g = acadGroups(c), cid = meta.id;
  const how = c.byItem ? `Moodle groups this course by type (Lectures, Problem sets…), so each item is placed in the week its title names, e.g. “Problem set 3” in week 3${c.maxLecture > 10 || c.lpw > 1 ? `. Lectures are numbered across the term (there are ${c.maxLecture}), so ${c.lpw} a week ${c.lpwAuto ? 'is assumed' : 'is your setting'}: lectures 1 and 2 are week 1. Change it in Settings` : ''}. Items without a week in their title are under Course info.`
    : c.guessed ? `This course’s Moodle page doesn’t number its weeks, so they follow the order of its sections (the first section is week ${1 + c.offset}). Wrong? Change where the course starts in Settings.` : '';
  // left: the week overview; middle: what to do now; right: reference, every part folded until opened
  const side = `<aside class="card acside" data-section="Overview">
    <b class="acs-name">${escapeHtml(meta.shortname || meta.fullname)}</b><small class="acs-full">${escapeHtml(meta.fullname)}</small>
    <span class="achip ${st.cls}">${escapeHtml(st.text)}</span>
    <div class="acs-prog"><b>${c.items.length ? Math.round((done / c.items.length) * 100) : 0}%</b><span>${done} of ${c.items.length} done · ${acadKind(cid) === 'qual' ? 'reading counts' : 'reading optional'}</span>
      <i class="abar"><i style="width:${c.items.length ? (done / c.items.length) * 100 : 0}%"></i></i></div>
    ${c.weeks.length ? `<ol class="acs-weeks">${c.weeks.map((w) => {
      const n = w.items.length, d = w.items.filter(acadDone).length;
      return `<li><button class="acs-w ${w.state} ${w.week === c.cur ? 'cur' : ''}" data-act="acad-jump" data-week="${w.week}" title="${escapeHtml(w.topic || `Week ${w.week}`)}">
        <b>W${w.week}</b><span class="acs-bar"><i style="width:${n ? (d / n) * 100 : 0}%"></i></span><small>${d}/${n}</small>${w.week === c.cur ? '<em>now</em>' : w.state === 'late' ? '<em class="late">!</em>' : ''}</button></li>`;
    }).join('')}</ol>` : ''}
    <div class="acs-links"><a href="${escapeHtml(`${acad.site || 'https://moodle.lse.ac.uk'}/course/view.php?id=${cid}`)}" target="_blank" rel="noopener">Moodle page ↗</a>
      ${notes ? `<a href="${escapeHtml(notes)}" target="_blank" rel="noopener">Notes ↗</a>` : '<button data-act="acad-course-settings">+ Notes link</button>'}
      <button data-act="acad-plan" data-course="${cid}">＋ Add to my plan</button>
      <button data-act="acad-course-settings">Settings</button></div>
    ${how ? `<details class="ainfo"><summary>ⓘ How the weeks are worked out</summary><p>${escapeHtml(how)}</p></details>` : ''}
  </aside>`;
  const weekCard = (title, list, hint) => `<section class="card" data-section="${title}"><div class="card-head"><h2>${title}</h2>${hint ? `<span class="hint">${hint}</span>` : ''}</div>${list.map((w) => acadWeekHtml(c, w)).join('')}</section>`;
  const main = `<div class="acmain">
    ${g.now.length ? weekCard('This week', g.now, `Week ${c.cur} · ${acadWeekDates(c.cur)}`) : ''}
    ${g.catchUp.length ? weekCard('Catch up', g.catchUp, `${c.catchUp.length} item${c.catchUp.length === 1 ? '' : 's'}, oldest first`) : ''}
    ${!g.now.length && !g.catchUp.length ? `<section class="card empty"><p><b>${c.weeks.length ? 'Nothing to do right now' : 'No weeks found'}</b></p><p class="small muted">${c.weeks.length ? 'You’re up to date. Coming up has the next weeks.' : 'This course doesn’t label anything by week, so everything is under Course info.'}</p></section>` : ''}
  </div>`;
  const tests = c.tests.length ? c.tests.map((i) => acadItemHtml(i)).join('') : '';
  const info = c.info.length ? c.info.map((i) => acadItemHtml(i)).join('') : '';
  const ref = `<div class="acref">
    ${g.coming.length ? acadFold(cid, 'coming', 'Coming up', `${g.coming.length} week${g.coming.length === 1 ? '' : 's'}`, g.coming.map((w) => acadWeekHtml(c, w)).join('')) : ''}
    ${g.done.length ? acadFold(cid, 'done', 'Done', `${g.done.length} week${g.done.length === 1 ? '' : 's'}`, g.done.map((w) => acadWeekHtml(c, w)).join('')) : ''}
    ${tests ? acadFold(cid, 'tests', 'Tests', `${c.tests.filter(acadDone).length} of ${c.tests.length} done`, tests) : ''}
    ${info ? acadFold(cid, 'info', 'Course info', String(c.info.length), info) : ''}
  </div>`;
  return header + `<div class="acourse">${side}${main}${ref}</div>`;
}
// The week groups of a course page.
function acadGroups(c) {
  const wk = c.weeks;
  return { now: wk.filter((w) => w.week === c.cur), catchUp: wk.filter((w) => w.week < c.cur && w.left > 0),
    coming: wk.filter((w) => w.week > c.cur), done: wk.filter((w) => w.week < c.cur && w.left === 0) };
}
// A folded part of the reference column; it stays open or folded as you leave it (this session).
const acadRefOpen = new Map();
const acadFold = (cid, key, title, hint, body) => `<details class="card afold" data-afold="${cid}:${key}" ${acadRefOpen.get(`${cid}:${key}`) ? 'open' : ''}>
  <summary><h2>${title}</h2>${hint ? `<span class="hint">${escapeHtml(hint)}</span>` : ''}</summary><div class="afold-b">${body}</div></details>`;


// ---- actions
async function acadTick(itemId, courseId) {
  const done = acad.progress.has(itemId);
  if (done) acad.progress.delete(itemId); else { acad.progress.set(itemId, new Date().toISOString()); acad.just = itemId; setTimeout(() => { acad.just = null; }, 900); }
  render();
  acadSaveCache();
  try { if (done) await acadDb.untick(itemId); else await acadDb.tick(itemId, courseId); }
  catch (e) { if (done) acad.progress.set(itemId, new Date().toISOString()); else acad.progress.delete(itemId); render(); toast(sbErr(e)); }
}
async function acadConnect(form) {
  const token = String(new FormData(form).get('token') || '').trim();
  form.reset();
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); // so the screen can move on
  acad.error = '';
  try {
    const r = await moodleApi({ action: 'connect', token });
    acad.conn = true; acad.name = r.name; acad.at = 0; acad.failAt = 0; acad.haveRows = false;
    toast(`Connected as ${r.name}`);
    await acadLoad({ force: true });
  } catch (e) { acad.error = e.message; render(); }
}
async function acadDisconnect() {
  if (!confirm('Disconnect Moodle? Your ticks stay saved. The key is removed from the server.')) return;
  try { await moodleApi({ action: 'disconnect' }); } catch (e) { toast(e.message); return; }
  // forget the connection and the course contents, but keep your ticks, notes links and tracked courses
  Object.assign(acad, { conn: false, name: '', courses: null, error: '', expired: false, at: 0, failAt: 0, choosing: false });
  acad.contents.clear(); acad.errors.clear();
  try { localStorage.removeItem('acadCache'); } catch {}
  render();
}
async function acadSetTracked(id, on) {
  if (on) acad.tracked.add(id); else acad.tracked.delete(id);
  try { await acadDb.course({ course_id: id, tracked: on }); } catch (e) { toast(sbErr(e)); return; }
  if (on && !acad.contents.has(id)) await acadLoadContents([id]);
  acadSaveCache();
  render();
}
function cleanNotesUrl(u) {
  u = String(u || '').trim();
  if (!u) return '';
  if (/^onenote:/i.test(u)) return /^onenote:https:\/\//i.test(u) ? u : '';
  return cleanUrl(u);
}
function openCourseSettings() {
  const id = route.courseId, notes = acad.notes.get(id) || '', kind = acadKind(id);
  openSheet(`<div class="sheet-head"><h3>Course settings</h3></div>
    <form class="form flat" data-form="acad-course" data-id="${id}">
      <div class="f">Type of course<div class="pformat two">
        <label><input type="radio" name="kind" value="quant" ${kind === 'quant' ? 'checked' : ''}><span><b>Quantitative</b><small>Lecture and problem sets lead. Reading is optional, so it doesn’t count towards being behind.</small></span></label>
        <label><input type="radio" name="kind" value="qual" ${kind === 'qual' ? 'checked' : ''}><span><b>Qualitative</b><small>Reading counts towards being behind. You can tick a week’s reading all at once, at the start of the week.</small></span></label></div></div>
      <label class="f">The course’s first week is term week<input name="startWeek" type="number" inputmode="numeric" min="1" max="31" step="1" value="${(acad.offsets.get(id) || 0) + 1}">
        <span class="help">Most start in week 1. If this course starts later, or you want its sections to line up with the term, change it. Week numbers shift to match.</span></label>
      ${(() => { const c = acadCourse(id); return c && c.byItem ? `<label class="f">Lectures per week<select name="lpw"><option value="0" ${!acad.lpw.get(id) ? 'selected' : ''}>Work it out${c.lpwAuto ? ` (${c.lpw})` : ''}</option>${[1, 2, 3, 4].map((n) => `<option value="${n}" ${acad.lpw.get(id) === n ? 'selected' : ''}>${n} a week</option>`).join('')}</select>
        <span class="help">Lectures are numbered across the term (Lecture 1 to ${c.maxLecture || 'N'}), so this decides which week each belongs to: with 2 a week, lectures 3 and 4 are week 2.</span></label>` : ''; })()}
      <label class="f">Notes link<input name="notes" inputmode="url" autocapitalize="off" autocorrect="off" value="${escapeHtml(notes)}" placeholder="Link to your OneNote section"></label>
      <p class="help">In OneNote, right-click this course’s section → <b>Copy Link to Section</b>, and paste it here. Every item then has a <b>Notes</b> button that opens it. Using paper for this course? Leave it empty.</p>
      <button class="btn primary" type="submit">Save</button>
      <button type="button" class="btn" data-act="acad-copy-list">Copy how items were sorted</button>
      <p class="help">If items land in the wrong row, copy this list and send it to Claude so the sorting can be improved. Moving one item in a week also moves its look-alikes in other weeks.</p>
      <button type="button" class="btn warn" data-act="acad-untrack">Stop tracking this course</button>
    </form>`, { acad: id });
}
async function acadSaveCourse(form) {
  const f = new FormData(form), id = +form.dataset.id, raw = String(f.get('notes') || '').trim(), url = cleanNotesUrl(raw), kind = f.get('kind') === 'qual' ? 'qual' : 'quant';
  if (raw && !url) { toast('Paste the full link (https://… or onenote:https://…)'); return; }
  if (url.length > 2000) { toast('That link is too long to save'); return; }
  const offset = Math.min(30, Math.max(0, Math.round(num(f.get('startWeek'), 1)) - 1));
  const lpw = f.has('lpw') ? Math.min(4, Math.max(0, +f.get('lpw') || 0)) : (acad.lpw.get(id) || 0);
  try { await acadDb.course({ course_id: id, notes_url: url, tracked: acad.tracked.has(id), kind, week_offset: offset, lectures_per_week: lpw }); } catch (e) { toast(/schema cache|kind|week_offset|lectures_per_week/i.test(e.message || '') ? 'Run the Academics setup in Supabase once more to save these.' : sbErr(e)); return; }
  acad.notes.set(id, url); acad.kinds.set(id, kind); acad.offsets.set(id, offset); acad.lpw.set(id, lpw);
  closeSheet(); render();
}
// Tick (or untick) a whole lane of a week at once, e.g. all of a week's reading at the start.
async function acadLaneAll(cid, week, lane) {
  const c = acadCourse(cid), w = c && c.weeks.find((x) => x.week === week);
  const its = w ? w.lanes[lane] : [];
  if (!its.length) return;
  const allDone = its.every(acadDone);
  const ids = allDone ? its.filter((i) => acad.progress.has(i.id)).map((i) => i.id) : its.filter((i) => !acadDone(i)).map((i) => i.id);
  const before = new Map(acad.progress);
  for (const id of ids) { if (allDone) acad.progress.delete(id); else acad.progress.set(id, new Date().toISOString()); }
  if (!allDone) { acad.just = ids[0]; setTimeout(() => { acad.just = null; }, 900); }
  render();
  try { if (allDone) await acadDb.untickMany(ids); else await acadDb.tickMany(ids, cid); }
  catch (e) { acad.progress = before; render(); toast(sbErr(e)); }
}
// Everything else you can do with a course item.
function openItemMore(cid, itemId, inWeek) {
  const data = acad.contents.get(cid), item = data && data.sections.flatMap((x) => x.items).find((x) => x.id === itemId);
  if (!item) return;
  const notes = acad.notes.get(cid), files = (item.files || []).slice(1, 6);
  const ids = `data-id="${itemId}" data-course="${cid}"`;
  openSheet(`<div class="sheet-head"><h3>${escapeHtml(clip(item.name, 60))}</h3></div>
    <div class="menu"><button class="btn" data-act="acad-plan" ${ids}>Add to my plan as a task or routine</button>
      ${notes ? `<a class="btn" href="${escapeHtml(notes)}" target="_blank" rel="noopener">My notes for this course</a>` : ''}
      ${files.map((x) => `<a class="btn" href="${escapeHtml(x.link)}" target="_blank" rel="noopener">Open ${escapeHtml(clip(x.name, 40))}</a>`).join('')}
      ${inWeek ? `<button class="btn" data-act="acad-move" ${ids}>Move to another category</button>` : ''}
      <button class="btn" data-act="close">Close</button></div>`);
}
// Moving an item to a different lane (kept for the course).
function openLaneSheet(cid, itemId) {
  const data = acad.contents.get(cid), item = data && data.sections.flatMap((s) => s.items).find((i) => i.id === itemId);
  if (!item) return;
  const cur = laneOf({ ...item, courseId: cid }), set = (acad.lanes.get(cid) || {})[itemId];
  openSheet(`<div class="sheet-head"><h3>Move “${escapeHtml(clip(item.name, 40))}”</h3></div>
    <div class="menu">${LANES.map(([k, n]) => `<button class="btn ${cur === k ? 'primary' : ''}" data-act="acad-lane" data-lane="${k}">${n}${cur === k ? ' ✓' : ''}</button>`).join('')}
      ${set ? '<button class="btn" data-act="acad-lane" data-lane="">Back to automatic</button>' : ''}</div>`, { lane: { cid, itemId } });
}
// "＋ Plan": turn a Moodle item (or just the course) into a one-off task or a repeating routine, with its link attached.
function acadPlanDefaults(cid, itemId) {
  const meta = (acad.courses || []).find((c) => c.id === cid), data = acad.contents.get(cid);
  if (!meta) return null;
  const item = itemId != null && data ? data.sections.flatMap((s) => s.items).find((i) => i.id === itemId) : null;
  const code = meta.shortname || meta.fullname, name = item ? (item.name.toLowerCase().startsWith(code.toLowerCase()) ? item.name : `${code} ${item.name}`) : `${code} `;
  return { meta, item, name, link: (item && item.link) || `${acad.site || 'https://moodle.lse.ac.uk'}/course/view.php?id=${cid}` };
}
// The logo button: drop the item straight onto this week's whiteboard (an undated one-off task you can drag onto a day).
function acadToWhiteboard(cid, itemId) {
  const d = acadPlanDefaults(cid, itemId);
  if (!d || !d.item) return;
  if (state.commitments.some((c) => c.freq === 'once' && !c.date && !c.archived && c.name === d.name)) { toast(`“${d.name}” is already on the whiteboard`); return; }
  const url = cleanUrl(d.link);
  state.commitments.push(newCommitment({ name: d.name.slice(0, 80), section: 'Academics', freq: 'once', kind: 'task', hours: 1, date: null, notes: d.meta.fullname, links: url ? [{ label: 'Moodle', url }] : [], order: nextOrder() }));
  save(); render();
  toast(`Added “${d.name}” to this week’s whiteboard`);
}
function openAcadPlan(cid, itemId) {
  const d = acadPlanDefaults(cid, itemId);
  if (!d) return;
  const { meta, item, name, link } = d;
  openSheet(`<div class="sheet-head"><h3>Add to my plan</h3><p class="muted small">${escapeHtml(meta.fullname)}</p></div>
    <form class="form flat" data-form="acad-plan" data-course="${cid}" data-item="${item ? item.id : ''}">
      <label class="f">What<input name="name" value="${escapeHtml(name)}" maxlength="80" required></label>
      <label class="f">How often
        <select name="repeat"><option value="once">One-off</option><option value="weekly">Routine: every week</option><option value="biweekly">Routine: every 2 weeks</option><option value="daily">Routine: every day</option></select></label>
      <label class="f">Date<input type="date" name="date" value="${todayISO()}" required>
        <span class="help">One-off: the day to do it. Weekly routine: the first day, and it comes back on the same weekday (pick a Sunday for “every Sunday”).</span></label>
      <label class="f">Link<input name="url" type="url" value="${escapeHtml(link)}" placeholder="https://…"><span class="help">Opens from the task. It is the item’s Moodle page; change it if you like.</span></label>
      <button class="btn primary" type="submit">Add</button>
      <button type="button" class="btn" data-act="close">Cancel</button>
    </form>`);
}
function saveAcadPlan(form) {
  const f = new FormData(form), meta = (acad.courses || []).find((c) => c.id === +form.dataset.course);
  const name = String(f.get('name') || '').trim().slice(0, 80), date = String(f.get('date') || todayISO()), repeat = String(f.get('repeat'));
  if (!name) { toast('Give it a name'); return; }
  const url = cleanUrl(String(f.get('url') || '').trim());
  const freq = repeat === 'daily' ? 'daily' : repeat === 'once' ? 'once' : 'periodic';
  state.commitments.push(newCommitment({
    name, section: 'Academics', freq, kind: 'task', hours: 1, date: freq === 'daily' ? null : date, everyDays: repeat === 'biweekly' ? 14 : 7,
    notes: meta ? meta.fullname : '', links: url ? [{ label: 'Moodle', url }] : [], order: nextOrder(),
  }));
  save(); closeSheet(); render();
  toast(freq === 'once' ? `Added “${name}” for ${fmtDayShort(date)}` : `Added the routine “${name}”`);
}
async function acadSetLane(lane) {
  const { cid, itemId } = (sheetCtx && sheetCtx.lane) || {};
  if (!cid) return;
  const data = acad.contents.get(cid), all = data ? data.sections.flatMap((s) => s.items) : [];
  const item = all.find((i) => i.id === itemId), pat = item ? itemPattern(item.name) : '';
  // the same kind of item in other weeks ("Problem set 3" → "Problem set 4") follows, unless you set it yourself
  const map = { ...(acad.lanes.get(cid) || {}) };
  const same = pat.length >= 4 ? all.filter((i) => i.id !== itemId && itemPattern(i.name) === pat && !map[i.id]) : [];
  if (lane) { map[itemId] = lane; for (const i of same) map[i.id] = lane; }
  else { delete map[itemId]; for (const i of all.filter((x) => x.id !== itemId && itemPattern(x.name) === pat && pat.length >= 4)) delete map[i.id]; }
  const before = acad.lanes.get(cid);
  acad.lanes.set(cid, map);
  closeSheet(); render();
  if (same.length) toast(`${same.length} similar item${same.length === 1 ? '' : 's'} moved too`);
  try { await acadDb.course({ course_id: cid, tracked: acad.tracked.has(cid), lanes: map }); }
  catch (e) { acad.lanes.set(cid, before || {}); render(); toast(/schema cache|lanes/i.test(e.message || '') ? 'Run the Academics setup in Supabase once more to remember this.' : sbErr(e)); }
}
// A plain-text list of how every item of the course was sorted, to paste to Claude when the sorting is off.
function acadCopyList() {
  const c = acadCourse(route.courseId);
  if (!c) return;
  const lines = c.items.map((i) => `${i.week != null ? `W${i.week}` : '--'} | ${i.lane} | ${i.name} | ${i.type}${i.files.length ? ` | files: ${i.files.map((f) => f.name).join(', ')}` : ''} | section: ${i.section}`);
  copyText(`${c.meta.shortname || c.meta.fullname} (${c.items.length} items; week | sorted as | title | type | files | section)\n${lines.join('\n')}`);
}
function acadJump(week) {
  const c = acadCourse(route.courseId);
  const w = c && c.weeks.find((x) => x.week === week);
  if (!w) return;
  acadOpenWeeks.set(acadWeekKey(c, w), true);
  const g = acadGroups(c), cid = c.meta.id;
  if (g.coming.includes(w)) acadRefOpen.set(`${cid}:coming`, true);
  if (g.done.includes(w)) acadRefOpen.set(`${cid}:done`, true);
  render();
  const el = $app.querySelector(`[data-asec="${CSS.escape(acadWeekKey(c, w))}"]`);
  if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
}
// Weeks you open or fold on a course page stay that way when the page redraws.
document.addEventListener('toggle', (e) => {
  const d = e.target;
  if (d.dataset && d.dataset.wsc) { if (d.open) planStudyOpen.add(+d.dataset.wsc); else planStudyOpen.delete(+d.dataset.wsc); }
  if (d.dataset && d.dataset.asec) acadOpenWeeks.set(d.dataset.asec, d.open);
  if (d.dataset && d.dataset.afold) { acadRefOpen.set(d.dataset.afold, d.open); }
}, true);

// ---------- This week: the simplified dashboard ----------
// Monday to Sunday top to bottom, each day a plain bullet list (daily routines, periodic ones on the days
// they're due, one-off tasks, pinned notes, and optional extra lines), with a whiteboard of undated tasks
// on the right. Drag a whiteboard task onto a day to give it that date (or tap it, then tap a day); drag a
// one-off back to the whiteboard to undate it. Ticking here is the same tick as on Today and the Calendar.
let planWk = null;          // the week shown (null = this week)
let planJump = true;        // scroll to today the next time This week is drawn
let wbPick = null;          // a whiteboard item picked up by tapping ("task:id" / "note:id"), waiting for a day
let planExtras = { projects: true, apps: true, study: true };
try { planExtras = { ...planExtras, ...JSON.parse(localStorage.getItem('planExtras') || '{}') }; } catch {}
const PLAN_EXTRAS = [['projects', 'Projects'], ['apps', 'Applications'], ['study', 'Study']];

function planDayHtml(wk, w, i) {
  const d = isoDate(dayDate(wk, i)), today = todayISO();
  const rows = [];
  let done = 0, total = 0;
  const routine = !w ? [] : [...itemsOf(w, 'daily'), ...itemsOf(w, 'periodic').filter(([id, it]) => periodicOn(id, it, d))];
  for (const [id, it] of routine) {
    const ok = dayDone(it, i);
    total++; if (ok) done++;
    const prog = it.kind === 'counter' ? `${round2(it.counts[i])}/${round2(it.target)}${it.unit ? ` ${it.unit}` : ''}` : it.freq === 'periodic' ? `every ${everyLabel(it.everyDays || 7)}` : '';
    rows.push(`<li><button class="wb ${ok ? 'done' : ''}" data-cell="${wk}:${id}:${i}" aria-label="${escapeHtml(cellLabel(it, i))}">
      <span class="wbox">${ok ? CHECK : ''}</span><span class="wname">${escapeHtml(it.name)}</span>${prog || focusMinOf(it, i) ? `<small>${escapeHtml([prog, focusMinOf(it, i) ? fmtMin(focusMinOf(it, i)) : ''].filter(Boolean).join(' · '))}</small>` : ''}</button>${focusBtn(id, wk, i, it)}</li>`);
  }
  const ones = w ? itemsOf(w, 'once').filter(([, it]) => it.date === d && !it.schedule) : [];
  if (ones.length) rows.push('<li class="wsep" aria-hidden="true"></li>');
  for (const [id, it] of ones) {
    const ok = periodDone(it);
    total++; if (ok) done++;
    rows.push(`<li class="wb once ${ok ? 'done' : ''}" data-wdrag="task:${id}">
      <button class="wbox" data-act="pdone" data-wk="${wk}" data-id="${id}" aria-label="${escapeHtml(it.name)} done" aria-pressed="${ok}">${ok ? CHECK : ''}</button>
      <a class="wname" href="#/c/${id}" draggable="false">${it.time ? `<small class="wtime">${escapeHtml(it.time)}</small> ` : ''}${escapeHtml(it.name)}</a>${focusMinOf(it, i) ? `<small>${fmtMin(focusMinOf(it, i))}</small>` : ''}${focusBtn(id, wk, i, it)}</li>`);
  }
  for (const n of notesOn(d)) {
    total++; if (n.done) done++;
    rows.push(`<li class="wb note c-${n.color} ${n.done ? 'done' : ''}">
      <button class="wbox" data-act="note-done" data-id="${n.id}" aria-label="Done" aria-pressed="${n.done}">${n.done ? CHECK : ''}</button>
      <span class="wname">${escapeHtml(n.text.split('\n')[0] || 'Note')}</span></li>`);
  }
  const extra = [];
  if (planExtras.projects) for (const x of projectItemsOn(d)) extra.push(`<li class="wx"><span class="wdot" style="--c:${pcol(x.p)[2]}"></span><a href="#/gallery/${x.p.id}">${x.time ? `<small class="wtime">${x.time}</small> ` : ''}${escapeHtml(x.title)}<small> · ${escapeHtml(x.p.name)}</small></a></li>`);
  if (planExtras.apps) for (const e of appEvents().filter((e) => e.date === d)) extra.push(`<li class="wx"><span class="wdot" style="--c:#e6b800"></span><a href="#/apps/${d}">${escapeHtml(e.a.company)} ${APP_CHIP_LABEL[e.kind]}</a></li>`);
  return `<section class="wday ${d === today ? 'today' : d < today ? 'past' : ''} ${wbPick ? 'placing' : ''}" data-wday="${d}">
    <button class="wday-h" data-act="wday-place" data-day="${d}" ${wbPick ? '' : 'tabindex="-1"'}>
      <b>${DAY_NAMES[i]}</b><span>${fmtDay(parseISO(d), { day: 'numeric', month: 'short' })}</span>${d === today ? '<em>today</em>' : ''}
      ${total ? `<small>${done}/${total}</small>` : ''}${wbPick ? '<i>Place here</i>' : ''}</button>
    <ul class="wlist">${rows.join('')}${extra.join('')}${!rows.length && !extra.length ? '<li class="wempty">Nothing planned</li>' : ''}</ul>
  </section>`;
}
// Study on the weekly list: for each course you track, this week's lectures and problem sets (and reading,
// where it counts), tickable, each with Open. Moodle gives a week, not a day, so they sit with the week.
const planStudyOpen = new Set(); // courses opened on This week
function planStudyHtml(wk) {
  if (!planExtras.study || acad.conn !== true || !acad.courses || wk !== currentWeekKey()) return ''; // drawn from the remembered copy; the sign-in can finish later
  acadEnsure();
  const cs = acad.courses.filter((m) => acad.tracked.has(m.id)).map((m) => acadCourse(m.id)).filter(Boolean).sort((a, b) => b.behind - a.behind || a.meta.id - b.meta.id);
  if (!cs.length) return '';
  const blocks = cs.map((c) => {
    const w = c.weeks.find((x) => x.week === c.cur), items = w ? w.items.filter(countsFor) : [], st = acadStatus(c);
    const rows = items.map((i) => {
      const ok = acadDone(i), f = (i.files || [])[0];
      return `<li class="wb ${ok ? 'done' : ''}"><button class="wbox" data-act="acad-tick" data-id="${i.id}" data-course="${c.meta.id}" aria-pressed="${ok}" aria-label="${escapeHtml(i.name)} ${ok ? 'done' : 'not done'}" ${i.moodleDone && !acad.progress.has(i.id) ? 'disabled' : ''}>${ok ? CHECK : ''}</button>
        <a class="wname" href="#/academics/${c.meta.id}">${escapeHtml(i.name)}</a><small>${escapeHtml(LANE_SHORT[i.lane])}</small>${f ? `<a class="mini-btn go" href="${escapeHtml(f.link)}" target="_blank" rel="noopener">Open</a>` : ''}</li>`;
    }).join('');
    const left = items.filter((i) => !acadDone(i)).length;
    return `<details class="wstudy-c" data-wsc="${c.meta.id}" ${planStudyOpen.has(c.meta.id) ? 'open' : ''}><summary class="wstudy-h"><b>${escapeHtml(c.meta.shortname || c.meta.fullname)}</b>
      <span class="achip ${st.cls}">${escapeHtml(st.text.split(' · ')[0])}</span><small>${left ? `${left} this week` : items.length ? 'week done' : ''}</small></summary>
      <ul class="wlist">${rows || `<li class="wempty">${c.weeks.length ? 'Nothing posted for this week yet' : 'No weeks found in Moodle'}</li>`}</ul>
      <a class="wcatch" href="#/academics/${c.meta.id}">${c.catchUp.length ? `${c.catchUp.length} to catch up from earlier weeks` : 'Open the course'} ›</a></details>`;
  }).join('');
  return `<section class="wstudy" data-section="Study"><div class="wstudy-t"><b>Study this week</b><a href="#/academics">Academics ›</a></div>${blocks}</section>`;
}
function planWeeklyHtml(wk, w) {
  const weekly = w ? itemsOf(w, 'weekly') : [];
  if (!weekly.length) return '';
  return `<div class="wweekly"><b>Weekly</b>${weekly.map(([id, it]) => {
    const ok = periodDone(it);
    if (it.kind === 'task') return `<span class="wwk ${ok ? 'done' : ''}"><button class="wbox" data-act="pdone" data-wk="${wk}" data-id="${id}" aria-pressed="${ok}" aria-label="${escapeHtml(it.name)} done">${ok ? CHECK : ''}</button><a href="#/c/${id}">${escapeHtml(it.name)}</a></span>`;
    const step = (dir, sign, word) => `<button class="wstep" data-act="pstep" data-wk="${wk}" data-id="${id}" data-dir="${dir}" aria-label="${word} ${it.step} ${escapeHtml(it.name)}" ${dir < 0 && it.count <= 0 ? 'disabled' : ''}>${sign}</button>`;
    return `<span class="wwk counter ${ok ? 'done' : ''}">${step(-1, '−', 'Minus')}<a href="#/c/${id}">${escapeHtml(it.name)} <small>${escapeHtml(`${round2(it.count)}/${round2(it.target)}${it.unit ? ` ${it.unit}` : ''}`)}</small></a>${step(1, '+', 'Plus')}</span>`;
  }).join('')}</div>`;
}
function whiteboardColHtml() {
  const tasks = state.commitments.filter((c) => c.freq === 'once' && !c.date && !c.archived);
  const notes = state.notes.filter((n) => !n.date && !n.done && n.text.trim());
  const sticky = (key, text, color, sub) => `<div class="wsticky c-${color} ${wbPick === key ? 'picked' : ''}" data-wdrag="${key}" tabindex="0" role="button" aria-label="${escapeHtml(text)}: tap, then tap a day">
    <span>${escapeHtml(text)}</span>${sub ? `<small>${escapeHtml(sub)}</small>` : ''}
    <button class="wsticky-x" data-act="wb-remove" data-key="${key}" aria-label="Remove">×</button></div>`;
  return `<aside class="card wbcol" data-section="Whiteboard" data-wb>
    <div class="card-head"><h2>Whiteboard</h2><span class="hint">${tasks.length + notes.length || ''}</span></div>
    <form class="wb-add" data-form="wb-add" autocomplete="off"><input name="text" maxlength="120" placeholder="Type a task, press Enter" aria-label="New task"></form>
    <div class="wb-list">${tasks.map((c) => sticky(`task:${c.id}`, c.name, 'gold', c.section !== 'Tasks' ? c.section : '')).join('')}
      ${notes.map((n) => sticky(`note:${n.id}`, n.text.split('\n')[0], n.color, 'note')).join('')}
      ${!tasks.length && !notes.length ? '<p class="wempty">Type a task, then place it on a day.</p>' : ''}</div>
    ${wbPick ? '<p class="help"><b>Now tap a day</b> to place it, or tap it again to cancel.</p>' : tasks.length + notes.length ? '<p class="help">Tap one, then tap a day. Or drag it there.</p>' : ''}
  </aside>`;
}
function planHtml() {
  const wk = planWk || currentWeekKey(), w = getWeek(wk);
  const cur = wk === currentWeekKey();
  const ws = w ? weekStats(w) : null, focused = weekFocusMin(w);
  return `
    <header class="top">${topBar({ left: '<button class="icon-btn" data-act="plan-week" data-d="-1" aria-label="Previous week">‹</button>',
      label: cur ? 'This week' : weekLabel(wk), title: weekRange(wk), titleAct: cur ? '' : 'data-act="plan-week" data-d="0"',
      right: '<button class="icon-btn" data-act="plan-week" data-d="1" aria-label="Next week">›</button>' + menuBtn })}
      ${ws && ws.total ? `<div class="pace"><a href="#/routine">${fmtH(ws.actual)} of ${fmtH(ws.planned)} · ${Math.round(ws.pct * 100)}% ticked${focused ? ` · ${fmtMin(focused)} focused` : ''} ›</a></div>` : ''}
      ${cur ? buddyTodayLine() : ''}
      <div class="plan-links"><a href="#/cal">Calendar</a>
        <span class="plan-show">Show:${PLAN_EXTRAS.map(([k, l]) => `<button class="mini-btn ${planExtras[k] ? 'on' : ''}" data-act="plan-extra" data-k="${k}" aria-pressed="${!!planExtras[k]}">${l}</button>`).join('')}</span></div>
    </header>
    ${reviewBannerHtml()}
    ${signInHintHtml()}
    <div class="plan">
      <div class="plan-days" data-section="Week">${puzzleLineHtml()}${planWeeklyHtml(wk, w)}${planStudyHtml(wk)}${DAY_NAMES.map((_, i) => planDayHtml(wk, w, i)).join('')}</div>
      <div class="plan-side">${whiteboardColHtml()}</div>
    </div>`;
}

// Dates for one-off tasks: give one a day, or take its day away (back to the whiteboard).
function setTaskDate(id, date) {
  const c = state.commitments.find((x) => x.id === id && x.freq === 'once');
  if (!c || c.date === date) return;
  const old = c.date;
  if (old && !date) {
    const w = state.weeks[weekOf(old)], it = w && w.items[id];
    if (it && hasData(it)) { toast('It’s already ticked off, so it stays on its day'); render(); return; }
    if (w) delete w.items[id];
  } else if (old && date) moveOnceItem(id, old, date);
  c.date = date; c.tbc = !date;
  save(); render();
  toast(date ? `On ${fmtShort(date)}` : 'Back on the whiteboard, no date');
}
function placeOnDay(key, date) {
  wbPick = null;
  const [kind, id] = String(key).split(':');
  if (kind === 'task') { setTaskDate(id, date); return; }
  const n = state.notes.find((x) => x.id === id);
  if (!n) return;
  n.date = date; // a sticky placed on a day becomes a task on that day
  noteToTask(id);
}
function wbAdd(form) {
  const text = String(new FormData(form).get('text') || '').trim();
  if (!text) return;
  state.commitments.push(normaliseCommitment(newCommitment({ name: text.slice(0, 120), section: 'Tasks', freq: 'once', kind: 'task', date: null, hours: 0.5, timeUnit: 'min', order: nextOrder() })));
  renumber(); save(); render();
  const box = $app.querySelector('form[data-form="wb-add"] input');
  if (box) box.focus();
}
function wbRemove(key) {
  const [kind, id] = String(key).split(':');
  if (kind === 'task') {
    const c = state.commitments.find((x) => x.id === id);
    if (!c || !confirm(`Delete “${c.name}”?`)) return;
    removeCommitment(id); renumber();
  } else {
    if (!confirm('Delete this note?')) return;
    state.notes = state.notes.filter((x) => x.id !== id);
  }
  if (wbPick === key) wbPick = null;
  save(); render();
}

// Dragging on the dashboard: a whiteboard task or a one-off floats with the pointer onto a day (or back to
// the whiteboard). A tap without dragging picks a whiteboard item up, for placing with a second tap.
let wDrag = null, wNoClick = 0;
// the browser's own "drag this link" would cancel ours
document.addEventListener('dragstart', (e) => { if (e.target.closest && e.target.closest('[data-wdrag]')) e.preventDefault(); });
document.addEventListener('click', (e) => { if (Date.now() - wNoClick < 400 && e.target.closest && e.target.closest('[data-wdrag]')) { e.preventDefault(); e.stopPropagation(); } }, true);
document.addEventListener('pointerdown', (e) => {
  if (e.button > 0 || route.tab !== 'plan') return;
  const el = e.target.closest('[data-wdrag]');
  if (!el || e.target.closest('button, input')) return; // the task's name (a link) is a handle too: a plain click still opens it
  wDrag = { el, key: el.dataset.wdrag, sx: e.clientX, sy: e.clientY, moved: false };
  el.setPointerCapture(e.pointerId);
  if (!e.target.closest('a')) e.preventDefault();
});
const wDropAt = (x, y) => document.elementsFromPoint(x, y).map((el) => el.closest && el.closest('[data-wday], [data-wb]')).find(Boolean) || null;
document.addEventListener('pointermove', (e) => {
  const d = wDrag;
  if (!d) return;
  if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 6) return;
  d.moved = true;
  if (!d.ghost) {
    d.ghost = Object.assign(document.createElement('div'), { className: 'pcard-ghost c-amber', textContent: (d.el.querySelector('.wname, span') || d.el).textContent.trim() });
    document.body.appendChild(d.ghost);
    d.el.classList.add('lifted');
    d.scroll = setInterval(() => { if (d.y < 70) window.scrollBy(0, -14); else if (d.y > innerHeight - 70) window.scrollBy(0, 14); }, 16);
  }
  d.x = e.clientX; d.y = e.clientY;
  d.ghost.style.transform = `translate(${e.clientX - 60}px, ${e.clientY - 20}px)`;
  const t = wDropAt(e.clientX, e.clientY);
  if (t !== d.target) { if (d.target) d.target.classList.remove('drop-on'); d.target = t; if (t) t.classList.add('drop-on'); }
});
function endWDrag(d) { clearInterval(d.scroll); if (d.ghost) d.ghost.remove(); if (d.target) d.target.classList.remove('drop-on'); d.el.classList.remove('lifted'); }
document.addEventListener('pointerup', (e) => {
  const d = wDrag;
  wDrag = null;
  if (!d) return;
  endWDrag(d);
  if (d.moved) { wNoClick = Date.now(); } // the click that ends a drag mustn't open the task
  if (!d.moved) { // a tap: pick a whiteboard item up (or put it down again)
    if (d.el.closest('[data-wb]')) { wbPick = wbPick === d.key ? null : d.key; render(); }
    return;
  }
  const t = wDropAt(e.clientX, e.clientY);
  if (t && t.dataset.wday) placeOnDay(d.key, t.dataset.wday);
  else if (t && t.hasAttribute('data-wb') && d.key.startsWith('task:')) setTaskDate(d.key.slice(5), null);
  else render();
});
document.addEventListener('pointercancel', () => { if (wDrag) { endWDrag(wDrag); wDrag = null; } });

// ---------- Home: the donut ----------
// The whole of I Commit! as one ring. The centre is the week (the dashboard above); around it, a slice
// for each area, filled as far as this week's progress there. Click one to go in. Inside the app the
// ring stays as a small floating donut that opens when you point at it (or tap it on a phone).
const HOME_AREAS = [
  { key: 'routine', name: 'Routine', href: '#/routine', tabs: ['routine', 'commitments'], color: 'green' },
  { key: 'academics', name: 'Academics', href: '#/academics', tabs: ['academics'], color: 'blue' },
  { key: 'apps', name: 'Career', href: '#/apps', tabs: ['apps'], color: 'amber' },
  { key: 'gallery', name: 'Projects', href: '#/gallery', tabs: ['gallery'], color: 'purple' },
  { key: 'buddy', name: 'Our Tree', href: '#/buddy', tabs: ['buddy'], color: 'coral' },
];
const CENTRE_TABS = ['plan', 'cal'];
// What each slice says, and how full it is (null = no fill, just the slice).
function areaStatus(key) {
  const wk = currentWeekKey(), w = getWeek(wk), end = addDaysISO(wk, 6), today = todayISO();
  try {
    if (key === 'routine') {
      const s = weekStats(w, { routine: true });
      return s.total ? { pct: s.pct, text: `${Math.round(s.pct * 100)}% of this week’s routines` } : { pct: null, text: 'No routines yet' };
    }
    if (key === 'academics') {
      if (acad.conn !== true) return { pct: null, text: 'Connect Moodle' };
      const cs = (acad.courses || []).filter((m) => acad.tracked.has(m.id)).map((m) => acadCourse(m.id)).filter(Boolean);
      if (!cs.length) return { pct: null, text: 'No courses tracked' };
      const done = cs.reduce((n, c) => n + c.doneSoFar, 0), all = cs.reduce((n, c) => n + c.totalSoFar, 0);
      const worst = [...cs].sort((a, b) => b.behind - a.behind)[0];
      return { pct: all ? done / all : null, text: worst.behind ? `${worst.meta.shortname || worst.meta.fullname} · ${worst.behind} week${worst.behind === 1 ? '' : 's'} behind` : 'On track in every course' };
    }
    if (key === 'apps') {
      const ev = appEvents().filter((e) => e.kind !== 'open' && e.date >= today && e.date <= end);
      return { pct: null, text: ev.length ? `${ev.length} deadline${ev.length === 1 ? '' : 's'} this week` : 'No deadlines this week' };
    }
    if (key === 'gallery') {
      if (!projects) return { pct: null, text: sbUser ? 'Projects' : 'Sign in to see projects' };
      const live = projects.filter((p) => noTime(p) || (projSpan(p)[0] <= today && today <= projSpan(p)[1]));
      const next = projects.flatMap((p) => (noTime(p) ? [] : p.meetings.map((m) => ({ p, m, d: meetingDate(p, m) })))).filter((x) => x.d >= today).sort((a, b) => a.d.localeCompare(b.d))[0];
      const steps = live.flatMap((p) => p.steps), done = steps.filter((s) => s.done).length;
      return { pct: steps.length ? done / steps.length : null, text: next ? `Next: ${next.m.title} · ${fmtShort(next.d)}` : `${live.length} active project${live.length === 1 ? '' : 's'}` };
    }
    if (key === 'buddy') {
      if (!buddyView) return { pct: null, text: 'Plant a seed' };
      const others = buddyView.members.filter((m) => !m.me), { cur } = treeHistory(buddyView);
      return { pct: cur.good / TREE_DAYS, text: `Day ${cur.good} of ${TREE_DAYS}${cur.state === 'wilted' ? ' · wilting' : others.length ? ` · ${others.map((m) => m.name).join(', ')} ${others.every((m) => m.days[today]) ? 'done ✓' : 'not yet'}` : ''}` };
    }
  } catch { /* data still loading */ }
  return { pct: null, text: '' };
}
function weekCentre() {
  const wk = currentWeekKey(), w = getWeek(wk), s = weekStats(w), ds = dayStats(w, todayIndex(wk));
  return { pct: s.pct, left: Math.max(0, ds.total - ds.done) };
}
function donutSvg({ labels = true, current = null, big = false } = {}) {
  const n = HOME_AREAS.length, R = 104, r = 50, gap = 1.8;
  const pt = (a, rad) => [(Math.sin((a * Math.PI) / 180) * rad).toFixed(2), (-Math.cos((a * Math.PI) / 180) * rad).toFixed(2)];
  const sector = (a0, a1, R1, r1) => {
    const large = a1 - a0 > 180 ? 1 : 0, [x0, y0] = pt(a0, R1), [x1, y1] = pt(a1, R1), [x2, y2] = pt(a1, r1), [x3, y3] = pt(a0, r1);
    return `M${x0} ${y0}A${R1} ${R1} 0 ${large} 1 ${x1} ${y1}L${x2} ${y2}A${r1} ${r1} 0 ${large} 0 ${x3} ${y3}Z`;
  };
  const slices = HOME_AREAS.map((a, i) => {
    const a0 = (i * 360) / n + gap / 2, a1 = ((i + 1) * 360) / n - gap / 2, mid = (a0 + a1) / 2;
    const st = areaStatus(a.key), [ink, fill, mid2, soft] = PROJ_COLORS[a.color];
    const prog = st.pct != null && st.pct > 0 ? `<path class="dprog" d="${sector(a0, a0 + (a1 - a0) * Math.min(1, st.pct), R, r)}" fill="${mid2}"/>` : '';
    const [tx, ty] = pt(mid, (R + r) / 2);
    const on = current === a.key;
    return `<a href="${a.href}" class="dslice ${on ? 'on' : ''}" aria-label="${escapeHtml(`${a.name}: ${st.text}`)}">
      <path class="dbase" d="${sector(a0, a1, R, r)}" fill="${soft}"/>${prog}
      ${on ? `<path class="dring" d="${sector(a0, a1, R + 6, R + 2)}" fill="${mid2}"/>` : ''}
      ${labels ? `<text x="${tx}" y="${ty}" class="dlabel ${st.pct != null && st.pct > 0.55 ? 'light' : ''}" fill="${ink}">${a.name.includes(' ')
        ? a.name.split(' ').map((w2, k) => `<tspan x="${tx}" dy="${k ? '1.15em' : '-0.55em'}">${escapeHtml(w2)}</tspan>`).join('') : escapeHtml(a.name)}</text>` : ''}</a>`;
  }).join('');
  const c = weekCentre(), onC = current === 'centre';
  return `<svg class="donut ${big ? 'big' : ''}" viewBox="-112 -112 224 224" role="img" aria-label="I Commit! areas">
    ${slices}
    <a href="#/plan" class="dcentre ${onC ? 'on' : ''}" aria-label="This week">
      <circle r="${r - 4}"/>
      <text y="-13" class="dc-l">This week</text><text y="6" class="dc-b">${Math.round(c.pct * 100)}%</text>
      <text y="23" class="dc-s">${c.left ? `${c.left} left today` : 'all done today'}</text></a>
  </svg>`;
}
function puzzleAreaHtml() {
  const cur = puzEnsure(), st = puzStatus(), [ink, , mid, soft] = PROJ_COLORS.teal;
  return `<a class="harea" href="#/puzzle" style="--hc:${mid};--hs:${soft};--hk:${ink}"><span class="hdot"></span><b>Jigsaw</b>
    <span>${st.tray ? `${st.tray} piece${st.tray === 1 ? '' : 's'} to place` : `${cur.placed.length} of ${PUZ_A} placed`}</span></a>`;
}
function homeHtml() {
  const areas = HOME_AREAS.map((a) => {
    const st = areaStatus(a.key), [ink, fill, mid, soft] = PROJ_COLORS[a.color];
    return `<a class="harea" href="${a.href}" style="--hc:${mid};--hs:${soft};--hk:${ink}">
      <span class="hdot"></span><b>${a.name}</b><span>${escapeHtml(st.text)}</span>
      ${st.pct != null ? `<i class="hbar2"><i style="width:${Math.round(st.pct * 100)}%"></i></i>` : ''}</a>`;
  }).join('');
  if (sbUser) { if (projects === null) loadProjects(); acadEnsure(); }
  return `
    <header class="top home-top"><div class="home-brand"><img src="icons/icon-192.png" alt=""><b>I Commit!</b></div>
      <p class="amuted">${fmtDay(startOfToday(), { weekday: 'long', day: 'numeric', month: 'long' })}</p>${menuBtn}</header>
    <section class="home" data-section="Overview">
      <div class="home-donut">${donutSvg({ big: true })}<p class="help center">Tap the centre for your week, or a slice to go there.</p></div>
      <div class="home-areas"><a class="harea centre" href="#/plan"><span class="hdot"></span><b>This week</b><span>Your week, day by day, with the whiteboard</span></a>${areas}${puzzleAreaHtml()}</div>
    </section>`;
}
// The floating mini-donut on every other page.
function floatDonutHtml() {
  if (route.tab === 'home') return '';
  const current = CENTRE_TABS.includes(route.tab) ? 'centre' : (HOME_AREAS.find((a) => a.tabs.includes(route.tab)) || {}).key || null;
  return `<nav class="fdonut" aria-label="Go to another part of I Commit!" ${fdPlace()}>${donutSvg({ current })}<span class="fd-grip" title="Drag to move" aria-hidden="true">⠿</span><a class="fd-home" href="#/home">Overview</a></nav>`;
}
// Where you've dragged it to (its centre, kept on this device). It's anchored to the nearest corner so
// it opens towards the middle of the screen.
let fdPos = null;
try { fdPos = JSON.parse(localStorage.getItem('fdonutPos') || 'null'); } catch {}
function fdPlace() {
  if (!fdPos) return '';
  const r = 29, x = Math.min(innerWidth - r - 6, Math.max(r + 6, fdPos.x)), y = Math.min(innerHeight - r - 6, Math.max(r + 6, fdPos.y));
  const h = x < innerWidth / 2 ? `left:${Math.round(x - r)}px;right:auto` : `right:${Math.round(innerWidth - x - r)}px;left:auto`;
  const v = y < innerHeight / 2 ? `top:${Math.round(y - r)}px;bottom:auto` : `bottom:${Math.round(innerHeight - y - r)}px;top:auto`;
  return `style="${h};${v}"`;
}
// Dragging it: grab the small button (or the open panel by its edge or the ⠿ grip) and move it anywhere.
let fdDrag = null, fdNoClick = 0;
document.addEventListener('pointerdown', (e) => {
  const fd = e.target.closest && e.target.closest('.fdonut');
  if (!fd || e.button > 0) return;
  const small = fd.offsetWidth < 80;
  if (!small && e.target.closest('.dslice, .dcentre, .fd-home')) return; // open: the slices are links
  fdDrag = { fd, sx: e.clientX, sy: e.clientY, moved: false };
  fd.setPointerCapture(e.pointerId);
  e.preventDefault(); // no text selection while moving it
});
document.addEventListener('pointermove', (e) => {
  const d = fdDrag;
  if (!d) return;
  if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 6) return;
  d.moved = true;
  d.fd.classList.add('dragging');
  d.fd.classList.remove('open');
  const r = d.fd.offsetWidth / 2;
  Object.assign(d.fd.style, { left: `${e.clientX - r}px`, top: `${e.clientY - r}px`, right: 'auto', bottom: 'auto' });
});
document.addEventListener('pointerup', (e) => {
  const d = fdDrag;
  fdDrag = null;
  if (!d || !d.moved) return;
  fdNoClick = Date.now();
  fdPos = { x: e.clientX, y: e.clientY };
  try { localStorage.setItem('fdonutPos', JSON.stringify(fdPos)); } catch {}
  d.fd.setAttribute('style', fdPlace().replace(/^style="|"$/g, ''));
  setTimeout(() => d.fd.classList.remove('dragging'), 250);
});
document.addEventListener('pointercancel', () => { if (fdDrag) { fdDrag.fd.classList.remove('dragging'); fdDrag = null; } });
window.addEventListener('resize', () => { const fd = document.querySelector('.fdonut'); if (fd && fdPos) fd.setAttribute('style', fdPlace().replace(/^style="|"$/g, '')); });
// With a mouse it opens when the pointer rests on its middle (not its rim) for a moment. Once open it stays
// open for at least 5 seconds after the pointer was last over it, so there's time to look and aim; moving
// back over it keeps it open. On a touch screen the first tap opens it and a tap outside closes it.
const FD_STAY_MS = 5000;
let fdTimer = null, fdCloseTimer = null, fdLastOver = 0, fdInside = false, fdHome = null; // fdHome: where the small button was
function fdScheduleClose(fd) {
  clearTimeout(fdCloseTimer);
  fdCloseTimer = setTimeout(() => { fdCloseTimer = null; if (!fd.matches(':focus-within')) fd.classList.remove('open'); }, Math.max(0, fdLastOver + FD_STAY_MS - Date.now()));
}
document.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch' || fdDrag) return;
  const fd = document.querySelector('.fdonut');
  if (!fd) return;
  const r = fd.getBoundingClientRect(), dist = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
  if (!fd.classList.contains('open')) {
    const middle = dist < r.width * 0.3; // the inner part of the button only
    if (middle && !fdTimer) fdTimer = setTimeout(() => {
      fdTimer = null;
      const h = fd.getBoundingClientRect();
      fdHome = { x: h.left + h.width / 2, y: h.top + h.height / 2, r: h.width / 2 + 12 }; // the open circle grows towards the middle, so this spot ends up outside it
      fd.classList.add('open'); fdLastOver = Date.now(); fdInside = true;
    }, 160);
    else if (!middle && fdTimer) { clearTimeout(fdTimer); fdTimer = null; }
    return;
  }
  const onIt = dist <= r.width / 2 + 14 || (fdHome && Math.hypot(e.clientX - fdHome.x, e.clientY - fdHome.y) <= fdHome.r);
  if (onIt) { fdInside = true; fdLastOver = Date.now(); clearTimeout(fdCloseTimer); fdCloseTimer = null; } // over it: keep it open
  else {                                                                                                                         // left it: close 5 s after leaving
    if (fdInside) { fdInside = false; fdLastOver = Date.now(); }
    if (!fdCloseTimer) fdScheduleClose(fd);
  }
}, { passive: true });
// On a touch screen there's no hover: the first tap opens it, a tap outside closes it.
document.addEventListener('click', (e) => {
  if (Date.now() - fdNoClick < 400 && e.target.closest && e.target.closest('.fdonut')) { e.preventDefault(); e.stopPropagation(); return; }
  const fd = e.target.closest && e.target.closest('.fdonut');
  const open = document.querySelector('.fdonut.open');
  if (open && !fd) { open.classList.remove('open'); e.preventDefault(); e.stopPropagation(); return; } // closing shouldn't also tap what's underneath
  if (fd && !fd.classList.contains('open') && window.matchMedia('(hover: none)').matches) { e.preventDefault(); e.stopPropagation(); fd.classList.add('open'); }
}, true);

// ---------- Focus time ----------
// A task can be "just tick" (the default) or "record focus time". A task that records time gets a ▶ button:
// pick a stopwatch or a countdown, a small timer bar follows you round the app, and when you stop the minutes
// are added to that task's day (and its planned-vs-actual hours). The timer lives on this device and survives a
// refresh. Sessions are also kept as history in Supabase (supabase/focus-puzzle.sql).
const FOCUS_KEY = 'focusTimer';
let focusT = null; // { id, wk, i, name, mode: 'up' | 'down', target (minutes), start (ms), paused (ms paused so far), pausedAt (ms, 0 while running), alerted }
try { focusT = JSON.parse(localStorage.getItem(FOCUS_KEY) || 'null'); } catch {}
const saveFocusT = () => { try { if (focusT) localStorage.setItem(FOCUS_KEY, JSON.stringify(focusT)); else localStorage.removeItem(FOCUS_KEY); } catch {} };
const focusElapsed = () => (focusT ? (focusT.pausedAt || Date.now()) - focusT.start - focusT.paused : 0);
const fmtClock = (ms) => {
  const t = Math.floor(Math.max(0, ms) / 1000), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
};
const fmtMin = (m) => { m = Math.round(m); return m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`; };
function focusShown() {
  if (!focusT) return '';
  if (focusT.mode === 'down') { const left = focusT.target * 60000 - focusElapsed(); return left >= 0 ? fmtClock(left) : `+${fmtClock(-left)}`; }
  return fmtClock(focusElapsed());
}
const focusMinOf = (it, i) => Math.round((it && it.focus && it.focus[i]) || 0);
const focusSum = (it) => (it && it.focus ? it.focus.reduce((a, b) => a + (+b || 0), 0) : 0);
// the ▶ button on a task that records time
const focusBtn = (id, wk, i, it) => (it && it.track
  ? `<button class="fbtn ${focusT && focusT.id === id ? 'on' : ''}" data-act="focus-start" data-id="${id}" data-wk="${wk}" data-day="${i}" aria-label="Focus on ${escapeHtml(it.name)}" title="Start focus time">▶</button>` : '');
function focusBarHtml() {
  if (!focusT) return '';
  const over = focusT.mode === 'down' && focusElapsed() >= focusT.target * 60000;
  return `<div class="fbar ${focusT.pausedAt ? 'paused' : ''} ${over ? 'over' : ''}" role="timer" aria-label="Focus timer">
    <span class="fbar-n">${escapeHtml(focusT.name)}</span><b data-ftime>${focusShown()}</b>
    <button data-act="focus-pause" aria-label="${focusT.pausedAt ? 'Resume' : 'Pause'}">${focusT.pausedAt ? '▶' : '⏸'}</button>
    <button data-act="focus-stop" aria-label="Stop and save">■</button></div>`;
}
function focusTick() {
  if (!focusT) { if (/^[▶⏸]/.test(document.title)) document.title = 'I Commit!'; return; }
  const el = document.querySelector('[data-ftime]');
  if (el) el.textContent = focusShown();
  document.title = `${focusT.pausedAt ? '⏸' : '▶'} ${focusShown()} · ${focusT.name}`;
  if (focusT.mode === 'down' && !focusT.alerted && !focusT.pausedAt && focusElapsed() >= focusT.target * 60000) {
    focusT.alerted = true; saveFocusT();
    const bar = document.querySelector('.fbar'); if (bar) bar.classList.add('over');
    toast(`Time’s up: ${focusT.name}`);
    try { if (window.Notification && Notification.permission === 'granted') new Notification('Focus time is up', { body: focusT.name }); } catch {}
    try { if (navigator.vibrate) navigator.vibrate([200, 100, 200]); } catch {}
  }
}
setInterval(focusTick, 1000);

function openFocusSheet(id, wk, i) {
  const c = state.commitments.find((x) => x.id === id);
  if (!c) return;
  if (focusT) { toast(focusT.id === id ? 'This task is already being timed' : 'Stop the running timer first'); return; }
  const planned = Math.round(plannedHours(c) * 60);
  openSheet(`<div class="sheet-head"><h3>Focus: ${escapeHtml(c.name)}</h3></div>
    <div class="menu">
      <button class="btn primary" data-act="focus-go" data-mode="up">Stopwatch <small>counts up until you stop</small></button>
      <div class="f"><span>Countdown</span>
        <div class="focus-presets">${[...new Set([25, 50, ...(planned > 0 && planned <= 600 ? [planned] : [])])].sort((a, b) => a - b).map((m) =>
          `<button class="btn" data-act="focus-go" data-mode="down" data-min="${m}">${m} min${m === planned ? ' · planned' : ''}</button>`).join('')}</div>
        <form class="inline" data-form="focus-custom"><input name="min" type="number" inputmode="numeric" min="1" max="600" placeholder="Other, in minutes"><button class="mini-btn" type="submit">Start</button></form></div>
      <button class="btn" data-act="close">Cancel</button>
    </div>`, { focus: { id, wk, i } });
}
function startFocus(mode, minutes) {
  const ctx = sheetCtx && sheetCtx.focus, c = ctx && state.commitments.find((x) => x.id === ctx.id);
  if (!c || focusT) return;
  focusT = { id: c.id, wk: ctx.wk, i: ctx.i, name: c.name, mode, target: mode === 'down' ? Math.min(600, Math.max(1, Math.round(minutes))) : 0, start: Date.now(), paused: 0, pausedAt: 0, alerted: false };
  saveFocusT(); closeSheet(); render();
  try { if (mode === 'down' && window.Notification && Notification.permission === 'default') Notification.requestPermission(); } catch {} // so the end of a countdown can ping you
}
function focusPause() {
  if (!focusT) return;
  if (focusT.pausedAt) { focusT.paused += Date.now() - focusT.pausedAt; focusT.pausedAt = 0; } else focusT.pausedAt = Date.now();
  saveFocusT(); render();
}
// Stop: the timer pauses while you check the minutes and say whether the task is done.
function openFocusStop() {
  if (!focusT) return;
  if (!focusT.pausedAt) focusT.pausedAt = Date.now();
  saveFocusT(); render();
  const mins = Math.max(1, Math.round(focusElapsed() / 60000)), it = (state.weeks[focusT.wk] || { items: {} }).items[focusT.id];
  const finished = it && (it.kind === 'task' ? (it.freq === 'daily' || it.freq === 'periodic' ? it.ticks[focusT.i] : it.done) : false);
  openSheet(`<div class="sheet-head"><h3>${escapeHtml(focusT.name)}</h3></div>
    <form class="form flat" data-form="focus-stop">
      <label class="f">Minutes to save<input name="min" type="number" inputmode="numeric" min="1" max="1440" value="${mins}" required>
        <span class="help">Change it if you forgot to stop the timer.</span></label>
      ${it && it.kind === 'task' ? `<label class="toggle-row"><input type="checkbox" name="done" ${finished ? 'checked disabled' : ''}><span>${finished ? 'Already ticked off' : 'Tick it off as done'}</span></label>` : ''}
      <button class="btn primary" type="submit">Save</button>
      <button type="button" class="btn" data-act="focus-resume">Keep going</button>
      <button type="button" class="btn warn" data-act="focus-discard">Discard this session</button>
    </form>`, { focusStop: true });
}
function saveFocus(form) {
  if (!focusT) return;
  const f = new FormData(form), mins = Math.min(1440, Math.max(1, Math.round(num(f.get('min'), 1))));
  const w = getWeek(focusT.wk), it = w && w.items[focusT.id];
  if (it) {
    it.focus = fit7(it.focus, 0).map((n) => num(n));
    it.focus[focusT.i] = round2(it.focus[focusT.i] + mins);
    if (f.get('done') === 'on' && it.kind === 'task') { if (it.freq === 'daily' || it.freq === 'periodic') it.ticks[focusT.i] = true; else it.done = true; }
  }
  const t = focusT;
  focusT = null; saveFocusT(); save(); closeSheet(); render();
  toast(`Saved ${fmtMin(mins)}${form.querySelector('[name="done"]:checked:not(:disabled)') ? ' and ticked it off' : ''}`);
  if (sbUser && sb) sb.from('focus_sessions').insert({ task_id: t.id, task_name: t.name.slice(0, 200), day: isoDate(dayDate(t.wk, t.i)), minutes: mins, mode: t.mode }).then(() => {}, () => {}); // history, best effort
}
function discardFocus() {
  if (!confirm('Throw this session away?')) return;
  focusT = null; saveFocusT(); closeSheet(); render();
}
function weekFocusMin(w) { return w ? Object.values(w.items).reduce((n, it) => n + focusSum(it), 0) : 0; }

// ---------- Jigsaw ----------
// One 10 × 5 jigsaw (50 pieces) at a time. Pieces come from what you finish, and pile up in a pool:
//   a routine ticked on a day = 10, a one-off task (or appointment) done = 5,
//   a project marked complete = 30, or 10 per week of its length when that is more.
// Pieces earned are worked out from your ticks (nothing to store, counted from the day you started).
// Each finished jigsaw goes to the Archive and the next picture comes from the active series: a list of things
// you asked for (e.g. "top 10 highest mountains"), each with a photo found on Wikimedia Commons. While you
// solve it the picture's name and source stay hidden; they show once it is in the archive.
// What's placed, your series and the archive are saved on this device and in Supabase (supabase/focus-puzzle.sql).
const PUZ_COLS = 10, PUZ_ROWS = 5, PUZ_A = 50;
const PUZ_ROUTINE = 10, PUZ_ONCE = 5, PUZ_PROJECT_MIN = 30, PUZ_PROJECT_WEEK = 10;
const PUZ_CATS = ['Featured_pictures_of_landscapes', 'Featured_pictures_of_mountains', 'Featured_pictures_of_lakes', 'Featured_pictures_of_beaches', 'Featured_pictures_of_waterfalls', 'Featured_pictures_of_forests'];
const puzProjectPieces = (p) => (noTime(p) ? PUZ_PROJECT_MIN : Math.max(PUZ_PROJECT_MIN, PUZ_PROJECT_WEEK * (p.weeks || 1)));

// ---- the topics I can fill in by myself ("Name|extra words" = a clue for the picture search, "Name=Wikipedia title")
const PUZ_TOPICS = [
  { key: 'capitals', title: 'World capitals', ask: 'all the world capitals', words: /capital/, hint: 'city', items: [
    'Kabul|Afghanistan', 'Tirana|Albania', 'Algiers|Algeria', 'Andorra la Vella|Andorra', 'Luanda|Angola', 'Saint John’s|Antigua and Barbuda=St. John\'s, Antigua and Barbuda', 'Buenos Aires|Argentina', 'Yerevan|Armenia', 'Canberra|Australia', 'Vienna|Austria',
    'Baku|Azerbaijan', 'Nassau|Bahamas=Nassau, Bahamas', 'Manama|Bahrain', 'Dhaka|Bangladesh', 'Bridgetown|Barbados', 'Minsk|Belarus', 'Brussels|Belgium', 'Belmopan|Belize', 'Porto-Novo|Benin', 'Thimphu|Bhutan',
    'Sucre|Bolivia', 'Sarajevo|Bosnia and Herzegovina', 'Gaborone|Botswana', 'Brasília|Brazil', 'Bandar Seri Begawan|Brunei', 'Sofia|Bulgaria', 'Ouagadougou|Burkina Faso', 'Gitega|Burundi', 'Praia|Cabo Verde', 'Phnom Penh|Cambodia',
    'Yaoundé|Cameroon', 'Ottawa|Canada', 'Bangui|Central African Republic', 'N\'Djamena|Chad', 'Santiago|Chile=Santiago', 'Beijing|China', 'Bogotá|Colombia', 'Moroni|Comoros=Moroni, Comoros', 'Brazzaville|Republic of the Congo', 'Kinshasa|DR Congo',
    'San José|Costa Rica=San José, Costa Rica', 'Yamoussoukro|Côte d\'Ivoire', 'Zagreb|Croatia', 'Havana|Cuba', 'Nicosia|Cyprus', 'Prague|Czechia', 'Copenhagen|Denmark', 'Djibouti|Djibouti=Djibouti (city)', 'Roseau|Dominica', 'Santo Domingo|Dominican Republic',
    'Quito|Ecuador', 'Cairo|Egypt', 'San Salvador|El Salvador', 'Malabo|Equatorial Guinea', 'Asmara|Eritrea', 'Tallinn|Estonia', 'Mbabane|Eswatini', 'Addis Ababa|Ethiopia', 'Suva|Fiji', 'Helsinki|Finland',
    'Paris|France', 'Libreville|Gabon', 'Banjul|Gambia', 'Tbilisi|Georgia', 'Berlin|Germany', 'Accra|Ghana', 'Athens|Greece', 'St. George’s|Grenada=St. George\'s, Grenada', 'Guatemala City|Guatemala', 'Conakry|Guinea',
    'Bissau|Guinea-Bissau', 'Georgetown|Guyana=Georgetown, Guyana', 'Port-au-Prince|Haiti', 'Tegucigalpa|Honduras', 'Budapest|Hungary', 'Reykjavík|Iceland', 'New Delhi|India', 'Jakarta|Indonesia', 'Tehran|Iran', 'Baghdad|Iraq',
    'Dublin|Ireland', 'Jerusalem|Israel', 'Rome|Italy', 'Kingston|Jamaica=Kingston, Jamaica', 'Tokyo|Japan', 'Amman|Jordan', 'Astana|Kazakhstan', 'Nairobi|Kenya', 'Tarawa|Kiribati=South Tarawa', 'Kuwait City|Kuwait',
    'Bishkek|Kyrgyzstan', 'Vientiane|Laos', 'Riga|Latvia', 'Beirut|Lebanon', 'Maseru|Lesotho', 'Monrovia|Liberia', 'Tripoli|Libya=Tripoli, Libya', 'Vaduz|Liechtenstein', 'Vilnius|Lithuania', 'Luxembourg City|Luxembourg',
    'Antananarivo|Madagascar', 'Lilongwe|Malawi', 'Kuala Lumpur|Malaysia', 'Malé|Maldives', 'Bamako|Mali', 'Valletta|Malta', 'Majuro|Marshall Islands', 'Nouakchott|Mauritania', 'Port Louis|Mauritius', 'Mexico City|Mexico',
    'Palikir|Micronesia', 'Chișinău|Moldova', 'Monaco|Monaco', 'Ulaanbaatar|Mongolia', 'Podgorica|Montenegro', 'Rabat|Morocco', 'Maputo|Mozambique', 'Naypyidaw|Myanmar', 'Windhoek|Namibia', 'Yaren|Nauru',
    'Kathmandu|Nepal', 'Amsterdam|Netherlands', 'Wellington|New Zealand', 'Managua|Nicaragua', 'Niamey|Niger', 'Abuja|Nigeria', 'Pyongyang|North Korea', 'Skopje|North Macedonia', 'Oslo|Norway', 'Muscat|Oman',
    'Islamabad|Pakistan', 'Ngerulmud|Palau', 'Panama City|Panama', 'Port Moresby|Papua New Guinea', 'Asunción|Paraguay', 'Lima|Peru', 'Manila|Philippines', 'Warsaw|Poland', 'Lisbon|Portugal', 'Doha|Qatar',
    'Bucharest|Romania', 'Moscow|Russia', 'Kigali|Rwanda', 'Basseterre|Saint Kitts and Nevis', 'Castries|Saint Lucia', 'Kingstown|Saint Vincent and the Grenadines', 'Apia|Samoa', 'San Marino|San Marino=City of San Marino', 'São Tomé|São Tomé and Príncipe', 'Riyadh|Saudi Arabia',
    'Dakar|Senegal', 'Belgrade|Serbia', 'Victoria|Seychelles=Victoria, Seychelles', 'Freetown|Sierra Leone', 'Singapore|Singapore', 'Bratislava|Slovakia', 'Ljubljana|Slovenia', 'Honiara|Solomon Islands', 'Mogadishu|Somalia', 'Pretoria|South Africa',
    'Seoul|South Korea', 'Juba|South Sudan', 'Madrid|Spain', 'Sri Jayawardenepura Kotte|Sri Lanka', 'Khartoum|Sudan', 'Paramaribo|Suriname', 'Stockholm|Sweden', 'Bern|Switzerland', 'Damascus|Syria', 'Dushanbe|Tajikistan',
    'Dodoma|Tanzania', 'Bangkok|Thailand', 'Dili|Timor-Leste', 'Lomé|Togo', 'Nukuʻalofa|Tonga', 'Port of Spain|Trinidad and Tobago', 'Tunis|Tunisia', 'Ankara|Türkiye', 'Ashgabat|Turkmenistan', 'Funafuti|Tuvalu',
    'Kampala|Uganda', 'Kyiv|Ukraine', 'Abu Dhabi|United Arab Emirates', 'London|United Kingdom', 'Washington, D.C.|United States', 'Montevideo|Uruguay', 'Tashkent|Uzbekistan', 'Port Vila|Vanuatu', 'Caracas|Venezuela', 'Hanoi|Vietnam',
    'Sanaa|Yemen', 'Lusaka|Zambia', 'Harare|Zimbabwe'] },
  { key: 'famous-mountains', title: 'Famous mountains', ask: 'top 10 famous mountains', words: /(famous|iconic|well.known).*(mountain|peak)/, hint: 'mountain', items: [
    'Matterhorn', 'Mount Fuji', 'Mount Kilimanjaro', 'Denali', 'Mont Blanc', 'Aconcagua', 'Mount Kenya', 'Table Mountain', 'Ben Nevis', 'Snowdon', 'Eiger', 'Mount Elbrus', 'Aoraki / Mount Cook', 'Half Dome', 'Mount Olympus'] },
  { key: 'mountains', title: 'Highest mountains', ask: 'top 10 highest mountains', words: /mountain|peak|eight.?thousand/, hint: 'mountain', items: [
    'Mount Everest', 'K2', 'Kangchenjunga', 'Lhotse', 'Makalu', 'Cho Oyu', 'Dhaulagiri', 'Manaslu', 'Nanga Parbat', 'Annapurna I=Annapurna', 'Gasherbrum I', 'Broad Peak', 'Gasherbrum II', 'Shishapangma'] },
  { key: 'rivers', title: 'Longest rivers', ask: 'top 10 longest rivers', words: /river/, hint: 'river', items: [
    'Nile', 'Amazon River', 'Yangtze', 'Mississippi River', 'Yenisey', 'Yellow River', 'Ob River', 'Paraná River', 'Congo River', 'Amur River', 'Lena River', 'Mekong', 'Mackenzie River', 'Niger River', 'Murray River'] },
  { key: 'lakes', title: 'Largest lakes', ask: 'top 10 largest lakes', words: /lake/, hint: 'lake', items: [
    'Caspian Sea', 'Lake Superior', 'Lake Victoria', 'Lake Huron', 'Lake Michigan', 'Lake Tanganyika', 'Lake Baikal', 'Great Bear Lake', 'Lake Malawi', 'Great Slave Lake', 'Lake Erie', 'Lake Ontario'] },
  { key: 'waterfalls', title: 'Waterfalls', ask: 'top 10 waterfalls', words: /waterfall|falls/, hint: 'waterfall', items: [
    'Angel Falls', 'Victoria Falls', 'Niagara Falls', 'Iguazu Falls', 'Yosemite Falls', 'Kaieteur Falls', 'Gullfoss', 'Skógafoss', 'Seljalandsfoss', 'Dettifoss', 'Havasu Falls', 'Multnomah Falls', 'Rhine Falls', 'Jog Falls', 'Krimml Waterfalls'] },
  { key: 'islands', title: 'Largest islands', ask: 'top 10 largest islands', words: /island/, hint: 'island', items: [
    'Greenland', 'New Guinea', 'Borneo', 'Madagascar', 'Baffin Island', 'Sumatra', 'Honshu', 'Victoria Island|Canada=Victoria Island (Canada)', 'Great Britain', 'Ellesmere Island'] },
  { key: 'deserts', title: 'Deserts', ask: 'top 10 largest deserts', words: /desert/, hint: 'desert', items: [
    'Sahara', 'Arabian Desert', 'Gobi Desert', 'Kalahari Desert', 'Patagonian Desert', 'Syrian Desert', 'Great Victoria Desert', 'Atacama Desert', 'Namib', 'Mojave Desert', 'Thar Desert', 'Sonoran Desert', 'Taklamakan Desert'] },
  { key: 'volcanoes', title: 'Volcanoes', ask: 'top 10 famous volcanoes', words: /volcano/, hint: 'volcano', items: [
    'Mount Fuji', 'Mount Etna', 'Mount Vesuvius', 'Eyjafjallajökull', 'Mount St. Helens', 'Krakatoa', 'Mauna Loa', 'Mount Rainier', 'Popocatépetl', 'Mount Merapi', 'Cotopaxi', 'Mount Pinatubo', 'Kīlauea', 'Mount Erebus', 'Stromboli'] },
  { key: 'parks', title: 'National parks', ask: 'top 10 national parks', words: /national park|\bparks?\b/, hint: 'national park', items: [
    'Yellowstone National Park', 'Grand Canyon National Park', 'Yosemite National Park', 'Banff National Park', 'Torres del Paine National Park', 'Serengeti National Park', 'Zion National Park', 'Fiordland National Park', 'Plitvice Lakes National Park', 'Lake District',
    'Glacier National Park (U.S.)', 'Jasper National Park', 'Kruger National Park', 'Arches National Park', 'Bryce Canyon National Park', 'Sagarmatha National Park'] },
  { key: 'wonders', title: 'Wonders & landmarks', ask: 'top 10 wonders of the world', words: /wonder|landmark|monument/, hint: '', items: [
    'Great Wall of China', 'Petra', 'Christ the Redeemer (statue)', 'Machu Picchu', 'Chichen Itza', 'Colosseum', 'Taj Mahal', 'Eiffel Tower', 'Angkor Wat', 'Sagrada Família', 'Stonehenge', 'Giza pyramid complex|Egypt', 'Acropolis of Athens', 'Sydney Opera House',
    'Elizabeth Tower|Big Ben', 'Statue of Liberty', 'Golden Gate Bridge', 'Burj Khalifa', 'Mount Rushmore', 'Neuschwanstein Castle'] },
];
function puzItem(s) { // "Paris|France=Paris" → { n: 'Paris, France', t: 'Paris', h: 'France' }
  const [front, title] = String(s).split('='), [name, extra] = front.split('|');
  return { n: (extra ? `${name}, ${extra}` : name).slice(0, 80), t: (title || name).slice(0, 100), h: (extra || '').slice(0, 60) };
}

// ---- saved state: this device, and one private row in Supabase when signed in
function puzFresh() { return { v: 3, rev: 0, start: todayISO(), seen: 0, active: 'landscapes', series: [{ id: 'landscapes', title: 'Random landscapes', items: null, next: 0 }], cur: null, archive: [] }; }
let puz = null, puzCloudOff = false, puzLoaded = false, puzTimer = null, puzMemo = null, puzBusy = false;
try { puz = JSON.parse(localStorage.getItem('puzzles3') || 'null'); } catch {}
if (!puz || puz.v !== 3 || !Array.isArray(puz.series) || !Array.isArray(puz.archive)) puz = puzFresh();
try { localStorage.removeItem('puzzles'); } catch {} // the old weekly jigsaws
const puzDb = {
  async load() { const { data, error } = await sb.from('puzzle_state').select('state').maybeSingle(); if (error) throw error; return data && data.state; },
  async save() { const { error } = await sb.from('puzzle_state').upsert({ user_id: sbUser.id, state: puz, updated_at: new Date().toISOString() }, { onConflict: 'user_id' }); if (error) throw error; },
};
const puzCloudErr = (e) => { if (/does not exist|schema cache/i.test((e && e.message) || '')) puzCloudOff = true; };
function puzSave() {
  puz.rev = (puz.rev || 0) + 1;
  try { localStorage.setItem('puzzles3', JSON.stringify(puz)); } catch {}
  if (sbUser && sb && !puzCloudOff) { clearTimeout(puzTimer); puzTimer = setTimeout(() => puzDb.save().catch(puzCloudErr), 800); }
}
async function puzLoadCloud() {
  if (puzLoaded || !sbUser || !sb || puzCloudOff) return;
  puzLoaded = true;
  try {
    const cloud = await puzDb.load();
    if (cloud && cloud.v === 3 && (cloud.rev || 0) > (puz.rev || 0)) { puz = cloud; try { localStorage.setItem('puzzles3', JSON.stringify(puz)); } catch {} if (['plan', 'puzzle'].includes(route.tab) && !typing() && !pzDrag) render(); }
    else if (!cloud || (cloud.rev || 0) < (puz.rev || 0)) await puzDb.save();
  } catch (e) { puzLoaded = false; puzCloudErr(e); }
}

// ---- what you've earned
function onceDoneP(id, it) { // an appointment: ticked, or (if it came from a synced calendar) once it has passed
  if (periodDone(it)) return true;
  const c = state.commitments.find((x) => x.id === id);
  if (!c || !c.source || !it.date) return false;
  const now = new Date(), t = it.endTime || it.time, hm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  return it.date < todayISO() || (it.date === todayISO() && (!t || t <= hm));
}
function puzEarned() {
  const start = puz.start;
  let n = 0;
  const once = new Set();
  for (const wk of Object.keys(state.weeks)) {
    const w = state.weeks[wk];
    if (!w || addDaysISO(wk, 6) < start) continue;
    for (let i = 0; i < 7; i++) {
      const d = isoDate(dayDate(wk, i));
      if (d < start) continue;
      for (const [, it] of itemsOf(w, 'daily')) if (dayDone(it, i)) n += PUZ_ROUTINE;
      for (const [id, it] of itemsOf(w, 'periodic')) { const st = periodicOn(id, it, d); if (st === 'done' || (st && dayDone(it, i))) n += PUZ_ROUTINE; }
    }
    for (const [, it] of itemsOf(w, 'weekly')) if (periodDone(it)) n += PUZ_ROUTINE;
    for (const [id, it] of itemsOf(w, 'once')) {
      if (it.schedule || once.has(id) || (it.date && it.date < start)) continue;
      if (onceDoneP(id, it)) { once.add(id); n += PUZ_ONCE; }
    }
  }
  for (const p of projects || []) if (p.done_on && p.done_on >= start) n += puzProjectPieces(p);
  return n;
}
function puzStatus() {
  if (puzMemo === null) puzMemo = puzEarned();
  const pool = Math.max(0, puzMemo - puz.archive.length * PUZ_A), placed = puz.cur ? puz.cur.placed.length : 0;
  return { earned: puzMemo, pool, placed, tray: Math.max(0, Math.min(PUZ_A, pool) - placed), waiting: Math.max(0, pool - PUZ_A) };
}
function pieceOrder(id) { // the order pieces are handed out in: shuffled, the same on every device
  const rnd = rngFrom(`order${id}`), a = Array.from({ length: PUZ_A }, (_, i) => i);
  for (let i = PUZ_A - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const puzTray = () => pieceOrder(puz.cur.id).slice(0, Math.min(PUZ_A, puzStatus().pool)).filter((i) => !puz.cur.placed.includes(i));
function rngFrom(str) { // a small seeded random generator, so a shuffle is the same on every device
  let h = 2166136261;
  for (const ch of String(str)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => { h |= 0; h = (h + 0x6D2B79F5) | 0; let t = Math.imul(h ^ (h >>> 15), 1 | h); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const safeImg = (u) => (/^https:\/\//i.test(u || '') ? String(u).replace(/["'()\s<>\\]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`) : '');
const puzSeries = (id) => puz.series.find((s) => s.id === id);

// ---- the puzzle in progress
function puzNext() { // start the next puzzle from the active series
  let s = puzSeries(puz.active) || puz.series[0];
  if (s.items && s.next >= s.items.length) { toast(`${s.title} is finished! 🎉 Back to random landscapes`); s = puz.series.find((x) => !x.items); puz.active = s.id; }
  const it = s.items ? s.items[s.next] : null;
  puz.cur = { id: uid(), sid: s.id, name: it ? it.n : '', t: it ? it.t : '', h: it ? it.h || s.hint || '' : '', image: null, placed: [], fail: false, tries: 0 };
  if (it) s.next++;
}
function puzEnsure() {
  if (!puz.cur) { puzNext(); puzSave(); }
  const c = puz.cur;
  if (!c.image && !c.fail && !puzBusy) puzFetch();
  return c;
}
async function puzFetch() {
  const c = puz.cur;
  if (!c || c.image || puzBusy) return;
  puzBusy = true;
  const id = c.id, rnd = rngFrom(`pic${id}${c.tries}`);
  let img = null;
  try { img = c.name ? await puzFindImage(c.t, c.h, rnd) : await commonsPick(rnd); } catch { /* offline or blocked */ }
  if (!img && !c.name) img = { title: 'Random photo', url: `https://picsum.photos/seed/${id}/1600/1000`, w: 1600, h: 1000, page: 'https://picsum.photos', credit: 'Photo from Lorem Picsum (Unsplash)', source: 'Lorem Picsum' };
  puzBusy = false;
  if (!puz.cur || puz.cur.id !== id) return;
  if (img) puz.cur.image = img; else puz.cur.fail = true;
  puzSave();
  if (['plan', 'today', 'puzzle'].includes(route.tab) && !typing() && !pzDrag) render();
}
function puzSkip() { // put this picture aside for a new one (a named item goes to the back of its series)
  const c = puz.cur;
  if (!c || c.placed.length) return;
  const s = puzSeries(c.sid);
  if (s && s.items && c.name) s.items.push({ n: c.name, t: c.t, h: c.h });
  puz.cur = null; puzNext(); puzSave(); render();
}
function puzActivate(id) {
  const s = puzSeries(id);
  if (!s) return;
  puz.active = id;
  const c = puz.cur;
  if (c && !c.placed.length) { // nothing placed yet: switch straight away and hand the picture back
    const old = puzSeries(c.sid);
    if (old && old.items && c.name && old.items[old.next - 1] && old.items[old.next - 1].n === c.name) old.next--;
    puz.cur = null; puzNext();
  }
  puzSave(); render();
}
function puzDeleteSeries(id) {
  const s = puzSeries(id);
  if (!s || !s.items || !confirm(`Delete the series “${s.title}”? Pictures you already finished stay in your archive.`)) return;
  puz.series = puz.series.filter((x) => x.id !== id);
  if (puz.active === id) puz.active = 'landscapes';
  if (puz.cur && puz.cur.sid === id) { if (puz.cur.placed.length) puz.cur.sid = 'landscapes'; else puz.cur = null; }
  puzSave(); render();
}
function puzFinish() {
  const c = puz.cur, s = puzSeries(c.sid);
  const entry = { id: c.id, sid: c.sid, st: s ? s.title : '', n: c.name || c.image.title, image: c.image, at: todayISO() };
  puz.archive.unshift(entry);
  puz.cur = null; puzNext(); puzSave();
  render();
  openArchiveSheet(entry.id, true);
}

// ---- finding a picture on Wikimedia Commons (free to use, with credit)
const WIKI_API = 'https://en.wikipedia.org/w/api.php', COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const puzBadTitle = /\b(map|maps|flag|logo|coat of arms|locator|diagram|chart|seal|stamp|poster|plan|route|profile|montage|collage|print|engraving|lithograph|painting|drawing|illustration|postcard|map of|aerial view of port)\b|\.(svg|png|gif|pdf|tif|tiff|webp)$/i;
const puzStrip = (h) => String((h && h.value) || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
const puzJson = async (url) => (await fetch(url, { signal: AbortSignal.timeout(12000) })).json();
function puzImg(ii, title) {
  const m = ii.extmetadata || {};
  return { title: String(title).replace(/^File:/, '').replace(/\.[a-z]+$/i, '').slice(0, 120), url: ii.thumburl, w: ii.thumbwidth || 1600, h: ii.thumbheight || Math.round(1600 / (ii.width / ii.height)),
    page: ii.descriptionurl || '', credit: `${puzStrip(m.Artist).slice(0, 80) || 'Unknown photographer'} · ${puzStrip(m.LicenseShortName).slice(0, 30) || 'see the page'}`, source: 'Wikimedia Commons' };
}
const puzShape = (ii, minW = 1400) => { const ar = ii.width / ii.height; return ii.thumburl && ii.width >= minW && ar >= 1.3 && ar <= 2.1; };
const commonsPages = (j) => Object.values((j.query && j.query.pages) || {}).filter((p) => p.imageinfo && p.imageinfo[0]).map((p) => ({ title: p.title, ii: p.imageinfo[0], index: p.index || 0 }));
const COMMONS_INFO = 'prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=1600&format=json&origin=*';
async function puzFindImage(title, hint, rnd) {
  try { // the picture at the top of the Wikipedia article
    const j = await puzJson(`${WIKI_API}?action=query&titles=${encodeURIComponent(title)}&redirects=1&prop=pageimages&piprop=name&format=json&origin=*`);
    const pg = Object.values(j.query.pages)[0], file = pg && pg.pageimage;
    if (file && /\.jpe?g$/i.test(file) && !puzBadTitle.test(file)) {
      const [c] = commonsPages(await puzJson(`${COMMONS_API}?action=query&titles=${encodeURIComponent('File:' + file)}&${COMMONS_INFO}`));
      if (c && puzShape(c.ii)) return puzImg(c.ii, c.title);
    }
  } catch { /* try the search below */ }
  for (const term of [`${title} ${hint || ''}`.trim(), title]) {
    try {
      const list = commonsPages(await puzJson(`${COMMONS_API}?action=query&generator=search&gsrsearch=${encodeURIComponent(term + ' filetype:bitmap')}&gsrnamespace=6&gsrlimit=25&${COMMONS_INFO}`))
        .sort((a, b) => a.index - b.index).filter((c) => /\.jpe?g$/i.test(c.title) && !puzBadTitle.test(c.title) && puzShape(c.ii));
      if (list.length) { const c = list[Math.floor(rnd() * Math.min(3, list.length))]; return puzImg(c.ii, c.title); }
    } catch { /* next term */ }
  }
  return null;
}
async function commonsTitles(cat) {
  try { const c = JSON.parse(localStorage.getItem(`puzCat:${cat}`) || 'null'); if (c && Date.now() - c.at < 7 * 864e5 && c.titles.length) return c.titles; } catch {}
  const titles = ((await puzJson(`${COMMONS_API}?action=query&list=categorymembers&cmtitle=Category:${cat}&cmtype=file&cmlimit=500&format=json&origin=*`)).query.categorymembers || []).map((m) => m.title).filter((t) => /\.jpe?g$/i.test(t));
  try { localStorage.setItem(`puzCat:${cat}`, JSON.stringify({ at: Date.now(), titles })); } catch {}
  return titles;
}
async function commonsPick(rand) { // a random featured landscape
  for (let t = 0; t < 8; t++) {
    const cat = PUZ_CATS[Math.floor(rand() * PUZ_CATS.length)], titles = await commonsTitles(cat);
    if (!titles.length) continue;
    const title = titles[Math.floor(rand() * titles.length)];
    const [c] = commonsPages(await puzJson(`${COMMONS_API}?action=query&titles=${encodeURIComponent(title)}&${COMMONS_INFO}`));
    if (c && puzShape(c.ii, 1600) && c.ii.width / c.ii.height <= 1.9) return puzImg(c.ii, c.title);
  }
  return null;
}

// "+10 pieces": told once when your pool grows.
function puzzleNotify() {
  const e = puzStatus().earned;
  if (e > (puz.seen || 0)) { const d = e - puz.seen; puz.seen = e; puzSave(); toast(`+${d} jigsaw piece${d === 1 ? '' : 's'}! Place ${d === 1 ? 'it' : 'them'} on the Puzzle page`); }
  else if (e < (puz.seen || 0)) { puz.seen = e; puzSave(); }
}

// ---- series: type what you want
function puzParseSeries(phrase, list) {
  const p = String(phrase || '').trim().replace(/\s+/g, ' ');
  let lines = String(list || '').split(/\n|;/).map((s) => s.trim()).filter(Boolean);
  if (lines.length === 1 && lines[0].includes(',')) lines = lines[0].split(',').map((s) => s.trim()).filter(Boolean);
  if (lines.length) {
    const items = lines.slice(0, 200).map((l) => { const [n, h] = l.split('|').map((x) => x.trim()); return { n: n.slice(0, 80), t: n.slice(0, 100), h: (h || '').slice(0, 60) }; });
    return { title: (p || 'My series').slice(0, 60), hint: '', items };
  }
  if (!p) return { error: 'Type what you want, for example “top 10 highest mountains”.' };
  const low = p.toLowerCase(), topic = PUZ_TOPICS.find((t) => t.words.test(low));
  if (!topic) return { error: `I can’t find “${p}” by myself yet. Pick one of the topics below, or type your own list (one per line) and I’ll find a picture for each.` };
  const m = low.match(/(?:top|first|best)\s*(\d+)|(\d+)\s*(?:highest|longest|largest|tallest|biggest|famous|most)/) || low.match(/\b(\d+)\b/);
  const want = /\ball\b/.test(low) || !m ? Infinity : +(m[1] || m[2]);
  const items = topic.items.slice(0, Math.max(1, Math.min(want, topic.items.length))).map(puzItem);
  return { title: p[0].toUpperCase() + p.slice(1), hint: topic.hint, items, short: want !== Infinity && want > topic.items.length ? topic.items.length : 0 };
}
function createSeries(form) {
  const f = new FormData(form), r = puzParseSeries(f.get('phrase'), f.get('list'));
  if (r.error) { const el = $sheet.querySelector('[data-series-msg]'); if (el) el.textContent = r.error; return; }
  const s = { id: uid(), title: r.title, hint: r.hint, items: r.items, next: 0 };
  puz.series.push(s);
  closeSheet();
  puzActivate(s.id);
  toast(`${s.title}: ${s.items.length} pictures${r.short ? ` (that’s all I have for this topic)` : ''}`);
}
function openSeriesSheet() {
  openSheet(`<div class="sheet-head"><h3>New series</h3><p class="muted">A series is a list of pictures, one jigsaw each, in order. Say what you want and I’ll find the pictures. Names and sources stay hidden until each jigsaw is finished.</p></div>
    <form class="form flat" data-form="series-new">
      <label class="f">What series?<input name="phrase" placeholder="top 10 highest mountains" autocomplete="off" autocapitalize="off"></label>
      <div class="pz-chips">${PUZ_TOPICS.map((t) => `<button type="button" class="pz-chip" data-act="series-topic" data-v="${escapeHtml(t.ask)}">${escapeHtml(t.title)}</button>`).join('')}</div>
      <label class="f">…or your own list<textarea name="list" rows="5" placeholder="One per line, for example:&#10;Mount Everest&#10;K2&#10;Lhotse"></textarea>
        <span class="help">If you fill this in it is used instead of the topic. Add “| extra words” after a name to help find the right photo.</span></label>
      <p class="small warn-text" data-series-msg></p>
      <button class="btn primary" type="submit">Create series</button>
      <button type="button" class="btn" data-act="close">Cancel</button>
    </form>`);
}

// ---- project complete → pieces
async function projToggleDone(id) {
  const p = projById(id);
  if (!p) return;
  const on = !p.done_on;
  try { const saved = await projDb.save('projects', { id, done_on: on ? todayISO() : null }); p.done_on = saved.done_on || null; } catch (e) {
    toast(/done_on|column|schema cache/i.test((e && e.message) || '') ? 'Run supabase/focus-puzzle.sql in Supabase first, then try again' : sbErr(e)); return;
  }
  puzMemo = null;
  puz.seen = Math.max(puz.seen || 0, puzEarned()); puzSave();
  toast(on ? `Project complete! +${puzProjectPieces(p)} jigsaw pieces` : 'Project reopened');
  render();
}

// ---- jigsaw pieces: a rectangle with a tab or a slot on each inner edge
const TAB = [[0.36, 0], [0.44, 0, 0.42, 0.06, 0.42, 0.10], [0.42, 0.15, 0.36, 0.17, 0.36, 0.22], [0.36, 0.29, 0.45, 0.31, 0.50, 0.31], [0.55, 0.31, 0.64, 0.29, 0.64, 0.22], [0.64, 0.17, 0.58, 0.15, 0.58, 0.10], [0.58, 0.06, 0.56, 0, 0.64, 0]];
function edgeD(P, Q, n) { // from P to Q; n is the outward direction times the tab's sign (0 = a flat edge)
  if (!n[0] && !n[1]) return `L${Q[0].toFixed(1)} ${Q[1].toFixed(1)} `;
  const dx = Q[0] - P[0], dy = Q[1] - P[1], L = Math.hypot(dx, dy);
  const at = (a, b) => `${(P[0] + dx * a + n[0] * b * L).toFixed(1)} ${(P[1] + dy * a + n[1] * b * L).toFixed(1)}`;
  let d = `L${at(TAB[0][0], 0)} `;
  for (const s of TAB.slice(1)) d += `C${at(s[0], s[1])} ${at(s[2], s[3])} ${at(s[4], s[5])} `;
  return `${d}L${Q[0].toFixed(1)} ${Q[1].toFixed(1)} `;
}
function pzSigns(id) {
  const rnd = rngFrom(`tabs${id}`), pick = () => (rnd() < 0.5 ? 1 : -1);
  return { hs: Array.from({ length: PUZ_ROWS - 1 }, () => Array.from({ length: PUZ_COLS }, pick)), vs: Array.from({ length: PUZ_ROWS }, () => Array.from({ length: PUZ_COLS - 1 }, pick)) };
}
function pzPath(r, c, g, sg) {
  const { w, h, k, cols, rows } = g, x0 = k, y0 = k, x1 = k + w, y1 = k + h;
  const top = r > 0 ? -sg.hs[r - 1][c] : 0, bottom = r < rows - 1 ? sg.hs[r][c] : 0, left = c > 0 ? -sg.vs[r][c - 1] : 0, right = c < cols - 1 ? sg.vs[r][c] : 0;
  return `M${x0} ${y0} ${edgeD([x0, y0], [x1, y0], [0, -top])}${edgeD([x1, y0], [x1, y1], [right, 0])}${edgeD([x1, y1], [x0, y1], [0, bottom])}${edgeD([x0, y1], [x0, y0], [-left, 0])}Z`;
}
function pzGeometry(cur, W) {
  const H = W * (cur.image.h / cur.image.w), w = W / PUZ_COLS, h = H / PUZ_ROWS;
  return { cols: PUZ_COLS, rows: PUZ_ROWS, W, H, w, h, k: Math.ceil(Math.max(w, h) * 0.32) };
}
function pzPiece(idx, g, sg, cur) {
  const r = Math.floor(idx / g.cols), c = idx % g.cols, el = document.createElement('div');
  el.className = 'pz-piece';
  Object.assign(el.style, { width: `${g.w + 2 * g.k}px`, height: `${g.h + 2 * g.k}px`, backgroundImage: `url("${safeImg(cur.image.url)}")`, backgroundSize: `${g.W}px ${g.H}px`,
    backgroundPosition: `${g.k - c * g.w}px ${g.k - r * g.h}px`, backgroundRepeat: 'no-repeat', clipPath: `path('${pzPath(r, c, g, sg)}')` });
  return el;
}
let pzDrag = null;
function layoutPuzzle() {
  const board = $app.querySelector('.pz-board'), tray = $app.querySelector('[data-pz-tray]');
  const cur = puz.cur;
  if (!board || !cur || !cur.image || !board.clientWidth) return;
  const g = pzGeometry(cur, board.clientWidth), sg = pzSigns(cur.id);
  board.style.height = `${g.H}px`;
  board.style.setProperty('--cw', `${g.w}px`); board.style.setProperty('--ch', `${g.h}px`);
  board.innerHTML = '';
  for (const idx of cur.placed) {
    const el = pzPiece(idx, g, sg, cur), r = Math.floor(idx / g.cols), c = idx % g.cols;
    Object.assign(el.style, { left: `${c * g.w - g.k}px`, top: `${r * g.h - g.k}px` });
    el.classList.add('placed');
    board.appendChild(el);
  }
  if (tray) {
    tray.innerHTML = '';
    const ts = Math.min(1, ((tray.clientWidth - 16 - 4 * 10) / 5) / (g.w + 2 * g.k)); // five pieces to a row
    for (const idx of puzTray()) {
      const wrap = document.createElement('div'), el = pzPiece(idx, g, sg, cur);
      wrap.className = 'pz-item'; wrap.dataset.idx = idx;
      Object.assign(wrap.style, { width: `${(g.w + 2 * g.k) * ts}px`, height: `${(g.h + 2 * g.k) * ts}px` });
      Object.assign(el.style, { transform: `scale(${ts})`, transformOrigin: '0 0' });
      wrap.appendChild(el); tray.appendChild(wrap);
    }
    if (!tray.children.length) tray.innerHTML = '<p class="muted small">No pieces to place right now. Tick a routine (+10), finish a one-off task (+5) or complete a project and they arrive here.</p>';
  }
  pzDrag = null;
  window.__pzGeom = { g, sg, cur };
}
document.addEventListener('pointerdown', (e) => {
  const item = e.target.closest && e.target.closest('.pz-item');
  if (!item || e.button > 0 || route.page !== 'puzzle' || !window.__pzGeom) return;
  const { g, sg, cur } = window.__pzGeom, idx = +item.dataset.idx;
  const ghost = pzPiece(idx, g, sg, cur);
  ghost.className = 'pz-piece pz-ghostpiece';
  document.body.appendChild(ghost);
  pzDrag = { idx, ghost, g, cur, x: e.clientX, y: e.clientY, item };
  item.classList.add('lifted');
  pzMoveGhost(e.clientX, e.clientY);
  pzDrag.scroll = setInterval(() => { if (pzDrag.y < 70) window.scrollBy(0, -14); else if (pzDrag.y > innerHeight - 70) window.scrollBy(0, 14); }, 16);
  item.setPointerCapture(e.pointerId);
  e.preventDefault();
});
function pzMoveGhost(x, y) {
  const d = pzDrag;
  d.x = x; d.y = y;
  d.ghost.style.transform = `translate(${x - (d.g.w / 2 + d.g.k)}px, ${y - (d.g.h / 2 + d.g.k)}px)`;
}
document.addEventListener('pointermove', (e) => { if (pzDrag) pzMoveGhost(e.clientX, e.clientY); });
document.addEventListener('pointerup', (e) => {
  const d = pzDrag;
  if (!d) return;
  clearInterval(d.scroll); d.ghost.remove(); d.item.classList.remove('lifted');
  const board = $app.querySelector('.pz-board');
  if (!board) { pzDrag = null; return; }
  const b = board.getBoundingClientRect(), r = Math.floor(d.idx / d.g.cols), c = d.idx % d.g.cols;
  const cx = b.left + (c + 0.5) * d.g.w, cy = b.top + (r + 0.5) * d.g.h;
  if (Math.hypot(e.clientX - cx, e.clientY - cy) < Math.max(d.g.w, d.g.h) * 0.6 && puz.cur && puz.cur.id === d.cur.id && !puz.cur.placed.includes(d.idx)) { // close enough to its own spot: it snaps in
    puz.cur.placed.push(d.idx);
    puzSave();
    pzDrag = null;
    if (puz.cur.placed.length >= PUZ_A) puzFinish(); else render();
  } else {
    d.item.animate([{ transform: 'translateX(-5px)' }, { transform: 'translateX(5px)' }, { transform: 'none' }], { duration: 220 }); // not there: back to the tray
    pzDrag = null;
  }
});
document.addEventListener('pointercancel', () => { if (pzDrag) { clearInterval(pzDrag.scroll); pzDrag.ghost.remove(); pzDrag.item.classList.remove('lifted'); pzDrag = null; } });
window.addEventListener('resize', () => { if (route.page === 'puzzle' && !pzDrag) layoutPuzzle(); });

// ---- the card on This week, and the Puzzle page
function puzzleLineHtml() {
  puzEnsure();
  const st = puzStatus();
  return st.tray ? `<a class="wpuzzle" href="#/puzzle">${st.tray} jigsaw piece${st.tray === 1 ? '' : 's'} to place ›</a>` : '';
}
function puzzleSeriesHtml() {
  const rows = puz.series.map((s) => {
    const done = puz.archive.filter((a) => a.sid === s.id).length, on = puz.active === s.id;
    return `<div class="pz-series ${on ? 'on' : ''}"><div class="pzs-name"><b>${escapeHtml(s.title)}</b><span>${s.items ? `${done} of ${s.items.length} done` : `${done} done · never runs out`}</span></div>
      ${on ? '<span class="pzs-on">Next up</span>' : `<button class="mini-btn" data-act="series-use" data-id="${s.id}">Use next</button>`}
      ${s.items ? `<button class="icon-btn small" data-act="series-del" data-id="${s.id}" aria-label="Delete series ${escapeHtml(s.title)}">✕</button>` : ''}</div>`;
  }).join('');
  return `<section class="card" data-section="Series"><div class="card-head"><h2>Series</h2><button class="mini-btn push" data-act="series-new">+ New series</button></div>
    <p class="small muted">The next jigsaw comes from the series marked “Next up”.</p>${rows}</section>`;
}
function puzzleArchiveHtml() {
  if (!puz.archive.length) return `<section class="card" data-section="Archive"><div class="card-head"><h2>Archive</h2></div><p class="small muted">Finished jigsaws are kept here, with the picture’s name and source.</p></section>`;
  return `<section class="card" data-section="Archive"><div class="card-head"><h2>Archive</h2><span class="hint">${puz.archive.length} finished</span></div>
    <div class="pz-coll">${puz.archive.map((a) => `<button class="pz-cell full" data-act="arch-open" data-id="${a.id}" style="background-image:url('${safeImg(a.image.url)}')"><span>${escapeHtml(a.n)}<b>${escapeHtml(a.st || '')}</b></span></button>`).join('')}</div></section>`;
}
function openArchiveSheet(id, justDone = false) {
  const a = puz.archive.find((x) => x.id === id);
  if (!a) return;
  openSheet(`<div class="sheet-head"><h3>${justDone ? 'Complete! 🎉 ' : ''}${escapeHtml(a.n)}</h3><p class="muted small">${escapeHtml(a.st || '')}${a.st ? ' · ' : ''}finished ${fmtShort(a.at)}</p></div>
    <img class="pz-big" src="${safeImg(a.image.url)}" alt="${escapeHtml(a.n)}">
    <p class="pz-credit">${escapeHtml(a.image.title)} · ${escapeHtml(a.image.credit)}${a.image.page ? ` · <a href="${escapeHtml(a.image.page)}" target="_blank" rel="noopener">source ↗</a>` : ''}</p>
    <button class="btn" data-act="close">${justDone ? 'Next jigsaw' : 'Close'}</button>`);
}
function puzzlePageHtml() {
  const cur = puzEnsure(), st = puzStatus(), s = puzSeries(cur.sid);
  const back = '<button class="icon-btn" data-act="back" aria-label="Back">‹</button>';
  const head = `<header class="top">${topBar({ left: back, label: 'Puzzle', title: 'Jigsaw', right: '<a class="txt-btn" href="#/plan">Week ›</a>' })}</header>`;
  const sub = s && s.items ? `${escapeHtml(s.title)} · ${puz.archive.filter((a) => a.sid === s.id).length + 1} of ${s.items.length}` : 'Random landscape';
  let body;
  if (cur.image) {
    body = `<div class="pz-layout"><div class="pz-left"><div class="pz-board" data-pz="${cur.id}"></div></div>
      <div class="pz-right"><div class="pz-trayhead">${st.tray ? `Pieces to place (${st.tray}). Drag each to its spot.` : 'Pieces to place'}${st.waiting ? ` · ${st.waiting} more saved for the next jigsaw` : ''}</div><div class="pz-tray" data-pz-tray></div></div></div>
      ${cur.placed.length ? '' : '<button class="btn" data-act="pz-skip">Pick a different picture</button>'}`;
  } else if (cur.fail) {
    body = `<p class="muted pad">I couldn’t find a good photo for this one.</p><div class="btn-row"><button class="btn primary" data-act="pz-retry">Try again</button><button class="btn" data-act="pz-skip">Skip it</button></div>`;
  } else body = '<p class="muted pad">Finding a picture…</p>';
  return `${head}
    <section class="card pzmain" data-section="Puzzle">
      <div class="card-head"><h2>Jigsaw</h2><span class="hint">${cur.placed.length}/${PUZ_A} placed</span></div>
      <p class="small muted">${sub} · the picture and its name are a surprise until you finish.</p>
      ${body}
      <p class="small muted">Earn pieces: routine tick +${PUZ_ROUTINE} · one-off task +${PUZ_ONCE} · project complete +${PUZ_PROJECT_MIN}, or ${PUZ_PROJECT_WEEK} a week for long ones.</p>
    </section>${puzzleSeriesHtml()}${puzzleArchiveHtml()}`;
}

// ---------- Sheets (bottom modals) ----------
let sheetCtx = null;
function openSheet(html, ctx = null) {
  sheetCtx = ctx;
  $sheet.innerHTML = `<div class="backdrop" data-act="close"></div><div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  $sheet.hidden = false;
  document.body.classList.add('locked');
}
function closeSheet() {
  $sheet.hidden = true;
  $sheet.innerHTML = '';
  sheetCtx = null;
  document.body.classList.remove('locked');
}

function cellRef(key) {
  const [wk, id, i] = key.split(':');
  const w = state.weeks[wk];
  return { wk, id, i: Number(i), it: w && w.items[id] };
}

function openDaySheet(key) {
  const { wk, i, it } = cellRef(key);
  if (!it) return;
  const target = Math.round(plannedHours(it) * 60);
  const cur = it.mins[i];
  const presets = [...new Set([15, 30, 45, 60, 90, 120, target])].filter((m) => m > 0).sort((a, b) => a - b);
  const counter = it.kind === 'counter' ? `
    <div class="sheet-counter">
      <button class="round" data-act="sdec" ${it.counts[i] <= 0 ? 'disabled' : ''} aria-label="Minus">−</button>
      <div><b>${round2(it.counts[i])}</b><span>of ${round2(it.target)} ${escapeHtml(it.unit)}</span></div>
      <button class="round" data-act="sinc" aria-label="Plus">+</button>
    </div>
    <h4>Time spent (optional)</h4>` : '';
  openSheet(`
    <div class="sheet-head"><h3>${escapeHtml(it.name)}</h3>
      <p class="muted">${fmtDay(dayDate(wk, i), { weekday: 'long', day: 'numeric', month: 'short' })} · planned ${target} min</p></div>
    ${counter}
    <div class="chips">${presets.map((m) => `<button class="chip ${cur === m ? 'on' : ''}" data-act="setmin" data-m="${m}">${m}m</button>`).join('')}</div>
    <form class="inline" data-form="minutes">
      <input id="minIn" type="number" inputmode="numeric" min="0" step="5" placeholder="Minutes" value="${cur ?? ''}">
      <button class="btn primary" type="submit">Save</button>
    </form>
    <div class="sheet-actions">
      ${dayStarted(it, i) ? `<button class="btn" data-act="clearday">${it.kind === 'task' ? 'Untick' : 'Reset to 0'}</button>` : ''}
      <button class="btn" data-act="close">Close</button>
    </div>`, { key });
}

// Logging minutes also marks the day as started (ticks a task; counters need at least 1).
function setMinutes(m) {
  const { it, i } = cellRef(sheetCtx.key);
  if (m > 0) {
    it.mins[i] = m;
    if (it.kind === 'task') it.ticks[i] = true;
    else if (it.counts[i] <= 0) it.counts[i] = it.target || it.step || 1;
  } else {
    it.mins[i] = null;
  }
  save(); closeSheet(); render();
}
function clearDay() {
  const { it, i } = cellRef(sheetCtx.key);
  it.ticks[i] = false; it.counts[i] = 0; it.mins[i] = null;
  save(); closeSheet(); render();
}
function bumpCount(key, dir) {
  const { it, i } = cellRef(key);
  if (!it) return;
  it.counts[i] = Math.max(0, round2(it.counts[i] + dir * (it.step || 1)));
  if (it.counts[i] === 0) it.mins[i] = null;
  save();
}

function openMenu() {
  openSheet(`
    <div class="sheet-head"><h3>Menu</h3></div>
    <div class="menu">
      <a class="btn" href="#/account">${state.account ? `Account · ${escapeHtml(state.account.email)}` : 'Sign in with Google'}</a>
      <a class="btn" href="#/calendar">Calendars</a>
      <a class="btn" href="#/reminders">Reminders &amp; Google Calendar</a>
      <a class="btn" href="#/widget">Phone widget</a>
      <a class="btn" href="#/puzzle">Jigsaw</a>
      ${LEGAL_LINKS}
      <button class="btn" data-act="close">Close</button>
    </div>`);
}

// ---------- Export / import ----------





// ---------- Toast ----------
let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2500);
}

// ---------- Events ----------
// Long-press on a day cell opens the day sheet (minutes, exact count); a tap logs it.
let press = null;
document.addEventListener('pointerdown', (e) => {
  const el = e.target.closest('[data-cell]');
  if (!el) return;
  const p = { key: el.dataset.cell, x: e.clientX, y: e.clientY, fired: false, moved: false };
  p.timer = setTimeout(() => { p.fired = true; openDaySheet(p.key); }, LONG_PRESS_MS);
  press = p;
});
document.addEventListener('pointermove', (e) => {
  if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) { press.moved = true; clearTimeout(press.timer); }
});
for (const t of ['pointerup', 'pointercancel']) document.addEventListener(t, () => { if (press) clearTimeout(press.timer); });
document.addEventListener('contextmenu', (e) => { if (e.target.closest('[data-cell]')) e.preventDefault(); });

document.addEventListener('click', (e) => {
  const cell = e.target.closest('[data-cell]');
  if (cell) {
    const p = press; press = null;
    if (p && p.key === cell.dataset.cell && (p.fired || p.moved)) return;
    const { it, i } = cellRef(cell.dataset.cell);
    if (!it) return;
    if (it.kind === 'task') {
      it.ticks[i] = !it.ticks[i];
      if (!it.ticks[i]) it.mins[i] = null;
      save();
    } else {
      bumpCount(cell.dataset.cell, 1);
    }
    render();
    return;
  }
  const jump = e.target.closest('[data-jump]');
  if (jump) {
    const el = document.getElementById(jump.dataset.jump);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // Highlight what was clicked, even if the page can't scroll that section to the top.
    $app.querySelectorAll('.sn-sections [data-jump]').forEach((l) => l.classList.toggle('on', l === jump));
    jumpHoldUntil = Date.now() + 900;
    return;
  }
  const btn = e.target.closest('[data-act]');
  if (!btn) {
    const open = e.target.closest('[data-open]');
    if (open) location.hash = open.dataset.open;
    return;
  }
  const act = btn.dataset.act;
  const periodItem = () => state.weeks[btn.dataset.wk]?.items[btn.dataset.id];
  switch (act) {
    case 'apps-refresh': refreshApps({ force: true }); break;
    case 'note-done': { const n = state.notes.find((x) => x.id === btn.dataset.id); if (n) { n.done = !n.done; save(); render(); } break; }
    case 'buddy-tick': { const me = buddyView && buddyView.members.find((m) => m.me); buddyAutoDate = null; buddyTick(!(me && me.days[todayISO()])); break; }
    case 'buddy-nudge': {
      const names = buddyView.members.filter((m) => !m.me && !m.days[todayISO()]).map((m) => m.name).join(' & ');
      shareText(`${names}, our tree needs you today 🌱 Finish today’s tasks so it grows!`, `${location.origin}${location.pathname}#/buddy`); break;
    }
    case 'buddy-leave': leavePact(); break;
    case 'tree-tick': if (buddyView) treeTick(btn.dataset.id, !myTicks(buddyView).has(btn.dataset.id)); break;
    case 'tree-task-del': treeRemoveTask(btn.dataset.id); break;
    case 'project-delete': deleteProject(); break;
    case 'ref-delete': deleteRef(btn.dataset.id); break;
    case 'projects-retry': projects = null; render(); break;
    case 'step-new': openStepSheet(null); break;
    case 'step-edit': openStepSheet(btn.dataset.id); break;
    case 'step-delete': removeFromSheet('project_steps'); break;
    case 'meet-new': openMeetSheet(null, btn.dataset.day || null); break;
    case 'step-toggle': toggleStep(btn.dataset.id); break;
    case 'focus-start': openFocusSheet(btn.dataset.id, btn.dataset.wk, +btn.dataset.day || 0); break;
    case 'focus-go': startFocus(btn.dataset.mode, +btn.dataset.min || 0); break;
    case 'focus-pause': focusPause(); break;
    case 'focus-stop': openFocusStop(); break;
    case 'focus-resume': closeSheet(); if (focusT && focusT.pausedAt) focusPause(); break;
    case 'focus-discard': discardFocus(); break;
    case 'pz-skip': puzSkip(); break;
    case 'pz-retry': if (puz.cur) { puz.cur.fail = false; puz.cur.tries = (puz.cur.tries || 0) + 1; puzSave(); render(); } break;
    case 'series-new': openSeriesSheet(); break;
    case 'series-topic': { const el = $sheet.querySelector('[name="phrase"]'); if (el) { el.value = btn.dataset.v; el.focus(); } break; }
    case 'series-use': puzActivate(btn.dataset.id); break;
    case 'series-del': puzDeleteSeries(btn.dataset.id); break;
    case 'arch-open': openArchiveSheet(btn.dataset.id); break;
    case 'proj-done': projToggleDone(route.projId); break;
    case 'plan-week': { const d = +btn.dataset.d; planWk = d === 0 ? null : addDaysISO(planWk || currentWeekKey(), d * 7); if (planWk === currentWeekKey()) planWk = null; render(); break; }
    case 'plan-extra': planExtras[btn.dataset.k] = !planExtras[btn.dataset.k]; try { localStorage.setItem('planExtras', JSON.stringify(planExtras)); } catch {} render(); break;
    case 'wday-place': if (wbPick) placeOnDay(wbPick, btn.dataset.day); break;
    case 'wb-remove': wbRemove(btn.dataset.key); break;
    case 'acad-tick': acadTick(+btn.dataset.id, +btn.dataset.course); break;
    case 'acad-refresh': acad.dbMissing = false; acadLoad({ force: true }); break;
    case 'acad-disconnect': acadDisconnect(); break;
    case 'acad-choose': acad.choosing = !acad.choosing; render(); break;
    case 'acad-course-settings': openCourseSettings(); break;
    case 'acad-lane-all': acadLaneAll(+btn.dataset.course, +btn.dataset.week, btn.dataset.lane); break;
    case 'acad-jump': acadJump(+btn.dataset.week); break;
    case 'acad-move': openLaneSheet(+btn.dataset.course, +btn.dataset.id); break;
    case 'acad-lane': acadSetLane(btn.dataset.lane); break;
    case 'acad-copy-list': acadCopyList(); break;
    case 'acad-wb': acadToWhiteboard(+btn.dataset.course, +btn.dataset.id); break;
    case 'acad-plan': openAcadPlan(+btn.dataset.course, btn.dataset.id ? +btn.dataset.id : null); break;
    case 'acad-untrack': { const id = route.courseId; closeSheet(); acadSetTracked(id, false).then(() => { location.hash = '#/academics'; }); break; }
    case 'buddy-ev': openBuddyEvent(btn.dataset); break;
    case 'pm-month': if (btn.dataset.mk) { projMonthView.set(route.projId, btn.dataset.mk); render(); } break;
    case 'proj-fold': toggleProjFold(route.projId); break;
    case 'logo-find': findLogo(btn.closest('form'), btn); break;
    case 'logo-paste': pasteLogo(btn.closest('form')); break;
    case 'logo-color': matchLogoColor(btn.closest('form')); break;
    case 'logo-remove': {
      const f = btn.closest('form');
      f.logo.value = ''; document.getElementById('logoPrev').innerHTML = '<span class="muted small">None</span>'; btn.hidden = true;
      f.querySelector('[data-act="logo-color"]').hidden = true; document.getElementById('logoColorNote').hidden = true; break;
    }
    case 'meet-edit': openMeetSheet(btn.dataset.id); break;
    case 'meet-delete': removeFromSheet('project_meetings'); break;
    case 'invite-accept': acceptInvite(btn.dataset.id); break;
    case 'invite-decline': declineInvite(btn.dataset.id); break;
    case 'invite-takeback': takeBackInvite(btn.dataset.email); break;
    case 'google-signin': startGoogleSignIn(); break;
    case 'google-cancel': stopGoogleWait(); render(); break;
    case 'notify-retry': outboundAsked = false; render(); break;
    case 'tg-connect': telegramConnect(); break;
    case 'tg-cancel': tgWaitStop(); render(); break;
    case 'tg-disconnect': telegramDisconnect(); break;
    case 'notify-test': notifyTest(false); break;
    case 'notify-test-summary': notifyTest(true); break;
    case 'feed-make': case 'feed-copy': case 'feed-reset': case 'feed-stop': feedAction(act); break;
    case 'sign-out': signOut(); break;
    case 'signin-hide': try { localStorage.setItem('signinHint', 'off'); } catch {} render(); break;
    case 'buddy-refresh': buddyError = null; render(); refreshBuddy(); break;
    case 'apps-more': {
      const k = btn.dataset.key;
      if (appsExpanded.has(k)) appsExpanded.delete(k); else appsExpanded.add(k);
      render(); break;
    }
    case 'app-more': openAppMore(btn.dataset.id); break;
    case 'acad-more': openItemMore(+btn.dataset.course, +btn.dataset.id, !!btn.dataset.week); break;
    case 'app-today': closeSheet(); toggleAppToday(btn.dataset.id); break;
    case 'app-followup': openFollowupSheet(btn.dataset.id); break;
    case 'app-done': {
      closeSheet();
      const a = state.apps.items.find((x) => x.id === btn.dataset.id);
      if (a) { updateApp(a.id, { done: !a.done }); toast(a.done ? `${a.company}: done ✓` : `${a.company}: not done`); }
      break;
    }
    case 'app-mat': {
      const a = state.apps.items.find((x) => x.id === btn.dataset.id);
      if (!a) break;
      const set = new Set(a.materialsDone || []);
      if (set.has(btn.dataset.m)) set.delete(btn.dataset.m); else set.add(btn.dataset.m);
      updateApp(a.id, { materialsDone: [...set] });
      break;
    }
    case 'apps-day': appsDay = appsDay === btn.dataset.date ? null : btn.dataset.date; render(); break;
    case 'apps-month': {
      const [y, m] = appsMonth.split('-').map(Number);
      const d = new Date(y, m - 1 + Number(btn.dataset.dir), 1);
      appsMonth = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; appsDay = null; render(); break;
    }
    case 'cal-day': calViewDay = btn.dataset.date; render(); break;
    case 'cal-who': calWho = btn.dataset.v; try { localStorage.setItem('calWho', calWho); } catch {} render(); break;
    case 'cal-share': openCalShare(); break;
    case 'cal-accept': calAccept(btn.dataset.id); break;
    case 'cal-remove': calRemove(btn.dataset.id); break;
    case 'cal-prev': case 'cal-next': calViewDay = isoDate(addDays(parseISO(calViewDay), act === 'cal-prev' ? -7 : 7)); render(); break;
    case 'cal-today': calViewDay = todayISO(); render(); break;
    case 'prev': viewKey = shiftWeek(viewKey, -1); render(); break;
    case 'next': viewKey = shiftWeek(viewKey, 1); render(); break;
    case 'thisweek': viewKey = currentWeekKey(); render(); break;
    case 'back': goBack(); break;
    case 'menu': openMenu(); break;
    case 'close': closeSheet(); break;
    case 'start-week': {
      const w = state.weeks[viewKey] || (state.weeks[viewKey] = { start: viewKey, items: {} });
      syncWeek(w, true);
      save(); render(); break;
    }
    case 'pdone': {
      const it = periodItem();
      if (it) { it.done = !it.done; save(); render(); }
      break;
    }
    case 'pstep': {
      const it = periodItem();
      if (it) { it.count = Math.max(0, round2(it.count + Number(btn.dataset.dir) * (it.step || 1))); save(); render(); }
      break;
    }
    case 'cdec': bumpCount(btn.dataset.key, -1); render(); break;
    case 'sinc': case 'sdec': {
      const key = sheetCtx.key;
      bumpCount(key, act === 'sinc' ? 1 : -1);
      render(); openDaySheet(key); break;
    }
    case 'setmin': setMinutes(Number(btn.dataset.m)); break;
    case 'clearday': clearDay(); break;
    case 'reorder': reorderMode = !reorderMode; render(); break;
    case 'up': case 'down':
      moveCommitment(btn.closest('[data-cid]').dataset.cid, act === 'up' ? -1 : 1);
      save(); render(); break;
    case 'restore': {
      const c = state.commitments.find((x) => x.id === btn.closest('[data-cid]').dataset.cid);
      c.archived = false; c.order = nextOrder();
      renumber(); save(); render(); toast(`Restored “${c.name}”`); break;
    }
    case 'archive-one': case 'restore-one': {
      const c = state.commitments.find((x) => x.id === route.id);
      c.archived = act === 'archive-one';
      if (!c.archived) c.order = nextOrder();
      renumber(); save();
      toast(c.archived ? `Archived “${c.name}”` : `Restored “${c.name}”`);
      location.replace(c.archived ? '#/commitments' : `#/c/${c.id}`);
      break;
    }
    case 'delete-one': deleteCommitment(route.id); break;
    case 'addlink': {
      const tpl = document.getElementById('linkRowTpl');
      btn.parentElement.querySelector('.linklist').append(tpl.content.cloneNode(true));
      break;
    }
    case 'rmlink': {
      const list = btn.closest('.linklist');
      btn.closest('.linkrow').remove();
      if (!list.children.length) list.append(document.getElementById('linkRowTpl').content.cloneNode(true));
      break;
    }
    case 'cal-sync': syncAll({ force: true, feedId: btn.dataset.feed }); break;
    case 'cal-remove': removeFeed(btn.dataset.feed); break;
    case 'cal-decide': setDecision(btn.dataset.feed, btn.dataset.uid, btn.dataset.d); break;
    case 'cal-color': {
      const feed = state.calendars.feeds.find((f) => f.id === btn.dataset.feed);
      if (feed && CAL_COLORS.includes(btn.dataset.color)) { feed.color = btn.dataset.color; save(); render(); }
      break;
    }
    case 'cal-allsched': {
      const feed = state.calendars.feeds.find((f) => f.id === btn.dataset.feed);
      if (!feed) break;
      feed.allSchedule = btn.checked;
      if (calCache[feed.id]) { applyFeed(feed, calCache[feed.id]); save(); render(); }
      else { save(); syncAll({ force: true, feedId: feed.id }); }
      toast(feed.allSchedule ? `${feed.name}: all events are now schedule` : `${feed.name}: events follow each series again`);
      break;
    }
    case 'cal-ask': {
      const feed = state.calendars.feeds.find((f) => f.id === btn.dataset.feed);
      if (feed) { feed.ask = btn.checked; save(); }
      break;
    }
    case 'review-all': document.querySelectorAll('input[name="imp"]').forEach((x) => { x.checked = btn.dataset.on === '1'; }); btn.dataset.on = btn.dataset.on === '1' ? '0' : '1'; break;
    case 'sync-on': case 'sync-now': case 'sync-copy': case 'sync-off': case 'sync-delete': syncAction(act); break;
    case 'widget-on': case 'widget-off': case 'widget-send': case 'widget-reset': case 'widget-copy': widgetAction(act); break;
  }
});

// Edit form: show/hide fields as frequency, type and unit change.
function syncFollowupForm(form) {
  const fd = new FormData(form);
  form.dataset.tbc = String(fd.get('tbc') === 'on');
  const other = form.querySelector('.stage-other');
  if (other) other.hidden = fd.get('stage') !== 'Other';
}
function syncFormVisibility(form) {
  const fd = new FormData(form);
  // Switching minutes/hours converts the number already typed.
  const unit = fd.get('timeUnit');
  if (unit && form.dataset.unit && form.dataset.unit !== unit && form.hours) {
    const v = num(form.hours.value);
    form.hours.value = unit === 'min' ? Math.round(v * 60) : round2(v / 60);
    form.hours.step = unit === 'min' ? 5 : 0.25;
  }
  if (unit) form.dataset.unit = unit;
  form.dataset.freq = fd.get('freq');
  form.dataset.kind = fd.get('kind');
  form.dataset.hourunit = String(isHourUnit(fd.get('unit')));
  form.dataset.tbc = String(fd.get('tbc') === 'on');
}
document.addEventListener('input', (e) => {
  if (e.target.name === 'customColor') { pickCustomColor(e.target); return; }
  if ((e.target.name === 'starts' || e.target.name === 'ends') && e.target.form && e.target.form.dataset.form === 'project') {
    document.getElementById('projLength').textContent = projLengthLabel(e.target.form.starts.value, e.target.form.ends.value);
    return;
  }
  const fu = e.target.closest('form[data-form="followup"]');
  if (fu) syncFollowupForm(fu);
  const form = e.target.closest('form[data-form="commitment"]');
  if (form) syncFormVisibility(form);
});
document.addEventListener('change', (e) => {
  if (e.target.dataset && e.target.dataset.calLevel) { calSetLevel(e.target.dataset.calLevel, e.target.value); return; }
  if (e.target.id === 'logoFile') {
    const file = e.target.files[0], f = e.target.closest('form');
    e.target.value = '';
    if (file) useLogoBlob(f, file);
    return;
  }
  if (e.target.name === 'customColor') { pickCustomColor(e.target); return; }
  if (e.target.name === 'layout' && e.target.form && e.target.form.dataset.form === 'project') { e.target.form.dataset.layout = e.target.value; return; }
  if (e.target.dataset && e.target.dataset.acadTrack) { acadSetTracked(+e.target.dataset.acadTrack, e.target.checked); return; }
  if (e.target.dataset && e.target.dataset.acadTerm !== undefined) {
    const v = e.target.value;
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { acad.termStart = v; render(); acadDb.term(v).catch((err) => toast(sbErr(err))); }
    return;
  }
  if (e.target.name === 'owner' && e.target.closest('form[data-form="tree-task"]')) { treeNewOwner = e.target.value; return; }
  if (e.target.closest('form[data-form="buddy-routine"]')) {
    if (e.target.name === 'share') { setShareCalendar(e.target.value); return; }
    const prefs = { commitmentId: (state.buddy && state.buddy.commitmentId) || null, links: { ...((state.buddy && state.buddy.links) || {}) } };
    if (e.target.name.startsWith('link:')) { const id = e.target.name.slice(5); if (e.target.value) prefs.links[id] = e.target.value; else delete prefs.links[id]; } else prefs.commitmentId = e.target.value || null;
    state.buddy = prefs; buddyAutoDate = null; save(); render(); return;
  }
  if (e.target.closest('form[data-form="notify-prefs"]')) { saveNotifyPrefs(e.target.form); return; }
  const form = e.target.closest('form[data-form="commitment"]');
  if (form) syncFormVisibility(form);
});

document.addEventListener('invalid', (e) => { const d = e.target.closest && e.target.closest('details.more'); if (d) d.open = true; }, true);
document.addEventListener('submit', (e) => {
  const form = e.target.dataset.form;
  if (!form) return;
  e.preventDefault();
  if (form === 'minutes') setMinutes(Math.max(0, Math.round(Number(document.getElementById('minIn').value) || 0)));
  else if (form === 'commitment') saveCommitmentForm(e.target);
  else if (form === 'notify-prefs') saveNotifyPrefs(e.target);
  else if (form === 'calendar-add') addFeed(e.target);
  else if (form === 'review') submitReview(e.target);
  else if (form === 'sync-join') joinSync(e.target);
  else if (form === 'followup') saveFollowup(e.target);
  else if (form === 'buddy-create') createPact(e.target);
  else if (form === 'tree-task') treeAddTask(e.target);
  else if (form === 'project') saveProjectForm(e.target);
  else if (form === 'step') saveStep(e.target);
  else if (form === 'step-quick') quickStep(e.target);
  else if (form === 'focus-custom') { const m = num(new FormData(e.target).get('min'), 0); if (m >= 1) startFocus('down', m); else toast('Enter the minutes'); }
  else if (form === 'focus-stop') saveFocus(e.target);
  else if (form === 'series-new') createSeries(e.target);
  else if (form === 'acad-plan') saveAcadPlan(e.target);
  else if (form === 'wb-add') wbAdd(e.target);
  else if (form === 'acad-connect') acadConnect(e.target);
  else if (form === 'acad-course') acadSaveCourse(e.target);
  else if (form === 'ref') addRef(e.target);
  else if (form === 'meeting') saveMeeting(e.target);
  else if (form === 'cal-invite') { calInvite(e.target); e.target.reset(); }
  else if (form === 'buddy-email') { inviteByEmail(new FormData(e.target).get('email')); e.target.reset(); }
  else if (form === 'buddy-note') buddyTick(true, String(new FormData(e.target).get('note') || '').trim());
  else if (form === 'stage-link') {
    const c = state.commitments.find((x) => x.id === e.target.dataset.id);
    const url = cleanUrl(new FormData(e.target).get('url'));
    if (!c || !url) { toast('Paste a full link (https://…)'); return; }
    c.stageUrl = url; save(); render(); toast('Link saved');
  }
});

// ⌘V with a picture on the clipboard, anywhere on the project edit page, sets the logo
// (pasting text into a field still works as normal).
document.addEventListener('paste', (e) => {
  if (route.page !== 'project-edit' || !e.clipboardData) return;
  const item = [...e.clipboardData.items].find((i) => i.kind === 'file' && i.type.startsWith('image/'));
  if (!item) return;
  e.preventDefault();
  useLogoBlob(document.getElementById('pform'), item.getAsFile());
});
// Dragging a picture onto the Logo box: a file from the Mac, or a picture from a web page
// (which arrives as its address, fetched through the server).
document.addEventListener('dragover', (e) => {
  const zone = e.target.closest && e.target.closest('.plogo-field');
  if (!zone) return;
  e.preventDefault();
  zone.classList.add('drop-on');
});
document.addEventListener('dragleave', (e) => {
  const zone = e.target.closest && e.target.closest('.plogo-field');
  if (zone && !zone.contains(e.relatedTarget)) zone.classList.remove('drop-on');
});
document.addEventListener('drop', (e) => {
  const zone = e.target.closest && e.target.closest('.plogo-field');
  if (!zone) return;
  e.preventDefault();
  zone.classList.remove('drop-on');
  const form = zone.closest('form'), dt = e.dataTransfer;
  const file = [...dt.files].find((f) => f.type.startsWith('image/'));
  if (file) { useLogoBlob(form, file); return; }
  const html = dt.getData('text/html'), src = html && (html.match(/<img[^>]+src=["']([^"']+)/i) || [])[1];
  const url = (src || dt.getData('text/uri-list') || dt.getData('text/plain') || '').split('\n')[0].trim().replace(/&amp;/g, '&');
  if (!/^https:\/\//.test(url)) { toast('Drop a picture here'); return; }
  form.querySelector('#logoSite').value = url;
  findLogo(form, form.querySelector('[data-act="logo-find"]'));
});

document.addEventListener('keydown', (e) => {
  // Enter in the logo website box finds the logo instead of saving the project
  if (e.key === 'Enter' && e.target.id === 'logoSite') { e.preventDefault(); e.target.form.querySelector('[data-act="logo-find"]').click(); return; }
  if (e.key === 'Escape' && !$sheet.hidden) closeSheet();
});

// Coming back to the app (e.g. next morning): refresh "today", and follow the week
// rollover if you were looking at the old current week.
// Coming back after a while (10 minutes) also starts again on Today, with every view back on today's date.
const BACK_TO_TODAY_MS = 10 * 60e3;
let hiddenAt = 0;
function backToToday() {
  viewKey = currentWeekKey();
  calViewDay = todayISO();
  planWk = null;
  planJump = true;
  if (route.tab !== 'plan' || route.id || route.page) location.hash = '#/plan'; else render();
}
document.addEventListener('visibilitychange', () => {
  if (!state) return; // still loading saved data
  if (document.visibilityState === 'visible' && hiddenAt && Date.now() - hiddenAt > BACK_TO_TODAY_MS && !formOpen() && !sheetCtx) backToToday();
  if (document.visibilityState === 'hidden') {
    hiddenAt = Date.now();
    flush();
    if (widgetTimer) pushWidget();
    if (outboundTimer) sendOutbound();
    if (state.sync.enabled && Object.keys(state.sync.dirty).length + Object.keys(state.sync.tombs).length) syncNow();
    return;
  }
  const cur = currentWeekKey();
  if (cur !== lastCurrentKey) { if (viewKey === lastCurrentKey) viewKey = cur; lastCurrentKey = cur; }
  if (!sheetCtx && !formOpen()) render();
  syncThenCalendars();
  refreshBuddy();
  if (loginWait) pollGoogle();
  scheduleOutbound(); // a new day moves the reminder plan on
  if (!state.account && loginCfg && loginCfg.error) { loginCfg = null; loadLoginConfig(); }
  if (swRegistration) swRegistration.update().catch(() => {});
});
window.addEventListener('pagehide', flush);

// ---------- Boot ----------
// Data sync first, so a calendar sync never runs on stale data from this device.
async function syncThenCalendars() {
  if (!state) return;
  if (state.sync.enabled) await syncNow();
  syncAll({ quiet: true });
  refreshApps();
}
let swRegistration = null;
let reloadingForUpdate = false;
(async function init() {
  let loaded, wasV1 = false;
  try {
    loaded = await loadState();
    if (loaded) { wasV1 = (loaded.version || 1) < 2; loaded = migrate(loaded); }
  } catch (e) {
    // Don't overwrite whatever is stored if we couldn't read it.
    console.error(e);
    state = defaultState();
    writeState = async () => {};
    render();
    toast('Could not open saved data — changes will not be kept. Reload the app.');
    return;
  }
  if (loaded) {
    state = loaded;
    if (wasV1) save();
  } else {
    state = defaultState();
    save();
  }
  if (state.sync.enabled) resetRecordHashes();
  render();
  syncThenCalendars();
  setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, SYNC_POLL_MS);
  refreshBuddy();
  setInterval(() => { if (document.visibilityState === 'visible') refreshBuddy(); }, BUDDY_POLL_MS);
  if (route.page === 'account' || !state.account) loadLoginConfig();
  setInterval(() => { if (document.visibilityState === 'visible') { syncAll({ quiet: true }); refreshApps(); } }, 5 * 60e3);
  scheduleWidgetPush(1000);
  loadOutboundStatus();
  navigator.storage?.persist?.();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').then((reg) => { swRegistration = reg; }).catch((e) => console.warn('SW failed', e));
    // A new version took over: reload once so the page runs it (unless you're in the middle of something).
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloadingForUpdate) return;
      if (formOpen() || sheetCtx) { toast('App updated. It will refresh next time you open it.'); return; }
      reloadingForUpdate = true;
      writeState().catch(() => {}).finally(() => location.reload());
    });
  }
})();
