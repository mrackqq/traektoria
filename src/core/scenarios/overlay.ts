/**
 * ST-01…ST-13 — «Стресс-тест маршрута».
 *
 * ST-03, главный инвариант модуля: сценарий считается на НЕИЗМЕНЯЕМОМ снимке
 * фактических данных плюс отдельном overlay предположений. Создание,
 * редактирование, сохранение, отмена или ошибка симуляции не изменяют профиль,
 * основную стратегию, результаты экзаменов и прогресс.
 *
 * Поэтому все функции здесь чистые: они возвращают НОВЫЕ объекты и никогда
 * не мутируют вход.
 */

import type { BudgetConstraint, Money } from '../kernel/money';
import type { ApplicantProfileRevision, FundingState } from '../kernel/profile';
import type { PlainDate } from '../kernel/time';
import { daysBetween } from '../kernel/time';

/* ------------------------------------------------------------------ */
/* События (ST-01)                                                     */
/* ------------------------------------------------------------------ */

export type ScenarioEvent =
  | {
      readonly id: string;
      readonly type: 'budget_changed';
      readonly effectiveDate: PlainDate;
      readonly budget: BudgetConstraint;
      readonly explanation: string;
    }
  | {
      readonly id: string;
      readonly type: 'certificate_delayed';
      readonly effectiveDate: PlainDate;
      /** Экзамен или документ, результат которого задерживается. */
      readonly examKind: string;
      readonly newResultDate: PlainDate;
      readonly explanation: string;
    }
  | {
      readonly id: string;
      readonly type: 'funding_not_received';
      readonly effectiveDate: PlainDate;
      readonly fundingId: string;
      readonly explanation: string;
    }
  | {
      readonly id: string;
      readonly type: 'task_skipped';
      readonly effectiveDate: PlainDate;
      readonly taskSemanticKey: string;
      /** Выполненная часть 0…1 — она не теряется при перестройке. */
      readonly completedFraction: number;
      readonly newAvailabilityDate: PlainDate;
      readonly explanation: string;
    };

export const EVENT_LABEL_RU: Record<ScenarioEvent['type'], string> = {
  budget_changed: 'Сокращение бюджета',
  certificate_delayed: 'Задержка сертификата',
  funding_not_received: 'Ожидаемое финансирование не получено',
  task_skipped: 'Пропуск задачи',
};

export interface ScenarioOverlay {
  readonly id: string;
  readonly baselineStrategyId: string;
  readonly events: readonly ScenarioEvent[];
  readonly createdAt: string;
  readonly title: string;
}

/* ------------------------------------------------------------------ */
/* Валидация (ST-02)                                                   */
/* ------------------------------------------------------------------ */

export interface EventConflict {
  readonly code: 'SAME_FIELD_SAME_DATE' | 'UNKNOWN_PARAMETER' | 'INVALID_FRACTION' | 'DATE_ORDER';
  readonly message: string;
  readonly eventIds: readonly string[];
}

/**
 * ST-02: неизвестный или противоречивый параметр валидируется ДО расчёта.
 *
 * Последовательные изменения одного бюджета на разные даты допустимы:
 * события упорядочиваются по effective date, новое значение действует до
 * следующего замещения. Разные значения одного поля с ОДИНАКОВОЙ датой —
 * конфликт, требующий решения пользователя (AC-33).
 */
export function validateEvents(events: readonly ScenarioEvent[]): EventConflict[] {
  const conflicts: EventConflict[] = [];

  // Одинаковая дата + одно и то же поле = неоднозначность.
  const budgetByDate = new Map<PlainDate, ScenarioEvent[]>();
  for (const e of events) {
    if (e.type !== 'budget_changed') continue;
    const list = budgetByDate.get(e.effectiveDate) ?? [];
    list.push(e);
    budgetByDate.set(e.effectiveDate, list);
  }
  for (const [date, list] of budgetByDate) {
    if (list.length < 2) continue;
    const distinct = new Set(
      list.map((e) =>
        e.type === 'budget_changed'
          ? `${e.budget.limit.amountMinor}:${e.budget.limit.currency}:${e.budget.scope}`
          : '',
      ),
    );
    if (distinct.size > 1) {
      conflicts.push({
        code: 'SAME_FIELD_SAME_DATE',
        message:
          `Два разных значения бюджета на одну дату ${date}. Правило замещения не задано — ` +
          'нужно выбрать одно значение.',
        eventIds: list.map((e) => e.id),
      });
    }
  }

  for (const e of events) {
    if (e.type === 'task_skipped') {
      if (e.completedFraction < 0 || e.completedFraction > 1) {
        conflicts.push({
          code: 'INVALID_FRACTION',
          message: `Выполненная часть должна быть от 0 до 1, получено ${e.completedFraction}.`,
          eventIds: [e.id],
        });
      }
      if (daysBetween(e.effectiveDate, e.newAvailabilityDate) < 0) {
        conflicts.push({
          code: 'DATE_ORDER',
          message: 'Новая дата доступности раньше даты события.',
          eventIds: [e.id],
        });
      }
    }
    if (e.type === 'certificate_delayed' && daysBetween(e.effectiveDate, e.newResultDate) < 0) {
      conflicts.push({
        code: 'DATE_ORDER',
        message: 'Новая дата результата раньше даты события.',
        eventIds: [e.id],
      });
    }
  }

  return conflicts;
}

