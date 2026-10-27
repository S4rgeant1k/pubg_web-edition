// Игрок: физика от первого лица, оружие, инвентарь, лечение, вид оружия.
// Камера — обычный THREE.PerspectiveCamera, оружие рисуется в отдельной сцене
// поверх кадра, чтобы ствол не проваливался в стены.

import * as THREE from '../vendor/three.module.js';
import {
  clamp, lerp, mergeColored, smoothstep, rnd,
} from './util.js';
import { WEAPONS, HEALS, lootLabel } from './items.js';

const GRAVITY = 21;
const EYE_HEIGHT = 1.62;
const STAND_HEIGHT = 1.8;
const CROUCH_HEIGHT = 1.15;
const PLAYER_RADIUS = 0.42;
const DEG = Math.PI / 180;

function viewModelGeometry(def) {
  const parts = [];
  const isSniper = def.cls === 'sniper';
  const isPistol = def.cls === 'pistol';
  const isShotgun = def.cls === 'shotgun';
  const metal = 0x3a3e44, dark = 0x1f2226, wood = 0x6a4a2d, polymer = 0x2c3035;
  const bodyColor = isSniper ? wood : isShotgun ? 0x5a3a22 : metal;
  const box = () => new THREE.BoxGeometry(1, 1, 1);
  const cyl = () => new THREE.CylinderGeometry(1, 1, 1, 8);

  // ствольная коробка — тонкая и вытянутая, чтобы силуэт читался как автомат
  parts.push({ geo: box(), color: bodyColor, position: [0, 0, -0.1], scale: [0.055, 0.075, isPistol ? 0.2 : 0.42] });
  // цевьё
  if (!isPistol) parts.push({ geo: box(), color: polymer, position: [0, -0.005, -0.36], scale: [0.05, 0.055, 0.24] });
  // ствол
  const barrelLen = isSniper ? 0.5 : isPistol ? 0.12 : 0.3;
  parts.push({
    geo: cyl(), color: dark,
    position: [0, 0.012, -0.44 - barrelLen / 2],
    rotation: [Math.PI / 2, 0, 0],
    scale: [0.014, barrelLen, 0.014],
  });
  // магазин
  if (!isShotgun) parts.push({ geo: box(), color: dark, position: [0, -0.085, -0.14], scale: [0.035, 0.14, 0.1] });
  // приклад
  if (!isPistol) parts.push({ geo: box(), color: isSniper ? wood : 0x2b2f34, position: [0, -0.004, 0.17], scale: [0.045, 0.07, isSniper ? 0.36 : 0.2] });
  // рукоять
  parts.push({ geo: box(), color: dark, position: [0, -0.08, 0.03], scale: [0.035, 0.12, 0.05] });
  // прицельные приспособления
  if (isSniper) {
    parts.push({ geo: cyl(), color: 0x15171a, position: [0, 0.085, -0.16], rotation: [Math.PI / 2, 0, 0], scale: [0.026, 0.26, 0.026] });
    parts.push({ geo: box(), color: 0x15171a, position: [0, 0.05, -0.16], scale: [0.03, 0.06, 0.1] });
  } else {
    parts.push({ geo: box(), color: 0x15171a, position: [0, 0.06, -0.3], scale: [0.016, 0.035, 0.04] });
    parts.push({ geo: box(), color: 0x15171a, position: [0, 0.055, 0.02], scale: [0.02, 0.03, 0.03] });
  }
  // руки
  parts.push({ geo: box(), color: 0xb98a63, position: [0.02, -0.085, 0.08], rotation: [0, 0, 0.28], scale: [0.07, 0.09, 0.17] });
  parts.push({ geo: box(), color: 0xa87c58, position: [-0.015, -0.055, -0.34], rotation: [0, 0, -0.3], scale: [0.06, 0.07, 0.14] });

  return mergeColored(parts);
}

const viewGeoCache = new Map();

