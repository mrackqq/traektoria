/**
 * TASK-04 — ближайшее действие и диагноз, когда действий нет.
 *
 * Два требования, которые здесь главные:
 *  • «Объяснение приоритета обязательно» — результат всегда несёт разбор
 *    причин, а не только ссылку на задачу;
 *  • «Если готовых действий нет — показать конкретную блокировку или задачу
 *    уточнения, не оставлять пустой dashboard» — поэтому у функции нет
 *    ветки «ничего»: каждый исход содержит текст и следующий шаг.
 *
 * TASK-01: блокировка и просрочка считаются здесь как признаки поверх
 * статуса и не заменяют его.
 */

import { flattenLeaves, type EvaluatedNode } from '../eligibility/evaluate';
import { daysBetween, formatPlainDateRu, type PlainDate } from '../kernel/time';
import type { ScheduledTask } from '../planning/bridge';
import {
  isClosed,
  satisfiesDependency,
  TASK_STATUS_LABEL_RU,
  type ProgressState,
  type TaskState,
} from './state';

/* ------------------------------------------------------------------ */
/* Вычисляемые признаки (TASK-01)                                      */
/* ------------------------------------------------------------------ */

export interface TaskFlags {
  /** Зависимость ещё не закрыта. */
  readonly blocked: boolean;
  readonly blockedBy: readonly string[];
  /** Директивный срок прошёл. При неполной отсечке не выставляется (BR-07). */
  readonly overdue: boolean;
  /** Начинать уже поздно, чтобы уложиться к отсечке. */
  readonly startsLate: boolean;
  /** BR-07 / AC-08: отсечка известна не полностью — обратный отсчёт не рисуем. */
  readonly dueUncertain: boolean;
  readonly slackDays: number | null;
}

export interface TaskView {
  readonly task: ScheduledTask;
  readonly state: TaskState;
  readonly flags: TaskFlags;
}

/**
 * Снята ли зависимость.
 *
 * Пропуск зависимость НЕ снимает: пропустить регистрацию на экзамен не значит
 * зарегистрироваться. Зависимая задача остаётся заблокированной, и в разделе
 * «что мешает» видно, какое именно пропущенное действие нужно вернуть в план.
 *
 * Неизвестная зависимость не блокирует: её нет в маршруте, значит она
 * не требуется. Иначе исчезнувшая задача навсегда парализовала бы план.
 */
function dependencySatisfied(dep: TaskState | undefined): boolean {
  return dep === undefined || satisfiesDependency(dep.status);
}

export function buildTaskViews(
  tasks: readonly ScheduledTask[],
  progress: ProgressState,
  today: PlainDate,
): TaskView[] {
  const states = new Map(progress.tasks.map((t) => [t.taskId, t]));

  return tasks.map((task) => {
    const state =
      states.get(task.id) ??
      ({
        taskId: task.id,
        semanticKey: task.semanticKey,
        kind: task.template.kind,
        dependsOn: task.dependsOn,
        status: 'todo',
        evidenceId: null,
        history: [],
      } satisfies TaskState);

    const blockedBy = task.dependsOn.filter((id) => !dependencySatisfied(states.get(id)));
    const closed = isClosed(state.status);
    const certain = !task.deadlineUncertain;

    return {
      task,
      state,
      flags: {
        blocked: blockedBy.length > 0,
        blockedBy,
        overdue:
          !closed && certain && task.latestFinish !== null && task.latestFinish < today,
        startsLate:
          !closed &&
          certain &&
          state.status === 'todo' &&
          task.latestStart !== null &&
          task.latestStart < today,
        dueUncertain: task.deadlineUncertain,
        slackDays: task.slackDays,
      },
    };
  });
}

/* ------------------------------------------------------------------ */
/* Выбор ближайшего действия                                           */
/* ------------------------------------------------------------------ */

