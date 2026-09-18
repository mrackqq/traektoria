/**
 * Стабильность опубликованного каталога.
 *
 * Каталог — набор данных со своей версией, а не слепок часов. Если его
 * метаданные меняются на каждое чтение, вместе с ними меняются
 * `catalogScopeHash` и `inputHash`, а значит и ключ кеша объяснений: продукт
 * делает новый платный запрос на каждый переход между страницами, хотя
 * пользователь ничего не менял. Ровно это здесь и проверяется.
 *
 * Запуск: npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSeedCatalog,
  catalogEpoch,
  catalogVersion,
  CATALOG_REFRESH_PERIOD_MS,
} from './seed.ts';
import { catalogScopeHash } from './types.ts';

const MORNING = '2026-09-18T06:00:00.000Z';
const MINUTE_LATER = '2026-09-18T06:01:00.000Z';
const EVENING = '2026-09-18T21:45:31.284Z';
const NEXT_DAY = '2026-09-19T06:00:00.000Z';

function scope(at: string): string {
  const catalog = buildSeedCatalog(at);
  return catalogScopeHash(catalog, catalog.paths.map((p) => p.id));
}

test('Версия каталога не меняется внутри периода обновления', () => {
  assert.equal(catalogVersion(MORNING), catalogVersion(MINUTE_LATER));
  assert.equal(catalogVersion(MORNING), catalogVersion(EVENING));
  assert.notEqual(catalogVersion(MORNING), catalogVersion(NEXT_DAY));
});

test('Метаданные источников считаются от периода, а не от момента чтения', () => {
  const morning = buildSeedCatalog(MORNING);
  const evening = buildSeedCatalog(EVENING);

  assert.equal(morning.refreshedAt, evening.refreshedAt);
  assert.equal(morning.refreshedAt, catalogEpoch(MORNING));

  for (const [i, source] of morning.sources.entries()) {
    const same = evening.sources[i]!;
    assert.equal(source.id, same.id);
    assert.equal(source.verifiedAt, same.verifiedAt, `verifiedAt источника ${source.id} уехал`);
    assert.equal(source.retrievedAt, same.retrievedAt);
  }

  // Момент чтения по-прежнему записывается: он информационный, но честный.
  assert.equal(morning.snapshotAt, MORNING);
  assert.equal(evening.snapshotAt, EVENING);
  assert.notEqual(morning.snapshotAt, evening.snapshotAt);
});

test('Скоуп-хэш каталога стабилен внутри периода и меняется в следующем', () => {
  assert.equal(scope(MORNING), scope(MINUTE_LATER), 'минута спустя каталог тот же');
  assert.equal(scope(MORNING), scope(EVENING), 'вечером того же дня каталог тот же');
  assert.notEqual(scope(MORNING), scope(NEXT_DAY), 'новый период — новая версия каталога');
});

test('Период обновления — сутки, граница считается по началу периода', () => {
  assert.equal(CATALOG_REFRESH_PERIOD_MS, 86_400_000);

  const justBefore = catalogEpoch('2026-09-18T23:59:59.999Z');
  const justAfter = catalogEpoch('2026-09-19T00:00:00.000Z');
  assert.equal(justBefore, '2026-09-18T00:00:00.000Z');
  assert.equal(justAfter, '2026-09-19T00:00:00.000Z');
});

test('Правка данных каталога инвалидирует версию, не дожидаясь периода', () => {
  // Версия данных вписана в строку версии: изменив её при правке состава,
  // мы получаем новый ключ немедленно.
  assert.match(catalogVersion(MORNING), /^demo-v\d+-2026-09-18$/);
});
