// River3D —— 零依賴的輕量 WebGL 3D 引擎：擬真水面、天空、木船、槳手、河岸森林、燈籠與水花
(function () {
'use strict';
const PI = Math.PI;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ───── 向量 / 矩陣（column-major） ─────
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const mul4 = (a, b) => { const o = new Float32Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; };
const ident = () => { const o = new Float32Array(16); o[0] = o[5] = o[10] = o[15] = 1; return o; };
const trans = (x, y, z) => { const o = ident(); o[12] = x; o[13] = y; o[14] = z; return o; };
const scl = (x, y, z) => { const o = ident(); o[0] = x; o[5] = y; o[10] = z; return o; };
const rotY = a => { const o = ident(), c = Math.cos(a), s = Math.sin(a); o[0] = c; o[2] = -s; o[8] = s; o[10] = c; return o; };
const rotX = a => { const o = ident(), c = Math.cos(a), s = Math.sin(a); o[5] = c; o[6] = s; o[9] = -s; o[10] = c; return o; };
const rotZ = a => { const o = ident(), c = Math.cos(a), s = Math.sin(a); o[0] = c; o[1] = s; o[4] = -s; o[5] = c; return o; };
const pt = (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
function persp(fovy, asp, n, f) { const t = 1 / Math.tan(fovy / 2), o = new Float32Array(16); o[0] = t / asp; o[5] = t; o[10] = (f + n) / (n - f); o[11] = -1; o[14] = 2 * f * n / (n - f); return o; }
function lookAt(e, c, u) { const z = norm(sub(e, c)), x = norm(cross(u, z)), y = cross(z, x), o = ident(); o[0] = x[0]; o[4] = x[1]; o[8] = x[2]; o[1] = y[0]; o[5] = y[1]; o[9] = y[2]; o[2] = z[0]; o[6] = z[1]; o[10] = z[2]; o[12] = -dot(x, e); o[13] = -dot(y, e); o[14] = -dot(z, e); return o; }
// 把單位圓柱（沿 +Y，高 1、半徑 1）擺到 p0→p1，rx/rz 為兩個橫向半徑
function segM(p0, p1, rx, rz) {
  const d = sub(p1, p0), l = len(d) || 1e-4, Y = [d[0] / l, d[1] / l, d[2] / l];
  let X = cross([0, 1, 0], Y); if (len(X) < 1e-3) X = [1, 0, 0]; X = norm(X);
  const Z = cross(X, Y), o = new Float32Array(16);
  o[0] = X[0] * rx; o[1] = X[1] * rx; o[2] = X[2] * rx; o[4] = Y[0] * l; o[5] = Y[1] * l; o[6] = Y[2] * l;
  o[8] = Z[0] * rz; o[9] = Z[1] * rz; o[10] = Z[2] * rz; o[12] = p0[0]; o[13] = p0[1]; o[14] = p0[2]; o[15] = 1; return o;
}

// ───── 幾何建構 ─────
function Geo() { this.d = []; }
Geo.prototype.tri = function (a, b, c, col, na, nb, nc) {
  if (!na) { const n = norm(cross(sub(b, a), sub(c, a))); na = nb = nc = n; }
  const P = [a, b, c], N = [na, nb, nc];
  for (let i = 0; i < 3; i++) this.d.push(P[i][0], P[i][1], P[i][2], N[i][0], N[i][1], N[i][2], col[0], col[1], col[2]);
};
Geo.prototype.quad = function (a, b, c, d, col) { this.tri(a, b, c, col); this.tri(a, c, d, col); };
function xf(g, m) { return p => m ? pt(m, p) : p; }
function nxf(m, n) { if (!m) return n; return norm([m[0] * n[0] + m[4] * n[1] + m[8] * n[2], m[1] * n[0] + m[5] * n[1] + m[9] * n[2], m[2] * n[0] + m[6] * n[1] + m[10] * n[2]]); }
function addCyl(g, r0, r1, h, seg, col, m, caps) {
  const T = p => m ? pt(m, p) : p;
  for (let i = 0; i < seg; i++) {
    const a0 = i / seg * 2 * PI, a1 = (i + 1) / seg * 2 * PI, c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
    const p00 = T([r0 * c0, 0, r0 * s0]), p10 = T([r0 * c1, 0, r0 * s1]), p01 = T([r1 * c0, h, r1 * s0]), p11 = T([r1 * c1, h, r1 * s1]);
    const n0 = nxf(m, [c0, 0.2, s0]), n1 = nxf(m, [c1, 0.2, s1]);
    g.tri(p00, p10, p11, col, n0, n1, n1); g.tri(p00, p11, p01, col, n0, n1, n0);
    if (caps !== false) { if (r1 > 0) g.tri(T([0, h, 0]), p01, p11, col, nxf(m, [0, 1, 0]), nxf(m, [0, 1, 0]), nxf(m, [0, 1, 0])); if (r0 > 0) g.tri(T([0, 0, 0]), p10, p00, col, nxf(m, [0, -1, 0]), nxf(m, [0, -1, 0]), nxf(m, [0, -1, 0])); }
  }
}
function addSphere(g, r, col, m, la, lo) {
  la = la || 7; lo = lo || 10; const T = p => m ? pt(m, p) : p;
  const P = (i, j) => { const th = i / la * PI, ph = j / lo * 2 * PI; return [r * Math.sin(th) * Math.cos(ph), r * Math.cos(th), r * Math.sin(th) * Math.sin(ph)]; };
  for (let i = 0; i < la; i++) for (let j = 0; j < lo; j++) {
    const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
    const na = nxf(m, norm(a)), nb = nxf(m, norm(b)), nc = nxf(m, norm(c)), nd = nxf(m, norm(d));
    g.tri(T(a), T(b), T(c), col, na, nb, nc); g.tri(T(a), T(c), T(d), col, na, nc, nd);
  }
}
function addBox(g, sx, sy, sz, col, m) { // 以原點為中心
  const h = [sx / 2, sy / 2, sz / 2], T = p => m ? pt(m, p) : p;
  const F = [[[1, 0, 0], [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]]], [[-1, 0, 0], [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]]],
    [[0, 1, 0], [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]]], [[0, -1, 0], [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]]],
    [[0, 0, 1], [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]], [[0, 0, -1], [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]]];
  for (const [n, v] of F) { const nn = nxf(m, n), p = v.map(q => T([q[0] * h[0], q[1] * h[1], q[2] * h[2]])); g.tri(p[0], p[1], p[2], col, nn, nn, nn); g.tri(p[0], p[2], p[3], col, nn, nn, nn); }
}

