#!/usr/bin/env node
// Быстрые проверки проекта без браузера:
//  1) все ES-модули импортируются без синтаксических ошибок;
//  2) каждый id, который ищет JS, реально есть в index.html;
//  3) ссылки из index.html ведут на существующие файлы;
//  4) в проекте нет внешних CDN-запросов (игра должна работать офлайн).

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const notes = [];

// 1. модули
const modules = readdirSync(join(root, 'js')).filter((f) => f.endsWith('.js'));
// main.js — точка входа для браузера, ей нужен DOM: проверяем только синтаксис
for (const file of modules) {
  if (file === 'main.js') {
    try {
      execFileSync(process.execPath, ['--check', join(root, 'js', file)], { stdio: 'pipe' });
    } catch (err) {
      problems.push(`js/${file}: синтаксическая ошибка — ${String(err.stderr || err.message)}`);
    }
    continue;
  }
  try {
    await import(pathToFileURL(join(root, 'js', file)).href);
  } catch (err) {
    problems.push(`js/${file}: ошибка импорта — ${err.message}`);
  }
}
notes.push(`модулей проверено: ${modules.length}`);

// 2. id из разметки
const html = readFileSync(join(root, 'index.html'), 'utf8');
const htmlIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
const used = new Set();
for (const file of modules) {
  const src = readFileSync(join(root, 'js', file), 'utf8');
  for (const m of src.matchAll(/\$\('([^']+)'\)/g)) used.add(m[1]);
  for (const m of src.matchAll(/getElementById\('([^']+)'\)/g)) used.add(m[1]);
}
for (const id of used) {
  if (!htmlIds.has(id)) problems.push(`id="${id}" используется в JS, но отсутствует в index.html`);
}
notes.push(`id в разметке: ${htmlIds.size}, используется из JS: ${used.size}`);

// 3. ссылки на файлы
for (const m of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
  const path = m[1];
  if (/^(data:|https?:)/.test(path)) continue;
  if (!existsSync(join(root, path))) problems.push(`index.html ссылается на несуществующий ${path}`);
}

// 4. внешние зависимости
const external = [];
for (const file of modules) {
  const src = readFileSync(join(root, 'js', file), 'utf8');
  for (const m of src.matchAll(/(?:from|import)\s*['"](https?:\/\/[^'"]+)['"]/g)) external.push(`${file} → ${m[1]}`);
}
for (const m of html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)) external.push(`index.html → ${m[1]}`);
if (external.length) problems.push(`внешние запросы (должно быть офлайн): ${external.join(', ')}`);

// размер проекта
let bytes = 0, count = 0;
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    if (name === '.git' || name === 'node_modules') continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else { bytes += st.size; count++; }
  }
};
walk(root);
notes.push(`файлов: ${count}, суммарно ${(bytes / 1024 / 1024).toFixed(2)} МБ (включая three.js)`);

console.log('— проверка PUBG Web Edition —');
for (const n of notes) console.log('  •', n);
if (problems.length) {
  console.log('\n❌ проблемы:');
  for (const p of problems) console.log('  -', p);
  process.exit(1);
}
console.log('\n✅ всё чисто');
