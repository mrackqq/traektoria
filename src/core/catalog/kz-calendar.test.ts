/**
 * Национальный календарь приёма: порядок событий и его последствия.
 *
 * Главное, что здесь проверяется, — не сами числа, а связи между ними:
 * заявление на грант подаётся ПОСЛЕ основного ЕНТ и ДО итогов конкурса,
 * августовский этап в конкурс не идёт, творческий экзамен для грантников
 * закрывается раньше подачи заявления. На этих связях держится маршрут.
 *
 * Запуск: npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ADMISSION_STEPS,
  CALENDAR_REFERENCE_YEAR,
  ENT_STAGES,
  GRANT_APPLICATION_CHOICES,
  admissionCalendar,
  grantEligibleStage,
} from './kz-rules.ts';

function step(id: string) {
  const found = ADMISSION_STEPS.find((s) => s.id === id);
  assert.ok(found, `шаг ${id} есть в календаре`);
  return found;
}

test('В конкурс на грант идёт ровно один этап ЕНТ — основной', () => {
  const forGrant = ENT_STAGES.filter((s) => s.countsForGrant);

  assert.equal(forGrant.length, 1, 'единственный этап для гранта');
  assert.equal(forGrant[0]?.id, 'main');
  assert.equal(grantEligibleStage().attempts, 2, 'на основном этапе две попытки');
});

test('Августовский этап — только для платного отделения', () => {
  const august = ENT_STAGES.find((s) => s.id === 'august');

  assert.equal(august?.countsForGrant, false);
  assert.match(august?.note ?? '', /платного/);
});

test('Профильные предметы между попытками не меняются', () => {
  assert.match(grantEligibleStage().note, /менять нельзя/);
});

test('Заявление на грант стоит между ЕНТ и итогами конкурса', () => {
  const main = grantEligibleStage();
  const application = step('grant-application');
  const results = step('grant-results');

  // Подача открывается после того, как основной этап закончился.
  assert.ok(
    application.window.from >= main.testing.to,
    `подача ${application.window.from} не раньше конца ЕНТ ${main.testing.to}`,
  );
  assert.ok(
    results.window.from > application.window.to,
    'итоги подводятся после закрытия подачи',
  );
});

test('Творческий и специальный экзамены закрываются до подачи заявления', () => {
  const application = step('grant-application');

  for (const id of ['creative-exam', 'special-exam']) {
    assert.ok(
      step(id).window.to <= application.window.to,
      `${id} успевает к закрытию подачи на грант`,
    );
  }
});

test('Зачисление продолжается после итогов конкурса', () => {
  const enrollment = step('enrollment');
  const results = step('grant-results');

  assert.ok(enrollment.window.to > results.window.to, 'после итогов есть время отнести оригиналы');
  assert.equal(enrollment.appliesTo, 'everyone', 'окно общее для гранта и платного');
});

test('Заявление на грант — четыре строки по приоритету', () => {
  assert.equal(GRANT_APPLICATION_CHOICES, 4);
  assert.match(step('grant-application').note, /по приоритетам/);
});

test('Проходной балл не обещается: он известен только на итогах', () => {
  assert.match(step('grant-results').note, /зависит от числа грантов и результатов всех участников/);
});

test('Календарь эталонного года подтверждён, остальных — предварителен', () => {
  const reference = admissionCalendar(CALENDAR_REFERENCE_YEAR);
  assert.ok(reference.every((d) => !d.preliminary), 'даты своего цикла подтверждены');

  const next = admissionCalendar(CALENDAR_REFERENCE_YEAR + 1);
  assert.ok(next.every((d) => d.preliminary), 'даты чужого цикла помечены предварительными');
  assert.ok(next.every((d) => d.from.startsWith(String(CALENDAR_REFERENCE_YEAR + 1))));
});

test('Календарь отсортирован по дате начала', () => {
  const dates = admissionCalendar(2027).map((d) => d.from);
  assert.deepEqual(dates, [...dates].sort(), 'события идут по возрастанию даты');
});

test('Даты записаны в формате «месяц-день» и разбираются как настоящие', () => {
  for (const entry of admissionCalendar(2027)) {
    assert.match(entry.from, /^\d{4}-\d{2}-\d{2}$/, entry.id);
    assert.match(entry.to, /^\d{4}-\d{2}-\d{2}$/, entry.id);
    assert.ok(entry.from <= entry.to, `${entry.id}: начало не позже конца`);
    assert.ok(!Number.isNaN(Date.parse(entry.from)), `${entry.id}: дата существует`);
  }
});
