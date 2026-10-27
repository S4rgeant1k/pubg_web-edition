// Игровой цикл и правила королевской битвы:
// самолёт → десант → лут → синяя зона → аирдропы → последний выживший.

import * as THREE from '../vendor/three.module.js';
import { World, MAP_HALF } from './world.js';
import { LootManager, WEAPONS } from './items.js';
import { Player } from './player.js';
import { BotManager } from './bots.js';
import { Zone } from './zone.js';
import { Input } from './input.js';
import { GameAudio } from './audio.js';
import { HUD } from './hud.js';
import { mergeColored, mulberry32, rnd, clamp, lerp, pick } from './util.js';

const START_ALT = 235;
const PLANE_SPEED = 78;

class Effects {
  constructor(scene) {
    this.scene = scene;
    this.tracers = [];
    this.impacts = [];
    this.poolTracer = [];
    this.poolImpact = [];
    this.impactGeo = new THREE.SphereGeometry(1, 5, 4);
  }

  tracer(a, b, color) {
    let line = this.poolTracer.pop();
    if (!line) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 });
      line = new THREE.Line(geo, mat);
      line.frustumCulled = false;
      this.scene.add(line);
    }
    const pos = line.geometry.attributes.position;
    pos.setXYZ(0, a.x, a.y, a.z);
    pos.setXYZ(1, b.x, b.y, b.z);
    pos.needsUpdate = true;
    line.material.color.setHex(color);
    line.material.opacity = 0.9;
    line.visible = true;
    this.tracers.push({ obj: line, life: 0.075, max: 0.075 });
  }

  impact(pos, kind = 'dust') {
    let m = this.poolImpact.pop();
    if (!m) {
      m = new THREE.Mesh(this.impactGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true }));
      this.scene.add(m);
    }
    m.material.color.setHex(kind === 'blood' ? 0x9e1f2a : kind === 'metal' ? 0xffd08a : 0xb9a888);
    m.position.copy(pos);
    m.scale.setScalar(kind === 'blood' ? 0.18 : 0.1);
    m.visible = true;
    m.material.opacity = 0.9;
    this.impacts.push({ obj: m, life: 0.35, max: 0.35, growth: kind === 'blood' ? 1.6 : 1.1 });
  }

  update(dt) {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      t.obj.material.opacity = Math.max(0, t.life / t.max) * 0.9;
      if (t.life <= 0) {
        t.obj.visible = false;
        this.poolTracer.push(t.obj);
        this.tracers.splice(i, 1);
      }
    }
    for (let i = this.impacts.length - 1; i >= 0; i--) {
      const t = this.impacts[i];
      t.life -= dt;
      const k = 1 - t.life / t.max;
      t.obj.material.opacity = Math.max(0, t.life / t.max);
      t.obj.scale.setScalar(0.1 + k * 0.55 * t.growth);
      if (t.life <= 0) {
        t.obj.visible = false;
        this.poolImpact.push(t.obj);
        this.impacts.splice(i, 1);
      }
    }
  }
}

function planeGeometry() {
  const parts = [
    { geo: new THREE.CylinderGeometry(1.4, 1.1, 18, 8), color: 0xb8bdc4, position: [0, 0, 0], rotation: [Math.PI / 2, 0, 0], scale: [1, 1, 1] },
    { geo: new THREE.ConeGeometry(1.35, 5, 8), color: 0xc8ccd2, position: [0, 0, -11.4], rotation: [-Math.PI / 2, 0, 0], scale: [1, 1, 1] },
    { geo: new THREE.BoxGeometry(34, 0.7, 4.4), color: 0xd0d4d9, position: [0, 0.4, -1.5] },
    { geo: new THREE.BoxGeometry(12, 0.6, 3), color: 0xd0d4d9, position: [0, 0.6, 8.6] },
    { geo: new THREE.BoxGeometry(0.6, 5.2, 3.4), color: 0xc0c4ca, position: [0, 2.6, 8.8] },
    { geo: new THREE.BoxGeometry(0.4, 4.5, 3.2), color: 0xbfc3c9, position: [0, 2.2, 10.4] },
    { geo: new THREE.CylinderGeometry(0.62, 0.62, 1.6, 8), color: 0x4a4e54, position: [-5, -0.8, -2], rotation: [Math.PI / 2, 0, 0] },
    { geo: new THREE.CylinderGeometry(0.62, 0.62, 1.6, 8), color: 0x4a4e54, position: [5, -0.8, -2], rotation: [Math.PI / 2, 0, 0] },
    { geo: new THREE.BoxGeometry(0.5, 0.5, 0.5), color: 0xff7a5a, position: [17.2, 0.6, -1.5] },
    { geo: new THREE.BoxGeometry(0.5, 0.5, 0.5), color: 0x5affa0, position: [-17.2, 0.6, -1.5] },
  ];
  return mergeColored(parts);
}