// ───── 地形 / 河道 ─────
let W = 9, D = 320;
const edgeX = z => W / 2 + 1.1 * Math.sin(z * 0.035 + 1) + 0.6 * Math.sin(z * 0.12);
function terrainH(x, z) {
  const d = Math.abs(x) - edgeX(z);
  let h = -1.1 + 1.7 * smooth(0, 3.5, d) + 0.07 * Math.max(0, d - 3.5)
    + (0.35 * Math.sin(x * 0.13 + z * 0.05) * Math.sin(z * 0.09 - x * 0.07) + 0.12 * Math.sin(x * 0.7 + z * 0.4)) * smooth(2, 10, d);
  const cap = Math.max(smooth(8, 16, z), smooth(-D - 3, -D - 12, z));
  return lerp(h, 0.55 + 0.05 * Math.sin(x * 0.3), cap);
}
function terrainColor(x, z, h, R) {
  const n = 0.9 + 0.2 * R();
  if (h < -0.05) return [0.10 * n, 0.17 * n, 0.15 * n];
  if (h < 0.12) return [0.30 * n, 0.26 * n, 0.19 * n];
  if (h < 0.34) return [0.74 * n, 0.66 * n, 0.46 * n];
  const f = smooth(0.34, 1.2, h), far = smooth(14, 45, Math.abs(x));
  return [lerp(0.55, lerp(0.18, 0.11, far), f) * n, lerp(0.5, lerp(0.34, 0.24, far), f) * n, lerp(0.34, lerp(0.15, 0.12, far), f) * n];
}
function buildTerrain(R) {
  const g = new Geo(), xs = [];
  for (let x = -90; x < -26; x += 3) xs.push(x); for (let x = -26; x <= 26; x += 1.3) xs.push(x); for (let x = 29; x <= 90; x += 3) xs.push(x);
  const zs = []; for (let z = 70; z > -D - 70; z -= 2.6) zs.push(z);
  const Ht = (x, z) => terrainH(x, z);
  const Nrm = (x, z) => norm([Ht(x - 0.5, z) - Ht(x + 0.5, z), 1, Ht(x, z - 0.5) - Ht(x, z + 0.5)]);
  const V = (x, z) => { const h = Ht(x, z); return { p: [x, h, z], n: Nrm(x, z), c: terrainColor(x, z, h, R) }; };
  let prev = xs.map(x => V(x, zs[0]));
  for (let zi = 1; zi < zs.length; zi++) {
    const cur = xs.map(x => V(x, zs[zi]));
    for (let i = 0; i < xs.length - 1; i++) {
      const a = prev[i], b = prev[i + 1], c = cur[i + 1], d = cur[i];
      g.tri(a.p, d.p, c.p, a.c, a.n, d.n, c.n); g.tri(a.p, c.p, b.p, a.c, a.n, c.n, b.n);
    }
    prev = cur;
  }
  return g;
}
function buildScenery(R) {
  const g = new Geo(), lanterns = new Geo(), glows = [];
  const bark = [0.27, 0.19, 0.12];
  // 樹林
  for (let k = 0; k < 520; k++) {
    const z = lerp(40, -D - 40, R()), side = R() < 0.5 ? -1 : 1, x = side * (edgeX(z) + 3.5 + Math.pow(R(), 1.5) * 55);
    if (z < -D - 4 && Math.abs(x) < 17) continue; if (z > 4 && z < 12 && x < 0 && x > -W / 2 - 9) continue;
    const h = terrainH(x, z); if (h < 0.3) continue;
    const s = 0.8 + R() * 1.0, t = R(), M = mul4(trans(x, h - 0.1, z), scl(s, s, s)), gr = 0.85 + 0.3 * R();
    addCyl(g, 0.16, 0.1, 1.9, 6, bark, M, false);
    if (t < 0.55) { // 針葉樹
      for (let i = 0; i < 3; i++) addCyl(g, 1.5 - i * 0.38, 0.05, 1.8, 8, [0.09 * gr, 0.24 * gr, 0.13 * gr], mul4(M, trans(0, 1.2 + i * 1.05, 0)), false);
    } else if (t < 0.85) { // 闊葉樹
      addSphere(g, 1.5, [0.17 * gr, 0.36 * gr, 0.14 * gr], mul4(M, mul4(trans(0, 3.0, 0), scl(1, 0.85, 1))));
      addSphere(g, 1.0, [0.22 * gr, 0.42 * gr, 0.17 * gr], mul4(M, trans(0.8, 2.5, 0.4)));
    } else { // 垂柳
      addSphere(g, 1.7, [0.3 * gr, 0.45 * gr, 0.2 * gr], mul4(M, mul4(trans(0, 3.2, 0), scl(1.2, 0.8, 1.2))));
      for (let i = 0; i < 6; i++) { const a = i / 6 * 2 * PI; addCyl(g, 0.12, 0.02, 2.2, 4, [0.35 * gr, 0.5 * gr, 0.25 * gr], mul4(M, mul4(trans(Math.cos(a) * 1.5, 3.0, Math.sin(a) * 1.5), rotX(PI))), false); }
    }
  }
  // 蘆葦與石頭
  for (let k = 0; k < 900; k++) {
    const z = lerp(14, -D - 8, R()), side = R() < 0.5 ? -1 : 1, x = side * (edgeX(z) + lerp(-0.9, 1.8, R()));
    const h = terrainH(x, z); if (h < -0.7) continue;
    const hh = 1.1 + R() * 1.4, tx = (R() - 0.5) * 0.4, c = [0.40 + R() * 0.2, 0.5 + R() * 0.12, 0.2 + R() * 0.1];
    for (let i = 0; i < 3; i++) addCyl(g, 0.035, 0.0, hh * (0.7 + 0.3 * R()), 3, c, mul4(trans(x + (R() - 0.5) * 0.4, h - 0.05, z + (R() - 0.5) * 0.4), rotZ((R() - 0.5) * 0.35 + tx)), false);
  }
  for (let k = 0; k < 50; k++) {
    const z = lerp(10, -D - 4, R()), side = R() < 0.5 ? -1 : 1, x = side * (edgeX(z) + lerp(-1.2, 3, R())), h = terrainH(x, z), s = 0.3 + R() * 0.6, gr = 0.4 + R() * 0.2;
    addSphere(g, 1, [gr, gr * 0.98, gr * 0.92], mul4(trans(x, h - 0.1, z), mul4(rotY(R() * 6), scl(s * 1.3, s * 0.7, s))), 5, 7);
  }
  // 木棧橋
  const wood = [0.45, 0.32, 0.2], wood2 = [0.36, 0.25, 0.16];
  function pier(x0, x1, z0, z1, y, withLamps) {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, lx = Math.abs(x1 - x0), lz = Math.abs(z1 - z0);
    const n = Math.round(lz / 0.28);
    for (let i = 0; i < n; i++) addBox(g, lx, 0.07, 0.24, i % 2 ? wood : [0.5, 0.36, 0.23], trans(cx, y, Math.min(z0, z1) + 0.14 + i * (lz / n)));
    for (let zz = Math.min(z0, z1) + 0.3; zz < Math.max(z0, z1); zz += 1.8) for (const xx of [x0, x1]) {
      addCyl(g, 0.09, 0.09, 1.7, 6, wood2, trans(xx, y - 1.4, zz), true);
      if (withLamps && xx === x0 + 0 || withLamps && xx === x1) {
        addCyl(g, 0.07, 0.07, 0.35, 6, wood2, trans(xx, y + 0.3, zz));
        addSphere(lanterns, 0.17, [1.0, 0.72, 0.35], trans(xx, y + 0.78, zz), 5, 8);
        glows.push([xx, y + 0.78, zz, 3.2, 1]);
      }
    }
  }
  pier(-W / 2 - 4, -W / 2 + 1.0 - 0.9 * 0, 3.5, 9, 0.45, false);          // 起點棧橋（船尾後方左側）
  pier(-1.6, 1.6, -D - 12, -D - 7, 0.45, true);                           // 彼岸棧橋與燈籠
  for (const sx of [-1, 1]) { pier(sx * 6, sx * 6 + 0.01, -D - 14, -D - 4, 0.45, false); }
  // 彼岸大燈籠樹 + 水面浮燈
  for (let i = 0; i < 9; i++) { const a = -0.5 + i / 8, x = a * 26, z = -D - 16 - R() * 6, h = terrainH(x, z) + 1.6 + R(); addSphere(lanterns, 0.22, [1, 0.78, 0.45], trans(x, h, z), 5, 8); glows.push([x, h, z, 3.6, 0.9]); }
  for (let i = 0; i < 16; i++) {
    const z = -14 - i * (D - 20) / 16 - R() * 8, x = (R() - 0.5) * (W - 3.5);
    addCyl(lanterns, 0.2, 0.17, 0.12, 8, [0.95, 0.65, 0.35], trans(x, 0.0, z));
    addCyl(lanterns, 0.1, 0.1, 0.2, 8, [1, 0.86, 0.55], trans(x, 0.12, z), true);
    glows.push([x, 0.28, z, 2.2, 0.85]);
  }
  return { g, lanterns, glows };
}

