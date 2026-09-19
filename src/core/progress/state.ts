/**
 * TASK-01 / TASK-02 / TASK-03 / TASK-06 — прогресс по действиям.
 *
 * Три вещи, которые здесь нельзя смешивать:
 *  • статус ДЕЙСТВИЯ («сдал экзамен») и выполнение УСЛОВИЯ («балл не ниже 6.5»)
 *    независимы (TASK-02). Закрытие действия само по себе не закрывает условие;
 *  • блокировка зависимостью и просрочка — ВЫЧИСЛЯЕМЫЕ признаки, а не статусы;
 *    они не стирают основной статус (TASK-01, см. next-action.ts);
 *  • отметка результата меняет ФАКТ профиля, поэтому требует двух ожидаемых
 *    ревизий и одной транзакции (TASK-06).
 *
 * Модуль чистый: функции возвращают новые объекты и описание того, что
 * инфраструктура обязана записать атомарно. Ни записи, ни часов тут нет.
 */

import { payloadHash } from '../kernel/hash';
import { checkScaleValue, findScale } from '../kernel/scales';
import type {
  ApplicantProfileRevision,
  DocumentRecord,
  ExamRecord,
  GradeRecord,
  Provenance,
  SubjectRecord,
} from '../kernel/profile';
import type { PlainDate } from '../kernel/time';
import { expectedResultFor, type ExpectedResult, type TaskKind } from '../planning/tasks-library';
import type { PlannedTask } from '../planning/bridge';

/* ------------------------------------------------------------------ */
/* Жизненный цикл (TASK-01)                                            */
/* ------------------------------------------------------------------ */

export type TaskStatus =
  | 'todo'
  | 'in_progress'
  | 'awaiting_result'
  | 'done'
  | 'skipped'
  | 'obsolete';

export const TASK_STATUS_LABEL_RU: Record<TaskStatus, string> = {
  todo: 'К выполнению',
  in_progress: 'В работе',
  awaiting_result: 'Ожидание результата',
  done: 'Выполнено',
  skipped: 'Пропущено',
  obsolete: 'Потеряло смысл',
};

/**
 * Подпись статуса для текста пользователю.
 *
 * Статус приходит из формы и приводится к типу без проверки, поэтому в
 * сообщение об отказе может попасть значение вне перечисления. Прямое
 * обращение к словарю давало тогда `undefined`, и пользователь читал
 * «Переход «К выполнению» → «undefined» не предусмотрен». Неизвестное
 * значение честнее показать как есть — по нему хотя бы видно, что пришло.
 */
function statusLabel(status: TaskStatus): string {
  return TASK_STATUS_LABEL_RU[status] ?? `неизвестный статус «${String(status)}»`;
}

/**
 * Допустимые переходы.
 *
 * `done → in_progress` разрешён намеренно: TASK-03 требует, чтобы снятие
 * отметки было обратимым и не удаляло другие сведения. `obsolete → todo`
 * нужен, когда маршрут вернулся к прежнему варианту после отмены сценария.
 */
const ALLOWED_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  todo: ['in_progress', 'awaiting_result', 'done', 'skipped', 'obsolete'],
  in_progress: ['todo', 'awaiting_result', 'done', 'skipped', 'obsolete'],
  awaiting_result: ['in_progress', 'done', 'skipped', 'obsolete'],
  done: ['in_progress', 'awaiting_result', 'obsolete'],
  skipped: ['todo', 'in_progress', 'obsolete'],
  obsolete: ['todo'],
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** Статусы, которые больше не требуют работы пользователя. */
export function isClosed(status: TaskStatus): boolean {
  return status === 'done' || status === 'skipped' || status === 'obsolete';
}

/**
 * Снимает ли статус зависимость со следующего действия.
 *
 * Пропуск НЕ снимает: пропустить подготовку к экзамену не значит сдать его.
 * Раньше пропуск считался закрытием, и пропуск всего плана выглядел как
 * выполнение всех требований. `obsolete` снимает, потому что такой задачи
 * в маршруте больше нет — её незачем ждать.
 */
