/**
 * Деньги: округление, конверсия и сопоставление с бюджетом.
 *
 * DATA-09 запрещает превращать суммы в number и выдавать «примерно» за факт.
 * Поэтому здесь проверяются не только удачные случаи, но и все поводы честно
 * ответить «не знаю»: нет курса, несопоставимые области, разные периоды.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addMoney,
  assessBudget,
  compareMoney,
  convert,
  formatMoneyRu,
  fromMajor,
  money,
  sumMoney,
  toMajorNumber,
  type BudgetConstraint,
  type CostRange,
  type FxRate,
} from './money.ts';

const rate = (over: Partial<FxRate> = {}): FxRate => ({
  from: 'KZT',
  to: 'USD',
  numerator: 1n,
  denominator: 500n,
  asOf: '2027-01-01',
  sourceId: 'demo',
  rounding: 'half_up',
  ...over,
});

/* ------------------------------------------------------------------ */
/* Округление на границе ввода                                         */
/* ------------------------------------------------------------------ */

test('DATA-09: округление идёт по десятичному значению, а не по двоичному', () => {
  // 1.005 * 100 в double равно 100.49999999999999, и наивное округление
  // теряло копейку: сумма 1,005 превращалась в 1,00 вместо 1,01.
  assert.equal(fromMajor(1.005, 'USD').amountMinor, 101n);
  assert.equal(fromMajor(2.675, 'USD').amountMinor, 268n);
  assert.equal(fromMajor(8.165, 'USD').amountMinor, 817n);
});

test('Обычные суммы переводятся без сюрпризов', () => {
  assert.equal(fromMajor(0, 'KZT').amountMinor, 0n);
  assert.equal(fromMajor(1_200_000, 'KZT').amountMinor, 120_000_000n);
  assert.equal(fromMajor(-15.5, 'USD').amountMinor, -1550n);
});

test('Нечисловая сумма отвергается, а не превращается в NaN-деньги', () => {
  assert.throws(() => fromMajor(Number.NaN, 'USD'), TypeError);
  assert.throws(() => fromMajor(Infinity, 'USD'), TypeError);
});

test('Обратный перевод в «человеческую» сумму', () => {
  assert.equal(toMajorNumber(money(120_000_000n, 'KZT')), 1_200_000);
  assert.equal(toMajorNumber(money(0n, 'USD')), 0);
  assert.equal(toMajorNumber(money(-1550n, 'USD')), -15.5);
});

/* ------------------------------------------------------------------ */
/* Арифметика                                                          */
/* ------------------------------------------------------------------ */

test('Сложение и сравнение разных валют без конверсии запрещены', () => {
  assert.throws(() => addMoney(money(1n, 'KZT'), money(1n, 'USD')), TypeError);
  assert.throws(() => compareMoney(money(1n, 'KZT'), money(1n, 'USD')), TypeError);
});

test('Сумма пустого списка — ноль в указанной валюте', () => {
  const total = sumMoney([], 'KZT');
  assert.equal(total.amountMinor, 0n);
  assert.equal(total.currency, 'KZT');
});

test('Сравнение даёт устойчивый порядок', () => {
  assert.equal(compareMoney(money(1n, 'KZT'), money(2n, 'KZT')), -1);
  assert.equal(compareMoney(money(2n, 'KZT'), money(2n, 'KZT')), 0);
  assert.equal(compareMoney(money(3n, 'KZT'), money(2n, 'KZT')), 1);
});

/* ------------------------------------------------------------------ */
/* Конверсия                                                           */
/* ------------------------------------------------------------------ */

test('Конверсия в ту же валюту ничего не меняет', () => {
  const m = money(1234n, 'KZT');
  const r = convert(m, 'KZT', []);
  assert.ok(r.ok);
  assert.equal(r.value.amountMinor, 1234n);
});

test('DATA-09: без курса результат неопределён, а не ноль', () => {
  const r = convert(money(100n, 'KZT'), 'USD', []);
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.reason === 'no_rate');
});

test('Обратный курс не выводится сам: KZT→USD не берётся из USD→KZT', () => {
  const r = convert(money(100n, 'KZT'), 'USD', [rate({ from: 'USD', to: 'KZT', numerator: 500n, denominator: 1n })]);
  assert.equal(r.ok, false, 'выдумывать обратный курс нельзя — это была бы неподтверждённая цифра');
});

test('Курс с нулевым знаменателем ведёт себя как отсутствие курса', () => {
  // Деление bigint на ноль бросает RangeError и роняло бы весь подбор
  // программ из-за одной битой строки справочника.
  const r = convert(money(1000n, 'KZT'), 'USD', [rate({ denominator: 0n })]);
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.reason === 'no_rate');
});

