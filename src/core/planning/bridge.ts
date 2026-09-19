/**
 * BR-01…BR-12 — «Мост к мечте».
 *
 * Обратное планирование идёт от КАЖДОГО внешнего дедлайна (BR-06).
 * Жёсткая внешняя отсечка планировщиком не переносится (BR-07).
 * Оценка выполнимости честно различает «график сходится при указанных
 * предположениях» и «мы не смогли доказать обратное» (BR-10).
 */

import {
  addWorkingDays,
  conservativeCutoff,
  daysBetween,
  isUncertain,
  KZ_CALENDAR,
  subWorkingDays,
  utcMsToPlainDate,
  type Deadline,
  type PlainDate,
  type PlanningClock,
  type WorkCalendar,
} from '../kernel/time';
import { addMoney, money, sumMoney, type Money } from '../kernel/money';
import type { EvaluatedNode } from '../eligibility/evaluate';
import { flattenLeaves } from '../eligibility/evaluate';
import {
  DEFAULT_SEARCH_LIMITS,
  enumerateSatisfaction,
  type SatisfactionPlan,
  type SearchLimits,
} from './satisfaction';
import {
  findTemplate,
  templatesForCountingKey,
  type ExamProgress,
  type Range,
  type TaskKind,
  type TaskTemplate,
} from './tasks-library';

/**
 * Виды действий, у которых обычно есть плата.
 *
 * Регистрация на экзамен — взнос, получение документа — пошлина или
 * нотариальное заверение. У подачи заявления, ожидания результата,
 * подготовки и рекомендованных активностей своей суммы нет: их отсутствие
 * не признак неполноты данных.
 */
const PAYABLE_TASK_KINDS: readonly TaskKind[] = ['register', 'obtain_document'];

/* ------------------------------------------------------------------ */
/* Типы                                                                */
/* ------------------------------------------------------------------ */

export interface PlannedTask {
  readonly id: string;
  readonly semanticKey: string;
  readonly template: TaskTemplate;
  /** Листья требований, которые закрывает эта задача. */
  readonly closesLeafIds: readonly string[];
  readonly dependsOn: readonly string[];
  /** Внешняя отсечка, которой подчинена задача. */
  readonly boundByDeadlineId: string | null;
  /**
   * Закрывает ли задача хотя бы одно КРИТИЧЕСКОЕ условие.
   *
   * Нужно, чтобы «ближайшим шагом» не оказывалось действие, которое никого не
   * отбирает. Аттестат получают все, кто доучился, и ставить его впереди
   * подготовки к экзамену — значит показывать человеку не тот приоритет.
   */
  readonly critical: boolean;
}

export interface ScheduledTask extends PlannedTask {
  readonly earliestStart: PlainDate;
  readonly earliestFinish: PlainDate;
  readonly latestStart: PlainDate | null;
  readonly latestFinish: PlainDate | null;
  /** Резерв времени в днях. null — отсечка неизвестна, резерв не считается. */
  readonly slackDays: number | null;
  /** Назначенная дата сессии для экзамена, если окна опубликованы. */
  readonly sessionDate?: PlainDate;
  readonly violatesDeadline: boolean;
  /** BR-07 / AC-08: отсечка известна не полностью — обратный отсчёт не рисуем. */
  readonly deadlineUncertain: boolean;
}

export type FeasibilityStatus =
  | 'feasible_under_assumptions'
  | 'infeasible_under_assumptions'
  | 'undetermined'
  | 'search_incomplete';

export const FEASIBILITY_LABEL_RU: Record<FeasibilityStatus, string> = {
  // BR-10: даже положительный статус означает выполнимость ГРАФИКА при
  // указанных предположениях, а не достижение балла и не поступление.
  feasible_under_assumptions: 'График сходится при указанных предположениях',
  infeasible_under_assumptions: 'График не сходится ни по одному рассмотренному пути',
  undetermined: 'Не определено: сходится только по оптимистичным оценкам',
  search_incomplete: 'Поиск неполный: решение не найдено, но невозможность не доказана',
};

