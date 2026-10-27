#!/usr/bin/env node
// Безголовый прогон игровой логики (без WebGL): мир, физика, боты, зона, лут.
// Ловит падения и «NaN» до того, как их увидит игрок в браузере.
//   node tools/sim.mjs

import * as THREE from '../vendor/three.module.js';
import { World } from '../js/world.js';
import { LootManager } from '../js/items.js';
import { Player } from '../js/player.js';
import { BotManager } from '../js/bots.js';
import { Zone } from '../js/zone.js';
import { mulberry32 } from '../js/util.js';

const problems = [];
const ok = (cond, msg) => { if (!cond) problems.push(msg); };

const scene = new THREE.Scene();
const t0 = performance.now();
const world = new World(scene, 424242);
const buildTime = performance.now() - t0;

console.log(`мир: ${world.buildings.length} зданий, ${world.trees.length} деревьев, `
  + `${world.colliders.length} коллайдеров, ${world.spawnSpots.length} точек лута — ${buildTime.toFixed(0)} мс`);
ok(world.buildings.length > 30, 'слишком мало зданий');
ok(world.spawnSpots.length > 40, 'слишком мало точек лута');

const rng = mulberry32(777);
const loot = new LootManager(scene, world, rng);
loot.spawnFromWorld();
console.log(`лут: ${loot.remaining} предметов`);

const camera = new THREE.PerspectiveCamera(78, 16 / 9, 0.1, 2000);
camera.rotation.order = 'YXZ';
const input = {
  yaw: 0, pitch: 0, move: { x: 0, z: 0 }, sensitivity: 1, locked: true,
  fire: false, aim: false,
  down(a) { return a === 'fire' ? this.fire : a === 'aim' ? this.aim : false; },
  pressed() { return false; },
  addRecoil() {},
  endFrame() {},
};
const audio = { play() {}, setPlane() {} };

const start = world.randomLandPoint(rng);
const player = new Player({ camera, world, input, audio, scene });
player.reset(start);
player.pos.y = world.surfaceY(start.x, start.z);

const zone = new Zone(scene, rng);
zone.reset();

let bots = null;
const hits = { playerShots: 0, hits: 0, botShots: 0, playerHits: 0, deaths: 0, kills: 0 };

let simTime = 0;
const game = {
  time: 0,
  loot,
  zone,
  toast() {},
  onFell() {},
  onHitMark() {},
  onZoneDamage() {},
  get player() { return player; },
  traceShot(origin, dir, range) {
    hits.playerShots++;
    const wd = world.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, range);
    let best = wd, target = null, head = false;
    const b = bots.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, best);
    if (b) { best = b.t; target = b.bot; head = b.head; }
    if (target) {
      hits.hits++;
      const applied = target.takeDamage(36, head, player, game);
      player.damageDealt += applied;
    }
    if (!Number.isFinite(best)) problems.push('traceShot вернул NaN');
    return { hit: !!target };
  },
  botShoot(bot, origin, dir, def) {
    hits.botShots++;
    if (this.time < 40) return; // первые 40 секунд даём игроку освоиться
    const p = player;
    if (p.isDead) return;
    // упрощённая проверка: попадание с шансом, зависящим от дистанции
    const dist = Math.hypot(bot.pos.x - p.pos.x, bot.pos.z - p.pos.z);
    const chance = Math.max(0.04, 0.55 - dist / 260);
    const blocked = !world.hasLineOfSight(origin.x, origin.y, origin.z, p.pos.x, p.pos.y + 1.2, p.pos.z);
    if (!blocked && Math.random() < chance) {
      hits.playerHits++;
      p.damage(def.damage * 0.6, { head: Math.random() < 0.08, attacker: bot });
    }
  },
  onBotKilled(bot, killer) {
    hits.deaths++;
    if (killer?.isPlayer) { player.kills++; hits.kills++; }
  },
};

bots = new BotManager({
  scene, world, loot, rng, count: 34,
  onKill: (victim, killer, simulated) => game.onBotKilled(victim, killer, simulated),
});

// тестовый «манекен» в 30 метрах: проверяем, что пули долетают и убивают
{
  const dummy = bots.bots[0];
  dummy.pos.set(start.x + 30, 0, start.z + 4);
  dummy.pos.y = world.surfaceY(dummy.pos.x, dummy.pos.z);
  dummy.state = 'roam';
  dummy.land();
  dummy.hp = 60;
}

// игрок экипируется
player.pickup(loot.spawnAt(player.pos.x + 0.5, player.pos.y, player.pos.z, 'weapon', 'm416'), loot);
player.ammo['556'] = 300;
player.pickup(loot.spawnAt(player.pos.x, player.pos.y, player.pos.z, 'armor', 2), loot);
player.pickup(loot.spawnAt(player.pos.x, player.pos.y, player.pos.z, 'heal', 'firstaid'), loot);
ok(player.weaponDef?.id === 'm416', 'оружие не подобралось');
ok(player.armorLevel === 2, 'броня не наделась');
ok(player.heals.firstaid === 1, 'аптечка не подобралась');

