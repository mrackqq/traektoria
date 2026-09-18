/**
 * Совместимость со сводками, записанными до появления `firstTime`.
 *
 * Новые сводки различают первое заполнение и правку существующего ответа,
 * старые — нет. Без досчёта старое первое заполнение показывалось как
 * «было „не заполнено“, стало „2027“», то есть как дефект профиля.
 *
 * Досчёт идёт только по тому, что в старой записи уже было: по тексту
 * прежнего ответа. Ничего не пересчитывается заново и не переписывается.
 *
 * Запуск: npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeRecalcSummary,
  type LegacyProfileFieldChange,
  type LegacyRecalcSummary,
} from './changes.ts';

/** Сводка прежнего формата: поля те же, `firstTime` в изменениях нет. */
function legacy(changes: readonly LegacyProfileFieldChange[]): LegacyRecalcSummary {
  return {
    at: '2026-09-18T09:00:00Z',
    profileRevisionBefore: 3,
    profileRevisionAfter: 4,
    changes,

    fitBefore: 2,
    fitAfter: 3,
    alternativesBefore: 1,
    alternativesAfter: 1,
    topBefore: 'Computer Science — SDU',
    topAfter: 'Computer Science — NU',

    activeGoalTitle: null,
    activeGoalStillFits: null,
    activeGoalNote: null,

    tasksBefore: 4,
    tasksAfter: 5,
    nextActionBefore: 'Подать заявление',
    nextActionAfter: 'Сдать ЕНТ',

    notes: ['Подходящих вариантов стало больше на 1.'],
  };
}

test('Старая сводка первого заполнения: «не заполнено» распознаётся', () => {
  const normalized = normalizeRecalcSummary(
    legacy([{ fieldId: 'admissionYear', label: 'Год поступления', before: 'не заполнено', after: '2027' }]),
  );

  assert.ok(normalized);
  assert.equal(normalized.changes[0]?.firstTime, true, 'ответа раньше не было');
  assert.equal(normalized.changes[0]?.after, '2027', 'сам ответ не изменился');
});

test('Старая сводка обычной правки остаётся правкой', () => {
  const normalized = normalizeRecalcSummary(
    legacy([{ fieldId: 'admissionYear', label: 'Год поступления', before: '2027', after: '2028' }]),
  );

  assert.equal(normalized?.changes[0]?.firstTime, false, 'прежний ответ был');
});

test('«Не знаю» и «не применимо» — это ответы, а не пустота', () => {
  const normalized = normalizeRecalcSummary(
    legacy([
      { fieldId: 'gpa', label: 'Средний балл', before: 'не знаю', after: '4.6' },
      { fieldId: 'englishCefr', label: 'Уровень английского', before: 'не применимо', after: 'B2' },
    ]),
  );

  assert.equal(normalized?.changes[0]?.firstTime, false, '«не знаю» был ответом');
  assert.equal(normalized?.changes[1]?.firstTime, false, '«не применимо» был ответом');
});

test('Явно заданный признак сохраняется без изменения', () => {
  const normalized = normalizeRecalcSummary(
    legacy([
      // Текст «не заполнено» при явном false ничего не переопределяет.
      { fieldId: 'a', label: 'A', before: 'не заполнено', after: '1', firstTime: false },
      { fieldId: 'b', label: 'B', before: '2027', after: '2028', firstTime: true },
    ]),
  );

  assert.equal(normalized?.changes[0]?.firstTime, false, 'явный false остаётся false');
  assert.equal(normalized?.changes[1]?.firstTime, true, 'явный true остаётся true');
});

test('Пустой lastRecalc остаётся пустым', () => {
  assert.equal(normalizeRecalcSummary(null), null);
  assert.equal(normalizeRecalcSummary(undefined), null);
});

test('Повторная нормализация даёт тот же результат', () => {
  const once = normalizeRecalcSummary(
    legacy([
      { fieldId: 'admissionYear', label: 'Год поступления', before: 'не заполнено', after: '2027' },
      { fieldId: 'gpa', label: 'Средний балл', before: '4.6', after: '4.8' },
      { fieldId: 'weeklyHours', label: 'Часы в неделю', before: 'не знаю', after: '20' },
    ]),
  );
  const twice = normalizeRecalcSummary(once);

  assert.deepEqual(twice, once, 'второй проход ничего не меняет');
  assert.deepEqual(
    twice?.changes.map((c) => c.firstTime),
    [true, false, false],
  );
});

test('Остальные поля сводки переносятся как есть', () => {
  const before = legacy([
    { fieldId: 'admissionYear', label: 'Год поступления', before: 'не заполнено', after: '2027' },
  ]);
  const normalized = normalizeRecalcSummary(before);

  // Проверка актуальности сводки опирается на эту ревизию — её трогать нельзя.
  assert.equal(normalized?.profileRevisionAfter, before.profileRevisionAfter);
  assert.equal(normalized?.profileRevisionBefore, before.profileRevisionBefore);
  assert.equal(normalized?.topAfter, before.topAfter);
  assert.deepEqual(normalized?.notes, before.notes);
  assert.equal(normalized?.nextActionAfter, before.nextActionAfter);
});
