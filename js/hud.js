// HUD и все экраны: старт, пауза, смерть, победа, киллфид, компас, прицел.

import { Minimap } from './minimap.js';
import { fmtClock, clamp } from './util.js';
import { WEAPONS, HEALS, AMMO_LABEL } from './items.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor(world, { onStart, onResume, onRestart, onSettings, onQuit } = {}) {
    this.world = world;
    this.minimap = new Minimap($('minimap'), world, { baseSize: 300 });
    this.bigmapCanvas = $('bigmap');
    this.bigmap = new Minimap(this.bigmapCanvas, world, { baseSize: 300 });
    this.bigmap._base = this.minimap.base;

    this.el = {
      hud: $('hud'),
      start: $('startScreen'),
      pause: $('pauseScreen'),
      death: $('deathScreen'),
      victory: $('victoryScreen'),
      fullmap: $('fullmap'),
      scope: $('scope'),
      alive: $('aliveCount'),
      kills: $('killCount'),
      zoneLabel: $('zoneLabel'),
      zoneTimer: $('zoneTimer'),
      clock: $('gameClock'),
      hpBar: $('hpBar'),
      hpText: $('hpText'),
      armorBar: $('armorBar'),
      armorText: $('armorText'),
      helmetPips: $('helmetPips'),
      staminaBar: $('staminaBar'),
      weaponName: $('weaponName'),
      magAmmo: $('magAmmo'),
      reserveAmmo: $('reserveAmmo'),
      slot0: $('slot0'),
      slot1: $('slot1'),
      heals: $('healCounts'),
      crosshair: $('crosshair'),
      hitmarker: $('hitmarker'),
      prompt: $('prompt'),
      promptText: $('promptText'),
      toasts: $('toasts'),
      killfeed: $('killfeed'),
      bigText: $('bigText'),
      vignette: $('dmgVignette'),
      compassStrip: $('compassStrip'),
      reloadBar: $('reloadBar'),
      reloadFill: $('reloadFill'),
      healBar: $('healBar'),
      healFill: $('healFill'),
      killerLine: $('killerLine'),
      deathStats: $('deathStats'),
      victoryStats: $('victoryStats'),
      deathTitle: $('deathTitle'),
      planeHint: $('planeHint'),
      dropHint: $('dropHint'),
      altitude: $('altitude'),
      settingsPanel: $('settingsPanel'),
      quality: $('qualitySelect'),
      volume: $('volumeRange'),
      sens: $('sensRange'),
      fov: $('fovRange'),
      damageNumbers: $('damageNumbers'),
    };

    this._buildCompass();
    this._bindUI({ onStart, onResume, onRestart, onSettings, onQuit });
    this._lastHp = 100;
    this._hitTimer = 0;
    this._vignette = 0;
    this._toastArr = [];
    this._planeHint = '';
    this._lastKillfeed = 0;
  }

  _buildCompass() {
    const strip = this.el.compassStrip;
    const labels = { 0: 'С', 45: 'СВ', 90: 'В', 135: 'ЮВ', 180: 'Ю', 225: 'ЮЗ', 270: 'З', 315: 'СЗ' };
    let html = '';
    for (let deg = -180; deg <= 540; deg += 15) {
      const d = ((deg % 360) + 360) % 360;
      const label = labels[d] || '';
      html += `<div class="tick ${label ? 'major' : ''}"><span>${label || ''}</span><i>${label ? d : d}</i></div>`;
    }
    strip.innerHTML = html;
  }

  _bindUI({ onStart, onResume, onRestart, onSettings, onQuit }) {
    $('startBtn').addEventListener('click', () => onStart?.());
    $('resumeBtn').addEventListener('click', () => onResume?.());
    $('restartBtn').addEventListener('click', () => onRestart?.());
    $('deathRestartBtn').addEventListener('click', () => onRestart?.());
    $('victoryRestartBtn').addEventListener('click', () => onRestart?.());
    $('quitBtn').addEventListener('click', () => onQuit?.());

    const settingsToggle = $('settingsToggle');
    settingsToggle?.addEventListener('click', () => {
      this.el.settingsPanel.classList.toggle('hidden');
    });

    const emit = () => onSettings?.({
      sensitivity: parseFloat(this.el.sens?.value || '1'),
      volume: parseFloat(this.el.volume?.value || '65') / 100,
      quality: this.el.quality?.value || 'medium',
      fov: parseFloat(this.el.fov?.value || '78'),
      damageNumbers: !!this.el.damageNumbers?.checked,
    });
    this.el.sens?.addEventListener('input', emit);
    this.el.volume?.addEventListener('input', emit);
    this.el.quality?.addEventListener('change', emit);
    this.el.fov?.addEventListener('input', emit);
    this.el.damageNumbers?.addEventListener('change', emit);
  }

  applySettingsToUI(settings) {
    if (this.el.sens) this.el.sens.value = settings.sensitivity;
    if (this.el.volume) this.el.volume.value = Math.round(settings.volume * 100);
    if (this.el.quality) this.el.quality.value = settings.quality;
    if (this.el.fov) this.el.fov.value = settings.fov;
    if (this.el.damageNumbers) this.el.damageNumbers.checked = settings.damageNumbers;
  }

  // ---------- экраны ----------

  showStart() {
    this.el.start.classList.remove('hidden');
    this.el.hud.classList.add('hidden');
    this.hideOthers(['pause', 'death', 'victory']);
  }

  hideStart() {
    this.el.start.classList.add('hidden');
    this.el.hud.classList.remove('hidden');
  }

  showPause() {
    this.el.pause.classList.remove('hidden');
  }

  hidePause() {
    this.el.pause.classList.add('hidden');
  }

  showDeath(rank, total, kills, killer, time) {
    this.el.death.classList.remove('hidden');
    this.el.deathTitle.textContent = `#${rank} / ${total}`;
    this.el.killerLine.innerHTML = killer
      ? `Тебя убил <b>${killer}</b>`
      : 'Ты погиб';
    this.el.deathStats.innerHTML = `
      <div><span>Убийств</span><b>${kills}</b></div>
      <div><span>Место</span><b>#${rank}</b></div>
      <div><span>В игре</span><b>${fmtClock(time)}</b></div>`;
  }

  showVictory(kills, time, damage) {
    this.el.victory.classList.remove('hidden');
    this.el.victoryStats.innerHTML = `
      <div><span>Убийств</span><b>${kills}</b></div>
      <div><span>Урон</span><b>${Math.round(damage)}</b></div>
      <div><span>В игре</span><b>${fmtClock(time)}</b></div>`;
  }

  hideOthers(names) {
    for (const n of names) this.el[n].classList.add('hidden');
  }

  resetEndScreens() {
    this.el.death.classList.add('hidden');
    this.el.victory.classList.add('hidden');
    this.el.pause.classList.add('hidden');
    this.el.bigText.textContent = '';
    this.el.killfeed.innerHTML = '';
    this.el.toasts.innerHTML = '';
    this.el.vignette.style.opacity = '0';
    this.el.fullmap.classList.add('hidden');
  }

  get fullmapOpen() { return !this.el.fullmap.classList.contains('hidden'); }

  toggleFullmap(force) {
    const show = force !== undefined ? force : this.el.fullmap.classList.contains('hidden');
    this.el.fullmap.classList.toggle('hidden', !show);
  }

  // ---------- эффекты ----------

  toast(text, kind = '') {
    if (!text) return;
    const d = document.createElement('div');
    d.className = 'toast ' + kind;
    d.textContent = text;
    this.el.toasts.appendChild(d);
    setTimeout(() => d.classList.add('out'), 1700);
    setTimeout(() => d.remove(), 2400);
    while (this.el.toasts.children.length > 4) this.el.toasts.firstChild.remove();
  }

  killfeed(text, own = false) {
    const d = document.createElement('div');
    d.className = 'feedItem' + (own ? ' own' : '');
    d.innerHTML = text;
    this.el.killfeed.appendChild(d);
    setTimeout(() => d.classList.add('out'), 5200);
    setTimeout(() => d.remove(), 6000);
    while (this.el.killfeed.children.length > 6) this.el.killfeed.firstChild.remove();
  }

  bigText(text, dur = 3) {
    this.el.bigText.textContent = text;
    this.el.bigText.classList.add('show');
    clearTimeout(this._bigTimer);
    this._bigTimer = setTimeout(() => this.el.bigText.classList.remove('show'), dur * 1000);
  }

  hitmarker(headshot) {
    this.el.hitmarker.classList.remove('show', 'head');
    void this.el.hitmarker.offsetWidth;
    this.el.hitmarker.classList.add('show');
    if (headshot) this.el.hitmarker.classList.add('head');
    clearTimeout(this._hitTimer);
    this._hitTimer = setTimeout(() => this.el.hitmarker.classList.remove('show'), 160);
  }

  damageFlash(amount) {
    this._vignette = Math.min(1, this._vignette + clamp(amount / 55, 0.18, 0.8));
  }

  showPrompt(text) {
    this.el.prompt.classList.remove('hidden');
    this.el.promptText.textContent = text;
  }

  hidePrompt() {
    this.el.prompt.classList.add('hidden');
    this.el.promptText.textContent = '';
  }

  setPlaneHint(text, altitude) {
    if (this._planeHint !== text) {
      this._planeHint = text;
      this.el.planeHint.innerHTML = text;
      this.el.planeHint.classList.toggle('hidden', !text);
    }
    this.el.altitude.textContent = altitude !== null ? `${Math.round(altitude)} м` : '';
    this.el.altitude.classList.toggle('hidden', altitude === null);
  }

  setDropHint(text) {
    this.el.dropHint.textContent = text || '';
    this.el.dropHint.classList.toggle('hidden', !text);
  }

  // ---------- обновление ----------

  update(game, dt) {
    const p = game.player;
    const now = game.time;

    this.el.alive.textContent = 1 + game.bots.aliveCount;
    this.el.kills.textContent = p.kills;
    this.el.clock.textContent = fmtClock(now);

    const z = game.zone;
    this.el.zoneLabel.textContent = z.finished ? 'Финальная зона' : z.stateLabel;
    this.el.zoneTimer.textContent = fmtClock(z.timeLeft);
    this.el.zoneTimer.classList.toggle('danger', z.timeLeft < 10 && z.state === 'wait');

    // здоровье и броня
    const hpPct = clamp(p.hp / p.maxHp, 0, 1);
    this.el.hpBar.style.width = `${hpPct * 100}%`;
    this.el.hpBar.style.background = hpPct > 0.6 ? 'linear-gradient(90deg,#7fd67f,#3fae5a)'
      : hpPct > 0.3 ? 'linear-gradient(90deg,#ffd166,#e8a13a)' : 'linear-gradient(90deg,#ff6b6b,#c0392b)';
    this.el.hpText.textContent = Math.ceil(p.hp);
    const armorPct = p.armorLevel > 0 ? clamp(p.armorHp / (p.armorLevel === 1 ? 50 : p.armorLevel === 2 ? 75 : 100), 0, 1) : 0;
    this.el.armorBar.style.width = `${armorPct * 100}%`;
    this.el.armorText.textContent = p.armorLevel > 0 ? `Броня ${p.armorLevel} ур.` : 'Без брони';
    this.el.helmetPips.innerHTML = p.helmetLevel > 0
      ? `<span class="pip on">Каска ${p.helmetLevel} ур.</span>` : '<span class="pip">Каска —</span>';
    this.el.staminaBar.style.width = `${p.stamina}%`;
    this.el.staminaBar.parentElement.classList.toggle('low', p.stamina < 20);

    // оружие
    const def = p.weaponDef;
    this.el.weaponName.textContent = def ? def.name : 'Кулаки';
    this.el.magAmmo.textContent = def ? p.magAmmo : '—';
    this.el.reserveAmmo.textContent = def ? `/ ${p.reserveAmmo}` : '';
    this.el.magAmmo.classList.toggle('low', !!def && p.magAmmo <= Math.max(1, Math.floor(def.mag * 0.25)));

    for (let i = 0; i < 2; i++) {
      const slot = i === 0 ? this.el.slot0 : this.el.slot1;
      const s = p.slots[i];
      slot.classList.toggle('active', p.slotIndex === i);
      slot.querySelector('.slotName').textContent = s ? WEAPONS[s.id].name : '—';
      slot.querySelector('.slotAmmo').textContent = s ? `${s.ammo}` : '';
    }

    this.el.heals.innerHTML = Object.entries(p.heals)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `<span class="healItem">${HEALS[k].name.slice(0, 1)}<b>${n}</b></span>`)
      .join('') || '<span class="healItem muted">нет аптечек</span>';

    // перезарядка/лечение
    if (def && p.reloading > 0) {
      this.el.reloadBar.classList.remove('hidden');
      this.el.reloadFill.style.width = `${(1 - p.reloading / def.reload) * 100}%`;
    } else {
      this.el.reloadBar.classList.add('hidden');
    }
    if (p.healTimer > 0) {
      this.el.healBar.classList.remove('hidden');
      this.el.healFill.style.width = `${(1 - p.healTimer / p.healTotal) * 100}%`;
    } else {
      this.el.healBar.classList.add('hidden');
    }

    // прицел
    const spread = (def ? (p.ads > 0.5 ? def.spreadAds : def.spreadHip) : 1) + p.bloom;
    const px = clamp(6 + spread * 6, 4, 60);
    this.el.crosshair.style.setProperty('--gap', `${px}px`);
    this.el.crosshair.classList.toggle('hidden', p.isScoped() || p.isDead);
    this.el.scope.classList.toggle('hidden', !p.isScoped());

    // виньетка урона
    this._vignette = Math.max(0, this._vignette - dt * 1.6);
    const lowHp = p.hp < 35 && !p.isDead ? (0.25 + (1 - p.hp / 35) * 0.3) : 0;
    this.el.vignette.style.opacity = String(clamp(this._vignette + lowHp, 0, 0.95));
    this.el.vignette.style.background = p.hp < 35
      ? 'radial-gradient(ellipse at center, transparent 35%, rgba(140,0,0,0.85) 100%)'
      : 'radial-gradient(ellipse at center, transparent 45%, rgba(180,20,20,0.8) 100%)';

    // компас
    const yawDeg = (((-p.input.yaw * 180) / Math.PI) % 360 + 360) % 360;
    this.el.compassStrip.style.transform = `translateX(${(-(yawDeg + 180) * 44) / 15 + 170}px)`;

    // мини-карта
    this.minimap.draw(p, z, game.plane, { showPlane: game.state === 'plane', airdrop: game.airdrop?.pos });
    if (this.fullmapOpen) {
      this.bigmap.draw(p, z, game.plane, { showPlane: game.state === 'plane', airdrop: game.airdrop?.pos });
    }

    // подсказки
    if (game.state === 'plane') {
      this.setPlaneHint('Нажми <b>F</b>, чтобы прыгнуть из самолёта', game.plane.pos.y);
    } else if (game.state === 'freefall') {
      this.setPlaneHint('Свободное падение — <b>F</b> раскрыть парашют', p.pos.y);
    } else if (game.state === 'parachute') {
      this.setPlaneHint('Парашют: <b>WASD</b> — управление', p.pos.y);
    } else {
      this.setPlaneHint('', null);
    }

    // подсказка подбора
    if (game.nearLoot && game.state === 'playing' && !p.isDead) {
      this.showPrompt(`${game.nearLoot.label} — подобрать`);
    } else {
      this.hidePrompt();
    }

    if (p.isDead && game.state === 'dead') {
      this.setDropHint('');
    }
  }
}
