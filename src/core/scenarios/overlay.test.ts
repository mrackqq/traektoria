/**
 * ST-01…ST-03 — overlay стресс-теста маршрута.
 *
 * Главный инвариант модуля (ST-03): сценарий — это предположение, а не факт.
 * Расчёт идёт на неизменяемом снимке плюс отдельном overlay, и ни создание,
 * ни ошибка симуляции не меняют профиль, результаты экзаменов и прогресс.
 * Здесь это закреплено буквально: исходный объект сверяется до и после.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyOverlay,
  orderEvents,
  remainingFunding,
  validateEvents,
  EVENT_LABEL_RU,
  type ScenarioEvent,
} from './overlay.ts';
import { money } from '../kernel/money.ts';
import { buildDemoProfile } from '../demo/profile.ts';
import { DEMO_CLOCK } from '../demo/session.ts';

const PROFILE = buildDemoProfile(DEMO_CLOCK.now);

const budgetEvent = (
  id: string,
  date: string,
  amountMinor: bigint,
  scope: 'total' | 'tuition_only' = 'total',
): ScenarioEvent => ({
  id,
  type: 'budget_changed',
  effectiveDate: date,
  budget: {
    limit: money(amountMinor, 'KZT'),
    scope,
    period: 'academic_year',
    availability: [],
  },
  explanation: 'проверка',
});

const skipEvent = (over: Partial<Extract<ScenarioEvent, { type: 'task_skipped' }>> = {}): ScenarioEvent => ({
  id: 'skip-1',
  type: 'task_skipped',
  effectiveDate: '2027-03-01',
  taskSemanticKey: 'ielts:prepare',
  completedFraction: 0.5,
  newAvailabilityDate: '2027-04-01',
  explanation: 'проверка',
  ...over,
});

const delayEvent = (
  over: Partial<Extract<ScenarioEvent, { type: 'certificate_delayed' }>> = {},
): ScenarioEvent => ({
  id: 'delay-1',
  type: 'certificate_delayed',
  effectiveDate: '2027-03-01',
  examKind: 'ЕНТ',
  newResultDate: '2027-05-01',
  explanation: 'проверка',
  ...over,
});

/* ------------------------------------------------------------------ */
/* ST-02: валидация до расчёта                                         */
/* ------------------------------------------------------------------ */

test('ST-02: два разных бюджета на одну дату — конфликт', () => {
  const conflicts = validateEvents([
    budgetEvent('a', '2027-03-01', 1_000_000n),
    budgetEvent('b', '2027-03-01', 2_000_000n),
  ]);

  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0]!.code, 'SAME_FIELD_SAME_DATE');
  assert.deepEqual(conflicts[0]!.eventIds, ['a', 'b'], 'конфликт обязан назвать оба события');
});

test('ST-02: одинаковое значение на одну дату конфликтом не считается', () => {
  // Дублирующее событие неоднозначности не создаёт: выбирать не из чего.
  const conflicts = validateEvents([
    budgetEvent('a', '2027-03-01', 1_000_000n),
    budgetEvent('b', '2027-03-01', 1_000_000n),
  ]);

  assert.deepEqual(conflicts, []);
});

test('ST-02: разная область бюджета на одну дату — тоже конфликт', () => {
  const conflicts = validateEvents([
    budgetEvent('a', '2027-03-01', 1_000_000n, 'total'),
    budgetEvent('b', '2027-03-01', 1_000_000n, 'tuition_only'),
  ]);

  assert.equal(conflicts.length, 1, 'та же сумма, но про другое — это разные утверждения');
});

test('ST-02: последовательные изменения бюджета на разные даты допустимы', () => {
  const conflicts = validateEvents([
    budgetEvent('a', '2027-03-01', 2_000_000n),
    budgetEvent('b', '2027-05-01', 1_000_000n),
  ]);

  assert.deepEqual(conflicts, [], 'замещение по времени — нормальный сценарий, а не противоречие');
});