export interface Limitation {
  readonly code:
    | 'DEADLINE_MISSED'
    | 'WEEKLY_LOAD_EXCEEDED'
    | 'NO_EXAM_SESSION_IN_WINDOW'
    | 'RESULT_AFTER_CUTOFF'
    | 'DEADLINE_UNKNOWN'
    | 'DATA_CONFLICT'
    | 'STALE_CRITICAL_SOURCE';
  readonly message: string;
  readonly taskId?: string;
  readonly deadlineId?: string;
}

export interface FeasibilityResult {
  readonly status: FeasibilityStatus;
  readonly limitations: readonly Limitation[];
  readonly requiredWeeklyHours: number;
  readonly availableWeeklyHours: number | null;
}

export interface BridgeRoute {
  readonly id: string;
  readonly label: string;
  readonly rationale: string;
  readonly plan: SatisfactionPlan;
  readonly tasks: readonly ScheduledTask[];
  readonly totalEffortHours: Range;
  readonly totalCost: Money | null;
  readonly costIncomplete: boolean;
  readonly feasibility: FeasibilityResult;
}

export interface BridgeWarning {
  readonly code: string;
  readonly message: string;
}

export interface BridgeResult {
  readonly programId: string;
  readonly intakeId: string;
  readonly admissionPathId: string;
  readonly evaluation: EvaluatedNode;
  readonly routes: readonly BridgeRoute[];
  /** BR-09: сколько альтернатив рассмотрено и полон ли перебор. */
  readonly consideredCount: number;
  readonly searchComplete: boolean;
  readonly stopReason?: string;
  readonly nextAction: ScheduledTask | null;
  readonly nextActionReason: string;
  readonly warnings: readonly BridgeWarning[];
  readonly startDate: PlainDate;
}

/**
 * Последствие события сценария для одного действия (ST-04, ST-05).
 *
 * Планировщик не знает про сценарии: он принимает уже посчитанные сдвиги.
 * Так изоляция симуляции (ST-03) не зависит от дисциплины вызывающего кода —
 * мост в обоих случаях считает одну и ту же чистую функцию от входа.
 */
export interface TaskOverride {
  /** Действие недоступно раньше этой даты (пропущенная сессия, перенос). */
  readonly availableFrom?: PlainDate;
  /**
   * Дата зафиксирована извне и не подбирается по опубликованным окнам:
   * человек уже записан на конкретную дату экзамена.
   */
  readonly pinnedDate?: PlainDate;
  /** ST-05: уже выполненная доля подготовки 0…1. Она не теряется при перестройке. */
  readonly completedFraction?: number;
  /** Внешний результат придёт не раньше этой даты. */
  readonly resultAvailableFrom?: PlainDate;
}

export interface BridgeInput {
  readonly programId: string;
  readonly intakeId: string;
  readonly admissionPathId: string;
  readonly evaluation: EvaluatedNode;
  readonly deadlines: readonly Deadline[];
  readonly clock: PlanningClock;
  readonly weeklyHours: number | null;
  readonly calendar?: WorkCalendar;
  readonly limits?: SearchLimits;
  /** Сдвиги по семантическому ключу действия. Пусто — базовый расчёт. */
  readonly taskOverrides?: ReadonlyMap<string, TaskOverride>;
  /**
   * Что с экзаменами уже произошло. Пусто — считаем, что ничего: тогда
   * назначается полная цепочка подготовка → регистрация → сдача → результат.
   */
  readonly examProgress?: ReadonlyMap<string, ExamProgress>;
  /** Ограничения расчёта, замеченные вне планировщика (например, в профиле). */
  readonly warnings?: readonly BridgeWarning[];
  /**
   * Рекомендуемые активности для этой цели.
   *
   * Попадают в маршрут как советы: не закрывают условий, не блокируют подачу
   * и не участвуют в проверке недельной нагрузки.
   */
  readonly advisoryKeys?: readonly string[];
}

/* ------------------------------------------------------------------ */
/* Точка входа                                                         */
/* ------------------------------------------------------------------ */

