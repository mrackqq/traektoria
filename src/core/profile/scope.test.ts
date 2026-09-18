/**
 * Граница продукта: где сервис честно отказывается считать.
 *
 * Правило одно: если правила приёма мы не проверяли по источникам, лучше
 * сказать об этом прямо, чем выдать правдоподобный чужой маршрут. Молчаливый
 * школьный план выпускнику колледжа — худший из возможных ответов.
 *
 * Запуск: npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildEmptyProfile } from '../demo/profile.ts';
import { known, unanswered } from '../kernel/profile.ts';
import { outOfScope } from './scope.ts';

const AT = '2026-09-18T09:00:00.000Z';
const base = buildEmptyProfile(AT, 'test-owner');

const schoolLeaver = {
  ...base,
  educationLevel: known('grade_11' as const),
  citizenship: known('KZ'),
  applicantCategory: known('kz_citizen'),
};

test('Школьник и выпускник школы остаются внутри области', () => {
  assert.equal(outOfScope(schoolLeaver), null);
  assert.equal(outOfScope({ ...schoolLeaver, educationLevel: known('grade_10' as const) }), null);
  assert.equal(outOfScope({ ...schoolLeaver, educationLevel: known('school_graduate' as const) }), null);
});

test('Незаполненный профиль отказа не получает', () => {
  // Пока человек не ответил, отказывать не за что.
  assert.equal(outOfScope(base), null);
});

test('Колледж получает отказ с названной причиной', () => {
  for (const level of ['college_student', 'college_graduate'] as const) {
    const limit = outOfScope({ ...schoolLeaver, educationLevel: known(level) });

    assert.ok(limit, `отказ для ${level}`);
    assert.equal(limit.id, 'college');
    assert.match(limit.message, /сокращённые образовательные программы/);
    assert.match(limit.message, /не сверяли эти правила/);
    assert.match(limit.whatWeCanDo, /Ответы сохранены/);
  }
});

test('Иностранный заявитель получает свой отказ', () => {
  const byCitizenship = outOfScope({ ...schoolLeaver, citizenship: known('TR') });
  assert.equal(byCitizenship?.id, 'foreign_applicant');
  assert.match(byCitizenship?.message ?? '', /не через ЕНТ/);

  const byCategory = outOfScope({ ...schoolLeaver, applicantCategory: known('foreign') });
  assert.equal(byCategory?.id, 'foreign_applicant');

  // Вузы со своим отбором иностранцу по-прежнему считаются.
  assert.match(byCitizenship?.whatWeCanDo ?? '', /Nazarbayev/);
});

test('Колледж важнее гражданства: показывается один отказ, а не два', () => {
  const limit = outOfScope({
    ...schoolLeaver,
    educationLevel: known('college_graduate' as const),
    citizenship: known('TR'),
  });

  assert.equal(limit?.id, 'college');
});

test('Неуказанное гражданство отказом не считается', () => {
  assert.equal(outOfScope({ ...schoolLeaver, citizenship: unanswered() }), null);
});
