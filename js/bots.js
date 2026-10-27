// Боты: десантируются, собирают лут, воюют, бегут от синей зоны.
// Модель солдата — одна склеенная геометрия на бота, ИИ без дорогих расчётов.

import * as THREE from '../vendor/three.module.js';
import { mergeColored, rnd, rndInt, pick, clamp, raySphere, anglediff, randomName, chance } from './util.js';
import { WEAPONS } from './items.js';

const DEG = Math.PI / 180;

const soldierGeo = mergeColored([
  // ноги
  { geo: new THREE.BoxGeometry(1, 1, 1), color: 0x4b5340, position: [-0.12, 0.42, 0], scale: [0.17, 0.86, 0.2] },
  { geo: new THREE.BoxGeometry(1, 1, 1), color: 0x454c3b, position: [0.12, 0.42, 0], scale: [0.17, 0.86, 0.2] },
  // торс
  { geo: new THREE.BoxGeometry(1, 1, 1), color: 0x5d6749, position: [0, 1.1, 0], scale: [0.52, 0.6, 0.32] },
  // разгрузка
  { geo: new THREE.BoxGeometry(1, 1, 1), color: 0x38412f, position: [0, 1.12, 0.02], scale: [0.56, 0.34, 0.36] },
  // руки
  { geo: new THREE.BoxGeometry(1, 1, 1), color: 0x566044, position: [-0.32, 1.12, -0.05], rotation: [0.3, 0, 0.15], scale: [0.14, 0.5, 0.16] },
  { geo: new THREE.BoxGeometry(1, 1, 1), color: 0x515b41, position: [0.32, 1.12, -0.05], rotation: [0.3, 0, -0.15], scale: [0.14, 0.5, 0.16] },
  // голова
  { geo: new THREE.IcosahedronGeometry(1, 0), color: 0xc79c74, position: [0, 1.6, 0], scale: [0.22, 0.24, 0.23] },
  // каска
  { geo: new THREE.SphereGeometry(1, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), color: 0x3b4535, position: [0, 1.66, 0], scale: [0.26, 0.24, 0.27] },
  // рюкзак
  { geo: new THREE.BoxGeometry(1, 1, 1), color: 0x4a4331, position: [0, 1.12, 0.25], scale: [0.36, 0.46, 0.2] },
  // оружие в руках
  { geo: new THREE.BoxGeometry(1, 1, 1), color: 0x26282c, position: [0.12, 1.05, -0.4], scale: [0.09, 0.11, 0.72] },
  { geo: new THREE.BoxGeometry(1, 1, 1), color: 0x2f3236, position: [0.12, 0.98, -0.18], scale: [0.07, 0.16, 0.12] },
]);

const chuteGeo = mergeColored([
  { geo: new THREE.SphereGeometry(1, 10, 4, 0, Math.PI * 2, 0, Math.PI / 2.6), color: 0xdad4c4, position: [0, 0, 0], scale: [1.9, 1.1, 1.9] },
  { geo: new THREE.BoxGeometry(1, 1, 1), color: 0x8b8b80, position: [0, -0.9, 0], scale: [0.05, 1.8, 0.05] },
]);

const botMat = new THREE.MeshLambertMaterial({ vertexColors: true });
const chuteMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.92 });

let BOT_ID = 0;

