/**
 * Запуск Next с согласованной папкой сборки.
 *
 * Проблема, которую это решает: `npm run build` писал в `.next-build`, чтобы
 * не драться за `.next` с работающим dev-сервером, а `npm start` искал в
 * `.next` — и продуктовый запуск падал на «Could not find a production build».
 *
 * Теперь папку выбирает одно место, и build со start её разделяют:
 *   NEXT_DIST_DIR задан  → используется он;
 *   не задан             → `.next-build`.
 *
 * Аргументы после имени команды передаются Next как есть, поэтому
 * `npm start -- --port 3012` и `npm run build -- --debug` работают обычным
 * образом.
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const [command, ...forwarded] = process.argv.slice(2);

if (command !== 'build' && command !== 'start' && command !== 'dev') {
  console.error(`next-run: неизвестная команда «${command ?? ''}». Ожидается build, start или dev.`);
  process.exit(1);
}

/**
 * Dev остаётся на `.next`: он должен уметь работать одновременно с продуктовой
 * сборкой, а общая папка — это ровно тот конфликт, от которого мы уходим.
 */
const distDir =
  process.env.NEXT_DIST_DIR ?? (command === 'dev' ? '.next' : '.next-build');

const nextBin = require.resolve('next/dist/bin/next');

const child = spawn(process.execPath, [nextBin, command, ...forwarded], {
  stdio: 'inherit',
  env: { ...process.env, NEXT_DIST_DIR: distDir },
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
