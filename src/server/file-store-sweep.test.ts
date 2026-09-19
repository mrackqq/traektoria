/**
 * Уборка временных файлов, брошенных прошлым запуском.
 *
 * Отдельный файл нужен по существу: уборка выполняется один раз за процесс,
 * чтобы не читать каталог на каждой записи. В общем файле с остальными
 * тестами хранилища она успевала отработать на первой же записи, и проверять
 * было бы уже нечего. `node --test` даёт каждому файлу свой процесс.
 */

import { mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';

const dataDir = await mkdtemp(path.join(tmpdir(), 'trajectory-sweep-'));
process.env.TRAJECTORY_DATA_DIR = dataDir;

const { getStore } = await import('./file-store.ts');
const store = getStore();

after(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

test('Брошенный временный файл убирается, свежий чужой — остаётся', async () => {
  const stale = path.join(dataDir, 'owner-a.json.9999.1700000000000.tmp');
  const fresh = path.join(dataDir, 'owner-b.json.8888.1700000000001.tmp');
  await writeFile(stale, '{}', 'utf8');
  await writeFile(fresh, '{}', 'utf8');

  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  await utimes(stale, twoHoursAgo, twoHoursAgo);

  await store.transact('owner-sweeper', (s) => ({ kind: 'commit', next: s, result: null }));

  const left = await readdir(dataDir);
  assert.ok(
    !left.includes(path.basename(stale)),
    'файл, брошенный прошлым запуском, копился бы на диске вечно',
  );
  assert.ok(
    left.includes(path.basename(fresh)),
    'свежий временный файл может прямо сейчас писать соседний процесс — трогать его нельзя',
  );
});

test('Успешная запись не оставляет собственный временный файл', async () => {
  await store.transact('owner-clean', (s) => ({
    kind: 'commit',
    next: { ...s, audit: [...s.audit, { n: 1 } as never] },
    result: null,
  }));

  const tmpLeft = (await readdir(dataDir)).filter((f) => f.startsWith('owner-clean.json.'));
  assert.deepEqual(tmpLeft, [], 'после переименования временного файла остаться не должно');
});