export class Bot {
  constructor({ scene, world, loot, rng, pos, skill }) {
    this.id = ++BOT_ID;
    this.scene = scene;
    this.world = world;
    this.loot = loot;
    this.rng = rng;
    this.name = randomName(rng);
    this.pos = pos.clone();
    this.homeY = pos.y;
    this.yaw = rng() * Math.PI * 2;
    this.hp = 100;
    this.alive = true;
    this.state = 'falling';
    this.skill = skill;
    this.weapon = null;
    this.armorLevel = 0;
    this.armorHp = 0;
    this.heals = rndInt(rng, 0, 2);
    this.kills = 0;
    this.target = null;
    this.targetTimer = 0;
    this.stateTimer = 0;
    this.fireCd = 0;
    this.reloadTimer = 0;
    this.reaction = 0;
    this.burst = 0;
    this.strafeDir = 1;
    this.strafeTimer = 0;
    this.stuckCheck = 0;
    this.lastPos = this.pos.clone();
    this.chuteAlt = 95;
    this.hasChute = true;
    this.landing = world.randomLandPoint(rng, { x: pos.x, z: pos.z }, 90);
    this.lastSeenPlayer = -99;
    this.healing = 0;
    this.heading = this.yaw;
    this.deadTimer = 0;

    this.mesh = new THREE.Mesh(soldierGeo, botMat);
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.yaw;
    this.mesh.name = 'bot';
    this.parachute = new THREE.Mesh(chuteGeo, chuteMat);
    this.parachute.position.set(0, 2.6, 0);
    this.mesh.add(this.parachute);
    scene.add(this.mesh);

    // стартовый лут: часть ботов уже успела вооружиться
    if (chance(rng, 0.45)) {
      this.weapon = { def: pick(rng, [WEAPONS.m416, WEAPONS.akm, WEAPONS.ump, WEAPONS.scar]), ammo: 30 };
    }
    if (chance(rng, 0.3)) { this.armorLevel = rndInt(rng, 1, 2); this.armorHp = this.armorLevel * 30; }
  }

  get headPos() {
    return new THREE.Vector3(this.pos.x, this.pos.y + 1.6, this.pos.z);
  }

  land() {
    this.state = 'loot';
    this.stateTimer = 0;
    this.pos.y = this.world.surfaceY(this.pos.x, this.pos.z);
    if (this.parachute) {
      this.parachute.visible = false;
    }
  }

  /** Проверка попадания луча в бота. Возвращает {t, head} или null. */
  raycastHit(ox, oy, oz, dx, dy, dz, maxDist) {
    if (!this.alive) return null;
    const spheres = [
      [this.pos.y + 1.62, 0.27, true],   // голова
      [this.pos.y + 1.1, 0.42, false],   // корпус
      [this.pos.y + 0.55, 0.34, false],  // ноги
    ];
    let best = null;
    for (const [cy, r, head] of spheres) {
      const t = raySphere(ox, oy, oz, dx, dy, dz, this.pos.x, cy, this.pos.z, r);
      if (t > 0 && t < maxDist && (!best || t < best.t)) best = { t, head };
    }
    return best;
  }

  takeDamage(dmg, head, attacker, game) {
    if (!this.alive) return 0;
    let amount = dmg * (head ? 2.6 : 1);
    if (head) amount *= 0.9;
    let absorbed = 0;
    if (!head && this.armorHp > 0) {
      const a = [0, 0.3, 0.4, 0.55][this.armorLevel] || 0;
      absorbed = amount * a;
      this.armorHp -= absorbed;
      amount -= absorbed;
      if (this.armorHp <= 0) { this.armorLevel = 0; this.armorHp = 0; }
    }
    this.hp -= amount;
    if (attacker && attacker !== this) {
      // бот реагирует на того, кто стреляет
      if (attacker.isPlayer) {
        this.lastSeenPlayer = performance.now() / 1000;
        this.target = attacker;
        this.state = 'combat';
        this.reaction = rnd(this.rng, 0.4, 0.95) * (1.4 - this.skill * 0.5);
      }
    }
    if (this.hp <= 0) {
      this.die(attacker, game);
      return amount;
    }
    return amount;
  }

  die(attacker, game) {
    this.alive = false;
    this.state = 'dead';
    this.hp = 0;
    this.deadTimer = 2.5;
    if (this.parachute) this.parachute.visible = false;
    this.mesh.rotation.z = Math.PI / 2.2;
    this.mesh.position.y = this.world.surfaceY(this.pos.x, this.pos.z) + 0.25;
    game?.loot?.dropFromBot(this);
    if (attacker?.isPlayer) {
      // небольшой толчок, чтобы труп упал
      this.mesh.position.y += 0.1;
    }
    game?.onBotKilled?.(this, attacker);
  }

