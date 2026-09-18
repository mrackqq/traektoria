/**
 * ST-01…ST-13 — расчёт стресс-теста поверх снимка фактов.
 *
 * ST-03, главный инвариант: сценарий считается на НЕИЗМЕНЯЕМОМ снимке фактов
 * плюс overlay предположений. Функция чистая, ничего не сохраняет и возвращает
 * новый объект; вызвать её дважды с тем же входом — получить тот же результат.
 *
 * ST-09 / AC-16: гипотеза не становится фактом. `overlayProfile` не имеет
 * номера ревизии факта и никогда не передаётся в команды записи.
 */

import { assessPath, DEMO_FX_RATES } from '../eligibility/recommend';
import { buildBridge, type BridgeResult, type TaskOverride } from '../planning/bridge';
import { diffScenario, type ScenarioDiff } from '../scenarios/diff';
import {
  applyOverlay,
  validateEvents,
  type EventConflict,
  type OverlayResult,
  type ScenarioEvent,
} from '../scenarios/overlay';
import { valueOf } from '../kernel/profile';
import { addDays } from '../kernel/time';
import type { GoalContext, SessionSnapshot } from './session';

export interface ScenarioRun {
  readonly title: string;
  readonly events: readonly ScenarioEvent[];
  /** ST-02: противоречивые параметры ловятся ДО расчёта. */
  readonly conflicts: readonly EventConflict[];
  readonly overlay: OverlayResult | null;
  readonly baseline: BridgeResult | null;
  readonly scenario: BridgeResult | null;
  readonly diff: ScenarioDiff | null;
  readonly goal: GoalContext | null;
}

/**
 * Перевод последствий событий в сдвиги действий.
 *
 * Здесь и только здесь знание «задержка результата IELTS ⇒ действие
 * `ielts:result` завершится позже» превращается в вход планировщика.
 */
export function overridesFrom(overlay: OverlayResult): Map<string, TaskOverride> {
  const out = new Map<string, TaskOverride>();

  for (const [semanticKey, delay] of overlay.taskDelays) {
    out.set(semanticKey, {
      availableFrom: delay.availableFrom,
      completedFraction: delay.completedFraction,
    });
  }

  for (const [examKind, resultDate] of overlay.examResultDelays) {
    const key = `${examKind.toLowerCase()}:result`;
    const prev = out.get(key);
    out.set(key, { ...prev, resultAvailableFrom: resultDate });
  }

  return out;
}

export function runScenario(
  session: SessionSnapshot,
  title: string,
  events: readonly ScenarioEvent[],
): ScenarioRun {
  const goal = session.activeGoal;
  const conflicts = validateEvents(events);

  if (!goal || conflicts.length > 0) {
    return {
      title,
      events,
      conflicts,
      overlay: null,
      baseline: session.bridge,
      scenario: null,
      diff: null,
      goal,
    };
  }

  const overlay = applyOverlay(session.profile, events);
  const weeklyHours = valueOf(session.profile.weeklyHours) ?? null;

  // Условия пересчитываются на overlay-профиле: сценарий может изменить
  // не только график, но и денежный вывод (ST-07).
  const scenarioAssessment = assessPath(
    {
      profile: overlay.overlayProfile,
      catalog: session.catalog,
      clock: session.clock,
      fxRates: DEMO_FX_RATES,
    },
    goal.intake,
    goal.path,
    DEMO_FX_RATES,
  );

  const baseline =
    session.bridge ??
    buildBridge({
      programId: goal.program.id,
      intakeId: goal.intake.id,
      admissionPathId: goal.path.id,
      evaluation: goal.assessment.tree,
      deadlines: goal.deadlines,
      clock: session.clock,
      weeklyHours,
    });

  const scenario = buildBridge({
    programId: goal.program.id,
    intakeId: goal.intake.id,
    admissionPathId: goal.path.id,
    evaluation: scenarioAssessment.tree,
    deadlines: goal.deadlines,
    clock: session.clock,
    weeklyHours,
    taskOverrides: overridesFrom(overlay),
  });

  return {
    title,
    events,
    conflicts,
    overlay,
    baseline,
    scenario,
    // ST-13: сравниваются только baseline и сценарий. Изменения каталога
    // и просто прошедшее время событию не приписываются.
    diff: diffScenario(baseline, scenario, events),
    goal,
  };
}

