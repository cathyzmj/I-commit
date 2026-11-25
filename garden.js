// A tiny low-poly 3D painter for "Build a tree together": a floating island, a tree at each of its stages,
// a mystery box and a yard of grown trees. No library: meshes are lists of flat faces, shaded by one light
// and drawn back to front on a 2D canvas. Drag sideways to turn the island.
(() => {
  const rng = (str) => {
    let h = 2166136261;
    for (const ch of String(str)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    return () => { h |= 0; h = (h + 0x6D2B79F5) | 0; let t = Math.imul(h ^ (h >>> 15), 1 | h); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  };
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

  // ---- shapes. Each face remembers its shape's middle, so its outward side is always known.
  // layer: 0 the island, 1 things lying on it (shadows, stones), 2 things standing on it.
  const face = (out, pts, color, mid, layer = 2, alpha = 1) => out.push({ pts, color, mid, layer, alpha });
  const PHI = (1 + Math.sqrt(5)) / 2;
  const ICO_V = [[-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0], [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI], [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1]].map(norm);
  const ICO_F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  function blob(out, c, r, color, seed = 'b', { sy = 1, jitter = 0.16, layer = 2 } = {}) {
    const rnd = rng(seed);
    const v = ICO_V.map((p) => { const k = r * (1 + (rnd() - 0.5) * jitter * 2); return [c[0] + p[0] * k, c[1] + p[1] * k * sy, c[2] + p[2] * k]; });
    for (const [a, b, d] of ICO_F) face(out, [v[a], v[b], v[d]], color, c, layer);
  }
  // a prism or frustum standing on y0
  function prism(out, [x, y, z], r0, r1, h, sides, color, { top = color, layer = 2, lean = [0, 0], spin = 0 } = {}) {
    const ring = (r, yy, dx, dz) => Array.from({ length: sides }, (_, i) => { const a = spin + (i / sides) * Math.PI * 2; return [x + dx + Math.cos(a) * r, yy, z + dz + Math.sin(a) * r]; });
    const lo = ring(r0, y, 0, 0), hi = ring(r1, y + h, lean[0], lean[1]), mid = [x + lean[0] / 2, y + h / 2, z + lean[1] / 2];
    for (let i = 0; i < sides; i++) { const j = (i + 1) % sides; face(out, [lo[i], lo[j], hi[j], hi[i]], color, mid, layer); }
    if (r1 > 0.001) face(out, hi, top, mid, layer);
  }
  function box(out, [x, y, z], w, h, d, color, layer = 2) {
    const X = w / 2, Z = d / 2, mid = [x, y + h / 2, z];
    const p = (a, b, c) => [x + a * X, y + b * h, z + c * Z];
    [[p(-1, 0, 1), p(1, 0, 1), p(1, 1, 1), p(-1, 1, 1)], [p(1, 0, -1), p(-1, 0, -1), p(-1, 1, -1), p(1, 1, -1)], [p(1, 0, 1), p(1, 0, -1), p(1, 1, -1), p(1, 1, 1)],
      [p(-1, 0, -1), p(-1, 0, 1), p(-1, 1, 1), p(-1, 1, -1)], [p(-1, 1, 1), p(1, 1, 1), p(1, 1, -1), p(-1, 1, -1)]].forEach((f) => face(out, f, color, mid, layer));
  }
  const shadow = (out, x, z, r) => face(out, Array.from({ length: 12 }, (_, i) => { const a = (i / 12) * Math.PI * 2; return [x + 0.25 * r + Math.cos(a) * r, 0.01, z - 0.15 * r + Math.sin(a) * r]; }), '#51703f', null, 1, 0.28);

  // ---- things on the island
  const LEAF = ['#7ea35a', '#6d9450', '#8db165'], DRY = ['#b3a05c', '#a08a4e', '#bfae6a'];
  function island(out, R) {
    prism(out, [0, -0.45, 0], R, R, 0.45, 36, '#8ea96b', { top: '#a9bf86', layer: 0 });
    prism(out, [0, -2.9, 0], R * 0.58, R * 0.97, 2.45, 18, '#b0875f', { top: '#b0875f', layer: 0 });
    prism(out, [0, -4.8, 0], 0.25, R * 0.58, 1.9, 10, '#8f6a4b', { layer: 0 });
  }
  function flower(out, x, z, color, seed) {
    prism(out, [x, 0, z], 0.03, 0.02, 0.22, 4, '#6d9450');
    blob(out, [x, 0.27, z], 0.09, color, seed);
  }
  function pine(out, x, z, s, seed) {
    shadow(out, x, z, 0.55 * s);
    prism(out, [x, 0, z], 0.1 * s, 0.08 * s, 0.35 * s, 5, '#8a6446');
    [[0.62, 0.3], [0.5, 0.75], [0.36, 1.18]].forEach(([r, y], i) => prism(out, [x, y * s, z], r * s, 0, 0.75 * s, 7, ['#587a47', '#638651', '#6e9259'][i], { spin: seed + i }));
  }
  function roundTree(out, x, z, s, color, seed) {
    shadow(out, x, z, 0.6 * s);
    prism(out, [x, 0, z], 0.12 * s, 0.09 * s, 0.7 * s, 5, '#8a6446');
    blob(out, [x, 1.15 * s, z], 0.62 * s, color, seed);
  }
  function cloud(out, x, y, z, s, seed) {
    [[0, 0, 0, 0.7], [0.65, -0.1, 0.1, 0.5], [-0.6, -0.12, -0.05, 0.48], [0.15, 0.25, -0.1, 0.45]].forEach(([dx, dy, dz, r], i) => blob(out, [x + dx * s, y + dy * s, z + dz * s], r * s, '#fbfaf4', seed + i, { sy: 0.75 }));
  }
  function decorate(out, R, seed, keepClear) {
    const rnd = rng(seed);
    const spot = (min, max) => { const a = rnd() * Math.PI * 2, d = R * (min + rnd() * (max - min)); return [Math.cos(a) * d, Math.sin(a) * d]; };
    for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2 + 0.4, [x, z] = [Math.cos(a) * R * 0.86, Math.sin(a) * R * 0.86];
      if (i % 3 === 0) pine(out, x, z, 0.8 + rnd() * 0.4, i); else roundTree(out, x, z, 0.7 + rnd() * 0.35, i % 3 === 1 ? '#7b9c58' : '#efb3c2', `${seed}r${i}`); }
    for (let i = 0; i < 26; i++) { const [x, z] = spot(keepClear, 0.8); flower(out, x, z, ['#f6c453', '#f19db3', '#b79be0', '#fdf6e3'][i % 4], `${seed}f${i}`); }
  }

  // ---- the tree being grown. stage 0 (seed) to 7 (fruit)
  function growingTree(out, x, z, stage, { wilt = false, withered = false, fruit = '#d9483b', seed = 't', scale = 1 } = {}) {
    const rnd = rng(seed), s = scale;
    const leaf = (i) => (wilt || withered ? DRY : LEAF)[i % 3];
    const P = (dx, y, dz) => [x + dx * s, y * s, z + dz * s];
    if (stage <= 2) blob(out, P(0, 0.06, 0), 0.62 * s, '#93704f', `${seed}m`, { sy: 0.28 });
    if (stage === 0) { blob(out, P(0.05, 0.26, 0.08), 0.15 * s, '#d9b779', `${seed}s`, { sy: 0.8 }); return; }
    const droop = wilt ? 0.82 : 1;
    if (stage <= 2) {
      const h = (stage === 1 ? 0.55 : 1.05) * droop;
      shadow(out, x, z, 0.5 * s);
      prism(out, P(0, 0.1, 0), 0.06 * s, 0.045 * s, h * s, 5, withered ? '#8a6446' : '#6d9450', { lean: [wilt ? 0.18 * s : 0, 0] });
      const tip = wilt ? 0.18 : 0;
      const leaves = stage === 1 ? [[-0.2, 0, 0], [0.22, 0.03, 0]] : [[-0.28, -0.15, 0.05], [0.28, -0.05, -0.05], [0, 0.12, 0], [0.05, -0.35, 0.28]];
      leaves.forEach(([dx, dy, dz], i) => blob(out, P(dx + tip, 0.1 + h + dy - (wilt ? 0.1 : 0), dz), (stage === 1 ? 0.2 : 0.28) * s, leaf(i), `${seed}l${i}`, { sy: wilt ? 0.35 : 0.55 }));
      return;
    }
    const size = [0, 0, 0, 0.68, 0.86, 1.0, 1.12, 1.18][stage], trunk = [0, 0, 0, 1.1, 1.4, 1.65, 1.85, 1.95][stage];
    shadow(out, x, z, size * 1.35 * s);
    prism(out, P(0, 0, 0), (0.14 + size * 0.12) * s, 0.1 * s, (trunk + 0.25) * s, 6, '#8a6446');
    if (withered) {
      [[-0.9, 0.45, 0.15], [0.95, 0.65, -0.2], [0.15, 1.05, 0.75], [-0.3, 0.9, -0.75]].forEach(([dx, dy, dz], i) => {
        const h = (dy + 0.3) * s * size, lean = [dx * s * size, dz * s * size];
        prism(out, P(0, trunk * 0.78, 0), 0.13 * s, 0.05 * s, h, 5, '#7a5a40', { lean });
        blob(out, [x + lean[0], trunk * 0.78 * s + h, z + lean[1]], 0.22 * s, DRY[i % 3], `${seed}tip${i}`, { sy: 0.6 });
      });
      for (let i = 0; i < 5; i++) blob(out, P((rnd() - 0.5) * 2, 0.06, (rnd() - 0.5) * 2), 0.12 * s, DRY[i % 3], `${seed}d${i}`, { sy: 0.3 });
      return;
    }
    const k = size * droop, cy = trunk + size * 0.62 - (wilt ? 0.18 : 0);
    const crowns = [[0, 0, 0, 1], [-0.72, -0.32, 0.2, 0.66], [0.74, -0.24, -0.12, 0.68], [0.1, -0.18, 0.7, 0.62], [-0.12, -0.2, -0.7, 0.62], [0.05, 0.62, 0.05, 0.64]].slice(0, stage === 3 ? 1 : stage === 4 ? 3 : 6);
    crowns.forEach(([dx, dy, dz, r], i) => blob(out, P(dx * k, cy + dy * k, dz * k), r * k * s, leaf(i), `${seed}c${i}`, { sy: wilt ? 0.85 : 1 }));
    // points on the outside of the crown, all the way round
    const onCrown = (n, tag, fn) => { const q = rng(seed + tag); for (let i = 0; i < n; i++) {
      const [dx, dy, dz, r] = crowns[i % crowns.length], a = q() * Math.PI * 2, up = -0.35 + q() * 1.15, flat = Math.sqrt(Math.max(0, 1 - up * up));
      fn(P(dx * k + Math.cos(a) * flat * r * k * 1.04, cy + dy * k + up * r * k, dz * k + Math.sin(a) * flat * r * k * 1.04), i); } };
    if (stage === 5) onCrown(26, 'bloom', (p, i) => blob(out, p, 0.1 * s, i % 3 ? '#f4a9bd' : '#fbdde4', `${seed}b${i}`));
    if (stage === 6) { onCrown(18, 'bloom', (p, i) => blob(out, p, 0.085 * s, i % 3 ? '#f4a9bd' : '#fbdde4', `${seed}b${i}`)); onCrown(9, 'bud', (p, i) => blob(out, p, 0.1 * s, '#c4d46a', `${seed}g${i}`)); }
    if (stage >= 7) onCrown(18, 'fruit', (p, i) => blob(out, p, 0.17 * s, fruit, `${seed}fr${i}`, { jitter: 0.04 }));
    if (wilt) for (let i = 0; i < 7; i++) blob(out, P((rnd() - 0.5) * 2.4, 0.05, (rnd() - 0.5) * 2.4), 0.11 * s, DRY[i % 3], `${seed}fall${i}`, { sy: 0.25 });
  }
  function mysteryBox(out, x, z, open, fruit) {
    shadow(out, x, z, 0.55);
    box(out, [x, 0, z], 0.72, 0.56, 0.72, '#f3e7c8');
    box(out, [x, 0, z], 0.16, 0.565, 0.74, '#d96c5b');
    box(out, [x, 0, z], 0.74, 0.563, 0.16, '#d96c5b');
    if (open) {
      box(out, [x - 0.55, 0.02, z + 0.25], 0.6, 0.14, 0.8, '#e9d9b2');
      blob(out, [x, 1.05, z], 0.3, fruit, 'prize', { jitter: 0.04 });
      blob(out, [x + 0.12, 1.38, z], 0.1, '#7ea35a', 'prizeleaf', { sy: 0.4 });
    } else {
      box(out, [x, 0.56, z], 0.84, 0.16, 0.84, '#e9d9b2');
      box(out, [x, 0.565, z], 0.17, 0.165, 0.86, '#d96c5b');
      blob(out, [x - 0.13, 0.82, z], 0.14, '#d96c5b', 'bow1', { sy: 0.6 });
      blob(out, [x + 0.13, 0.82, z], 0.14, '#d96c5b', 'bow2', { sy: 0.6 });
    }
  }

  // ---- scenes: { faces, anchors (3D points the page puts labels on), radius }
  function treeScene({ stage, wilt, fruit, seed }) {
    const out = [], R = 4.6;
    island(out, R);
    for (let i = 0; i < 9; i++) prism(out, [Math.sin(i * 0.55) * 0.35, 0, 1.3 + i * 0.36], 0.17, 0.17, 0.04, 7, '#e9e0c6', { layer: 1, spin: i });
    decorate(out, R, 'garden', 0.46);
    growingTree(out, 0, 0, stage, { wilt, fruit, seed, scale: 1.12 });
    mysteryBox(out, 2.5, 1.5, stage >= 7, fruit);
    cloud(out, -5.3, 3.5, -1.5, 0.85, 'c1'); cloud(out, 5.2, 4.1, -2.2, 0.65, 'c2'); cloud(out, 4.9, 0.4, 2.8, 0.55, 'c3');
    const top = [0.55, 0.9, 1.7, 2.8, 3.4, 4.1, 4.5, 4.7][stage];
    return { faces: out, radius: R, tall: 5.2, anchors: { tree: [0, top + 0.35, 0], box: [2.5, -0.1, 2.1] } };
  }
  function yardScene(trees) {
    const out = [], n = trees.length, R = Math.max(4.6, Math.sqrt(n) * 2.05 + 2.2);
    island(out, R);
    for (let i = 0; i < 40; i++) { const a = (i / 40) * Math.PI * 2; if (Math.abs(a - Math.PI / 2) < 0.22) continue;
      box(out, [Math.cos(a) * R * 0.93, 0, Math.sin(a) * R * 0.93], 0.12, 0.55, 0.12, '#f4ecd8'); }
    const rnd = rng('yard');
    for (let i = 0; i < 22; i++) { const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * R * 0.85; flower(out, Math.cos(a) * d, Math.sin(a) * d, ['#f6c453', '#f19db3', '#fdf6e3'][i % 3], `y${i}`); }
    trees.forEach((t, i) => { // a sunflower spiral, so the yard fills out evenly as it grows
      const d = n === 1 ? 0 : Math.sqrt(i + 0.35) * (R * 0.74 / Math.sqrt(n)), a = i * 2.39996;
      growingTree(out, Math.cos(a) * d, Math.sin(a) * d, t.state === 'fruit' ? 7 : Math.max(3, t.good), { withered: t.state !== 'fruit', fruit: t.fruit, seed: t.seed, scale: 0.72 });
    });
    if (!n) { cloud(out, 0, 2.4, 0, 0.5, 'empty'); }
    return { faces: out, radius: R, tall: 4.6, anchors: {} };
  }

  // ---- painting
  const PITCH = 0.52, LIGHT = norm([-0.45, 0.82, 0.36]);
  function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const c = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
    return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
  }
  function projector(scene, yaw, w, h) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(PITCH), sp = Math.sin(PITCH);
    const turn = ([x, y, z]) => { const X = x * cy - z * sy, Z = x * sy + z * cy; return [X, y * cp - Z * sp, y * sp + Z * cp]; }; // right, up, towards you
    const topUp = Math.max(scene.tall * cp, scene.radius * sp + 1.2), botUp = -(scene.radius * sp + 2.4);
    const unit = Math.min(w / (scene.radius * 2.4), h / (topUp - botUp + 0.3));
    const midUp = (topUp + botUp) / 2;
    const flat = (r) => { const f = 1 + r[2] / 60; return [w / 2 + r[0] * unit * f, h / 2 - (r[1] - midUp) * unit * f]; };
    return { turn, flat, point: (p) => flat(turn(p)) };
  }
  function draw(canvas, scene, yaw) {
    const w = canvas.clientWidth, h = canvas.clientHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
    if (!w || !h) return null;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    const g = canvas.getContext('2d'), pr = projector(scene, yaw, w, h);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const light = LIGHT, list = [];
    for (const f of scene.faces) {
      let n = norm(cross(sub(f.pts[1], f.pts[0]), sub(f.pts[2], f.pts[0])));
      const centre = f.pts.reduce(add, [0, 0, 0]).map((v) => v / f.pts.length);
      if (f.mid && dot(n, sub(centre, f.mid)) < 0) n = [-n[0], -n[1], -n[2]];
      const rot = f.pts.map(pr.turn);
      if (f.mid && pr.turn(n)[2] < -0.02) continue; // facing away
      list.push({ f, pts: rot.map(pr.flat), z: rot.reduce((a, p) => a + p[2], 0) / rot.length, k: f.mid ? 0.72 + 0.36 * Math.max(0, dot(n, light)) : 1 });
    }
    list.sort((a, b) => a.f.layer - b.f.layer || a.z - b.z);
    for (const { f, pts, k } of list) {
      const c = shade(f.color, k);
      g.globalAlpha = f.alpha;
      g.fillStyle = c;
      g.beginPath();
      pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.closePath();
      g.fill();
      if (f.alpha === 1) { g.strokeStyle = c; g.lineWidth = 0.7; g.stroke(); } // closes hairline gaps between faces
    }
    g.globalAlpha = 1;
    return pr;
  }
  // Draws, places any [data-anchor] labels inside the same box, and lets a sideways drag turn the island.
  const yaws = new Map();
  function mount(canvas, scene, key) {
    const paint = () => {
      const pr = draw(canvas, scene, yaws.get(key) || 0.5);
      if (!pr) return;
      canvas.parentElement.querySelectorAll('[data-anchor]').forEach((el) => {
        const p = scene.anchors[el.dataset.anchor];
        if (!p) return;
        const [x, y] = pr.point(p), half = el.offsetWidth / 2;
        el.style.left = `${Math.max(half + 4, Math.min(canvas.clientWidth - half - 4, x))}px`;
        el.style.top = `${Math.max(el.offsetHeight + 4, Math.min(canvas.clientHeight - (p[1] < 0 ? el.offsetHeight : 0) - 4, y))}px`;
        el.style.transform = p[1] < 0 ? 'translate(-50%, 0)' : 'translate(-50%, -100%)';
        el.style.visibility = 'visible';
      });
    };
    let from = null;
    canvas.onpointerdown = (e) => { from = { x: e.clientX, yaw: yaws.get(key) || 0.5 }; canvas.setPointerCapture(e.pointerId); };
    canvas.onpointermove = (e) => { if (!from) return; yaws.set(key, from.yaw + (e.clientX - from.x) / 110); paint(); };
    canvas.onpointerup = canvas.onpointercancel = () => { from = null; };
    paint();
    return paint;
  }
  window.Garden = { treeScene, yardScene, draw, mount };
})();
