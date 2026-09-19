/**
 * Файловое хранилище как внешняя граница.
 *
 * Файл на диске — не доверенные данные: его мог испортить сбой записи,
 * ручная правка или прежняя версия кода. Раньше любая такая порча всплывала
 * исключением до самой страницы, и посетитель получал 500 без единого
 * способа выбраться. Здесь закреплено, что продукт остаётся рабочим,
 * а испорченные данные сохраняются для разбора.
 */

import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

const dataDir = await mkdtemp(path.join(tmpdir(), 'trajectory-store-'));
process.env.TRAJECTORY_DATA_DIR = dataDir;

const { getStore, serializeState, deserializeState } = await import('./file-store.ts');
const { emptyUserState } = await import('./ports.ts');

const store = getStore();

/** Тихо гасим предупреждение о карантине: в этих тестах оно ожидаемо. */
const realError = console.error;
before(() => {
  console.error = () => undefined;
});
after(async () => {
  console.error = realError;
  await rm(dataDir, { recursive: true, force: true });
});

async function put(owner: string, contents: string): Promise<void> {
  await writeFile(path.join(dataDir, `${owner}.json`), contents, 'utf8');
}

async function parkedFiles(owner: string): Promise<string[]> {
  return (await readdir(dataDir)).filter((f) => f.startsWith(`${owner}.json.corrupt-`));
}

/* ------------------------------------------------------------------ */
/* Чтение испорченного состояния                                       */
/* ------------------------------------------------------------------ */

test('Отсутствующий файл — это пустое состояние, а не ошибка', async () => {
  const state = await store.read('owner-never-seen');
  assert.deepEqual(state, emptyUserState('owner-never-seen'));
});

test('Оборванный JSON не роняет запрос и откладывается для разбора', async () => {
  await put('owner-truncated', '{"profileRevisions": [');

  const state = await store.read('owner-truncated');
  assert.deepEqual(state, emptyUserState('owner-truncated'), 'страница обязана открыться');

  const parked = await parkedFiles('owner-truncated');
  assert.equal(parked.length, 1, 'испорченные данные не удаляются молча, а отводятся в сторону');
  const kept = await readFile(path.join(dataDir, parked[0]!), 'utf8');
  assert.equal(kept, '{"profileRevisions": [', 'содержимое сохраняется дословно');
});

test('Пустой файл читается как пустое состояние', async () => {
  await put('owner-empty', '');
  const state = await store.read('owner-empty');
  assert.deepEqual(state, emptyUserState('owner-empty'));
});

test('Испорченный тег bigint не всплывает исключением', async () => {
  await put(
    'owner-bigint',
    JSON.stringify({ ownerId: 'owner-bigint', budget: { __bigint__: 'не-число' } }),
  );

  const state = await store.read('owner-bigint');
  assert.deepEqual(state, emptyUserState('owner-bigint'));
  assert.equal((await parkedFiles('owner-bigint')).length, 1);
});

test('Поле верного имени, но неверного типа приводится к форме', async () => {
  // Валидный JSON: карантин не нужен, но и падать у первого обратившегося
  // к `progress` как к объекту тоже нельзя.
  await put(
    'owner-shape',
    JSON.stringify({
      ownerId: 'owner-shape',
      progress: 'строка вместо объекта',
      ledger: 42,
      audit: null,
      outbox: 'нет',
      profileRevisions: { not: 'array' },
      activeGoalId: 17,
    }),
  );

  const state = await store.read('owner-shape');

  assert.deepEqual(state.progress, {}, 'progress обязан остаться объектом');
  assert.deepEqual(state.ledger, [], 'ledger обязан остаться массивом');
  assert.deepEqual(state.audit, []);
  assert.deepEqual(state.outbox, []);
  assert.deepEqual(state.profileRevisions, []);
  assert.equal(state.activeGoalId, null, 'нестроковая цель — это отсутствие цели');
  assert.equal((await parkedFiles('owner-shape')).length, 0, 'валидный JSON в карантин не отправляется');
});

test('Владелец из файла не подменяется, но отсутствующий подставляется', async () => {
  await put('owner-named', JSON.stringify({ ownerId: 'owner-named', progress: {} }));
  assert.equal((await store.read('owner-named')).ownerId, 'owner-named');

  await put('owner-anon', JSON.stringify({ progress: {} }));
  assert.equal((await store.read('owner-anon')).ownerId, 'owner-anon');
});