// ───── 木船 ─────
function boatDims(rows) { return { L: 2.6 + rows * 1.55 + 1.0, B: 1.7, rows }; }
function buildBoat(rows) {
  const { L, B } = boatDims(rows), g = new Geo(), N = 22, J = 9;
  const outer = [0.40, 0.26, 0.15], inner = [0.62, 0.45, 0.28], rim = [0.72, 0.55, 0.34];
  const hw = s => s < 0.5 ? (B / 2) * Math.pow(Math.sin(PI / 2 * s / 0.5), 0.8) : (B / 2) * (1 - 0.3 * Math.pow((s - 0.5) / 0.5, 1.6));
  const yG = s => 0.62 + 0.24 * Math.pow(Math.abs(2 * s - 1), 2.2);
  const yK = s => -0.32 * (1 - 0.55 * Math.pow(Math.abs(2 * s - 1), 2));
  const pf = (s, j, sg, off, lift) => { const t = j / (J - 1), w = Math.max(0.0, hw(s) - off), a = yK(s) + lift, b = yG(s); return [sg * w * Math.sin(t * PI / 2), a + (b - a) * (1 - Math.cos(t * PI / 2)), -L / 2 + s * L]; };
  for (let i = 0; i < N; i++) {
    const s0 = i / N, s1 = (i + 1) / N;
    for (const sg of [-1, 1]) for (let j = 0; j < J - 1; j++) {
      const k = (j % 2 ? 0.9 : 1.04) * (0.96 + 0.08 * ((i * 7 + j * 3) % 5) / 5), c = outer.map(v => v * k), ci = inner.map(v => v * k);
      g.quad(pf(s0, j, sg, 0, 0), pf(s1, j, sg, 0, 0), pf(s1, j + 1, sg, 0, 0), pf(s0, j + 1, sg, 0, 0), c);
      g.quad(pf(s0, j, sg, 0.07, 0.1), pf(s1, j, sg, 0.07, 0.1), pf(s1, j + 1, sg, 0.07, 0.1), pf(s0, j + 1, sg, 0.07, 0.1), ci);
    }
    for (const sg of [-1, 1]) g.quad(pf(s0, J - 1, sg, 0, 0), pf(s1, J - 1, sg, 0, 0), pf(s1, J - 1, sg, 0.07, 0.1), pf(s0, J - 1, sg, 0.07, 0.1), rim);
  }
  // 船尾板
  const ctr = [0, (yK(1) + yG(1)) / 2, L / 2];
  for (let j = 0; j < J - 1; j++) for (const sg of [-1, 1]) { g.tri(ctr, pf(1, j, sg, 0, 0), pf(1, j + 1, sg, 0, 0), outer.map(v => v * 0.95)); const c2 = [0, ctr[1], L / 2 - 0.07]; g.tri(c2, pf(1, j + 1, sg, 0.07, 0.1).map((v, q) => q === 2 ? v - 0.07 : v), pf(1, j, sg, 0.07, 0.1).map((v, q) => q === 2 ? v - 0.07 : v), inner); }
  // 船板座
  const zs = seatZs(rows);
  for (const z of zs) addBox(g, B * 0.9, 0.05, 0.3, [0.7, 0.52, 0.32], trans(0, 0.4, z));
  addBox(g, 0.5, 0.05, L * 0.8, [0.5, 0.36, 0.22], trans(0, -0.18, 0));
  // 船首裝飾柱與船尾小燈
  addCyl(g, 0.06, 0.04, 0.55, 6, rim, mul4(trans(0, yG(0) - 0.05, -L / 2 + 0.05), rotX(-0.35)));
  return g;
}
function seatZs(rows) { const { L } = boatDims(rows), a = []; for (let r = 0; r < rows; r++) a.push(-L / 2 + 2.15 + r * 1.55); return a; }

