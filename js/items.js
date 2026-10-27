// Оружие, боеприпасы, аптечки, броня и система лута.

import * as THREE from '../vendor/three.module.js';
import { mergeColored, rnd, rndInt, pick } from './util.js';

export const WEAPONS = {
  m416: {
    id: 'm416', name: 'M416', cls: 'rifle', ammo: '556', damage: 41, rpm: 700, auto: true,
    mag: 30, reload: 2.1, spreadHip: 2.0, spreadAds: 0.42, recoil: 1.0, range: 420, adsFov: 46,
    tracer: 0xffe08a,
  },
  akm: {
    id: 'akm', name: 'AKM', cls: 'rifle', ammo: '762', damage: 47, rpm: 600, auto: true,
    mag: 30, reload: 2.4, spreadHip: 2.5, spreadAds: 0.55, recoil: 1.5, range: 380, adsFov: 46,
    tracer: 0xffc070,
  },
  scar: {
    id: 'scar', name: 'SCAR-L', cls: 'rifle', ammo: '556', damage: 40, rpm: 625, auto: true,
    mag: 30, reload: 2.2, spreadHip: 1.9, spreadAds: 0.45, recoil: 0.9, range: 400, adsFov: 46,
    tracer: 0xffe08a,
  },
  ump: {
    id: 'ump', name: 'UMP45', cls: 'smg', ammo: '45', damage: 35, rpm: 650, auto: true,
    mag: 25, reload: 2.0, spreadHip: 1.6, spreadAds: 0.5, recoil: 0.7, range: 200, adsFov: 52,
    tracer: 0xffd6a0,
  },
  s686: {
    id: 's686', name: 'S686', cls: 'shotgun', ammo: '12g', damage: 22, pellets: 9, rpm: 190, auto: false,
    mag: 2, reload: 2.6, spreadHip: 4.2, spreadAds: 3.1, recoil: 3.0, range: 90, adsFov: 55,
    tracer: 0xfff0c0,
  },
  kar98: {
    id: 'kar98', name: 'Kar98k', cls: 'sniper', ammo: '762', damage: 92, rpm: 42, auto: false,
    mag: 5, reload: 3.4, spreadHip: 5.5, spreadAds: 0.08, recoil: 3.4, range: 900, adsFov: 18,
    scope: true, tracer: 0xffffff,
  },
  p92: {
    id: 'p92', name: 'P92', cls: 'pistol', ammo: '9mm', damage: 33, rpm: 400, auto: false,
    mag: 15, reload: 1.7, spreadHip: 2.4, spreadAds: 0.9, recoil: 0.9, range: 150, adsFov: 55,
    tracer: 0xffe8b0,
  },
};

export const AMMO_LABEL = { '556': '5.56 мм', '762': '7.62 мм', '45': '.45 ACP', '9mm': '9 мм', '12g': '12 калибр' };
export const AMMO_COLOR = { '556': 0xc9d68a, '762': 0xd8a45a, '45': 0xb8b0a0, '9mm': 0xc0c8d8, '12g': 0xc45c4a };

export const HEALS = {
  bandage: { id: 'bandage', name: 'Бинт', amount: 15, time: 3.0, maxCap: 75, color: 0xf2efe2 },
  firstaid: { id: 'firstaid', name: 'Аптечка', amount: 100, time: 5.0, maxCap: 75, color: 0xe4e8e0 },
  medkit: { id: 'medkit', name: 'Большая аптечка', amount: 100, time: 8.0, maxCap: 100, color: 0x8fd6a0 },
};

export const ARMOR_LABEL = { 1: 'Бронежилет 1 ур.', 2: 'Бронежилет 2 ур.', 3: 'Бронежилет 3 ур.' };
export const HELMET_LABEL = { 1: 'Каска 1 ур.', 2: 'Каска 2 ур.', 3: 'Каска 3 ур.' };

// ---------- геометрия предметов ----------

const GEO = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 8),
  ico: new THREE.IcosahedronGeometry(0.5, 0),
};

const lootGeoCache = new Map();

