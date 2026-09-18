/**
 * «Что изменилось после изменения анкеты».
 *
 * После применения анкеты пользователь должен видеть не только новую выдачу,
 * но и связь между своим ответом и пересчётом: какие поля он поменял и что
 * из-за этого стало другим в рекомендациях и в плане.
 *
 * Модуль чистый: он сравнивает два уже посчитанных снимка и ничего не решает
 * сам. Никаких «улучшилось/ухудшилось» — только факты «было → стало».
 */

import type { SessionSnapshot } from '../demo/session';
import { describeAnswer, fieldLabel, type DraftValues } from './questionnaire';

export interface ProfileFieldChange {
  readonly fieldId: string;
  readonly label: string;
  readonly before: string;
  readonly after: string;
  /**
   * Поле заполнено впервые: прежнего ответа не было вовсе.
   *
   * Для такого поля «было → стало» показывать нельзя: «не заполнено → 2027»
   * читается как ошибка в текущем профиле, хотя пользователь просто ответил
   * на вопрос первый раз.
   */
  readonly firstTime: boolean;
}

export interface RecalcSummary {
  readonly at: string;
  readonly profileRevisionBefore: number;
  readonly profileRevisionAfter: number;
  readonly changes: readonly ProfileFieldChange[];

  readonly fitBefore: number;
  readonly fitAfter: number;
  readonly alternativesBefore: number;
  readonly alternativesAfter: number;
  readonly topBefore: string | null;
  readonly topAfter: string | null;

  readonly activeGoalTitle: string | null;
  /** Осталась ли выбранная цель в числе подходящих. null — цели не было. */
  readonly activeGoalStillFits: boolean | null;
  readonly activeGoalNote: string | null;

  readonly tasksBefore: number;
  readonly tasksAfter: number;
  readonly nextActionBefore: string | null;
  readonly nextActionAfter: string | null;

  /** Отдельные наблюдения, которые стоит проговорить словами. */
  readonly notes: readonly string[];
}

/**
 * Строка, которой прежний формат обозначал отсутствие ответа.
 *
 * `describeAnswer` даёт её только для `unanswered`: «не знаю» и «не применимо»
 * — это ответы со своими текстами, и первым заполнением они не считаются.
 */
const NOT_FILLED = 'не заполнено';

/** Запись изменения из сводки, сохранённой до появления `firstTime`. */
export type LegacyProfileFieldChange = Omit<ProfileFieldChange, 'firstTime'> & {
  readonly firstTime?: boolean;
};

/** Сводка, прочитанная с диска: про `firstTime` она могла не знать. */
export type LegacyRecalcSummary = Omit<RecalcSummary, 'changes'> & {
  readonly changes?: readonly LegacyProfileFieldChange[];
};

/**
 * Досчитать `firstTime` для сводки, записанной прежней версией.
 *
 * Сохранённые сводки не переписываются и не пересчитываются: новой ревизии
 * профиля ради миграции не появляется, ответы и прогресс не трогаются.
 * Признак восстанавливается по тому, что в старой записи уже было, — по
 * тексту прежнего ответа. Единственный случай, когда его не было вовсе, —
 * `'не заполнено'`; всё остальное, включая «не знаю» и «не применимо»,
 * было ответом, и его замена показывается как правка.
 *
 * Уже проставленный `firstTime` сохраняется как есть, поэтому повторный
 * вызов ничего не меняет.
 */
export function normalizeRecalcSummary(
  summary: LegacyRecalcSummary | null | undefined,
): RecalcSummary | null {
  if (!summary) return null;

  // Данные читаются с диска: список изменений мог не дойти вовсе.
  const changes = Array.isArray(summary.changes) ? summary.changes : [];

  return {
    ...summary,
    changes: changes.map((change) => ({
      ...change,
      firstTime:
        typeof change.firstTime === 'boolean' ? change.firstTime : change.before === NOT_FILLED,
    })),
  };
}