  update(dt, now, player, game) {
    if (!this.alive) {
      this.deadTimer -= dt;
      if (this.deadTimer < -14) {
        this.mesh.visible = false;
      }
      return;
    }

    const distToPlayer = player && !player.isDead
      ? Math.hypot(this.pos.x - player.pos.x, this.pos.z - player.pos.z)
      : Infinity;

    this.stateTimer += dt;
    this.fireCd -= dt;
    this.reaction -= dt;

    if (this.state === 'falling') {
      this.updateFalling(dt);
      return;
    }

    // регенерация оружия/патронов не нужна — только поведение
    if (this.reloadTimer > 0) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0 && this.weapon) {
        this.weapon.ammo = this.weapon.def.mag;
      }
    }

    // реакция на игрока: тяжёлую проверку видимости делаем не чаще 3 раз в секунду
    let canSee = false;
    if (distToPlayer < 145 && player && !player.isDead) {
      if (now - (this._losAt || -1) > 0.33) {
        this._losAt = now;
        this._los = this.world.hasLineOfSight(
          this.pos.x, this.pos.y + 1.55, this.pos.z,
          player.pos.x, player.pos.y + 1.4, player.pos.z,
        );
      }
      canSee = !!this._los;
    } else {
      this._los = false;
    }

    if (canSee) {
      if (this.state !== 'combat') {
        if (this.reaction <= 0) {
          this.state = 'combat';
          this.target = player;
          this.reaction = rnd(this.rng, 0.45, 1.05) * (1.5 - this.skill * 0.6);
          this.strafeTimer = rnd(this.rng, 0.6, 1.6);
        }
      } else {
        this.lastSeenPlayer = now;
      }
    }

    // приоритет: зона
    const outsideZone = game?.zone && !game.zone.isInside(this.pos.x, this.pos.z);
    if (outsideZone && this.state !== 'combat') {
      this.state = 'zone';
    }

    let moveTarget = null;
    let speed = 4.1;

    if (this.state === 'combat' && this.target && this.target.isPlayer) {
      const target = this.target;
      const dist = Math.hypot(target.pos.x - this.pos.x, target.pos.z - this.pos.z);
      if (dist > 5 && this.weapon) {
        this.aimAt(target.pos);
        this.tryShoot(dt, now, game, target);
        // держим дистанцию
        const ideal = 34;
        if (dist > ideal * 1.4) {
          moveTarget = { x: target.pos.x, z: target.pos.z, stop: ideal };
        } else if (dist < ideal * 0.5) {
          moveTarget = { x: this.pos.x + (this.pos.x - target.pos.x), z: this.pos.z + (this.pos.z - target.pos.z), stop: 0 };
        }
        // стрейф
        this.strafeTimer -= dt;
        if (this.strafeTimer <= 0) {
          this.strafeDir *= -1;
          this.strafeTimer = rnd(this.rng, 0.5, 1.7);
        }
        if (moveTarget) {
          const ang = Math.atan2(moveTarget.x - this.pos.x, moveTarget.z - this.pos.z) + Math.PI / 2;
          moveTarget.x += Math.sin(ang) * this.strafeDir * 4;
          moveTarget.z += Math.cos(ang) * this.strafeDir * 4;
        }
        speed = 3.4;
      } else if (!this.weapon) {
        // без оружия — ищем лут или убегаем
        this.state = 'loot';
        this.target = null;
      } else {
        this.tryShoot(dt, now, game, target);
        this.aimAt(target.pos);
      }
      if (!canSee && now - this.lastSeenPlayer > 5) {
        this.state = this.weapon ? 'hunt' : 'loot';
        this.target = null;
      }
      // лечение в бою при низком HP
      if (this.hp < 35 && this.heals > 0 && this.healing <= 0 && !canSee) {
        this.healing = 4;
      }
    } else if (this.state === 'heal' || this.healing > 0) {
      this.healing -= dt;
      if (this.healing <= 0) {
        this.hp = Math.min(100, this.hp + 45);
        this.heals--;
        this.state = this.weapon ? 'hunt' : 'loot';
      }
      speed = 0;
    } else if (this.state === 'zone' && game?.zone) {
      const c = game.zone.safeCenter;
      moveTarget = { x: c.x, z: c.z };
      speed = 6.0;
      if (!outsideZone) this.state = this.weapon ? 'hunt' : 'loot';
    } else if (this.state === 'loot' && this.loot) {
      const item = this.findLoot(now);
      if (item) {
        moveTarget = { x: item.x, z: item.z };
        const d = Math.hypot(item.x - this.pos.x, item.z - this.pos.z);
        if (d < 1.8) this.pickupLoot(item, game);
        speed = 4.6;
      } else {
        // лут кончился неподалёку — идём искать
        this.state = this.weapon ? 'hunt' : 'roam';
        this.targetTimer = 0;
      }
    } else if (this.state === 'hunt') {
      const nearPlayer = player && !player.isDead &&
        Math.hypot(player.pos.x - this.pos.x, player.pos.z - this.pos.z) < 320;
      if (nearPlayer && game?.zone?.isInside(this.pos.x, this.pos.z)) {
        // двигаемся в сторону игрока, но не прицельно — «патрулирование»
        if (!this.huntPoint || now - this.huntPointAt > 8) {
          const a = this.rng() * Math.PI * 2;
          const r = rnd(this.rng, 40, 160);
          this.huntPoint = {
            x: clamp(player.pos.x + Math.cos(a) * r, -640, 640),
            z: clamp(player.pos.z + Math.sin(a) * r, -640, 640),
          };
          this.huntPointAt = now;
        }
        moveTarget = this.huntPoint;
      } else {
        this.state = 'roam';
        this.targetTimer = 0;
      }
      speed = 4.8;
    } else {
      // roam
      this.targetTimer -= dt;
      if (!this.roamPoint || this.targetTimer <= 0) {
        const p = this.world.randomLandPoint(this.rng, { x: this.pos.x, z: this.pos.z }, 110);
        if (game?.zone && !game.zone.isInside(p.x, p.z)) {
          const c = game.zone.safeCenter;
          p.set(c.x + rnd(this.rng, -100, 100), 0, c.z + rnd(this.rng, -100, 100));
        }
        this.roamPoint = p;
        this.targetTimer = rnd(this.rng, 8, 20);
      }
      moveTarget = this.roamPoint;
      speed = 3.7;
    }

    if (this.healing > 0 && this.state !== 'heal') this.state = 'heal';

    // движение
    if (moveTarget && speed > 0) {
      const dx = moveTarget.x - this.pos.x;
      const dz = moveTarget.z - this.pos.z;
      const dist = Math.hypot(dx, dz);
      const stop = moveTarget.stop || 1.2;
      if (dist > stop) {
        const nx = dx / dist, nz = dz / dist;
        this.pos.x += nx * speed * dt;
        this.pos.z += nz * speed * dt;
        if (!(this.state === 'combat' && this.target)) {
          const desiredYaw = Math.atan2(nx, nz) + Math.PI;
          this.yaw += anglediff(this.yaw, desiredYaw) * Math.min(1, dt * 6);
        }
        this.walkPhase = (this.walkPhase || 0) + dt * speed * 2.2;
      }
    }

    // физика земли и стен
    this.pos.x = clamp(this.pos.x, -690, 690);
    this.pos.z = clamp(this.pos.z, -690, 690);
    this.world.resolveCollisions(this.pos, 0.4, 1.8);
    const gy = this.world.surfaceY(this.pos.x, this.pos.z);
    this.pos.y += (gy - this.pos.y) * Math.min(1, dt * 14);

    // застревание
    this.stuckCheck += dt;
    if (this.stuckCheck > 1.5) {
      const moved = Math.hypot(this.pos.x - this.lastPos.x, this.pos.z - this.lastPos.z);
      if (moved < 0.5 && moveTarget && Math.hypot(moveTarget.x - this.pos.x, moveTarget.z - this.pos.z) > 3) {
        this.roamPoint = null;
        this.huntPoint = null;
        this.targetTimer = 0;
        this.pos.x += rnd(this.rng, -1.5, 1.5);
        this.pos.z += rnd(this.rng, -1.5, 1.5);
      }
      this.lastPos.copy(this.pos);
      this.stuckCheck = 0;
    }

    // обновление модели
    if (this.state === 'combat' && this.target) {
      this.aimAt(this.target.pos);
    }
    this.mesh.position.set(this.pos.x, this.pos.y + (this.walkPhase ? Math.abs(Math.sin(this.walkPhase)) * 0.05 : 0), this.pos.z);
    this.mesh.rotation.y = this.yaw;
    this.mesh.rotation.x = this.healing > 0 ? -0.35 : 0;
  }

  updateFalling(dt) {
    const groundY = this.world.surfaceY(this.pos.x, this.pos.z);
    const alt = this.pos.y - groundY;
    if (alt < this.chuteAlt + 25 && this.hasChute) {
      this.hasChute = false;
    }
    const speed = alt > this.chuteAlt + 20 ? 26 : alt > 6 ? 8 : 12;
    // снос к точке приземления
    const dx = this.landing.x - this.pos.x, dz = this.landing.z - this.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const drift = Math.min(d, 8) * dt * (alt > this.chuteAlt ? 0.4 : 1.1);
    this.pos.x += (dx / d) * drift;
    this.pos.z += (dz / d) * drift;
    this.pos.y -= speed * dt;
    if (this.parachute) this.parachute.visible = alt < this.chuteAlt + 30;
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.yaw;
    this.mesh.rotation.x = 0.1;
    if (this.pos.y <= groundY + 0.1) {
      this.mesh.rotation.x = 0;
      this.land();
      this.mesh.position.copy(this.pos);
    }
  }

  aimAt(targetPos) {
    const dx = targetPos.x - this.pos.x;
    const dz = targetPos.z - this.pos.z;
    this.yaw = Math.atan2(dx, dz) + Math.PI;
  }

  tryShoot(dt, now, game, target) {
    if (!this.weapon) return;
    if (this.reloadTimer > 0) return;
    if (this.reaction > 0) return;
    if (this.fireCd > 0) return;
    if (this.healing > 0) return;
    const def = this.weapon.def;
    if (this.weapon.ammo <= 0) {
      this.reloadTimer = def.reload;
      this.weapon.ammo = 0;
      this.burst = 0;
      return;
    }
    const dist = Math.hypot(target.pos.x - this.pos.x, target.pos.z - this.pos.z);
    if (dist > def.range) return;
    if (!game?.botShoot) return;

    // новая очередь
    if (this.burst <= 0) {
      this.burst = def.auto ? rndInt(this.rng, 2, 5) : 1;
    }
    this.burst--;
    this.weapon.ammo--;
    this.fireCd = 60 / def.rpm;
    if (this.burst <= 0) {
      this.fireCd += rnd(this.rng, 0.5, 1.4); // пауза между очередями
    }

    // точность: дистанция, навык бота, движется ли цель
    const baseErr = (2.1 - this.skill * 1.1) * (1 + dist / 95);
    const targetSpeed = Math.hypot(target.vel?.x || 0, target.vel?.z || 0);
    const errDeg = baseErr * (1 + Math.min(1, targetSpeed / 8) * 0.45);
    const err = errDeg * DEG;
    const aim = new THREE.Vector3(target.pos.x, target.pos.y + 1.15, target.pos.z)
      .sub(new THREE.Vector3(this.pos.x, this.pos.y + 1.5, this.pos.z))
      .normalize();
    const right = new THREE.Vector3(-aim.z, 0, aim.x).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const a = this.rng() * Math.PI * 2;
    const mag = Math.sqrt(this.rng()) * Math.tan(err);
    aim.addScaledVector(right, Math.cos(a) * mag).addScaledVector(up, Math.sin(a) * mag).normalize();
    const origin = new THREE.Vector3(this.pos.x, this.pos.y + 1.5, this.pos.z);

    game.botShoot(this, origin, aim, def);
  }

  findLoot(now) {
    if (!this.loot) return null;
    if (this.stateTimer < 0.5) return null;
    let best = null, bestD = 110;
    for (const it of this.loot.items) {
      if (it.taken) continue;
      if (it.type === 'weapon' && this.weapon) continue;
      if (it.type === 'armor' && this.armorLevel >= it.key) continue;
      if (it.type === 'helmet') continue;
      const d = Math.hypot(it.x - this.pos.x, it.z - this.pos.z);
      if (d < bestD) { bestD = d; best = it; }
    }
    return best;
  }

  pickupLoot(item, game) {
    if (item.taken) return;
    if (item.type === 'weapon' && !this.weapon) {
      this.weapon = { def: WEAPONS[item.key], ammo: WEAPONS[item.key].mag };
    } else if (item.type === 'armor' && item.key > this.armorLevel) {
      this.armorLevel = item.key;
      this.armorHp = item.key * 32;
    } else if (item.type === 'heal') {
      this.heals = Math.min(3, this.heals + 1);
    }
    this.loot.remove(item);
    if (this.state === 'loot' && this.weapon && this.armorLevel > 0 && this.stateTimer > 12) {
      this.state = 'hunt';
    }
  }
}