// ───── GL ─────
let gl, cv, prog = {}, buf = {}, meshes = {}, built = false;
let ripples = [], parts = [], pl = [], tags = [], pstate = [], fire = [], sceneGlows = [];
let rowsN = 1, dist = 320, boatGeoMesh = null, lastT = 0, simT = 0;
let ripN = 0, wakeT = 0;

const VS_LIT = `attribute vec3 aPos,aNor,aCol; uniform mat4 uVP,uModel; varying vec3 vN,vW,vC;
void main(){vec4 w=uModel*vec4(aPos,1.);vW=w.xyz;vN=mat3(uModel)*aNor;vC=aCol;gl_Position=uVP*w;}`;
const FS_LIT = `precision mediump float; varying vec3 vN,vW,vC; uniform vec3 uCam,uSun,uSunCol,uFog,uTint,uHor; uniform float uFogD,uUnlit;
void main(){vec3 n=normalize(vN);vec3 V=uCam-vW;float d=length(V);V/=d;if(dot(n,V)<0.)n=-n;
float ndl=max(dot(n,uSun),0.);float hemi=.5+.5*n.y;vec3 amb=mix(vec3(.16,.19,.22),uHor*.55+vec3(.18,.2,.24),hemi);
vec3 c=vC*uTint;vec3 col=c*(amb+uSunCol*ndl*.95);col+=pow(1.-max(dot(n,V),0.),3.)*uHor*.12*c;
col=mix(col,c*1.15,uUnlit);float f=1.-exp(-d*uFogD);f=clamp(f*(1.-uUnlit*.5)+smoothstep(0.,1.,(1.-exp(-max(0.,d-12.)*.004)))*.0,0.,1.);
col=mix(col,uFog,f);gl_FragColor=vec4(col,1.);}`;
const VS_WATER = `attribute vec2 aXZ; uniform mat4 uVP; uniform vec3 uC; uniform float uT; uniform vec4 uRip[8]; varying vec3 vW,vN;
float h(vec2 p){float t=uT;float y=.05*sin(dot(p,vec2(.9,.4))*1.3+t*1.1)+.035*sin(dot(p,vec2(-.5,.85))*2.1+t*1.5)+.02*sin(dot(p,vec2(.2,-1.))*3.7+t*2.2)+.012*sin(dot(p,vec2(1.,.3))*7.3+t*3.1);
for(int i=0;i<8;i++){vec4 r=uRip[i];if(r.w>0.){float d=length(p-r.xy);float x=d-r.z*1.8;y+=r.w*exp(-x*x*5.)*sin(x*8.)*exp(-r.z*1.2)*.1;}}return y;}
void main(){vec2 p=aXZ+uC.xz;float y=h(p);float e=.18;
vN=normalize(vec3(h(p-vec2(e,0.))-h(p+vec2(e,0.)),2.*e,h(p-vec2(0.,e))-h(p+vec2(0.,e))));vW=vec3(p.x,y,p.y);gl_Position=uVP*vec4(vW,1.);}`;
const FS_WATER = `precision mediump float; varying vec3 vW,vN; uniform vec3 uCam,uSun,uSunCol,uFog,uTop,uHor; uniform float uFogD,uT;
void main(){vec3 n=normalize(vN);vec3 V=uCam-vW;float d=length(V);V/=d;vec2 q=vW.xz;
n.xz+=.05*vec2(sin(q.x*5.+uT*1.7+sin(q.y*3.)),cos(q.y*4.5-uT*1.3))*clamp(1.-d*.012,.2,1.);n=normalize(n);
float fr=pow(1.-max(dot(n,V),0.),4.)*.8+.06;vec3 R=reflect(-V,n);R.y=abs(R.y);
vec3 sky=mix(uHor,uTop,pow(clamp(R.y,0.,1.),.5));float sd=max(dot(R,uSun),0.);sky+=uSunCol*(pow(sd,220.)*2.+pow(sd,10.)*.18);
vec3 deep=vec3(.025,.13,.16),sh=vec3(.07,.27,.28);vec3 body=mix(deep,sh,clamp(.5+n.x*.4,0.,1.)*.6);
vec3 col=mix(body,sky,fr);float f=clamp(1.-exp(-d*uFogD),0.,1.);col=mix(col,uFog,f);gl_FragColor=vec4(col,1.);}`;
const VS_SKY = `attribute vec2 aP; varying vec2 vP; void main(){vP=aP;gl_Position=vec4(aP,.9999,1.);}`;
const FS_SKY = `precision mediump float; varying vec2 vP; uniform vec3 uF,uR,uU,uSun,uSunCol,uTop,uHor; uniform vec2 uTan; uniform float uT;
float hs(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float nz(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hs(i),hs(i+vec2(1,0)),f.x),mix(hs(i+vec2(0,1)),hs(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float a=.5,s=0.;for(int i=0;i<4;i++){s+=a*nz(p);p*=2.03;a*=.5;}return s;}
void main(){vec3 d=normalize(uF+uR*vP.x*uTan.x+uU*vP.y*uTan.y);float y=max(d.y,0.);
vec3 col=mix(uHor,uTop,pow(y,.55));float sd=max(dot(d,uSun),0.);col+=uSunCol*(pow(sd,600.)*3.+pow(sd,24.)*.35+pow(sd,4.)*.12);
if(d.y>0.){vec2 uv=d.xz/(d.y+.25)*1.1+vec2(uT*.01,0.);float c=smoothstep(.45,.8,fbm(uv*1.4));
vec3 cc=mix(uHor*1.05,vec3(1.),.45)+uSunCol*.25*pow(sd,2.);col=mix(col,cc,c*smoothstep(0.,.25,d.y)*.85);}
gl_FragColor=vec4(col,1.);}`;
const VS_PT = `attribute vec3 aPos; attribute vec4 aCol; attribute float aSize; uniform mat4 uVP; uniform vec3 uCam; uniform float uScale; varying vec4 vC;
void main(){vC=aCol;gl_Position=uVP*vec4(aPos,1.);gl_PointSize=clamp(aSize*uScale/max(length(aPos-uCam),1.),1.,90.);}`;
const FS_PT = `precision mediump float; varying vec4 vC; void main(){vec2 p=gl_PointCoord-.5;float d=length(p)*2.;float a=smoothstep(1.,0.,d);gl_FragColor=vec4(vC.rgb,vC.a*a*a);}`;

