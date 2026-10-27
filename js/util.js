import * as THREE from '../vendor/three.module.js';

// Мелкие утилиты: математика, генератор случайных чисел, шум, трассировка лучей.
// Всё написано вручную, без зависимостей, чтобы игра оставалась лёгкой.

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const TAU = Math.PI * 2;

/** Быстрый детерминированный ГПСЧ (mulberry32). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const rnd = (rng, a = 0, b = 1) => a + (b - a) * rng();
export const rndInt = (rng, a, b) => Math.floor(a + (b - a + 1) * rng());
export const pick = (rng, arr) => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];
export const chance = (rng, p) => rng() < p;

export function anglediff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/** Детерминированный шум 2D со сглаживанием — рельеф, расстановка объектов. */
export function makeNoise2D(seed) {
  const hash = (ix, iy) => {
    let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 362437);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  return function noise(x, y) {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = smoothstep(0, 1, x - x0), fy = smoothstep(0, 1, y - y0);
    const a = hash(x0, y0), b = hash(x0 + 1, y0);
    const c = hash(x0, y0 + 1), d = hash(x0 + 1, y0 + 1);
    return lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
  };
}

/** Фрактальный шум (несколько октав). */
export function fbm(noise, x, y, octaves = 4) {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise(x * freq, y * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

/** Пересечение луча и AABB (slab method). Возвращает t или -1. */
export function rayAABB(ox, oy, oz, dx, dy, dz, b) {
  let tmin = 0, tmax = Infinity;
  // X
  if (Math.abs(dx) < 1e-8) {
    if (ox < b.minX || ox > b.maxX) return -1;
  } else {
    let t1 = (b.minX - ox) / dx, t2 = (b.maxX - ox) / dx;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  // Y
  if (Math.abs(dy) < 1e-8) {
    if (oy < b.minY || oy > b.maxY) return -1;
  } else {
    let t1 = (b.minY - oy) / dy, t2 = (b.maxY - oy) / dy;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  // Z
  if (Math.abs(dz) < 1e-8) {
    if (oz < b.minZ || oz > b.maxZ) return -1;
  } else {
    let t1 = (b.minZ - oz) / dz, t2 = (b.maxZ - oz) / dz;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  return tmin;
}

/** Пересечение луча и сферы. Возвращает ближайшее t > 0 или -1. */
export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = ox - cx, ly = oy - cy, lz = oz - cz;
  const b = lx * dx + ly * dy + lz * dz;
  const c = lx * lx + ly * ly + lz * lz - r * r;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const sq = Math.sqrt(disc);
  const t1 = -b - sq, t2 = -b + sq;
  if (t1 > 0) return t1;
  if (t2 > 0) return t2;
  return -1;
}

export function fmtClock(sec) {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function randomName(rng) {
  const a = ['Kaban', 'Sanya', 'Vint', 'Kolya', 'Krot', 'Tucha', 'Sever', 'Bars', 'Shmel', 'Groza', 'Volk', 'Dym', 'Kot', 'Zub', 'Molot', 'Sokol', 'Kedr', 'Rys', 'Tayfun', 'Shtorm'];
  const b = ['_PRO', '228', 'TTV', '99', 'xX', '_YT', 'OneTap', 'Chicken', 'Blya', '_RU', 'Kek', 'TV', '_GG'];
  const n = pick(rng, a) + pick(rng, b) + (rng() < 0.5 ? String(rndInt(rng, 1, 99)) : '');
  return n.length > 16 ? n.slice(0, 16) : n;
}

/**
 * Склейка нескольких геометрий в одну с запечёнными цветами вершин.
 * Нужна, чтобы каждый предмет лута/солдат был одной отрисовкой (важно для слабых ПК).
 * parts: [{ geo, color, position?, rotation?, scale? }]
 */
export function mergeColored(parts) {
  let total = 0;
  const prepared = [];
  const m = new THREE.Matrix4();
  for (const p of parts) {
    const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
    const pos = g.attributes.position;
    total += pos.count;
    prepared.push({ g, p });
  }
  const positions = new Float32Array(total * 3);
  const normals = new Float32Array(total * 3);
  const colors = new Float32Array(total * 3);
  const c = new THREE.Color();
  let o = 0;
  for (const { g, p } of prepared) {
    m.identity();
    const q = new THREE.Quaternion();
    if (p.rotation) q.setFromEuler(new THREE.Euler(p.rotation[0] || 0, p.rotation[1] || 0, p.rotation[2] || 0));
    m.compose(
      new THREE.Vector3(...(p.position || [0, 0, 0])),
      q,
      new THREE.Vector3(...(p.scale || [1, 1, 1])),
    );
    g.applyMatrix4(m);
    const pos = g.attributes.position.array;
    const nor = g.attributes.normal ? g.attributes.normal.array : null;
    c.set(p.color);
    const n = g.attributes.position.count;
    positions.set(pos, o * 3);
    if (nor) normals.set(nor, o * 3);
    for (let i = 0; i < n; i++) {
      colors[(o + i) * 3] = c.r;
      colors[(o + i) * 3 + 1] = c.g;
      colors[(o + i) * 3 + 2] = c.b;
    }
    o += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  out.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  out.computeBoundingSphere();
  return out;
}
