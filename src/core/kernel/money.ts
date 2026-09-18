/**
 * DATA-09 / MODEL-04 — деньги.
 *
 * Хранение только в минимальных единицах (bigint), бинарные float запрещены.
 * Конверсия фиксирует источник курса, дату и правило округления.
 * Без пригодного курса межвалютное сравнение помечается неопределённым.
 */

export type CurrencyCode = 'KZT' | 'USD' | 'EUR' | 'GBP' | 'RUB' | 'TRY' | 'CNY';

export const CURRENCY_MINOR_DIGITS: Record<CurrencyCode, number> = {
  KZT: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  RUB: 2,
  TRY: 2,
  CNY: 2,
};

export interface Money {
  /** Сумма в минимальных единицах валюты. bigint, не number — DATA-09. */
  readonly amountMinor: bigint;
  readonly currency: CurrencyCode;
}

export const money = (amountMinor: bigint | number, currency: CurrencyCode): Money => ({
  amountMinor: typeof amountMinor === 'bigint' ? amountMinor : BigInt(Math.round(amountMinor)),
  currency,
});

/** Из «человеческой» суммы (1 200 000 ₸) в минимальные единицы. */
export function fromMajor(major: number, currency: CurrencyCode): Money {
  const digits = CURRENCY_MINOR_DIGITS[currency];
  const factor = 10 ** digits;
  // Округление до минимальной единицы делается один раз, на границе ввода.
  return money(BigInt(Math.round(major * factor)), currency);
}

export function toMajorNumber(m: Money): number {
  const factor = 10 ** CURRENCY_MINOR_DIGITS[m.currency];
  return Number(m.amountMinor) / factor;
}

export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) {
    throw new TypeError(`Сложение разных валют без конверсии: ${a.currency} + ${b.currency}`);
  }
  return money(a.amountMinor + b.amountMinor, a.currency);
}

export function sumMoney(items: readonly Money[], currency: CurrencyCode): Money {
  return items.reduce((acc, m) => addMoney(acc, m), money(0n, currency));
}

export function compareMoney(a: Money, b: Money): number {
  if (a.currency !== b.currency) {
    throw new TypeError(`Сравнение разных валют без конверсии: ${a.currency} vs ${b.currency}`);
  }
  return a.amountMinor < b.amountMinor ? -1 : a.amountMinor > b.amountMinor ? 1 : 0;
}

/* ------------------------------------------------------------------ */
/* Конверсия                                                           */
/* ------------------------------------------------------------------ */

export interface FxRate {
  readonly from: CurrencyCode;
  readonly to: CurrencyCode;
  /** Курс как рациональное число: to = from * numerator / denominator. Без float. */
  readonly numerator: bigint;
  readonly denominator: bigint;
  readonly asOf: string; // ISO-дата фиксации курса
  readonly sourceId: string;
  readonly rounding: 'half_up';
}

export type ConversionResult =
  | { ok: true; value: Money; rate: FxRate }
  /** DATA-09: без пригодного курса результат неопределён, а не «ноль» и не «примерно». */
  | { ok: false; reason: 'no_rate'; from: CurrencyCode; to: CurrencyCode };

export function convert(
  m: Money,
  to: CurrencyCode,
  rates: readonly FxRate[],
): ConversionResult {
  if (m.currency === to) {
    return {
      ok: true,
      value: m,
      rate: {
        from: to,
        to,
        numerator: 1n,
        denominator: 1n,
        asOf: '',
        sourceId: 'identity',
        rounding: 'half_up',
      },
    };
  }
  const rate = rates.find((r) => r.from === m.currency && r.to === to);
  if (!rate) return { ok: false, reason: 'no_rate', from: m.currency, to };

  // half-up на целых числах, без промежуточного float.
  const scaled = m.amountMinor * rate.numerator;
  const half = rate.denominator / 2n;
  const q = (scaled + (scaled >= 0n ? half : -half)) / rate.denominator;
  return { ok: true, value: money(q, to), rate };
}

/* ------------------------------------------------------------------ */
/* Бюджет и совместимость (MODEL-04 + REV-09)                          */
/* ------------------------------------------------------------------ */

/** PF-03: пользователь явно указывает, что ограничивает сумма. */
export type BudgetScope = 'tuition_only' | 'total';
export type CostPeriod = 'academic_year' | 'one_time' | 'per_month' | 'whole_programme';