function compile(vs, fs, locs) {
  const mk = (t, s) => { const sh = gl.createShader(t); gl.shaderSource(sh, s); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh)); return sh; };
  const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  locs.forEach((n, i) => gl.bindAttribLocation(p, i, n)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const nm = gl.getActiveUniform(p, i).name.replace('[0]', ''); u[nm] = gl.getUniformLocation(p, gl.getActiveUniform(p, i).name); }
  return { p, u, n: locs.length };
}
function use(pr) { gl.useProgram(pr.p); for (let i = 0; i < 3; i++) { if (i < pr.n) gl.enableVertexAttribArray(i); else gl.disableVertexAttribArray(i); } return pr; }
function mk(geo) { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(geo.d), gl.STATIC_DRAW); return { b, n: geo.d.length / 9 }; }

function init(canvas) {
  cv = canvas;
  try {
    gl = cv.getContext('webgl', { antialias: true, alpha: false, powerPreference: 'high-performance' }) || cv.getContext('experimental-webgl');
    if (!gl) return false;
    prog.lit = compile(VS_LIT, FS_LIT, ['aPos', 'aNor', 'aCol']);
    prog.water = compile(VS_WATER, FS_WATER, ['aXZ']);
    prog.sky = compile(VS_SKY, FS_SKY, ['aP']);
    prog.pt = compile(VS_PT, FS_PT, ['aPos', 'aCol', 'aSize']);
  } catch (e) { console.error('WebGL init failed', e); return false; }
  // 單位元件
  const cyl = new Geo(); addCyl(cyl, 1, 1, 1, 10, [1, 1, 1]); meshes.cyl = mk(cyl);
  const cone = new Geo(); addCyl(cone, 1, 0.0, 1, 12, [1, 1, 1]); meshes.cone = mk(cone);
  const sph = new Geo(); addSphere(sph, 1, [1, 1, 1], null, 8, 12); meshes.sph = mk(sph);
  // 天空
  buf.sky = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf.sky); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  // 水面：極座標網格（近密遠疏）
  const rings = 52, segs = 96, xz = [], idx = [];
  for (let r = 0; r <= rings; r++) { const rad = 0.8 * Math.pow(1.105, r); for (let s = 0; s < segs; s++) { const a = s / segs * 2 * PI; xz.push(Math.cos(a) * rad, Math.sin(a) * rad); } }
  for (let r = 0; r < rings; r++) for (let s = 0; s < segs; s++) { const a = r * segs + s, b = r * segs + (s + 1) % segs, c = (r + 1) * segs + s, d = (r + 1) * segs + (s + 1) % segs; idx.push(a, c, b, b, c, d); }
  buf.wxz = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf.wxz); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(xz), gl.STATIC_DRAW);
  buf.widx = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf.widx); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW); buf.wn = idx.length;
  buf.pt = gl.createBuffer();
  return true;
}

