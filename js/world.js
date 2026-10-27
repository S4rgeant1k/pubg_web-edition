// Мир игры: остров с рельефом, посёлки, дома, деревья, вода.
// Геометрия низкополигональная, статика собирается в InstancedMesh — это держит
// ~60 fps даже на слабых встройках.

import * as THREE from '../vendor/three.module.js';
import { mulberry32, rnd, rndInt, pick, clamp, fbm, makeNoise2D, rayAABB } from './util.js';

export const MAP_SIZE = 1600;      // метров от края до края
export const MAP_HALF = MAP_SIZE / 2;
const GRID_N = 161;                // сетка высот для быстрых запросов
const GRID_STEP = MAP_SIZE / (GRID_N - 1);

const COLORS = {
  wall: 0xd8cdbb,
  wallBrick: 0xb5856c,
  wallOld: 0xb9c0b3,
  roof: 0x74493d,
  roofDark: 0x4a4f57,
  floor: 0x9c9184,
  crate: 0x8a6a44,
  wood: 0x6f5637,
  trunk: 0x6b4f33,
  leaf: 0x4d7a36,
  leaf2: 0x3d6b2f,
  rock: 0x8b8a83,
  concrete: 0xb0aca2,
};

/** Строитель статических коробок: копит трансформы и создаёт InstancedMesh. */
class BoxBuilder {
  constructor() { this.byMaterial = new Map(); }
  add(colorKey, cx, cy, cz, sx, sy, sz) {
    let arr = this.byMaterial.get(colorKey);
    if (!arr) this.byMaterial.set(colorKey, (arr = []));
    arr.push([cx, cy, cz, sx, sy, sz]);
  }
  build(scene) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const dummy = new THREE.Object3D();
    for (const [key, list] of this.byMaterial) {
      const mat = new THREE.MeshLambertMaterial({ color: COLORS[key] || 0x999999 });
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((b, i) => {
        dummy.position.set(b[0], b[1], b[2]);
        dummy.scale.set(b[3], b[4], b[5]);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.frustumCulled = false;
      mesh.name = 'static_' + key;
      scene.add(mesh);
    }
  }
}

export class World {
  constructor(scene, seed = 20240517) {
    this.scene = scene;
    this.seed = seed;
    this.rng = mulberry32(seed);
    this.noise = makeNoise2D(seed);
    this.detailNoise = makeNoise2D(seed * 3 + 11);

    this.colliders = [];      // AABB стен и ящиков
    this.treeColliders = [];  // круглые стволы
    this.floors = [];         // полы зданий: поднятая земля внутри
    this.buildings = [];      // для мини-карты
    this.towns = [];
    this.spawnSpots = [];     // точки появления лута
    this.busyRects = [];      // занятые прямоугольники (дома)

    this._buildHeightGrid();
    this._buildTerrain();
    this._buildWater();
    this._buildTowns();
    this._buildVegetation();
    this._buildRocks();
    this._buildLooseLootSpots();
    this._buildSpatialGrid();
  }

  // ---------- пространственный индекс ----------