export interface BudgetConstraint {
  readonly limit: Money;
  readonly scope: BudgetScope;
  readonly period: CostPeriod;
  /** Доступные средства по датам — MODEL-04 требует проверять не только итог. */
  readonly availability: readonly { readonly date: string; readonly amount: Money }[];
}

export interface CostRange {
  readonly min: Money;
  readonly max: Money;
  readonly period: CostPeriod;
  /** Входит ли категория в «только обучение» — нужно для сопоставления со scope. */
  readonly scope: BudgetScope;
  readonly mandatory: boolean;
}

export type BudgetVerdict =
  | { kind: 'compatible_in_known_range' }
  | { kind: 'known_gap'; shortfall: Money }
  | { kind: 'needs_clarification'; reason: BudgetUnclearReason };

export type BudgetUnclearReason =
  | 'range_crosses_budget'
  | 'unknown_mandatory_category'
  | 'no_fx_rate'
  /** REV-09: бюджет задан как tuition_only, а расходы включают проживание/разовые. */
  | 'scope_mismatch'
  | 'period_mismatch';

/**
 * MODEL-04 с закрытой дырой REV-09.
 *
 * В исходном ТЗ правило сравнивало [min,max] с бюджетом B, но не учитывало,
 * что PF-03 разрешает объявить B пределом ТОЛЬКО на обучение. Сравнение
 * tuition_only-бюджета с диапазоном, включающим проживание, давало бы
 * ложный ответ в обе стороны. Несопоставимость даёт «требует уточнения».
 */
export function assessBudget(
  budget: BudgetConstraint,
  costs: readonly CostRange[],
  opts: { readonly hasUnknownMandatoryCategory: boolean },
): BudgetVerdict {
  if (opts.hasUnknownMandatoryCategory) {
    return { kind: 'needs_clarification', reason: 'unknown_mandatory_category' };
  }

  const mandatory = costs.filter((c) => c.mandatory);
  if (mandatory.length === 0) {
    return { kind: 'needs_clarification', reason: 'unknown_mandatory_category' };
  }

  // REV-09: сопоставимость scope.
  if (budget.scope === 'tuition_only' && mandatory.some((c) => c.scope === 'total')) {
    return { kind: 'needs_clarification', reason: 'scope_mismatch' };
  }

  // REV-09: сопоставимость периода. Разовые расходы не сравниваются с годовым пределом
  // напрямую — их учитывает проверка денежных потоков, а не итоговая сумма.
  const comparable = mandatory.filter((c) => c.period === budget.period);
  if (comparable.length !== mandatory.length) {
    return { kind: 'needs_clarification', reason: 'period_mismatch' };
  }

  const currency = budget.limit.currency;
  if (comparable.some((c) => c.min.currency !== currency || c.max.currency !== currency)) {
    return { kind: 'needs_clarification', reason: 'no_fx_rate' };
  }

  const totalMin = sumMoney(comparable.map((c) => c.min), currency);
  const totalMax = sumMoney(comparable.map((c) => c.max), currency);

  if (compareMoney(totalMax, budget.limit) <= 0) return { kind: 'compatible_in_known_range' };
  if (compareMoney(totalMin, budget.limit) > 0) {
    return {
      kind: 'known_gap',
      shortfall: money(totalMin.amountMinor - budget.limit.amountMinor, currency),
    };
  }
  return { kind: 'needs_clarification', reason: 'range_crosses_budget' };
}

/* ------------------------------------------------------------------ */
/* Форматирование (NFR-08)                                             */
/* ------------------------------------------------------------------ */

const CURRENCY_SUFFIX_RU: Record<CurrencyCode, string> = {
  KZT: '₸',
  USD: '$',
  EUR: '€',
  GBP: '£',
  RUB: '₽',
  TRY: '₺',
  CNY: '¥',
};

export function formatMoneyRu(m: Money): string {
  const major = toMajorNumber(m);
  const digits = CURRENCY_MINOR_DIGITS[m.currency];
  const hasFraction = m.amountMinor % BigInt(10 ** digits) !== 0n;
  const formatted = new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: hasFraction ? digits : 0,
    maximumFractionDigits: hasFraction ? digits : 0,
  }).format(major);
  return `${formatted} ${CURRENCY_SUFFIX_RU[m.currency]}`;
}