test('ST-02: выполненная часть вне диапазона 0…1 отвергается', () => {
  for (const fraction of [-0.1, 1.5, 2]) {
    const conflicts = validateEvents([skipEvent({ completedFraction: fraction })]);
    assert.ok(
      conflicts.some((c) => c.code === 'INVALID_FRACTION'),
      `доля ${fraction} обязана быть отвергнута`,
    );
  }
});

test('ST-02: границы 0 и 1 допустимы', () => {
  for (const fraction of [0, 1]) {
    const conflicts = validateEvents([skipEvent({ completedFraction: fraction })]);
    assert.deepEqual(conflicts, [], `доля ${fraction} — корректное значение`);
  }
});

test('ST-02: дата доступности раньше события — противоречие', () => {
  const conflicts = validateEvents([
    skipEvent({ effectiveDate: '2027-04-01', newAvailabilityDate: '2027-03-01' }),
  ]);

  assert.ok(conflicts.some((c) => c.code === 'DATE_ORDER'));
});

test('ST-02: совпадение дат события и доступности допустимо', () => {
  const conflicts = validateEvents([
    skipEvent({ effectiveDate: '2027-04-01', newAvailabilityDate: '2027-04-01' }),
  ]);

  assert.deepEqual(conflicts, []);
});

test('ST-02: задержка результата раньше события — противоречие', () => {
  const conflicts = validateEvents([
    delayEvent({ effectiveDate: '2027-05-01', newResultDate: '2027-03-01' }),
  ]);

  assert.ok(conflicts.some((c) => c.code === 'DATE_ORDER'));
});

test('ST-02: пустой список событий противоречий не содержит', () => {
  assert.deepEqual(validateEvents([]), []);
});

/* ------------------------------------------------------------------ */
/* Порядок                                                             */
/* ------------------------------------------------------------------ */

test('События упорядочиваются по дате от ранней к поздней', () => {
  // Порядок важен по существу: замещение бюджета работает по принципу
  // «позже записанное выигрывает», и обратная сортировка дала бы
  // действующим самое раннее значение.
  const ordered = orderEvents([
    budgetEvent('c', '2027-05-01', 3n),
    budgetEvent('a', '2027-01-01', 1n),
    budgetEvent('b', '2027-03-01', 2n),
  ]);

  assert.deepEqual(
    ordered.map((e) => e.effectiveDate),
    ['2027-01-01', '2027-03-01', '2027-05-01'],
  );
});

test('При совпадении дат порядок задаётся идентификатором', () => {
  const ordered = orderEvents([
    budgetEvent('zzz', '2027-03-01', 1n),
    budgetEvent('aaa', '2027-03-01', 1n),
  ]);

  assert.deepEqual(ordered.map((e) => e.id), ['aaa', 'zzz'], 'иначе симуляция была бы невоспроизводима');
});

test('Упорядочивание не меняет исходный массив', () => {
  const input = [budgetEvent('b', '2027-05-01', 1n), budgetEvent('a', '2027-01-01', 1n)];
  const copy = [...input];
  orderEvents(input);

  assert.deepEqual(input, copy);
});

/* ------------------------------------------------------------------ */
/* ST-03: overlay никогда не становится фактом                         */
/* ------------------------------------------------------------------ */

test('ST-03: исходный профиль не изменяется', () => {
  const before = JSON.stringify(PROFILE, (_k, v) => (typeof v === 'bigint' ? String(v) : v));

  applyOverlay(PROFILE, [
    budgetEvent('a', '2027-03-01', 1_200_000n),
    delayEvent(),
    skipEvent(),
    { id: 'f', type: 'funding_not_received', effectiveDate: '2027-03-01', fundingId: 'grant-1', explanation: '' },
  ]);

  const after = JSON.stringify(PROFILE, (_k, v) => (typeof v === 'bigint' ? String(v) : v));
  assert.equal(after, before, 'симуляция обязана оставить факты нетронутыми');
});