export type ReasonFactorCode =
  | 'OVERDUE'
  | 'NO_SLACK'
  | 'LOW_SLACK'
  | 'DEADLINE_UNCERTAIN'
  | 'NO_DEPENDENCIES'
  | 'ALREADY_STARTED'
  | 'LOAD_LIMIT'
  | 'SESSION_WINDOW'
  | 'ONLY_AVAILABLE';

export interface ReasonFactor {
  readonly code: ReasonFactorCode;
  readonly text: string;
}

export type NextActionOutcome =
  | {
      readonly kind: 'action';
      readonly view: TaskView;
      readonly factors: readonly ReasonFactor[];
      readonly explanation: string;
      /** Сколько ещё действий было доступно к выбору — честный контекст приоритета. */
      readonly alternativesCount: number;
    }
  | {
      readonly kind: 'awaiting_external';
      readonly views: readonly TaskView[];
      readonly explanation: string;
      readonly hint: string;
    }
  | {
      readonly kind: 'blocked';
      readonly blocked: readonly TaskView[];
      readonly blockers: readonly TaskView[];
      readonly explanation: string;
      readonly hint: string;
    }
  | {
      readonly kind: 'clarification';
      readonly nodeIds: readonly string[];
      readonly titles: readonly string[];
      readonly explanation: string;
      readonly hint: string;
    }
  | {
      /**
       * Действий не осталось, но известные требования не закрыты: так бывает
       * после пропуска обязательных шагов. Сообщать «всё выполнено» здесь
       * означало бы прямую неправду.
       */
      readonly kind: 'requirements_open';
      readonly unmetTitles: readonly string[];
      readonly skipped: readonly TaskView[];
      readonly explanation: string;
      readonly hint: string;
    }
  | { readonly kind: 'all_done'; readonly explanation: string; readonly hint: string };

export interface NextActionInput {
  readonly views: readonly TaskView[];
  readonly today: PlainDate;
  /** Доступная недельная нагрузка. null — пользователь её не указал. */
  readonly weeklyHours: number | null;
  /** Нужна для ветки уточнения: неизвестные условия важнее пустого экрана. */
  readonly evaluation?: EvaluatedNode;
}

/** Оценка недельной нагрузки задачи: трудозатраты, растянутые на её длительность. */
export function weeklyLoadHours(view: TaskView): number {
  const days = Math.max(1, view.task.template.durationDays.max);
  return (view.task.template.effortHours.max / days) * 7;
}