test('Годный курс считается half-up на целых числах', () => {
  const r = convert(money(50_000n, 'KZT'), 'USD', [rate()]);
  assert.ok(r.ok);
  assert.equal(r.value.amountMinor, 100n);
  assert.equal(r.value.currency, 'USD');
});

/* ------------------------------------------------------------------ */
/* Сопоставление с бюджетом                                            */
/* ------------------------------------------------------------------ */

const budget = (over: Partial<BudgetConstraint> = {}): BudgetConstraint => ({
  limit: money(1_000_000n, 'KZT'),
  scope: 'total',
  period: 'academic_year',
  availability: [],
  ...over,
});

const cost = (over: Partial<CostRange> = {}): CostRange => ({
  min: money(500_000n, 'KZT'),
  max: money(500_000n, 'KZT'),
  period: 'academic_year',
  scope: 'total',
  mandatory: true,
  ...over,
});

test('MODEL-04: расход в пределах бюджета — совместим', () => {
  assert.deepEqual(assessBudget(budget(), [cost()], { hasUnknownMandatoryCategory: false }), {
    kind: 'compatible_in_known_range',
  });
});

test('MODEL-04: граница «ровно бюджет» считается совместимой', () => {
  const verdict = assessBudget(
    budget(),
    [cost({ min: money(1_000_000n, 'KZT'), max: money(1_000_000n, 'KZT') })],
    { hasUnknownMandatoryCategory: false },
  );
  assert.equal(verdict.kind, 'compatible_in_known_range');
});

test('MODEL-04: известный разрыв называет недостающую сумму', () => {
  const verdict = assessBudget(
    budget(),
    [cost({ min: money(1_500_000n, 'KZT'), max: money(1_500_000n, 'KZT') })],
    { hasUnknownMandatoryCategory: false },
  );
  assert.equal(verdict.kind, 'known_gap');
  assert.ok(verdict.kind === 'known_gap' && verdict.shortfall.amountMinor === 500_000n);
});

test('MODEL-04: диапазон, пересекающий бюджет, не выдаётся за ответ', () => {
  const verdict = assessBudget(
    budget(),
    [cost({ min: money(800_000n, 'KZT'), max: money(1_200_000n, 'KZT') })],
    { hasUnknownMandatoryCategory: false },
  );
  assert.equal(verdict.kind, 'needs_clarification');
  assert.ok(verdict.kind === 'needs_clarification' && verdict.reason === 'range_crosses_budget');
});

test('Неизвестная обязательная категория важнее любых посчитанных сумм', () => {
  const verdict = assessBudget(budget(), [cost()], { hasUnknownMandatoryCategory: true });
  assert.equal(verdict.kind, 'needs_clarification');
  assert.ok(verdict.kind === 'needs_clarification' && verdict.reason === 'unknown_mandatory_category');
});

test('REV-09: бюджет «только обучение» против расходов на проживание несопоставим', () => {
  const verdict = assessBudget(
    budget({ scope: 'tuition_only' }),
    [cost({ scope: 'total' })],
    { hasUnknownMandatoryCategory: false },
  );
  assert.equal(verdict.kind, 'needs_clarification');
  assert.ok(verdict.kind === 'needs_clarification' && verdict.reason === 'scope_mismatch');
});

test('Разные периоды не складываются молча', () => {
  const verdict = assessBudget(
    budget(),
    [cost({ period: 'academic_year' }), cost({ period: 'one_time' })],
    { hasUnknownMandatoryCategory: false },
  );
  assert.equal(verdict.kind, 'needs_clarification');
  assert.ok(verdict.kind === 'needs_clarification' && verdict.reason === 'period_mismatch');
});

test('Необязательные расходы не создают разрыв бюджета', () => {
  const verdict = assessBudget(
    budget(),
    [cost({ mandatory: false, min: money(9_000_000n, 'KZT'), max: money(9_000_000n, 'KZT') })],
    { hasUnknownMandatoryCategory: false },
  );
  assert.notEqual(verdict.kind, 'known_gap');
});

/* ------------------------------------------------------------------ */
/* Форматирование                                                      */
/* ------------------------------------------------------------------ */

test('Целая сумма показывается без копеек, дробная — с копейками', () => {
  assert.ok(!formatMoneyRu(money(120_000_000n, 'KZT')).includes(','));
  assert.ok(formatMoneyRu(money(150n, 'USD')).includes(','));
});

test('Ноль форматируется, а не исчезает', () => {
  assert.match(formatMoneyRu(money(0n, 'KZT')), /0/);
});