/** Строит «модельку» предмета как одну геометрию с цветами. */
export function lootGeometry(type, key) {
  const id = type + ':' + key;
  if (lootGeoCache.has(id)) return lootGeoCache.get(id);
  let parts;

  if (type === 'weapon') {
    const w = WEAPONS[key];
    const bodyColor = w.cls === 'sniper' ? 0x6b4c2f : w.cls === 'shotgun' ? 0x7a4a2a : 0x3a3d42;
    const len = w.cls === 'sniper' ? 1.5 : w.cls === 'pistol' ? 0.55 : 1.15;
    parts = [
      { geo: GEO.box, color: bodyColor, position: [0, 0.24, 0], scale: [0.11, 0.14, len] },
      { geo: GEO.box, color: 0x24262a, position: [0, 0.21, len * 0.62], scale: [0.05, 0.05, len * 0.5] },
      { geo: GEO.box, color: 0x2c2f33, position: [0, 0.13, -0.06], scale: [0.08, 0.24, 0.22] },
      { geo: GEO.box, color: 0x4a3a28, position: [0, 0.24, -len * 0.55], scale: [0.1, 0.13, len * 0.4] },
    ];
    if (w.cls === 'sniper') parts.push({ geo: GEO.cyl, color: 0x1b1d20, position: [0, 0.36, 0.05], rotation: [Math.PI / 2, 0, 0], scale: [0.08, 0.5, 0.08] });
    if (w.cls === 'rifle') parts.push({ geo: GEO.box, color: 0x25272b, position: [0, 0.17, 0.12], scale: [0.06, 0.2, 0.12] });
  } else if (type === 'ammo') {
    parts = [
      { geo: GEO.box, color: AMMO_COLOR[key], position: [0, 0.12, 0], scale: [0.36, 0.24, 0.26] },
      { geo: GEO.box, color: 0x2b2b2b, position: [0, 0.13, 0], scale: [0.38, 0.06, 0.28] },
    ];
  } else if (type === 'heal') {
    const c = HEALS[key].color;
    parts = [
      { geo: GEO.box, color: c, position: [0, 0.14, 0], scale: [0.34, 0.28, 0.3] },
      { geo: GEO.box, color: key === 'bandage' ? 0xc94b4b : 0x2f7d4f, position: [0, 0.14, 0.155], scale: [0.18, 0.06, 0.02] },
      { geo: GEO.box, color: key === 'bandage' ? 0xc94b4b : 0x2f7d4f, position: [0, 0.14, 0.155], scale: [0.06, 0.18, 0.02] },
    ];
  } else if (type === 'armor') {
    parts = [
      { geo: GEO.box, color: key >= 3 ? 0x2f3b2f : key === 2 ? 0x39414d : 0x4a4a44, position: [0, 0.3, 0], scale: [0.5, 0.6, 0.24] },
      { geo: GEO.box, color: 0x1f2420, position: [0, 0.45, 0.12], scale: [0.34, 0.1, 0.04] },
    ];
  } else {
    const c = key >= 3 ? 0x394a3a : key === 2 ? 0x3d4552 : 0x50514a;
    parts = [
      { geo: GEO.ico, color: c, position: [0, 0.24, 0], scale: [0.52, 0.5, 0.56] },
      { geo: GEO.box, color: 0x22252a, position: [0, 0.1, 0], scale: [0.5, 0.1, 0.5] },
    ];
  }
  // парящий маркер, чтобы предметы были заметны
  parts.push({ geo: GEO.box, color: 0xffd25e, position: [0, 1.15, 0], scale: [0.05, 0.35, 0.05] });
  parts.push({ geo: GEO.box, color: 0xffd25e, position: [0, 1.38, 0], scale: [0.16, 0.05, 0.05] });

  const geo = mergeColored(parts);
  lootGeoCache.set(id, geo);
  return geo;
}

const lootMat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x141414 });

export function lootLabel(type, key) {
  if (type === 'weapon') return WEAPONS[key].name;
  if (type === 'ammo') return AMMO_LABEL[key];
  if (type === 'heal') return HEALS[key].name;
  if (type === 'armor') return ARMOR_LABEL[key];
  if (type === 'helmet') return HELMET_LABEL[key];
  return '?';
}

// ---------- таблица дропа ----------

const LOOT_TABLE = [
  ['weapon', 'm416', 6], ['weapon', 'akm', 6], ['weapon', 'scar', 5],
  ['weapon', 'ump', 7], ['weapon', 's686', 6], ['weapon', 'p92', 6], ['weapon', 'kar98', 4],
  ['ammo', '556', 9], ['ammo', '762', 9], ['ammo', '45', 6], ['ammo', '9mm', 6], ['ammo', '12g', 5],
  ['heal', 'bandage', 11], ['heal', 'firstaid', 7], ['heal', 'medkit', 3],
  ['armor', 1, 6], ['armor', 2, 4], ['armor', 3, 2],
  ['helmet', 1, 6], ['helmet', 2, 3], ['helmet', 3, 1],
];

const TABLE_TOTAL = LOOT_TABLE.reduce((s, e) => s + e[2], 0);