export class Game {
  constructor(canvas, settings = {}) {
    this.canvas = canvas;
    this.settings = {
      sensitivity: 1, volume: 0.65, quality: 'medium', fov: 78, damageNumbers: true,
      ...settings,
    };
    this.state = 'menu';
    this.paused = false;
    this.time = 0;
    this.matchTime = 0;
    this.rng = mulberry32(1337);
    this.nearLoot = null;
    this.airdrop = null;
    this.airdropTimer = 95;
    this.hitFx = document.getElementById('hitfx');

    this._initRenderer();
    this._initScene();

    this.input = new Input(canvas);
    this.audio = new GameAudio();
    this.audio.setVolume(this.settings.volume);
    this.input.sensitivity = this.settings.sensitivity;
    this.input.onLockChange = (locked) => this._onLockChange(locked);

    this.world = new World(this.scene, 20240517);
    this.hud = new HUD(this.world, {
      onStart: () => this.startMatch(),
      onResume: () => this.resume(),
      onRestart: () => this.restart(),
      onQuit: () => this.quitToMenu(),
      onSettings: (s) => this.applySettings(s),
    });
    this.hud.applySettingsToUI(this.settings);

    this.player = new Player({
      camera: this.camera,
      world: this.world,
      input: this.input,
      audio: this.audio,
      scene: this.scene,
    });
    this.player.hp = 100;
    this.player.resize(window.innerWidth / window.innerHeight);

    this._createChute();
    this._createPlane();
    this._createAirdropBox();

    this.effects = new Effects(this.scene);

    this.loot = null;
    this.bots = null;
    this.zone = null;

    this.menuCameraAngle = 0;
    this._prepareMenuScene();
    this._bindWindow();
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  // ---------- инициализация ----------

  _initRenderer() {
    const renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: this.settings.quality !== 'low',
      powerPreference: 'high-performance',
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(this._pixelRatio());
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.autoClear = false;
    this.renderer = renderer;
  }

  _pixelRatio() {
    const dpr = window.devicePixelRatio || 1;
    if (this.settings.quality === 'low') return Math.min(dpr, 0.8);
    if (this.settings.quality === 'high') return Math.min(dpr, 2);
    return Math.min(dpr, 1.25);
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xb9d3e8, 420, 1500);

    this.camera = new THREE.PerspectiveCamera(this.settings.fov, window.innerWidth / window.innerHeight, 0.08, 2600);
    this.camera.rotation.order = 'YXZ';

    const hemi = new THREE.HemisphereLight(0xd8ecff, 0x54613c, 1.15);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff2d6, 1.85);
    sun.position.set(320, 620, 180);
    this.scene.add(sun);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.18));

    // небо: градиентный купол
    const skyGeo = new THREE.SphereGeometry(2400, 24, 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        top: { value: new THREE.Color(0x2f6fb5) },
        mid: { value: new THREE.Color(0x8fc0e8) },
        bottom: { value: new THREE.Color(0xdfe7ea) },
      },
      vertexShader: 'varying vec3 vPos; void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `
        varying vec3 vPos;
        uniform vec3 top; uniform vec3 mid; uniform vec3 bottom;
        void main(){
          float h = normalize(vPos).y;
          vec3 c = mix(bottom, mid, smoothstep(-0.05, 0.28, h));
          c = mix(c, top, smoothstep(0.2, 0.85, h));
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    this.sky = new THREE.Mesh(skyGeo, skyMat);
    this.sky.name = 'sky';
    this.scene.add(this.sky);
  }

  _createPlane() {
    const geo = planeGeometry();
    this.planeMesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    this.planeMesh.visible = false;
    this.scene.add(this.planeMesh);
    this.plane = {
      pos: new THREE.Vector3(),
      start: new THREE.Vector3(),
      end: new THREE.Vector3(),
      dir: new THREE.Vector3(0, 0, -1),
      active: false,
      progress: 0,
    };
  }

  _createChute() {
    const geo = mergeColored([
      { geo: new THREE.SphereGeometry(1, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2.7), color: 0xe8e2d2, position: [0, 0, 0], scale: [2.6, 1.4, 2.6] },
      { geo: new THREE.BoxGeometry(1, 1, 1), color: 0x8f8d80, position: [0, -1.6, 0], scale: [0.06, 3.2, 0.06] },
      { geo: new THREE.BoxGeometry(1, 1, 1), color: 0x8f8d80, position: [-0.8, -1.3, 0], rotation: [0, 0, 0.35], scale: [0.04, 2.6, 0.04] },
      { geo: new THREE.BoxGeometry(1, 1, 1), color: 0x8f8d80, position: [0.8, -1.3, 0], rotation: [0, 0, -0.35], scale: [0.04, 2.6, 0.04] },
    ]);
    this.chuteMesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    this.chuteMesh.visible = false;
    this.scene.add(this.chuteMesh);
  }

  _createAirdropBox() {
    const geo = mergeColored([
      { geo: new THREE.BoxGeometry(1, 1, 1), color: 0xd8523f, position: [0, 0.6, 0], scale: [1.6, 1.2, 1.6] },
      { geo: new THREE.BoxGeometry(1, 1, 1), color: 0xf0e6d2, position: [0, 0.6, 0], scale: [1.66, 0.32, 1.66] },
      { geo: new THREE.BoxGeometry(1, 1, 1), color: 0xf0e6d2, position: [0, 0.6, 0], scale: [0.32, 1.26, 1.66] },
    ]);
    this.airdropMesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    this.airdropMesh.visible = false;
    this.scene.add(this.airdropMesh);
    this.airdropBeam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.5, 40, 8, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xff5a4a, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.airdropBeam.visible = false;
    this.scene.add(this.airdropBeam);
  }

  _bindWindow() {
    window.addEventListener('resize', () => this._onResize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.pause();
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.state === 'playing' && !this.paused) this.pause();
    });
    this.input.onKey = (code) => {
      if (code === 'Tab') {
        if (this.paused) this.resume();
        else this.pause();
        return;
      }
      if (code === 'KeyM' && this.state !== 'menu') {
        this.hud.toggleFullmap();
      }
      if (code === 'Escape' && this.hud.fullmapOpen) {
        this.hud.toggleFullmap(false);
      }
      if (code === 'F3') {
        document.getElementById('fpsCounter')?.classList.toggle('hidden');
      }
      if (code === 'KeyN') {
        const muted = this.audio.toggleMute();
        this.hud.toast(muted ? 'Звук выключен' : 'Звук включён');
      }
      if (code === 'KeyF' || code === 'Space') {
        if (this.state === 'plane') this._jumpFromPlane();
        else if (this.state === 'freefall') this._openChute();
        else if (this.state === 'playing') this._tryPickup();
      }
    };
    this.input.onWheel = () => {
      if (this.state !== 'playing') return;
      const p = this.player;
      if (p.slots[0] && p.slots[1]) p.switchSlot(p.slotIndex === 0 ? 1 : 0);
    };
    document.getElementById('startBtn').addEventListener('click', () => this.audio.init());
  }

  _onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(this._pixelRatio());
    this.player?.resize(w / h);
  }

  _prepareMenuScene() {
    this.player.pos.set(0, this.world.surfaceY(0, 0) + 2, 0);
    this.state = 'menu';
    this.hud.showStart();
    // камера в меню летает над островом
    this.menuTarget = new THREE.Vector3(0, 30, 0);
  }

  // ---------- настройки ----------

  applySettings(s) {
    this.settings = { ...this.settings, ...s };
    this.input.sensitivity = this.settings.sensitivity;
    this.audio.setVolume(this.settings.volume);
    this.player.resize(window.innerWidth / window.innerHeight);
    this.renderer.setPixelRatio(this._pixelRatio());
    if (this.state === 'menu' || this.state === 'playing') {
      this.camera.fov = this.settings.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  // ---------- матч ----------

  startMatch() {
    this.audio.init();
    this.hud.hideStart();
    this.hud.resetEndScreens();
    this.input.requestLock();
    this._startRound();
  }

  restart() {
    this.hud.resetEndScreens();
    this.hud.hideStart();
    this.audio.init();
    this.input.requestLock();
    this._startRound();
  }

  quitToMenu() {
    this.state = 'menu';
    this.paused = false;
    this.input.exitLock();
    this.audio.setPlane(false);
    this._clearRound();
    this.hud.resetEndScreens();
    this.hud.showStart();
    this.player.isDead = false;
  }

  _clearRound() {
    if (this.loot) {
      for (const it of this.loot.items) this.scene.remove(it.mesh);
      this.loot = null;
    }
    if (this.bots) {
      for (const b of this.bots.bots) {
        this.scene.remove(b.mesh);
        b.alive = false;
      }
      this.bots = null;
    }
    if (this.zone) {
      this.scene.remove(this.zone.wall, this.zone.ring, this.zone.nextRing);
      this.zone.wall.geometry.dispose();
      this.zone.ring.geometry.dispose();
      this.zone.nextRing.geometry.dispose();
      this.zone = null;
    }
    this.airdropMesh.visible = false;
    this.airdropBeam.visible = false;
    this.airdrop = null;
    this.chuteMesh.visible = false;
    this.planeMesh.visible = false;
    this.effects.tracers.forEach((t) => { t.obj.visible = false; });
  }

  _startRound() {
    this._clearRound();
    const seed = (Math.random() * 1e9) | 0;
    const rng = mulberry32(seed);
    this.rng = rng;
    this.time = 0;
    this.airdropTimer = 95;
    this.hud.resetEndScreens();

    this.loot = new LootManager(this.scene, this.world, rng);
    this.loot.spawnFromWorld();
    this.bots = new BotManager({
      scene: this.scene,
      world: this.world,
      loot: this.loot,
      rng,
      count: 34,
      onKill: (victim, killer, simulated) => this.onBotKilled(victim, killer, simulated),
    });
    this.zone = new Zone(this.scene, rng);
    this.zone.reset();

    // маршрут самолёта
    const a = rng() * Math.PI * 2;
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    this.plane.start.set(dir.x * 760, START_ALT, dir.z * 760);
    this.plane.end.set(-dir.x * 720, START_ALT, -dir.z * 720);
    this.plane.pos.copy(this.plane.start);
    this.plane.dir.copy(this.plane.end).sub(this.plane.start).normalize();
    this.plane.active = true;
    this.planeMesh.visible = true;
    this.planeMesh.position.copy(this.plane.pos);
    this.planeMesh.rotation.y = Math.atan2(-this.plane.dir.x, -this.plane.dir.z);

    this.player.reset(new THREE.Vector3(this.plane.pos.x, this.plane.pos.y, this.plane.pos.z));
    this.player.isDead = false;
    this.player.hp = this.player.maxHp;

    this.state = 'plane';
    this.paused = false;
    this.freefallSpeed = 0;
    this.chuteOpen = false;
    this.audio.setPlane(true);
    this.hud.bigText('Самолёт над островом — выбери место и прыгай!', 4);
    this.hud.toast('F — прыжок из самолёта');
  }

  _jumpFromPlane() {
    if (this.state !== 'plane') return;
    this.state = 'freefall';
    this.plane.active = false;
    this.chuteOpen = false;
    this.freefallSpeed = 12;
    this.player.pos.set(this.plane.pos.x, this.plane.pos.y - 3, this.plane.pos.z);
    this.player.vel.set(0, 0, 0);
    this.planeMesh.visible = false;
    this.audio.setPlane(false);
    this.audio.play('planeJump');
    this.hud.toast('Прыжок! Держи W, чтобы ускориться, F — парашют');
  }

  _openChute() {
    if (this.state !== 'freefall') return;
    this.state = 'parachute';
    this.chuteOpen = true;
    this.chuteMesh.visible = true;
    this.audio.play('chute');
    this.hud.setDropHint('Парашют раскрыт. WASD — снижение, ищи лут');
  }

  _landPlayer() {
    this.state = 'playing';
    this.chuteMesh.visible = false;
    this.hud.setDropHint('');
    this.player.pos.y = this.world.surfaceY(this.player.pos.x, this.player.pos.z);
    this.player.vel.set(0, 0, 0);
    this.player.grounded = true;
    this.player._syncViewModel();
    this.hud.toast('Ты на земле — собери оружие: <b>F</b>');
    this.audio.play('land');
  }

  _tryPickup() {
    if (this.state !== 'playing' || this.player.isDead) return;
    const item = this.loot.nearest(this.player.pos, 2.8);
    if (!item) return;
    const res = this.player.pickup(item, this.loot);
    if (res.ok) {
      this.audio.play('pickup');
      this.hud.toast(res.msg);
    } else if (res.msg) {
      this.hud.toast(res.msg);
    }
  }

  pause() {
    if (!['playing', 'plane', 'freefall', 'parachute'].includes(this.state) || this.paused) return;
    this.paused = true;
    this.hud.showPause();
    this.input.exitLock();
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.hud.hidePause();
    this.input.requestLock();
    this.audio.init();
  }

  _onLockChange(locked) {
    if (!locked && !this.paused && (this.state === 'playing' || this.state === 'plane')) {
      this.pause();
    }
  }

  // ---------- стрельба ----------

  traceShot(origin, dir, range, shooter) {
    const worldDist = this.world.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, range);
    let best = worldDist;
    let hit = null, head = false;
    if (shooter === this.player && this.bots) {
      const b = this.bots.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, best);
      if (b) { best = b.t; hit = b.bot; head = b.head; }
    }
    const end = new THREE.Vector3(
      origin.x + dir.x * best,
      origin.y + dir.y * best,
      origin.z + dir.z * best,
    );
    const def = this.player.weaponDef;
    this.effects.tracer(
      new THREE.Vector3(origin.x + dir.x * 0.7, origin.y + dir.y * 0.7 - 0.08, origin.z + dir.z * 0.7),
      end,
      def ? def.tracer : 0xffe0a0,
    );

    if (hit) {
      const dist = best;
      const falloff = dist > range * 0.55 ? lerp(1, 0.72, clamp((dist - range * 0.55) / (range * 0.45), 0, 1)) : 1;
      const dmg = (def ? def.damage : 30) * falloff;
      const applied = hit.takeDamage(dmg, head, this.player, this);
      this.player.damageDealt += applied;
      this.effects.impact(end, 'blood');
      this.hud.hitmarker(head);
      this.audio.play(head ? 'headshot' : 'hit');
      if (this.settings.damageNumbers) this.damageNumber(applied, head);
    } else if (worldDist < range) {
      this.effects.impact(end, Math.random() < 0.2 ? 'metal' : 'dust');
    }
    return { hit: !!hit, bot: hit, head, dist: best };
  }

  botShoot(bot, origin, dir, def) {
    const worldDist = this.world.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, def.range);
    const p = this.player;
    let best = worldDist, hitPlayer = false, head = false;

    if (!p.isDead) {
      const spheres = [
        [p.pos.y + p.height - 0.22, 0.24, true],
        [p.pos.y + p.height - 0.75, 0.4, false],
        [p.pos.y + 0.55, 0.36, false],
      ];
      for (const [cy, r, isHead] of spheres) {
        const dx = origin.x - p.pos.x, dy = origin.y - cy, dz = origin.z - p.pos.z;
        // луч из оружия бота в сторону игрока
        const b = dx * dir.x + dy * dir.y + dz * dir.z;
        const c = dx * dx + dy * dy + dz * dz - r * r;
        const disc = b * b - c;
        if (disc < 0) continue;
        const sq = Math.sqrt(disc);
        const t1 = -b - sq, t2 = -b + sq;
        const t = t1 > 0 ? t1 : t2 > 0 ? t2 : -1;
        if (t > 0 && t < best) { best = t; hitPlayer = true; head = isHead; }
      }
    }

    const end = new THREE.Vector3(origin.x + dir.x * best, origin.y + dir.y * best, origin.z + dir.z * best);
    this.effects.tracer(origin, end, def.tracer);

    const distToPlayer = Math.hypot(bot.pos.x - p.pos.x, bot.pos.z - p.pos.z);
    if (distToPlayer < 160) {
      this.audio.play(def.cls === 'sniper' ? 'sniper' : def.cls === 'shotgun' ? 'shotgun' : 'rifle');
    }

    if (hitPlayer) {
      // ботов много: их урон специально мягче, иначе игрок умирает за пару секунд
      const dmg = def.damage * (head ? 0.9 : 0.45);
      p.damage(dmg, { head, attacker: bot });
      this.effects.impact(end, 'blood');
      this.hud.damageFlash(dmg);
      this.audio.play('hurt');
      this.lastAttacker = bot;
    } else if (worldDist < def.range) {
      this.effects.impact(end, 'dust');
    }
  }

  onHitMark() { /* зарезервировано под индивидуальные эффекты */ }

  damageNumber(amount, head) {
    if (!this.hitFx || amount < 0.5) return;
    const d = document.createElement('div');
    d.className = 'dmgNum' + (head ? ' head' : '');
    d.textContent = Math.round(amount) + (head ? '!' : '');
    d.style.left = `${52 + (Math.random() - 0.5) * 8}%`;
    d.style.top = `${46 + (Math.random() - 0.5) * 6}%`;
    this.hitFx.appendChild(d);
    setTimeout(() => d.remove(), 700);
  }

  // ---------- события ----------

  toast(msg) { this.hud.toast(msg); }

  onZoneShrink(zone) {
    const outside = !zone.isInside(this.player.pos.x, this.player.pos.z);
    this.hud.toast('Синяя зона начинает сжиматься!', 'warn');
    if (outside) this.hud.toast('Ты вне зоны — беги к кругу!', 'danger');
    this.audio.play('zoneTick');
  }

  onZoneDamage(dmg) {
    this.hud.damageFlash(dmg * 2);
    this.audio.play('zoneTick');
  }

  onFell(dmg) {
    this.hud.toast(`Жёсткое приземление: −${Math.round(dmg)} HP`, 'danger');
  }

  onBotKilled(bot, killer, simulated = false) {
    if (killer?.isPlayer) {
      this.player.kills++;
      this.hud.killfeed(`<b class="you">Ты</b> убил <b>${bot.name}</b>`, true);
      this.audio.play('kill');
      this.hud.toast(`Убит: ${bot.name} (${this.player.kills})`);
      this.checkVictory();
    } else if (!simulated) {
      this.hud.killfeed(`<b>${killer?.name || '?</b>'} убил <b>${bot.name}</b>`);
    } else {
      this.hud.killfeed(`${killer?.name || '?'} убил ${bot.name}`);
    }
  }

  checkVictory() {
    if (this.state !== 'playing') return;
    if (this.bots.aliveCount === 0 && !this.player.isDead) {
      this.state = 'victory';
      this.audio.play('win');
      this.input.exitLock();
      this.hud.showVictory(this.player.kills, this.time, this.player.damageDealt);
    }
  }

  onPlayerDeath() {
    this.state = 'dead';
    this.audio.play('lose');
    this.input.exitLock();
    this.chuteMesh.visible = false;
    const rank = 1 + this.bots.aliveCount;
    const total = this.bots.total + 1;
    setTimeout(() => {
      this.hud.showDeath(rank, total, this.player.kills, this.player.killer?.name, this.time);
    }, 900);
  }

  // ---------- аирдроп ----------

  spawnAirdrop() {
    const rng = this.rng;
    const zone = this.zone;
    const ang = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * zone.radius * 0.6;
    const x = zone.center.x + Math.cos(ang) * r;
    const z = zone.center.y + Math.sin(ang) * r;
    this.airdrop = {
      pos: new THREE.Vector3(x, START_ALT, z),
      targetY: this.world.surfaceY(x, z),
      landed: false,
    };
    this.airdropMesh.visible = true;
    this.airdropMesh.position.set(x, START_ALT, z);
    this.airdropBeam.visible = false;
    this.hud.toast('Аирдроп сброшен — ищи красный дым!', 'warn');
    this.hud.killfeed('Аирдроп сброшен в зоне');
    this.audio.play('crate');
  }

  _updateAirdrop(dt) {
    if (!this.airdrop) return;
    const a = this.airdrop;
    if (!a.landed) {
      a.pos.y -= 16 * dt;
      this.airdropMesh.position.copy(a.pos);
      if (a.pos.y <= a.targetY) {
        a.pos.y = a.targetY;
        a.landed = true;
        this.airdropMesh.position.copy(a.pos);
        this.airdropBeam.visible = true;
        this.airdropBeam.position.set(a.pos.x, a.pos.y + 20, a.pos.z);
        const rng = this.rng;
        this.loot.spawnAt(a.pos.x + 1.6, a.pos.y, a.pos.z, 'weapon', pick(rng, ['m416', 'kar98', 'akm']), true);
        this.loot.spawnAt(a.pos.x - 1.6, a.pos.y, a.pos.z, 'armor', 3, true);
        this.loot.spawnAt(a.pos.x, a.pos.y, a.pos.z + 1.6, 'heal', 'medkit', true);
        this.loot.spawnAt(a.pos.x, a.pos.y, a.pos.z - 1.6, 'helmet', 3, true);
        this.loot.spawnAt(a.pos.x, a.pos.y + 0.1, a.pos.z, 'ammo', '762', true);
      }
    } else if (this.airdropBeam.visible) {
      this.airdropBeam.material.opacity = 0.18 + Math.sin(this.time * 3) * 0.1;
    }
  }

  // ---------- главный цикл ----------

  _loop(ms) {
    requestAnimationFrame(this._loop);
    const now = ms / 1000;
    if (!this._lastMs) this._lastMs = now;
    let dt = now - this._lastMs;
    this._lastMs = now;
    if (dt > 0.1) dt = 0.1;
    if (dt < 0) dt = 0;
    this.frameNow = now;

    if (!this.paused) this._update(dt, now);
    this._render();
    this.input.endFrame();
    this._trackPerf(dt);
  }

  _update(dt, now) {
    if (this.state === 'menu') {
      this._updateMenuCamera(dt);
      return;
    }

    this.time += dt;

    if (this.state === 'plane') this._updatePlane(dt);
    else if (this.state === 'freefall') this._updateFreefall(dt);
    else if (this.state === 'parachute') this._updateParachute(dt);

    if (this.state === 'playing') {
      this.player.update(dt, this.time, this);
      this.nearLoot = this.loot.nearest(this.player.pos, 2.8);
      if (this.player.isDead) {
        this.onPlayerDeath();
      }
    } else if (this.state === 'dead' || this.state === 'victory') {
      // камера не двигается, но мир живёт
      this.nearLoot = null;
    }

    if (this.bots) this.bots.update(dt, this.time, this.player, this);
    this.zone?.update(dt, this.state === 'playing' ? this.player : null, this);
    this.loot?.update(dt, this.player.pos);
    this._updateAirdrop(dt);

    this.airdropTimer -= dt;
    if (this.airdropTimer <= 0 && this.state === 'playing') {
      this.airdropTimer = rnd(this.rng, 110, 160);
      this.spawnAirdrop();
    }

    this.effects.update(dt);

    // FOV: прицеливание / прицел снайперки
    const targetFov = this.state === 'playing' || this.state === 'freefall' || this.state === 'parachute'
      ? this.player.targetFov(this.settings.fov)
      : this.camera.fov;
    this.camera.fov = lerp(this.camera.fov, targetFov, Math.min(1, dt * 10));
    this.camera.updateProjectionMatrix();

    // выживание: победа, если все боты мертвы
    if (this.state === 'playing') this.checkVictory();

    this.hud.update(this, dt);

    // облако самолёта следует за камерой, чтобы небо не «уезжало»
    if (this.sky) this.sky.position.copy(this.camera.position);
  }

  /** Считаем FPS; если совсем просело — аккуратно снижаем качество. */
  _trackPerf(dt) {
    if (!this._fpsSample) this._fpsSample = { frames: 0, time: 0, shown: 0 };
    const s = this._fpsSample;
    s.frames++;
    s.time += dt;
    if (s.time >= 1) {
      s.shown = s.frames / s.time;
      s.frames = 0;
      s.time = 0;
      const el = document.getElementById('fpsCounter');
      if (el && !el.classList.contains('hidden')) el.textContent = `${Math.round(s.shown)} FPS · ${this.renderer.info.render.calls} вызовов`;
      // авто-снижение качества: только в бою и только если реально плохо
      if (this.state === 'playing' && !this.paused) {
        if (s.shown < 28) this._lowFps = (this._lowFps || 0) + 1;
        else this._lowFps = 0;
        if (this._lowFps >= 4) {
          this._lowFps = 0;
          const pr = this.renderer.getPixelRatio();
          if (pr > 0.75) {
            this.renderer.setPixelRatio(Math.max(0.7, pr - 0.2));
            this.hud.toast('Графика снижена — FPS ' + Math.round(s.shown), 'warn');
          }
        }
      }
    }
  }

  _updateMenuCamera(dt) {
    this.menuCameraAngle += dt * 0.045;
    this.camera.position.set(
      Math.cos(this.menuCameraAngle) * 430,
      150,
      Math.sin(this.menuCameraAngle) * 430,
    );
    this.camera.lookAt(0, 20, 0);
    this.camera.fov = 62;
    this.camera.updateProjectionMatrix();
    if (this.sky) this.sky.position.copy(this.camera.position);
  }

  _updatePlane(dt) {
    const p = this.plane;
    const len = p.start.distanceTo(p.end);
    p.progress = Math.min(1, p.progress + (PLANE_SPEED * dt) / len);
    p.pos.copy(p.start).lerp(p.end, p.progress);
    p.pos.y = START_ALT + Math.sin(p.progress * Math.PI) * 12;
    this.planeMesh.position.copy(p.pos);
    this.planeMesh.rotation.y = Math.atan2(-p.dir.x, -p.dir.z);

    this.player.pos.copy(p.pos);

    // кинематографичная камера позади самолёта
    const back = p.dir.clone().multiplyScalar(-26);
    const camTarget = p.pos.clone().add(back);
    camTarget.y += 8;
    this.camera.position.lerp(camTarget, Math.min(1, dt * 6));
    const look = p.pos.clone().add(p.dir.clone().multiplyScalar(30));
    this.camera.lookAt(look);
    this.camera.fov = this.settings.fov;
    this.camera.updateProjectionMatrix();

    // авто-выброс в конце маршрута
    if (p.progress > 0.92) {
      this.hud.toast('Конец маршрута — принудительный прыжок!', 'warn');
      this._jumpFromPlane();
    }
  }

  _updateFreefall(dt) {
    const input = this.input;
    const p = this.player;
    const forward = input.move.z;
    this.freefallSpeed = clamp(this.freefallSpeed + dt * (forward > 0 ? 46 : 24), 12, 62);
    const speed = this.freefallSpeed;

    // горизонтальная скорость по направлению взгляда
    const yaw = input.yaw;
    const fwdX = -Math.sin(yaw), fwdZ = -Math.cos(yaw);
    const sideX = Math.cos(yaw), sideZ = -Math.sin(yaw);
    const boost = 1 + Math.max(0, forward) * 0.8;
    p.pos.x += (fwdX * boost + sideX * input.move.x * 0.6) * 16 * dt;
    p.pos.z += (fwdZ * boost + sideZ * input.move.x * 0.6) * 16 * dt;
    p.pos.y -= speed * dt;
    p.pos.x = clamp(p.pos.x, -700, 700);
    p.pos.z = clamp(p.pos.z, -700, 700);

    const ground = this.world.surfaceY(p.pos.x, p.pos.z);
    this.camera.position.set(p.pos.x, p.pos.y + 1.5, p.pos.z);
    this.camera.rotation.set(input.pitch * 0.9, yaw, -input.move.x * 0.15);
    this.camera.fov = lerp(this.camera.fov, this.settings.fov + 8, Math.min(1, dt * 4));
    this.camera.updateProjectionMatrix();
    p.height = 1.8;

    if (p.pos.y - ground < 130) this._openChute();
  }

  _updateParachute(dt) {
    const input = this.input;
    const p = this.player;
    const yaw = input.yaw;
    const fwdX = -Math.sin(yaw), fwdZ = -Math.cos(yaw);
    const sideX = Math.cos(yaw), sideZ = -Math.sin(yaw);
    const speed = 15;
    p.pos.x += (fwdX * input.move.z + sideX * input.move.x) * speed * dt;
    p.pos.z += (fwdZ * input.move.z + sideZ * input.move.x) * speed * dt;
    p.pos.y -= (7.5 + Math.max(0, -input.pitch) * 4) * dt;
    p.pos.x = clamp(p.pos.x, -700, 700);
    p.pos.z = clamp(p.pos.z, -700, 700);

    const ground = this.world.surfaceY(p.pos.x, p.pos.z);
    this.chuteMesh.position.set(p.pos.x, p.pos.y + 3.4, p.pos.z);
    this.chuteMesh.rotation.z = Math.sin(this.time * 1.6) * 0.06;
    this.chuteMesh.rotation.y = yaw;
    this.camera.position.set(p.pos.x, p.pos.y + 1.65, p.pos.z);
    this.camera.rotation.set(input.pitch, yaw, Math.sin(this.time * 1.2) * 0.03);
    this.camera.fov = lerp(this.camera.fov, this.settings.fov, Math.min(1, dt * 4));
    this.camera.updateProjectionMatrix();

    if (p.pos.y <= ground + 0.15) {
      p.pos.y = ground;
      this._landPlayer();
    }
  }

  _render() {
    const r = this.renderer;
    r.clear();
    r.render(this.scene, this.camera);
    const p = this.player;
    if (this.state === 'playing' && !p.isDead) {
      p.viewCamera.aspect = this.camera.aspect;
      p.viewCamera.updateProjectionMatrix();
      r.clearDepth();
      r.render(p.viewScene, p.viewCamera);
    }
  }
}
