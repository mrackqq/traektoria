/**
 * Прикладной слой между страницами и ядром.
 *
 * Здесь нет бизнес-правил: решения принимают чистые функции ядра
 * (`applyStatusChange`, `applyEvidence`), а этот модуль отвечает за загрузку
 * снимка, атомарную запись и перевод результата в вид, пригодный для показа.
 *
 * Предпросмотр считается тем же кодом, что и применение, но НИЧЕГО не
 * записывает. Разница между «посмотреть» и «применить» — только в том,
 * доходит ли результат до транзакции.
 */

import { buildSession, type SessionSnapshot } from '@core/demo/session';
import { DEMO_OWNER_ID } from '@core/demo/profile';
import type { ApplicantProfileRevision } from '@core/kernel/profile';
import type { RecalcSummary } from '@core/profile/changes';
import { diffScenario, type ScenarioDiff } from '@core/scenarios/diff';
import {
  applyEvidence,
  applyStatusChange,
  initProgress,
  seedFromPlanned,
  syncWithRoute,
  type Actor,
  type CommandOutcome,
  type EvidenceEffect,
  type ProgressState,
  type StatusChangeEffect,
  type StructuredResult,
  type TaskStatus,
} from '@core/progress/state';

import { appClock } from './clock';
import { getStore } from './file-store';
import { currentProfile } from './questionnaire-service';
import { headProfile, type OutboxRecord, type UserState } from './ports';

export { DEMO_OWNER_ID };

/* ------------------------------------------------------------------ */
/* Результат команды в виде, пригодном для передачи в браузер          */
/* ------------------------------------------------------------------ */

export type CommandResult =
  | {
      readonly ok: true;
      readonly kind: 'applied' | 'replayed';
      readonly message: string;
      readonly progressRevision: number;
      readonly profileRevision: number | null;
    }
  | {
      readonly ok: false;
      readonly kind: 'conflict';
      readonly on: 'progress' | 'profile';
      readonly expected: number;
      readonly actual: number;
      readonly message: string;
    }
  | { readonly ok: false; readonly kind: 'rejected'; readonly code: string; readonly message: string };

function toResult(
  outcome: CommandOutcome<StatusChangeEffect | EvidenceEffect>,
  successMessage: string,
): CommandResult {
  switch (outcome.kind) {
    case 'applied': {
      const effect = outcome.effect;
      return {
        ok: true,
        kind: 'applied',
        message: successMessage,
        progressRevision: effect.progress.revision,
        profileRevision: 'profile' in effect ? effect.profile.revision : null,
      };
    }
    case 'replayed':
      return {
        ok: true,
        kind: 'replayed',
        // Повтор той же команды возвращает зафиксированный результат,
        // а не выполняет действие второй раз.
        message: 'Это изменение уже было применено — показан сохранённый результат.',
        progressRevision: outcome.operation.progressRevision,
        profileRevision: outcome.operation.profileRevision,
      };
    case 'conflict':
      return {
        ok: false,
        kind: 'conflict',
        on: outcome.on,
        expected: outcome.expected,
        actual: outcome.actual,
        message: outcome.message,
      };
    case 'rejected':
      return { ok: false, kind: 'rejected', code: outcome.code, message: outcome.message };
  }
}

/* ------------------------------------------------------------------ */
/* Чтение                                                              */
/* ------------------------------------------------------------------ */

export interface SessionView {
  readonly snapshot: SessionSnapshot;
  /** Последний пересчёт после изменения анкеты, если он был. */
  readonly lastRecalc: RecalcSummary | null;
  /** Цель выбрана пользователем и сохранена. */
  readonly goalChosen: boolean;
}

/**
 * Снимок для страниц.
 *
 * Профиль берётся из хранилища; пока его там нет, подставляется профиль по
 * умолчанию — демонстрационный или пустой в зависимости от владельца.
 * Прогресс синхронизируется с пересчитанным маршрутом в памяти: чтение
 * страницы ничего не пишет, запись происходит только по команде.
 */
export async function loadSessionView(ownerId: string): Promise<SessionView> {
  const clock = appClock();
  const state = await getStore().read(ownerId);
  const profile = currentProfile(state, clock.now);

  return {
    snapshot: sessionFrom(state, profile),
    lastRecalc: state.lastRecalc,
    goalChosen: state.activeGoalId !== null,
  };
}

export async function loadSession(ownerId: string = DEMO_OWNER_ID): Promise<SessionSnapshot> {
  return (await loadSessionView(ownerId)).snapshot;
}