function rollLoot(rng) {
  let r = rng() * TABLE_TOTAL;
  for (const [type, key, w] of LOOT_TABLE) {
    r -= w;
    if (r <= 0) return { type, key };
  }
  return { type: 'ammo', key: '556' };
}

// ---------- менеджер лута ----------

export class LootManager {
  constructor(scene, world, rng) {
    this.scene = scene;
    this.world = world;
    this.rng = rng;
    this.items = [];
    this.groundItems = [];
    this._t = 0;
    this.maxItems = 260;
  }

  spawnAt(x, y, z, type, key, elevated = false) {
    if (this.items.length >= this.maxItems) return null;
    const mesh = new THREE.Mesh(lootGeometry(type, key), lootMat);
    mesh.position.set(x, y, z);
    mesh.rotation.y = this.rng() * Math.PI * 2;
    mesh.name = 'loot';
    this.scene.add(mesh);
    const item = {
      type, key, mesh,
      x, y, z,
      baseY: y,
      phase: this.rng() * Math.PI * 2,
      taken: false,
      elevated,
      label: lootLabel(type, key),
      ammo: type === 'ammo' ? this.ammoAmount(key) : 0,
    };
    this.items.push(item);
    return item;
  }

  ammoAmount(cal) {
    if (cal === '12g') return rndInt(this.rng, 6, 12);
    if (cal === '9mm') return rndInt(this.rng, 15, 30);
    return rndInt(this.rng, 20, 40);
  }

  spawnFromWorld() {
    for (const spot of this.world.spawnSpots) {
      if (this.rng() < 0.35) continue; // не каждая точка занята
      const { type, key } = rollLoot(this.rng);
      this.spawnAt(spot.x, spot.y, spot.z, type, key, spot.indoor);
    }
  }

  /** Начальный набор на выжившего. */
  spawnStarterAmmo(x, y, z) {
    this.spawnAt(x + 0.8, y, z, 'ammo', '556');
    this.spawnAt(x - 0.8, y, z, 'ammo', '762');
    this.spawnAt(x, y, z + 0.8, 'heal', 'bandage');
  }

  dropWeapon(x, y, z, weaponId) {
    return this.spawnAt(x, y, z, 'weapon', weaponId);
  }

  /** Дроп с убитого бота: оружие, патроны, аптечка. */
  dropFromBot(bot) {
    const w = bot.weapon;
    if (w) this.spawnAt(bot.pos.x + 0.6, this.world.surfaceY(bot.pos.x + 0.6, bot.pos.z), bot.pos.z, 'weapon', w.def.id);
    this.spawnAt(bot.pos.x - 0.6, this.world.surfaceY(bot.pos.x - 0.6, bot.pos.z), bot.pos.z, 'ammo', w ? w.def.ammo : '556');
    if (this.rng() < 0.7) this.spawnAt(bot.pos.x, this.world.surfaceY(bot.pos.x, bot.pos.z + 0.7), bot.pos.z + 0.7, 'heal', this.rng() < 0.5 ? 'bandage' : 'firstaid');
    if (bot.armorLevel > 0 && this.rng() < 0.6) this.spawnAt(bot.pos.x, this.world.surfaceY(bot.pos.x, bot.pos.z - 0.7), bot.pos.z - 0.7, 'armor', bot.armorLevel);
  }

  update(dt, playerPos) {
    this._t += dt;
    for (const it of this.items) {
      if (it.taken) continue;
      // парение + подсветка рядом
      it.mesh.position.y = it.baseY + Math.sin(this._t * 1.7 + it.phase) * 0.06;
      const d = Math.hypot(it.x - playerPos.x, it.z - playerPos.z);
      it.mesh.scale.setScalar(d < 20 ? 1.15 : 1);
      it.near = d < 2.6 && Math.abs(playerPos.y - it.y) < 2.2;
    }
  }

  /** Ближайший предмет в радиусе подбора. */
  nearest(playerPos, radius = 2.6) {
    let best = null, bestD = radius;
    for (const it of this.items) {
      if (it.taken) continue;
      const d = Math.hypot(it.x - playerPos.x, it.z - playerPos.z);
      if (d < bestD && Math.abs(it.baseY - playerPos.y) < 2.2) { best = it; bestD = d; }
    }
    return best;
  }

  remove(item) {
    item.taken = true;
    this.scene.remove(item.mesh);
  }

  /** Сколько предметов ещё лежит (для HUD/отладки). */
  get remaining() { return this.items.reduce((n, i) => n + (i.taken ? 0 : 1), 0); }
}