export function buildBridge(input: BridgeInput): BridgeResult {
  const calendar = input.calendar ?? KZ_CALENDAR;
  const limits = input.limits ?? DEFAULT_SEARCH_LIMITS;
  const startDate = utcMsToPlainDate(Date.parse(input.clock.now));

  const search = enumerateSatisfaction(input.evaluation, limits);
  const warnings: BridgeWarning[] = [...(input.warnings ?? [])];

  const leaves = flattenLeaves(input.evaluation);
  if (leaves.some((l) => l.reasonCodes.includes('SOURCE_CONFLICT'))) {
    warnings.push({
      code: 'DATA_CONFLICT',
      message:
        'По части условий официальные источники расходятся. Пока конфликт не разрешён, ' +
        'положительный вывод по ним не делается.',
    });
  }
  if (leaves.some((l) => l.reasonCodes.includes('SOURCE_STALE_CRITICAL'))) {
    warnings.push({
      code: 'STALE_SOURCE',
      message: 'Срок проверки части источников истёк — эти условия требуют перепроверки.',
    });
  }
  if (input.deadlines.some(isUncertain)) {
    warnings.push({
      code: 'DEADLINE_UNCERTAIN',
      message:
        'Для части сроков источник не указал время или часовой пояс. Планируем ' +
        'по самой ранней возможной границе и не показываем точный обратный отсчёт.',
    });
  }
  if (!search.complete) {
    warnings.push({
      code: 'SEARCH_INCOMPLETE',
      message:
        `Перебор остановлен по лимиту (${search.branchesExplored} ветвей). Показаны лучшие ` +
        'среди рассмотренных путей; это не доказательство отсутствия других.',
    });
  }

  // BR-09: до трёх содержательно разных маршрутов.
  const candidates = search.plans.slice(0, 12).map((plan, idx) =>
    scheduleRoute({
      plan,
      idx,
      evaluation: input.evaluation,
      deadlines: input.deadlines,
      startDate,
      calendar,
      weeklyHours: input.weeklyHours,
      searchComplete: search.complete,
      overrides: input.taskOverrides ?? EMPTY_OVERRIDES,
      examProgress: input.examProgress ?? EMPTY_EXAM_PROGRESS,
      advisoryKeys: input.advisoryKeys ?? [],
    }),
  );

  const routes = pickDistinctRoutes(candidates);
  const best = routes[0] ?? null;
  const next = best ? pickNextAction(best, startDate) : null;

  return {
    programId: input.programId,
    intakeId: input.intakeId,
    admissionPathId: input.admissionPathId,
    evaluation: input.evaluation,
    routes,
    consideredCount: search.plans.length,
    searchComplete: search.complete,
    ...(search.stopReason ? { stopReason: search.stopReason } : {}),
    nextAction: next?.task ?? null,
    nextActionReason: next?.reason ?? 'Готовых к выполнению действий сейчас нет.',
    warnings,
    startDate,
  };
}

/* ------------------------------------------------------------------ */
/* Построение графа задач (BR-04, BR-05)                               */
/* ------------------------------------------------------------------ */

