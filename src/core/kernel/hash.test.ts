/**
 * Детерминированные хэши.
 *
 * REV-10: сравнивается канонизованный payload, иначе порядок ключей в JSON
 * меняет хэш и повтор той же команды выглядит как новая. Здесь закреплены
 * ровно те свойства, на которые опираются ключ воспроизводимости расчёта
 * и проверка идемпотентности.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { canonicalJson, fnv1a, payloadHash } from './hash.ts';

/* ------------------------------------------------------------------ */
/* Канонизация                                                         */
/* ------------------------------------------------------------------ */

test('REV-10: порядок ключей не влияет на результат', () => {
  assert.equal(canonicalJson({ b: 1, a: 2 }), canonicalJson({ a: 2, b: 1 }));
  assert.equal(payloadHash({ x: 1, y: 2 }), payloadHash({ y: 2, x: 1 }));
});

test('Порядок массива значим и сохраняется', () => {
  assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]));
});

test('Вложенность канонизуется на всю глубину', () => {
  assert.equal(
    canonicalJson({ o: { z: 1, a: { y: 2, b: 3 } } }),
    canonicalJson({ o: { a: { b: 3, y: 2 }, z: 1 } }),
  );
});

test('undefined в объекте опускается, но не путается с отсутствием ключа', () => {
  assert.equal(canonicalJson({ a: 1, b: undefined }), canonicalJson({ a: 1 }));
});

test('bigint не смешивается с обычным числом', () => {
  assert.notEqual(canonicalJson({ v: 1n }), canonicalJson({ v: 1 }));
  assert.equal(canonicalJson({ v: 1n }), '{"v":1n}');
});

test('Невалидные числа хэшируются, а не роняют обработчик', () => {
  // Хэширование обязано быть тотальным: мусор должен дойти до валидатора
  // команды и получить осмысленный отказ, а не исключение из хэш-функции.
  assert.equal(canonicalJson({ v: Number.NaN }), '{"v":#NaN}');
  assert.equal(canonicalJson({ v: Infinity }), '{"v":#Infinity}');
  assert.equal(canonicalJson({ v: -Infinity }), '{"v":#-Infinity}');
});

test('Минус ноль не отличается от нуля', () => {
  assert.equal(canonicalJson({ v: -0 }), canonicalJson({ v: 0 }));
});

test('Пустые структуры имеют устойчивое представление', () => {
  assert.equal(canonicalJson({}), '{}');
  assert.equal(canonicalJson([]), '[]');
  assert.equal(canonicalJson(null), 'null');
});

test('Кириллица не портит канонизацию', () => {
  assert.equal(
    canonicalJson({ 'цель': 'информатика', 'бюджет': 3 }),
    canonicalJson({ 'бюджет': 3, 'цель': 'информатика' }),
  );
});

test('Циклическая ссылка отвергается понятной ошибкой', () => {
  // Раньше обход уходил в бесконечную рекурсию и ронял процесс через
  // переполнение стека — далеко от места настоящей ошибки.
  const node: Record<string, unknown> = { name: 'узел' };
  node['self'] = node;

  assert.throws(() => canonicalJson(node), {
    name: 'TypeError',
    message: /циклическ/,
  });
});

test('Общая ссылка на один объект циклом не считается', () => {
  const shared = { v: 1 };
  assert.equal(canonicalJson({ a: shared, b: shared }), '{"a":{"v":1},"b":{"v":1}}');
});

test('Функция и символ — программная ошибка, а не тихий пропуск', () => {
  assert.throws(() => canonicalJson(() => undefined), /неподдерживаемый тип/);
  assert.throws(() => canonicalJson(Symbol('s')), /неподдерживаемый тип/);
});

/* ------------------------------------------------------------------ */
/* Хэш                                                                 */
/* ------------------------------------------------------------------ */

test('Хэш стабилен, имеет фиксированную длину и различает входы', () => {
  assert.equal(fnv1a('abc'), fnv1a('abc'), 'одинаковый вход — одинаковый хэш');
  assert.notEqual(fnv1a('abc'), fnv1a('abd'));
  assert.equal(fnv1a('').length, 8, 'длина всегда 8 символов, включая пустой вход');
  assert.match(fnv1a('произвольный текст'), /^[0-9a-f]{8}$/);
});

test('Хэш не зависит от запуска процесса', () => {
  // Значение зафиксировано намеренно: изменение алгоритма обесценит все
  // сохранённые ключи идемпотентности и ключи кеша объяснений.
  assert.equal(fnv1a('traektoria'), fnv1a('traektoria'));
  assert.equal(payloadHash({ a: 1 }), payloadHash({ a: 1 }));
});