export function selectNextAction(input: NextActionInput): NextActionOutcome {
  const { views, today } = input;
  const open = views.filter((v) => !isClosed(v.state.status));

  const actionable = open.filter(
    (v) => !v.flags.blocked && (v.state.status === 'todo' || v.state.status === 'in_progress'),
  );

  if (actionable.length > 0) {
    const started = actionable.filter((v) => v.state.status === 'in_progress');
    const loadNow = started.reduce((sum, v) => sum + weeklyLoadHours(v), 0);
    // TASK-04, «пользовательская нагрузка»: если начатое уже съедает недельный
    // бюджет, предлагать ещё одну параллельную задачу — вредный совет.
    const loadLimited =
      input.weeklyHours !== null && started.length > 0 && loadNow >= input.weeklyHours;
    const pool = loadLimited ? started : actionable;

    const sorted = [...pool].sort(compareCandidates(today));
    const chosen = sorted[0]!;
    const factors = explainChoice(chosen, pool.length, loadLimited, loadNow, input.weeklyHours);

    return {
      kind: 'action',
      view: chosen,
      factors,
      explanation: `Выбрано, потому что ${factors.map((f) => f.text).join('; ')}.`,
      alternativesCount: pool.length - 1,
    };
  }

  // Готовых действий нет — дальше только конкретные диагнозы (TASK-04).
  const awaiting = open.filter((v) => v.state.status === 'awaiting_result');
  if (awaiting.length > 0) {
    const nearest = [...awaiting].sort((a, b) =>
      a.task.earliestFinish < b.task.earliestFinish ? -1 : a.task.earliestFinish > b.task.earliestFinish ? 1 : 0,
    )[0]!;
    return {
      kind: 'awaiting_external',
      views: awaiting,
      explanation:
        `Сейчас от вас ничего не требуется: ${awaiting.length === 1 ? 'идёт' : 'идут'} ` +
        `внешнее ожидание по ${awaiting.length} действию(ям). Ближайшее — «${nearest.task.template.title}».`,
      hint:
        `Результат ожидается около ${formatPlainDateRu(nearest.task.earliestFinish)}. ` +
        'Ускорить это ожидание нельзя; отметьте результат, когда он опубликован.',
    };
  }

  const blocked = open.filter((v) => v.flags.blocked);
  if (blocked.length > 0) {
    const byId = new Map(views.map((v) => [v.task.id, v]));
    const blockerIds = new Set(blocked.flatMap((v) => v.flags.blockedBy));
    const blockers = [...blockerIds]
      .map((id) => byId.get(id))
      .filter((v): v is TaskView => v !== undefined);

    const names = blockers.map((b) => `«${b.task.template.title}» (${TASK_STATUS_LABEL_RU[b.state.status].toLowerCase()})`);
    return {
      kind: 'blocked',
      blocked,
      blockers,
      explanation:
        blockers.length > 0
          ? `Все оставшиеся действия ждут завершения других: ${names.join(', ')}.`
          : 'Все оставшиеся действия заблокированы зависимостями, которых нет в текущем маршруте.',
      hint:
        blockers.length > 0
          ? 'Начните с блокирующего действия — оно откроет остальные.'
          : 'Пересчитайте маршрут: зависимости ссылаются на действия вне плана.',
    };
  }

  const unclear = input.evaluation ? unknownLeaves(input.evaluation) : [];
  if (unclear.length > 0) {
    return {
      kind: 'clarification',
      nodeIds: unclear.map((l) => l.nodeId),
      titles: unclear.map((l) => l.title),
      explanation:
        `Действий в маршруте не осталось, но условий без ответа — ${unclear.length}: ` +
        `${unclear.slice(0, 3).map((l) => `«${l.title}»`).join(', ')}` +
        `${unclear.length > 3 ? ' и другие' : ''}.`,
      hint: 'Уточните недостающие данные в профиле или у первоисточника — без них вывод сделать нельзя.',
    };
  }

  // Перед финальным состоянием проверяем сами ТРЕБОВАНИЯ, а не только
  // действия. Пропуск задачи не доказывает выполнение условия, поэтому
  // «всё закрыто» после пропуска всего плана было бы ложью.
  const unmet = input.evaluation ? unmetLeaves(input.evaluation) : [];
  if (unmet.length > 0) {
    const skipped = views.filter((v) => v.state.status === 'skipped');
    return {
      kind: 'requirements_open',
      unmetTitles: unmet.map((l) => l.title),
      skipped,
      explanation:
        `Готовых действий в плане нет, но ${unmet.length} известных требований ещё не выполнены: ` +
        `${unmet.slice(0, 3).map((l) => `«${l.title}»`).join(', ')}` +
        `${unmet.length > 3 ? ' и другие' : ''}.` +
        (skipped.length > 0
          ? ` Пропущенных действий: ${skipped.length}. Пропуск закрывает действие, но не требование.`
          : ''),
      hint:
        skipped.length > 0
          ? 'Верните нужное действие в план или внесите подтверждённый результат — иначе требование останется открытым.'
          : 'Внесите подтверждённые результаты по оставшимся требованиям или уточните данные в анкете.',
    };
  }

  return {
    kind: 'all_done',
    explanation:
      views.length === 0
        ? 'Действий в маршруте нет: известные формальные условия уже соответствуют указанным данным.'
        : 'Все действия маршрута закрыты, незакрытых известных условий не осталось.',
    hint: 'Проверьте даты действительности результатов и отсечки кампании перед подачей.',
  };
}

/** Применимые листья, которые сейчас не выполнены: открытые требования. */
export function unmetLeaves(evaluation: EvaluatedNode): EvaluatedNode[] {
  return flattenLeaves(evaluation).filter(
    (l) => l.outcome.kind === 'evaluated' && l.outcome.status === 'NOT_MET',
  );
}