function sessionFrom(
  state: UserState,
  profile: ApplicantProfileRevision,
  activePathIdOverride?: string,
): SessionSnapshot {
  const clock = appClock();
  // Активная цель — сохранённый выбор пользователя. Её не подменяет
  // изменение рейтинга: `buildSession` берёт именно этот идентификатор.
  const activePathId = activePathIdOverride ?? state.activeGoalId ?? undefined;

  const first = buildSession({
    profile,
    clock,
    ...(activePathId ? { activePathId } : {}),
  });

  const goalId = first.activeGoal?.path.id;
  if (!goalId) return first;

  const stored = state.progress[goalId];
  if (!stored) return first;

  // Маршрут мог перестроиться (изменились данные или факты): задачи, которых
  // в нём больше нет, помечаются потерявшими смысл, новые добавляются.
  const synced = syncWithRoute(
    stored,
    (first.route?.tasks ?? []).map(seedFromPlanned),
    clock.now,
    'Маршрут пересчитан',
  );

  return buildSession({ profile, clock, activePathId: goalId, progress: synced });
}

/** Прогресс по цели: сохранённый или только что построенный из маршрута. */
function progressFor(state: UserState, session: SessionSnapshot, goalId: string): ProgressState {
  const stored = state.progress[goalId];
  const seeds = (session.route?.tasks ?? []).map(seedFromPlanned);
  if (!stored) return initProgress(state.ownerId, goalId, seeds);
  return syncWithRoute(stored, seeds, session.clock.now, 'Маршрут пересчитан');
}

/* ------------------------------------------------------------------ */
/* Выбор цели                                                          */
/* ------------------------------------------------------------------ */

export type SetGoalResult =
  | { readonly ok: true; readonly goalId: string; readonly message: string }
  | { readonly ok: false; readonly message: string };

/**
 * Закрепить цель.
 *
 * До этого «Построить маршрут к этой цели» вело на общий маршрут, где цель
 * выбиралась заново по рейтингу: можно было открыть одну программу и получить
 * план другой. Теперь выбор сохраняется и используется обзором, маршрутом,
 * целями и сценариями.
 */
export async function setActiveGoal(input: {
  readonly ownerId: string;
  readonly goalId: string;
}): Promise<SetGoalResult> {
  const clock = appClock();

  return getStore().transact<SetGoalResult>(input.ownerId, (state) => {
    const profile = currentProfile(state, clock.now);
    const probe = buildSession({ profile, clock, activePathId: input.goalId });

    if (!probe.activeGoal || probe.activeGoal.path.id !== input.goalId) {
      return {
        kind: 'abort',
        result: {
          ok: false,
          message:
            'Такого пути подачи нет в текущем каталоге. Обновите список программ и выберите цель заново.',
        },
      };
    }

    const goal = probe.activeGoal;
    return {
      kind: 'commit',
      next: { ...state, activeGoalId: input.goalId },
      result: {
        ok: true,
        goalId: input.goalId,
        message: `Цель сохранена: ${goal.program.title} — ${goal.university.shortName}, ${goal.path.label}.`,
      },
    };
  });
}

/* ------------------------------------------------------------------ */
/* Запись                                                              */
/* ------------------------------------------------------------------ */

export interface StatusCommandInput {
  readonly ownerId: string;
  readonly goalId: string;
  readonly taskId: string;
  readonly to: TaskStatus;
  readonly basis: string;
  readonly idempotencyKey: string;
  readonly expectedProgressRevision: number;
  readonly at: string;
}

export async function changeTaskStatus(input: StatusCommandInput): Promise<CommandResult> {
  const actor: Actor = { kind: 'user', userId: input.ownerId };

  return getStore().transact(input.ownerId, (state) => {
    const profile = currentProfile(state, input.at);
    const session = sessionFrom(state, profile, input.goalId);
    const progress = progressFor(state, session, input.goalId);

    const outcome = applyStatusChange({
      progress,
      ledger: state.ledger,
      command: {
        idempotencyKey: input.idempotencyKey,
        taskId: input.taskId,
        to: input.to,
        at: input.at,
        actor,
        basis: input.basis,
        expectedProgressRevision: input.expectedProgressRevision,
      },
    });

    if (outcome.kind !== 'applied') {
      return { kind: 'abort', result: toResult(outcome, '') };
    }

    return {
      kind: 'commit',
      next: commitEffect(state, outcome.effect, input.at),
      result: toResult(outcome, 'Статус действия обновлён.'),
    };
  });
}

