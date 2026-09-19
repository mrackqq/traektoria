/**
 * Шкалы экзаменов и оценок.
 *
 * Балл — это не просто число: у каждой шкалы свой диапазон и свой шаг.
 * Проверка шага сделана через целочисленное масштабирование именно потому,
 * что остаток от деления на дробный шаг в двоичной арифметике врёт
 * (`6.5 % 0.5` не ноль). Здесь это и закрепляется.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { checkScaleValue, findScale, scaleForExam, stepAttr, SCALES } from './scales.ts';

test('Каждая шкала описана непротиворечиво', () => {
  for (const s of SCALES) {
    assert.ok(s.min < s.max, `${s.id}: минимум обязан быть меньше максимума`);
    assert.ok(s.step > 0, `${s.id}: шаг обязан быть положительным`);
    assert.ok(s.id.length > 0);
  }
});

test('Идентификаторы шкал уникальны', () => {
  const ids = SCALES.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('Шкала находится по идентификатору и по экзамену', () => {
  assert.equal(findScale('ielts_0_9')?.id, 'ielts_0_9');
  assert.equal(scaleForExam('IELTS')?.id, 'ielts_0_9');
  assert.equal(scaleForExam('ЕНТ')?.id, 'ent_0_140');
});

test('Неизвестная шкала и неизвестный экзамен дают undefined, а не выдуманное значение', () => {
  assert.equal(findScale('нет-такой'), undefined);
  assert.equal(scaleForExam('НЕТ-ТАКОГО'), undefined);
});

test('Неизвестная шкала при проверке значения — отдельная проблема', () => {
  const p = checkScaleValue('нет-такой', 5, 'Балл');
  assert.equal(p?.code, 'UNKNOWN_SCALE');
});

test('Нечисловое значение отвергается раньше проверки диапазона', () => {
  for (const v of [Number.NaN, Infinity, -Infinity]) {
    const p = checkScaleValue('ielts_0_9', v, 'Балл');
    assert.equal(p?.code, 'NOT_A_NUMBER', `${v} обязано быть отвергнуто как не число`);
  }
});

test('Границы диапазона допустимы, а выход за них — нет', () => {
  assert.equal(checkScaleValue('ielts_0_9', 0, 'Балл'), null, 'нижняя граница входит в диапазон');
  assert.equal(checkScaleValue('ielts_0_9', 9, 'Балл'), null, 'верхняя тоже');

  assert.equal(checkScaleValue('ielts_0_9', -0.5, 'Балл')?.code, 'OUT_OF_RANGE');
  assert.equal(checkScaleValue('ielts_0_9', 9.5, 'Балл')?.code, 'OUT_OF_RANGE');
});

test('Шаг шкалы проверяется без ловушек двоичной арифметики', () => {
  // 6.5 и 7.5 кратны 0.5, хотя остаток от деления в double это отрицает.
  for (const v of [6.5, 7.5, 0.5, 8.5]) {
    assert.equal(checkScaleValue('ielts_0_9', v, 'Балл'), null, `${v} кратно шагу 0.5`);
  }
  assert.equal(checkScaleValue('ielts_0_9', 7.33, 'Балл')?.code, 'BAD_STEP');
  assert.equal(checkScaleValue('ielts_0_9', 6.25, 'Балл')?.code, 'BAD_STEP');
});

test('Целочисленные шкалы не принимают дробное', () => {
  assert.equal(checkScaleValue('ent_0_140', 100, 'Балл'), null);
  assert.equal(checkScaleValue('ent_0_140', 100.5, 'Балл')?.code, 'BAD_STEP');
});

test('Шкала с шагом больше единицы проверяется наравне с остальными', () => {
  // Прежняя формула множителя `Math.round(1 / step)` обращалась в ноль при
  // шаге 10, сравнение уходило в NaN и молча пропускало любой балл в
  // диапазоне — включая несуществующие в природе значения SAT.
  assert.equal(checkScaleValue('sat_400_1600', 1240, 'Балл'), null);
  assert.equal(checkScaleValue('sat_400_1600', 400, 'Балл'), null, 'нижняя граница кратна шагу');
  assert.equal(checkScaleValue('sat_400_1600', 1600, 'Балл'), null, 'верхняя тоже');

  assert.equal(checkScaleValue('sat_400_1600', 1245, 'Балл')?.code, 'BAD_STEP');
  assert.equal(checkScaleValue('sat_400_1600', 1241, 'Балл')?.code, 'BAD_STEP');
  assert.equal(checkScaleValue('sat_400_1600', 390, 'Балл')?.code, 'OUT_OF_RANGE');
});

test('Кратность отсчитывается от минимума шкалы, а не от нуля', () => {
  // У ACT отсчёт начинается с 1: значения 1, 2, 3 корректны, и «кратно нулю»
  // здесь не имеет смысла.
  assert.equal(checkScaleValue('act_1_36', 1, 'Балл'), null);
  assert.equal(checkScaleValue('act_1_36', 26, 'Балл'), null);
  assert.equal(checkScaleValue('act_1_36', 26.5, 'Балл')?.code, 'BAD_STEP');
});

test('Средний балл аттестата: сотые допустимы, ниже двух — нет', () => {
  assert.equal(checkScaleValue('gpa_5', 4.75, 'Средний балл'), null);
  assert.equal(checkScaleValue('gpa_5', 1.99, 'Средний балл')?.code, 'OUT_OF_RANGE');
  assert.equal(checkScaleValue('gpa_5', 7, 'Средний балл')?.code, 'OUT_OF_RANGE');
});

test('Сообщение о проблеме называет проверяемую величину', () => {
  const p = checkScaleValue('ielts_0_9', 99, 'Общий балл');
  assert.match(p!.message, /Общий балл/, 'по тексту должно быть понятно, что именно не так');
});

test('Атрибут шага для формы берётся из шкалы', () => {
  assert.equal(stepAttr('ielts_0_9'), '0.5');
  assert.equal(stepAttr('ent_0_140'), '1');
  assert.equal(stepAttr('нет-такой'), 'any', 'для неизвестной шкалы форма не ограничивает ввод');
});