export class BotManager {
  constructor({ scene, world, loot, rng, count = 34, onKill }) {
    this.scene = scene;
    this.world = world;
    this.loot = loot;
    this.rng = rng;
    this.bots = [];
    this.onKill = onKill;
    this._fightTimer = 12;
    this._initialCount = count;
    for (let i = 0; i < count; i++) {
      const p = world.randomLandPoint(rng, null, 560);
      p.y = 175 + rnd(rng, 0, 30);
      this.bots.push(new Bot({
        scene, world, loot, rng, pos: p,
        skill: rnd(rng, 0.15, 0.75),
      }));
    }
  }

  get aliveCount() { return this.bots.reduce((n, b) => n + (b.alive ? 1 : 0), 0); }
  get total() { return this.bots.length; }
  getAlive() { return this.bots.filter((b) => b.alive); }

  update(dt, now, player, game) {
    // поздняя игра: боты становятся злее
    const alive = this.aliveCount;
    const rage = alive < 12 ? 0.2 : 0;
    for (const b of this.bots) {
      if (!b.alive) { b.update(dt, now, player, game); continue; }
      if (rage) b.skill = Math.min(0.95, b.skill + rage * dt * 0.05);
      b.update(dt, now, player, game);
    }

    // Симуляция стычек между ботами вне зоны видимости игрока:
    // лобби тает, как в настоящей королевской битве.
    this._fightTimer -= dt;
    if (this._fightTimer <= 0 && alive > 3) {
      this._fightTimer = rnd(this.rng, 14, 30);
      const candidates = this.bots.filter((b) => b.alive && b.state !== 'falling');
      if (candidates.length >= 2 && player) {
        const far = candidates.filter((b) => Math.hypot(b.pos.x - player.pos.x, b.pos.z - player.pos.z) > 60);
        if (far.length >= 2) {
          const victim = pick(this.rng, far);
          const others = candidates.filter((b) => b !== victim);
          const killer = pick(this.rng, others);
          victim.hp = 0;
          victim.die(killer, {
            loot: this.loot,
            onBotKilled: this.onKill ? (v, k) => this.onKill(v, k, true) : null,
          });
          killer.kills++;
        }
      }
    }
  }

  raycast(ox, oy, oz, dx, dy, dz, maxDist) {
    let best = null;
    for (const b of this.bots) {
      const hit = b.raycastHit(ox, oy, oz, dx, dy, dz, maxDist);
      if (hit && (!best || hit.t < best.t)) best = { t: hit.t, head: hit.head, bot: b };
    }
    return best;
  }
}