function buildTasks(
  plan: SatisfactionPlan,
  evaluation: EvaluatedNode,
  deadlines: readonly Deadline[],
  examProgress: ReadonlyMap<string, ExamProgress>,
  advisoryKeys: readonly string[],
): PlannedTask[] {
  const leaves = flattenLeaves(evaluation);
  const byId = new Map(leaves.map((l) => [l.nodeId, l]));

  // BR-05: общие действия объединяются по семантическому ключу.
  const bySemantic = new Map<string, { template: TaskTemplate; closes: Set<string> }>();

  const addChain = (countingKey: string, leafId: string): void => {
    for (const key of templatesForCountingKey(countingKey, examProgress)) {
      const template = findTemplate(key);
      if (!template) continue;
      const existing = bySemantic.get(key);
      if (existing) {
        existing.closes.add(leafId);
      } else {
        bySemantic.set(key, { template, closes: new Set([leafId]) });
      }
    }
  };

  for (const leafId of plan.requiredLeafIds) {
    const leaf = byId.get(leafId);
    if (!leaf?.countingKey) continue;
    addChain(leaf.countingKey, leafId);
  }

  // Неизвестные и конфликтные условия порождают задачу уточнения, а не
  // молчаливое допущение (DATA-04, DATA-06).
  const needVerify = leaves.filter(
    (l) =>
      l.outcome.kind === 'evaluated' &&
      (l.outcome.status === 'UNKNOWN' || l.outcome.status === 'CONFLICT'),
  );
  if (needVerify.length > 0) {
    const template = findTemplate('data:verify');
    if (template) {
      bySemantic.set('data:verify', {
        template,
        closes: new Set(needVerify.map((l) => l.nodeId)),
      });
    }
  }

  // Рекомендуемые активности: полезны, но ничего не закрывают.
  for (const key of advisoryKeys) {
    const template = findTemplate(key);
    if (template) bySemantic.set(key, { template, closes: new Set() });
  }

  // Подача заявления завершает маршрут всегда.
  const submit = findTemplate('application:submit');
  if (submit) bySemantic.set('application:submit', { template: submit, closes: new Set() });

  const criticalLeafIds = new Set(leaves.filter((l) => l.critical).map((l) => l.nodeId));

  const tasks: PlannedTask[] = [];
  for (const [key, { template, closes }] of bySemantic) {
    tasks.push({
      id: `task:${key}`,
      semanticKey: key,
      template,
      closesLeafIds: [...closes],
      dependsOn: template.dependsOnKeys
        .filter((k) => bySemantic.has(k))
        .map((k) => `task:${k}`),
      boundByDeadlineId: deadlineForTask(template, deadlines)?.id ?? null,
      // Подача заявления не закрывает листьев, но обязательна всегда.
      critical:
        key === 'application:submit' ||
        [...closes].some((id) => criticalLeafIds.has(id)),
    });
  }

  // Подача заявления зависит от всего ОБЯЗАТЕЛЬНОГО. Рекомендуемая активность
  // подачу не блокирует: иначе совет превратился бы в условие приёма.
  const submitTask = tasks.find((t) => t.semanticKey === 'application:submit');
  if (submitTask) {
    const deps = tasks
      .filter((t) => t.id !== submitTask.id && !t.template.advisory)
      .map((t) => t.id);
    tasks[tasks.indexOf(submitTask)] = { ...submitTask, dependsOn: deps };
  }

  return tasks;
}

/** BR-06: у разных типов действий разные отсечки. */
function deadlineForTask(
  template: TaskTemplate,
  deadlines: readonly Deadline[],
): Deadline | undefined {
  const pick = (kind: Deadline['kind']) => deadlines.find((d) => d.kind === kind);
  switch (template.kind) {
    case 'submit_application':
      return pick('application_submission');
    case 'await_result':
      return pick('result_submission') ?? pick('application_submission');
    case 'obtain_document':
      return pick('document_receipt') ?? pick('application_submission');
    default:
      return pick('result_submission') ?? pick('application_submission');
  }
}

/** BR-04: циклы блокируют расчёт, а не «чинятся» молча. */
export function detectCycle(tasks: readonly PlannedTask[]): string[] | null {
  const state = new Map<string, 0 | 1 | 2>();
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const stack: string[] = [];
  let cycle: string[] | null = null;

  const visit = (id: string): void => {
    if (cycle) return;
    const s = state.get(id) ?? 0;
    if (s === 1) {
      cycle = [...stack.slice(stack.indexOf(id)), id];
      return;
    }
    if (s === 2) return;
    state.set(id, 1);
    stack.push(id);
    for (const dep of byId.get(id)?.dependsOn ?? []) visit(dep);
    stack.pop();
    state.set(id, 2);
  };

  for (const t of tasks) visit(t.id);
  return cycle;
}

function topoSort(tasks: readonly PlannedTask[]): PlannedTask[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const visited = new Set<string>();
  const out: PlannedTask[] = [];
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    visited.add(id);
    const t = byId.get(id);
    if (!t) return;
    for (const dep of t.dependsOn) visit(dep);
    out.push(t);
  };
  for (const t of tasks) visit(t.id);
  return out;
}

