// Точка входа: создаём игру, прячем загрузочный экран, сохраняем настройки.

import { Game } from './game.js';

const SETTINGS_KEY = 'pubgweb.settings.v1';

const DEFAULTS = {
  sensitivity: 1,
  volume: 0.65,
  quality: 'medium',
  fov: 78,
  damageNumbers: true,
};

function loadSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    const s = { ...DEFAULTS };
    for (const k of Object.keys(DEFAULTS)) {
      if (raw[k] !== undefined && typeof raw[k] === typeof DEFAULTS[k]) s[k] = raw[k];
    }
    return s;
  } catch (e) {
    return { ...DEFAULTS };
  }
}

function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) { /* приватный режим */ }
}

const loading = document.getElementById('loading');
const canvas = document.getElementById('game');

function fatal(title, text) {
  if (loading) loading.remove();
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;'
    + 'background:#0b0e12;color:#e8eef4;font-family:system-ui,sans-serif;text-align:center;padding:24px;z-index:999';
  box.innerHTML = `<div style="max-width:520px">
      <h1 style="color:#f3c33c;font-size:22px;letter-spacing:.08em">${title}</h1>
      <p style="color:#93a0ae;line-height:1.6;font-size:14px">${text}</p>
    </div>`;
  document.body.appendChild(box);
}

let game = null;
try {
  if (!canvas.getContext('webgl2') && !canvas.getContext('webgl')) {
    throw new Error('WebGL недоступен');
  }
  game = new Game(canvas, loadSettings());
} catch (err) {
  console.error(err);
  fatal('Не удалось запустить 3D', `Браузер не дал доступ к WebGL или произошла ошибка инициализации.<br>
    Попробуй Chrome, Edge или Firefox последней версии и включи аппаратное ускорение.<br>
    <small style="color:#5d6a78">${String(err.message || err)}</small>`);
}

if (game) {
  // сохраняем настройки при любом изменении
  const apply = game.applySettings.bind(game);
  game.applySettings = (s) => {
    apply(s);
    saveSettings(game.settings);
  };

  // предупреждение для телефонов и планшетов
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  if (coarse) document.getElementById('mobileNote')?.classList.remove('hidden');

  // глобальная ссылка пригодится для отладки в консоли
  window.__pubg = game;

  // прячем загрузку после первых отрисованных кадров
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (!loading) return;
      loading.classList.add('done');
      setTimeout(() => loading.remove(), 700);
    });
  });
}

window.addEventListener('error', (e) => {
  console.error('[pubg-web]', e.error || e.message);
});