export function satisfiesDependency(status: TaskStatus): boolean {
  return status === 'done' || status === 'obsolete';
}

/* ------------------------------------------------------------------ */
/* Авторство и история (TASK-01: у перехода есть дата, автор, основание) */
/* ------------------------------------------------------------------ */

export type Actor =
  | { readonly kind: 'user'; readonly userId: string }
  | { readonly kind: 'staff'; readonly staffId: string }
  | { readonly kind: 'system'; readonly component: string };

export function actorRef(a: Actor): string {
  return a.kind === 'user'
    ? `user:${a.userId}`
    : a.kind === 'staff'
      ? `staff:${a.staffId}`
      : `system:${a.component}`;
}

export interface TaskTransition {
  readonly taskId: string;
  readonly from: TaskStatus | null;
  readonly to: TaskStatus;
  /** UTC ISO-8601. Время приходит командой, а не из системных часов (MODEL-03). */
  readonly at: string;
  readonly actor: Actor;
  readonly basis: string;
  readonly evidenceId?: string;
}

export interface TaskState {
  readonly taskId: string;
  readonly semanticKey: string;
  readonly kind: TaskKind;
  readonly dependsOn: readonly string[];
  readonly status: TaskStatus;
  /** TASK-02: подтверждение, которым закрыт результат. Для действий без результата — null. */
  readonly evidenceId: string | null;
  readonly history: readonly TaskTransition[];
}

export interface ProgressState {
  readonly ownerId: string;
  readonly goalId: string;
  /** MODEL-02: ревизия растёт при каждом принятом изменении. */
  readonly revision: number;
  readonly tasks: readonly TaskState[];
}

export interface TaskSeed {
  readonly id: string;
  readonly semanticKey: string;
  readonly kind: TaskKind;
  readonly dependsOn: readonly string[];
}

export function seedFromPlanned(t: PlannedTask): TaskSeed {
  return {
    id: t.id,
    semanticKey: t.semanticKey,
    kind: t.template.kind,
    dependsOn: t.dependsOn,
  };
}

export function findTask(state: ProgressState, taskId: string): TaskState | undefined {
  return state.tasks.find((t) => t.taskId === taskId);
}

export function initProgress(
  ownerId: string,
  goalId: string,
  seeds: readonly TaskSeed[],
): ProgressState {
  return {
    ownerId,
    goalId,
    revision: 1,
    tasks: seeds.map((s) => ({
      taskId: s.id,
      semanticKey: s.semanticKey,
      kind: s.kind,
      dependsOn: s.dependsOn,
      status: 'todo' as TaskStatus,
      evidenceId: null,
      history: [],
    })),
  };
}

/**
 * Синхронизация прогресса с пересчитанным маршрутом.
 *
 * ST-05 / TASK-01: задача, исчезнувшая из маршрута, становится `obsolete`,
 * а не удаляется — иначе теряется история и основание. Выполненная задача
 * сохраняет `done`, даже если маршрут её больше не требует: факт остаётся
 * фактом.
 */