function build(o) {
  W = o.width || 9; D = o.dist || 320; dist = D; rowsN = o.size / 2;
  const R = rng(20260611);
  meshes.terrain = mk(buildTerrain(R));
  const sc = buildScenery(R); meshes.scene = mk(sc.g); meshes.lant = mk(sc.lanterns); sceneGlows = sc.glows;
  meshes.boat = mk(buildBoat(rowsN));
  // 螢火蟲
  fire = []; const F = rng(7);
  for (let i = 0; i < 320; i++) { const z = lerp(20, -D - 10, F()), side = F() < 0.5 ? -1 : 1; fire.push({ x: side * (edgeX(z) + lerp(-1, 9, F())), y: 0.5 + F() * 2.6, z, ph: F() * 6.3, sp: 0.4 + F() * 0.8 }); }
  pstate = []; for (let i = 0; i < o.size; i++) pstate.push({ a: 0, inW: 0, tgt: 0, last: -9, mis: -9 });
  ripples = []; parts = []; built = true;
}

function palette(p) {
  const t = clamp(p / 100, 0, 1);
  const L = (a, b) => a.map((v, i) => lerp(v, b[i], t));
  const hor = L([1.0, 0.62, 0.46], [1.0, 0.83, 0.64]), top = L([0.22, 0.30, 0.48], [0.34, 0.58, 0.84]), sunC = L([1.0, 0.62, 0.38], [1.0, 0.86, 0.62]);
  const fog = hor.map((v, i) => lerp(v, [0.72, 0.76, 0.8][i], 0.35)).map(v => v * 0.92);
  return { hor, top, sunC, fog, sun: norm([0.28, 0.07 + 0.2 * t, -1]) };
}

function resize(w, h, dpr) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.width = w + 'px'; cv.style.height = h + 'px'; }

function addRipple(x, z, amp, t) { ripples[ripN++ % 8] = { x, z, t0: t, amp }; }

function drawMesh(m, model, tint, unlit) {
  const pr = prog.lit; gl.uniformMatrix4fv(pr.u.uModel, false, model); gl.uniform3fv(pr.u.uTint, tint || [1, 1, 1]); gl.uniform1f(pr.u.uUnlit, unlit || 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, m.b); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 36, 0); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 36, 12); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 36, 24);
  gl.drawArrays(gl.TRIANGLES, 0, m.n);
}
const IDM = ident();
const SHIRT = [[0.30, 0.72, 0.62], [0.90, 0.68, 0.25], [0.86, 0.38, 0.38], [0.42, 0.55, 0.95], [0.67, 0.48, 0.90], [0.50, 0.78, 0.35]];
const SKIN = [0.84, 0.66, 0.52];

