/**
 * DATA-05 — свежесть источника.
 *
 * Правило простое по формулировке и коварное по границам: чем ближе срок,
 * тем короче допустимый возраст проверки. Здесь закреплены именно границы,
 * потому что ошибка в них не видна на глаз — данные просто тихо считаются
 * свежими дольше, чем следует.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeFreshness,
  sourceAgeDays,
  FRESHNESS_POLICY_DAYS,
  NEAR_DEADLINE_WINDOW_DAYS,
  type Source,
} from './types.ts';

const NOW = '2027-06-01T00:00:00.000Z';

const source = (over: Partial<Source> = {}): Source =>
  ({
    id: 's1',
    title: 'Правила приёма',
    url: 'https://example.kz',
    publisher: 'Вуз',
    dataKind: 'general',
    retrievedAt: NOW,
    verifiedAt: NOW,
    verifiedBy: 'demo',
    freshness: 'fresh',
    isDemo: true,
    ...over,
  }) as Source;

/** Источник, проверенный N дней назад относительно NOW. */
const verifiedDaysAgo = (days: number, over: Partial<Source> = {}): Source =>
  source({ verifiedAt: new Date(Date.parse(NOW) - days * 86_400_000).toISOString(), ...over });

test('Отозванный источник остаётся отозванным независимо от возраста', () => {
  assert.equal(computeFreshness(verifiedDaysAgo(0, { freshness: 'retracted' }), NOW), 'retracted');
});

test('Свежий и просроченный источник различаются по виду данных', () => {
  // Сроки и обязательные требования протухают за неделю, стоимость — за месяц.
  assert.equal(computeFreshness(verifiedDaysAgo(10, { dataKind: 'deadline' }), NOW), 'stale');
  assert.equal(computeFreshness(verifiedDaysAgo(10, { dataKind: 'cost' }), NOW), 'fresh');
  assert.equal(FRESHNESS_POLICY_DAYS.deadline, 7);
  assert.equal(FRESHNESS_POLICY_DAYS.cost, 30);
});

test('Возраст ровно по политике ещё считается свежим', () => {
  assert.equal(computeFreshness(verifiedDaysAgo(7, { dataKind: 'deadline' }), NOW), 'fresh');
  assert.equal(
    computeFreshness(verifiedDaysAgo(8, { dataKind: 'deadline' }), NOW),
    'stale',
    'на сутки старше политики — уже устарело',
  );
});

test('Непарсящиеся даты дают «устарело», а не «свежо»', () => {
  // Осторожность в нужную сторону: неизвестный возраст не выдаётся за свежесть.
  assert.equal(computeFreshness(source({ verifiedAt: 'не дата' }), NOW), 'stale');
  assert.equal(computeFreshness(source(), 'не дата'), 'stale');
});

test('DATA-05: у близкого срока окно сжимается до суток', () => {
  const s = verifiedDaysAgo(10, { dataKind: 'cost' });
  assert.equal(computeFreshness(s, NOW), 'fresh', 'без дедлайна месячная политика ещё действует');
  assert.equal(
    computeFreshness(s, NOW, '2027-06-20'),
    'stale',
    'до срока 19 дней — проверка десятидневной давности уже недостаточна',
  );
});

test('DATA-05: только что прошедший срок ужесточает политику так же, как наступающий', () => {
  // Момент сразу после отсечки — как раз тот, когда абитуриент сверяет,
  // успел он или нет. Прежде окно работало только «вперёд», и ровно здесь
  // ужесточение снималось, хотя цена ошибки максимальна.
  const s = verifiedDaysAgo(10, { dataKind: 'cost' });
  assert.equal(computeFreshness(s, NOW, '2027-05-30'), 'stale', 'срок прошёл два дня назад');
  assert.equal(computeFreshness(s, NOW, '2027-04-01'), 'fresh', 'срок прошёл 61 день назад — окно не действует');
});

test('Границы окна близости к сроку', () => {
  const s = verifiedDaysAgo(10, { dataKind: 'cost' });
  const plus = (days: number) =>
    new Date(Date.parse(NOW) + days * 86_400_000).toISOString().slice(0, 10);

  assert.equal(computeFreshness(s, NOW, plus(NEAR_DEADLINE_WINDOW_DAYS)), 'stale', 'ровно 30 дней — внутри окна');
  assert.equal(computeFreshness(s, NOW, plus(NEAR_DEADLINE_WINDOW_DAYS + 1)), 'fresh', '31 день — вне окна');
  assert.equal(computeFreshness(s, NOW, plus(-NEAR_DEADLINE_WINDOW_DAYS)), 'stale', '30 дней назад — внутри окна');
  assert.equal(computeFreshness(s, NOW, plus(-NEAR_DEADLINE_WINDOW_DAYS - 1)), 'fresh', '31 день назад — вне окна');
});

test('Возраст источника не бывает отрицательным', () => {
  const future = source({ verifiedAt: '2027-12-01T00:00:00.000Z' });
  assert.equal(sourceAgeDays(future, NOW), 0, 'проверка «в будущем» не должна давать отрицательный возраст');
  assert.equal(sourceAgeDays(verifiedDaysAgo(10), NOW), 10);
  assert.equal(sourceAgeDays(verifiedDaysAgo(0), NOW), 0);
});
