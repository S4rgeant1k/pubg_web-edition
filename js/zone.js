// Синяя зона: кольца, фазы сжатия, урон вне безопасной зоны.
// Визуал — полупрозрачная стена-цилиндр и кольцо на земле.

import * as THREE from '../vendor/three.module.js';
import { rnd } from './util.js';

const PHASES = [
  // { wait: пауза перед сжатием, shrink: время сжатия, radius, dps }
  { wait: 60, shrink: 60, radius: 780, dps: 1 },
  { wait: 55, shrink: 50, radius: 520, dps: 2 },
  { wait: 45, shrink: 45, radius: 330, dps: 4 },
  { wait: 40, shrink: 40, radius: 190, dps: 6 },
  { wait: 35, shrink: 35, radius: 95, dps: 9 },
  { wait: 30, shrink: 30, radius: 42, dps: 12 },
  { wait: 25, shrink: 25, radius: 12, dps: 18 },
];

export class Zone {
  constructor(scene, rng) {
    this.scene = scene;
    this.rng = rng;
    this.phase = 0;
    this.state = 'wait';
    this.timer = PHASES[0].wait;
    this.center = new THREE.Vector2(0, 0);
    this.radius = 900;
    this.targetCenter = new THREE.Vector2(0, 0);
    this.targetRadius = PHASES[0].radius;
    this.startCenter = this.center.clone();
    this.startRadius = this.radius;
    this.dps = 0;
    this.damageAcc = 0;
    this.finished = false;

    const wallGeo = new THREE.CylinderGeometry(1, 1, 1, 96, 1, true);
    wallGeo.translate(0, 0.5, 0);
    this.wallMat = new THREE.MeshBasicMaterial({
      color: 0x3f8fff, transparent: true, opacity: 0.22,
      side: THREE.DoubleSide, depthWrite: false,
    });
    this.wall = new THREE.Mesh(wallGeo, this.wallMat);
    this.wall.name = 'zoneWall';
    scene.add(this.wall);

    const ringGeo = new THREE.RingGeometry(0.985, 1, 128);
    ringGeo.rotateX(-Math.PI / 2);
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0x64aaff, transparent: true, opacity: 0.65, side: THREE.DoubleSide, depthWrite: false });
    this.ring = new THREE.Mesh(ringGeo, this.ringMat);
    this.ring.name = 'zoneRing';
    scene.add(this.ring);

    // кольцо следующей безопасной зоны
    const nextGeo = new THREE.RingGeometry(0.99, 1, 128);
    nextGeo.rotateX(-Math.PI / 2);
    this.nextRing = new THREE.Mesh(nextGeo, new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false,
    }));
    scene.add(this.nextRing);

    this.safeCenter = new THREE.Vector3(0, 0, 0);
    this._applyPhysics(900, 0, 0);
  }

  reset() {
    this.phase = 0;
    this.state = 'wait';
    this.timer = PHASES[0].wait;
    this.center.set(rnd(this.rng, -250, 250), rnd(this.rng, -250, 250));
    this.radius = 900;
    this.startRadius = 900;
    this.startCenter.copy(this.center);
    this.targetRadius = PHASES[0].radius;
    this._pickNextCenter();
    this.dps = 0;
    this.finished = false;
    this.damageAcc = 0;
    this._applyPhysics(this.radius, this.center.x, this.center.y);
  }

  _pickNextCenter() {
    const maxOffset = Math.max(0, this.radius - this.targetRadius);
    const a = this.rng() * Math.PI * 2;
    const r = Math.sqrt(this.rng()) * maxOffset * 0.72;
    this.targetCenter.set(
      this.center.x + Math.cos(a) * r,
      this.center.y + Math.sin(a) * r,
    );
  }

  isInside(x, z) {
    return Math.hypot(x - this.center.x, z - this.center.y) <= this.radius;
  }

  /** 0..1 прогресс текущей фазы (для предупреждений). */
  get phaseProgress() {
    const p = PHASES[Math.min(this.phase, PHASES.length - 1)];
    return 1 - this.timer / (this.state === 'wait' ? p.wait : p.shrink);
  }

  update(dt, player, game) {
    if (this.finished) return;
    const p = PHASES[this.phase];
    this.timer -= dt;

    if (this.state === 'wait') {
      this.dps = 0;
      if (this.timer <= 0) {
        this.state = 'shrink';
        this.timer = p.shrink;
        this.startCenter.copy(this.center);
        this.startRadius = this.radius;
        this.targetRadius = p.radius;
        this._pickNextCenter();
        game?.onZoneShrink?.(this);
      }
    } else {
      this.dps = p.dps;
      const t = 1 - Math.max(0, this.timer) / p.shrink;
      const e = t * t * (3 - 2 * t);
      this.radius = this.startRadius + (this.targetRadius - this.startRadius) * e;
      this.center.set(
        this.startCenter.x + (this.targetCenter.x - this.startCenter.x) * e,
        this.startCenter.y + (this.targetCenter.y - this.startCenter.y) * e,
      );
      if (this.timer <= 0) {
        this.radius = this.targetRadius;
        this.center.copy(this.targetCenter);
        this.phase++;
        if (this.phase >= PHASES.length) {
          this.finished = true;
          this.dps = 25;
          this.radius = Math.max(8, this.radius);
        } else {
          this.state = 'wait';
          this.timer = PHASES[this.phase].wait;
          this._pickNextCenter();
        }
      }
    }

    this._applyPhysics(this.radius, this.center.x, this.center.y);

    // урон
    if (player && !player.isDead) {
      const outside = !this.isInside(player.pos.x, player.pos.z);
      const dmgRate = outside ? this.dps : 0;
      if (dmgRate > 0) {
        this.damageAcc += dmgRate * dt;
        if (this.damageAcc >= 1) {
          const dmg = Math.floor(this.damageAcc);
          this.damageAcc -= dmg;
          player.damage(dmg, { attacker: null });
          game?.onZoneDamage?.(dmg);
        }
      } else {
        this.damageAcc = 0;
      }
      this.wallMat.opacity = outside ? 0.34 : 0.2;
    }
  }

  _applyPhysics(radius, cx, cz) {
    const h = 140;
    this.wall.scale.set(radius, h, radius);
    this.wall.position.set(cx, -2, cz);
    this.ring.scale.setScalar(radius);
    this.ring.position.set(cx, 0.9, cz);
    // круг, куда бежать на следующей фазе
    const next = PHASES[Math.min(this.phase + (this.state === 'shrink' ? 1 : 0), PHASES.length - 1)];
    const showNext = this.state === 'shrink' || this.phase > 0;
    this.nextRing.visible = showNext;
    if (showNext) {
      const nr = this.state === 'shrink' ? this.targetRadius : next.radius;
      const nc = this.state === 'shrink' ? this.targetCenter : this.targetCenter;
      this.nextRing.scale.setScalar(nr);
      this.nextRing.position.set(nc.x, 1.0, nc.y);
    }
    this.safeCenter.set(cx, 0, cz);
  }

  get timeLeft() { return Math.max(0, this.timer); }
  get stateLabel() {
    if (this.finished) return 'Финальная зона';
    return this.state === 'wait' ? 'Зона сожмётся через' : 'Зона сжимается';
  }
}

export const ZONE_PHASES = PHASES;