const dt = 1 / 30;
const seconds = 240;
const steps = Math.floor(seconds / dt);
let healed = 0;

for (let i = 0; i < steps; i++) {
  const t = i * dt;
  game.time = t;

  // «игрок» бегает и стреляет очередями
  if (i % 45 === 0) {
    input.yaw = Math.random() * Math.PI * 2;
    input.move.z = Math.random() < 0.8 ? 1 : -1;
    input.move.x = Math.random() < 0.4 ? (Math.random() < 0.5 ? 1 : -1) : 0;
  }
  // для проверки боевой системы подтаскиваем бота поближе к игроку
  if (i % 300 === 0 && i > 0 && player.kills < 4 && !player.isDead) {
    const alive = bots.bots.filter((b) => b.alive && b.state !== 'falling');
    if (alive.length) {
      const b = alive[Math.floor(Math.random() * alive.length)];
      const ang = Math.random() * Math.PI * 2;
      const r = 28 + Math.random() * 22;
      b.pos.set(player.pos.x + Math.cos(ang) * r, 0, player.pos.z + Math.sin(ang) * r);
      b.pos.y = world.surfaceY(b.pos.x, b.pos.z);
      b.state = 'roam';
    }
  }
  input.fire = i % 90 < 30;
  input.aim = i % 200 < 60;

  // прицеливаемся в ближайшего бота: проверяем, что попадания засчитываются
  if (bots && !player.isDead) {
    const alive = bots.bots.filter((b) => b.alive && b.state !== 'falling');
    if (alive.length) {
      let near = alive[0], bestD = Infinity;
      for (const b of alive) {
        const d = Math.hypot(b.pos.x - camera.position.x, b.pos.z - camera.position.z);
        if (d < bestD) { bestD = d; near = b; }
      }
      if (bestD < 120) {
        const dx = near.pos.x - camera.position.x;
        const dz = near.pos.z - camera.position.z;
        const dy = (near.pos.y + 1.15) - camera.position.y;
        input.yaw = Math.atan2(-dx, -dz);
        input.pitch = Math.atan2(dy, Math.hypot(dx, dz));
        input.fire = true;
        input.move.z = 0;
      }
    }
  }

  player.update(dt, t, game);

  // автоподбор
  const item = loot.nearest(player.pos, 2.8);
  if (item) player.pickup(item, loot);
  if (player.magAmmo === 0) player.startReload();
  if (player.hp < 45) { player.useHeal(); healed++; }

  bots.update(dt, t, player, game);
  zone.update(dt, player, game);
  loot.update(dt, player.pos);

  if (!Number.isFinite(player.pos.x) || !Number.isFinite(player.pos.y) || !Number.isFinite(player.pos.z)) {
    problems.push(`игрок улетел в NaN на шаге ${i}`);
    break;
  }
  for (const b of bots.bots) {
    if (!Number.isFinite(b.pos.x) || !Number.isFinite(b.pos.y)) {
      problems.push(`бот ${b.name} в NaN на шаге ${i}`);
      break;
    }
  }
  if (Math.abs(player.pos.x) > 700 || Math.abs(player.pos.z) > 700) {
    problems.push('игрок вышел за границы карты');
    break;
  }
}

const botsAlive = bots.aliveCount;
const landed = bots.bots.filter((b) => b.state !== 'falling').length;
const outside = bots.bots.filter((b) => b.alive && !zone.isInside(b.pos.x, b.pos.z)).length;

console.log(`\nитог за ${seconds} с симуляции:`);
console.log(`  игрок: HP ${player.hp.toFixed(0)}, броня ${player.armorLevel}, убийств ${player.kills}, `
  + `урон ${player.damageDealt.toFixed(0)}, жив: ${!player.isDead}`);
console.log(`  боты: живых ${botsAlive}/${bots.total}, приземлилось ${landed}, вне зоны ${outside}`);
console.log(`  стрельба: выстрелов игрока ${hits.playerShots}, попаданий ${hits.hits}; `
  + `выстрелов ботов ${hits.botShots}, попаданий по игроку ${hits.playerHits}`);
console.log(`  зона: фаза ${zone.phase}, радиус ${zone.radius.toFixed(0)} м, предметов на земле ${loot.remaining}`);

ok(landed >= 30, 'боты не приземлились');
ok(hits.playerShots > 100, 'игрок почти не стрелял — не работает оружие');
ok(hits.hits > 5, 'ни одна пуля игрока не попала в бота');
ok(hits.botShots > 20, 'боты не стреляют');
ok(zone.radius < 800, 'зона не сжимается');
ok(loot.remaining > 5, 'лут исчез');
ok(player.hp > 0 || player.isDead, 'здоровье игрока сломано');

if (problems.length) {
  console.log('\n❌ найдено:');
  for (const p of problems) console.log('  -', p);
  process.exit(1);
}
console.log('\n✅ симуляция прошла без ошибок');