export interface EvidenceCommandInput {
  readonly ownerId: string;
  readonly goalId: string;
  readonly taskId: string;
  readonly result: StructuredResult;
  readonly basis: string;
  readonly idempotencyKey: string;
  readonly expectedProgressRevision: number;
  readonly expectedProfileRevision: number;
  readonly at: string;
}

export async function recordResult(input: EvidenceCommandInput): Promise<CommandResult> {
  const actor: Actor = { kind: 'user', userId: input.ownerId };

  return getStore().transact(input.ownerId, (state) => {
    const profile = currentProfile(state, input.at);
    const session = sessionFrom(state, profile, input.goalId);
    const progress = progressFor(state, session, input.goalId);

    const outcome = applyEvidence({
      progress,
      profile,
      ledger: state.ledger,
      command: {
        idempotencyKey: input.idempotencyKey,
        taskId: input.taskId,
        result: input.result,
        at: input.at,
        actor,
        basis: input.basis,
        expectedProgressRevision: input.expectedProgressRevision,
        expectedProfileRevision: input.expectedProfileRevision,
      },
    });

    if (outcome.kind !== 'applied') {
      return { kind: 'abort', result: toResult(outcome, '') };
    }

    // Факт, обе ревизии, событие задачи, аудит и outbox — один коммит.
    const withProfile: UserState = {
      ...state,
      profileRevisions: [...state.profileRevisions, ...seedProfile(state, profile), outcome.effect.profile],
    };

    return {
      kind: 'commit',
      next: commitEffect(withProfile, outcome.effect, input.at),
      result: toResult(outcome, 'Результат записан: обновлены и профиль, и прогресс.'),
    };
  });
}

/** Первая запись сохраняет и исходную ревизию профиля, иначе история начнётся со второй. */
function seedProfile(
  state: UserState,
  profile: ApplicantProfileRevision,
): ApplicantProfileRevision[] {
  return state.profileRevisions.length === 0 ? [profile] : [];
}

function commitEffect(
  state: UserState,
  effect: StatusChangeEffect | EvidenceEffect,
  at: string,
): UserState {
  const outbox: OutboxRecord[] = effect.outbox.map((m) => ({
    ...m,
    enqueuedAt: at,
    deliveredAt: null,
  }));

  return {
    ...state,
    progress: { ...state.progress, [effect.progress.goalId]: effect.progress },
    ledger: [...state.ledger, effect.operation],
    audit: [...state.audit, effect.audit],
    outbox: [...state.outbox, ...outbox],
  };
}

/* ------------------------------------------------------------------ */
/* Предпросмотр                                                        */
/* ------------------------------------------------------------------ */

export interface ResultPreview {
  readonly ok: boolean;
  readonly message: string;
  readonly diff: ScenarioDiff | null;
  readonly profileRevisionAfter: number | null;
}

/**
 * Показать последствия результата ДО подтверждения.
 *
 * Считается тем же `applyEvidence`, что и применение: расхождения между
 * предпросмотром и результатом быть не может по построению. Функция чистая
 * относительно хранилища — она только читает.
 */
export async function previewResult(
  input: Omit<EvidenceCommandInput, 'idempotencyKey'>,
): Promise<ResultPreview> {
  const clock = appClock();
  const state = await getStore().read(input.ownerId);
  const profile = currentProfile(state, input.at);
  const session = sessionFrom(state, profile, input.goalId);
  const progress = progressFor(state, session, input.goalId);

  const outcome = applyEvidence({
    progress,
    profile,
    ledger: [],
    command: {
      idempotencyKey: `preview-${input.taskId}`,
      taskId: input.taskId,
      result: input.result,
      at: input.at,
      actor: { kind: 'user', userId: input.ownerId },
      basis: input.basis,
      expectedProgressRevision: input.expectedProgressRevision,
      expectedProfileRevision: input.expectedProfileRevision,
    },
  });

  if (outcome.kind !== 'applied') {
    const asResult = toResult(outcome, '');
    return { ok: false, message: asResult.message, diff: null, profileRevisionAfter: null };
  }

  const after = buildSession({
    profile: outcome.effect.profile,
    clock,
    activePathId: input.goalId,
    progress: outcome.effect.progress,
  });

  return {
    ok: true,
    message: 'Ничего не сохранено. Это предпросмотр последствий.',
    diff:
      session.bridge && after.bridge ? diffScenario(session.bridge, after.bridge, []) : null,
    profileRevisionAfter: outcome.effect.profile.revision,
  };
}

export { headProfile };