/* ------------------------------------------------------------------ */
/* Планирование маршрута (BR-06, BR-10)                                */
/* ------------------------------------------------------------------ */

interface ScheduleArgs {
  plan: SatisfactionPlan;
  idx: number;
  evaluation: EvaluatedNode;
  deadlines: readonly Deadline[];
  startDate: PlainDate;
  calendar: WorkCalendar;
  weeklyHours: number | null;
  searchComplete: boolean;
  overrides: ReadonlyMap<string, TaskOverride>;
  examProgress: ReadonlyMap<string, ExamProgress>;
  advisoryKeys: readonly string[];
}

const EMPTY_OVERRIDES: ReadonlyMap<string, TaskOverride> = new Map();
const EMPTY_EXAM_PROGRESS: ReadonlyMap<string, ExamProgress> = new Map();

function scheduleRoute(args: ScheduleArgs): BridgeRoute {
  const tasks = buildTasks(
    args.plan,
    args.evaluation,
    args.deadlines,
    args.examProgress,
    args.advisoryKeys,
  );

  const cycle = detectCycle(tasks);
  if (cycle) {
    // BR-04 / AC-23: цикл — ошибка данных или шаблона, а не «невозможность».
    return {
      id: `route-${args.idx}`,
      label: 'Маршрут не построен',
      rationale: 'В шаблоне действий обнаружен цикл зависимостей.',
      plan: args.plan,
      tasks: [],
      totalEffortHours: { min: 0, max: 0 },
      totalCost: null,
      costIncomplete: true,
      feasibility: {
        status: 'search_incomplete',
        limitations: [
          {
            code: 'DATA_CONFLICT',
            message: `Цикл зависимостей: ${cycle.join(' → ')}. Это ошибка конфигурации данных.`,
          },
        ],
        requiredWeeklyHours: 0,
        availableWeeklyHours: args.weeklyHours,
      },
    };
  }

  const conservative = runSchedule(tasks, args, 'conservative');
  const optimistic = runSchedule(tasks, args, 'optimistic');

  // BR-10: два проверенных графика.
  let status: FeasibilityStatus;
  if (conservative.ok) {
    status = 'feasible_under_assumptions';
  } else if (optimistic.ok) {
    status = 'undetermined';
  } else if (args.searchComplete) {
    status = 'infeasible_under_assumptions';
  } else {
    status = 'search_incomplete';
  }

  const effortMin = tasks.reduce((s, t) => s + t.template.effortHours.min, 0);
  const effortMax = tasks.reduce((s, t) => s + t.template.effortHours.max, 0);

  const costs = tasks.map((t) => t.template.cost).filter((c): c is Money => !!c);
  const totalCost = costs.length > 0 ? sumMoney(costs, costs[0]!.currency) : null;

  // DATA-09: неполной стоимость считается тогда, когда сумма не опубликована
  // у действия, которое её ОБЫЧНО имеет.
  //
  // Прежнее правило сравнивало число известных сумм с числом всех
  // не-подготовительных действий и потому взводило флаг всегда: у подачи
  // заявления, ожидания результата и рекомендованных активностей своей
  // стоимости нет по замыслу, а не по незнанию. Флаг, поднятый на каждом
  // маршруте, не сообщает ничего.
  const costIncomplete = tasks.some(
    (t) => PAYABLE_TASK_KINDS.includes(t.template.kind) && !t.template.cost,
  );

  return {
    id: `route-${args.idx}`,
    label: routeLabel(args.idx),
    rationale: routeRationale(args.idx, tasks.length, effortMax),
    plan: args.plan,
    tasks: conservative.tasks,
    totalEffortHours: { min: effortMin, max: effortMax },
    totalCost,
    costIncomplete,
    feasibility: {
      status,
      limitations: conservative.ok ? optimistic.limitations : conservative.limitations,
      requiredWeeklyHours: conservative.requiredWeeklyHours,
      availableWeeklyHours: args.weeklyHours,
    },
  };
}