export class Player {
  constructor({ camera, world, input, audio, scene }) {
    this.camera = camera;
    this.world = world;
    this.input = input;
    this.audio = audio;
    this.scene = scene;

    this.isPlayer = true;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.height = STAND_HEIGHT;
    this.targetHeight = STAND_HEIGHT;
    this.crouching = false;
    this.grounded = true;
    this.isDead = false;
    this.kills = 0;
    this.damageDealt = 0;

    this.reset(new THREE.Vector3(0, 40, 0));

    // сцена и камера для оружия
    this.viewScene = new THREE.Scene();
    this.viewCamera = new THREE.PerspectiveCamera(55, 1, 0.01, 10);
    this.viewScene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 1.3);
    key.position.set(-0.5, 1, 0.5);
    this.viewScene.add(key);
    this.viewGroup = new THREE.Group();
    this.viewScene.add(this.viewGroup);
    this.viewMesh = null;
    this.viewWeaponId = null;

    this.muzzleFlash = new THREE.Mesh(
      new THREE.PlaneGeometry(0.3, 0.3),
      new THREE.MeshBasicMaterial({ color: 0xffe2a0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.muzzleFlash.position.set(0, 0.01, -0.42);
    this.viewGroup.add(this.muzzleFlash);
    this.muzzleLight = new THREE.PointLight(0xffc070, 0, 14);
    this.scene.add(this.muzzleLight);

    this._viewKick = 0;
    this._viewSway = new THREE.Vector2();
    this._bobT = 0;
  }

  reset(pos) {
    this.pos.copy(pos);
    this.vel.set(0, 0, 0);
    this.hp = 100;
    this.maxHp = 100;
    this.armorLevel = 0;
    this.armorHp = 0;
    this.helmetLevel = 0;
    this.helmetHp = 0;
    this.slots = [null, null];
    this.slotIndex = 0;
    this.ammo = { '556': 0, '762': 0, '45': 0, '9mm': 0, '12g': 0 };
    this.heals = { bandage: 0, firstaid: 0, medkit: 0 };
    this.isDead = false;
    this.reloading = 0;
    this.healTimer = 0;
    this.healType = null;
    this.stamina = 100;
    this.firing = false;
    this.ads = 0;
    this.bloom = 0;
    this.lastDamageTime = -10;
    this.lastShotTime = -10;
    this._fireCooldown = 0;
    this.kills = 0;
    this.damageDealt = 0;
    this.deathAt = 0;
    this.crouching = false;
    this.targetHeight = STAND_HEIGHT;
  }

  // ---------- инвентарь ----------

  get weaponSlot() { return this.slots[this.slotIndex]; }
  get weaponDef() { return this.slots[this.slotIndex] ? WEAPONS[this.slots[this.slotIndex].id] : null; }
  get magAmmo() { return this.slots[this.slotIndex] ? this.slots[this.slotIndex].ammo : 0; }

  get reserveAmmo() {
    const d = this.weaponDef;
    return d ? this.ammo[d.ammo] : 0;
  }

  healCount() { return this.heals.bandage + this.heals.firstaid + this.heals.medkit; }

  pickup(item, loot) {
    let msg = '';
    if (item.type === 'weapon') {
      const defId = item.key;
      const emptySlot = this.slots.findIndex((s) => s === null);
      if (emptySlot >= 0) {
        this.slots[emptySlot] = { id: defId, ammo: WEAPONS[defId].mag };
        if (!this.weaponSlot) this.slotIndex = emptySlot;
        msg = `Подобрано: ${WEAPONS[defId].name}`;
      } else {
        const old = this.slots[this.slotIndex];
        loot.dropWeapon(this.pos.x, this.world.surfaceY(this.pos.x, this.pos.z), this.pos.z, old.id);
        this.slots[this.slotIndex] = { id: defId, ammo: WEAPONS[defId].mag };
        msg = `${WEAPONS[old.id].name} → ${WEAPONS[defId].name}`;
      }
      this.reloading = 0;
      this.healTimer = 0;
      this._syncViewModel();
    } else if (item.type === 'ammo') {
      this.ammo[item.key] += item.ammo;
      msg = `+${item.ammo} ${lootLabel('ammo', item.key)}`;
    } else if (item.type === 'heal') {
      const cap = item.key === 'bandage' ? 6 : item.key === 'firstaid' ? 4 : 2;
      if (this.heals[item.key] >= cap) return { ok: false, msg: 'Уже полный набор' };
      this.heals[item.key]++;
      msg = `+1 ${HEALS[item.key].name}`;
    } else if (item.type === 'armor') {
      if (this.armorLevel >= item.key && this.armorHp > 40) return { ok: false, msg: 'Броня не лучше текущей' };
      this.armorLevel = item.key;
      this.armorHp = item.key === 1 ? 50 : item.key === 2 ? 75 : 100;
      msg = `Надет ${lootLabel('armor', item.key)}`;
    } else if (item.type === 'helmet') {
      if (this.helmetLevel >= item.key && this.helmetHp > 40) return { ok: false, msg: 'Каска не лучше текущей' };
      this.helmetLevel = item.key;
      this.helmetHp = item.key === 1 ? 40 : item.key === 2 ? 70 : 100;
      msg = `Надета ${lootLabel('helmet', item.key)}`;
    }
    loot.remove(item);
    return { ok: true, msg };
  }

  switchSlot(i) {
    if (i === this.slotIndex || !this.slots[i]) return;
    this.slotIndex = i;
    this._semiLatch = false;
    this.reloading = 0;
    this.healTimer = 0;
    this._syncViewModel();
    this.audio?.play('switch');
  }

  startReload() {
    const def = this.weaponDef;
    if (!def || this.reloading > 0) return;
    if (this.magAmmo >= def.mag) return;
    if (this.reserveAmmo <= 0) return;
    this.reloading = def.reload;
    this.healTimer = 0;
    this.audio?.play('reload', { dur: def.reload });
  }

  useHeal() {
    if (this.healTimer > 0) return;
    if (this.hp >= this.maxHp && this.healType) return;
    const order = ['medkit', 'firstaid', 'bandage'];
    for (const k of order) {
      if (this.heals[k] > 0 && this.hp < HEALS[k].maxCap) {
        this.healType = k;
        this.healTimer = HEALS[k].time;
        this.healTotal = HEALS[k].time;
        this.reloading = 0;
        this.audio?.play('heal');
        return;
      }
    }
  }

  // ---------- урон ----------

  damage(amount, { head = false, attacker = null } = {}) {
    if (this.isDead) return;
    let dmg = amount;
    if (head && this.helmetHp > 0) {
      const absorb = [0, 0.3, 0.4, 0.5][this.helmetLevel] || 0;
      const absorbed = dmg * absorb;
      this.helmetHp = Math.max(0, this.helmetHp - absorbed * 0.9);
      dmg -= absorbed;
      if (this.helmetHp <= 0) this.helmetLevel = 0;
    } else if (!head && this.armorHp > 0) {
      const absorb = [0, 0.3, 0.4, 0.55][this.armorLevel] || 0;
      const absorbed = dmg * absorb;
      this.armorHp = Math.max(0, this.armorHp - absorbed);
      dmg -= absorbed;
      if (this.armorHp <= 0) this.armorLevel = 0;
    }
    if (!head && this.helmetHp > 0 && Math.random() < 0.15) {
      const absorbed = dmg * 0.15;
      this.helmetHp = Math.max(0, this.helmetHp - absorbed);
      dmg -= absorbed;
    }
    this.hp -= dmg;
    this.lastDamageTime = performance.now() / 1000;
    this.healTimer = 0;
    if (this.hp <= 0) {
      this.hp = 0;
      this.isDead = true;
      this.deathAt = performance.now() / 1000;
      this.killer = attacker;
    }
    return dmg;
  }

  // ---------- обновление ----------

  update(dt, now, game) {
    const input = this.input;
    const w = this.world;

    if (this.isDead) { this._updateView(0, now); return; }

    // высота приседания
    this.crouching = input.down('crouch') && this.grounded;
    this.targetHeight = this.crouching ? CROUCH_HEIGHT : STAND_HEIGHT;
    this.height = lerp(this.height, this.targetHeight, clamp(dt * 12, 0, 1));

    const adsHeld = input.down('aim') && !!this.weaponDef && this.reloading <= 0;
    const sprinting = input.down('sprint') && !adsHeld && !this.crouching && this.stamina > 2 && this.healTimer <= 0;
    this.sprinting = sprinting;

    // скорость
    let speed = 5.3;
    if (this.crouching) speed = 2.6;
    if (sprinting) speed = 7.6;
    if (this.ads > 0.5) speed *= 0.62;
    if (this.healTimer > 0) speed *= 0.55;
    if (this.reloading > 0) speed *= 0.9;

    if (sprinting) this.stamina = Math.max(0, this.stamina - dt * 13);
    else this.stamina = Math.min(100, this.stamina + dt * 11);

    const mv = input.move;
    const wishX = mv.x, wishZ = mv.z;
    const len = Math.hypot(wishX, wishZ);
    const yaw = input.yaw;
    const dirX = -Math.sin(yaw) * wishZ + Math.cos(yaw) * wishX;
    const dirZ = -Math.cos(yaw) * wishZ - Math.sin(yaw) * wishX;
    const norm = len > 1 ? 1 / len : 1;

    const accel = this.grounded ? 14 : 3;
    const targetVX = dirX * norm * speed;
    const targetVZ = dirZ * norm * speed;
    this.vel.x = lerp(this.vel.x, targetVX, clamp(dt * accel, 0, 1));
    this.vel.z = lerp(this.vel.z, targetVZ, clamp(dt * accel, 0, 1));

    // прыжок
    if (input.pressed('jump') && this.grounded && this.height > STAND_HEIGHT - 0.2) {
      this.vel.y = 6.4;
      this.grounded = false;
      this.audio?.play('jump');
      this.stamina = Math.max(0, this.stamina - 12);
    }
    this.vel.y -= GRAVITY * dt;

    // интеграция
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y += this.vel.y * dt;

    // границы карты
    this.pos.x = clamp(this.pos.x, -690, 690);
    this.pos.z = clamp(this.pos.z, -690, 690);

    // столкновения со стенами/деревьями
    w.resolveCollisions(this.pos, PLAYER_RADIUS, this.height);

    // земля
    const ground = w.surfaceY(this.pos.x, this.pos.z);
    if (this.pos.y <= ground) {
      if (!this.grounded && this.vel.y < -12) {
        const fallDmg = (-this.vel.y - 12) * 5.5;
        if (fallDmg > 0) {
          this.damage(Math.min(fallDmg, 100), {});
          game?.onFell?.(fallDmg);
        }
        this.audio?.play('land');
      }
      this.pos.y = ground;
      this.vel.y = 0;
      this.grounded = true;
    } else if (this.pos.y > ground + 0.05) {
      this.grounded = false;
    }

    // шаги
    this._stepTimer = (this._stepTimer || 0) + dt * Math.hypot(this.vel.x, this.vel.z);
    if (this.grounded && Math.hypot(this.vel.x, this.vel.z) > 1.2 && this._stepTimer > 2.4) {
      this._stepTimer = 0;
      this.audio?.play(sprinting ? 'stepFast' : 'step');
    }

    // таймеры
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        const def = this.weaponDef;
        if (def) {
          const need = def.mag - this.magAmmo;
          const take = Math.min(need, this.reserveAmmo);
          this.slots[this.slotIndex].ammo += take;
          this.ammo[def.ammo] -= take;
        }
        this.reloading = 0;
      }
    }

    if (this.healTimer > 0) {
      this.healTimer -= dt;
      if (this.healTimer <= 0 && this.healType) {
        const h = HEALS[this.healType];
        if (this.heals[this.healType] > 0) {
          this.heals[this.healType]--;
          this.hp = Math.min(Math.max(h.maxCap, this.hp), this.hp + h.amount);
          this.hp = Math.min(this.maxHp, this.hp);
          this.audio?.play('healed');
          game?.toast?.(`${h.name}: +${h.amount} HP`);
        }
        this.healTimer = 0;
        this.healType = null;
      }
    }

    // ADS
    const wantAds = adsHeld ? 1 : 0;
    this.ads = lerp(this.ads, wantAds, clamp(dt * 12, 0, 1));

    // стрельба
    this._fireCooldown -= dt;
    this.firing = false;
    const def = this.weaponDef;
    const wantsFire = input.down('fire');
    if (wantsFire && def && this._fireCooldown <= 0 && this.reloading <= 0 && this.healTimer <= 0) {
      if (def.auto || !this._semiLatch) {
        this.fire(now, game);
        this._semiLatch = true;
      }
    }
    if (!wantsFire) this._semiLatch = false;

    // разброс восстанавливается
    this.bloom = Math.max(0, this.bloom - dt * 5.5);

    // перезарядка / лечение
    if (input.pressed('reload')) this.startReload();
    if (input.pressed('heal')) this.useHeal();
    if (input.pressed('slot1')) this.switchSlot(0);
    if (input.pressed('slot2')) this.switchSlot(1);

    this._updateView(dt, now);
  }