export function syncWithRoute(
  state: ProgressState,
  seeds: readonly TaskSeed[],
  at: string,
  basis: string,
): ProgressState {
  const byId = new Map(seeds.map((s) => [s.id, s]));
  const actor: Actor = { kind: 'system', component: 'route-sync' };
  let changed = false;

  const kept: TaskState[] = state.tasks.map((t) => {
    const seed = byId.get(t.taskId);
    if (!seed) {
      if (t.status === 'done' || t.status === 'obsolete') return t;
      changed = true;
      return transit(t, 'obsolete', { at, actor, basis });
    }

    const sameDeps =
      seed.dependsOn.length === t.dependsOn.length &&
      seed.dependsOn.every((d, i) => d === t.dependsOn[i]);

    if (t.status === 'obsolete') {
      changed = true;
      return transit(t, 'todo', { at, actor, basis }, { dependsOn: seed.dependsOn });
    }
    if (!sameDeps) {
      changed = true;
      return { ...t, dependsOn: seed.dependsOn };
    }
    return t;
  });

  const known = new Set(state.tasks.map((t) => t.taskId));
  const added: TaskState[] = seeds
    .filter((s) => !known.has(s.id))
    .map((s) => ({
      taskId: s.id,
      semanticKey: s.semanticKey,
      kind: s.kind,
      dependsOn: s.dependsOn,
      status: 'todo' as TaskStatus,
      evidenceId: null,
      history: [{ taskId: s.id, from: null, to: 'todo' as TaskStatus, at, actor, basis }],
    }));

  if (!changed && added.length === 0) return state;
  return { ...state, revision: state.revision + 1, tasks: [...kept, ...added] };
}

function transit(
  t: TaskState,
  to: TaskStatus,
  meta: { at: string; actor: Actor; basis: string; evidenceId?: string },
  patch?: Partial<Pick<TaskState, 'dependsOn' | 'evidenceId'>>,
): TaskState {
  const transition: TaskTransition = {
    taskId: t.taskId,
    from: t.status,
    to,
    at: meta.at,
    actor: meta.actor,
    basis: meta.basis,
    ...(meta.evidenceId ? { evidenceId: meta.evidenceId } : {}),
  };
  return {
    ...t,
    ...patch,
    status: to,
    history: [...t.history, transition],
  };
}

/* ------------------------------------------------------------------ */
/* Структурированный результат (TASK-02)                               */
/* ------------------------------------------------------------------ */

/**
 * TASK-02: «Для завершения результата требуется структурированное значение
 * и происхождение». Свободный текст результатом не является.
 */
export type StructuredResult =
  | {
      readonly kind: 'exam_score';
      readonly examKind: string;
      readonly scaleId: string;
      readonly overall: number;
      readonly components?: readonly { readonly component: string; readonly score: number }[];
      readonly takenOn: PlainDate;
      readonly resultOn: PlainDate;
      readonly validUntil?: PlainDate;
      readonly provenance: Provenance;
    }
  | {
      readonly kind: 'document';
      readonly documentKind: string;
      readonly validUntil?: PlainDate;
      readonly provenance: Provenance;
    }
  | {
      readonly kind: 'grade';
      readonly scaleId: string;
      readonly value: number;
      readonly provenance: Provenance;
    }
  | {
      readonly kind: 'subject';
      readonly subjectId: string;
      readonly score?: number;
      readonly scaleId?: string;
      readonly provenance: Provenance;
    };

/**
 * Виды действий, закрытие которых означает появление ФАКТА в профиле.
 *
 * `take_exam` сюда не входит намеренно (AC-07): сдача экзамена закрывает
 * действие, но факт появляется только с опубликованным результатом.
 */
