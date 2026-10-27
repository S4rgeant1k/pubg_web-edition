// Мини-карта и большая карта: рельеф, дома, зона, самолёт, игрок.
// Базовая картинка рисуется один раз в offscreen-canvas, дальше только оверлеи.

import { MAP_SIZE, MAP_HALF } from './world.js';
import { clamp } from './util.js';

let sharedBase = null;

export class Minimap {
  constructor(canvas, world, { baseSize = 300 } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.world = world;
    this.baseSize = baseSize;
    if (!sharedBase) sharedBase = buildBase(world, baseSize);
    this.base = sharedBase;
  }

  draw(player, zone, plane, extra = {}) {
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.base, 0, 0, W, H);

    const scale = W / MAP_SIZE;
    const toX = (x) => (x + MAP_HALF) * scale;
    const toY = (z) => (z + MAP_HALF) * scale;

    // безопасная зона и следующая
    if (zone) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, W, H);
      ctx.arc(toX(zone.center.x), toY(zone.center.y), zone.radius * scale, 0, Math.PI * 2, true);
      ctx.fillStyle = 'rgba(40,110,255,0.28)';
      ctx.fill('evenodd');
      ctx.restore();

      ctx.strokeStyle = 'rgba(120,190,255,0.95)';
      ctx.lineWidth = Math.max(1.5, W / 150);
      ctx.beginPath();
      ctx.arc(toX(zone.center.x), toY(zone.center.y), Math.max(1, zone.radius * scale), 0, Math.PI * 2);
      ctx.stroke();

      if (zone.nextRing && zone.nextRing.visible) {
        const nc = zone.state === 'shrink' ? zone.targetCenter : zone.targetCenter;
        const nr = zone.state === 'shrink' ? zone.targetRadius : zone.targetRadius;
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.arc(toX(nc.x), toY(nc.y), Math.max(1, nr * scale), 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // маршрут самолёта
    if (plane && extra.showPlane) {
      ctx.strokeStyle = 'rgba(255,235,150,0.75)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(toX(plane.start.x), toY(plane.start.z));
      ctx.lineTo(toX(plane.end.x), toY(plane.end.z));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#ffe066';
      ctx.beginPath();
      ctx.arc(toX(plane.pos.x), toY(plane.pos.z), Math.max(2, W / 90), 0, Math.PI * 2);
      ctx.fill();
    }

    // аирдроп
    if (extra.airdrop) {
      const { x, z } = extra.airdrop;
      ctx.fillStyle = '#ff4d4d';
      ctx.beginPath();
      ctx.arc(toX(x), toY(z), Math.max(2.5, W / 70), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(toX(x), toY(z), Math.max(5, W / 40), 0, Math.PI * 2);
      ctx.stroke();
    }

    // игрок
    if (player) {
      const px = toX(player.pos.x), py = toY(player.pos.z);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(-player.input.yaw);
      const s = Math.max(4, W / 46);
      ctx.fillStyle = '#ffe36b';
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(0, -s * 1.4);
      ctx.lineTo(s * 0.9, s);
      ctx.lineTo(0, s * 0.4);
      ctx.lineTo(-s * 0.9, s);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }
}

function buildBase(world, size) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const step = MAP_SIZE / size;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = -MAP_HALF + px * step;
      const z = -MAP_HALF + py * step;
      const h = world.heightAt(x, z);
      let r, g, b;
      if (h < 0.15) { r = 32; g = 78; b = 112; }
      else if (h < 1.6) { r = 176; g = 160; b = 118; }
      else if (h > 24) { r = 132; g = 130; b = 122; }
      else {
        const t = clamp((h - 1.6) / 22, 0, 1);
        const v = world.detailNoise(x * 0.01, z * 0.01);
        r = 92 - t * 20 + v * 22;
        g = 122 - t * 16 + v * 24;
        b = 66 - t * 10 + v * 16;
      }
      const i = (py * size + px) * 4;
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // леса
  ctx.fillStyle = 'rgba(46,84,40,0.65)';
  for (const t of world.trees) {
    const px = ((t.x + MAP_HALF) / MAP_SIZE) * size;
    const py = ((t.z + MAP_HALF) / MAP_SIZE) * size;
    ctx.fillRect(px, py, 1.2, 1.2);
  }
  // дома
  const k = size / MAP_SIZE;
  for (const b of world.buildings) {
    const px = ((b.x - b.w / 2 + MAP_HALF) / MAP_SIZE) * size;
    const py = ((b.z - b.d / 2 + MAP_HALF) / MAP_SIZE) * size;
    ctx.fillStyle = '#d9d2c4';
    ctx.fillRect(px, py, Math.max(2, b.w * k), Math.max(2, b.d * k));
    ctx.strokeStyle = 'rgba(70,60,50,0.8)';
    ctx.lineWidth = 0.6;
    ctx.strokeRect(px, py, Math.max(2, b.w * k), Math.max(2, b.d * k));
  }
  // сетка координат
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 8; i++) {
    const p = (size / 8) * i;
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(size, p); ctx.stroke();
  }
  return c;
}