  fire(now, game) {
    const def = this.weaponDef;
    if (!def) return;
    if (this.magAmmo <= 0) {
      if (this.reserveAmmo > 0) this.startReload();
      else { this.audio?.play('empty'); this._fireCooldown = 0.35; }
      return;
    }
    this._fireCooldown = 60 / def.rpm;
    this.slots[this.slotIndex].ammo--;
    this.firing = true;
    this.lastShotTime = now;

    const cam = this.camera;
    const origin = new THREE.Vector3();
    cam.getWorldPosition(origin);

    // разброс
    let spread = this.ads > 0.5 ? def.spreadAds : def.spreadHip;
    const moving = Math.hypot(this.vel.x, this.vel.z) > 1.5;
    if (moving) spread *= 1.55;
    if (this.crouching) spread *= 0.75;
    if (!this.grounded) spread *= 2.0;
    spread += this.bloom;
    const pellets = def.pellets || 1;
    let anyHit = false;

    for (let i = 0; i < pellets; i++) {
      const spreadRad = (spread + (pellets > 1 ? 1.6 : 0)) * DEG;
      const dir = new THREE.Vector3();
      cam.getWorldDirection(dir);
      // случайное отклонение в конусе
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * Math.tan(spreadRad);
      const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
      const up = new THREE.Vector3().crossVectors(right, dir).normalize();
      dir.addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
      const res = game.traceShot(origin, dir, def.range, this);
      if (res.hit) anyHit = true;
    }

    // отдача
    const recoilScale = (this.ads ? 0.72 : 1) * (this.crouching ? 0.85 : 1);
    const kick = (def.recoil * 0.85 + (this.ads ? 0.25 : 0.55)) * recoilScale;
    this.input.addRecoil(kick * DEG, (Math.random() - 0.5) * 0.55 * DEG * def.recoil);
    this.bloom = Math.min(6, this.bloom + def.recoil * 0.75);
    this._viewKick = Math.min(1.1, this._viewKick + 0.4 + def.recoil * 0.18);

    this.muzzleFlash.material.opacity = 0.9;
    this.muzzleFlash.rotation.z = Math.random() * Math.PI;
    this.muzzleFlash.scale.setScalar(0.8 + Math.random() * 0.6);
    this.muzzleLight.position.copy(origin);
    this.muzzleLight.intensity = 3.2;
    this.audio?.play(def.cls === 'sniper' ? 'sniper' : def.cls === 'shotgun' ? 'shotgun' : def.cls === 'pistol' ? 'pistol' : 'rifle');
    if (anyHit) game.onHitMark?.();
  }