/** ST-02: порядок независимых событий фиксируется стабильным ID. */
export function orderEvents(events: readonly ScenarioEvent[]): ScenarioEvent[] {
  return [...events].sort(
    (a, b) => daysBetween(b.effectiveDate, a.effectiveDate) || a.id.localeCompare(b.id),
  );
}

/* ------------------------------------------------------------------ */
/* Применение overlay (ST-03)                                          */
/* ------------------------------------------------------------------ */

export interface OverlayResult {
  /**
   * Профиль ДЛЯ РАСЧЁТА СЦЕНАРИЯ. Это не новая ревизия и он никогда
   * не сохраняется как факт (ST-03, ST-09, AC-15).
   */
  readonly overlayProfile: ApplicantProfileRevision;
  readonly fundingOverrides: ReadonlyMap<string, FundingState>;
  readonly taskDelays: ReadonlyMap<string, { availableFrom: PlainDate; completedFraction: number }>;
  readonly examResultDelays: ReadonlyMap<string, PlainDate>;
  readonly appliedEvents: readonly ScenarioEvent[];
}

/**
 * Построить overlay поверх снимка фактов.
 *
 * Функция чистая: исходный `profile` не изменяется. Возвращаемый
 * `overlayProfile` помечен как расчётный и не имеет номера ревизии факта.
 */
export function applyOverlay(
  profile: ApplicantProfileRevision,
  events: readonly ScenarioEvent[],
): OverlayResult {
  const ordered = orderEvents(events);

  let budget = profile.budget;
  const fundingOverrides = new Map<string, FundingState>();
  const taskDelays = new Map<string, { availableFrom: PlainDate; completedFraction: number }>();
  const examResultDelays = new Map<string, PlainDate>();

  for (const e of ordered) {
    switch (e.type) {
      case 'budget_changed':
        // Последовательные изменения: новое значение действует до следующего.
        budget = { state: 'known', value: e.budget };
        break;
      case 'funding_not_received':
        fundingOverrides.set(e.fundingId, 'rejected');
        break;
      case 'task_skipped':
        taskDelays.set(e.taskSemanticKey, {
          availableFrom: e.newAvailabilityDate,
          completedFraction: e.completedFraction,
        });
        break;
      case 'certificate_delayed':
        examResultDelays.set(e.examKind, e.newResultDate);
        break;
    }
  }

  // ST-03: строим НОВЫЙ объект. Прошлые фактические платежи и результаты
  // остаются нетронутыми — мы меняем только плановые предпосылки.
  const overlayProfile: ApplicantProfileRevision = {
    ...profile,
    budget,
    exams: profile.exams.map((ex) => {
      const delayed = examResultDelays.get(ex.examKind);
      if (!delayed) return ex;
      // Задержка сдвигает дату ОЖИДАЕМОГО результата, а не переписывает
      // уже полученный фактический результат.
      if (ex.state === 'result_reported') return ex;
      return { ...ex, resultOn: delayed };
    }),
    changeReason: 'scenario_overlay',
  };

  return {
    overlayProfile,
    fundingOverrides,
    taskDelays,
    examResultDelays,
    appliedEvents: ordered,
  };
}

/** Сумма подтверждённого финансирования, оставшегося после событий (MODEL-05). */
export function remainingFunding(
  options: readonly { id: string; amount: Money; state: FundingState }[],
  overrides: ReadonlyMap<string, FundingState>,
): { id: string; amount: Money; state: FundingState }[] {
  return options.map((f) => ({ ...f, state: overrides.get(f.id) ?? f.state }));
}