export function requiresStructuredResult(kind: TaskKind): boolean {
  return (
    kind === 'await_result' ||
    kind === 'obtain_document' ||
    kind === 'improve_grade' ||
    kind === 'study_subject'
  );
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Существующая календарная дата: 31 февраля датой не является. */
function isRealDate(value: string | undefined): boolean {
  if (!value || !DATE_RE.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(ms)) return false;
  return new Date(ms).toISOString().slice(0, 10) === value;
}

export interface ResultValidationContext {
  /** Момент команды. По нему отличается опубликованный факт от будущего. */
  readonly nowIso: string;
  /** Какой результат ожидает это действие. null — сопоставление невозможно. */
  readonly expected: ExpectedResult | null;
}

const RESULT_KIND_RU: Record<StructuredResult['kind'], string> = {
  exam_score: 'балл экзамена',
  document: 'документ',
  grade: 'средний балл',
  subject: 'предмет',
};

/**
 * Проверка результата перед записью в профиль.
 *
 * Здесь закрываются четыре разные дыры, каждая из которых давала ложный факт:
 *  • значение вне шкалы (IELTS 99, ЕНТ 999) считалось нормальным баллом;
 *  • дата публикации в будущем превращала намерение в опубликованный факт;
 *  • несуществующая календарная дата проходила проверку формата;
 *  • результат чужого вида закрывал задачу — балл ЕНТ закрывал аттестат.
 *
 * Скрытые поля формы ничего из этого не гарантируют: форма присылает то, что
 * прислали, а контракт обязан держать сервер.
 */
export function validateResult(
  r: StructuredResult,
  ctx: ResultValidationContext,
): string | null {
  if (!r.provenance) return 'Не указано происхождение результата';

  const today = new Date(Date.parse(ctx.nowIso)).toISOString().slice(0, 10);
  const expected = ctx.expected;

  if (expected && expected.kind !== r.kind) {
    return (
      `Это действие закрывается результатом другого вида: ожидается ` +
      `${RESULT_KIND_RU[expected.kind]}, а прислан ${RESULT_KIND_RU[r.kind]}`
    );
  }

  switch (r.kind) {
    case 'exam_score': {
      if (expected && expected.kind === 'exam_score') {
        if (expected.examKind !== r.examKind) {
          return `Действие ждёт результат ${expected.examKind}, а прислан ${r.examKind || 'неизвестный экзамен'}`;
        }
        if (expected.scaleId !== r.scaleId) {
          return `Шкала результата (${r.scaleId || 'не указана'}) не совпадает с ожидаемой (${expected.scaleId})`;
        }
      }
      const scale = findScale(r.scaleId);
      if (!scale) return `Шкала «${r.scaleId || 'не указана'}» неизвестна`;
      if (scale.examKind && r.examKind && scale.examKind !== r.examKind) {
        return `Шкала ${r.scaleId} принадлежит экзамену ${scale.examKind}, а не ${r.examKind}`;
      }

      const overallProblem = checkScaleValue(r.scaleId, r.overall, 'Общий балл');
      if (overallProblem) return overallProblem.message;

      for (const c of r.components ?? []) {
        if (scale.components && scale.components.length > 0 && !scale.components.includes(c.component)) {
          return `У экзамена ${r.examKind} нет компонента «${c.component}»`;
        }
        const problem = checkScaleValue(r.scaleId, c.score, `Балл компонента «${c.component}»`);
        if (problem) return problem.message;
      }

      if (!isRealDate(r.takenOn) || !isRealDate(r.resultOn)) {
        return 'Нужны существующие дата сдачи и дата публикации результата в формате ГГГГ-ММ-ДД';
      }
      if (r.resultOn < r.takenOn) return 'Результат не может быть опубликован раньше сдачи';
      if (r.takenOn > today) return 'Дата сдачи в будущем: экзамен ещё не состоялся';
      if (r.resultOn > today) {
        return (
          'Дата публикации результата в будущем. Пока результат не опубликован, ' +
          'он остаётся ожиданием, а не фактом'
        );
      }
      if (r.validUntil !== undefined) {
        if (!isRealDate(r.validUntil)) return 'Срок действия — существующая дата в формате ГГГГ-ММ-ДД';
        if (r.validUntil < r.resultOn) return 'Срок действия истекает раньше публикации результата';
      }
      return null;
    }
    case 'document': {
      if (!r.documentKind) return 'Не указан вид документа';
      if (expected && expected.kind === 'document' && expected.documentKind !== r.documentKind) {
        return `Действие закрывается другим документом, а не «${r.documentKind}»`;
      }
      if (r.validUntil !== undefined) {
        if (!isRealDate(r.validUntil)) return 'Срок действия — существующая дата в формате ГГГГ-ММ-ДД';
        if (r.validUntil < today) return 'Срок действия документа уже истёк';
      }
      return null;
    }
    case 'grade': {
      if (!r.scaleId) return 'Не указана шкала оценки';
      if (expected && expected.kind === 'grade' && expected.scaleId !== r.scaleId) {
        return `Действие ждёт оценку по шкале ${expected.scaleId}, а не ${r.scaleId}`;
      }
      const problem = checkScaleValue(r.scaleId, r.value, 'Средний балл');
      if (problem) return problem.message;
      return null;
    }
    case 'subject': {
      if (!r.subjectId) return 'Не указан предмет';
      if (r.score !== undefined) {
        if (!Number.isFinite(r.score)) return 'Оценка не является числом';
        if (r.scaleId) {
          const problem = checkScaleValue(r.scaleId, r.score, 'Оценка по предмету');
          if (problem) return problem.message;
        }
      }
      return null;
    }
  }
}

/** Ключ факта: по нему определяется, какие расчёты нужно пересчитать (TASK-03). */
export function factKey(r: StructuredResult): string {
  switch (r.kind) {
    case 'exam_score':
      return `exam:${r.examKind}`;
    case 'document':
      return `document:${r.documentKind}`;
    case 'grade':
      return `gpa:${r.scaleId}`;
    case 'subject':
      return `subject:${r.subjectId}`;
  }
}

/* ------------------------------------------------------------------ */
/* Команды, идемпотентность и конфликты (TASK-06, API-04)              */
/* ------------------------------------------------------------------ */

export interface AppliedOperation {
  readonly idempotencyKey: string;
  readonly payloadHash: string;
  readonly at: string;
  readonly taskId: string;
  readonly progressRevision: number;
  readonly profileRevision: number | null;
}

export interface StatusChangeCommand {
  readonly idempotencyKey: string;
  readonly taskId: string;
  readonly to: TaskStatus;
  readonly at: string;
  readonly actor: Actor;
  readonly basis: string;
  /** TASK-06: для изменения только статуса достаточно ревизии прогресса. */
  readonly expectedProgressRevision: number;
}

export interface EvidenceCommand {
  readonly idempotencyKey: string;
  readonly taskId: string;
  readonly result: StructuredResult;
  readonly at: string;
  readonly actor: Actor;
  readonly basis: string;
  /** TASK-06: событие результата требует ОБЕИХ ожидаемых ревизий. */
  readonly expectedProgressRevision: number;
  readonly expectedProfileRevision: number;
}

export type RejectionCode =
  | 'UNKNOWN_TASK'
  | 'TRANSITION_NOT_ALLOWED'
  | 'RESULT_REQUIRED'
  | 'RESULT_NOT_EXPECTED'
  | 'RESULT_INVALID'
  | 'BASIS_REQUIRED'
  | 'IDEMPOTENCY_KEY_REUSED';

export type CommandOutcome<E> =
  | { readonly kind: 'applied'; readonly effect: E }
  /** API-04: тот же ключ и тот же payload — возвращаем зафиксированный результат. */
  | { readonly kind: 'replayed'; readonly operation: AppliedOperation }
  | {
      readonly kind: 'conflict';
      readonly code: 'VERSION_CONFLICT';
      readonly on: 'progress' | 'profile';
      readonly expected: number;
      readonly actual: number;
      readonly message: string;
    }
  | { readonly kind: 'rejected'; readonly code: RejectionCode; readonly message: string };

export interface AuditEntry {
  readonly at: string;
  readonly actorRef: string;
  readonly action: 'task_status_changed' | 'task_result_recorded' | 'profile_updated';
  readonly taskId: string;
  readonly progressRevision: number;
  readonly profileRevision: number | null;
  readonly basis: string;
}

/**
 * OPS-02 / PRIV-06: в outbox уходят идентификаторы и ревизии, но не баллы
 * и не финансовые сведения. Недоставленное событие не должно становиться
 * вторым хранилищем персональных данных (REV-17).
 */
export interface OutboxMessage {
  readonly id: string;
  readonly type: 'progress.task_changed' | 'profile.fact_changed';
  readonly payload: Readonly<Record<string, string | number | null>>;
}

export interface StatusChangeEffect {
  readonly progress: ProgressState;
  readonly transition: TaskTransition;
  readonly audit: AuditEntry;
  readonly outbox: readonly OutboxMessage[];
  readonly operation: AppliedOperation;
}

/** TASK-03: изменение результата приводит к пересчёту зависимых целей. */
export interface RecomputeRequest {
  readonly reason: 'fact_changed' | 'fact_retracted';
  readonly factKeys: readonly string[];
  readonly goalId: string;
}

export interface EvidenceEffect extends StatusChangeEffect {
  readonly profile: ApplicantProfileRevision;
  readonly recompute: RecomputeRequest;
}

function replay<E>(
  ledger: readonly AppliedOperation[],
  key: string,
  hash: string,
): CommandOutcome<E> | null {
  const prev = ledger.find((o) => o.idempotencyKey === key);
  if (!prev) return null;
  if (prev.payloadHash !== hash) {
    return {
      kind: 'rejected',
      code: 'IDEMPOTENCY_KEY_REUSED',
      message: 'Ключ идемпотентности уже использован с другим содержимым команды',
    };
  }
  return { kind: 'replayed', operation: prev };
}

/**
 * Изменение статуса действия без изменения фактов.
 *
 * TASK-06, последнее предложение: здесь достаточно одной ожидаемой ревизии.
 */
export function applyStatusChange(input: {
  readonly progress: ProgressState;
  readonly ledger: readonly AppliedOperation[];
  readonly command: StatusChangeCommand;
}): CommandOutcome<StatusChangeEffect> {
  const { progress, ledger, command } = input;
  // Цель входит в отпечаток команды: «начать подготовку» в одной цели и в
  // другой — разные команды, а журнал операций общий на пользователя.
  const hash = payloadHash({ goalId: progress.goalId, taskId: command.taskId, to: command.to });
  const replayed = replay<StatusChangeEffect>(ledger, command.idempotencyKey, hash);
  if (replayed) return replayed;

  if (!command.basis.trim()) {
    return { kind: 'rejected', code: 'BASIS_REQUIRED', message: 'Основание перехода обязательно' };
  }

  const task = findTask(progress, command.taskId);
  if (!task) {
    return { kind: 'rejected', code: 'UNKNOWN_TASK', message: `Задача ${command.taskId} не найдена` };
  }

  if (progress.revision !== command.expectedProgressRevision) {
    return versionConflict('progress', command.expectedProgressRevision, progress.revision);
  }

  if (!canTransition(task.status, command.to)) {
    return {
      kind: 'rejected',
      code: 'TRANSITION_NOT_ALLOWED',
      message:
        `Переход «${statusLabel(task.status)}» → «${statusLabel(command.to)}» ` +
        'не предусмотрен жизненным циклом',
    };
  }

  // TASK-02: действие, результат которого становится фактом профиля, нельзя
  // закрыть простой отметкой. Нужна команда с результатом.
  if (command.to === 'done' && requiresStructuredResult(task.kind) && !task.evidenceId) {
    return {
      kind: 'rejected',
      code: 'RESULT_REQUIRED',
      message:
        'Это действие закрывается подтверждённым результатом со значением и происхождением, ' +
        'а не отметкой «выполнено»',
    };
  }

  const updated = transit(task, command.to, command);
  const progressNext: ProgressState = {
    ...progress,
    revision: progress.revision + 1,
    tasks: progress.tasks.map((t) => (t.taskId === task.taskId ? updated : t)),
  };
  const transition = updated.history[updated.history.length - 1]!;

  return {
    kind: 'applied',
    effect: {
      progress: progressNext,
      transition,
      audit: {
        at: command.at,
        actorRef: actorRef(command.actor),
        action: 'task_status_changed',
        taskId: command.taskId,
        progressRevision: progressNext.revision,
        profileRevision: null,
        basis: command.basis,
      },
      outbox: [
        {
          id: `ob-${hash}-${progressNext.revision}`,
          type: 'progress.task_changed',
          payload: {
            goalId: progress.goalId,
            taskId: command.taskId,
            status: command.to,
            progressRevision: progressNext.revision,
          },
        },
      ],
      operation: {
        idempotencyKey: command.idempotencyKey,
        payloadHash: hash,
        at: command.at,
        taskId: command.taskId,
        progressRevision: progressNext.revision,
        profileRevision: null,
      },
    },
  };
}

/**
 * Событие результата: закрывает действие И записывает факт профиля.
 *
 * TASK-06: факт, его provenance, обе новые ревизии, task event, аудит
 * и outbox — одна транзакция. Функция возвращает весь набор; инфраструктура
 * обязана записать его целиком либо не записывать ничего. Параллельный PATCH
 * того же факта проигрывает по ревизии и получает конфликт, а не тихую потерю.
 */
export function applyEvidence(input: {
  readonly progress: ProgressState;
  readonly profile: ApplicantProfileRevision;
  readonly ledger: readonly AppliedOperation[];
  readonly command: EvidenceCommand;
}): CommandOutcome<EvidenceEffect> {
  const { progress, profile, ledger, command } = input;
  const hash = payloadHash({ goalId: progress.goalId, taskId: command.taskId, result: command.result });
  const replayed = replay<EvidenceEffect>(ledger, command.idempotencyKey, hash);
  if (replayed) return replayed;

  if (!command.basis.trim()) {
    return { kind: 'rejected', code: 'BASIS_REQUIRED', message: 'Основание обязательно' };
  }

  const task = findTask(progress, command.taskId);
  if (!task) {
    return { kind: 'rejected', code: 'UNKNOWN_TASK', message: `Задача ${command.taskId} не найдена` };
  }

  if (!requiresStructuredResult(task.kind)) {
    return {
      kind: 'rejected',
      code: 'RESULT_NOT_EXPECTED',
      message: 'У этого действия нет собственного результата: закройте его изменением статуса',
    };
  }

  const invalid = validateResult(command.result, {
    nowIso: command.at,
    expected: expectedResultFor(task.semanticKey),
  });
  if (invalid) return { kind: 'rejected', code: 'RESULT_INVALID', message: invalid };

  // Порядок как в API-04: сначала прогресс, потом профиль — клиент видит
  // первое расхождение, а не случайное.
  if (progress.revision !== command.expectedProgressRevision) {
    return versionConflict('progress', command.expectedProgressRevision, progress.revision);
  }
  if (profile.revision !== command.expectedProfileRevision) {
    return versionConflict('profile', command.expectedProfileRevision, profile.revision);
  }

  if (!canTransition(task.status, 'done')) {
    return {
      kind: 'rejected',
      code: 'TRANSITION_NOT_ALLOWED',
      message: `Из состояния «${TASK_STATUS_LABEL_RU[task.status]}» результат не принимается`,
    };
  }

  const evidenceId = `ev-${hash}`;
  const updated = transit(task, 'done', { ...command, evidenceId }, { evidenceId });
  const progressNext: ProgressState = {
    ...progress,
    revision: progress.revision + 1,
    tasks: progress.tasks.map((t) => (t.taskId === task.taskId ? updated : t)),
  };
  const profileNext = writeFact(profile, command.result, command.at, command.basis);
  const transition = updated.history[updated.history.length - 1]!;
  const key = factKey(command.result);

  return {
    kind: 'applied',
    effect: {
      progress: progressNext,
      profile: profileNext,
      transition,
      audit: {
        at: command.at,
        actorRef: actorRef(command.actor),
        action: 'task_result_recorded',
        taskId: command.taskId,
        progressRevision: progressNext.revision,
        profileRevision: profileNext.revision,
        basis: command.basis,
      },
      outbox: [
        {
          id: `ob-${hash}-${progressNext.revision}`,
          type: 'progress.task_changed',
          payload: {
            goalId: progress.goalId,
            taskId: command.taskId,
            status: 'done',
            progressRevision: progressNext.revision,
          },
        },
        {
          id: `ob-${hash}-fact-${profileNext.revision}`,
          type: 'profile.fact_changed',
          // Значение результата в событие не попадает: подписчику достаточно
          // ключа факта и ревизии, чтобы перечитать данные по праву доступа.
          payload: { factKey: key, profileRevision: profileNext.revision },
        },
      ],
      operation: {
        idempotencyKey: command.idempotencyKey,
        payloadHash: hash,
        at: command.at,
        taskId: command.taskId,
        progressRevision: progressNext.revision,
        profileRevision: profileNext.revision,
      },
      recompute: { reason: 'fact_changed', factKeys: [key], goalId: progress.goalId },
    },
  };
}

function versionConflict<E>(
  on: 'progress' | 'profile',
  expected: number,
  actual: number,
): CommandOutcome<E> {
  const what = on === 'progress' ? 'Прогресс' : 'Профиль';
  return {
    kind: 'conflict',
    code: 'VERSION_CONFLICT',
    on,
    expected,
    actual,
    message:
      `${what} изменился: ожидалась ревизия ${expected}, сейчас ${actual}. ` +
      'Введённое не потеряно — повторите с актуальной ревизией.',
  };
}

/**
 * MODEL-02: запись факта создаёт НОВУЮ ревизию профиля, а не правит старую.
 *
 * TASK-03: другие сведения сохраняются — новая запись заменяет только запись
 * того же вида, остальное переносится как есть.
 */
function writeFact(
  profile: ApplicantProfileRevision,
  result: StructuredResult,
  at: string,
  reason: string,
): ApplicantProfileRevision {
  const base: ApplicantProfileRevision = {
    ...profile,
    id: `${profile.ownerId}-r${profile.revision + 1}`,
    revision: profile.revision + 1,
    createdAt: at,
    changeReason: reason,
  };

  switch (result.kind) {
    case 'exam_score': {
      const record: ExamRecord = {
        id: `exam-${result.examKind}-${result.resultOn}`,
        examKind: result.examKind,
        scaleId: result.scaleId,
        state: 'result_reported',
        overall: result.overall,
        ...(result.components ? { components: result.components } : {}),
        takenOn: result.takenOn,
        resultOn: result.resultOn,
        ...(result.validUntil ? { validUntil: result.validUntil } : {}),
        provenance: result.provenance,
      };
      return {
        ...base,
        exams: [...profile.exams.filter((e) => e.examKind !== result.examKind), record],
      };
    }
    case 'document': {
      const record: DocumentRecord = {
        documentKind: result.documentKind,
        obtained: true,
        ...(result.validUntil ? { validUntil: result.validUntil } : {}),
        provenance: result.provenance,
      };
      return {
        ...base,
        documents: [
          ...profile.documents.filter((d) => d.documentKind !== result.documentKind),
          record,
        ],
      };
    }
    case 'grade': {
      const record: GradeRecord = {
        scaleId: result.scaleId,
        value: result.value,
        provenance: result.provenance,
      };
      return {
        ...base,
        grades: [...profile.grades.filter((g) => g.scaleId !== result.scaleId), record],
      };
    }
    case 'subject': {
      const record: SubjectRecord = {
        subjectId: result.subjectId,
        ...(result.score !== undefined ? { score: result.score } : {}),
        ...(result.scaleId ? { scaleId: result.scaleId } : {}),
        provenance: result.provenance,
      };
      return {
        ...base,
        subjects: [...profile.subjects.filter((s) => s.subjectId !== result.subjectId), record],
      };
    }
  }
}