interface ScheduleRun {
  ok: boolean;
  tasks: ScheduledTask[];
  limitations: Limitation[];
  requiredWeeklyHours: number;
}

function runSchedule(
  tasks: readonly PlannedTask[],
  args: ScheduleArgs,
  mode: 'conservative' | 'optimistic',
): ScheduleRun {
  const pick = (r: Range) => (mode === 'conservative' ? r.max : r.min);
  const cal = args.calendar;
  const ordered = topoSort(tasks);
  const limitations: Limitation[] = [];

  const earliestStart = new Map<string, PlainDate>();
  const earliestFinish = new Map<string, PlainDate>();
  const sessionOf = new Map<string, PlainDate>();

  // Прямой проход: самые ранние даты с учётом зависимостей.
  for (const t of ordered) {
    let start = args.startDate;
    for (const dep of t.dependsOn) {
      const depFinish = earliestFinish.get(dep);
      if (depFinish && daysBetween(start, depFinish) > 0) start = depFinish;
    }

    // Последствие события сценария. Применяется ДО поиска сессии: пропущенная
    // сессия должна привести к следующей, а не к прежней дате.
    const ov = args.overrides.get(t.semanticKey);
    if (ov?.availableFrom && daysBetween(start, ov.availableFrom) > 0) {
      start = ov.availableFrom;
    }

    // Дата, на которую человек уже записан, не подбирается заново.
    if (ov?.pinnedDate) {
      start = ov.pinnedDate;
      sessionOf.set(t.id, ov.pinnedDate);
    } else if (t.template.sessionDates && t.template.sessionDates.length > 0) {
      // Окна проведения экзамена: задача не может состояться вне сессии.
      const session = t.template.sessionDates.find((d) => daysBetween(start, d) >= 0);
      if (!session) {
        limitations.push({
          code: 'NO_EXAM_SESSION_IN_WINDOW',
          taskId: t.id,
          message: `Для «${t.template.title}» нет доступной сессии после ${start}.`,
        });
        // Дату НЕ откатываем к началу плана: сдать экзамен раньше, чем задача
        // стала доступна, нельзя, а расписание с датой в прошлом выглядело бы
        // в diff как «перенос на 275 дней раньше» (ST-04 требует правдивой
        // цепочки причин). Ограничение уже зафиксировано — оно и есть ответ.
      } else {
        start = session;
        sessionOf.set(t.id, session);
      }
    }

    // ST-05: выполненная часть подготовки сохраняется — остаётся доделать остаток.
    const remaining = 1 - clamp01(ov?.completedFraction ?? 0);
    const durationDays = Math.round(Math.max(0, pick(t.template.durationDays)) * remaining);
    const waitDays = Math.max(0, pick(t.template.externalWaitDays));
    const activeEnd = durationDays > 0 ? addWorkingDays(start, durationDays, cal) : start;
    // Внешнее ожидание идёт календарными днями: оно не зависит от рабочих дней.
    let finish = waitDays > 0 ? addDaysPlain(activeEnd, waitDays) : activeEnd;

    // Задержка внешнего результата отодвигает готовность, а не работу.
    if (ov?.resultAvailableFrom && daysBetween(finish, ov.resultAvailableFrom) > 0) {
      finish = ov.resultAvailableFrom;
    }

    earliestStart.set(t.id, start);
    earliestFinish.set(t.id, finish);
  }

  // Обратный проход: BR-06, от каждой внешней отсечки.
  const latestFinish = new Map<string, PlainDate | null>();
  const latestStart = new Map<string, PlainDate | null>();

  for (const t of [...ordered].reverse()) {
    let lf: PlainDate | null = null;

    const dl = args.deadlines.find((d) => d.id === t.boundByDeadlineId);
    if (dl) {
      const cutoff = conservativeCutoff(dl);
      if (cutoff) lf = utcMsToPlainDate(Date.parse(cutoff.utc));
    }

    // Ограничение со стороны зависимых задач.
    for (const succ of ordered) {
      if (!succ.dependsOn.includes(t.id)) continue;
      const succStart = latestStart.get(succ.id);
      if (succStart && (lf === null || daysBetween(succStart, lf) > 0)) lf = succStart;
    }

    latestFinish.set(t.id, lf);
    if (lf === null) {
      latestStart.set(t.id, null);
      continue;
    }
    const waitDays = Math.max(0, pick(t.template.externalWaitDays));
    // Тот же остаток длительности, что и в прямом проходе: иначе резерв
    // считался бы по работе, которую уже не надо делать.
    const remainingBack = 1 - clamp01(args.overrides.get(t.semanticKey)?.completedFraction ?? 0);
    const durationDays = Math.round(Math.max(0, pick(t.template.durationDays)) * remainingBack);
    const afterWait = waitDays > 0 ? addDaysPlain(lf, -waitDays) : lf;
    latestStart.set(t.id, durationDays > 0 ? subWorkingDays(afterWait, durationDays, cal) : afterWait);
  }

  // Сборка и проверка нарушений.
  const scheduled: ScheduledTask[] = ordered.map((t) => {
    const es = earliestStart.get(t.id)!;
    const ef = earliestFinish.get(t.id)!;
    const ls = latestStart.get(t.id) ?? null;
    const lf = latestFinish.get(t.id) ?? null;
    const dl = args.deadlines.find((d) => d.id === t.boundByDeadlineId);
    const violates = ls !== null && daysBetween(es, ls) < 0;

    if (violates) {
      limitations.push({
        code: t.template.kind === 'await_result' ? 'RESULT_AFTER_CUTOFF' : 'DEADLINE_MISSED',
        taskId: t.id,
        deadlineId: t.boundByDeadlineId ?? undefined,
        message:
          `«${t.template.title}»: самое раннее завершение ${ef}, а крайний срок ${lf}. ` +
          'Отсечка планировщиком не переносится.',
      });
    }
    if (dl && isUncertain(dl)) {
      limitations.push({
        code: 'DEADLINE_UNKNOWN',
        taskId: t.id,
        deadlineId: dl.id,
        message: `Срок «${t.template.title}» известен не полностью — точный отсчёт не строится.`,
      });
    }

    return {
      ...t,
      earliestStart: es,
      earliestFinish: ef,
      latestStart: ls,
      latestFinish: lf,
      slackDays: ls !== null ? daysBetween(es, ls) : null,
      ...(sessionOf.has(t.id) ? { sessionDate: sessionOf.get(t.id)! } : {}),
      violatesDeadline: violates,
      deadlineUncertain: !!dl && isUncertain(dl),
    };
  });

  // BR-10: проверка недельной нагрузки. Рекомендуемые активности в неё не
  // входят: их можно не делать, и график из-за них не объявляется несходящимся.
  const totalEffort = ordered
    .filter((t) => !t.template.advisory)
    .reduce((sum, t) => sum + pick(t.template.effortHours), 0);
  const horizonDays = Math.max(
    1,
    Math.max(...scheduled.map((s) => daysBetween(args.startDate, s.earliestFinish)), 1),
  );
  const weeks = Math.max(1, horizonDays / 7);
  const requiredWeeklyHours = Math.round((totalEffort / weeks) * 10) / 10;

  if (args.weeklyHours !== null && requiredWeeklyHours > args.weeklyHours) {
    limitations.push({
      code: 'WEEKLY_LOAD_EXCEEDED',
      message:
        `Нужно примерно ${requiredWeeklyHours} ч в неделю, а доступно ${args.weeklyHours} ч. ` +
        'Календарная выполнимость не подтверждается.',
    });
  }

  const hardViolations = limitations.filter(
    (l) =>
      l.code === 'DEADLINE_MISSED' ||
      l.code === 'RESULT_AFTER_CUTOFF' ||
      l.code === 'WEEKLY_LOAD_EXCEEDED' ||
      l.code === 'NO_EXAM_SESSION_IN_WINDOW',
  );

  return { ok: hardViolations.length === 0, tasks: scheduled, limitations, requiredWeeklyHours };
}

