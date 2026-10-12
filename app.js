'use strict';

// ---------- Defaults ----------
// A commitment has a frequency (daily / weekly / once) and a kind:
//   task    – done or not done (planned time = `hours`)
//   counter – count towards `target` `unit`s in `step`s (e.g. 3 emails; 15 h)
const DEFAULT_COMMITMENTS = [
  // Examples for a fresh install; edit them in the Commitments tab.
  // [freq, kind, section, name, target, unit, hours]
  ['daily', 'task', 'Study', 'Independent study', 1, '', 2],
  ['daily', 'task', 'Study', 'Practice questions', 1, '', 0.5],
  ['daily', 'counter', 'Networking', 'Outreach messages', 3, 'messages', 0.5],
  ['daily', 'task', 'Health', 'Exercise', 1, '', 0.5],
  ['weekly', 'counter', 'Career', 'Applications', 5, 'h', 5],
  ['weekly', 'counter', 'Projects', 'Side project', 10, 'h', 10],
  ['weekly', 'task', 'Social', 'Club meeting', 1, '', 1],
]
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
  return `${fmtDay(a, { day: 'numeric', month: 'short' })} – ${fmtDay(b, { day: 'numeric', month: 'short', year: 'numeric' })}`;
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
const ICONS = {
  get routine() { return this.week; },
  today: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 12.3l2.7 2.7L16.2 9.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  buddy: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8.5" cy="8.5" r="3.2" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="16.5" cy="9.5" r="2.6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M2.8 19.5c.6-3.3 2.9-5.2 5.7-5.2s5.1 1.9 5.7 5.2M14.6 14.6c.6-.2 1.2-.3 1.9-.3 2.4 0 4.3 1.6 4.8 4.4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  week: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3.5 12h17M9.2 4.5v15M14.8 4.5v15" stroke="currentColor" stroke-width="1.8"/></svg>',
  apps: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="7" width="17" height="12.5" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M3.5 12.5h17" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  cal: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3.5 10h17M8 3v4M16 3v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><rect x="7" y="13" width="4" height="3" rx="1" fill="currentColor"/></svg>',
  commitments: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6.5h11M9 12h11M9 17.5h11" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="4.5" cy="6.5" r="1.4" fill="currentColor"/><circle cx="4.5" cy="12" r="1.4" fill="currentColor"/><circle cx="4.5" cy="17.5" r="1.4" fill="currentColor"/></svg>',
};

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