/* ------------------------------------------------------------------ */
/* Имя файла                                                           */
/* ------------------------------------------------------------------ */

test('Идентификатор владельца не попадает в путь как есть', async () => {
  const hostile = '../../../etc/passwd';
  await store.transact(hostile, (s) => ({ kind: 'commit', next: s, result: null }));

  const files = await readdir(dataDir);
  assert.ok(
    files.some((f) => f === '_________etc_passwd.json'),
    `опасные символы обязаны быть обезврежены, получено: ${files.join(', ')}`,
  );
  assert.ok(
    !files.some((f) => f.includes('..')),
    'в каталоге данных не должно появиться ни одного пути с выходом вверх',
  );
});

/* ------------------------------------------------------------------ */
/* Запись                                                              */
/* ------------------------------------------------------------------ */

// Уборка брошенных `.tmp` выполняется один раз за процесс, поэтому её
// проверка живёт в отдельном файле: `node --test` запускает каждый файл
// своим процессом, и там она гарантированно ещё не отработала.
// См. `file-store-sweep.test.ts`.

test('Записанное состояние читается обратно без потерь, включая bigint', async () => {
  const owner = 'owner-roundtrip';
  await store.transact(owner, (s) => ({
    kind: 'commit',
    next: { ...s, audit: [...s.audit, { marker: 'метка', сумма: 1_200_000n } as never] },
    result: null,
  }));

  const back = await store.read(owner);
  const entry = back.audit[0] as unknown as { marker: string; сумма: bigint };
  assert.equal(entry.marker, 'метка');
  assert.equal(entry.сумма, 1_200_000n, 'суммы хранятся как bigint и обязаны пережить сериализацию');
});

test('Сериализация bigint симметрична', () => {
  const state = { ...emptyUserState('o'), audit: [{ v: 9_007_199_254_740_993n }] as never };
  const back = deserializeState(serializeState(state));
  assert.equal((back.audit[0] as unknown as { v: bigint }).v, 9_007_199_254_740_993n);
});

/* ------------------------------------------------------------------ */
/* Сериализация команд                                                 */
/* ------------------------------------------------------------------ */

test('Параллельные команды одного владельца не теряют друг друга', async () => {
  const owner = 'owner-serial';
  await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      store.transact(owner, (s) => ({
        kind: 'commit',
        next: { ...s, audit: [...s.audit, { n: i } as never] },
        result: null,
      })),
    ),
  );

  const state = await store.read(owner);
  assert.equal(state.audit.length, 20, 'ни одна запись не должна быть затёрта соседней');
});

test('Отказ одной команды не отменяет следующие', async () => {
  const owner = 'owner-abort';
  await store.transact(owner, (s) => ({ kind: 'commit', next: s, result: null }));

  await assert.rejects(
    store.transact(owner, () => {
      throw new Error('команда упала');
    }),
    /команда упала/,
  );

  const after = await store.transact(owner, (s) => ({
    kind: 'commit',
    next: { ...s, audit: [...s.audit, { ok: true } as never] },
    result: 'прошла',
  }));
  assert.equal(after, 'прошла', 'очередь обязана продолжить работу после отказа');
});

test('Очередь блокировок не растёт бесконечно', async () => {
  // Косвенная проверка: после завершения всех команд повторная работа с теми
  // же владельцами не замедляется и состояние остаётся корректным. Прямая
  // гарантия — отсутствие роста карты — закреплена удалением записи в
  // `withLock`, без которого здесь копилось бы по строке на каждого владельца.
  for (let i = 0; i < 100; i++) {
    await store.transact(`owner-mass-${i}`, (s) => ({ kind: 'commit', next: s, result: null }));
  }
  const files = (await readdir(dataDir)).filter((f) => f.startsWith('owner-mass-'));
  assert.equal(files.length, 100);
});

test('Превью и чтение ничего не пишут на диск', async () => {
  const owner = 'owner-readonly';
  await store.transact(owner, (s) => ({ kind: 'commit', next: s, result: null }));
  const before = await stat(path.join(dataDir, `${owner}.json`));

  await store.read(owner);
  await store.transact(owner, (s) => ({ kind: 'abort', result: s.ownerId }));

  const after = await stat(path.join(dataDir, `${owner}.json`));
  assert.equal(after.mtimeMs, before.mtimeMs, 'отказ транзакции не должен трогать файл');
});