function addDaysPlain(d: PlainDate, days: number): PlainDate {
  return utcMsToPlainDate(Date.parse(`${d}T00:00:00Z`) + days * 86_400_000);
}

/* ------------------------------------------------------------------ */
/* Выбор маршрутов и следующего шага                                   */
/* ------------------------------------------------------------------ */

function routeLabel(idx: number): string {
  return ['По вашим предпочтениям', 'С меньшими известными расходами', 'С меньшей нагрузкой'][idx] ??
    `Вариант ${idx + 1}`;
}

function routeRationale(idx: number, taskCount: number, effortMax: number): string {
  const base = `${taskCount} действий, до ${effortMax} ч работы.`;
  switch (idx) {
    case 0:
      return `${base} Использует альтернативы, ближайшие к вашим текущим результатам.`;
    case 1:
      return `${base} Минимизирует известные расходы среди рассмотренных путей.`;
    case 2:
      return `${base} Распределяет нагрузку равномернее.`;
    default:
      return base;
  }
}

/** BR-09: маршруты должны быть содержательно РАЗНЫМИ, а не тремя копиями. */
function pickDistinctRoutes(candidates: readonly BridgeRoute[]): BridgeRoute[] {
  const out: BridgeRoute[] = [];
  const seenSignatures = new Set<string>();

  const ranked = [...candidates].sort((a, b) => {
    const rank: Record<FeasibilityStatus, number> = {
      feasible_under_assumptions: 0,
      undetermined: 1,
      search_incomplete: 2,
      infeasible_under_assumptions: 3,
    };
    if (rank[a.feasibility.status] !== rank[b.feasibility.status]) {
      return rank[a.feasibility.status] - rank[b.feasibility.status];
    }
    if (a.tasks.length !== b.tasks.length) return a.tasks.length - b.tasks.length;
    return a.totalEffortHours.max - b.totalEffortHours.max;
  });

  for (const r of ranked) {
    const signature = r.tasks.map((t) => t.semanticKey).sort().join('|');
    if (seenSignatures.has(signature)) continue;
    seenSignatures.add(signature);
    out.push({ ...r, id: `route-${out.length}`, label: routeLabel(out.length) });
    if (out.length === 3) break;
  }
  return out;
}

