/**
 * TASK-05 — счётчики прогресса.
 *
 * Требование читается буквально: пользователь видит ОТДЕЛЬНО выполнение
 * действий и соответствие известным условиям. Поэтому здесь два независимых
 * набора чисел и сознательно НЕТ функции «общий процент готовности»:
 * объединённый процент выглядел бы как вероятность поступления, что прямо
 * запрещено (PR-06, ENG-03, ENG-06).
 *
 * REV-21: нулевой знаменатель обрабатывается явно — отношение становится
 * неопределённым с причиной, а не 0%, не 100% и не NaN.
 */

import { countByStatus, type EvaluatedNode } from '../eligibility/evaluate';
import { isClosed, type ProgressState, type TaskStatus } from './state';

export type Ratio =
  | {
      readonly kind: 'ratio';
      readonly done: number;
      readonly total: number;
      /** Целые проценты. Округление половин вверх — детерминированно. */
      readonly percent: number;
    }
  | {
      readonly kind: 'undefined';
      readonly reason: 'no_tasks' | 'no_applicable_conditions';
      readonly message: string;
    };

export interface ActionCounts {
  readonly todo: number;
  readonly inProgress: number;
  readonly awaitingResult: number;
  readonly done: number;
  readonly skipped: number;
  readonly obsolete: number;
  /** Знаменатель: всё, кроме потерявшего смысл. */
  readonly total: number;
  readonly remaining: number;
}

export interface ConditionCounts {
  readonly met: number;
  readonly notMet: number;
  readonly unknown: number;
  readonly conflict: number;
  readonly notApplicable: number;
  /** Знаменатель: применимые условия. Неприменимые в него не входят. */
  readonly total: number;
}

export interface ProgressCounters {
  readonly actions: ActionCounts;
  readonly actionsRatio: Ratio;
  readonly conditions: ConditionCounts;
  readonly conditionsRatio: Ratio;
  /** ENG-03 / PR-06: подпись, обязательная рядом с любыми числами прогресса. */
  readonly disclaimer: string;
}

export const PROGRESS_DISCLAIMER_RU =
  'Это выполнение плана и соответствие известным формальным условиям, ' +
  'а не вероятность поступления.';

type EmptyReason = 'no_tasks' | 'no_applicable_conditions';

function ratio(done: number, total: number, emptyReason: EmptyReason): Ratio {
  if (total <= 0) {
    return {
      kind: 'undefined',
      reason: emptyReason,
      message:
        emptyReason === 'no_tasks'
          ? 'Действий в маршруте нет — доля выполненных не определена'
          : 'Применимых условий нет — доля выполненных не определена',
    };
  }
  return { kind: 'ratio', done, total, percent: Math.round((done / total) * 100) };
}

export function countActions(progress: ProgressState): ActionCounts {
  const byStatus: Record<TaskStatus, number> = {
    todo: 0,
    in_progress: 0,
    awaiting_result: 0,
    done: 0,
    skipped: 0,
    obsolete: 0,
  };
  for (const t of progress.tasks) byStatus[t.status]++;

  // Потерявшие смысл задачи не попадают ни в числитель, ни в знаменатель:
  // иначе отмена ветки маршрута «улучшала» бы прогресс сама по себе.
  const total = progress.tasks.length - byStatus.obsolete;
  const remaining = byStatus.todo + byStatus.in_progress + byStatus.awaiting_result;

  return {
    todo: byStatus.todo,
    inProgress: byStatus.in_progress,
    awaitingResult: byStatus.awaiting_result,
    done: byStatus.done,
    skipped: byStatus.skipped,
    obsolete: byStatus.obsolete,
    total,
    remaining,
  };
}

export function countConditions(evaluation: EvaluatedNode | null): ConditionCounts {
  if (!evaluation) {
    return { met: 0, notMet: 0, unknown: 0, conflict: 0, notApplicable: 0, total: 0 };
  }
  const c = countByStatus(evaluation);
  return {
    met: c.MET,
    notMet: c.NOT_MET,
    unknown: c.UNKNOWN,
    conflict: c.CONFLICT,
    notApplicable: c.NOT_APPLICABLE,
    total: c.MET + c.NOT_MET + c.UNKNOWN + c.CONFLICT,
  };
}

export function computeCounters(
  progress: ProgressState,
  evaluation: EvaluatedNode | null,
): ProgressCounters {
  const actions = countActions(progress);
  const conditions = countConditions(evaluation);

  return {
    actions,
    // Числитель действий — только ВЫПОЛНЕННЫЕ. Пропуск показывается отдельным
    // числом: он закрывает действие, но не выполняет его. Пока пропуски
    // входили в числитель, пропуск всего плана выглядел как полное выполнение
    // при нуле сделанного.
    actionsRatio: ratio(actions.done, actions.total, 'no_tasks'),
    conditions,
    conditionsRatio: ratio(conditions.met, conditions.total, 'no_applicable_conditions'),
    disclaimer: PROGRESS_DISCLAIMER_RU,
  };
}

/** Текст для интерфейса: «выполнено / осталось / неизвестно» без общего процента. */
export function describeCountersRu(c: ProgressCounters): string {
  const parts = [
    `действий выполнено ${c.actions.done} из ${c.actions.total}`,
    `осталось ${c.actions.remaining}`,
  ];
  if (c.actions.skipped > 0) parts.push(`пропущено ${c.actions.skipped}`);
  if (c.conditions.total > 0) {
    parts.push(
      `условий подтверждено ${c.conditions.met} из ${c.conditions.total}`,
      `не выполнено ${c.conditions.notMet}`,
      `неизвестно ${c.conditions.unknown}`,
    );
  }
  return `${parts.join(', ')}. ${c.disclaimer}`;
}

export { isClosed };
