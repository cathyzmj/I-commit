// "Build a tree together" in 3D: a floating garden drawn with WebGL (no library). Real perspective, one sun with
// soft shadows, drifting clouds and swaying leaves. Labels fly the camera to a place and open a card there; the
// page supplies the words (Garden3D.attach). garden.js is the simpler fallback for devices without WebGL 2.
(() => {
'use strict';
// ---------------------------------------------------------------- small vector and matrix helpers
const V = { add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  norm: (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; } };
const mul = (a, b) => { const o = new Float32Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]; return o; };
const perspective = (fov, asp, n, f) => { const t = 1 / Math.tan(fov / 2); return new Float32Array([t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, 2 * f * n / (n - f), 0]); };
const ortho = (s, n, f) => new Float32Array([1 / s, 0, 0, 0, 0, 1 / s, 0, 0, 0, 0, -2 / (f - n), 0, 0, 0, -(f + n) / (f - n), 1]);
const lookAt = (eye, at) => { const z = V.norm(V.sub(eye, at)), x = V.norm(V.cross([0, 1, 0], z)), y = V.cross(z, x);
  return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -V.dot(x, eye), -V.dot(y, eye), -V.dot(z, eye), 1]); };
const rng = (str) => { let h = 2166136261; for (const c of String(str)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => { h |= 0; h = (h + 0x6D2B79F5) | 0; let t = Math.imul(h ^ (h >>> 15), 1 | h); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const rgb = (hex, k = 1) => { const n = parseInt(hex.slice(1), 16); return [((n >> 16) / 255) * k, (((n >> 8) & 255) / 255) * k, ((n & 255) / 255) * k]; };

// ---------------------------------------------------------------- mesh building (flat faces, outward normals)
class Mesh {
  constructor() { this.v = []; this.stack = [{ x: 0, y: 0, z: 0, r: 0, s: 1 }]; this.sway = 0; }
  get t() { return this.stack[this.stack.length - 1]; }
  at(x, y, z, r = 0, s = 1) { const p = this.w([x, y, z]); this.stack.push({ x: p[0], y: p[1], z: p[2], r: this.t.r + r, s: this.t.s * s }); return this; }
  end() { this.stack.pop(); return this; }
  w([x, y, z]) { const t = this.t, c = Math.cos(t.r), s = Math.sin(t.r); return [t.x + (x * c + z * s) * t.s, t.y + y * t.s, t.z + (-x * s + z * c) * t.s]; }
  tri(a, b, c, col, mid) {
    let A = this.w(a), B = this.w(b), C = this.w(c), n = V.norm(V.cross(V.sub(B, A), V.sub(C, A)));
    if (mid) { const m = this.w(mid), ctr = [(A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3, (A[2] + B[2] + C[2]) / 3];
      if (V.dot(n, V.sub(ctr, m)) < 0) { n = [-n[0], -n[1], -n[2]]; [B, C] = [C, B]; } }
    const k = rgb(col);
    for (const p of [A, B, C]) this.v.push(...p, ...n, ...k, this.sway);
  }
  quad(a, b, c, d, col, mid) { this.tri(a, b, c, col, mid); this.tri(a, c, d, col, mid); }
  blob(c, r, col, seed = 'b', { sy = 1, jit = 0.14, sub = 0 } = {}) {
    const P = (1 + Math.sqrt(5)) / 2, rnd = rng(seed);
    let vs = [[-1, P, 0], [1, P, 0], [-1, -P, 0], [1, -P, 0], [0, -1, P], [0, 1, P], [0, -1, -P], [0, 1, -P], [P, 0, -1], [P, 0, 1], [-P, 0, -1], [-P, 0, 1]].map(V.norm);
    let fs = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    for (let s = 0; s < sub; s++) { const cache = {}, mid = (a, b) => { const k = a < b ? `${a}_${b}` : `${b}_${a}`; if (cache[k] === undefined) { vs.push(V.norm([(vs[a][0] + vs[b][0]) / 2, (vs[a][1] + vs[b][1]) / 2, (vs[a][2] + vs[b][2]) / 2])); cache[k] = vs.length - 1; } return cache[k]; };
      fs = fs.flatMap(([a, b, d]) => { const ab = mid(a, b), bd = mid(b, d), da = mid(d, a); return [[a, ab, da], [b, bd, ab], [d, da, bd], [ab, bd, da]]; }); }
    const pts = vs.map((p) => { const k = r * (1 + (rnd() - 0.5) * jit * 2); return [c[0] + p[0] * k, c[1] + p[1] * k * sy, c[2] + p[2] * k]; });
    for (const [a, b, d] of fs) this.tri(pts[a], pts[b], pts[d], col, c);
  }
  prism([x, y, z], r0, r1, h, n, col, { top = col, spin = 0, lean = [0, 0] } = {}) {
    const ring = (r, yy, dx, dz) => Array.from({ length: n }, (_, i) => { const a = spin + (i / n) * Math.PI * 2; return [x + dx + Math.cos(a) * r, yy, z + dz + Math.sin(a) * r]; });
    const lo = ring(r0, y, 0, 0), hi = ring(r1, y + h, lean[0], lean[1]), mid = [x + lean[0] / 2, y + h / 2, z + lean[1] / 2], tc = [x + lean[0], y + h, z + lean[1]];
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; if (r1 > 0.001) this.quad(lo[i], lo[j], hi[j], hi[i], col, mid); else this.tri(lo[i], lo[j], tc, col, mid); if (r1 > 0.001) this.tri(hi[i], hi[j], tc, top, mid); }
  }
  box([x, y, z], w, h, d, col, top = col) {
    const p = (a, b, c) => [x + a * w / 2, y + b * h, z + c * d / 2], mid = [x, y + h / 2, z];
    this.quad(p(-1, 0, 1), p(1, 0, 1), p(1, 1, 1), p(-1, 1, 1), col, mid); this.quad(p(1, 0, -1), p(-1, 0, -1), p(-1, 1, -1), p(1, 1, -1), col, mid);
    this.quad(p(1, 0, 1), p(1, 0, -1), p(1, 1, -1), p(1, 1, 1), col, mid); this.quad(p(-1, 0, -1), p(-1, 0, 1), p(-1, 1, 1), p(-1, 1, -1), col, mid);
    this.quad(p(-1, 1, 1), p(1, 1, 1), p(1, 1, -1), p(-1, 1, -1), top, mid);
  }
  roof([x, y, z], w, h, d, col, gable) { // ridge along x
    const a = [x - w / 2, y, z + d / 2], b = [x + w / 2, y, z + d / 2], c = [x + w / 2, y, z - d / 2], e = [x - w / 2, y, z - d / 2], r1 = [x - w / 2, y + h, z], r2 = [x + w / 2, y + h, z], mid = [x, y + h / 3, z];
    this.quad(a, b, r2, r1, col, mid); this.quad(c, e, r1, r2, col, mid); this.tri(b, c, r2, gable, mid); this.tri(e, a, r1, gable, mid); this.quad(a, e, c, b, gable, mid);
  }
}

// ---------------------------------------------------------------- the garden
const R = 12.5;
const LEAF = ['#6f8c4a', '#5f7c41', '#82a057', '#759352'], HERO = ['#93b64e', '#7fa443', '#a6c65c', '#89ad4a'], DRY = ['#b8a25a', '#a28a49', '#c6b06b', '#ab9350'];
function pine(m, x, z, s) { m.at(x, 0, z, 0, s); m.prism([0, 0, 0], 0.16, 0.13, 0.5, 6, '#8a6446'); m.sway = 0.4; [[0.85, 0.4], [0.68, 1.0], [0.5, 1.55]].forEach(([r, y], i) => m.prism([0, y, 0], r, 0, 1.0, 7, ['#4f6b3d', '#587645', '#63814c'][i], { spin: i })); m.sway = 0; m.end(); }
function roundTree(m, x, z, s, kind) {
  m.at(x, 0, z, x, s); m.prism([0, 0, 0], 0.19, 0.12, 1.0, 6, '#8a6446'); m.sway = 0.5;
  const cols = kind === 'blossom' ? ['#f0aebb', '#f6c1ca', '#e99cac'] : ['#6f8c4a', '#7e9a55', '#617f43'];
  m.blob([0, 1.55, 0], 0.82, cols[0], `${x}a`); m.blob([-0.45, 1.25, 0.2], 0.5, cols[1], `${z}b`); m.blob([0.46, 1.35, -0.15], 0.52, cols[2], `${x}${z}c`); m.blob([0.05, 2.15, 0], 0.46, cols[1], 'd');
  m.sway = 0; m.end();
}
function bush(m, x, z, s) { m.sway = 0.3; m.blob([x, 0.28 * s, z], 0.42 * s, '#6f8c4a', `bush${x}`, { sy: 0.8 }); m.blob([x + 0.35 * s, 0.2 * s, z + 0.1], 0.28 * s, '#82a057', `bush2${z}`, { sy: 0.8 }); m.sway = 0; }
function flowers(m, x, z, col, seed) { const q = rng(seed); for (let i = 0; i < 14; i++) { const fx = x + (q() - 0.5) * 1.5, fz = z + (q() - 0.5) * 1.5; m.sway = 0.5; m.prism([fx, 0, fz], 0.025, 0.02, 0.2 + q() * 0.1, 4, '#6d8a47'); m.blob([fx, 0.28, fz], 0.075, i % 4 ? col : '#fdf6e3', `${seed}${i}`); } m.sway = 0; }
function tuft(m, x, z, seed) { const q = rng(seed); m.sway = 0.6; for (let i = 0; i < 4; i++) m.prism([x + (q() - 0.5) * 0.2, 0, z + (q() - 0.5) * 0.2], 0.05, 0, 0.18 + q() * 0.14, 3, '#7f9a55', { lean: [(q() - 0.5) * 0.12, (q() - 0.5) * 0.12] }); m.sway = 0; }
function lamp(m, x, z) { m.prism([x, 0, z], 0.07, 0.06, 1.15, 6, '#3f463c'); m.box([x, 1.15, z], 0.3, 0.26, 0.3, '#ffe7a8'); m.prism([x, 1.41, z], 0.27, 0, 0.2, 4, '#3f463c', { spin: Math.PI / 4 }); }
function bench(m, x, z, r) { m.at(x, 0, z, r); m.box([0, 0.32, 0], 1.3, 0.1, 0.42, '#b5835a'); m.box([0, 0.55, -0.2], 1.3, 0.3, 0.07, '#b5835a'); for (const a of [-0.55, 0.55]) m.box([a, 0, 0], 0.1, 0.32, 0.34, '#6f4d35'); m.end(); }
function cottage(m, x, z, r) {
  m.at(x, 0, z, r);
  m.box([0, 0, 0], 3.3, 0.16, 2.7, '#cfc3a4'); m.box([0, 0.16, 0], 2.8, 1.6, 2.2, '#ece3ca'); m.roof([0, 1.76, 0], 3.3, 1.35, 2.85, '#c97352', '#ece3ca');
  m.box([0.75, 2.2, -0.45], 0.36, 1.0, 0.36, '#b98a6a', '#8f6a50');
  m.box([0.2, 0.16, 1.11], 0.55, 1.02, 0.06, '#8a5c3d'); m.blob([0.36, 0.68, 1.17], 0.05, '#f3d27a', 'knob');
  for (const a of [-0.8, 1.0]) { m.box([a, 0.78, 1.11], 0.55, 0.5, 0.05, '#f6f1df'); m.box([a, 0.82, 1.14], 0.45, 0.42, 0.03, '#9cc3c4'); m.box([a, 0.66, 1.2], 0.66, 0.13, 0.2, '#8a5c3d'); for (let i = 0; i < 4; i++) m.blob([a - 0.23 + i * 0.15, 0.85, 1.22], 0.07, ['#f09ab0', '#f6c453', '#b79be0'][i % 3], `wb${a}${i}`); }
  m.box([-1.41, 0.7, 0], 0.05, 0.55, 0.6, '#9cc3c4'); m.box([0.2, 0, 1.5], 0.9, 0.1, 0.45, '#dcd0b2'); m.end();
}
function pond(m, x, z) {
  m.prism([x, 0, z], 1.75, 1.7, 0.2, 14, '#d9cfb4', { top: '#ded5bc' }); m.prism([x, 0.2, z], 1.45, 1.45, 0.015, 14, '#a8d3cb', { top: '#a8d3cb' });
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; m.blob([x + Math.cos(a) * 1.65, 0.2, z + Math.sin(a) * 1.65], 0.22, i % 2 ? '#cfc6ad' : '#c1b89f', `stone${i}`, { sy: 0.65 }); }
  for (const [dx, dz] of [[-0.5, 0.3], [0.55, -0.25], [0.2, 0.7]]) m.prism([x + dx, 0.215, z + dz], 0.24, 0.24, 0.03, 8, '#6f9a55');
  m.blob([x - 0.5, 0.3, z + 0.3], 0.09, '#f6c1ca', 'lily');
}
function arch(m, x, z, r) {
  m.at(x, 0, z, r); for (const a of [-1.05, 1.05]) { m.box([a, 0, 0], 0.4, 0.18, 0.4, '#b9ac8d'); m.box([a, 0.18, 0], 0.28, 1.5, 0.28, '#d8cdb0'); }
  for (let i = 0; i <= 8; i++) { const t = Math.PI * (i / 8); m.box([-Math.cos(t) * 1.05, 1.52 + Math.sin(t) * 0.7, 0], 0.34, 0.24, 0.3, '#e2d8bd'); if (i % 2) m.blob([-Math.cos(t) * 1.05, 1.82 + Math.sin(t) * 0.7, 0], 0.17, '#f0aebb', `ar${i}`); }
  m.end();
}
function mailbox(m, x, z, r) { m.at(x, 0, z, r); m.box([0, 0, 0], 0.14, 0.75, 0.14, '#8a6446'); m.box([0, 0.75, 0], 0.55, 0.36, 0.8, '#c9523f'); m.prism([0, 1.11, 0], 0.3, 0.2, 0.1, 6, '#c9523f'); m.box([0.31, 0.95, -0.1], 0.04, 0.4, 0.06, '#f3d27a'); m.box([0.31, 1.25, -0.02], 0.04, 0.14, 0.2, '#f3d27a'); m.box([0, 0.82, 0.41], 0.36, 0.2, 0.02, '#a63f30'); m.end(); }
function person(m, x, z, r, shirt, hair, done) {
  m.at(x, 0, z, r); for (const a of [-0.12, 0.12]) m.box([a, 0, 0], 0.17, 0.34, 0.2, '#4c5a73');
  m.prism([0, 0.32, 0], 0.3, 0.22, 0.56, 7, shirt); m.blob([0, 1.12, 0], 0.27, '#f1c9a2', 'head', { jit: 0.03, sub: 1 }); m.blob([0, 1.22, -0.06], 0.29, hair, 'hair', { sy: 0.85, jit: 0.08, sub: 1 });
  for (const a of [-0.09, 0.09]) m.box([a, 1.1, 0.25], 0.05, 0.06, 0.03, '#33291f');
  if (done) { m.blob([0, 1.85, 0], 0.17, '#7cc25a', 'ok', { jit: 0, sub: 1 }); }
  m.end();
}
const SPOT = { tree: [0, 0], cottage: [-6.6, -5.2], yard: [6.3, -5.6], box: [6.7, 2.4], mail: [3.3, 7.2], pond: [-6.6, 3.4] };
const GIFT = [5.0, 3.5];
function ground(m) {
  // grass, rim, soil and hanging rock
  m.prism([0, -0.5, 0], R, R, 0.5, 44, '#8ea365', { top: '#a6ba7f' });
  m.prism([0, -0.72, 0], R * 0.985, R * 0.99, 0.22, 44, '#d4b98c');
  m.prism([0, -2.4, 0], R * 0.7, R * 0.965, 1.7, 17, '#a9764f');
  m.prism([0, -4.4, 0], R * 0.3, R * 0.7, 2.0, 11, '#946746', { spin: 0.4 });
  m.prism([0, -6.0, 0], 0.2, R * 0.3, 1.6, 7, '#7f5a3e', { spin: 0.9 });
  const q = rng('rocks'); for (let i = 0; i < 14; i++) { const a = q() * Math.PI * 2, d = R * (0.35 + q() * 0.45); m.blob([Math.cos(a) * d, -2.2 - (1 - d / R) * 4 - q() * 0.4, Math.sin(a) * d], 0.5 + q() * 0.6, i % 2 ? '#8a6244' : '#9c7050', `hang${i}`, { jit: 0.3 }); }
  // softer patches of grass
  for (let i = 0; i < 26; i++) { const a = q() * Math.PI * 2, d = Math.sqrt(q()) * R * 0.85; m.prism([Math.cos(a) * d, 0.001 + i * 0.0001, Math.sin(a) * d], 0.6 + q() * 1.1, 0.6, 0.004, 6, i % 2 ? '#a1b678' : '#b0c386', { spin: q() }); }
}
const stones = (m, pts, seed) => { const q = rng(seed); pts.forEach(([x, z]) => m.prism([x + (q() - 0.5) * 0.12, 0.01, z + (q() - 0.5) * 0.12], 0.3 + q() * 0.06, 0.27, 0.07, 7, '#e3d9bc', { top: '#f0e8d0', spin: q() * 3 })); };
const line = (a, b, step = 0.72) => { const d = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.floor(d / step); return Array.from({ length: n }, (_, i) => { const t = (i + 0.5) / n; return [a[0] + (b[0] - a[0]) * t + Math.sin(t * Math.PI) * 0.35, a[1] + (b[1] - a[1]) * t]; }); };
function buildScene({ me = false, buddy = null, yard = [] } = {}) {
  const m = new Mesh();
  ground(m);
  // the ring path round the tree, and paths out to each place
  const ring = Array.from({ length: 34 }, (_, i) => { const a = (i / 34) * Math.PI * 2; return [Math.cos(a) * 4.2, Math.sin(a) * 4.2]; });
  stones(m, ring, 'ring');
  stones(m, line([0, 4.7], [0, 11.4]), 'front');
  for (const [k, from] of [['cottage', [-3.1, -2.9]], ['yard', [3, -3]], ['box', [4, 1.4]], ['mail', [1, 5.4]], ['pond', [-3.8, 1.9]]]) {
    const to = SPOT[k], t = k === 'pond' ? 0.68 : 0.78; stones(m, line(from, [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]), k);
  }
  cottage(m, SPOT.cottage[0], SPOT.cottage[1], 0.7);
  pond(m, SPOT.pond[0], SPOT.pond[1]);
  // the orchard yard: a fence with a gap, and room for grown trees
  const [yx, yz] = SPOT.yard;
  for (let i = 0; i < 22; i++) { const a = (i / 22) * Math.PI * 2; if (a > 1.9 && a < 2.7) continue; const px = yx + Math.cos(a) * 2.8, pz = yz + Math.sin(a) * 2.8; m.box([px, 0, pz], 0.16, 0.62, 0.16, '#f2ead4');
    const b = ((i + 1) / 22) * Math.PI * 2; if (!(b > 1.9 && b < 2.7)) { const nx = yx + Math.cos(b) * 2.8, nz = yz + Math.sin(b) * 2.8, len = Math.hypot(nx - px, nz - pz); m.at((px + nx) / 2, 0.36, (pz + nz) / 2, -Math.atan2(nz - pz, nx - px)); m.box([0, 0, 0], len, 0.1, 0.07, '#f2ead4'); m.end(); } }
  const planted = yard.slice(-12), n = planted.length; // the newest dozen; the full list is on the page
  planted.forEach((t, i) => { // a sunflower spiral, so the orchard fills evenly
    const d = n === 1 ? 0 : Math.sqrt(i + 0.4) * (2.25 / Math.sqrt(n)), a = i * 2.39996;
    fullTree(m, yx + Math.cos(a) * d, yz + Math.sin(a) * d, t.state === 'fruit' ? 7 : Math.max(3, t.good), { fruit: t.fruit, seed: t.seed, withered: t.state !== 'fruit', s: n < 5 ? 0.52 : n < 9 ? 0.43 : 0.36 });
  });
  if (!n) { flowers(m, yx - 0.8, yz, '#f6c453', 'plot1'); flowers(m, yx + 0.8, yz + 0.4, '#f19db3', 'plot2'); }
  // a little pavilion for the mystery box
  const [bx, bz] = SPOT.box;
  m.prism([bx, 0, bz], 1.7, 1.7, 0.2, 8, '#d9cfb4', { top: '#ece3ca' });
  for (let i = 0; i < 8; i += 2) { const a = (i / 8) * Math.PI * 2 + 0.39; m.box([bx + Math.cos(a) * 1.35, 0.2, bz + Math.sin(a) * 1.35], 0.16, 1.9, 0.16, '#f2ead4'); }
  m.prism([bx, 2.1, bz], 1.95, 1.85, 0.14, 8, '#f2ead4'); m.prism([bx, 2.24, bz], 1.85, 0, 1.15, 8, '#c97352'); m.blob([bx, 3.45, bz], 0.14, '#f3d27a', 'finial');
  mailbox(m, SPOT.mail[0], SPOT.mail[1], -0.5);
  arch(m, 0, 10.6, 0);
  bench(m, -2.6, 5.4, 0.5); bench(m, 5.2, -1.2, -1.3);
  for (const [x, z] of [[-1, 6.2], [1.1, 8.8], [-3.9, -3.6], [3.9, -3.7], [4.9, 0.4]]) lamp(m, x, z);
  // a signpost
  m.box([-1.5, 0, 8.2], 0.14, 1.2, 0.14, '#8a6446'); for (const [y, r] of [[0.95, 0.4], [0.62, -0.5]]) { m.at(-1.5, y, 8.2, r); m.box([0.3, 0, 0], 0.85, 0.22, 0.08, '#c79a6b'); m.end(); }
  // planting round the edge, denser at the back
  const q = rng('edge');
  for (let i = 0; i < 38; i++) {
    const a = (i / 38) * Math.PI * 2 + q() * 0.08, d = R * (0.86 + q() * 0.09), x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (z > 8.5 && Math.abs(x) < 3.4) continue;
    if (Math.hypot(x - yx, z - yz) < 3.5) continue;
    if (i % 5 === 0) roundTree(m, x, z, 0.85 + q() * 0.35, 'blossom'); else if (i % 3 === 0) roundTree(m, x, z, 0.75 + q() * 0.45, 'green'); else pine(m, x, z, 0.75 + q() * 0.55);
  }
  roundTree(m, -9.2, -0.8, 1, 'green'); roundTree(m, 8.9, 5.2, 0.9, 'blossom'); pine(m, -3.2, -8.4, 1); roundTree(m, -0.6, -8.8, 1.1, 'blossom'); roundTree(m, 8.6, -0.6, 0.8, 'green'); pine(m, -8.4, 6.2, 0.9);
  const colours = ['#f6c453', '#f19db3', '#b79be0', '#f4f0de', '#ef7f6b'];
  [[-4.4, -6.9], [-1.6, -6], [2, -7.4], [-8.2, -2.8], [-4.6, 7.6], [-6.9, 6], [5.6, 6.2], [7.9, 6.2], [8.8, 2], [3, 9.4], [-9.4, 1.8], [-3.2, 9.6], [2.4, -5], [-5.7, 0.2]].forEach(([x, z], i) => flowers(m, x, z, colours[i % 5], `fl${i}`));
  for (const [x, z, s] of [[-5, -2.6, 1], [-8.6, -5.4, 1.2], [1.6, -6.4, 0.9], [-2, 7.2, 0.8], [4.8, 8.6, 1.1], [9.6, -2.6, 1], [-7.6, 0.6, 0.8], [6.1, 5.1, 0.7]]) bush(m, x, z, s);
  for (let i = 0; i < 340; i++) { const a = q() * Math.PI * 2, d = Math.sqrt(q()) * R * 0.95, x = Math.cos(a) * d, z = Math.sin(a) * d; if (Math.abs(d - 4.2) > 0.55 && Math.hypot(x - SPOT.pond[0], z - SPOT.pond[1]) > 2.1 && Math.hypot(x - bx, z - bz) > 2 && Math.hypot(x - SPOT.cottage[0], z - SPOT.cottage[1]) > 2.4) tuft(m, x, z, `t${i}`); }
  for (const [x, z, r] of [[-9, 3.8, 0.4], [3.6, -9, 0.5], [9.8, 3.8, 0.35], [-4.5, 5.4, 0.28]]) m.blob([x, r * 0.5, z], r, '#bdb49d', `rk${x}`, { sy: 0.7, jit: 0.3 });
  // the two of you
  person(m, -1.9, 3.1, 2.65, '#e08a6a', '#4a3426', me); if (buddy !== null) person(m, 1.9, 3.1, -2.65, '#7d9fd0', '#2c2620', buddy);
  // the raised bed the tree grows in
  m.prism([0, 0, 0], 2.05, 1.95, 0.34, 18, '#d9cfb4', { top: '#e6dcc2' }); m.prism([0, 0.34, 0], 1.66, 1.66, 0.03, 18, '#9db574', { top: '#9db574' });
  flowers(m, -0.8, 0.5, '#f19db3', 'bed1'); flowers(m, 0.8, -0.5, '#f6c453', 'bed2'); flowers(m, 0.4, 0.8, '#b79be0', 'bed3');
  return m;
}
// the tree itself, at any stage from seed (0) to fruit (7)
function fullTree(m, x, z, stage, { wilt = false, withered = false, hero = false, fruit = '#d9483b', seed = 'tree', s = 1, y = 0 } = {}) {
  const q = rng(seed), leaf = (i) => (wilt ? DRY : hero ? HERO : LEAF)[i % 4];
  m.at(x, y, z, 0, s);
  if (stage === 0) { m.blob([0, 0.14, 0], 0.7, '#80603f', 'mound', { sy: 0.4 }); m.blob([0.1, 0.52, 0.1], 0.22, '#e0bb77', 'seed', { sy: 0.78, jit: 0.05, sub: 1 }); }
  else if (stage <= 2) {
    const h = (stage === 1 ? 0.75 : 1.45) * (wilt ? 0.8 : 1);
    m.blob([0, 0.08, 0], 0.62, '#80603f', 'mound', { sy: 0.3 }); m.sway = 0.6;
    m.prism([0, 0.1, 0], 0.1, 0.06, h, 6, wilt ? '#a28a49' : '#6d8a47', { lean: [wilt ? 0.25 : 0, 0] });
    (stage === 1 ? [[-0.32, 0, 0], [0.34, 0.05, 0]] : [[-0.42, -0.25, 0.05], [0.42, -0.1, -0.05], [0, 0.18, 0], [0.05, -0.55, 0.42], [-0.05, -0.45, -0.4]]).forEach(([dx, dy, dz], i) => m.blob([dx + (wilt ? 0.25 : 0), h + 0.1 + dy - (wilt ? 0.15 : 0), dz], stage === 1 ? 0.3 : 0.4, leaf(i), `lf${i}`, { sy: wilt ? 0.35 : 0.55 }));
    m.sway = 0;
  } else {
    const k = [0, 0, 0, 0.95, 1.2, 1.42, 1.58, 1.66][stage] * (wilt ? 0.88 : 1), trunk = [0, 0, 0, 1.5, 2.0, 2.4, 2.7, 2.8][stage];
    m.prism([0, 0, 0], 0.26 + k * 0.17, 0.17 + k * 0.07, trunk * 0.55, 8, '#8a6446'); m.prism([0, trunk * 0.55, 0], 0.17 + k * 0.07, 0.13, trunk * 0.6, 8, '#94704f', { lean: [0.1, 0] });
    for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; m.prism([Math.cos(a) * 0.2, 0, Math.sin(a) * 0.2], 0.17, 0.02, 0.32, 5, '#7d5a40', { lean: [Math.cos(a) * 0.4 * k, Math.sin(a) * 0.4 * k] }); }
    for (const [a, h] of [[0.4, 0.62], [2.5, 0.75], [4.4, 0.7]]) m.prism([0.03, trunk * h, 0], 0.13, 0.06, k * 0.85, 5, '#8a6446', { lean: [Math.cos(a) * k * 0.75, Math.sin(a) * k * 0.75] });
    if (withered) { // stopped growing: bare branches and a few dry leaves
      for (let i = 0; i < 4; i++) { const a = i * 1.7 + 0.5, lean = [Math.cos(a) * k * 0.9, Math.sin(a) * k * 0.9], h = k * (0.8 + (i % 2) * 0.5);
        m.prism([0, trunk * 0.85, 0], 0.16, 0.07, h, 5, '#7a5a40', { lean }); m.blob([lean[0], trunk * 0.85 + h, lean[1]], 0.3, DRY[i % 4], `tip${i}`, { sy: 0.6 }); }
      m.end(); return;
    }
    const cy = trunk + k * 0.72 - (wilt ? 0.3 : 0);
    const crowns = [[0, 0.05, 0, 1], [-0.85, -0.28, 0.25, 0.66], [0.88, -0.2, -0.15, 0.68], [0.15, -0.2, 0.85, 0.62], [-0.2, -0.15, -0.85, 0.64], [0.05, 0.75, 0.05, 0.68], [-0.62, 0.38, -0.35, 0.55], [0.6, 0.42, 0.4, 0.55], [-0.5, 0.2, 0.62, 0.5], [0.55, 0.12, -0.65, 0.52]].slice(0, stage === 3 ? 3 : stage === 4 ? 6 : 10);
    m.sway = 0.75;
    crowns.forEach(([dx, dy, dz, r], i) => m.blob([dx * k, cy + dy * k, dz * k], r * k, leaf(i), `${seed}c${i}`, { sy: wilt ? 0.84 : 0.94, sub: hero ? 1 : 0, jit: hero ? 0.09 : 0.14 }));
    const surface = (n, fn) => { for (let i = 0; i < n; i++) { const [dx, dy, dz, r] = crowns[i % crowns.length], a = q() * Math.PI * 2, up = -0.35 + q() * 1.25, f = Math.sqrt(Math.max(0, 1 - up * up));
      fn([dx * k + Math.cos(a) * f * r * k * 1.05, cy + dy * k + up * r * k, dz * k + Math.sin(a) * f * r * k * 1.05], i); } };
    if (stage === 5 || stage === 6) surface(stage === 5 ? 95 : 55, (p, i) => m.blob(p, 0.1 + q() * 0.05, ['#f4a9bd', '#fbdde4', '#f7c3cf'][i % 3], `bl${i}`));
    if (stage === 6) surface(22, (p, i) => m.blob(p, 0.14, '#c3d46a', `bud${i}`, { jit: 0.05 }));
    if (stage === 7) surface(34, (p, i) => { m.blob(p, 0.21, fruit, `fr${i}`, { jit: 0.03, sub: 1 }); m.prism([p[0], p[1] + 0.18, p[2]], 0.02, 0.02, 0.1, 4, '#6f4d35'); });
    m.sway = 0;
    if (wilt) for (let i = 0; i < 16; i++) m.blob([(q() - 0.5) * 3.4, 0.05, (q() - 0.5) * 3.4], 0.13, DRY[i % 4], `fall${i}`, { sy: 0.22 });
  }
  m.end();
}
function mysteryGift(m, open, fruit) {
  const [x, z] = GIFT; m.prism([x, 0, z], 0.95, 0.85, 0.3, 8, '#d9cfb4', { top: '#ece3ca' }); m.at(x, 0.3, z, -0.5, 1.2);
  m.box([0, 0, 0], 0.95, 0.72, 0.95, '#f6e9c4'); m.box([0, 0, 0], 0.2, 0.73, 0.97, '#d96c5b'); m.box([0, 0, 0], 0.97, 0.728, 0.2, '#d96c5b');
  if (open) { m.at(-0.8, 0, 0.5, 0.7); m.box([0, 0, 0], 1.05, 0.2, 1.05, '#ecdcb0'); m.end(); m.blob([0, 1.3, 0], 0.42, fruit, 'prize', { jit: 0.02, sub: 1 }); m.prism([0, 1.68, 0], 0.04, 0.04, 0.2, 5, '#6f4d35'); m.blob([0.18, 1.85, 0], 0.15, '#7ea35a', 'pl', { sy: 0.35 }); }
  else { m.box([0, 0.72, 0], 1.08, 0.2, 1.08, '#ecdcb0'); m.box([0, 0.73, 0], 0.22, 0.2, 1.1, '#d96c5b'); m.blob([-0.18, 1.06, 0], 0.19, '#d96c5b', 'bow1', { sy: 0.6 }); m.blob([0.18, 1.06, 0], 0.19, '#d96c5b', 'bow2', { sy: 0.6 }); }
  m.end();
}
function cloudMesh(seed, s) { const m = new Mesh(); [[0, 0, 0, 0.9], [0.9, -0.12, 0.1, 0.65], [-0.85, -0.15, -0.05, 0.6], [0.2, 0.35, -0.15, 0.6], [-0.35, 0.2, 0.3, 0.5]].forEach(([x, y, z, r], i) => m.blob([x * s, y * s, z * s], r * s, '#fbf6e6', `${seed}${i}`, { sy: 0.72, sub: i === 0 ? 1 : 0, jit: 0.1 })); return m; }


// ---------------------------------------------------------------- the hero the app mounts
const VS = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNor; layout(location=2) in vec3 aCol; layout(location=3) in float aSway;
uniform mat4 uVP, uLight; uniform vec3 uOffset; uniform float uTime;
out vec3 vNor, vCol; out vec4 vShadow;
void main() {
  vec3 p = aPos + uOffset;
  p.x += sin(uTime * 1.4 + aPos.z * 0.8 + aPos.y) * aSway * 0.05;
  p.z += cos(uTime * 1.1 + aPos.x * 0.7) * aSway * 0.035;
  vNor = aNor; vCol = aCol; vShadow = uLight * vec4(p, 1.0); gl_Position = uVP * vec4(p, 1.0);
}`;
const FS = `#version 300 es
precision highp float; precision highp sampler2DShadow;
in vec3 vNor, vCol; in vec4 vShadow; uniform sampler2DShadow uShadow; uniform vec3 uDir; uniform int uTaps;
out vec4 o;
void main() {
  vec3 n = normalize(vNor), s = vShadow.xyz / vShadow.w * 0.5 + 0.5;
  float lit = 1.0;
  if (s.x > 0.0 && s.x < 1.0 && s.y > 0.0 && s.y < 1.0 && s.z < 1.0) {
    float sum = 0.0, count = 0.0;
    for (int x = -uTaps; x <= uTaps; x++) for (int y = -uTaps; y <= uTaps; y++) { sum += texture(uShadow, vec3(s.xy + vec2(x, y) * (2.2 / float(uTaps)) / 2048.0, s.z - 0.0018)); count += 1.0; }
    lit = sum / count;
  }
  vec3 hemi = mix(vec3(0.50, 0.47, 0.42), vec3(0.66, 0.70, 0.70), n.y * 0.5 + 0.5);
  o = vec4(vCol * (hemi + vec3(0.46, 0.41, 0.29) * max(dot(n, uDir), 0.0) * lit), 1.0);
}`;
const DFS = `#version 300 es
precision highp float; void main() {}`;
const SIZE = 2048, SUN = V.norm([-0.55, 0.78, 0.38]);
const lightVP = mul(ortho(16, 1, 80), lookAt([SUN[0] * 36, SUN[1] * 36, SUN[2] * 36], [0, 0, 0]));
const ICON = {
  tree: '<svg viewBox="0 0 24 24"><path d="M12 21v-6"/><path d="M12 3a5 5 0 0 0-4.6 7A3.8 3.8 0 0 0 9 17h6a3.8 3.8 0 0 0 1.6-7A5 5 0 0 0 12 3z"/></svg>',
  tasks: '<svg viewBox="0 0 24 24"><path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/><path d="m9 15 2 2 4-4"/></svg>',
  yard: '<svg viewBox="0 0 24 24"><path d="M4 21V8l2-3 2 3v13M10 21V8l2-3 2 3v13M16 21V8l2-3 2 3v13M2 12h20M2 17h20"/></svg>',
  box: '<svg viewBox="0 0 24 24"><path d="M4 10h16v10H4zM3 7h18v3H3zM12 7v13"/><path d="M12 7C9 7 7.5 6 8 4.5S11 4 12 7c1-3 3.5-4 4-2.5S15 7 12 7z"/></svg>',
  mail: '<svg viewBox="0 0 24 24"><path d="M3 6h18v12H3z"/><path d="m3 7 9 7 9-7"/></svg>',
};
const LOGO = '<svg viewBox="0 0 32 32" width="28" height="28"><path d="M16 29V15" stroke="#8a6446" stroke-width="3" stroke-linecap="round"/><circle cx="16" cy="11" r="8" fill="#7ea35a"/><circle cx="10" cy="15" r="5" fill="#6d9450"/><circle cx="22" cy="15" r="5" fill="#8db165"/><circle cx="19" cy="9" r="2.2" fill="#d9483b"/><circle cx="12" cy="13" r="2" fill="#d9483b"/></svg>';
const PLACES = {
  // yaw and pitch keep the big tree out of the way of what you're visiting
  tree: { at: [0, 6, 0], look: [0, 4.2, 0], dist: 27, yaw: 0.18, pitch: 0.5 },
  tasks: { at: [SPOT.cottage[0], 3.9, SPOT.cottage[1]], look: [SPOT.cottage[0], 1, SPOT.cottage[1]], dist: 21, yaw: 0.35, pitch: 0.55 },
  yard: { at: [SPOT.yard[0] + 1.4, 2.4, SPOT.yard[1] + 0.6], look: [SPOT.yard[0], 0.6, SPOT.yard[1]], dist: 18, yaw: 0.65, pitch: 0.82 },
  box: { at: [GIFT[0], 2.5, GIFT[1]], look: [GIFT[0], 1.0, GIFT[1]], dist: 15, yaw: 0.2, pitch: 0.52 },
  mail: { at: [SPOT.mail[0], 1.9, SPOT.mail[1]], look: [SPOT.mail[0], 0.8, SPOT.mail[1]], dist: 17, yaw: 0.15, pitch: 0.55 },
};
const HOME = { target: [0, 0.6, 0.6], dist: 52, pitch: 0.7 };
const TREE_SCALE = [2.0, 2.0, 1.9, 1.7, 1.65, 1.62, 1.6, 1.62], TREE_TOP = [2.0, 3.0, 4.3, 5.6, 6.9, 7.7, 8.4, 8.7];

let hero = null, canDo = null;
function supported() {
  if (canDo === null) { try { canDo = !!document.createElement('canvas').getContext('webgl2'); } catch { canDo = false; } }
  return canDo;
}
function createHero() {
  const el = document.createElement('div');
  el.className = 'g3';
  el.innerHTML = '<canvas aria-label="Your tree in a 3D garden on a floating island"></canvas><div class="g3-who g3-card"></div><div class="g3-side"></div><div class="g3-tags"></div><div class="g3-panel g3-card" aria-live="polite"></div><nav class="g3-nav g3-card"></nav>';
  const canvas = el.querySelector('canvas'), who = el.querySelector('.g3-who'), side = el.querySelector('.g3-side'), tagBox = el.querySelector('.g3-tags'), panel = el.querySelector('.g3-panel'), nav = el.querySelector('.g3-nav');
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: true, powerPreference: 'low-power' });
  if (!gl) return null;
  const program = (vs, fs) => {
    const p = gl.createProgram();
    for (const [type, code] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) { const sh = gl.createShader(type); gl.shaderSource(sh, code); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh)); gl.attachShader(p, sh); }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {}; for (const n of ['uVP', 'uLight', 'uOffset', 'uTime', 'uShadow', 'uDir', 'uTaps']) u[n] = gl.getUniformLocation(p, n);
    return { p, u };
  };
  const main = program(VS, FS), depth = program(VS, DFS);
  const upload = (mesh, old) => {
    if (old) { gl.deleteBuffer(old.buf); gl.deleteVertexArray(old.vao); }
    const vao = gl.createVertexArray(), buf = gl.createBuffer();
    gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.v), gl.STATIC_DRAW);
    [[0, 3, 0], [1, 3, 12], [2, 3, 24], [3, 1, 36]].forEach(([loc, n, off]) => { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, n, gl.FLOAT, false, 40, off); });
    gl.bindVertexArray(null);
    return { vao, buf, n: mesh.v.length / 10 };
  };
  const shadowTex = gl.createTexture(), shadowFb = gl.createFramebuffer();
  gl.bindTexture(gl.TEXTURE_2D, shadowTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, SIZE, SIZE, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE], [gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, shadowTex, 0); gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  const clouds = [[-15.5, 3.4, 2, 1.25, 0], [13, 7.2, -9, 1.0, 1.9], [16, 1.8, 7, 0.95, 3.4], [-8, 8.6, -12, 0.9, 5.0]].map(([x, y, z, s, ph], i) => ({ x, y, z, ph, gpu: upload(cloudMesh(`cl${i}`, s)) }));
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const cam = { target: [...HOME.target], dist: HOME.dist, yaw: -0.45, pitch: HOME.pitch };
  let goal = { target: [...HOME.target], dist: HOME.dist, pitch: HOME.pitch, yaw: 0.18 };
  let data = null, world = null, tree = null, gift = null, petals = null, worldSig = '', treeSig = '', viewKey = null, tags = [], running = false, onScreen = true, last = 0, dead = false;

  function visit(key) {
    const p = PLACES[key];
    if (!p || !data || !data.places.some((x) => x.key === key)) return;
    viewKey = key;
    const narrow = el.clientWidth < 700;
    goal = { target: [p.look[0], p.look[1] - (narrow ? 2.2 : 0), p.look[2]], dist: p.dist, pitch: p.pitch, yaw: p.yaw };
    fillPanel();
    start();
  }
  function home() { viewKey = null; goal = { target: [...HOME.target], dist: HOME.dist, pitch: HOME.pitch, yaw: cam.yaw }; fillPanel(); }
  function fillPanel() {
    const html = viewKey && data.panels[viewKey];
    panel.classList.toggle('open', !!html);
    const next = html ? `<button class="g3-x" data-gx aria-label="Back to the garden">✕</button>${html}` : '';
    if (panel.dataset.html !== next) { panel.dataset.html = next; panel.innerHTML = next; }
    nav.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.k === viewKey));
  }
  panel.addEventListener('click', (e) => { if (e.target.closest('[data-gx]')) { e.stopPropagation(); home(); } });
  nav.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) visit(b.dataset.k); });

  function update(next) {
    data = next;
    const ws = JSON.stringify([data.people, data.yard.map((t) => [t.state, t.good, t.fruit, t.seed])]);
    if (ws !== worldSig) { worldSig = ws; world = upload(buildScene({ me: data.people.me, buddy: data.people.buddy, yard: data.yard }), world); }
    const ts = JSON.stringify([data.stage, data.wilt, data.fruit]);
    if (ts !== treeSig) {
      treeSig = ts;
      const t = new Mesh(); fullTree(t, 0, 0, data.stage, { wilt: data.wilt, fruit: data.fruit, hero: true, y: 0.34, s: TREE_SCALE[data.stage] }); tree = upload(t, tree);
      const g = new Mesh(); mysteryGift(g, data.stage >= 7, data.fruit); gift = upload(g, gift);
      const p = new Mesh(), q = rng('petals');
      if (data.stage >= 5 && !data.wilt) for (let i = 0; i < 26; i++) p.blob([(q() - 0.5) * 6, 0, (q() - 0.5) * 6], 0.07, data.stage >= 7 ? '#9dbd6a' : '#f7c3cf', `p${i}`, { sy: 0.25 });
      if (petals) { gl.deleteBuffer(petals.buf); gl.deleteVertexArray(petals.vao); petals = null; }
      if (p.v.length) petals = upload(p);
    }
    if (who.dataset.html !== data.who) { who.dataset.html = data.who; who.innerHTML = `<div class="g3-face">${LOGO}</div><div>${data.who}</div>`; }
    if (side.dataset.html !== data.side) { side.dataset.html = data.side; side.innerHTML = data.side; }
    const ps = JSON.stringify(data.places);
    if (tagBox.dataset.sig !== ps) {
      tagBox.dataset.sig = ps;
      tagBox.textContent = ''; nav.textContent = '';
      tags = data.places.map((p) => {
        const b = document.createElement('button');
        b.className = 'g3-tag g3-card'; b.dataset.k = p.key; b.type = 'button'; b.setAttribute('aria-label', `${p.title}: ${p.sub}`);
        b.innerHTML = `<i>${ICON[p.key]}</i><span><b></b><small></small></span>`;
        b.querySelector('b').textContent = p.title; b.querySelector('small').textContent = p.sub;
        b.onclick = () => visit(p.key);
        tagBox.appendChild(b);
        const n = document.createElement('button'); n.type = 'button'; n.dataset.k = p.key; n.innerHTML = `${ICON[p.key]}<b></b>`; n.querySelector('b').textContent = p.nav; nav.appendChild(n);
        return { key: p.key, el: b };
      });
      nav.hidden = !data.places.length;
    }
    if (viewKey && !data.places.some((p) => p.key === viewKey)) viewKey = null;
    fillPanel();
  }

  // sideways drags turn the island (up and down still scrolls the page on a phone); pinch zooms
  const fingers = new Map(); let pinch = 0;
  canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); fingers.set(e.pointerId, [e.clientX, e.clientY]); goal = null; });
  canvas.addEventListener('pointermove', (e) => {
    const old = fingers.get(e.pointerId); if (!old) return;
    fingers.set(e.pointerId, [e.clientX, e.clientY]);
    if (fingers.size === 2) { const [a, b] = [...fingers.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch) cam.dist = Math.max(16, Math.min(70, cam.dist * pinch / d)); pinch = d; return; }
    cam.yaw -= (e.clientX - old[0]) / 170;
    if (e.pointerType === 'mouse') cam.pitch = Math.max(0.32, Math.min(1.15, cam.pitch + (e.clientY - old[1]) / 300));
  });
  const lift_ = (e) => { fingers.delete(e.pointerId); pinch = 0; };
  canvas.addEventListener('pointerup', lift_); canvas.addEventListener('pointercancel', lift_);
  canvas.addEventListener('wheel', (e) => { if (!e.ctrlKey) return; e.preventDefault(); goal = null; cam.dist = Math.max(16, Math.min(70, cam.dist * (1 + e.deltaY / 160))); }, { passive: false }); // trackpad pinch
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); dead = true; });

  function paint(t) {
    const narrow = el.clientWidth < 700, dpr = Math.min(narrow ? 1.75 : 2, devicePixelRatio || 1);
    const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
    if (!w || !h) return;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const aspect = w / h, dist = cam.dist * Math.max(1, 0.9 / aspect), pitch = cam.pitch + (!viewKey && aspect < 0.8 ? 0.28 : 0);
    const eye = [cam.target[0] + dist * Math.cos(pitch) * Math.sin(cam.yaw), cam.target[1] + dist * Math.sin(pitch), cam.target[2] + dist * Math.cos(pitch) * Math.cos(cam.yaw)];
    const vp = mul(perspective(0.55, aspect, 1, 400), lookAt(eye, cam.target));
    const draw = (prog, matrix) => {
      gl.useProgram(prog.p);
      gl.uniformMatrix4fv(prog.u.uVP, false, matrix); gl.uniformMatrix4fv(prog.u.uLight, false, lightVP); gl.uniform1f(prog.u.uTime, still ? 0 : t);
      if (prog === main) { gl.uniform3fv(prog.u.uDir, SUN); gl.uniform1i(prog.u.uShadow, 0); gl.uniform1i(prog.u.uTaps, narrow ? 1 : 2); }
      const one = (m, o = [0, 0, 0]) => { if (!m) return; gl.uniform3fv(prog.u.uOffset, o); gl.bindVertexArray(m.vao); gl.drawArrays(gl.TRIANGLES, 0, m.n); };
      one(world); one(tree); one(gift);
      if (petals && !still) for (let i = 0; i < 2; i++) one(petals, [Math.sin(t * 0.4 + i * 3) * 0.7, 4.6 - ((t * 0.5 + i * 2.4) % 4.4), Math.cos(t * 0.3 + i) * 0.5]);
      for (const c of clouds) one(c.gpu, [c.x + Math.sin(still ? 0 : t * 0.09 + c.ph) * 2.2, c.y + Math.sin(still ? 0 : t * 0.5 + c.ph) * 0.25, c.z]);
    };
    gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFb); gl.viewport(0, 0, SIZE, SIZE); gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.bindTexture(gl.TEXTURE_2D, null); gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(2, 4);
    draw(depth, lightVP);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, shadowTex);
    draw(main, vp);
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    for (const tag of tags) {
      const [x, y, z] = tag.key === 'tree' ? [0, TREE_TOP[data.stage], 0] : PLACES[tag.key].at;
      const cx = vp[0] * x + vp[4] * y + vp[8] * z + vp[12], cy = vp[1] * x + vp[5] * y + vp[9] * z + vp[13], cz = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
      const hide = cz <= 0 || (viewKey && (viewKey !== tag.key || narrow));
      tag.el.style.display = hide ? 'none' : '';
      if (hide) continue;
      const sx = (cx / cz * 0.5 + 0.5) * cw, sy = (0.5 - cy / cz * 0.5) * ch, half = tag.el.offsetWidth / 2;
      tag.el.style.left = `${Math.max(half + 4, Math.min(cw - half - 4, sx))}px`;
      tag.el.style.top = `${Math.max(tag.el.offsetHeight + 60, Math.min(ch - 70, sy))}px`;
      tag.el.style.zIndex = Math.max(1, Math.round(200 - cz));
    }
  }
  function step(ms) {
    if (!el.isConnected || !onScreen || dead) { running = false; return; }
    const t = ms / 1000;
    if (el.clientWidth < 700 && t - last < 1 / 31) { requestAnimationFrame(step); return; } // 30 frames a second is plenty on a phone
    const dt = Math.min(0.25, t - last || 0.016); last = t; // (capped, so a stalled tab doesn't jump)
    if (goal) { const k = still ? 1 : 1 - Math.exp(-dt * 3.4); cam.target = cam.target.map((v, i) => v + (goal.target[i] - v) * k); cam.dist += (goal.dist - cam.dist) * k; cam.pitch += (goal.pitch - cam.pitch) * k; cam.yaw += (goal.yaw - cam.yaw) * k; }
    paint(t);
    requestAnimationFrame(step);
  }
  function start() { if (!running && el.isConnected && onScreen && !dead) { running = true; requestAnimationFrame(step); } }
  new IntersectionObserver((list) => { onScreen = list[0].isIntersecting; start(); }).observe(el);

  return { el, update, start, visit, paint, get dead() { return dead; } };
}
// Put the garden in the page. The same canvas is moved into each new render, so the view stays where it was.
function attach(slot, data) {
  if (!hero || hero.dead) hero = createHero();
  if (!hero) return false;
  slot.appendChild(hero.el);
  hero.update(data);
  hero.paint(performance.now() / 1000); // one frame at once, so it never flashes empty
  hero.start();
  return true;
}
window.Garden3D = { supported, attach, visit: (key) => hero && hero.visit(key) };
})();