  _buildSpatialGrid() {
    this.cell = 32;
    this.colGrid = new Map();
    this.treeGrid = new Map();
    const add = (grid, minX, maxX, minZ, maxZ, idx) => {
      const c = this.cell;
      const i0 = Math.floor(minX / c), i1 = Math.floor(maxX / c);
      const j0 = Math.floor(minZ / c), j1 = Math.floor(maxZ / c);
      for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
          const key = i * 10007 + j;
          let arr = grid.get(key);
          if (!arr) grid.set(key, (arr = []));
          arr.push(idx);
        }
      }
    };
    this.colliders.forEach((b, i) => add(this.colGrid, b.minX, b.maxX, b.minZ, b.maxZ, i));
    this.treeColliders.forEach((t, i) => add(this.treeGrid, t.x - t.r, t.x + t.r, t.z - t.r, t.z + t.r, i));
    this._colMark = new Int32Array(this.colliders.length);
    this._treeMark = new Int32Array(this.treeColliders.length);
    this._stamp = 0;
    this._tmpCols = [];
    this._tmpTrees = [];
  }

  _cellIndex(i, j) { return i * 10007 + j; }

  /** Коллайдеры в квадрате вокруг точки (для физики). */
  _collidersNear(x, z, radius) {
    const stamp = ++this._stamp;
    const out = this._tmpCols;
    out.length = 0;
    const c = this.cell;
    const i0 = Math.floor((x - radius) / c), i1 = Math.floor((x + radius) / c);
    const j0 = Math.floor((z - radius) / c), j1 = Math.floor((z + radius) / c);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const list = this.colGrid.get(this._cellIndex(i, j));
        if (!list) continue;
        for (const idx of list) {
          if (this._colMark[idx] === stamp) continue;
          this._colMark[idx] = stamp;
          out.push(this.colliders[idx]);
        }
      }
    }
    return out;
  }

  _treesNear(x, z, radius) {
    const stamp = ++this._stamp;
    const out = this._tmpTrees;
    out.length = 0;
    const c = this.cell;
    const i0 = Math.floor((x - radius) / c), i1 = Math.floor((x + radius) / c);
    const j0 = Math.floor((z - radius) / c), j1 = Math.floor((z + radius) / c);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const list = this.treeGrid.get(this._cellIndex(i, j));
        if (!list) continue;
        for (const idx of list) {
          if (this._treeMark[idx] === stamp) continue;
          this._treeMark[idx] = stamp;
          out.push(this.treeColliders[idx]);
        }
      }
    }
    return out;
  }

  /** Коллайдеры вдоль луча — чтобы шальные пули не перебирали весь остров. */
  _collidersAlong(ox, oz, dx, dz, maxDist) {
    const stamp = ++this._stamp;
    const out = this._tmpCols;
    out.length = 0;
    const c = this.cell;
    const step = c * 0.7;
    const flatLen = Math.hypot(dx, dz) * maxDist;
    const n = Math.min(220, Math.ceil(flatLen / step) + 1);
    for (let s = 0; s <= n; s++) {
      const px = ox + dx * step * s;
      const pz = oz + dz * step * s;
      if (Math.hypot(px - ox, pz - oz) > maxDist + c) break;
      const i = Math.floor(px / c), j = Math.floor(pz / c);
      for (let di = -1; di <= 1; di++) {
        for (let dj = -1; dj <= 1; dj++) {
          const list = this.colGrid.get(this._cellIndex(i + di, j + dj));
          if (!list) continue;
          for (const idx of list) {
            if (this._colMark[idx] === stamp) continue;
            this._colMark[idx] = stamp;
            out.push(this.colliders[idx]);
          }
        }
      }
    }
    return out;
  }

  // ---------- рельеф ----------

  _rawHeight(x, z) {
    const n = this.noise;
    let h = fbm(n, x * 0.0016 + 13.7, z * 0.0016 - 7.1, 4);
    h = Math.pow(clamp(h, 0, 1), 1.25);
    let y = h * 42 - 10;
    // пара холмов-гряд для разнообразия
    y += Math.sin(x * 0.006) * Math.cos(z * 0.0055) * 2.4;
    // берег: чем ближе к краю карты, тем глубже вода
    const d = Math.max(Math.abs(x), Math.abs(z)) / MAP_HALF;
    if (d > 0.78) y -= (d - 0.78) * (d - 0.78) * 240;
    return y;
  }

  _buildHeightGrid() {
    this.grid = new Float32Array(GRID_N * GRID_N);
    for (let j = 0; j < GRID_N; j++) {
      const z = -MAP_HALF + j * GRID_STEP;
      for (let i = 0; i < GRID_N; i++) {
        const x = -MAP_HALF + i * GRID_STEP;
        this.grid[j * GRID_N + i] = this._rawHeight(x, z);
      }
    }
  }

  heightAt(x, z) {
    const gx = clamp((x + MAP_HALF) / GRID_STEP, 0, GRID_N - 1.001);
    const gz = clamp((z + MAP_HALF) / GRID_STEP, 0, GRID_N - 1.001);
    const i = Math.floor(gx), j = Math.floor(gz);
    const fx = gx - i, fz = gz - j;
    const g = this.grid;
    const h00 = g[j * GRID_N + i], h10 = g[j * GRID_N + i + 1];
    const h01 = g[(j + 1) * GRID_N + i], h11 = g[(j + 1) * GRID_N + i + 1];
    return (h00 * (1 - fx) + h10 * fx) * (1 - fz) + (h01 * (1 - fx) + h11 * fx) * fz;
  }

  /** Высота поверхности с учётом полов зданий. */
  surfaceY(x, z) {
    let y = this.heightAt(x, z);
    for (let i = 0; i < this.floors.length; i++) {
      const f = this.floors[i];
      if (x >= f.minX && x <= f.maxX && z >= f.minZ && z <= f.maxZ && f.y > y - 3) {
        return Math.max(y, f.y);
      }
    }
    return y;
  }

  isWater(x, z) { return this.heightAt(x, z) < 0.15; }

  _buildTerrain() {
    const seg = 160;
    const geo = new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    const grass = new THREE.Color(0x6b8a48);
    const grass2 = new THREE.Color(0x57773b);
    const sand = new THREE.Color(0xcdbb8d);
    const rock = new THREE.Color(0x8d8a80);
    const dirt = new THREE.Color(0x8a7a5a);

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const y = this.heightAt(x, z);
      pos.setY(i, y);
      const patch = this.detailNoise(x * 0.03, z * 0.03);
      if (y < 0.6) c.copy(sand);
      else if (y < 2.2) c.copy(sand).lerp(grass, (y - 0.6) / 1.6);
      else if (y > 20) c.copy(rock).lerp(grass, clamp((28 - y) / 12, 0, 1));
      else c.copy(grass).lerp(grass2, patch);
      if (y > 2 && patch > 0.82) c.lerp(dirt, 0.35);
      const shade = 0.9 + this.detailNoise(x * 0.12 + 30, z * 0.12) * 0.2;
      colors[i * 3] = c.r * shade;
      colors[i * 3 + 1] = c.g * shade;
      colors[i * 3 + 2] = c.b * shade;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.terrain = new THREE.Mesh(geo, mat);
    this.terrain.name = 'terrain';
    this.scene.add(this.terrain);
  }

  _buildWater() {
    const geo = new THREE.PlaneGeometry(MAP_SIZE * 1.6, MAP_SIZE * 1.6);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshLambertMaterial({
      color: 0x2e6f96, transparent: true, opacity: 0.82,
    });
    this.water = new THREE.Mesh(geo, mat);
    this.water.position.y = 0.05;
    this.water.name = 'water';
    this.scene.add(this.water);
  }

  // ---------- посёлки и дома ----------

  _flatSpot(x, z, w, d, tol = 1.5) {
    if (this.isWater(x, z)) return false;
    let lo = Infinity, hi = -Infinity;
    for (let sx = -1; sx <= 1; sx++) {
      for (let sz = -1; sz <= 1; sz++) {
        const h = this.heightAt(x + sx * w * 0.5, z + sz * d * 0.5);
        lo = Math.min(lo, h); hi = Math.max(hi, h);
      }
    }
    if (hi < 1.3) return false;
    return hi - lo < tol;
  }

  _free(x, z, w, d, margin = 6) {
    const r = { minX: x - w / 2 - margin, maxX: x + w / 2 + margin, minZ: z - d / 2 - margin, maxZ: z + d / 2 + margin };
    for (const b of this.busyRects) {
      if (r.minX < b.maxX && r.maxX > b.minX && r.minZ < b.maxZ && r.maxZ > b.minZ) return false;
    }
    return true;
  }

  _buildTowns() {
    const rng = this.rng;
    const builder = new BoxBuilder();
    this.boxBuilder = builder;

    // 6 посёлков + одиночные дома = ощущение обжитой карты
    let attempts = 0;
    while (this.towns.length < 6 && attempts++ < 400) {
      const a = rng() * Math.PI * 2;
      const r = rnd(rng, 140, 560);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (!this._flatSpot(x, z, 60, 60, 5)) continue;
      if (this.towns.some((t) => Math.hypot(t.x - x, t.z - z) < 260)) continue;
      this.towns.push({ x, z });
      const count = rndInt(rng, 4, 8);
      for (let i = 0; i < count; i++) {
        const ang = rng() * Math.PI * 2;
        const dist = rnd(rng, 12, 52);
        this._placeBuilding(
          clamp(x + Math.cos(ang) * dist, -600, 600),
          clamp(z + Math.sin(ang) * dist, -600, 600),
          builder, rng,
        );
      }
    }
    // одинокие хутора
    for (let i = 0; i < 16; i++) {
      const x = rnd(rng, -600, 600), z = rnd(rng, -600, 600);
      this._placeBuilding(x, z, builder, rng);
    }
    builder.build(this.scene);
  }

  _placeBuilding(x, z, builder, rng) {
    const rand = rng();
    let w, d, h;
    if (rand < 0.16) { w = 20; d = 14; h = 5.2; }        // склад
    else if (rand < 0.32) { w = 7; d = 6; h = 3.0; }     // сарай
    else { w = rndInt(rng, 10, 14); d = rndInt(rng, 8, 11); h = 3.4; } // дом
    if (!this._free(x, z, w, d, 5)) return false;
    if (!this._flatSpot(x, z, w, d, 2.2)) return false;
    this._makeBuilding(x, z, w, d, h, builder, rng);
    return true;
  }

  _makeBuilding(cx, cz, w, d, h, builder, rng) {
    let maxH = -Infinity;
    for (const sx of [-0.5, 0, 0.5]) for (const sz of [-0.5, 0, 0.5]) {
      maxH = Math.max(maxH, this.heightAt(cx + sx * w, cz + sz * d));
    }
    const floorY = maxH + 0.18;
    const thickness = 0.32;
    const wallKey = pick(rng, ['wall', 'wall', 'wallBrick', 'wallOld']);
    const roofKey = pick(rng, ['roof', 'roofDark']);
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;

    // фундамент-цоколь, чтобы дом не висел над склоном
    builder.add('concrete', cx, floorY - 0.7, cz, w + 0.4, 1.4, d + 0.4);
    builder.add('floor', cx, floorY - 0.03, cz, w, 0.12, d);

    const doorW = 2.3;
    const doorX = cx + rnd(rng, -w * 0.25, w * 0.25);
    const winW = 1.6, winB = floorY + 1.1, winT = floorY + 2.15;

    // Передняя стена (+Z): дверной проём
    this._wallLine(true, z1, x0, x1, floorY, floorY + h, thickness, [
      { start: doorX - doorW / 2, end: doorX + doorW / 2, bottom: floorY, top: floorY + 2.3 },
    ], builder, wallKey);

    // Задняя стена (-Z): окно
    const wx = cx + rnd(rng, -w * 0.2, w * 0.2);
    this._wallLine(true, z0, x0, x1, floorY, floorY + h, thickness, [
      { start: wx - winW / 2, end: wx + winW / 2, bottom: winB, top: winT },
    ], builder, wallKey);

    // Боковые стены: окна по желанию
    const sideWindows = [];
    if (w >= 10) {
      sideWindows.push({ start: cz - 1.4, end: cz + 1.4, bottom: winB, top: winT });
    }
    this._wallLine(false, x0, z0 + thickness / 2, z1 - thickness / 2, floorY, floorY + h, thickness, sideWindows, builder, wallKey);
    this._wallLine(false, x1, z0 + thickness / 2, z1 - thickness / 2, floorY, floorY + h, thickness,
      w >= 10 ? [{ start: cz - 1.4, end: cz + 1.4, bottom: winB, top: winT }] : [], builder, wallKey);

    // Внутренняя перегородка с проходом (для больших домов)
    if (w >= 12) {
      const ix = cx + rnd(rng, -1.5, 1.5);
      const gapZ = cz + rnd(rng, -d * 0.2, d * 0.2);
      this._wallLine(false, ix, z0 + thickness, z1 - thickness, floorY, floorY + h - 0.2, 0.24, [
        { start: gapZ - 1.2, end: gapZ + 1.2, bottom: floorY, top: floorY + 2.3 },
      ], builder, wallKey);
    }

    // Крыша: двускатная из двух наклонных плит + фронтоны
    const roofH = h * 0.42;
    const slope = Math.atan2(roofH, w / 2);
    const rw = Math.hypot(w / 2 + 0.5, roofH) * 1.02;
    for (const sign of [-1, 1]) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(rw, 0.22, d + 0.9),
        new THREE.MeshLambertMaterial({ color: COLORS[roofKey] }),
      );
      mesh.position.set(cx + sign * (w / 4 + 0.12), floorY + h + roofH / 2, cz);
      mesh.rotation.z = -sign * slope;
      mesh.name = 'roof';
      this.scene.add(mesh);
    }
    // фронтонные треугольники
    const triShape = new THREE.Shape();
    triShape.moveTo(-w / 2, 0); triShape.lineTo(w / 2, 0); triShape.lineTo(0, roofH); triShape.closePath();
    const triGeo = new THREE.ShapeGeometry(triShape);
    const triMat = new THREE.MeshLambertMaterial({ color: COLORS[wallKey], side: THREE.DoubleSide });
    for (const zz of [z0 + 0.1, z1 - 0.1]) {
      const tri = new THREE.Mesh(triGeo, triMat);
      tri.position.set(cx, floorY + h, zz);
      this.scene.add(tri);
    }

    // Обстановка: ящики, столы (часть — с коллизией)
    const furniture = rndInt(rng, 1, 4);
    for (let i = 0; i < furniture; i++) {
      const fx = rnd(rng, x0 + 1.6, x1 - 1.6);
      const fz = rnd(rng, z0 + 1.6, z1 - 1.6);
      if (Math.abs(fx - doorX) < 2 && fz > cz) continue;
      const size = rnd(rng, 0.7, 1.2);
      builder.add('crate', fx, floorY + size / 2, fz, size, size, size);
      this._addCollider(fx, floorY + size / 2, fz, size, size, size);
    }

    this.floors.push({ minX: x0 + 0.1, maxX: x1 - 0.1, minZ: z0 + 0.1, maxZ: z1 - 0.1, y: floorY });
    this.buildings.push({ x: cx, z: cz, w, d, h, floorY });
    this.busyRects.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1 });

    // 2–4 точки лута внутри
    const lootCount = rndInt(rng, 2, 4);
    for (let i = 0; i < lootCount; i++) {
      this.spawnSpots.push({
        x: rnd(rng, x0 + 1.5, x1 - 1.5),
        y: floorY,
        z: rnd(rng, z0 + 1.5, z1 - 1.5),
        indoor: true,
      });
    }
  }

  /** Стена с проёмами (двери/окна). horiz — вдоль X при фиксированном Z. */
  _wallLine(horiz, lineCoord, a0, a1, yBase, yTop, thickness, openings, builder, key) {
    const pieces = [];
    const ops = openings.slice().sort((p, q) => p.start - q.start);
    let cursor = a0;
    for (const op of ops) {
      const s = Math.max(a0, op.start), e = Math.min(a1, op.end);
      if (e <= cursor) continue;
      if (s > cursor) pieces.push([cursor, s, yBase, yTop]);
      if (op.bottom > yBase + 0.01) pieces.push([s, e, yBase, op.bottom]);
      if (op.top < yTop - 0.01) pieces.push([s, e, op.top, yTop]);
      cursor = Math.max(cursor, e);
    }
    if (cursor < a1) pieces.push([cursor, a1, yBase, yTop]);

    for (const [px0, px1, py0, py1] of pieces) {
      const len = px1 - px0;
      if (len <= 0.02 || py1 - py0 <= 0.02) continue;
      const cAlong = (px0 + px1) / 2;
      const cy = (py0 + py1) / 2;
      const sy = py1 - py0;
      let cx, cz, sx, sz;
      if (horiz) { cx = cAlong; cz = lineCoord; sx = len; sz = thickness; }
      else { cx = lineCoord; cz = cAlong; sx = thickness; sz = len; }
      builder.add(key, cx, cy, cz, sx, sy, sz);
      this._addCollider(cx, cy, cz, sx, sy, sz);
    }
  }

  _addCollider(cx, cy, cz, sx, sy, sz) {
    this.colliders.push({
      minX: cx - sx / 2, maxX: cx + sx / 2,
      minY: cy - sy / 2, maxY: cy + sy / 2,
      minZ: cz - sz / 2, maxZ: cz + sz / 2,
    });
  }

  // ---------- растительность ----------

  _buildVegetation() {
    const rng = this.rng;
    const trees = [];
    let attempts = 0;
    while (trees.length < 620 && attempts++ < 8000) {
      const x = rnd(rng, -700, 700), z = rnd(rng, -700, 700);
      const y = this.heightAt(x, z);
      if (y < 1.6 || y > 22) continue;
      if (this._insideAnyBuilding(x, z, 3)) continue;
      // леса сгущаются по шуму
      const density = this.detailNoise(x * 0.004 + 50, z * 0.004 + 10);
      if (density < 0.42 && rng() > 0.25) continue;
      trees.push({ x, y, z, s: rnd(rng, 0.75, 1.6), r: rng() * Math.PI * 2 });
    }

    const trunkGeo = new THREE.CylinderGeometry(0.28, 0.42, 4.2, 5);
    trunkGeo.translate(0, 2.1, 0);
    const trunkMat = new THREE.MeshLambertMaterial({ color: COLORS.trunk });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, trees.length);

    const crownGeo = new THREE.ConeGeometry(2.3, 6.2, 6);
    crownGeo.translate(0, 5.6, 0);
    const crownMat = new THREE.MeshLambertMaterial({ color: COLORS.leaf, flatShading: true });
    const crowns = new THREE.InstancedMesh(crownGeo, crownMat, trees.length);

    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    trees.forEach((t, i) => {
      dummy.position.set(t.x, t.y - 0.25, t.z);
      dummy.rotation.set(0, t.r, 0);
      dummy.scale.setScalar(t.s);
      dummy.updateMatrix();
      trunks.setMatrixAt(i, dummy.matrix);
      crowns.setMatrixAt(i, dummy.matrix);
      crowns.setColorAt(i, col.setHSL(0.26 + rng() * 0.05, 0.34 + rng() * 0.12, 0.24 + rng() * 0.1));
      this.treeColliders.push({ x: t.x, z: t.z, r: 0.55 * t.s });
    });
    trunks.frustumCulled = false;
    crowns.frustumCulled = false;
    crowns.instanceColor.needsUpdate = true;
    this.scene.add(trunks, crowns);
    this.trees = trees;
  }

  _buildRocks() {
    const rng = this.rng;
    const rocks = [];
    for (let i = 0; i < 140; i++) {
      const x = rnd(rng, -700, 700), z = rnd(rng, -700, 700);
      const y = this.heightAt(x, z);
      if (y < 0.8 || this._insideAnyBuilding(x, z, 2)) continue;
      rocks.push({ x, y, z, s: rnd(rng, 0.7, 3), r: rng() * Math.PI * 2 });
    }
    const geo = new THREE.DodecahedronGeometry(1, 0);
    const mat = new THREE.MeshLambertMaterial({ color: COLORS.rock, flatShading: true });
    const mesh = new THREE.InstancedMesh(geo, mat, rocks.length);
    const dummy = new THREE.Object3D();
    rocks.forEach((r, i) => {
      dummy.position.set(r.x, r.y + r.s * 0.25, r.z);
      dummy.rotation.set(r.r * 0.4, r.r, r.r * 0.7);
      dummy.scale.set(r.s, r.s * 0.7, r.s);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      this.treeColliders.push({ x: r.x, z: r.z, r: r.s * 0.65 });
    });
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.rocks = rocks;
  }

  _buildLooseLootSpots() {
    const rng = this.rng;
    // лут вокруг зданий и в случайных точках суши
    for (const b of this.buildings) {
      const n = rndInt(rng, 0, 2);
      for (let i = 0; i < n; i++) {
        const a = rng() * Math.PI * 2, r = rnd(rng, 7, 16);
        const x = b.x + Math.cos(a) * r, z = b.z + Math.sin(a) * r;
        if (this.isWater(x, z)) continue;
        this.spawnSpots.push({ x, y: this.heightAt(x, z), z, indoor: false });
      }
    }
    for (let i = 0; i < 40; i++) {
      const x = rnd(rng, -650, 650), z = rnd(rng, -650, 650);
      const y = this.heightAt(x, z);
      if (y < 1) continue;
      this.spawnSpots.push({ x, y, z, indoor: false });
    }
  }

  _insideAnyBuilding(x, z, margin = 0) {
    for (const b of this.buildings) {
      if (x > b.x - b.w / 2 - margin && x < b.x + b.w / 2 + margin &&
          z > b.z - b.d / 2 - margin && z < b.z + b.d / 2 + margin) return true;
    }
    return false;
  }

  // ---------- физика ----------

  /** Выталкивание круга игрока/бота из стен и стволов. */
  resolveCollisions(pos, radius, height = 1.8) {
    const feet = pos.y, head = pos.y + height;
    const cols = this._collidersNear(pos.x, pos.z, radius + 2);
    for (let i = 0; i < cols.length; i++) {
      const b = cols[i];
      if (head < b.minY || feet > b.maxY) continue;
      // ближайшая точка прямоугольника
      const nx = clamp(pos.x, b.minX, b.maxX);
      const nz = clamp(pos.z, b.minZ, b.maxZ);
      let dx = pos.x - nx, dz = pos.z - nz;
      const dist2 = dx * dx + dz * dz;
      if (dist2 > radius * radius) continue;
      if (dist2 > 1e-6) {
        const dist = Math.sqrt(dist2);
        pos.x += (dx / dist) * (radius - dist);
        pos.z += (dz / dist) * (radius - dist);
      } else {
        // центр внутри коробки — выталкиваем по минимальной оси
        const left = pos.x - b.minX, right = b.maxX - pos.x;
        const back = pos.z - b.minZ, front = b.maxZ - pos.z;
        const m = Math.min(left, right, back, front);
        if (m === left) pos.x = b.minX - radius;
        else if (m === right) pos.x = b.maxX + radius;
        else if (m === back) pos.z = b.minZ - radius;
        else pos.z = b.maxZ + radius;
      }
    }
    const trees = this._treesNear(pos.x, pos.z, radius + 2);
    for (let i = 0; i < trees.length; i++) {
      const t = trees[i];
      const dx = pos.x - t.x, dz = pos.z - t.z;
      const rr = radius + t.r;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && d2 > 1e-5) {
        const d = Math.sqrt(d2);
        pos.x += (dx / d) * (rr - d);
        pos.z += (dz / d) * (rr - d);
      }
    }
  }

  /** Ближайшее попадание луча в мир. Возвращает дистанцию (или maxDist). */
  raycast(ox, oy, oz, dx, dy, dz, maxDist) {
    let best = maxDist;
    const cols = this._collidersAlong(ox, oz, dx, dz, maxDist);
    for (let i = 0; i < cols.length; i++) {
      const t = rayAABB(ox, oy, oz, dx, dy, dz, cols[i]);
      if (t >= 0 && t < best) best = t;
    }
    // рельеф: шагаем вдоль луча
    if (dy < 0.999) {
      const step = 2.5;
      for (let t = 1; t < best; t += step) {
        const px = ox + dx * t, py = oy + dy * t, pz = oz + dz * t;
        if (py < this.heightAt(px, pz)) { best = t; break; }
      }
    }
    return best;
  }

  /** Есть ли прямая видимость между двумя точками. */
  hasLineOfSight(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 0.01) return true;
    const hit = this.raycast(ax, ay, az, dx / len, dy / len, dz / len, len - 0.3);
    return hit >= len - 0.4;
  }

  /** Случайная точка на земле (для ботов, дропа). */
  randomLandPoint(rng, around = null, radius = 600) {
    for (let i = 0; i < 200; i++) {
      let x, z;
      if (around) {
        const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * radius;
        x = around.x + Math.cos(a) * r; z = around.z + Math.sin(a) * r;
      } else {
        x = rnd(rng, -640, 640); z = rnd(rng, -640, 640);
      }
      const y = this.heightAt(x, z);
      if (y > 1.2) return new THREE.Vector3(x, y, z);
    }
    return new THREE.Vector3(0, Math.max(1, this.heightAt(0, 0)), 0);
  }
}