/** Неизвестные и противоречивые применимые листья — кандидаты на уточнение. */
export function unknownLeaves(evaluation: EvaluatedNode): EvaluatedNode[] {
  return flattenLeaves(evaluation).filter(
    (l) =>
      l.outcome.kind === 'evaluated' &&
      (l.outcome.status === 'UNKNOWN' || l.outcome.status === 'CONFLICT'),
  );
}

/**
 * Порядок кандидатов. Детерминирован до конца: последний ключ — идентификатор
 * задачи, поэтому при полном равенстве результат не зависит от порядка входа
 * (ENG-04).
 */
function compareCandidates(today: PlainDate) {
  return (a: TaskView, b: TaskView): number => {
    if (a.flags.overdue !== b.flags.overdue) return a.flags.overdue ? -1 : 1;
    if (a.flags.startsLate !== b.flags.startsLate) return a.flags.startsLate ? -1 : 1;

    // Просроченное и опаздывающее важнее всего, но среди остального вперёд
    // идёт то, что действительно отбирает. Некритическое действие — аттестат,
    // который получат все, — ближайшим шагом быть не должно.
    if (a.task.critical !== b.task.critical) return a.task.critical ? -1 : 1;

    const as = a.flags.slackDays ?? Number.MAX_SAFE_INTEGER;
    const bs = b.flags.slackDays ?? Number.MAX_SAFE_INTEGER;
    if (as !== bs) return as - bs;

    const al = a.task.latestStart;
    const bl = b.task.latestStart;
    if (al !== bl) {
      if (al === null) return 1;
      if (bl === null) return -1;
      return daysBetween(today, al) - daysBetween(today, bl);
    }

    const ae = daysBetween(today, a.task.earliestStart);
    const be = daysBetween(today, b.task.earliestStart);
    if (ae !== be) return ae - be;

    return a.task.id < b.task.id ? -1 : a.task.id > b.task.id ? 1 : 0;
  };
}

function explainChoice(
  v: TaskView,
  poolSize: number,
  loadLimited: boolean,
  loadNow: number,
  weeklyHours: number | null,
): ReasonFactor[] {
  const factors: ReasonFactor[] = [];

  if (v.flags.overdue) {
    factors.push({ code: 'OVERDUE', text: 'директивный срок уже прошёл' });
  } else if (v.flags.slackDays !== null) {
    factors.push(
      v.flags.slackDays <= 0
        ? { code: 'NO_SLACK', text: 'резерв времени исчерпан' }
        : {
            code: 'LOW_SLACK',
            text: `резерв ${v.flags.slackDays} дн. — наименьший среди доступных действий`,
          },
    );
  } else {
    factors.push({
      code: 'DEADLINE_UNCERTAIN',
      text: 'срок известен не полностью, поэтому начинать стоит заранее',
    });
  }

  if (loadLimited && weeklyHours !== null) {
    factors.push({
      code: 'LOAD_LIMIT',
      text:
        `уже начатые задачи занимают около ${Math.round(loadNow)} ч в неделю при доступных ` +
        `${weeklyHours} ч, поэтому новые параллельно не предлагаются`,
    });
  }

  if (v.state.status === 'in_progress') {
    factors.push({ code: 'ALREADY_STARTED', text: 'оно уже в работе' });
  } else if (v.task.dependsOn.length === 0) {
    factors.push({ code: 'NO_DEPENDENCIES', text: 'оно не ждёт других задач' });
  }

  if (v.task.sessionDate) {
    factors.push({
      code: 'SESSION_WINDOW',
      text: `ближайшая доступная сессия — ${formatPlainDateRu(v.task.sessionDate)}`,
    });
  }

  if (poolSize === 1) {
    factors.push({ code: 'ONLY_AVAILABLE', text: 'других доступных действий сейчас нет' });
  }

  return factors;
}