  /** Угол обзора с учётом прицеливания (для скопа). */
  targetFov(baseFov) {
    const def = this.weaponDef;
    if (!def) return baseFov;
    return lerp(baseFov, def.adsFov, this.ads);
  }

  isScoped() {
    const def = this.weaponDef;
    return !!(def && def.scope && this.ads > 0.75);
  }

  _syncViewModel() {
    const def = this.weaponDef;
    const id = def ? def.id : 'none';
    if (id === this.viewWeaponId) return;
    this.viewWeaponId = id;
    if (this.viewMesh) {
      this.viewGroup.remove(this.viewMesh);
      this.viewMesh = null;
    }
    if (!def) return;
    if (!viewGeoCache.has(id)) viewGeoCache.set(id, viewModelGeometry(def));
    const mesh = new THREE.Mesh(
      viewGeoCache.get(id),
      new THREE.MeshLambertMaterial({ vertexColors: true }),
    );
    mesh.scale.setScalar(0.62);
    mesh.name = 'viewWeapon';
    this.viewMesh = mesh;
    this.viewGroup.add(mesh);
  }

  _updateView(dt, now) {
    this._syncViewModel();
    const cam = this.camera;

    // покачивание камеры
    const speed = Math.hypot(this.vel.x, this.vel.z);
    const moving = speed > 0.6 && this.grounded;
    this._bobT += dt * (moving ? speed * 1.5 : 0);
    const bobAmp = moving ? (this.sprinting ? 0.055 : 0.032) : 0;
    const bobX = Math.cos(this._bobT) * bobAmp * 0.7;
    const bobY = Math.abs(Math.sin(this._bobT)) * bobAmp;

    const eyeY = this.pos.y + this.height - 0.18;
    cam.position.set(this.pos.x + bobX * 0.4, eyeY + bobY, this.pos.z);
    cam.rotation.order = 'YXZ';
    cam.rotation.set(this.input.pitch, this.input.yaw, Math.sin(this._bobT * 0.5) * 0.004 + (this.crouching ? 0.02 : 0));

    // модель оружия
    if (this.viewMesh) {
      const adsEase = smoothstep(0, 1, this.ads);
      const baseX = lerp(0.155, 0.012, adsEase);
      const baseY = lerp(-0.15, -0.085, adsEase);
      const baseZ = lerp(-0.44, -0.46, adsEase);
      let swayX = 0, swayY = 0;
      if (moving) {
        swayX = Math.cos(this._bobT) * (this.sprinting ? 0.05 : 0.022);
        swayY = Math.abs(Math.sin(this._bobT)) * (this.sprinting ? 0.04 : 0.018);
      }
      if (this.sprinting) {
        this.viewGroup.rotation.set(-0.35, -0.6, 0.25);
      } else {
        this.viewGroup.rotation.set(0, 0, 0);
      }
      this._viewKick = Math.max(0, this._viewKick - dt * 5);
      const kickZ = this._viewKick * 0.09;
      const kickRot = this._viewKick * 0.2;
      this.viewGroup.position.set(baseX + swayX, baseY + swayY, baseZ + kickZ);
      this.viewGroup.rotation.x += kickRot;
      // перезарядка: опускаем оружие и покачиваем
      if (this.reloading > 0) {
        const t = 1 - Math.abs(this.reloading / (this.weaponDef?.reload || 1) - 0.5) * 2;
        this.viewGroup.position.y -= t * 0.14;
        this.viewGroup.rotation.z += t * 0.5;
        this.viewGroup.rotation.x -= t * 0.3;
      }
      if (this.healTimer > 0) {
        this.viewGroup.position.y -= 0.3;
        this.viewGroup.rotation.z += 0.7;
      }
      this.muzzleFlash.material.opacity = Math.max(0, this.muzzleFlash.material.opacity - dt * 12);
      this.muzzleLight.intensity = Math.max(0, this.muzzleLight.intensity - dt * 40);
    }
  }

  resize(aspect) {
    this.viewCamera.aspect = aspect;
    this.viewCamera.updateProjectionMatrix();
  }
}