// ---------- Background picture (this device only; too big to sync) ----------
const BG_KEY = 'bgpic';
let bg = { blob: null, strength: 0.5 }, bgUrl = null;
async function bgRead() {
  const db = await openDb();
  return new Promise((resolve) => {
    const req = db.transaction(STORE).objectStore(STORE).get(BG_KEY);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
}
async function bgWrite() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(bg, BG_KEY);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
function applyBg() {
  const el = document.getElementById('bgpic');
  if (bgUrl) URL.revokeObjectURL(bgUrl);
  bgUrl = bg.blob ? URL.createObjectURL(bg.blob) : null;
  el.hidden = !bgUrl;
  el.style.backgroundImage = bgUrl ? `url("${bgUrl}")` : '';
  el.style.opacity = bg.strength;
  document.body.classList.toggle('has-bg', !!bgUrl);
}
// Shrinks big photos so they load quickly and fit in storage.
async function shrinkImage(file, max = 2400) {
  const img = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const c = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * k), height: Math.round(img.height * k) });
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return new Promise((resolve) => c.toBlob(resolve, 'image/jpeg', 0.85));
}
function openBgSheet() {
  const pct = Math.round(bg.strength * 100);
  openSheet(`
    <div class="sheet-head"><h3>Background picture</h3></div>
    <div class="menu">
      ${bgUrl ? `<div class="bg-preview" style="background-image:url('${bgUrl}')"></div>
      <label class="f"><span>How visible: <b id="bgPct">${pct}%</b></span>
        <input class="bg-range" id="bgStrength" type="range" min="5" max="100" step="5" value="${pct}"></label>
      <div class="bg-range-row"><span>Faint</span><span>Full picture</span></div>` : '<p class="muted small">Pick a photo to show behind the app. You can then make it more or less see-through.</p>'}
      <button class="btn${bgUrl ? '' : ' primary'}" data-act="bg-pick">${bgUrl ? 'Change picture…' : 'Choose picture…'}</button>
      ${bgUrl ? '<button class="btn warn" data-act="bg-remove">Remove picture</button>' : ''}
      <p class="muted small">Saved on this device only — set it separately on your phone and Mac.</p>
      <button class="btn" data-act="close">Close</button>
    </div>`);
}

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
  buddyAutoTick();
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
    hours: 1, everyDays: 7, date: null, time: null, endTime: null, notes: '', notionUrl: '', links: [], source: null, schedule: false,
    archived: false, order: 0, ...fields,
  };
}
function defaultState() {
  return {
    version: 2,
    commitments: DEFAULT_COMMITMENTS.map(([freq, kind, section, name, target, unit, hours], i) =>
      newCommitment({ freq, kind, section, name, target, unit, hours, step: isHourUnit(unit) ? 0.5 : 1, order: i })),
    weeks: {},
    calendars: { feeds: [] },
    widget: { enabled: false, token: null, lastPush: null, lastError: null },
    sync: freshSync(),
    apps: { items: [], fetchedAt: null, error: null, setup: false },
    trees: [], tests: [], notes: [], buddy: null, testRoutine: null,
    lastBackup: null,
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
  s.trees = (Array.isArray(s.trees) ? s.trees : []).map(normaliseTree);
  s.tests = (Array.isArray(s.tests) ? s.tests : []).map(normaliseTest);
  s.notes = (Array.isArray(s.notes) ? s.notes : []).map(normaliseNote);
  s.buddy = s.buddy && /^[A-Za-z0-9_-]{32,128}$/.test(s.buddy.token || '') ? { token: s.buddy.token, pactId: String(s.buddy.pactId || ''), commitmentId: s.buddy.commitmentId || null } : null;
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
const SNAPSHOT_FIELDS = ['name', 'section', 'freq', 'kind', 'target', 'unit', 'step', 'hours', 'order', 'date', 'time', 'endTime', 'schedule', 'timeUnit', 'everyDays'];
function blankItem(c) {
  const it = { ticks: Array(7).fill(false), counts: Array(7).fill(0), mins: Array(7).fill(null), count: 0, done: false };
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
  if (it.mins[i] != null && dayStarted(it, i)) return it.mins[i] / 60;
  return it.kind === 'task' ? (it.ticks[i] ? it.hours : 0) : counterHours(it, it.counts[i]);
}
const periodDone = (it) => (it.kind === 'task' ? it.done : reached(it.count, it.target));
const periodHours = (it) => (it.kind === 'task' ? (it.done ? it.hours : 0) : counterHours(it, it.count));

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
const isSched = ([, it]) => !!it.schedule;
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
// #/today  #/cal  #/routine (was #/week)  #/apps  #/buddy  #/commitments  #/c/<id>  #/c/<id>/edit  #/new/<freq>
function parseHash() {
  const [a, b, c] = location.hash.replace(/^#\/?/, '').split('/');
  if (a === 'c' && b) return { tab: 'commitments', id: b, edit: c === 'edit' };
  if (a === 'apps') return { tab: 'apps', day: /^\d{4}-\d{2}-\d{2}$/.test(b || '') ? b : null };
  if (a === 'widget') return { tab: 'commitments', page: 'widget' };
  if (a === 'sync') return { tab: 'commitments', page: 'sync' };
  if (a === 'calendar') return { tab: 'commitments', page: b === 'review' ? 'review' : 'calendar' };
  if (a === 'new') return { tab: 'commitments', id: 'new', edit: true, freq: FREQS.includes(b) ? b : 'daily' };
  if (a === 'week') return { tab: 'routine' };
  if (a === 'knowledge') return b === 'new' || c === 'edit' ? { tab: 'routine', page: 'tree-edit', treeId: b } : { tab: 'routine', page: 'knowledge', focus: b || null };
  if (a === 'tests') return { tab: 'routine', page: 'tests', testId: b || null };
  if (a === 'board') return { tab: 'cal', page: 'board' };
  if (a === 'join') return { tab: 'buddy', invite: /^[a-z0-9]{10}$/i.test(b || '') ? b.toLowerCase() : '' };
  return { tab: ['today', 'routine', 'cal', 'buddy', 'commitments'].includes(a) ? a : 'today' };
}
// The app always opens on Today (an invite link still opens its page).
if (!/^#\/join\//.test(location.hash) && location.hash && location.hash !== '#/today') history.replaceState(null, '', '#/today');
let route = parseHash();
window.addEventListener('hashchange', () => {
  route = parseHash();
  treeDraft = null;
  if (route.tab === 'buddy') refreshBuddy();
  if (route.page === 'knowledge' && route.focus) focusTree(route.focus);
  if (route.tab === 'apps') {
    if (route.day) { appsDay = route.day; appsMonth = route.day.slice(0, 7); }
    refreshApps();
  }
  closeSheet();
  render();
  window.scrollTo(0, 0);
});
function goBack(fallback = '#/today') {
  if (history.length > 1) history.back(); else location.hash = fallback;
}

// ---------- Rendering ----------
const $app = document.getElementById('app');
const $sheet = document.getElementById('sheet');

function render() {
  if (!state) return; // still loading saved data
  let html;
  if (route.page === 'sync') html = syncPageHtml();
  else if (route.page === 'widget') html = widgetPageHtml();
  else if (route.page === 'calendar') html = calendarPageHtml();
  else if (route.page === 'review') html = reviewPageHtml();
  else if (route.page === 'knowledge') html = knowledgePageHtml();
  else if (route.page === 'tree-edit') html = treeEditHtml();
  else if (route.page === 'tests') html = testsPageHtml();
  else if (route.page === 'board') html = boardPageHtml();
  else if (route.id && route.edit) html = editPageHtml();
  else if (route.id) html = detailPageHtml(route.id);
  else if (route.tab === 'routine') html = weekTabHtml();
  else if (route.tab === 'buddy') html = buddyTabHtml();
  else if (route.tab === 'cal') html = calendarTabHtml();
  else if (route.tab === 'apps') html = appsTabHtml();
  else if (route.tab === 'commitments') html = commitmentsTabHtml();
  else html = todayTabHtml();
  $app.dataset.tab = route.id || route.page ? 'page' : route.tab;
  $app.dataset.page = route.page || '';
  $app.innerHTML = html + tabBarHtml() + sideNavHtml();
  fillSideSections();
  if (route.page === 'knowledge') initMaps();
  if (route.page === 'board') layoutBoard();
}

// ---------- Side navigation (wide screens, e.g. the Mac app) ----------
// The main pages, plus the current page's sections as jump links (highlighted while scrolling).
// Phones keep the bottom tab bar instead (CSS switches at 900px).
// [route, full name, short name for the phone tab bar]
const NAV_PAGES = [['today', 'Today', 'Today'], ['cal', 'Calendar', 'Calendar'], ['routine', 'Routine', 'Routine'],
  ['apps', 'Applications', 'Apps'], ['buddy', 'Work Buddy', 'Buddy'], ['commitments', 'All commitments', 'All']];
function sideNavHtml() {
  const extra = [['#/calendar', 'Calendars'], ['#/sync', `Sync${state.sync.enabled ? ' · on' : ''}`], ['#/widget', 'Phone widget']];
  return `<aside class="sidenav" aria-label="Navigation">
    <div class="sn-brand"><img src="icons/icon-192.png" alt=""><b>I Commit!</b></div>
    <nav class="sn-main">${NAV_PAGES.map(([t, label]) => `
      <a href="#/${t}" class="sn-page ${route.tab === t ? 'on' : ''}" ${route.tab === t && !route.id && !route.page ? 'aria-current="page"' : ''}>${ICONS[t]}<span>${label}</span></a>
      ${route.tab === t ? '<div class="sn-sections"></div>' : ''}`).join('')}</nav>
    <div class="sn-extra">
      ${extra.map(([href, label]) => `<a href="${href}" class="${location.hash === href ? 'on' : ''}">${label}</a>`).join('')}
      <button data-act="export-xlsx">Export to Excel</button>
    </div>
  </aside>`;
}
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
  if (d.dataset && d.dataset.tnode) {
    const id = d.dataset.tnode, top = d.dataset.depth === '0';
    if (top) { if (d.open) treeOpen.delete(`-${id}`); else treeOpen.add(`-${id}`); } else if (d.open) treeOpen.add(id); else treeOpen.delete(id);
    return;
  }
  if (d.dataset && d.dataset.fold) { if (d.open) appsExpanded.add(`open:${d.dataset.fold}`); else appsExpanded.delete(`open:${d.dataset.fold}`); }
}, true);
let scrollTick = false;
window.addEventListener('scroll', () => {
  if (scrollTick) return;
  scrollTick = true;
  requestAnimationFrame(() => { scrollTick = false; highlightSection(); });
}, { passive: true });

function tabBarHtml() {
  const tab = (t, label) => `<a href="#/${t}" class="${route.tab === t ? 'on' : ''}" ${route.tab === t && !route.id ? 'aria-current="page"' : ''}>${ICONS[t]}<span>${label}</span></a>`;
  return `<nav class="tabbar">${NAV_PAGES.map(([t, , short]) => tab(t, short)).join('')}</nav>`;
}

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
      ${stageUrlById(id) ? `<a class="mini-btn go-link" href="${escapeHtml(stageUrlById(id))}" target="_blank" rel="noopener" title="Open link">↗</a>` : stepper}
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

// ---------- Today tab ----------
// Routine (daily, weekly, periodically), then Today only (one-off tasks).
function todayDailyRow(wk, ti, id, it, sub) {
  const key = `${wk}:${id}:${ti}`;
  const control = it.kind === 'task'
    ? `<button class="big cell ${cellClass(it, ti)}" data-cell="${key}" aria-label="${escapeHtml(cellLabel(it, ti))}"><span class="box">${cellInner(it, ti)}</span></button>`
    : `<div class="ctr">
         <button class="ctr-minus" data-act="cdec" data-key="${key}" aria-label="Minus ${it.step}" ${it.counts[ti] <= 0 ? 'disabled' : ''}>−</button>
         <button class="big cell ${cellClass(it, ti)}" data-cell="${key}" aria-label="${escapeHtml(cellLabel(it, ti))}">
           <span class="box wide">${round2(it.counts[ti])}<small>/${round2(it.target)}</small></span></button>
       </div>`;
  return `
    <div class="trow ${it.archived ? 'archived' : ''}">
      <a class="name" href="#/c/${id}"><div class="n">${escapeHtml(it.name)}</div><div class="sub">${sub}</div></a>
      ${control}
    </div>`;
}
function todayTabHtml() {
  const wk = currentWeekKey();
  const w = getWeek(wk);
  const ti = todayIndex(wk);
  const ds = dayStats(w, ti);
  const ws = weekStats(w);
  const iso = todayISO();

  let daily = '';
  for (const [section, entries] of groupBySection(itemsOf(w, 'daily'))) {
    daily += `<div class="sec">${escapeHtml(section)}</div>`;
    for (const [id, it] of entries) {
      const daysDone = it.ticks.filter((_, i) => dayDone(it, i)).length;
      daily += todayDailyRow(wk, ti, id, it, `${targetLabel(it)} · ${daysDone}/7 this week`) + routineTreeLines(id);
      if (id === state.testRoutine) {
        const n = state.tests.filter((x) => x.date === iso).length;
        daily += `<a class="trow-extra" href="#/tests">${n ? `${n} result${n === 1 ? '' : 's'} logged today · ` : ''}+ Log a result</a>`;
      }
    }
  }
  const weekly = itemsOf(w, 'weekly');
  const periodic = itemsOf(w, 'periodic');
  const dueNow = periodic.filter(([id, it]) => periodicOn(id, it, iso));
  const notDue = periodic.filter(([id, it]) => !periodicOn(id, it, iso));
  const onceToday = itemsOf(w, 'once').filter(isTask).filter(([, it]) => it.date === iso);
  const onceLater = itemsOf(w, 'once').filter(isTask).filter(([, it]) => it.date > iso);

  const sub = (title, body, extra = '') => `<div class="subhead"><h3>${title}</h3>${extra}</div>${body}`;
  const routine = [
    sub('Daily', daily || '<p class="muted pad small">No daily routines yet. <a href="#/new/daily">Add one</a></p>', '<span class="hint">Tap to log · hold for minutes</span>'),
    sub('Weekly', weekly.length ? weekly.map(([id, it]) => periodRowHtml(wk, id, it)).join('') : '<p class="muted pad small">No weekly routines yet. <a href="#/new/weekly">Add one</a></p>'),
    sub('Periodic',
      (dueNow.map(([id, it]) => todayDailyRow(wk, ti, id, it, `${fmtPlan(it)} · every ${everyLabel(it.everyDays || 7)} · ${periodicSub(id, it)}`)).join('') ||
        (periodic.length ? '<p class="muted pad small">Nothing due today.</p>' : '<p class="muted pad small">Things you do every few days or weeks, e.g. laundry. <a href="#/new/periodic">Add one</a></p>')) +
      (notDue.length ? `<div class="later">${notDue.map(([id, it]) => `<a href="#/c/${id}">${escapeHtml(it.name)} <small>${periodicSub(id, it)}</small></a>`).join('')}</div>` : '')),
  ].join('');

  return `
    <header class="top">
      ${topBar({ label: 'Today', title: fmtDay(startOfToday(), { weekday: 'long', day: 'numeric', month: 'short' }), right: menuBtn })}
      <div class="stats">
        <div class="stat"><b>${ds.done}<small>/${ds.total}</small></b><span>done today</span></div>
        <div class="stat right"><b>${fmtH(ds.actual)} <small>/ ${fmtH(ds.planned)}</small></b><span>today actual / planned</span></div>
      </div>
      <div class="hbar"><i style="width:${ds.planned ? Math.min(100, (ds.actual / ds.planned) * 100) : 0}%"></i></div>
      <div class="pace"><a href="#/routine">This week: ${fmtH(ws.actual)} of ${fmtH(ws.planned)} · ${Math.round(ws.pct * 100)}% ticked ›</a></div>
      ${buddyTodayLine()}
    </header>
    ${reviewBannerHtml()}
    <section class="card" data-section="Routine">
      <div class="card-head"><h2>Routine</h2><a class="txt-btn" href="#/routine">Record ›</a></div>
      ${routine}
    </section>
    <section class="card" data-section="Today only">
      <div class="card-head"><h2>Today only</h2><a class="txt-btn" href="#/new/once">+ Add</a></div>
      ${onceToday.length ? onceToday.map(([id, it]) => periodRowHtml(wk, id, it)).join('') : notesOn(iso).length ? '' : '<p class="muted pad small">No one-off tasks today.</p>'}
      ${notesOn(iso).length ? `<div class="dpills today-notes">${notesOn(iso).map((n) => notePillHtml(n, iso)).join('')}</div>` : ''}
    </section>
    ${appsTodayCardHtml()}
    ${tbcTodayHtml()}
    ${onceLater.length ? `<section class="card"><div class="card-head"><h2>Coming up this week</h2></div>
      ${onceLater.map(([id, it]) => periodRowHtml(wk, id, it, { showDate: true })).join('')}</section>` : ''}`;
}

// One-offs whose date is still to be confirmed (shown folded on Today).
function tbcTodayHtml() {
  const list = state.commitments.filter((c) => c.freq === 'once' && !c.date && !c.archived);
  if (!list.length) return '';
  return `<details class="card fold"><summary>Date to be confirmed (${list.length})</summary>
    ${list.map((c) => `<a class="crow" href="#/c/${c.id}"><div class="ctext"><div class="n">${escapeHtml(c.name)}</div>
      <div class="sub">${escapeHtml(c.section)} · tap to set a date</div></div><span class="chev">›</span></a>`).join('')}</details>`;
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
      ${routineNav('record')}
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
  const synced = new Set(state.commitments.filter((c) => c.source).map((c) => c.id));
  const once = w ? itemsOf(w, 'once') : [];
  const mine = once.filter(([id, it]) => !synced.has(id) && !it.schedule);   // your own one-offs
  const fromCal = once.filter(([id, it]) => synced.has(id) || it.schedule);  // synced calendars

  // --- 1. My plan: routines, your own one-offs and application dates, day by day.
  const appsByDay = {};
  for (const e of appEvents()) (appsByDay[e.date] = appsByDay[e.date] || []).push(e);
  const routineOf = (d) => !w ? [] : [...itemsOf(w, 'daily'),
    ...itemsOf(w, 'periodic').filter(([id, it]) => periodicOn(id, it, d))];
  const pillState = (done, d) => (done ? 'done' : d < today ? 'missed' : 'pending');
  const planCol = (d, i) => {
    const routine = routineOf(d).map(([id, it]) => {
      const done = dayDone(it, i);
      const prog = it.kind === 'counter' ? `<small>${round2(it.counts[i])}/${round2(it.target)}</small>` : it.freq === 'periodic' ? '<small>↻</small>' : '';
      return `<button class="dpill ${pillState(done, d)}" data-cell="${wk}:${id}:${i}" aria-label="${escapeHtml(cellLabel(it, i))}">
        <span class="dbox">${done ? CHECK : ''}</span><span class="dname">${escapeHtml(it.name)}</span>${prog}</button>`;
    }).join('');
    const ones = mine.filter(([, it]) => it.date === d).map(([id, it]) => {
      const done = periodDone(it);
      return `<div class="dpill once ${pillState(done, d)}">
        <button class="dbox" data-act="pdone" data-wk="${wk}" data-id="${id}" aria-label="${escapeHtml(it.name)} done" aria-pressed="${done}">${done ? CHECK : ''}</button>
        <a class="dname" href="#/c/${id}">${it.time ? `<small class="dtime">${escapeHtml(it.time)}</small> ` : ''}${escapeHtml(it.name)}</a></div>`;
    }).join('');
    const apps = (appsByDay[d] || []).map((e) => `<a class="chip-app k-${e.kind}" href="#/apps/${d}" title="${escapeHtml(`${e.a.company} ${APP_EVENT_LABEL[e.kind]}`)}">${escapeHtml(e.a.company)} ${e.kind === 'open' ? 'opens' : e.kind === 'close' ? 'closes' : 'due'}</a>`).join('');
    const notes = notesOn(d).map((n) => notePillHtml(n, d)).join('');
    const body = routine + ones + notes + apps;
    return `<div class="pcol ${d === calViewDay ? 'sel' : ''} ${d === today ? 'today' : ''}">
      ${routine ? `<div class="dpills">${routine}</div>` : ''}
      ${ones ? `<div class="dpills">${ones}</div>` : ''}
      ${notes ? `<div class="dpills">${notes}</div>` : ''}
      ${apps ? `<div class="papps">${apps}</div>` : ''}
      ${body ? '' : '<p class="muted small">Nothing planned.</p>'}</div>`;
  };

  // --- 2. Synced calendars: a time grid of events imported from your calendars.
  const timed = {}, untimed = {};
  for (const d of days) { timed[d] = []; untimed[d] = []; }
  for (const [id, it] of fromCal) {
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
    const n = timed[d].length + untimed[d].length + mine.filter(([, it]) => it.date === d).length;
    return `<button class="cday ${d === calViewDay ? 'sel' : ''} ${d === today ? 'today' : ''}" data-act="cal-day" data-date="${d}">
      <span>${DAY_NAMES[i][0]}</span><b>${parseISO(d).getDate()}</b><i class="${n ? 'dot' : ''}"></i></button>`;
  }).join('');

  const cols = days.map((d) => {
    const evs = layoutDay(timed[d]).map((e) => {
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
      ${untimed[d].map(([id, it]) => { const sched = !!it.schedule; const done = !sched && periodDone(it); return `<div class="cuntimed ${sched ? 'sched' : ''} ${done ? 'done' : ''}" data-open="#/c/${id}" style="--ev:${eventColor(id)}">
        ${sched ? '' : `<button class="cev-chk" data-act="pdone" data-wk="${wk}" data-id="${id}" aria-label="${escapeHtml(it.name)} done">${done ? CHECK : ''}</button>`}
        <span>${escapeHtml(it.name)}</span></div>`; }).join('')}
    </div>`).join('');

  const heads = (cls) => days.map((d, i) => `<button class="chead ${cls} ${d === today ? 'today' : ''} ${d === calViewDay ? 'sel' : ''}" data-act="cal-day" data-date="${d}"><span>${DAY_NAMES[i]}</span><b>${parseISO(d).getDate()}</b></button>`).join('');
  const isThisWeek = wk === currentWeekKey();
  const dayName = calViewDay === today ? 'Today' : fmtShort(calViewDay);

  return `
    <header class="top">
      ${topBar({
        left: '<button class="icon-btn" data-act="cal-prev" aria-label="Previous week">‹</button>',
        label: isThisWeek ? 'Calendar' : 'Calendar · tap for this week',
        title: weekRange(wk),
        titleAct: `data-act="cal-today" ${isThisWeek && calViewDay === today ? 'disabled' : ''}`,
        right: '<button class="icon-btn" data-act="cal-next" aria-label="Next week">›</button>' + menuBtn,
      })}
      ${calNav('cal')}
      <div class="cstrip">${strip}</div>
    </header>
    <section class="card cal" data-section="My plan">
      <div class="card-head"><h2>My plan</h2><span class="hint"><span class="phone-only">${dayName} · </span>routines, your tasks, pinned notes, applications</span></div>
      <div class="pgrid-head">${heads('')}</div>
      <div class="pcols">${days.map(planCol).join('')}</div>
    </section>
    <section class="card cal" data-section="Synced calendars">
      <div class="card-head"><h2>Synced calendars</h2><a class="txt-btn" href="#/calendar">Calendars ›</a></div>
      <div class="cgrid-head"><div class="ctimes-gap"></div>${heads('')}</div>
      ${hasAllDay ? `<div class="call-row"><div class="ctimes-gap small muted">all day</div>${allDay}</div>` : ''}
      <div class="cgrid">
        <div class="ctimes">${hours.map((h) => `<div style="height:${HOUR_PX}px">${pad(h)}:00</div>`).join('')}</div>
        <div class="ccols" style="height:${gridH}px;background-size:100% ${HOUR_PX}px">${cols}</div>
      </div>
      ${state.calendars.feeds.length ? (all.length || hasAllDay ? '' : '<p class="muted small pad center">No calendar events this week.</p>')
        : `<p class="muted small pad center">No calendar connected yet. Add one in <a href="#/calendar">All commitments → Calendars</a>.</p>`}
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
  }
  return out;
}
const APP_EVENT_LABEL = { open: 'opens', close: 'closes', next: 'next step due' };

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
    }
  } catch {
    state.apps.error = 'Offline. Showing the last copy from Notion.';
  } finally {
    appsLoading = false;
    writeState().catch(() => {});
    if (!route.edit && !sheetCtx && ['apps', 'cal', 'today'].includes(route.tab) && !route.id && !route.page) render();
  }
}

function appRowHtml(a) {
  const phase = appPhase(a);
  const dates = [
    a.open ? `${a.open > todayISO() ? 'Opens' : 'Opened'} ${fmtDayShort(a.open)}` : '',
    a.close ? `${a.close >= todayISO() ? 'Closes' : 'Closed'} ${fmtDayShort(a.close)}${a.close >= todayISO() ? ` (${relDay(a.close)})` : ''}` : '',
    a.next && phase === 'inprogress' ? `Next step ${fmtDayShort(a.next)} (${relDay(a.next)})` : '',
  ].filter(Boolean).join(' · ');
  const urgent = a.close && phase === 'open' && daysUntil(a.close) <= 7 && daysUntil(a.close) >= 0;
  const notion = a.notionUrl ? notionAppUrl(a.notionUrl) : '';
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
        ${checklist}
      </div>
      <div class="abtns">
        ${a.url ? `<a class="mini-btn primary-mini" href="${escapeHtml(cleanUrl(a.url))}" target="_blank" rel="noopener">Apply ↗</a>` : ''}
        ${a.done ? '' : `<button class="mini-btn" data-act="app-followup" data-id="${a.id}">+ Follow-up</button>`}
        ${todayTaskFor(a.id)
          ? `<button class="mini-btn done-on" data-act="app-today" data-id="${a.id}" aria-pressed="true" title="Tap again to remove from today">✓ On today</button>`
          : (a.done ? '' : `<button class="mini-btn" data-act="app-today" data-id="${a.id}" aria-pressed="false">+ Today</button>`)}
        <button class="mini-btn ${a.done ? 'done-on' : ''}" data-act="app-done" data-id="${a.id}" aria-pressed="${!!a.done}">${a.done ? '✓ Done' : 'Done'}</button>

        ${notion ? `<a class="mini-btn notion-mini" title="Open in Notion" aria-label="Open in Notion" href="${escapeHtml(notion)}" ${notion === a.notionUrl ? 'target="_blank" rel="noopener"' : ''}>N</a>` : ''}
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
    const dots = ['open', 'close', 'next'].filter((k) => evs.some((e) => e.kind === k)).map((k) => `<i class="dot-${k}"></i>`).join('');
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
      <div class="mlegend"><span><i class="dot-open"></i>Opens</span><span><i class="dot-close"></i>Deadline</span><span><i class="dot-next"></i>Next step</span></div>
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

// Small "closing this week" card for Today.
function appsTodayCardHtml() {
  if (!state.apps.items.length) return '';
  const soon = appEvents().filter((e) => e.kind !== 'open' && daysUntil(e.date) >= 0 && daysUntil(e.date) <= 7)
    .sort((x, y) => x.date.localeCompare(y.date)).slice(0, 4);
  if (!soon.length) return '';
  return `<section class="card"><div class="card-head"><h2>Applications</h2><a class="txt-btn" href="#/apps">All ›</a></div>
    ${soon.map((e) => `<div class="srow" data-open="#/apps/${e.date}"><span class="stime ${daysUntil(e.date) <= 2 ? 'err' : ''}">${relDay(e.date)}</span>
      <span class="sname">${escapeHtml(e.a.company)} ${APP_EVENT_LABEL[e.kind]}<small>${escapeHtml(e.a.programme || '')}</small></span></div>`).join('')}</section>`;
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
      ${topBar({ left: `<button class="txt-btn" data-act="reorder">${reorderMode ? 'Done' : 'Reorder'}</button>`, label: `${state.commitments.filter((c) => !c.archived).length} active`, title: 'All commitments', right: menuBtn })}
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

// ---------- Routine sub-pages: Record · Knowledge · Tests ----------
function routineNav(on) {
  const a = (href, key, label) => `<a href="${href}" class="${on === key ? 'on' : ''}" ${on === key ? 'aria-current="page"' : ''}>${label}</a>`;
  return `<nav class="subnav">${a('#/routine', 'record', 'Record')}${a('#/knowledge', 'knowledge', 'Knowledge')}${a('#/tests', 'tests', 'Tests')}</nav>`;
}
const routineChoices = () => state.commitments.filter((c) => !c.archived && c.freq !== 'once').sort((a, b) => a.order - b.order);
const routineSelect = (name, cur, empty = 'None') => `<select name="${name}"><option value="">${empty}</option>${routineChoices()
  .map((c) => `<option value="${c.id}" ${c.id === cur ? 'selected' : ''}>${escapeHtml(c.name)} · ${FREQ_LABEL[c.freq]}</option>`).join('')}</select>`;
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied'); }
  catch { window.prompt('Copy this:', text); }
}

// ---------- Knowledge trees ----------
// A course or self-study plan as a tree of topics; light up each topic as you learn it.
// The outline is drafted outside the app (e.g. Claude reads the course page), checked, then pasted in.
// Node: { id, t: title, k: children, lit, at: date lit }.
function parseOutline(text) {
  const root = [];
  const stack = [{ indent: -1, kids: root }];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/\t/g, '  ');
    const t = line.trim().replace(/^([-*•+]|\d+[.)]|#+)\s+/, '').replace(/\*\*/g, '').trim();
    if (!t) continue;
    const indent = line.match(/^ */)[0].length;
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
    const node = { id: uid(), t: t.slice(0, 140), k: [] };
    stack[stack.length - 1].kids.push(node);
    stack.push({ indent, kids: node.k });
  }
  return root;
}
const outlineOf = (nodes, depth = 0) => nodes.map((n) =>
  `${'  '.repeat(depth)}${n.t}${n.refs && n.refs.length ? ` | ${n.refs.join(', ')}` : ''}\n${outlineOf(n.k, depth + 1)}`).join('');
const treeLeaves = (nodes) => nodes.flatMap((n) => (n.k.length ? treeLeaves(n.k) : [n]));
// A map skill that covers course topics counts as its topics (e.g. 2 of 3 lit); anything else counts as one.
const leafStat = (n) => (n.cov ? n.cov : { lit: n.lit ? 1 : 0, total: 1 });
function treeProgress(nodes) {
  const leaves = treeLeaves(nodes);
  let lit = 0, total = 0;
  for (const n of leaves) { const st = leafStat(n); lit += st.lit; total += st.total; }
  const weekAgo = addDaysISO(todayISO(), -6);
  return { lit, total, pct: total ? lit / total : 0, week: leaves.filter((n) => n.lit && n.at >= weekAgo).length };
}

// ---------- Simplified map ----------
// Separate from the course list: a compact outline of the core skills (e.g. 8–25 nodes). A skill line
// can end with " | topic, topic" naming the course topics it covers; it then lights up as those are ticked.
function parseMapOutline(text) {
  const nodes = parseOutline(text);
  const split = (ns) => ns.forEach((n) => {
    const i = n.t.indexOf('|');
    if (i >= 0) { n.refs = n.t.slice(i + 1).split(/[,;]/).map((r) => r.trim()).filter(Boolean).slice(0, 30); n.t = n.t.slice(0, i).trim() || 'Skill'; }
    split(n.k);
  });
  split(nodes);
  return nodes;
}
// Course topics a reference points at: the leaves under the matching course node (exact title first, then prefix).
function resolveRefs(course, refs) {
  const all = [];
  const walk = (ns) => ns.forEach((n) => { all.push(n); walk(n.k); });
  walk(course);
  const leaves = new Map(), missing = [];
  for (const r of refs || []) {
    const q = r.toLowerCase();
    const hit = all.find((n) => n.t.toLowerCase() === q) || all.find((n) => n.t.toLowerCase().startsWith(q)) || all.find((n) => n.t.toLowerCase().includes(q));
    if (!hit) { missing.push(r); continue; }
    for (const l of hit.k.length ? treeLeaves(hit.k) : [hit]) leaves.set(l.id, l);
  }
  return { leaves: [...leaves.values()], missing };
}
// The map as displayed: a copy where covering skills carry their course progress.
function deriveMap(course, map) {
  const missing = [];
  const copy = (ns) => ns.map((n) => {
    const d = { ...n, k: copy(n.k) };
    if (!n.k.length && n.refs && n.refs.length) {
      const r = resolveRefs(course, n.refs);
      missing.push(...r.missing);
      if (r.leaves.length) {
        const lit = r.leaves.filter((l) => l.lit).length;
        d.cov = { lit, total: r.leaves.length };
        d.cover = r.leaves.map((l) => l.id);
        d.lit = lit === r.leaves.length;
      }
    }
    return d;
  });
  return { nodes: copy(map || []), missing };
}
function findNode(nodes, id) {
  for (const n of nodes) { if (n.id === id) return n; const f = findNode(n.k, id); if (f) return f; }
  return null;
}
// Keeps what was already lit when an outline is edited (matched by the path of titles).
function carryLit(fresh, old) {
  const lit = new Map();
  const walk = (ns, path) => ns.forEach((n) => { const p = `${path}/${n.t.toLowerCase()}`; if (n.lit) lit.set(p, n.at); walk(n.k, p); });
  walk(old, '');
  const apply = (ns, path) => ns.forEach((n) => { const p = `${path}/${n.t.toLowerCase()}`; if (lit.has(p) && !n.k.length) { n.lit = true; n.at = lit.get(p); } apply(n.k, p); });
  apply(fresh, '');
  return fresh;
}
function normaliseNodes(ns, depth = 0) {
  if (!Array.isArray(ns) || depth > 8) return [];
  return ns.filter((n) => n && n.t).map((n) => ({ id: String(n.id || uid()), t: String(n.t).slice(0, 140), k: normaliseNodes(n.k, depth + 1),
    ...(Array.isArray(n.refs) && n.refs.length ? { refs: n.refs.map(String).slice(0, 30) } : {}),
    ...(n.lit ? { lit: true, at: /^\d{4}-\d{2}-\d{2}$/.test(n.at || '') ? n.at : todayISO() } : {}) }));
}
const normaliseTree = (t) => ({ id: String(t.id || uid()), name: String(t.name || 'Knowledge tree'), source: String(t.source || ''),
  commitmentId: t.commitmentId || null, created: t.created || todayISO(), nodes: normaliseNodes(t.nodes), map: normaliseNodes(t.map) });

// Knowledge map: the tree drawn left to right as dots joined by curves. Tap a topic to light it;
// tap a branch dot to fold or unfold it. Lit topics glow and light the links leading to them.
// Folding: at first only the big branches show, with the top one open in full. Tapping a branch
// dot opens or closes it, and that choice is kept for this session.
const foldState = new Map(); // branch id -> true (closed) / false (open)
const isFolded = (n, depth, i) => n.k.length > 0 && (foldState.has(n.id) ? foldState.get(n.id) : depth === 1 && i > 0);
let pendingFocusNode = null; // branch just opened: scroll it into view
let treeView = 'map';       // 'map' or 'list'
const K_ROW = 30, K_COL = 132, K_PAD = 18;
const clip = (t, n) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
const narrowMap = () => window.innerWidth < 640;
function leafDot(n) {
  const glow = n.lit ? '<circle class="kglow" r="11"/>' : '';
  if (!n.cov) return `${glow}<circle class="kdotc" r="6"/>`;
  const c = 2 * Math.PI * 7;
  return `${glow}<circle class="kdotc" r="5"/><circle class="kr-track thin" r="7"/><circle class="kr-fill thin" r="7" stroke-dasharray="${((n.cov.lit / n.cov.total) * c).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90)"/>`;
}
const leafAct = (tree, n) => `data-act="${n.cover ? 'tree-cover' : 'tree-lit'}" data-tree="${tree.id}" data-node="${n.id}" ${tree.isMap ? 'data-map="1"' : ''} role="button" tabindex="0" aria-pressed="${!!n.lit}"`;
function treeSvg(tree, nodes, { interactive = true, narrow = narrowMap() } = {}) {
  if (narrow) return treeRowsSvg(tree, nodes, { interactive });
  // Columns stretch to the card's width so the map uses the space it has.
  const depthOf = (ns, d = 1) => (ns.length ? 1 + Math.max(...ns.map((n, i) => (interactive && isFolded(n, d, i) ? 0 : depthOf(n.k, d + 1)))) : 0);
  const maxDepth = depthOf(nodes);
  const avail = Math.max(520, Math.min(($app.clientWidth || 1000) - 70, 1500));
  const col = Math.max(150, Math.min(300, (avail - K_PAD * 2 - 230) / Math.max(1, maxDepth)));
  const ROW = 36, CH = 7.4; // row height and approximate width of a character (13.5px text)
  const items = [], links = [];
  let y = K_PAD + 24;
  const place = (n, depth, i) => {
    const leaf = !n.k.length;
    const folded = !leaf && interactive && isFolded(n, depth, i);
    const it = { n, depth, leaf, folded, p: leaf ? null : treeProgress(n.k), x: K_PAD + depth * col };
    if (leaf) { it.y = y; y += ROW; }
    else if (folded) { y += ROW * 0.45; it.y = y; y += ROW; } // room for its label above
    else {
      y += ROW * 0.45; // room for the branch's label above its dot
      const kids = n.k.map((c, j) => place(c, depth + 1, j));
      it.y = (kids[0].y + kids[kids.length - 1].y) / 2;
      for (const c of kids) links.push({ a: it, b: c });
      y += ROW * 0.25;
    }
    items.push(it);
    return it;
  };
  const root = { n: { id: 'root', t: tree.name || 'Tree', k: nodes }, depth: 0, leaf: false, p: treeProgress(nodes), x: K_PAD + 6, root: true };
  const kids = nodes.map((c, i) => place(c, 1, i));
  if (!kids.length) return '';
  const h = y + K_PAD + (interactive ? 180 : 0); // space below the last branch so it can scroll clear of the thumbnail
  root.y = (kids[0].y + kids[kids.length - 1].y) / 2;
  for (const c of kids) links.push({ a: root, b: c });
  const w = Math.max(avail, K_PAD * 2 + maxDepth * col + 260);
  const litness = (it) => (it.leaf ? (it.n.lit ? 1 : 0) : it.p.pct);
  const path = ({ a, b }) => { const mx = (a.x + b.x) / 2; return `M${a.x},${a.y} C${mx},${a.y} ${mx},${b.y} ${b.x},${b.y}`; };
  const back = ({ a, b }) => { const mx = (a.x + b.x) / 2; return `M${b.x},${b.y} C${mx},${b.y} ${mx},${a.y} ${a.x},${a.y}`; };
  const ring = (it, r) => { const c = 2 * Math.PI * r; return `<circle class="kr-track" r="${r}"/><circle class="kr-fill" r="${r}" stroke-dasharray="${(it.p.pct * c).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90)"/>`; };
  const nodeSvg = (it) => {
    const t = escapeHtml(it.n.t);
    if (it.leaf) {
      const chars = Math.max(10, Math.floor((w - it.x - 40) / CH));
      return `<g class="kn leaf ${it.n.lit ? 'lit' : ''} ${it.n.cov ? 'cov' : ''}" data-nid="${it.n.id}" transform="translate(${it.x},${it.y})" ${interactive ? leafAct(tree, it.n) : ''}>
        <title>${t}${it.n.cov ? ` · ${it.n.cov.lit}/${it.n.cov.total} course topics` : ''}</title><rect class="khit" x="-12" y="-15" width="${Math.min(it.n.t.length, chars) * CH + 34}" height="30" rx="9"/>
        ${leafDot(it.n)}<text x="15" y="5">${escapeHtml(clip(it.n.t, chars))}${it.n.cov ? ` <tspan class="kcount">${it.n.cov.lit}/${it.n.cov.total}</tspan>` : ''}</text></g>`;
    }
    const big = it.root ? 16 : 10;
    const done = it.p.total > 0 && it.p.lit === it.p.total;
    const chars = it.root ? 26 : Math.max(12, Math.floor((col - 16) / 7.6));
    return `<g class="kn branch ${done ? 'lit' : ''} ${it.folded ? 'folded' : ''} ${it.root ? 'root' : ''}" data-nid="${it.n.id}" transform="translate(${it.x},${it.y})"
        ${interactive && !it.root ? `data-act="tree-fold" data-node="${it.n.id}" role="button" tabindex="0" aria-expanded="${!it.folded}"` : ''}>
      <title>${t} · ${it.p.lit}/${it.p.total}</title>
      ${done ? `<circle class="kglow" r="${big + 6}"/>` : ''}<circle class="kcore" r="${big - 3}"/>${ring(it, big)}
      ${it.root ? `<text class="kpct" y="4.5">${Math.round(it.p.pct * 100)}</text>` : it.folded ? `<text class="kplus" y="5">+</text>` : ''}
      <text class="klabel" x="${it.root ? -12 : -8}" y="${it.root ? big + 22 : -(big + 8)}">${escapeHtml(clip(it.n.t, chars))}</text>
      ${it.folded ? `<text class="kcount" x="${big + 7}" y="5">${it.p.lit}/${it.p.total}</text>` : ''}</g>`;
  };
  // The gradient is in page units: a gradient sized to each line's own box disappears on perfectly straight lines.
  const gid = `klink-${tree.id}`;
  const W = Math.ceil(w), H = Math.ceil(h);
  const linkPaths = links.map((l) => { const v = litness(l.b); return `<path d="${path(l)}" data-from="${l.a.n.id}" data-to="${l.b.n.id}" data-back="${back(l)}" class="${v > 0 ? 'on' : ''}" ${v > 0 ? `style="stroke:url(#${gid});opacity:${(0.35 + 0.65 * v).toFixed(2)}"` : ''}/>`; }).join('');
  const all = [root, ...items];
  // Thumbnail keeps the map's shape: up to 200 wide and 220 tall.
  const mw = Math.round(H / W > 1.1 ? Math.max(70, (220 * W) / H) : 200), mh = Math.round(Math.max(60, Math.min(220, (mw * H) / W)));
  const mini = interactive ? `<div class="kmini" hidden aria-hidden="true" style="width:${mw}px;height:${mh}px"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      ${links.map((l) => `<path d="${path(l)}" class="${litness(l.b) > 0 ? 'on' : ''}"/>`).join('')}
      ${all.map((it) => `<circle cx="${it.x}" cy="${it.y}" r="${it.root ? 22 : it.leaf ? 9 : 14}" class="${(it.leaf ? it.n.lit : it.p.lit === it.p.total && it.p.total) ? 'on' : ''}"/>`).join('')}
    </svg><i class="kmini-view"></i><button class="kmini-x" data-act="mini-hide" aria-label="Hide thumbnail">×</button></div>
    <button class="kmini-show" data-act="mini-show" hidden>Show thumbnail</button>` : '';
  return `<div class="kmap-wrap"><div class="kmap wide" ${interactive ? `data-tree="${tree.id}"` : ''}><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" data-rooty="${root.y}" role="img" aria-label="${escapeHtml(tree.name || 'Knowledge tree')}">
    <defs><linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${W}" y2="0"><stop offset="0" stop-color="#fa8072"/><stop offset="1" stop-color="#ffc93c"/></linearGradient></defs>
    <g class="klinks">${linkPaths}</g>
    ${nodeSvg(root)}${items.map(nodeSvg).join('')}
  </svg></div>${mini}</div>`;
}
// Big maps scroll inside their card; a thumbnail in the corner shows where you are, and
// tapping or dragging it moves there. Scroll positions survive re-rendering (e.g. after a tap).
const mapScroll = new Map();
let miniOff = false;
try { miniOff = localStorage.getItem('kmini') === 'off'; } catch {}
function setMini(off) {
  miniOff = off;
  try { localStorage.setItem('kmini', off ? 'off' : 'on'); } catch {}
  initMaps();
}
function initMaps() {
  for (const box of $app.querySelectorAll('.kmap.wide[data-tree]')) {
    const id = box.dataset.tree, svg = box.querySelector('svg');
    const mini = box.parentElement.querySelector('.kmini');
    const saved = mapScroll.get(id);
    if (saved) { box.scrollLeft = saved[0]; box.scrollTop = saved[1]; }
    else box.scrollTop = Math.max(0, Number(svg.dataset.rooty) - box.clientHeight / 2); // centre dot in view
    if (pendingFocusNode) {
      const g = svg.querySelector(`[data-nid="${CSS.escape(pendingFocusNode)}"]`);
      const m = g && (g.getAttribute('transform').match(/translate\(([-\d.]+),([-\d.]+)\)/) || []);
      if (m && m[2] != null) {
        const y = Number(m[2]);
        if (y < box.scrollTop + 40 || y > box.scrollTop + box.clientHeight - 80) box.scrollTop = Math.max(0, y - box.clientHeight / 3);
      }
    }
    if (!mini) continue;
    const fits = box.scrollHeight <= box.clientHeight + 2 && box.scrollWidth <= box.clientWidth + 2;
    mini.hidden = fits || miniOff;
    const show = box.parentElement.querySelector('.kmini-show');
    if (show) show.hidden = fits || !miniOff;
    const view = mini.querySelector('.kmini-view');
    const sync = () => {
      const mw = mini.clientWidth, mh = mini.clientHeight;
      view.style.left = `${(box.scrollLeft / box.scrollWidth) * mw}px`;
      view.style.top = `${(box.scrollTop / box.scrollHeight) * mh}px`;
      view.style.width = `${Math.min(1, box.clientWidth / box.scrollWidth) * mw}px`;
      view.style.height = `${Math.min(1, box.clientHeight / box.scrollHeight) * mh}px`;
      mapScroll.set(id, [box.scrollLeft, box.scrollTop]);
    };
    box.addEventListener('scroll', sync, { passive: true });
    sync();
    const go = (e) => {
      const r = mini.getBoundingClientRect();
      box.scrollLeft = ((e.clientX - r.left) / r.width) * box.scrollWidth - box.clientWidth / 2;
      box.scrollTop = ((e.clientY - r.top) / r.height) * box.scrollHeight - box.clientHeight / 2;
    };
    mini.onpointerdown = (e) => { if (e.target.closest('.kmini-x')) return; e.preventDefault(); mini.setPointerCapture(e.pointerId); go(e); mini.onpointermove = go; };
    mini.onpointerup = mini.onpointercancel = () => { mini.onpointermove = null; };
  }
  pendingFocusNode = null;
}
// When a topic lights up, a stream of light runs from its dot along the links to the centre dot.
let pendingStream = null;
function runStream() {
  const id = pendingStream;
  pendingStream = null;
  if (!id || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  for (const svg of $app.querySelectorAll('.kmap svg')) {
    const start = svg.querySelector(`[data-nid="${CSS.escape(id)}"]`);
    if (!start) continue;
    const segs = [];
    let cur = id;
    for (let guard = 0; guard < 12; guard++) {
      const link = svg.querySelector(`.klinks path[data-to="${CSS.escape(cur)}"]`);
      if (!link) break;
      segs.push(link.dataset.back);
      cur = link.dataset.from;
    }
    if (!segs.length) continue;
    const d = segs.map((sg, i) => (i ? sg.replace(/^M/, 'L') : sg)).join(' ');
    const ns = 'http://www.w3.org/2000/svg';
    const g = document.createElementNS(ns, 'g');
    g.setAttribute('class', 'kstream');
    svg.insertBefore(g, svg.querySelector('.klinks').nextSibling);
    const probe = document.createElementNS(ns, 'path');
    probe.setAttribute('d', d);
    g.appendChild(probe);
    const len = probe.getTotalLength();
    probe.remove();
    const dur = Math.min(1600, 500 + len * 0.9);
    [[46, 0, 5], [22, 120, 3], [10, 220, 2]].forEach(([dash, delay, width]) => {
      const p = document.createElementNS(ns, 'path');
      p.setAttribute('d', d);
      p.style.strokeWidth = width;
      p.style.strokeDasharray = `${dash} ${len + dash}`;
      g.appendChild(p);
      p.animate([{ strokeDashoffset: dash, opacity: 1 }, { strokeDashoffset: -len, opacity: 0.9 }],
        { duration: dur, delay, easing: 'cubic-bezier(.45,0,.25,1)', fill: 'forwards' });
    });
    // Ripples: one where the topic lit up, one when the stream reaches the centre.
    const xy = (el) => (el.getAttribute('transform').match(/translate\(([-\d.]+),([-\d.]+)\)/) || []).slice(1).map(Number);
    const ripple = (el, delay, r) => {
      const [cx, cy] = xy(el);
      if (cx == null) return;
      const c = document.createElementNS(ns, 'circle');
      c.setAttribute('cx', cx); c.setAttribute('cy', cy); c.setAttribute('r', r);
      c.setAttribute('class', 'kripple');
      g.appendChild(c);
      c.style.transformOrigin = `${cx}px ${cy}px`;
      c.animate([{ transform: 'scale(1)', opacity: 0.9 }, { transform: 'scale(3.2)', opacity: 0 }], { duration: 650, delay, easing: 'ease-out', fill: 'both' });
    };
    ripple(start, 0, 7);
    const target = svg.querySelector(`[data-nid="${CSS.escape(cur)}"]`) || svg.querySelector('.kn.root');
    if (target) ripple(target, dur - 120, 14);
    setTimeout(() => g.remove(), dur + 400);
  }
}
// Phones: the same dots and links, one topic per row (children step right under their branch).
const R_ROW = 34, R_IND = 22;
function treeRowsSvg(tree, nodes, { interactive }) {
  const rows = [], links = [];
  const walk = (n, depth, parent, i) => {
    const leaf = !n.k.length;
    const folded = !leaf && interactive && isFolded(n, depth, i);
    const it = { n, depth, leaf, folded, p: leaf ? null : treeProgress(n.k), x: K_PAD + depth * R_IND, y: K_PAD + rows.length * R_ROW };
    rows.push(it);
    if (parent) links.push({ a: parent, b: it });
    if (!leaf && !folded) n.k.forEach((c, j) => walk(c, depth + 1, it, j));
  };
  const root = { n: { id: 'root', t: tree.name || 'Tree', k: nodes }, depth: 0, leaf: false, p: treeProgress(nodes), x: K_PAD, y: K_PAD, root: true };
  rows.push(root);
  nodes.forEach((c, i) => walk(c, 1, root, i));
  if (rows.length < 2) return '';
  const h = K_PAD * 2 + (rows.length - 1) * R_ROW;
  const v = (it) => (it.leaf ? (it.n.lit ? 1 : 0) : it.p.pct);
  const path = ({ a, b }) => `M${a.x},${a.y + 8} L${a.x},${b.y - 10} Q${a.x},${b.y} ${a.x + 10},${b.y} L${b.x - 8},${b.y}`;
  const back = ({ a, b }) => `M${b.x - 8},${b.y} L${a.x + 10},${b.y} Q${a.x},${b.y} ${a.x},${b.y - 10} L${a.x},${a.y + 8}`;
  const ring = (it, r) => { const c = 2 * Math.PI * r; return `<circle class="kr-track" r="${r}"/><circle class="kr-fill" r="${r}" stroke-dasharray="${(it.p.pct * c).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90)"/>`; };
  // Card width minus margins, in characters of ~7px, so long names end in … instead of running off.
  const room = (it, extra = 0) => Math.max(8, Math.floor((Math.min(window.innerWidth, 640) - 70 - it.x - extra) / 7.1));
  const node = (it) => {
    const t = escapeHtml(it.n.t);
    if (it.leaf) {
      return `<g class="kn leaf ${it.n.lit ? 'lit' : ''} ${it.n.cov ? 'cov' : ''}" data-nid="${it.n.id}" transform="translate(${it.x},${it.y})" ${interactive ? leafAct(tree, it.n) : ''}>
        <title>${t}</title><rect class="khit" x="-12" y="-15" width="1000" height="30" rx="8"/>
        ${leafDot(it.n)}<text x="14" y="4.5">${escapeHtml(clip(it.n.t, room(it, it.n.cov ? 30 : 0)))}${it.n.cov ? ` <tspan class="kcount">${it.n.cov.lit}/${it.n.cov.total}</tspan>` : ''}</text></g>`;
    }
    const big = it.root ? 11 : 8, done = it.p.lit === it.p.total;
    return `<g class="kn branch ${done ? 'lit' : ''} ${it.folded ? 'folded' : ''} ${it.root ? 'root' : ''}" data-nid="${it.n.id}" transform="translate(${it.x},${it.y})"
        ${interactive && !it.root ? `data-act="tree-fold" data-node="${it.n.id}" role="button" tabindex="0" aria-expanded="${!it.folded}"` : ''}>
      <title>${t}</title><rect class="khit" x="-12" y="-15" width="1000" height="30" rx="8"/>
      ${done ? `<circle class="kglow" r="${big + 5}"/>` : ''}<circle class="kcore" r="${big - 3}"/>${ring(it, big)}
      ${it.folded ? '<text class="kplus" y="4.5">+</text>' : ''}
      <text class="klabel" x="${big + 9}" y="4.5">${escapeHtml(clip(it.n.t, room(it, 40)))} <tspan class="kcount">${it.p.lit}/${it.p.total}</tspan></text></g>`;
  };
  return `<div class="kmap rows"><svg width="100%" height="${h}" role="img" aria-label="${escapeHtml(tree.name || 'Knowledge tree')}">
    <defs><linearGradient id="klink-r-${tree.id}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${h}"><stop offset="0" stop-color="#fa8072"/><stop offset="1" stop-color="#ffc93c"/></linearGradient></defs>
    <g class="klinks">${links.map((l) => { const x = v(l.b); return `<path d="${path(l)}" data-from="${l.a.n.id}" data-to="${l.b.n.id}" data-back="${back(l)}" class="${x > 0 ? 'on' : ''}" ${x > 0 ? `style="stroke:url(#klink-r-${tree.id});opacity:${(0.35 + 0.65 * x).toFixed(2)}"` : ''}/>`; }).join('')}</g>
    ${rows.map(node).join('')}</svg></div>`;
}
let lastNarrow = narrowMap();
window.addEventListener('resize', () => {
  if (narrowMap() === lastNarrow) return;
  lastNarrow = narrowMap();
  if (route.page === 'knowledge' && !typing()) render();
});
function treeBodyHtml(t) {
  if (treeView === 'list' && t.nodes.length) return treeNodesHtml(t, t.nodes);
  if (!t.map.length) return treeSvg(t, t.nodes) + `<p class="help center">This map shows the full course list. <a href="#/knowledge/${t.id}/edit">Add a simplified map</a> to see just the core skills.</p>`;
  return treeSvg({ ...t, isMap: true }, deriveMap(t.nodes, t.map).nodes);
}
let nextLeafId = null;
const treeOpen = new Set(); // list view: branches folded open this session (top level starts open)
function treeNodesHtml(tree, nodes, depth = 0) {
  return `<ul class="ktree">${nodes.map((n) => {
    if (!n.k.length) {
      return `<li><button class="kleaf ${n.lit ? 'lit' : ''} ${n.id === nextLeafId ? 'next' : ''}" data-act="tree-lit" data-tree="${tree.id}" data-node="${n.id}" aria-pressed="${!!n.lit}">
        <span class="kdot"></span><span class="kt">${escapeHtml(n.t)}</span></button></li>`;
    }
    const p = treeProgress(n.k);
    const open = depth === 0 ? !treeOpen.has(`-${n.id}`) : treeOpen.has(n.id);
    return `<li class="kbranch ${p.lit === p.total ? 'lit' : ''}"><details data-tnode="${n.id}" data-depth="${depth}" ${open ? 'open' : ''}>
      <summary><span class="kring" style="--p:${Math.round(p.pct * 100)}%"></span><b>${escapeHtml(n.t)}</b><small>${p.lit}/${p.total}</small></summary>
      ${treeNodesHtml(tree, n.k, depth + 1)}</details></li>`;
  }).join('')}</ul>`;
}
const treeMain = (t) => (t.nodes.length ? t.nodes : deriveMap(t.nodes, t.map).nodes);
function treeCardHtml(t) {
  const p = treeProgress(treeMain(t));
  const c = t.commitmentId && state.commitments.find((x) => x.id === t.commitmentId);
  nextLeafId = (nextTopic(t) || {}).id;
  return `<section class="card ktree-card" id="tree-${t.id}" data-section="${escapeHtml(t.name)}">
    <div class="card-head"><h2>${escapeHtml(t.name)}</h2><a class="txt-btn" href="#/knowledge/${t.id}/edit">Edit</a></div>
    <div class="kprog"><b>${Math.round(p.pct * 100)}%</b><span>${t.map.length && t.nodes.length ? 'of the course' : 'lit'} · ${p.lit} of ${p.total} topics${p.week ? ` · <em>+${p.week} this week</em>` : ''}</span></div>
    <div class="hbar"><i style="width:${p.pct * 100}%"></i></div>
    ${c || t.source ? `<p class="small muted pad">${c ? `Routine: <a href="#/c/${c.id}">${escapeHtml(c.name)}</a>` : ''}${c && t.source ? ' · ' : ''}${t.source ? linkify(escapeHtml(t.source)) : ''}</p>` : ''}
    ${treeBodyHtml(t)}
  </section>`;
}
function knowledgePageHtml() {
  const trees = state.trees;
  return `
    <header class="top">${topBar({ label: 'Routine', title: 'Knowledge', right: '<a class="txt-btn" href="#/knowledge/new">+ New</a>' })}${routineNav('knowledge')}
      ${trees.length ? `<div class="seg-mini kview"><button data-act="tree-view" data-v="map" class="${treeView === 'map' ? 'on' : ''}">Map</button><button data-act="tree-view" data-v="list" class="${treeView === 'list' ? 'on' : ''}">List</button></div>` : ''}</header>
    ${trees.length ? trees.map(treeCardHtml).join('') : `
      <section class="card empty">
        <p><b>Light up what you've learned.</b></p>
        <p class="muted small">Turn a course (e.g. your Felix technicals) or a self-study plan into a tree of topics, then tap each topic as you learn it.</p>
        <a class="btn primary" href="#/knowledge/new">Make a knowledge tree</a>
      </section>`}`;
}
let treeDraft = null; // { outline, map } while editing
function treePrompt(name, source) {
  return `Draft the course list for: ${name || '<subject or course>'}
Source: ${source || '<course page link, syllabus, or what I am teaching myself>'}

Read the source and list everything it covers, in the order it is taught. Keep the course's own section and lesson names.
Reply with only an indented outline: two spaces per level, one topic per line, at most 4 levels.
No numbering, no bullets, no commentary.`;
}
function mapPrompt(name, outline) {
  return `Here is the full course list for "${name || 'my course'}":

${outline.trim() || '<paste the course list here>'}

Turn it into a compact skill map: the core skills I am really building, not the course's lesson structure.
- At most 3 levels and 8 to 25 lines in total. Merge lessons that train the same skill; leave out admin, intros and recaps.
- On each lowest-level line, after " | ", list the course topics it covers, copied exactly from the list above, separated by commas.
Reply with only the indented outline (two spaces per level). Example line:  DCF | Unlevered free cash flow, WACC, Terminal value`;
}
function treePreviewHtml(name, outline, mapText) {
  const course = parseOutline(outline);
  const map = parseMapOutline(mapText);
  const d = deriveMap(course, map);
  const missing = [...new Set(d.missing)];
  return `<span>Preview · ${treeLeaves(course).length} course topics · ${map.length ? `${treeLeaves(map).length} map skills` : 'no map yet'}</span>
    ${missing.length ? `<span class="help err">Not found in the course list: ${escapeHtml(missing.slice(0, 6).join(', '))}${missing.length > 6 ? '…' : ''}</span>` : ''}
    <div class="tpreview">${map.length ? treeSvg({ id: 'preview', name: name || 'Preview', isMap: true }, d.nodes, { interactive: false })
      : course.length ? treeSvg({ id: 'preview', name: name || 'Preview' }, course, { interactive: false }) : '<p class="muted small">Nothing yet.</p>'}</div>`;
}
function treeEditHtml() {
  const isNew = route.treeId === 'new';
  const t = isNew ? normaliseTree({ name: '', nodes: [] }) : state.trees.find((x) => x.id === route.treeId);
  if (!t) return knowledgePageHtml();
  const outline = treeDraft ? treeDraft.outline : outlineOf(t.nodes);
  const mapText = treeDraft ? treeDraft.map : outlineOf(t.map);
  return `
    <header class="top">${topBar({ left: '<button class="txt-btn" data-act="back">Cancel</button>', title: isNew ? 'New knowledge tree' : 'Edit tree',
      right: '<button class="txt-btn strong" type="submit" form="tform">Save</button>' })}</header>
    <form id="tform" class="card form" data-form="tree" data-id="${isNew ? '' : t.id}">
      <label class="f">Name<input name="name" required value="${escapeHtml(t.name)}" placeholder="e.g. Felix technicals"></label>
      <label class="f">What it covers<input name="source" value="${escapeHtml(t.source)}" placeholder="Course page link, or e.g. “self-study: VC fund basics”"></label>
      <label class="f">Linked routine<span class="help">Its page shows how much of the course is done.</span>${routineSelect('commitmentId', t.commitmentId)}</label>

      <div class="kstep"><b>1 · Course list</b><span class="help">The full, detailed structure from the course website. You tick these in List view.</span>
        <button type="button" class="btn" data-act="tree-prompt">Copy prompt for Claude</button>
        <span class="help">Paste it into Claude with the course page link (or the page open), then paste the outline back here.</span>
        <textarea name="outline" class="code" rows="10" placeholder="Accounting&#10;  Three statements&#10;    Income statement&#10;    Balance sheet">${escapeHtml(outline)}</textarea></div>

      <div class="kstep"><b>2 · Map (simplified)</b><span class="help">A short picture of the core skills, separate from the course structure. Optional.</span>
        <button type="button" class="btn" data-act="map-prompt">Copy prompt for Claude</button>
        <span class="help">The prompt includes your course list. A line can end with “ | topic, topic” to light up from those course topics; without it you tap the skill yourself.</span>
        <textarea name="mapOutline" class="code" rows="8" placeholder="Valuation&#10;  DCF | Unlevered free cash flow, WACC, Terminal value&#10;  Comps | Trading comps, Precedent transactions">${escapeHtml(mapText)}</textarea></div>

      <div class="f tpreview-wrap">${treePreviewHtml(t.name, outline, mapText)}</div>
      <button class="btn primary" type="submit">${isNew ? 'Import tree' : 'Save'}</button>
      ${isNew ? '' : '<div class="danger"><button type="button" class="btn warn" data-act="tree-delete">Delete tree</button></div>'}
    </form>`;
}
function saveTreeForm(form) {
  const f = new FormData(form);
  const name = String(f.get('name') || '').trim();
  const nodes = parseOutline(f.get('outline'));
  const map = parseMapOutline(f.get('mapOutline'));
  if (!name) { toast('Give it a name'); return; }
  if (!nodes.length && !map.length) { toast('Paste the course list or a map first'); return; }
  const fields = { name, source: String(f.get('source') || '').trim(), commitmentId: f.get('commitmentId') || null };
  let t = state.trees.find((x) => x.id === form.dataset.id);
  if (t) Object.assign(t, fields, { nodes: carryLit(nodes, t.nodes), map: carryLit(map, t.map) });
  else { t = normaliseTree({ ...fields, nodes, map }); state.trees.push(t); }
  treeDraft = null;
  save();
  location.replace('#/knowledge');
}
// Tapping a map skill that covers course topics ticks them all (or clears them if all were done).
function toggleCover(treeId, nodeId) {
  const t = state.trees.find((x) => x.id === treeId);
  const d = t && findNode(deriveMap(t.nodes, t.map).nodes, nodeId);
  if (!d || !d.cover) return;
  const leaves = d.cover.map((id) => findNode(t.nodes, id)).filter(Boolean);
  const all = leaves.every((l) => l.lit);
  let fresh = 0;
  for (const l of leaves) { if (all) { delete l.lit; delete l.at; } else if (!l.lit) { l.lit = true; l.at = todayISO(); fresh++; } }
  if (!all) pendingStream = nodeId;
  const note = fresh ? logRoutineFromTree(t, fresh) : '';
  save();
  render();
  runStream();
  const topics = `${leaves.length} course topic${leaves.length === 1 ? '' : 's'}`;
  toast((all ? `Cleared ${topics}` : `Ticked ${topics}`) + (note ? ` · ${note}` : ''));
}
// Learning course topics counts as doing the linked routine today: a task is ticked; a counter of
// lessons/topics goes up by the number learned (hour counters are left for you to log).
function logRoutineFromTree(t, n) {
  const c = t.commitmentId && state.commitments.find((x) => x.id === t.commitmentId);
  const w = c && getWeek(currentWeekKey());
  const it = w && w.items[c.id];
  if (!it) return '';
  const i = todayIndex(currentWeekKey());
  if (it.kind === 'counter') {
    if (isHourUnit(it.unit)) return '';
    if (it.freq === 'weekly') it.count = round2(it.count + n * (it.step || 1)); else it.counts[i] = round2(it.counts[i] + n * (it.step || 1));
    return `${c.name} +${n}`;
  }
  if (it.freq === 'weekly') { if (it.done) return ''; it.done = true; }
  else { if (it.ticks[i]) return ''; it.ticks[i] = true; }
  return `${c.name} ticked for today`;
}
// The next topic to learn in the course list (first one not yet lit).
const nextTopic = (t) => treeLeaves(t.nodes).find((n) => !n.lit) || null;
function pathTo(nodes, id, trail = []) {
  for (const n of nodes) { if (n.id === id) return trail; const r = pathTo(n.k, id, [...trail, n]); if (r) return r; }
  return null;
}
// Opens the list view at the next topic of a tree (used from Today and the routine's page).
function focusTree(id) {
  const t = state.trees.find((x) => x.id === id);
  if (!t) return;
  treeView = 'list';
  const next = nextTopic(t);
  for (const b of (next && pathTo(t.nodes, next.id)) || []) { treeOpen.add(b.id); treeOpen.delete(`-${b.id}`); }
  setTimeout(() => {
    const el = document.querySelector(`.kleaf[data-node="${CSS.escape(next ? next.id : '')}"]`) || document.getElementById(`tree-${id}`);
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, 60);
}
function routineTreeLines(cid) {
  const today = todayISO();
  return state.trees.filter((t) => t.commitmentId === cid && t.nodes.length).map((t) => {
    const next = nextTopic(t);
    const done = treeLeaves(t.nodes).filter((n) => n.lit && n.at === today).length;
    return `<a class="trow-extra" href="#/knowledge/${t.id}">${done ? `${done} topic${done === 1 ? '' : 's'} today · ` : ''}${next ? `Next: ${escapeHtml(clip(next.t, 48))}` : 'Course finished 🎉'} ›</a>`;
  }).join('');
}
function toggleLeaf(treeId, nodeId, inMap = false) {
  const t = state.trees.find((x) => x.id === treeId);
  const n = t && findNode(inMap ? t.map : t.nodes, nodeId);
  if (!n) return;
  if (n.lit) { delete n.lit; delete n.at; } else { n.lit = true; n.at = todayISO(); pendingStream = nodeId; }
  const note = n.lit && !inMap ? logRoutineFromTree(t, 1) : '';
  save();
  render();
  runStream();
  if (note) toast(note);
}
function treesForCommitment(id) {
  const ts = state.trees.filter((t) => t.commitmentId === id);
  return ts.map((t) => { const p = treeProgress(treeMain(t)); return `<a class="crow" href="#/knowledge/${t.id}"><div class="ctext"><div class="n">🌳 ${escapeHtml(t.name)}</div>
    <div class="sub">${Math.round(p.pct * 100)}% lit · ${p.lit}/${p.total} topics</div><div class="mini"><i style="width:${p.pct * 100}%"></i></div></div><span class="chev">›</span></a>`; }).join('');
}

// ---------- Online test results ----------
// Each practice or real test is logged with type, provider, score, percentile and time, and the
// results are summarised per type and as evidence for the Capability Radar dimensions.
const TEST_TYPES = { numerical: 'Numerical', verbal: 'Verbal', logical: 'Logical / inductive', sjt: 'Situational judgement',
  game: 'Game-based', personality: 'Personality / behavioural', coding: 'Coding / technical', other: 'Other' };
const TEST_PROVIDERS = ['SHL', 'Cappfinity', 'Pymetrics', 'Talogy (Cubiks)', 'Aon (cut-e)', 'Korn Ferry', 'Saville', 'Criteria', 'Arctic Shores', 'HireVue',
  'Practice Aptitude Tests', 'JobTestPrep', 'AssessmentDay', 'Graduate Monkey'];
// Capability Radar dimensions (ids from the radar's profile) each test type is evidence for.
const RADAR_DIMS = { 'finance-industry-knowledge': 'Finance & industry knowledge', judgement: 'Judgement', 'written-communication': 'Written communication',
  'attention-to-detail': 'Attention to detail', 'composure-under-pressure': 'Composure under pressure', 'technical-ai-tooling': 'Technical & AI tooling' };
const TEST_RADAR = { numerical: ['finance-industry-knowledge', 'attention-to-detail', 'composure-under-pressure'],
  verbal: ['written-communication', 'attention-to-detail', 'composure-under-pressure'], logical: ['judgement', 'composure-under-pressure'],
  sjt: ['judgement'], game: ['composure-under-pressure'], personality: [], coding: ['technical-ai-tooling', 'composure-under-pressure'], other: ['composure-under-pressure'] };
const pctNum = (v, max) => { const n = parseFloat(v); return isFinite(n) && n >= 0 ? Math.min(max, n) : null; };
function normaliseTest(x) {
  const total = pctNum(x.total, 999), correct = pctNum(x.correct, 999);
  return {
    id: String(x.id || uid()), date: /^\d{4}-\d{2}-\d{2}$/.test(x.date || '') ? x.date : todayISO(),
    type: TEST_TYPES[x.type] ? x.type : 'other', provider: String(x.provider || '').slice(0, 60),
    mode: x.mode === 'real' ? 'real' : 'practice', firm: String(x.firm || '').slice(0, 60),
    correct, total: total || null, pct: pctNum(x.pct, 100), mins: pctNum(x.mins, 600),
    outcome: ['pass', 'fail', 'pending'].includes(x.outcome) ? x.outcome : '', note: String(x.note || '').slice(0, 500),
  };
}
const testAcc = (x) => (x.total && x.correct != null ? x.correct / x.total : null);
const testMetric = (x) => (x.pct != null ? x.pct : testAcc(x) != null ? testAcc(x) * 100 : null); // 0–100
const ordinal = (n) => { const r = Math.round(n); const s = r % 100 >= 11 && r % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' })[r % 10] || 'th'; return `${r}${s}`; };
const avg = (a) => (a.length ? a.reduce((s, n) => s + n, 0) / a.length : null);
function testSummary(list) {
  const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
  const metrics = sorted.map(testMetric).filter((m) => m != null);
  const pct = avg(sorted.map((x) => x.pct).filter((v) => v != null));
  const acc = avg(sorted.map(testAcc).filter((v) => v != null));
  const mins = avg(sorted.map((x) => x.mins).filter((v) => v != null));
  let trend = null;
  if (metrics.length >= 2) {
    const h = Math.floor(metrics.length / 2);
    const d = avg(metrics.slice(metrics.length - h)) - avg(metrics.slice(0, h));
    trend = d >= 5 ? 'getting better' : d <= -5 ? 'slipping' : 'steady';
  }
  const real = sorted.filter((x) => x.mode === 'real');
  return { n: list.length, pct, acc, mins, trend, metrics, passed: real.filter((x) => x.outcome === 'pass').length, failed: real.filter((x) => x.outcome === 'fail').length, real: real.length };
}
function summaryLine(label, s) {
  const bits = [`${s.n} test${s.n === 1 ? '' : 's'}`];
  if (s.pct != null) bits.push(`${ordinal(s.pct)} percentile on average`);
  else if (s.acc != null) bits.push(`${Math.round(s.acc * 100)}% correct on average`);
  if (s.trend) bits.push(s.trend);
  if (s.real) bits.push(`real: ${s.passed} passed, ${s.failed} failed${s.real - s.passed - s.failed ? `, ${s.real - s.passed - s.failed} pending` : ''}`);
  return `${label}: ${bits.join(', ')}`;
}
const byType = () => {
  const m = new Map();
  for (const x of state.tests) { if (!m.has(x.type)) m.set(x.type, []); m.get(x.type).push(x); }
  return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
};
function radarEvidence() {
  const out = [];
  for (const [dim, name] of Object.entries(RADAR_DIMS)) {
    const types = byType().filter(([t]) => TEST_RADAR[t].includes(dim));
    if (types.length) out.push({ dim, name, lines: types.map(([t, l]) => summaryLine(TEST_TYPES[t], testSummary(l))) });
  }
  return out;
}
function radarExport() {
  const ev = radarEvidence();
  const lines = [`Online test evidence from I Commit! (${fmtShort(todayISO())}) for /capability-radar.`,
    'Please assess this as external evidence (mode 3) and propose any score changes before writing.', ''];
  for (const e of ev) lines.push(`${e.name} (${e.dim}):`, ...e.lines.map((l) => `  - ${l}`));
  lines.push('', 'Raw results (JSON):', JSON.stringify(state.tests.map(({ id, ...x }) => x)));
  return lines.join('\n');
}
function sparkHtml(metrics) {
  const last = metrics.slice(-10);
  return `<span class="spark" aria-hidden="true">${last.map((m) => `<i style="height:${Math.max(8, m)}%"></i>`).join('')}</span>`;
}
// Adds one to (or ticks) the linked routine for the test's day.
function logOnRoutine(cid, date) {
  const c = state.commitments.find((x) => x.id === cid);
  if (!c || date > todayISO()) return '';
  const w = getWeek(weekOf(date), weekOf(date) === currentWeekKey());
  const it = w && w.items[cid];
  if (!it) return '';
  const i = dayIndexOf(date);
  if (it.freq === 'weekly') { if (it.kind === 'counter') it.count = round2(it.count + (it.step || 1)); else it.done = true; }
  else if (it.kind === 'counter') it.counts[i] = round2(it.counts[i] + (it.step || 1));
  else it.ticks[i] = true;
  return ` · ${c.name} logged`;
}
function testsPageHtml() {
  const editing = route.testId && state.tests.find((x) => x.id === route.testId);
  const x = editing || normaliseTest({ date: todayISO(), type: state.lastTestType || 'numerical', provider: state.lastTestProvider || '' });
  const types = byType();
  const ev = radarEvidence();
  const list = [...state.tests].sort((a, b) => b.date.localeCompare(a.date) || 0);
  const opt = (v, label, cur) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${label}</option>`;
  const radio = (name, value, label, cur) => `<label><input type="radio" name="${name}" value="${value}" ${cur === value ? 'checked' : ''}><span>${label}</span></label>`;
  return `
    <header class="top">${topBar({ label: 'Routine', title: 'Online tests' })}${routineNav('tests')}</header>
    <form class="card form" data-form="test" data-id="${editing ? x.id : ''}" data-mode="${x.mode}" data-section="Log a test">
      <div class="card-head"><h2>${editing ? 'Edit result' : 'Log a test'}</h2>${editing ? '<a class="txt-btn" href="#/tests">Cancel</a>' : ''}</div>
      <datalist id="providers">${TEST_PROVIDERS.map((p) => `<option value="${escapeHtml(p)}">`).join('')}</datalist>
      <div class="f2"><label class="f">Date<input type="date" name="date" value="${x.date}"></label>
        <label class="f">Type<select name="type">${Object.entries(TEST_TYPES).map(([v, l]) => opt(v, l, x.type)).join('')}</select></label></div>
      <div class="f2"><label class="f">Provider<input name="provider" list="providers" value="${escapeHtml(x.provider)}" placeholder="e.g. SHL"></label>
        <div class="f">For<div class="seg">${radio('mode', 'practice', 'Practice', x.mode)}${radio('mode', 'real', 'Real', x.mode)}</div></div></div>
      <div class="f2 only-real"><label class="f">Firm<input name="firm" value="${escapeHtml(x.firm)}" placeholder="e.g. Nomura"></label>
        <label class="f">Outcome<select name="outcome">${opt('', '—', x.outcome)}${opt('pending', 'Waiting', x.outcome)}${opt('pass', 'Passed', x.outcome)}${opt('fail', 'Not passed', x.outcome)}</select></label></div>
      <div class="f4">
        <label class="f">Correct<input name="correct" type="number" inputmode="numeric" min="0" step="1" value="${x.correct ?? ''}"></label>
        <label class="f">Out of<input name="total" type="number" inputmode="numeric" min="0" step="1" value="${x.total ?? ''}"></label>
        <label class="f">Percentile<input name="pct" type="number" inputmode="numeric" min="0" max="100" step="1" value="${x.pct ?? ''}"></label>
        <label class="f">Minutes<input name="mins" type="number" inputmode="numeric" min="0" step="1" value="${x.mins ?? ''}"></label>
      </div>
      <label class="f">Note<input name="note" value="${escapeHtml(x.note)}" placeholder="What tripped you up, what to practise next"></label>
      ${editing ? '' : `<label class="f">Also log on routine${routineSelect('routine', state.testRoutine || (routineChoices().find((c) => /test/i.test(c.name)) || {}).id, "Don't")}</label>`}
      <button class="btn primary" type="submit">${editing ? 'Save' : 'Log result'}</button>
      ${editing ? '<div class="danger"><button type="button" class="btn warn" data-act="test-delete">Delete result</button></div>' : ''}
    </form>
    <section class="card" data-section="How you're doing">
      <div class="card-head"><h2>How you're doing</h2></div>
      ${types.length ? types.map(([t, l]) => { const s = testSummary(l); return `<div class="tsum">
        <div><b>${TEST_TYPES[t]}</b><span>${escapeHtml(summaryLine('', s).replace(/^: /, ''))}${s.mins != null ? ` · ${Math.round(s.mins)} min avg` : ''}</span></div>
        ${s.metrics.length > 1 ? sparkHtml(s.metrics) : ''}</div>`; }).join('') : '<p class="muted pad small">Log your first test to see averages and trends per type.</p>'}
    </section>
    <section class="card" data-section="Capability Radar">
      <div class="card-head"><h2>Capability Radar evidence</h2></div>
      ${ev.length ? ev.map((e) => `<div class="rev"><b>${escapeHtml(e.name)}</b>${e.lines.map((l) => `<span>${escapeHtml(l)}</span>`).join('')}</div>`).join('') +
        `<button class="btn full" data-act="tests-export">Copy for Capability Radar</button>
        <p class="help center">Paste it into Claude with <b>/capability-radar</b>. Claude proposes score changes from this evidence before saving anything.</p>`
        : '<p class="muted pad small">Results feed the radar dimensions they test: numerical → finance knowledge, attention to detail and composure under pressure; verbal → writing; logical and situational judgement → judgement.</p>'}
    </section>
    ${list.length ? `<section class="card" data-section="History"><div class="card-head"><h2>History</h2><span class="hint">${list.length} logged</span></div>
      ${list.map((t) => `<a class="crow" href="#/tests/${t.id}"><div class="ctext"><div class="n">${TEST_TYPES[t.type]}${t.provider ? ` · ${escapeHtml(t.provider)}` : ''}${t.mode === 'real' ? ` · <span class="tag">${escapeHtml(t.firm || 'Real')}${t.outcome ? ` ${t.outcome === 'pass' ? '✓' : t.outcome === 'fail' ? '✗' : '…'}` : ''}</span>` : ''}</div>
        <div class="sub">${fmtShort(t.date)}${t.total ? ` · ${t.correct ?? '?'}/${t.total}` : ''}${t.pct != null ? ` · ${ordinal(t.pct)} pct` : ''}${t.mins != null ? ` · ${t.mins} min` : ''}${t.note ? ` · ${escapeHtml(t.note)}` : ''}</div></div><span class="chev">›</span></a>`).join('')}
    </section>` : ''}`;
}
function saveTestForm(form) {
  const f = new FormData(form);
  const fields = Object.fromEntries(['date', 'type', 'provider', 'mode', 'firm', 'correct', 'total', 'pct', 'mins', 'outcome', 'note'].map((k) => [k, f.get(k)]));
  if (fields.mode !== 'real') { fields.firm = ''; fields.outcome = ''; }
  const x = normaliseTest({ ...fields, id: form.dataset.id || undefined, provider: String(fields.provider || '').trim(), note: String(fields.note || '').trim() });
  if (x.correct != null && x.total && x.correct > x.total) { toast('Correct answers can’t be more than the total'); return; }
  const i = state.tests.findIndex((t) => t.id === x.id);
  let extra = '';
  if (i >= 0) state.tests[i] = x;
  else {
    state.tests.push(x);
    const cid = f.get('routine') || '';
    state.testRoutine = cid || null;
    if (cid) extra = logOnRoutine(cid, x.date);
  }
  state.lastTestType = x.type; state.lastTestProvider = x.provider;
  save();
  if (form.dataset.id) location.replace('#/tests'); else render();
  toast(`${form.dataset.id ? 'Saved' : 'Logged'}${extra}`);
}

// ---------- Work Buddy ----------
// The simplest version: one pact with a real person (or a few). Each of you ticks your own day,
// optionally with a note; the streak grows only on days everyone finished. Your tick can follow a
// linked routine automatically. Data lives on the server in /api/buddy; membership syncs like the rest.
const BUDDY_POLL_MS = 2 * 60e3;
let buddyView = null, buddyError = null, buddyBusy = false, buddyAutoDate = null;
async function buddyApi(body) {
  const headers = { 'content-type': 'application/json' };
  if (state.buddy && state.buddy.token) headers.authorization = `Bearer ${state.buddy.token}`;
  const r = await fetch('/api/buddy', { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(data.error || `Something went wrong (${r.status}).`); e.status = r.status; throw e; }
  return data;
}
const typing = () => { const a = document.activeElement; return a && $app.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName); };
async function refreshBuddy() {
  if (!state.buddy || buddyBusy) return;
  try { buddyView = (await buddyApi()).pact; buddyError = null; buddyAutoTick(); }
  catch (e) { buddyError = e.status === 401 || e.status === 404 ? 'gone' : e.message; }
  if ((route.tab === 'buddy' || route.tab === 'today') && !route.id && !typing()) render();
}
function joinedPact(data, form) {
  state.buddy = { token: data.token, pactId: data.pact.id, commitmentId: new FormData(form).get('routine') || null };
  buddyView = data.pact; buddyError = null;
  save();
  location.hash = '#/buddy';
  render();
  buddyAutoTick();
}
async function createPact(form) {
  const f = new FormData(form);
  try { joinedPact(await buddyApi({ action: 'create', me: f.get('me'), name: f.get('name') }), form); toast('Pact started. Send your buddy the invite link.'); }
  catch (e) { toast(e.message); }
}
async function joinPact(form) {
  const f = new FormData(form);
  try { joinedPact(await buddyApi({ action: 'join', invite: f.get('invite'), me: f.get('me') }), form); toast('You’re in!'); }
  catch (e) { toast(e.message); }
}
async function buddyTick(done, note = '') {
  if (!state.buddy || buddyBusy) return;
  buddyBusy = true;
  try { buddyView = (await buddyApi({ action: 'tick', date: todayISO(), done, note })).pact; buddyError = null; }
  catch (e) { toast(e.message); }
  buddyBusy = false;
  if (!typing()) render();
}
async function leavePact() {
  if (!confirm('Leave this pact? Your ticks in it are removed. If you are the last person, the pact is deleted.')) return;
  try { if (buddyError !== 'gone') await buddyApi({ action: 'leave' }); } catch (e) { if (e.status !== 401 && e.status !== 404) { toast(e.message); return; } }
  state.buddy = null; buddyView = null; buddyError = null;
  save(); render();
}
// Done today on the linked routine?
function linkedDoneToday() {
  const id = state.buddy && state.buddy.commitmentId;
  const w = id && state.weeks[currentWeekKey()];
  const it = w && w.items[id];
  if (!it) return null;
  return it.freq === 'weekly' || it.freq === 'once' ? periodDone(it) : dayDone(it, todayIndex(currentWeekKey()));
}
// Ticks you in the pact when the linked routine is finished (and unticks only what it ticked itself).
function buddyAutoTick() {
  if (!buddyView || buddyBusy) return;
  const done = linkedDoneToday();
  if (done == null) return;
  const mine = buddyView.members.find((m) => m.me);
  const has = !!(mine && mine.days[todayISO()]);
  if (done && !has) { buddyAutoDate = todayISO(); buddyTick(true, ''); }
  else if (!done && has && buddyAutoDate === todayISO()) { buddyAutoDate = null; buddyTick(false); }
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
const inviteUrl = (p) => `${location.origin}${location.pathname}#/join/${p.invite}`;
async function shareText(text, url) {
  if (navigator.share) { try { await navigator.share({ text, url }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  copyText(`${text} ${url}`);
}
function buddyTodayLine() {
  if (!state.buddy || !buddyView) return '';
  const others = buddyView.members.filter((m) => !m.me);
  const s = pactStreak(buddyView);
  return `<div class="pace"><a href="#/buddy">Work Buddy${s ? ` · 🔥 ${s}` : ''} · ${others.length ? others.map((m) => `${escapeHtml(m.name)} ${m.days[todayISO()] ? '✅' : '⬜'}`).join(' · ') : 'waiting for your buddy'} ›</a></div>`;
}
function buddyTabHtml() {
  const head = (label, title) => `<header class="top">${topBar({ label, title, right: menuBtn })}</header>`;
  if (!state.buddy) {
    const invite = route.invite || '';
    return head('Work Buddy', invite ? 'Join a pact' : 'Partner up') + `
      <form class="card form" data-form="${invite ? 'buddy-join' : 'buddy-create'}" data-section="${invite ? 'Join' : 'Start a pact'}">
        <div class="card-head"><h2>${invite ? 'You’ve been invited' : 'Start a pact'}</h2></div>
        <p class="small muted">${invite ? 'Do the same routine together. Each of you ticks your own day; the streak grows on days you both finish.'
          : 'Do a routine together with a real person, e.g. an online test every day. Each of you ticks your own day; the streak grows only on days you both finish.'}</p>
        <label class="f">Your name<input name="me" required maxlength="40" placeholder="What your buddy sees"></label>
        ${invite ? `<input type="hidden" name="invite" value="${escapeHtml(invite)}">` : '<label class="f">What you’re doing together<input name="name" maxlength="60" value="Daily online test"></label>'}
        <label class="f">Tick me automatically when I finish<span class="help">Optional. Or tick by hand on this page.</span>${routineSelect('routine', (routineChoices().find((c) => /test/i.test(c.name)) || {}).id, 'Nothing, I’ll tick here')}</label>
        <button class="btn primary" type="submit">${invite ? 'Join' : 'Start and get an invite link'}</button>
      </form>
      ${invite ? '' : `<form class="card form" data-form="buddy-code"><div class="card-head"><h2>Got an invite?</h2></div>
        <label class="f">Invite link or code<input name="code" placeholder="Paste it here" autocapitalize="off" autocorrect="off"></label>
        <button class="btn" type="submit">Continue</button></form>`}`;
  }
  if (!buddyView) {
    return head('Work Buddy', 'Pact') + `<section class="card empty">
      ${buddyError === 'gone' ? '<p>This pact no longer exists or you were removed.</p><button class="btn" data-act="buddy-leave">Start again</button>'
        : buddyError ? `<p class="err">${escapeHtml(buddyError)}</p><button class="btn" data-act="buddy-refresh">Try again</button>` : '<p class="muted">Loading…</p>'}</section>`;
  }
  const p = buddyView, today = todayISO();
  const me = p.members.find((m) => m.me) || { days: {} };
  const others = p.members.filter((m) => !m.me);
  const streak = pactStreak(p);
  const mineToday = me.days[today];
  const linked = state.buddy.commitmentId && state.commitments.find((c) => c.id === state.buddy.commitmentId);
  const waiting = others.filter((m) => !m.days[today]);
  const timeOf = (d) => (d && d.at ? new Date(d.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');
  const days = Array.from({ length: 14 }, (_, i) => addDaysISO(today, i - 13));
  const row = (m) => `<div class="bgrid-row"><span class="bname">${m.me ? 'You' : escapeHtml(m.name)}</span>${days.map((d) =>
    `<i class="${m.days[d] ? 'on' : ''} ${d === today ? 'today' : ''}" title="${fmtShort(d)}"></i>`).join('')}</div>`;
  return head('Work Buddy', escapeHtml(p.name)) + `
    <section class="card" data-section="Today">
      <div class="bstreak"><b>${streak ? `🔥 ${streak}` : '🌱 0'}</b><span>${others.length ? `day streak · grows on days you all finish` : 'Waiting for your buddy to join'}</span></div>
      <div class="bmember me ${mineToday ? 'done' : ''}">
        <button class="chk ${mineToday ? 'on' : ''}" data-act="buddy-tick" aria-pressed="${!!mineToday}" aria-label="I did it today">${mineToday ? CHECK : ''}</button>
        <div class="bm-body"><b>You</b><span>${mineToday ? `Done ${timeOf(mineToday)}${mineToday.n ? ` · “${escapeHtml(mineToday.n)}”` : ''}` : 'Not yet today'}</span></div>
      </div>
      <form class="inline bnote" data-form="buddy-note"><input name="note" maxlength="140" placeholder="Add a note, e.g. SHL numerical 14/18" value="${escapeHtml(mineToday && mineToday.n || '')}"><button class="mini-btn" type="submit">${mineToday ? 'Save' : 'Done + note'}</button></form>
      ${others.map((m) => { const d = m.days[today]; return `<div class="bmember ${d ? 'done' : ''}"><span class="chk ring ${d ? 'on' : ''}">${d ? CHECK : ''}</span>
        <div class="bm-body"><b>${escapeHtml(m.name)}</b><span>${d ? `Done ${timeOf(d)}${d.n ? ` · “${escapeHtml(d.n)}”` : ''}` : 'Not yet today'}</span></div></div>`; }).join('')}
      ${waiting.length ? `<button class="btn full" data-act="buddy-nudge">Nudge ${escapeHtml(waiting.map((m) => m.name).join(' & '))} 👀</button>` : ''}
      <p class="help">${linked ? `Ticks you automatically when you finish <b>${escapeHtml(linked.name)}</b>.` : 'Tick by hand, or link a routine below to tick automatically.'}</p>
    </section>
    <section class="card" data-section="Last 14 days">
      <div class="card-head"><h2>Last 14 days</h2></div>
      <div class="bgrid">${row(me)}${others.map(row).join('')}</div>
    </section>
    <section class="card" data-section="Settings">
      <div class="card-head"><h2>Invite & settings</h2></div>
      <div class="btn-row"><button class="btn" data-act="buddy-invite">Share invite link</button><button class="btn" data-act="buddy-copy">Copy link</button></div>
      <form class="form flat" data-form="buddy-routine"><label class="f">Tick me automatically when I finish${routineSelect('routine', state.buddy.commitmentId, 'Nothing, I’ll tick here')}</label></form>
      <div class="danger"><button class="btn warn" data-act="buddy-leave">Leave pact</button></div>
    </section>`;
}

// ---------- Whiteboard ----------
// Sticky notes for things that pop into your head ("order pizza for Aurum"). Two views:
//   Free      notes sit anywhere; drag the corner to resize; drop one on a day in the strip to pin it.
//   Calendar  the board is a week (dashed lines between days, plus a "Not pinned" column); a note's
//             column is its date, and dragging its right edge makes it last several days.
// Pinned notes show in My plan and on Today with a tick box.
// Note: { id, text, color, x (0–1), y, w, h (free view), cy (calendar view), rot, date, endDate, time, done }.
const NOTE_COLORS = { gold: '#fff1a6', salmon: '#ffd5cc', sky: '#d3ecf8', mint: '#d5f5d1', lilac: '#e7ddfb' };
const NOTE_W = 128, NOTE_H = 96, BOARD_HEAD = 46, BOARD_COLS = 8;
let editingNote = null; // note being written in
let boardCal = false, boardWeek = null;
try { boardCal = localStorage.getItem('boardCal') === '1'; } catch {}
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
function calNav(on) {
  const a = (href, key, label) => `<a href="${href}" class="${on === key ? 'on' : ''}" ${on === key ? 'aria-current="page"' : ''}>${label}</a>`;
  return `<nav class="subnav">${a('#/cal', 'cal', 'Calendar')}${a('#/board', 'board', 'Whiteboard')}</nav>`;
}
const shortDay = (iso) => (iso === todayISO() ? 'Today' : daysUntil(iso) === 1 ? 'Tomorrow'
  : fmtDay(parseISO(iso), { weekday: 'short', day: 'numeric', ...(Math.abs(daysUntil(iso)) > 6 ? { month: 'short' } : {}) }));
const noteDateLabel = (n) => (n.date ? `${shortDay(n.date)}${n.endDate ? ` – ${shortDay(n.endDate)}` : ''}${n.time ? ` ${n.time}` : ''}` : '');
const noteDays = (n) => (n.endDate ? Math.round((parseISO(n.endDate) - parseISO(n.date)) / 864e5) + 1 : 1);
// A whole push pin, leaning a little: round head, collar and needle.
const PIN_SVG = `<svg class="pin" viewBox="0 0 30 40" aria-hidden="true"><g transform="rotate(24 15 14)">
  <path d="M15 21 L15 37" stroke="#9aa3ab" stroke-width="1.8" stroke-linecap="round"/>
  <path d="M10.5 17.5 h9 l-1.6 4 h-5.8 z" fill="#b8352a"/>
  <ellipse cx="15" cy="11" rx="8.5" ry="8.2" fill="#e2483a"/>
  <ellipse cx="15" cy="13.5" rx="8.5" ry="5.8" fill="#c73a2e" opacity=".55"/>
  <ellipse cx="12.2" cy="8" rx="3.2" ry="2.3" fill="#fff" opacity=".55"/></g></svg>`;

function noteInner(n) {
  const editing = editingNote === n.id;
  return `${PIN_SVG}
    ${editing
      ? `<textarea class="note-text" data-note-text="${n.id}" maxlength="400" placeholder="What's on your mind?">${escapeHtml(n.text)}</textarea>
         <div class="note-colors">${Object.keys(NOTE_COLORS).map((c) => `<button class="nc c-${c} ${c === n.color ? 'on' : ''}" data-act="note-color" data-id="${n.id}" data-color="${c}" aria-label="${c}"></button>`).join('')}
           <button class="note-ok" data-act="note-close">Done</button></div>`
      : `<div class="note-body">${n.text ? linkify(escapeHtml(n.text)) : '<span class="muted">Empty note</span>'}</div>`}
    <div class="note-foot">
      <button class="note-date ${n.date ? 'on' : ''}" data-act="note-date" data-id="${n.id}" title="Pin to calendar">${n.date ? noteDateLabel(n) : '📅'}</button>
      ${n.date ? `<button class="note-tick ${n.done ? 'on' : ''}" data-act="note-done" data-id="${n.id}" aria-label="Done" aria-pressed="${n.done}">${n.done ? CHECK : ''}</button>` : ''}
      <button class="note-task" data-act="note-task" data-id="${n.id}" title="Turn into a task">→ Task</button>
      <button class="note-x" data-act="note-delete" data-id="${n.id}" aria-label="Delete note">×</button>
    </div>
    <span class="note-resize" data-resize="${n.id}" aria-hidden="true"></span>`;
}
const noteClass = (n) => `note c-${n.color} ${n.done ? 'done' : ''} ${editingNote === n.id ? 'editing' : ''}`;

function boardFreeHtml(notes) {
  const height = Math.max(480, ...notes.map((n) => n.y + (n.h || NOTE_H + 60) + 160));
  const days = Array.from({ length: 7 }, (_, i) => addDaysISO(todayISO(), i));
  return `
    <div class="board-days" aria-label="Drop a note on a day to pin it">
      ${days.map((d) => `<div class="bday ${d === todayISO() ? 'today' : ''}" data-drop-date="${d}"><span>${d === todayISO() ? 'Today' : DAY_NAMES[dayIndexOf(d)].slice(0, 3)}</span><b>${parseISO(d).getDate()}</b></div>`).join('')}
      <div class="bday pick" data-drop-date="pick"><span>Other</span><b>…</b></div>
    </div>
    <div class="board" data-mode="free" style="height:${height}px">
      ${notes.length ? '' : '<p class="board-empty">Jot down anything that pops into your head.<br>Drag a note onto a day above to pin it to your calendar.</p>'}
      ${notes.map((n) => `<div class="${noteClass(n)}" data-note="${n.id}"
        style="left:${(n.x * 100).toFixed(2)}%;top:${n.y}px;width:${n.w || NOTE_W}px;${n.h ? `min-height:${n.h}px;` : ''}--rot:${n.rot}deg">${noteInner(n)}</div>`).join('')}
    </div>`;
}
// Calendar view: your week's schedule as a time grid (faint blocks), with notes on top. A note's
// column is its date and its height on the grid is its time; notes in the "Anytime" band have no time.
const B_HPX = 52;
function boardCalHtml(notes) {
  const wk = boardWeek || currentWeekKey();
  const days = DAY_NAMES.map((_, i) => isoDate(dayDate(wk, i)));
  const first = days[0], last = days[6];
  const col = 100 / BOARD_COLS;
  const w = getWeek(wk);
  const events = w ? itemsOf(w, 'once').filter(([, it]) => days.includes(it.date)) : [];
  const timed = events.filter(([, it]) => it.time);
  const allDay = events.filter(([, it]) => !it.time);
  const mins = (t) => toMinutes(t);
  const noteMins = notes.filter((n) => n.time).map((n) => mins(n.time));
  const startHour = Math.min(8, ...timed.map(([, it]) => Math.floor(mins(it.time) / 60)), ...noteMins.map((m) => Math.floor(m / 60)));
  const endHour = Math.max(22, ...timed.map(([, it]) => Math.ceil((it.endTime ? mins(it.endTime) : mins(it.time) + 60) / 60)), ...noteMins.map((m) => Math.ceil(m / 60) + 1));
  const placed = [];
  let elsewhere = 0;
  for (const n of notes) {
    let c0 = 0, span = 1, cut = '';
    if (n.date) {
      const end = n.endDate || n.date;
      if (end < first || n.date > last) { elsewhere++; continue; }
      const st = n.date < first ? first : n.date, e = end > last ? last : end;
      c0 = 1 + dayIndexOf(st);
      span = dayIndexOf(e) - dayIndexOf(st) + 1;
      cut = `${n.date < first ? 'cut-l' : ''} ${end > last ? 'cut-r' : ''}`;
    }
    placed.push({ n, c0, span, cut, lane: !n.date ? 'unpinned' : n.time ? 'timed' : 'anytime' });
  }
  placed.sort((x, y) => (x.n.time || '').localeCompare(y.n.time || ''));
  const isThis = wk === currentWeekKey();
  const evHtml = timed.map(([id, it]) => {
    const s0 = mins(it.time), e0 = it.endTime && mins(it.endTime) > s0 ? mins(it.endTime) : s0 + Math.max(30, Math.round((it.hours || 1) * 60));
    return `<div class="bev ${it.schedule ? 'sched' : ''}" data-ev-min="${s0 - startHour * 60}" data-ev-len="${e0 - s0}" title="${escapeHtml(`${it.name} · ${it.time}${it.endTime ? '–' + it.endTime : ''}`)}"
      style="--ev:${eventColor(id)};left:calc(${((1 + dayIndexOf(it.date)) * col).toFixed(3)}% + 3px);width:calc(${col.toFixed(3)}% - 6px)">
      <b>${escapeHtml(it.name)}</b><span>${it.time}${it.endTime ? `–${it.endTime}` : ''}</span></div>`;
  }).join('');
  return `
    <div class="board-week">
      <button class="icon-btn" data-act="board-prev" aria-label="Previous week">‹</button>
      ${isThis ? `<b class="board-range">${weekRange(wk)}</b>` : `<button class="txt-btn" data-act="board-this">${weekRange(wk)} · back to this week</button>`}
      <button class="icon-btn" data-act="board-next" aria-label="Next week">›</button>
      ${elsewhere ? `<span class="hint">${elsewhere} pinned in other weeks</span>` : ''}
    </div>
    <div class="board-scroll"><div class="board cal" data-mode="cal" data-week="${wk}" data-start-hour="${startHour}" data-end-hour="${endHour}">
      <div class="bcols">${['Not pinned', ...days].map((d, i) => `<div class="bcol ${i === 0 ? 'unpinned' : ''} ${d === todayISO() ? 'today' : ''}">
        <div class="bcol-head">${i === 0 ? '<span>Not pinned</span>' : `<span>${DAY_NAMES[i - 1].slice(0, 3)}</span><b>${parseISO(d).getDate()}</b>`}</div></div>`).join('')}</div>
      <div class="bband"><span>Anytime</span></div>
      <div class="bhours">${Array.from({ length: endHour - startHour }, (_, i) => `<div class="bhour" data-h="${i}"><span>${pad(startHour + i)}:00</span></div>`).join('')}</div>
      ${allDay.map(([id, it]) => `<div class="bev allday ${it.schedule ? 'sched' : ''}" data-allday="${1 + dayIndexOf(it.date)}" style="--ev:${eventColor(id)};left:calc(${((1 + dayIndexOf(it.date)) * col).toFixed(3)}% + 3px);width:calc(${col.toFixed(3)}% - 6px)"><b>${escapeHtml(it.name)}</b></div>`).join('')}
      ${evHtml}
      ${placed.map(({ n, c0, span, cut, lane }) => `<div class="${noteClass(n)} in-cal ${cut}" data-note="${n.id}" data-c0="${c0}" data-span="${span}" data-lane="${lane}" ${n.time ? `data-min="${mins(n.time) - startHour * 60}"` : ''}
        style="left:calc(${(c0 * col).toFixed(3)}% + 5px);width:calc(${(span * col).toFixed(3)}% - 10px);${n.h ? `min-height:${Math.min(n.h, 160)}px;` : ''}--rot:0deg">${noteInner(n)}</div>`).join('')}
    </div></div>`;
}
function boardPageHtml() {
  const notes = state.notes;
  const pinned = notes.filter((n) => n.date && !n.done).length;
  const doneCount = notes.filter((n) => n.done).length;
  return `
    <header class="top">${topBar({ label: 'Calendar', title: 'Whiteboard', right: menuBtn })}${calNav('board')}</header>
    <section class="card board-card" data-section="Whiteboard">
      <div class="board-tools">
        <button class="btn primary" data-act="note-new">+ Note</button>
        <div class="seg-mini"><button data-act="board-mode" data-v="free" class="${boardCal ? '' : 'on'}">Free</button><button data-act="board-mode" data-v="cal" class="${boardCal ? 'on' : ''}">Calendar</button></div>
        <span class="hint">${notes.length ? `${notes.length} note${notes.length === 1 ? '' : 's'}${pinned ? ` · ${pinned} pinned` : ''}` : 'Tap + Note to start'}</span>
        ${doneCount ? `<button class="txt-btn" data-act="note-clear">Clear ${doneCount} done</button>` : ''}
      </div>
      ${boardCal ? boardCalHtml(notes) : boardFreeHtml(notes)}
    </section>`;
}
function addNote(extra = {}) {
  const k = state.notes.length;
  let base = { x: 0.03 + (k % 5) * 0.19, y: 14 + Math.floor(k / 5) * 150 + (k % 2) * 12 };
  if (boardCal) {
    // New notes go on today's column (or "Not pinned" when looking at another week).
    const wk = boardWeek || currentWeekKey();
    base = wk === currentWeekKey() ? { date: todayISO() } : {};
  }
  const n = normaliseNote({ text: '', color: Object.keys(NOTE_COLORS)[k % 5], rot: Math.round((Math.random() * 6 - 3) * 10) / 10, ...base, ...extra });
  state.notes.push(n);
  editingNote = n.id;
  save();
  render();
  focusNote();
  return n;
}
function focusNote() {
  const ta = editingNote && $app.querySelector(`[data-note-text="${CSS.escape(editingNote)}"]`);
  if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
}
function closeNote() {
  const n = state.notes.find((x) => x.id === editingNote);
  editingNote = null;
  if (n && !n.text.trim()) state.notes = state.notes.filter((x) => x !== n); // drop empty notes
  save();
  render();
}
function openNoteDate(id) {
  const n = state.notes.find((x) => x.id === id);
  if (!n) return;
  const quick = [[todayISO(), 'Today'], [addDaysISO(todayISO(), 1), 'Tomorrow'], [addDaysISO(todayISO(), 7 - dayIndexOf(todayISO())), 'Next Monday']];
  openSheet(`
    <div class="sheet-head"><h3>Pin to calendar</h3></div>
    <form class="form flat" data-form="note-date" data-id="${id}">
      <p class="small muted">${escapeHtml(clip(n.text || 'Empty note', 80))}</p>
      <div class="btn-row">${quick.map(([d, l]) => `<button type="button" class="btn" data-act="note-quick" data-date="${d}">${l}</button>`).join('')}</div>
      <div class="f2"><label class="f">From<input type="date" name="date" value="${n.date || todayISO()}"></label>
        <label class="f">Until (optional)<input type="date" name="endDate" value="${n.endDate || ''}"></label></div>
      <label class="f">Time (optional)<input type="time" name="time" value="${n.time || ''}"></label>
      <button class="btn primary" type="submit">Pin it</button>
      ${n.date ? '<button type="button" class="btn" data-act="note-unpin">Unpin from calendar</button>' : ''}
      <button type="button" class="btn" data-act="note-task" data-id="${id}">Turn into a task</button>
    </form>`, { note: id });
}
function pinNote(id, date, time = null, endDate = undefined) {
  const n = state.notes.find((x) => x.id === id);
  if (!n) return;
  const days = noteDays(n);
  n.date = date;
  n.endDate = !date ? null : endDate !== undefined ? (endDate && endDate > date ? endDate : null) : days > 1 ? addDaysISO(date, days - 1) : null;
  n.time = date ? validTime(time) : null;
  n.done = false;
  save();
  closeSheet();
  render();
  if (date) toast(`Pinned to ${noteDateLabel(n)}`);
}
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
  if (editingNote === id) editingNote = null;
  renumber();
  save();
  closeSheet();
  render();
  toast(n.date ? `Now a task on ${shortDay(n.date)}${n.time ? ` at ${n.time}` : ''}` : 'Now a task (date to be confirmed)');
}
// Notes pinned to a day, including ones lasting several days.
const notesOn = (iso) => state.notes.filter((n) => n.date && n.date <= iso && iso <= (n.endDate || n.date))
  .sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
// A pinned note as a small sticky in My plan / Today.
function notePillHtml(n, d) {
  const st = n.done ? 'done' : (n.endDate || n.date) < todayISO() ? 'missed' : 'pending';
  const multi = n.endDate ? `<small class="dtime">${d === n.date ? 'starts' : d === n.endDate ? 'last day' : 'ongoing'}</small> ` : '';
  return `<div class="dpill notepill c-${n.color} ${st}">
    <button class="dbox" data-act="note-done" data-id="${n.id}" aria-label="Done" aria-pressed="${n.done}">${n.done ? CHECK : ''}</button>
    <a class="dname" href="#/board">${n.time && d === n.date ? `<small class="dtime">${n.time}</small> ` : ''}${multi}${escapeHtml(n.text || 'Note')}</a></div>`;
}

// Calendar view layout (after drawing, using real heights): unpinned notes stack in the first column,
// untimed notes and all-day events stack in the Anytime band, and the time grid starts below it.
function layoutBoard() {
  const board = $app.querySelector('.board.cal');
  if (!board) return;
  const GAP = 10;
  const band = Array(BOARD_COLS).fill(BOARD_HEAD + 30);
  for (const el of board.querySelectorAll('.bev.allday')) {
    const c = Number(el.dataset.allday);
    el.style.top = `${band[c]}px`;
    band[c] += el.offsetHeight + 6;
  }
  for (const el of board.querySelectorAll('.note.in-cal[data-lane="anytime"]')) {
    const c0 = Number(el.dataset.c0), span = Number(el.dataset.span);
    const top = Math.max(...band.slice(c0, c0 + span));
    el.style.top = `${top}px`;
    for (let c = c0; c < c0 + span; c++) band[c] = top + el.offsetHeight + GAP + 8;
  }
  const gridTop = Math.max(BOARD_HEAD + 74, ...band.slice(1)) + 6;
  board.dataset.gridTop = gridTop;
  const bandEl = board.querySelector('.bband');
  bandEl.style.top = `${BOARD_HEAD}px`;
  bandEl.style.height = `${gridTop - BOARD_HEAD}px`;
  const hours = board.querySelector('.bhours');
  hours.style.top = `${gridTop}px`;
  for (const el of board.querySelectorAll('.bev[data-ev-min]')) {
    el.style.top = `${gridTop + (Number(el.dataset.evMin) / 60) * B_HPX}px`;
    el.style.height = `${Math.max(20, (Number(el.dataset.evLen) / 60) * B_HPX - 3)}px`;
  }
  // Timed notes sit at their time; ones that would overlap in the same column step down.
  const lastBottom = Array(BOARD_COLS).fill(0);
  for (const el of board.querySelectorAll('.note.in-cal[data-lane="timed"]')) {
    const c0 = Number(el.dataset.c0), span = Number(el.dataset.span);
    let top = gridTop + (Number(el.dataset.min) / 60) * B_HPX;
    top = Math.max(top, ...lastBottom.slice(c0, c0 + span));
    el.style.top = `${top}px`;
    for (let c = c0; c < c0 + span; c++) lastBottom[c] = top + el.offsetHeight + 4;
  }
  let un = BOARD_HEAD + 30;
  for (const el of board.querySelectorAll('.note.in-cal[data-lane="unpinned"]')) { el.style.top = `${un}px`; un += el.offsetHeight + GAP + 8; }
  const gridBottom = gridTop + hours.offsetHeight;
  board.style.height = `${Math.max(gridBottom + 40, un + 40, ...lastBottom.map((b) => b + 40))}px`;
}
// While dragging in the calendar view, the note shows the time it would get.
function whenAt(board, top) {
  const gridTop = Number(board.dataset.gridTop);
  if (top + 8 < gridTop) return 'Anytime';
  return fmtTime(Number(board.dataset.startHour) * 60 + Math.round(((top - gridTop) / B_HPX) * 4) * 15);
}
// Dragging: move a note with the pointer (drop on a day or a calendar column to pin it), or drag
// its corner / right edge to resize it. A tap without moving starts writing.
let noteDrag = null, noteTapAt = 0;
document.addEventListener('pointerdown', (e) => {
  const el = e.target.closest('.note');
  if (!el || e.button > 0) return;
  const resize = e.target.closest('[data-resize]');
  if (!resize && e.target.closest('button, textarea, a')) return;
  const board = el.closest('.board');
  const r = el.getBoundingClientRect();
  noteDrag = { el, id: el.dataset.note, board, cal: board.dataset.mode === 'cal', resize: !!resize, dx: e.clientX - r.left, dy: e.clientY - r.top,
    w0: el.offsetWidth, h0: el.offsetHeight, sx: e.clientX, sy: e.clientY, moved: false };
  el.setPointerCapture(e.pointerId);
  e.preventDefault();
});
document.addEventListener('pointermove', (e) => {
  const d = noteDrag;
  if (!d) return;
  if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 6) return;
  if (!d.moved) { d.moved = true; d.el.classList.add(d.resize ? 'resizing' : 'dragging'); }
  const br = d.board.getBoundingClientRect();
  if (d.resize) {
    d.el.style.width = `${Math.max(90, d.w0 + e.clientX - d.sx)}px`;
    if (!d.cal) d.el.style.minHeight = `${Math.max(70, d.h0 + e.clientY - d.sy)}px`;
    return;
  }
  d.el.style.left = `${Math.min(br.width - 40, Math.max(0, e.clientX - br.left - d.dx))}px`;
  d.el.style.top = `${Math.max(d.cal ? BOARD_HEAD + 4 : 0, e.clientY - br.top - d.dy)}px`;
  if (d.cal) d.el.dataset.when = whenAt(d.board, parseFloat(d.el.style.top));
  const over = document.elementsFromPoint(e.clientX, e.clientY).find((x) => x.dataset && x.dataset.dropDate);
  $app.querySelectorAll('.bday.over').forEach((x) => x !== over && x.classList.remove('over'));
  if (over) over.classList.add('over');
});
document.addEventListener('pointerup', (e) => {
  const d = noteDrag;
  noteDrag = null;
  if (!d) return;
  const n = state.notes.find((x) => x.id === d.id);
  if (!n) return;
  if (!d.moved) {
    if (!d.resize && editingNote !== n.id) { noteTapAt = Date.now(); editingNote = n.id; render(); focusNote(); }
    return;
  }
  const br = d.board.getBoundingClientRect();
  const colW = br.width / BOARD_COLS;
  if (d.cal) {
    const wk = d.board.dataset.week;
    if (d.resize) {
      // Width in whole days; a note can't stretch past the week shown.
      if (n.date) {
        const startCol = Math.max(0, dayIndexOf(n.date < wk ? wk : n.date));
        const days = Math.max(1, Math.min(7 - startCol, Math.round(parseFloat(d.el.style.width) / colW)));
        const endIso = addDaysISO(n.date < wk ? wk : n.date, days - 1);
        n.endDate = endIso > n.date ? endIso : null;
      }
    } else {
      const left = parseFloat(d.el.style.left);
      const c = Math.max(0, Math.min(BOARD_COLS - 1, Math.floor((left + colW * 0.4) / colW)));
      if (c === 0) { n.date = null; n.endDate = null; n.time = null; }
      else {
        const days = noteDays(n);
        n.date = addDaysISO(wk, c - 1);
        n.endDate = days > 1 ? addDaysISO(n.date, days - 1) : null;
        const gridTop = Number(d.board.dataset.gridTop), top = parseFloat(d.el.style.top);
        if (top + 8 < gridTop) n.time = null;
        else {
          const m = Number(d.board.dataset.startHour) * 60 + Math.round(((top - gridTop) / B_HPX) * 4) * 15;
          n.time = fmtTime(Math.min(23 * 60 + 45, Math.max(0, m)));
        }
      }
    }
    save(); render();
    return;
  }
  if (d.resize) {
    n.w = Math.round(parseFloat(d.el.style.width));
    n.h = Math.round(parseFloat(d.el.style.minHeight));
    save(); render();
    return;
  }
  const over = document.elementsFromPoint(e.clientX, e.clientY).find((x) => x.dataset && x.dataset.dropDate);
  if (over) {
    if (over.dataset.dropDate === 'pick') { render(); openNoteDate(n.id); } else pinNote(n.id, over.dataset.dropDate, n.time);
    return;
  }
  n.x = Math.min(0.95, Math.max(0, parseFloat(d.el.style.left) / br.width));
  n.y = Math.max(0, Math.round(parseFloat(d.el.style.top)));
  save();
  render();
});
document.addEventListener('pointercancel', () => { if (noteDrag) { noteDrag = null; render(); } });
document.addEventListener('dblclick', (e) => {
  const board = e.target.closest('.board');
  if (!board || e.target.closest('.note')) return;
  const br = board.getBoundingClientRect();
  if (board.dataset.mode === 'cal') {
    const c = Math.floor((e.clientX - br.left) / (br.width / BOARD_COLS));
    const y = e.clientY - br.top, gridTop = Number(board.dataset.gridTop);
    const time = y < gridTop ? null : fmtTime(Number(board.dataset.startHour) * 60 + Math.floor(((y - gridTop) / B_HPX) * 4) * 15);
    addNote({ date: c > 0 ? addDaysISO(board.dataset.week, c - 1) : null, time: c > 0 ? time : null });
  } else addNote({ x: Math.max(0, (e.clientX - br.left - 60) / br.width), y: Math.max(0, Math.round(e.clientY - br.top - 20)) });
});

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
    <section class="card empty"><p>This commitment no longer exists.</p><a class="btn" href="#/commitments">All commitments</a></section>`;
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
    ${treesForCommitment(id) ? `<section class="card"><div class="card-head"><h2>Knowledge</h2></div>${treesForCommitment(id)}</section>` : ''}
    <section class="card">
      <div class="card-head"><h2>What to do</h2></div>
      ${c.notes ? `<div class="notes">${linkify(c.notes)}</div>` : `<p class="muted small pad">Nothing yet. Tap <a href="#/c/${id}/edit">Edit</a> to add what to do, resource links and your Notion page.</p>`}
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
      <label class="f">Section<input name="section" list="sections" value="${escapeHtml(c.section === 'Other' && isNew ? '' : c.section)}" placeholder="e.g. Career prep"></label>
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
      <label class="f">What to do<textarea name="notes" rows="5" placeholder="Steps, chapter you're on, checklist…">${escapeHtml(c.notes)}</textarea></label>
      ${c.stage ? `<label class="f">Test / interview link<input name="stageUrl" inputmode="url" autocapitalize="off" autocorrect="off" value="${escapeHtml(c.stageUrl || '')}" placeholder="HireVue invite, test portal, Zoom…"></label>` : ''}
      <label class="f">Notion page<input name="notionUrl" inputmode="url" autocapitalize="off" autocorrect="off" value="${escapeHtml(c.notionUrl)}" placeholder="https://www.notion.so/…"></label>
      <div class="f">Links<div class="linklist">${(c.links.length ? c.links : [undefined]).map(linkRow).join('')}</div>
        <button type="button" class="mini-btn add-link" data-act="addlink">+ Add link</button></div>
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
    notionUrl: cleanUrl(f.get('notionUrl')),
    ...(f.has('stageUrl') ? { stageUrl: cleanUrl(f.get('stageUrl')) } : {}),
    links: f.getAll('linkUrl').map((u, i) => ({ label: String(f.getAll('linkLabel')[i] || '').trim(), url: cleanUrl(u) })).filter((l) => l.url),
  };
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
  if (!sheetCtx && !route.edit) render();
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
  location.hash = '#/today';
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
      <p class="help">🔒 The link is stored only on this phone (and in your JSON backups). Anyone with it can read that calendar, so treat it like a password.</p>
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
    const v = type === 't' ? normaliseTree(p) : type === 'x' ? normaliseTest(p) : normaliseNote(p);
    const i = list.findIndex((x) => x.id === v.id);
    if (i >= 0) list[i] = v; else list.push(v);
  } else if (type === 'b') {
    const had = state.buddy && state.buddy.token;
    state.buddy = { token: p.token, pactId: p.pactId, commitmentId: p.commitmentId || null };
    if (had !== p.token) { buddyView = null; setTimeout(refreshBuddy, 0); }
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
  else if (type === 'b') { state.buddy = null; buddyView = null; }
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
      if (!route.edit && !sheetCtx && !typing()) render();
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

async function startSync() {
  state.sync = { ...freshSync(), enabled: true, key: newWidgetKey() };
  recordHashes = new Map(); // everything on this device counts as new
  stampChanges();
  save();
  render();
  toast('Uploading your data…');
  const r = await syncNow();
  toast(r >= 0 ? 'Sync is on. Copy the key to your other device.' : state.sync.lastError);
}

async function joinSync(form) {
  const key = String(new FormData(form).get('key') || '').trim();
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(key)) { toast('That doesn’t look like a sync key. Copy it again from your other device.'); return; }
  const hasProgress = Object.values(state.weeks).some((w) => Object.values(w.items).some(hasData));
  if (hasProgress && !confirm('Replace everything on this device with the data from your other device?')) return;
  const before = JSON.parse(JSON.stringify(state));
  state.commitments = [];
  state.weeks = {};
  state.calendars.feeds = [];
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
  toast('Synced with your other device');
  location.hash = '#/today';
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
  const last = state.lastBackup ? fmtDay(new Date(state.lastBackup), { day: 'numeric', month: 'short', year: 'numeric' }) : 'never';
  openSheet(`
    <div class="sheet-head"><h3>Menu</h3></div>
    <div class="menu">
      <a class="btn" href="#/sync">Sync with Mac / other devices${state.sync.enabled ? ' · on' : ''}</a>
      <a class="btn" href="#/widget">Phone widget</a>
      <button class="btn" data-act="bg-sheet">Background picture…</button>
      <button class="btn" data-act="export-xlsx">Export all weeks to Excel</button>
      <button class="btn" data-act="export-json">Back up (JSON)</button>
      <button class="btn" data-act="import-json">Restore from backup…</button>
      <p class="muted small">Last backup: ${last}. Data lives only on this device, so back up now and then.</p>
      <button class="btn" data-act="close">Close</button>
    </div>`);
}

// ---------- Export / import ----------
async function deliver(blob, filename) {
  const file = new File([blob], filename, { type: blob.type });
  const mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  if (mobile && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: filename }); return true; }
    catch (e) { if (e.name === 'AbortError') return false; }
  }
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return true;
}

function exportedWeeks() {
  const cur = currentWeekKey();
  return Object.values(state.weeks)
    .filter((w) => Object.keys(w.items).length && (w.start <= cur || Object.values(w.items).some(hasData)))
    .sort((a, b) => (a.start < b.start ? 1 : -1));
}

function exportXlsx() {
  const bold = (v) => ({ v, s: 'b' });
  const kindLabel = (it) => (it.kind === 'counter' ? 'Counter' : 'Task');
  const targetCell = (it) => (it.kind === 'counter' ? `${round2(it.target)} ${it.unit}`.trim() : fmtH(it.hours));

  const summary = [[bold('Week starting'), bold('Week ending'), bold('Planned h'), bold('Actual h'),
    bold('Actual vs plan'), bold('Ticked'), bold('Total'), bold('% ticked')]];
  const log = [[bold('Week starting'), bold('Date'), bold('Day'), bold('Frequency'), bold('Kind'), bold('Section'),
    bold('Commitment'), bold('Target'), bold('Unit'), bold('Done / count'), bold('Met target'), bold('Actual h')]];
  const weekSheets = [];

  for (const w of exportedWeeks()) {
    const s = weekStats(w);
    summary.push([w.start, weekEnd(w.start), round2(s.planned), round2(s.actual),
      { v: s.planned ? s.actual / s.planned : 0, s: 'pct' }, s.ticked, s.total, { v: s.pct, s: 'pct' }]);

    const rows = [
      [bold(`Week of ${weekRange(w.start)}`)],
      ['Planned h', round2(s.planned), 'Actual h', round2(s.actual), '% ticked', { v: s.pct, s: 'pct' }],
      [],
      [bold('Section'), bold('Daily commitment'), bold('Kind'), bold('Target/day'),
        ...DAY_NAMES.map((d, i) => bold(`${d} ${dayDate(w.start, i).getDate()}`)), bold('Days met'), bold('Actual h')],
    ];
    for (const [, it] of itemsOf(w, 'daily')) {
      // Task cells: 1 when done. Counter cells: the count.
      const cells = it.ticks.map((t, i) => (it.kind === 'task' ? (t ? 1 : null) : it.counts[i] || null));
      rows.push([it.section, it.name, kindLabel(it), targetCell(it), ...cells,
        it.ticks.filter((_, i) => dayDone(it, i)).length, round2(it.ticks.reduce((a, _, i) => a + dayHours(it, i), 0))]);
      for (let i = 0; i < 7; i++) {
        log.push([w.start, isoDate(dayDate(w.start, i)), DAY_NAMES[i], 'Daily', kindLabel(it), it.section, it.name,
          it.kind === 'counter' ? it.target : 1, it.unit, it.kind === 'counter' ? it.counts[i] : it.ticks[i] ? 1 : 0,
          dayDone(it, i) ? 1 : 0, round2(dayHours(it, i))]);
      }
    }
    rows.push([], [bold('Section'), bold('Weekly / one-off'), bold('Kind'), bold('Date'), bold('Target'),
      bold('Progress'), bold('Met target'), bold('Actual h')]);
    for (const [, it] of [...itemsOf(w, 'weekly'), ...itemsOf(w, 'once').filter(isTask)]) {
      rows.push([it.section, it.name, kindLabel(it), it.date || 'This week', targetCell(it),
        it.kind === 'counter' ? it.count : it.done ? 'Done' : '', periodDone(it) ? 'Yes' : '', round2(periodHours(it))]);
      log.push([w.start, it.date || '', it.date ? DAY_NAMES[dayIndexOf(it.date)] : '', FREQ_LABEL[it.freq], kindLabel(it),
        it.section, it.name, it.kind === 'counter' ? it.target : 1, it.unit, it.kind === 'counter' ? it.count : it.done ? 1 : 0,
        periodDone(it) ? 1 : 0, round2(periodHours(it))]);
    }
    weekSheets.push({ name: `Wk ${w.start}`, cols: [14, 30, 9, 12, 8, 8, 8, 8, 8, 8, 8, 10, 10], rows });
  }

  const blob = buildXlsx([
    { name: 'Summary', cols: [14, 14, 11, 11, 14, 9, 8, 10], rows: summary },
    ...weekSheets,
    { name: 'Log', cols: [14, 12, 6, 10, 9, 14, 32, 8, 8, 12, 11, 9], rows: log },
  ]);
  deliver(blob, `commitments-${todayISO()}.xlsx`);
}

function exportJson() {
  flush();
  state.lastBackup = new Date().toISOString();
  save();
  const data = { app: 'weekly-commitment-tracker', exportedAt: state.lastBackup, state };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  deliver(blob, `commitments-backup-${todayISO()}.json`);
}

async function importJson(file) {
  try {
    const data = JSON.parse(await file.text());
    const next = migrate(data.state || data);
    const n = Object.keys(next.weeks).length;
    if (!confirm(`Replace everything on this device with this backup (${next.commitments.length} commitments, ${n} weeks)?`)) return;
    next.sync = state.sync;
    state = next;
    save(); flush();
    closeSheet(); render();
    toast('Backup restored');
  } catch (e) {
    toast(e.message || 'Import failed');
  }
}

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
  if (editingNote && Date.now() - noteTapAt > 400 && !e.target.closest('.note.editing') && !e.target.closest('#sheet')) closeNote();
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
    case 'note-new': addNote(); break;
    case 'board-mode': boardCal = btn.dataset.v === 'cal'; try { localStorage.setItem('boardCal', boardCal ? '1' : '0'); } catch {} render(); break;
    case 'board-prev': boardWeek = addDaysISO(boardWeek || currentWeekKey(), -7); render(); break;
    case 'board-next': boardWeek = addDaysISO(boardWeek || currentWeekKey(), 7); render(); break;
    case 'board-this': boardWeek = null; render(); break;
    case 'note-close': closeNote(); break;
    case 'note-color': { const n = state.notes.find((x) => x.id === btn.dataset.id); if (n) { n.color = btn.dataset.color; save(); render(); focusNote(); } break; }
    case 'note-date': openNoteDate(btn.dataset.id); break;
    case 'note-task': noteToTask(btn.dataset.id); break;
    case 'note-quick': pinNote(sheetCtx && sheetCtx.note, btn.dataset.date, btn.closest('form').time.value); break;
    case 'note-unpin': pinNote(sheetCtx && sheetCtx.note, null); toast('Unpinned'); break;
    case 'note-done': { const n = state.notes.find((x) => x.id === btn.dataset.id); if (n) { n.done = !n.done; save(); render(); } break; }
    case 'note-delete': {
      const n = state.notes.find((x) => x.id === btn.dataset.id);
      if (n && (!n.text.trim() || confirm('Delete this note?'))) { state.notes = state.notes.filter((x) => x !== n); if (editingNote === n.id) editingNote = null; save(); render(); }
      break;
    }
    case 'note-clear': state.notes = state.notes.filter((n) => !n.done); save(); render(); break;
    case 'tree-lit': toggleLeaf(btn.dataset.tree, btn.dataset.node, btn.dataset.map === '1'); break;
    case 'tree-cover': toggleCover(btn.dataset.tree, btn.dataset.node); break;
    case 'map-prompt': { const f = btn.closest('form'); copyText(mapPrompt(f.name.value.trim(), f.outline.value)); break; }
    case 'tree-fold': {
      const id = btn.dataset.node, open = btn.getAttribute('aria-expanded') === 'false';
      foldState.set(id, !open);
      if (open) pendingFocusNode = id;
      render(); break;
    }
    case 'tree-view': treeView = btn.dataset.v; render(); break;
    case 'mini-hide': setMini(true); break;
    case 'mini-show': setMini(false); break;
    case 'tree-prompt': { const f = btn.closest('form'); copyText(treePrompt(f.name.value.trim(), f.source.value.trim())); break; }
    case 'tree-delete': {
      if (!confirm('Delete this knowledge tree?')) break;
      state.trees = state.trees.filter((t) => t.id !== route.treeId); save(); location.replace('#/knowledge'); break;
    }
    case 'test-delete': {
      if (!confirm('Delete this result?')) break;
      state.tests = state.tests.filter((t) => t.id !== route.testId); save(); location.replace('#/tests'); break;
    }
    case 'tests-export': copyText(radarExport()); break;
    case 'buddy-tick': { const me = buddyView && buddyView.members.find((m) => m.me); buddyAutoDate = null; buddyTick(!(me && me.days[todayISO()])); break; }
    case 'buddy-nudge': {
      const names = buddyView.members.filter((m) => !m.me && !m.days[todayISO()]).map((m) => m.name).join(' & ');
      shareText(`${names}, haven't seen your ${buddyView.name.toLowerCase()} today 👀 Let's keep the streak going!`, `${location.origin}${location.pathname}#/buddy`); break;
    }
    case 'buddy-invite': shareText(`Join my "${buddyView.name}" pact on I Commit! We each tick our own day and keep a streak together.`, inviteUrl(buddyView)); break;
    case 'buddy-copy': copyText(inviteUrl(buddyView)); break;
    case 'buddy-leave': leavePact(); break;
    case 'buddy-refresh': buddyError = null; render(); refreshBuddy(); break;
    case 'apps-more': {
      const k = btn.dataset.key;
      if (appsExpanded.has(k)) appsExpanded.delete(k); else appsExpanded.add(k);
      render(); break;
    }
    case 'app-today': toggleAppToday(btn.dataset.id); break;
    case 'app-followup': openFollowupSheet(btn.dataset.id); break;
    case 'app-done': {
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
    case 'export-xlsx': exportXlsx(); break;
    case 'export-json': exportJson(); break;
    case 'import-json': document.getElementById('importFile').click(); break;
    case 'bg-sheet': openBgSheet(); break;
    case 'bg-pick': document.getElementById('bgFile').click(); break;
    case 'bg-remove': bg.blob = null; applyBg(); bgWrite().catch(() => {}); openBgSheet(); break;
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
  if (e.target.dataset && e.target.dataset.noteText) {
    const n = state.notes.find((x) => x.id === e.target.dataset.noteText);
    if (n) { n.text = e.target.value.slice(0, 400); save(); }
    return;
  }
  const tform = e.target.closest('form[data-form="tree"]');
  if (tform && ['outline', 'mapOutline', 'name'].includes(e.target.name)) {
    treeDraft = { outline: tform.outline.value, map: tform.mapOutline.value };
    const box = $app.querySelector('.tpreview-wrap');
    if (box) box.innerHTML = treePreviewHtml(tform.name.value, treeDraft.outline, treeDraft.map);
    return;
  }
  const tf = e.target.closest('form[data-form="test"]');
  if (tf && e.target.name === 'mode') { tf.dataset.mode = e.target.value; return; }
  if (e.target.id === 'bgStrength') {
    bg.strength = Number(e.target.value) / 100;
    document.getElementById('bgpic').style.opacity = bg.strength;
    document.getElementById('bgPct').textContent = `${e.target.value}%`;
    return;
  }
  const fu = e.target.closest('form[data-form="followup"]');
  if (fu) syncFollowupForm(fu);
  const form = e.target.closest('form[data-form="commitment"]');
  if (form) syncFormVisibility(form);
});
document.addEventListener('change', (e) => {
  if (e.target.closest('form[data-form="buddy-routine"]') && state.buddy) {
    state.buddy.commitmentId = e.target.value || null; buddyAutoDate = null; save(); render(); return;
  }
  if (e.target.id === 'bgFile') {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) shrinkImage(file).then((blob) => { bg.blob = blob; applyBg(); openBgSheet(); return bgWrite(); })
      .catch((err) => toast('Could not use that picture: ' + err.message));
    return;
  }
  if (e.target.id === 'bgStrength') { bgWrite().catch(() => {}); return; }
  if (e.target.id === 'importFile') {
    const f = e.target.files[0];
    e.target.value = '';
    if (f) importJson(f);
    return;
  }
  const form = e.target.closest('form[data-form="commitment"]');
  if (form) syncFormVisibility(form);
});

document.addEventListener('submit', (e) => {
  const form = e.target.dataset.form;
  if (!form) return;
  e.preventDefault();
  if (form === 'minutes') setMinutes(Math.max(0, Math.round(Number(document.getElementById('minIn').value) || 0)));
  else if (form === 'commitment') saveCommitmentForm(e.target);
  else if (form === 'calendar-add') addFeed(e.target);
  else if (form === 'review') submitReview(e.target);
  else if (form === 'sync-join') joinSync(e.target);
  else if (form === 'followup') saveFollowup(e.target);
  else if (form === 'tree') saveTreeForm(e.target);
  else if (form === 'note-date') { const f = new FormData(e.target); pinNote(e.target.dataset.id, f.get('date') || todayISO(), f.get('time'), f.get('endDate') || null); }
  else if (form === 'test') saveTestForm(e.target);
  else if (form === 'buddy-create') createPact(e.target);
  else if (form === 'buddy-join') joinPact(e.target);
  else if (form === 'buddy-note') buddyTick(true, String(new FormData(e.target).get('note') || '').trim());
  else if (form === 'buddy-code') {
    const m = String(new FormData(e.target).get('code') || '').match(/([a-z0-9]{10})\s*$/i);
    if (m) location.hash = `#/join/${m[1].toLowerCase()}`; else toast('Paste the whole invite link');
  }
  else if (form === 'stage-link') {
    const c = state.commitments.find((x) => x.id === e.target.dataset.id);
    const url = cleanUrl(new FormData(e.target).get('url'));
    if (!c || !url) { toast('Paste a full link (https://…)'); return; }
    c.stageUrl = url; save(); render(); toast('Link saved');
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$sheet.hidden) closeSheet();
  else if (e.key === 'Escape' && editingNote) closeNote();
});

// Coming back to the app (e.g. next morning): refresh "today", and follow the week
// rollover if you were looking at the old current week.
// Coming back after a while (10 minutes) also starts again on Today, with every view back on today's date.
const BACK_TO_TODAY_MS = 10 * 60e3;
let hiddenAt = 0;
function backToToday() {
  viewKey = currentWeekKey();
  calViewDay = todayISO();
  boardWeek = null;
  if (route.tab !== 'today' || route.id || route.page) location.hash = '#/today';
}
document.addEventListener('visibilitychange', () => {
  if (!state) return; // still loading saved data
  if (document.visibilityState === 'visible' && hiddenAt && Date.now() - hiddenAt > BACK_TO_TODAY_MS && !route.edit && !sheetCtx && !editingNote) backToToday();
  if (document.visibilityState === 'hidden') {
    hiddenAt = Date.now();
    flush();
    if (widgetTimer) pushWidget();
    if (state.sync.enabled && Object.keys(state.sync.dirty).length + Object.keys(state.sync.tombs).length) syncNow();
    return;
  }
  const cur = currentWeekKey();
  if (cur !== lastCurrentKey) { if (viewKey === lastCurrentKey) viewKey = cur; lastCurrentKey = cur; }
  if (!sheetCtx && !route.edit) render();
  syncThenCalendars();
  refreshBuddy();
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
  bgRead().then((saved) => { if (saved) { bg = { strength: 0.5, ...saved }; applyBg(); } });
  syncThenCalendars();
  setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, SYNC_POLL_MS);
  refreshBuddy();
  setInterval(() => { if (document.visibilityState === 'visible') refreshBuddy(); }, BUDDY_POLL_MS);
  setInterval(() => { if (document.visibilityState === 'visible') { syncAll({ quiet: true }); refreshApps(); } }, 5 * 60e3);
  scheduleWidgetPush(1000);
  navigator.storage?.persist?.();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').then((reg) => { swRegistration = reg; }).catch((e) => console.warn('SW failed', e));
    // A new version took over: reload once so the page runs it (unless you're in the middle of something).
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloadingForUpdate) return;
      if (route.edit || sheetCtx) { toast('App updated. It will refresh next time you open it.'); return; }
      reloadingForUpdate = true;
      writeState().catch(() => {}).finally(() => location.reload());
    });
  }
})();