/**
 * TASK-04: следующий шаг выбирается среди ДОСТУПНЫХ задач с учётом ближайшей
 * отсечки, зависимостей и нагрузки. Объяснение приоритета обязательно.
 */
function pickNextAction(
  route: BridgeRoute,
  today: PlainDate,
): { task: ScheduledTask; reason: string } | null {
  const done = new Set<string>();
  const available = route.tasks.filter((t) => t.dependsOn.every((d) => done.has(d)));
  if (available.length === 0) return null;

  const sorted = [...available].sort((a, b) => {
    // Сначала то, у чего меньше резерв. Неизвестный резерв — в конец.
    const as = a.slackDays ?? Number.MAX_SAFE_INTEGER;
    const bs = b.slackDays ?? Number.MAX_SAFE_INTEGER;
    if (as !== bs) return as - bs;
    return daysBetween(today, a.earliestStart) - daysBetween(today, b.earliestStart);
  });

  const task = sorted[0]!;
  const parts: string[] = [];
  if (task.slackDays !== null) {
    parts.push(
      task.slackDays <= 0
        ? 'резерв времени исчерпан'
        : `резерв всего ${task.slackDays} дн. — наименьший среди доступных действий`,
    );
  } else {
    parts.push('срок по этому действию известен не полностью, начать стоит заранее');
  }
  if (task.dependsOn.length === 0) parts.push('оно не ждёт других задач');
  if (task.sessionDate) parts.push(`ближайшая сессия — ${task.sessionDate}`);

  return { task, reason: `Выбрано, потому что ${parts.join(', ')}.` };
}

export { addDaysPlain };

/** Доля выполненного не бывает вне 0…1; мусор во входе не ломает расписание. */
function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
