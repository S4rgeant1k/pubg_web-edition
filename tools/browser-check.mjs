#!/usr/bin/env node
// Дым-тест в настоящем headless Chromium: загрузка, старт матча, десант, стрельба.
// Требует puppeteer-core + @sparticuz/chromium (ставятся локально, в git не нужны).
//   node tools/browser-check.mjs [url]

import puppeteer from 'puppeteer-core';
import chromiumPkg from '@sparticuz/chromium';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { brotliDecompressSync } from 'node:zlib';
import { readFileSync } from 'node:fs';

const chromium = chromiumPkg.default ?? chromiumPkg;

// @sparticuz/chromium рассчитан на AWS Lambda: системных libnspr4/libnss3 нет,
// поэтому распаковываем их из его же архива и подсовываем через LD_LIBRARY_PATH.
if (!existsSync('/tmp/pubg-libs/libnspr4.so')) {
  const tar = '/tmp/pubg-chromium-libs.tar';
  mkdirSync('/tmp/pubg-libs', { recursive: true });
  writeFileSync(tar, brotliDecompressSync(
    readFileSync(new URL('../node_modules/@sparticuz/chromium/bin/al2023.tar.br', import.meta.url)),
  ));
  execFileSync('tar', ['xf', tar, '-C', '/tmp/pubg-libs', '--strip-components=1']);
  console.log('распакованы системные библиотеки Chromium → /tmp/pubg-libs');
}
process.env.LD_LIBRARY_PATH = `/tmp/pubg-libs:${process.env.LD_LIBRARY_PATH || ''}`;
const url = process.argv[2] || 'http://127.0.0.1:8000/';
const outDir = new URL('../.shots/', import.meta.url).pathname;
mkdirSync(outDir, { recursive: true });

const executablePath = await chromium.executablePath();
const browser = await puppeteer.launch({
  executablePath,
  args: [
    ...chromium.args,
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--window-size=1280,760',
  ],
  defaultViewport: { width: 1280, height: 720 },
  dumpio: false,
});

const errors = [];
const logs = [];
const page = await browser.newPage();
page.on('console', (msg) => {
  const text = `${msg.type()}: ${msg.text()}`;
  logs.push(text);
  if (msg.type() === 'error') errors.push(text);
});
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
page.on('requestfailed', (req) => errors.push(`requestfailed: ${req.url()} ${req.failure()?.errorText}`));

await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
await new Promise((r) => setTimeout(r, 2500));

const hasGame = await page.evaluate(() => !!window.__pubg);
console.log('игра создана:', hasGame);
await page.screenshot({ path: outDir + '01-menu.png' });

// старт матча
await page.click('#startBtn');
await new Promise((r) => setTimeout(r, 2500));
let state = await page.evaluate(() => ({
  state: window.__pubg?.state,
  paused: window.__pubg?.paused,
  bots: window.__pubg?.bots?.total,
  loot: window.__pubg?.loot?.remaining,
  drawCalls: window.__pubg?.renderer?.info?.render?.calls,
  triangles: window.__pubg?.renderer?.info?.render?.triangles,
  fpsHint: window.__pubg?.frameNow,
}));
console.log('после старта:', state);
await page.screenshot({ path: outDir + '02-plane.png' });

// прыжок из самолёта
await page.keyboard.press('KeyF');
await new Promise((r) => setTimeout(r, 4000));
state = await page.evaluate(() => ({
  state: window.__pubg?.state,
  y: Math.round(window.__pubg?.player?.pos?.y),
  hp: Math.round(window.__pubg?.player?.hp),
  drawCalls: window.__pubg?.renderer?.info?.render?.calls,
}));
console.log('десант:', state);
await page.screenshot({ path: outDir + '03-freefall.png' });

// ждём приземления
for (let i = 0; i < 12; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  const s = await page.evaluate(() => window.__pubg?.state);
  if (s === 'playing') break;
}
state = await page.evaluate(() => ({
  state: window.__pubg?.state,
  hp: Math.round(window.__pubg?.player?.hp),
  onGround: window.__pubg?.player?.grounded,
  nearLoot: window.__pubg?.nearLoot?.label || null,
  zone: Math.round(window.__pubg?.zone?.radius || 0),
  alive: 1 + (window.__pubg?.bots?.aliveCount || 0),
  drawCalls: window.__pubg?.renderer?.info?.render?.calls,
  triangles: window.__pubg?.renderer?.info?.render?.triangles,
}));
console.log('на земле:', state);
await page.screenshot({ path: outDir + '04-ground.png' });

// попробуем подобрать лут и пострелять
await page.keyboard.press('KeyF');
await page.keyboard.down('KeyW');
await new Promise((r) => setTimeout(r, 900));
await page.keyboard.up('KeyW');
await page.mouse.move(640, 360);
await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: outDir + '05-hud.png' });

// открыть карту
await page.keyboard.press('KeyM');
await new Promise((r) => setTimeout(r, 500));
const mapOpen = await page.evaluate(() => !document.getElementById('fullmap').classList.contains('hidden'));
await page.screenshot({ path: outDir + '06-map.png' });
console.log('карта открывается:', mapOpen);
await page.keyboard.press('KeyM');

const fps = await page.evaluate(async () => {
  const t0 = performance.now();
  let frames = 0;
  await new Promise((resolve) => {
    const tick = () => {
      frames++;
      if (performance.now() - t0 > 2000) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  return Math.round((frames * 1000) / (performance.now() - t0));
});
console.log('FPS (software rendering):', fps);

await browser.close();

if (errors.length) {
  console.log('\n❌ ошибки в консоли:');
  for (const e of [...new Set(errors)].slice(0, 25)) console.log('  -', e);
  process.exit(1);
}
if (!hasGame) {
  console.log('\n❌ игра не создалась');
  process.exit(1);
}
console.log('\n✅ браузерный тест пройден, скриншоты в .shots/');