test('ST-03: расчётный профиль помечен как сценарный', () => {
  const r = applyOverlay(PROFILE, [budgetEvent('a', '2027-03-01', 1_200_000n)]);
  assert.equal(r.overlayProfile.changeReason, 'scenario_overlay');
});

test('Бюджет замещается последним по времени событием', () => {
  const r = applyOverlay(PROFILE, [
    budgetEvent('late', '2027-05-01', 1_000_000n),
    budgetEvent('early', '2027-01-01', 5_000_000n),
  ]);

  assert.equal(r.overlayProfile.budget.state, 'known');
  assert.equal(r.overlayProfile.budget.value?.limit.amountMinor, 1_000_000n, 'действует позднее значение');
});

test('Задержка сдвигает ожидаемый результат экзамена', () => {
  const pending = PROFILE.exams.find((e) => e.state !== 'result_reported');
  assert.ok(pending, 'для проверки нужен экзамен без опубликованного результата');

  const r = applyOverlay(PROFILE, [delayEvent({ examKind: pending.examKind, newResultDate: '2027-09-09' })]);
  const shifted = r.overlayProfile.exams.find((e) => e.examKind === pending.examKind);

  assert.equal(shifted?.resultOn, '2027-09-09');
});

test('Уже опубликованный результат задержкой не переписывается', () => {
  // Гипотеза о задержке не может отменить то, что уже произошло.
  const withResult = {
    ...PROFILE,
    exams: PROFILE.exams.map((e, i) =>
      i === 0 ? { ...e, state: 'result_reported' as const, resultOn: '2027-01-15' } : e,
    ),
  };
  const target = withResult.exams[0]!;

  const r = applyOverlay(withResult, [
    delayEvent({ examKind: target.examKind, newResultDate: '2027-09-09' }),
  ]);

  assert.equal(
    r.overlayProfile.exams[0]!.resultOn,
    '2027-01-15',
    'опубликованный результат — факт, а не предположение',
  );
});

test('Пропуск задачи и отказ в финансировании собираются в отдельные карты', () => {
  const r = applyOverlay(PROFILE, [
    skipEvent({ taskSemanticKey: 'ielts:prepare', completedFraction: 0.25, newAvailabilityDate: '2027-06-01' }),
    { id: 'f', type: 'funding_not_received', effectiveDate: '2027-03-01', fundingId: 'grant-1', explanation: '' },
  ]);

  assert.deepEqual(r.taskDelays.get('ielts:prepare'), {
    availableFrom: '2027-06-01',
    completedFraction: 0.25,
  });
  assert.equal(r.fundingOverrides.get('grant-1'), 'rejected');
});

test('Пустой список событий даёт профиль, равный исходному по существу', () => {
  const r = applyOverlay(PROFILE, []);

  assert.equal(r.appliedEvents.length, 0);
  assert.equal(r.taskDelays.size, 0);
  assert.equal(r.fundingOverrides.size, 0);
  assert.deepEqual(r.overlayProfile.budget, PROFILE.budget);
});

/* ------------------------------------------------------------------ */
/* Финансирование                                                      */
/* ------------------------------------------------------------------ */

test('MODEL-05: переопределения заменяют состояние, остальное сохраняется', () => {
  const options = [
    { id: 'a', amount: money(100n, 'KZT'), state: 'confirmed' as const },
    { id: 'b', amount: money(200n, 'KZT'), state: 'expected' as const },
  ];

  const result = remainingFunding(options, new Map([['a', 'rejected' as const]]));

  assert.equal(result[0]!.state, 'rejected');
  assert.equal(result[0]!.amount.amountMinor, 100n, 'сумма не меняется от смены состояния');
  assert.equal(result[1]!.state, 'expected', 'непереопределённое остаётся как было');
});

test('Все виды событий имеют русскую подпись', () => {
  for (const type of ['budget_changed', 'certificate_delayed', 'funding_not_received', 'task_skipped'] as const) {
    assert.ok(EVENT_LABEL_RU[type]?.length > 0, `нет подписи для ${type}`);
  }
});