// 渲染一幀。f = { t, a[], my, lat, p, ph, zone, names[], dt, intro }
function render(f) {
  if (!gl || !built) return { mistake: false };
  const t = f.t, dt = clamp(t - lastT, 0.001, 0.1); lastT = t; simT = t;
  const w = cv.width, h = cv.height, asp = w / h;
  const rows = rowsN, dims = boatDims(rows), zs = seatZs(rows), N = f.a.length;
  const pal = palette(f.p);
  // 船的位置
  const bz = -f.p / 100 * D, bx = clamp(f.lat, -1.4, 1.4) * Math.min(3.6, W * 0.42);
  const bob = 0.045 * Math.sin(t * 1.25) + 0.02 * Math.sin(t * 2.1), roll = 0.03 * Math.sin(t * 1.1) - f.lat * 0.03, pitch = 0.015 * Math.sin(t * 0.9 + 1);
  const BM = mul4(trans(bx, bob, bz), mul4(rotY(-f.lat * 0.1), mul4(rotZ(roll), rotX(pitch))));
  // 相機（第三人稱，依螢幕寬高自動拉遠）
  const fovy = 54 * PI / 180, halfSpan = 3.5 + (rows > 1 ? 0.2 : 0);
  const cd = clamp(halfSpan / (Math.tan(fovy / 2) * asp), 11, 24);
  const pitchA = 25 * PI / 180, sway = Math.sin(t * 0.5) * 0.12;
  const tgt = [bx * 0.7, 0.9, bz - 1.0 - rows * 0.4];
  const eye = [tgt[0] + sway, tgt[1] + cd * Math.sin(pitchA) + 0.8, tgt[2] + cd * Math.cos(pitchA) + dims.L * 0.18];
  const view = lookAt(eye, [tgt[0], tgt[1] - 0.2 - cd * 0.08, tgt[2] - 6], [0, 1, 0]);
  const proj = persp(fovy, asp, 0.5, 600), VP = mul4(proj, view);
  const fwd = norm(sub([tgt[0], tgt[1] - 0.2 - cd * 0.08, tgt[2] - 6], eye)), right = norm(cross(fwd, [0, 1, 0])), up = cross(right, fwd);

  // ── 槳手 / 槳的運動 ──
  let mistake = false; const oars = [];
  for (let i = 0; i < N; i++) {
    const s = pstate[i], a = f.a[i] || 0, rate = (a - s.a) / dt; s.a = a;
    if (rate > 0.12 || a > 0.85) s.tgt = 1; else if (rate < -0.12 || a < 0.06) s.tgt = 0;
    const was = s.inW; s.inW += (s.tgt - s.inW) * Math.min(1, dt * 14);
    const side = i % 2 ? 1 : -1, row = i >> 1, z = zs[row];
    const O = [side * 0.93, 0.76, z - 0.1], phi = -0.62 + 1.24 * a;
    const dir = norm([side * Math.cos(phi), 0, Math.sin(phi)]);
    const tipY = lerp(0.5, -0.07, s.inW), tipL = [O[0] + dir[0] * 2.25, tipY, O[2] + dir[2] * 2.25];
    const dv = norm(sub(tipL, O)), handleL = [O[0] - dv[0] * 0.72, O[1] - dv[1] * 0.72, O[2] - dv[2] * 0.72];
    const tip = pt(BM, tipL);
    if (s.inW > 0.6 && was <= 0.6 && t - s.last > 0.4) { addRipple(tip[0], tip[2], 0.7, t); for (let k = 0; k < 7; k++) parts.push({ x: tip[0], y: 0.05, z: tip[2], vx: (Math.random() - 0.5) * 1.2, vy: 1.2 + Math.random() * 1.4, vz: (Math.random() - 0.5) * 1.2, life: 0.7, s: 0.07, c: [0.85, 0.95, 1, 0.8] }); s.last = t; }
    else if (s.inW > 0.5 && a > 0.2 && a < 0.95 && t - s.last > 0.35) { addRipple(tip[0], tip[2], 0.35, t); s.last = t; }
    // 回槳區誤按 → 水花
    if (f.zone < 0 && a > 0.55 && t - s.mis > 0.9) {
      s.mis = t; addRipple(tip[0], tip[2], 1.5, t); if (i === f.my) mistake = true;
      for (let k = 0; k < 26; k++) parts.push({ x: tip[0], y: 0.08, z: tip[2], vx: (Math.random() - 0.5) * 3, vy: 2 + Math.random() * 3, vz: (Math.random() - 0.5) * 3, life: 1.0, s: 0.11, c: [1, 1, 1, 0.9] });
    }
    oars.push({ i, side, row, z, O, tipL, handleL, dv, a, phi });
  }
  // 船行水紋（船首兩側）
  wakeT += dt; if (f.speedy && wakeT > 0.35) { wakeT = 0; const q = pt(BM, [0, 0, dims.L / 2 - 0.4]); addRipple(q[0], q[2], 0.5, t); }

  // ── 畫面 ──
  gl.viewport(0, 0, w, h); gl.clearColor(pal.fog[0], pal.fog[1], pal.fog[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  // 天空
  gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
  let pr = use(prog.sky);
  gl.uniform3fv(pr.u.uF, fwd); gl.uniform3fv(pr.u.uR, right); gl.uniform3fv(pr.u.uU, up); gl.uniform2f(pr.u.uTan, Math.tan(fovy / 2) * asp, Math.tan(fovy / 2));
  gl.uniform3fv(pr.u.uSun, pal.sun); gl.uniform3fv(pr.u.uSunCol, pal.sunC); gl.uniform3fv(pr.u.uTop, pal.top); gl.uniform3fv(pr.u.uHor, pal.hor); gl.uniform1f(pr.u.uT, t);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf.sky); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
  const FOGD = 0.0105;
  // 地形、樹、橋
  pr = use(prog.lit);
  gl.uniformMatrix4fv(pr.u.uVP, false, VP); gl.uniform3fv(pr.u.uCam, eye); gl.uniform3fv(pr.u.uSun, pal.sun); gl.uniform3fv(pr.u.uSunCol, pal.sunC); gl.uniform3fv(pr.u.uFog, pal.fog); gl.uniform3fv(pr.u.uHor, pal.hor); gl.uniform1f(pr.u.uFogD, FOGD);
  drawMesh(meshes.terrain, IDM); drawMesh(meshes.scene, IDM); drawMesh(meshes.lant, IDM, [1, 1, 1], 1);
  // 船
  drawMesh(meshes.boat, BM);
  const hatC = [0.86, 0.74, 0.44];
  tags = [];
  for (const o of oars) {
    const i = o.i, a = o.a, sx = o.side * 0.34, hipY = 0.5, shirt = SHIRT[i % 6];
    const lean = 0.5 - 1.0 * a;                      // 面向船尾：划槳時身體後仰（朝船頭）
    const hip = [sx, hipY, o.z + 0.05], sh = [sx, hipY + 0.5 * Math.cos(lean), o.z + 0.05 + 0.5 * Math.sin(lean) + 0.05];
    const P = q => pt(BM, q);
    // 腿
    const knee = [sx, 0.66, o.z + 0.5], foot = [sx, 0.12, o.z + 0.78];
    drawMesh(meshes.cyl, segM(P(hip), P(knee), 0.1, 0.1), [0.26, 0.28, 0.36]);
    drawMesh(meshes.cyl, segM(P(knee), P(foot), 0.08, 0.08), [0.26, 0.28, 0.36]);
    // 軀幹、頭、斗笠
    drawMesh(meshes.cyl, segM(P(hip), P(sh), 0.2, 0.15), shirt);
    const head = [sh[0], sh[1] + 0.2, sh[2] - 0.02];
    drawMesh(meshes.sph, mul4(BM, mul4(trans(head[0], head[1], head[2]), scl(0.12, 0.13, 0.12))), SKIN);
    drawMesh(meshes.cone, mul4(BM, mul4(trans(head[0], head[1] + 0.1, head[2]), scl(0.34, 0.15, 0.34))), hatC);
    drawMesh(meshes.cyl, mul4(BM, mul4(trans(head[0], head[1] + 0.1, head[2]), scl(0.2, 0.03, 0.2))), shirt);
    // 手臂 → 握把
    const hd = o.handleL, hdir = o.dv;
    for (const k of [0.0, -0.28]) { const hand = [hd[0] - hdir[0] * k, hd[1] - hdir[1] * k, hd[2] - hdir[2] * k]; for (const sgn of [-1, 1]) { const shd = [sh[0] + sgn * 0.2, sh[1] - 0.04, sh[2]]; if (k === 0 ? sgn === -1 : sgn === 1) drawMesh(meshes.cyl, segM(P(shd), P(hand), 0.055, 0.055), shirt); } }
    // 槳：軸、槳葉、握把
    const O = o.O, tip = o.tipL, shaftEnd = [O[0] + hdir[0] * 1.55, O[1] + hdir[1] * 1.55, O[2] + hdir[2] * 1.55];
    drawMesh(meshes.cyl, segM(P(hd), P(shaftEnd), 0.032, 0.032), [0.78, 0.66, 0.46]);
    drawMesh(meshes.cyl, segM(P(shaftEnd), P(tip), 0.03, 0.13), i === f.my ? [1, 0.88, 0.55] : [0.82, 0.72, 0.52]);
    drawMesh(meshes.sph, mul4(BM, mul4(trans(O[0], O[1], O[2]), scl(0.07, 0.07, 0.07))), [0.3, 0.22, 0.15]);
    // 名牌位置
    const hp = pt(BM, [sh[0], sh[1] + 0.65, sh[2]]), cl = pt(VP, hp), ww = VP[3] * hp[0] + VP[7] * hp[1] + VP[11] * hp[2] + VP[15];
    tags.push({ i, x: (cl[0] / ww * 0.5 + 0.5), y: (1 - (cl[1] / ww * 0.5 + 0.5)), vis: ww > 0 });
    if (i === f.my) { const m2 = mul4(BM, mul4(trans(head[0], head[1] + 0.52 + 0.05 * Math.sin(t * 3), head[2]), mul4(rotY(t * 2), scl(0.07, 0.11, 0.07)))); drawMesh(meshes.sph, m2, [1, 0.85, 0.4], 1); }
  }
  // 水面
  pr = use(prog.water);
  gl.uniformMatrix4fv(pr.u.uVP, false, VP); gl.uniform3f(pr.u.uC, eye[0], 0, tgt[2]); gl.uniform1f(pr.u.uT, t); gl.uniform3fv(pr.u.uCam, eye);
  gl.uniform3fv(pr.u.uSun, pal.sun); gl.uniform3fv(pr.u.uSunCol, pal.sunC); gl.uniform3fv(pr.u.uFog, pal.fog); gl.uniform3fv(pr.u.uTop, pal.top); gl.uniform3fv(pr.u.uHor, pal.hor); gl.uniform1f(pr.u.uFogD, FOGD);
  const rp = new Float32Array(32); for (let i = 0; i < 8; i++) { const r = ripples[i]; if (r) { const age = t - r.t0; if (age >= 0 && age < 3.5) { rp[i * 4] = r.x; rp[i * 4 + 1] = r.z; rp[i * 4 + 2] = age; rp[i * 4 + 3] = r.amp; } } }
  gl.uniform4fv(pr.u.uRip, rp);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf.wxz); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf.widx); gl.drawElements(gl.TRIANGLES, buf.wn, gl.UNSIGNED_SHORT, 0);

  // 粒子：水花、螢火蟲、燈籠光暈
  const pd = [];
  for (let i = parts.length - 1; i >= 0; i--) { const q = parts[i]; q.life -= dt; q.vy -= 9 * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt; if (q.life <= 0 || q.y < -0.05) parts.splice(i, 1); else pd.push(q.x, q.y, q.z, q.c[0], q.c[1], q.c[2], q.c[3] * clamp(q.life * 2, 0, 1), q.s * 120); }
  for (const g of sceneGlows) { const dz = g[2] - bz; if (dz > 30 || dz < -230) continue; const fl = 0.8 + 0.2 * Math.sin(t * 3 + g[0] * 7 + g[2]); pd.push(g[0], g[1], g[2], 1, 0.72, 0.38, 0.55 * g[4] * fl, g[3] * 120); }
  for (const q of fire) { const dz = q.z - bz; if (dz > 25 || dz < -90) continue; const a = 0.35 + 0.65 * Math.max(0, Math.sin(t * q.sp * 2 + q.ph)); pd.push(q.x + Math.sin(t * q.sp + q.ph) * 0.8, q.y + Math.sin(t * q.sp * 1.3 + q.ph) * 0.3, q.z + Math.cos(t * q.sp * 0.7 + q.ph) * 0.8, 0.85, 1, 0.45, 0.8 * a * (0.5 + 0.5 * (1 - f.p / 100 * 0.5)), 0.05 * 120); }
  if (pd.length) {
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE); gl.depthMask(false);
    pr = use(prog.pt); pr.n = 3; gl.enableVertexAttribArray(0); gl.enableVertexAttribArray(1); gl.enableVertexAttribArray(2);
    gl.uniformMatrix4fv(pr.u.uVP, false, VP); gl.uniform3fv(pr.u.uCam, eye); gl.uniform1f(pr.u.uScale, h / 2 / Math.tan(fovy / 2) / 120);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf.pt); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pd), gl.DYNAMIC_DRAW);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 12); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 32, 28);
    gl.drawArrays(gl.POINTS, 0, pd.length / 8);
    gl.depthMask(true); gl.disable(gl.BLEND);
  }
  return { mistake, tags };
}

window.River3D = { init, build, resize, render, get tags() { return tags; } };
})();
