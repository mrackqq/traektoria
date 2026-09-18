/**
 * Граница между доменом и инфраструктурой.
 *
 * Ядро (`src/core`) не знает ни про файлы, ни про HTTP, ни про базу данных.
 * Здесь описан контракт хранилища, который сейчас реализован файлами и
 * заменяется одной новой реализацией без правок ядра и страниц.
 *
 * Главное требование контракта: факт, его происхождение, обе новые ревизии,
 * событие задачи, аудит и outbox записываются ОДНОЙ транзакцией либо не
 * записываются вовсе. Поэтому запись доступна только через `transact`,
 * а не через отдельные put-методы: частичная запись должна быть невозможна
 * по форме интерфейса, а не по дисциплине вызывающего кода.
 */

import type { ApplicantProfileRevision } from '@core/kernel/profile';
import type {
  AppliedOperation,
  AuditEntry,
  OutboxMessage,
  ProgressState,
} from '@core/progress/state';
import type { ProfileDraft } from '@core/profile/questionnaire';
import type { RecalcSummary } from '@core/profile/changes';

/** Событие, ожидающее доставки. */
export interface OutboxRecord extends OutboxMessage {
  readonly enqueuedAt: string;
  readonly deliveredAt: string | null;
}

/**
 * Снимок состояния одного владельца.
 *
 * Ревизии профиля неизменяемы и накапливаются. Прежняя ревизия не
 * перезаписывается, поэтому расчёт всегда можно повторить на тех данных,
 * на которых он делался.
 */
export interface UserState {
  readonly ownerId: string;
  readonly profileRevisions: readonly ApplicantProfileRevision[];
  /** Прогресс по цели: ключ — идентификатор пути подачи. */
  readonly progress: Readonly<Record<string, ProgressState>>;
  /** Журнал применённых операций для идемпотентного повтора. */
  readonly ledger: readonly AppliedOperation[];
  readonly audit: readonly AuditEntry[];
  readonly outbox: readonly OutboxRecord[];
  /** Незавершённая анкета со своей ревизией. */
  readonly draft: ProfileDraft | null;
  /**
   * Цель, выбранная пользователем. Именно она используется обзором,
   * маршрутом, целями и сценариями. Изменение рейтинга её не переключает.
   */
  readonly activeGoalId: string | null;
  /** Последний пересчёт после изменения анкеты — для блока «что изменилось». */
  readonly lastRecalc: RecalcSummary | null;
}

/**
 * Результат транзакции: либо новое состояние и ответ, либо отказ без записи.
 *
 * Отказ — это нормальный исход (конфликт ревизий, недопустимый переход),
 * а не исключение: вызывающий код обязан его показать пользователю.
 */
export type TxOutcome<T> =
  | { readonly kind: 'commit'; readonly next: UserState; readonly result: T }
  | { readonly kind: 'abort'; readonly result: T };

export interface Store {
  read(ownerId: string): Promise<UserState>;
  /**
   * Прочитать, применить и записать без вклинивания другой команды.
   *
   * Функция `fn` обязана быть чистой относительно состояния: она получает
   * снимок и возвращает решение. Повторный вызов с тем же снимком должен
   * давать тот же результат — иначе идемпотентность не работает.
   */
  transact<T>(ownerId: string, fn: (state: UserState) => TxOutcome<T>): Promise<T>;
}

export function emptyUserState(ownerId: string): UserState {
  return {
    ownerId,
    profileRevisions: [],
    progress: {},
    ledger: [],
    audit: [],
    outbox: [],
    draft: null,
    activeGoalId: null,
    lastRecalc: null,
  };
}

/**
 * Приведение прочитанного состояния к текущей форме.
 *
 * Файлы, записанные прежней версией, не содержат новых полей. Читать их
 * как `undefined` и падать на первом обращении нельзя: сохранённые данные
 * пользователя должны переживать обновление кода.
 */
export function normalizeUserState(raw: UserState, ownerId: string): UserState {
  return {
    ...emptyUserState(ownerId),
    ...raw,
    ownerId: raw.ownerId ?? ownerId,
    progress: raw.progress ?? {},
    ledger: raw.ledger ?? [],
    audit: raw.audit ?? [],
    outbox: raw.outbox ?? [],
    profileRevisions: raw.profileRevisions ?? [],
    draft: raw.draft ?? null,
    activeGoalId: raw.activeGoalId ?? null,
    lastRecalc: raw.lastRecalc ?? null,
  };
}

/** Текущая (последняя) ревизия профиля. */
export function headProfile(state: UserState): ApplicantProfileRevision | null {
  if (state.profileRevisions.length === 0) return null;
  return state.profileRevisions.reduce((a, b) => (b.revision > a.revision ? b : a));
}

/** Ревизия профиля, на которой был начат черновик. */
export function profileRevision(
  state: UserState,
  revision: number,
): ApplicantProfileRevision | null {
  return state.profileRevisions.find((p) => p.revision === revision) ?? null;
}