export function diffAnswers(
  before: DraftValues,
  after: DraftValues,
  fieldIds: readonly string[],
): ProfileFieldChange[] {
  return fieldIds.map((fieldId) => {
    const previous = before[fieldId];
    // Именно состояние ответа, а не его текст: «не знаю» и «не применимо» —
    // это ответы, и их изменение показывается как обычное «было → стало».
    const firstTime = previous === undefined || previous.state === 'unanswered';

    return {
      fieldId,
      label: fieldLabel(fieldId),
      before: describeAnswer(fieldId, previous),
      after: describeAnswer(fieldId, after[fieldId]),
      firstTime,
    };
  });
}

function goalTitle(session: SessionSnapshot): string | null {
  const goal = session.activeGoal;
  return goal ? `${goal.program.title} — ${goal.university.shortName}, ${goal.path.label}` : null;
}

function topTitle(session: SessionSnapshot): string | null {
  const top = session.recommendation.recommended[0] ?? session.recommendation.alternatives[0];
  if (!top) return null;
  const goal = session.goals.find((g) => g.path.id === top.admissionPathId);
  return goal ? `${goal.program.title} — ${goal.university.shortName}` : top.admissionPathId;
}

function nextActionTitle(session: SessionSnapshot): string | null {
  return session.nextAction.kind === 'action'
    ? session.nextAction.view.task.template.title
    : null;
}

export function summarizeRecalc(input: {
  readonly at: string;
  readonly before: SessionSnapshot;
  readonly after: SessionSnapshot;
  readonly changes: readonly ProfileFieldChange[];
}): RecalcSummary {
  const { before, after } = input;

  const activeGoalId = after.activeGoal?.path.id ?? before.activeGoal?.path.id ?? null;
  const activeAssessment = activeGoalId
    ? after.recommendation.assessments.find((a) => a.admissionPathId === activeGoalId)
    : undefined;
  const stillFits = activeAssessment ? activeAssessment.bucket === 'recommended' : null;

  const notes: string[] = [];

  const fitDelta = after.recommendation.recommended.length - before.recommendation.recommended.length;
  if (fitDelta !== 0) {
    notes.push(
      fitDelta > 0
        ? `Подходящих вариантов стало больше на ${fitDelta}.`
        : `Подходящих вариантов стало меньше на ${Math.abs(fitDelta)}.`,
    );
  }

  const topBefore = topTitle(before);
  const topAfter = topTitle(after);
  if (topBefore !== topAfter) {
    notes.push(`Первый в списке изменился: «${topBefore ?? 'ничего'}» → «${topAfter ?? 'ничего'}».`);
  }

  const tasksBefore = before.route?.tasks.length ?? 0;
  const tasksAfter = after.route?.tasks.length ?? 0;
  if (tasksBefore !== tasksAfter) {
    notes.push(`Действий в маршруте: ${tasksBefore} → ${tasksAfter}.`);
  }

  const nextBefore = nextActionTitle(before);
  const nextAfter = nextActionTitle(after);
  if (nextBefore !== nextAfter) {
    notes.push(`Ближайшее действие: «${nextBefore ?? 'нет'}» → «${nextAfter ?? 'нет'}».`);
  }

  if (activeAssessment && stillFits === false) {
    notes.push(
      'Выбранная цель больше не проходит по вашим данным. Она осталась активной — ' +
        'переключение остаётся за вами.',
    );
  }

  if (notes.length === 0) {
    notes.push(
      'Состав рекомендаций и план не изменились: изменённые ответы не влияют на ' +
        'проверяемые условия этих вариантов.',
    );
  }

  return {
    at: input.at,
    profileRevisionBefore: before.profile.revision,
    profileRevisionAfter: after.profile.revision,
    changes: input.changes,

    fitBefore: before.recommendation.recommended.length,
    fitAfter: after.recommendation.recommended.length,
    alternativesBefore: before.recommendation.alternatives.length,
    alternativesAfter: after.recommendation.alternatives.length,
    topBefore,
    topAfter,

    activeGoalTitle: goalTitle(after) ?? goalTitle(before),
    activeGoalStillFits: stillFits,
    activeGoalNote: after.activeGoalIssue?.message ?? null,

    tasksBefore,
    tasksAfter,
    nextActionBefore: nextBefore,
    nextActionAfter: nextAfter,

    notes,
  };
}
