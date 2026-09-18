/**
 * NFR-08 / REV-26 — согласование чисел в русском тексте.
 *
 * Ревью ТЗ назвало это дырой: числовые плейсхолдеры подставляются
 * «серверным шаблоном», но правил множественного числа документ не задаёт.
 * Здесь они заданы и закреплены тестом, включая случаи 11–14, на которых
 * наивная реализация («если оканчивается на 1 — one») ломается.
 *
 * Запуск: npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  countRu,
  formatNumberRu,
  pluralCategoryRu,
  pluralRu,
  FORMS_DAY,
  FORMS_TASK,
  FORMS_YEAR,
} from './plural.ts';

test('Категории one / few / many совпадают с правилом ICU для русского', () => {
  const expected: Array<[number, 'one' | 'few' | 'many']> = [
    [0, 'many'],
    [1, 'one'],
    [2, 'few'],
    [4, 'few'],
    [5, 'many'],
    [10, 'many'],
    // Ловушка: 11–14 — many, хотя оканчиваются на 1–4.
    [11, 'many'],
    [12, 'many'],
    [13, 'many'],
    [14, 'many'],
    [21, 'one'],
    [22, 'few'],
    [25, 'many'],
    [101, 'one'],
    [111, 'many'],
    [112, 'many'],
  ];

  for (const [n, category] of expected) {
    assert.equal(pluralCategoryRu(n), category, `${n} должно быть ${category}`);
  }
});

test('Слово согласуется с числом', () => {
  assert.equal(pluralRu(1, FORMS_YEAR), 'год');
  assert.equal(pluralRu(4, FORMS_YEAR), 'года');
  assert.equal(pluralRu(5, FORMS_YEAR), 'лет');
  assert.equal(pluralRu(11, FORMS_YEAR), 'лет');

  assert.equal(countRu(1, FORMS_TASK), '1 задача');
  assert.equal(countRu(2, FORMS_TASK), '2 задачи');
  assert.equal(countRu(5, FORMS_TASK), '5 задач');
  assert.equal(countRu(21, FORMS_DAY), '21 день');
  assert.equal(countRu(14, FORMS_DAY), '14 дней');
});

test('Отрицательные и нулевые значения не ломают согласование', () => {
  assert.equal(pluralRu(0, FORMS_DAY), 'дней');
  assert.equal(pluralRu(-1, FORMS_DAY), 'день');
  assert.equal(pluralRu(-3, FORMS_DAY), 'дня');
});

test('NFR-08: разряды и дробная часть по русским правилам', () => {
  assert.equal(formatNumberRu(1000), '1 000');
  assert.equal(formatNumberRu(1234567), '1 234 567');
  assert.equal(formatNumberRu(4.5), '4,50');
  assert.equal(formatNumberRu(-1500), '−1 500');
  assert.equal(formatNumberRu(Number.NaN), '—', 'нечисло не печатается как NaN');
});