/* ------------------------------------------------------------------ */
/* Демонстрационные наборы событий (ST-01)                             */
/* ------------------------------------------------------------------ */

export interface DemoScenario {
  readonly id: string;
  readonly title: string;
  readonly question: string;
  readonly build: (session: SessionSnapshot) => ScenarioEvent[];
}

/**
 * «Результат экзамена задержан» — ровно тот случай, ради которого фича
 * существует: работа сделана, но внешнее ожидание выросло, и вопрос в том,
 * успевает ли график к отсечке, которую перенести нельзя (BR-07).
 */
function delayedResultEvents(session: SessionSnapshot): ScenarioEvent[] {
  const resultTask = session.taskViews.find((v) => v.task.template.kind === 'await_result');
  if (!resultTask) return [];

  const examKind = resultTask.task.semanticKey.split(':')[0]?.toUpperCase() ?? 'ENT';
  const delayed = addDays(resultTask.task.earliestFinish, 21);

  return [
    {
      id: 'ev-result-delayed',
      type: 'certificate_delayed',
      effectiveDate: session.today,
      examKind,
      newResultDate: delayed,
      explanation: `Публикация результата ${examKind} сдвинулась на три недели — до ${delayed}.`,
    },
  ];
}

/** «Пропущена сессия»: подготовка на 60% сохраняется (ST-05). */
function missedSessionEvents(session: SessionSnapshot): ScenarioEvent[] {
  const examTask = session.taskViews.find((v) => v.task.template.kind === 'take_exam');
  if (!examTask) return [];

  const semanticKey = examTask.task.semanticKey;
  const sessions = examTask.task.template.sessionDates ?? [];
  const current = examTask.task.sessionDate;
  // Следующее окно после текущего. Если его нет — это и есть ответ сценария:
  // подходящей сессии не остаётся, и планировщик обязан это показать.
  const next = current ? (sessions.find((d) => d > current) ?? addDays(current, 1)) : session.today;

  return [
    {
      id: 'ev-missed-session',
      type: 'task_skipped',
      effectiveDate: session.today,
      taskSemanticKey: semanticKey,
      completedFraction: 0,
      newAvailabilityDate: next,
      explanation: 'Ближайшая сессия пропущена: сдавать придётся в следующем окне.',
    },
    {
      id: 'ev-prep-partial',
      type: 'task_skipped',
      effectiveDate: session.today,
      taskSemanticKey: semanticKey.replace(':take', ':prepare'),
      completedFraction: 0.6,
      newAvailabilityDate: session.today,
      explanation: 'Подготовка выполнена примерно на 60% — этот результат не теряется.',
    },
  ];
}

/** «Бюджет сокращён вдвое» — измерение денег, а не графика (ST-07). */
function budgetCutEvents(session: SessionSnapshot): ScenarioEvent[] {
  const budget = valueOf(session.profile.budget);
  if (!budget) return [];

  return [
    {
      id: 'ev-budget-cut',
      type: 'budget_changed',
      effectiveDate: session.today,
      budget: {
        ...budget,
        limit: { ...budget.limit, amountMinor: budget.limit.amountMinor / 2n },
      },
      explanation: 'Доступный бюджет на обучение уменьшился вдвое.',
    },
  ];
}

export const DEMO_SCENARIOS: readonly DemoScenario[] = [
  {
    id: 'delayed-result',
    title: 'Результат экзамена задержан на три недели',
    question: 'Успеет ли график к отсечке, если публикация результата сдвинется?',
    build: delayedResultEvents,
  },
  {
    id: 'missed-session',
    title: 'Пропущена ближайшая экзаменационная сессия',
    question: 'Что произойдёт с маршрутом и сохранится ли уже сделанная подготовка?',
    build: missedSessionEvents,
  },
  {
    id: 'budget-cut',
    title: 'Бюджет на обучение сокращён вдвое',
    question: 'Какие пути подачи остаются совместимыми с деньгами?',
    build: budgetCutEvents,
  },
];

export function findDemoScenario(id: string | undefined): DemoScenario {
  return DEMO_SCENARIOS.find((s) => s.id === id) ?? DEMO_SCENARIOS[0]!;
}
