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
import { normalizeRecalcSummary, type RecalcSummary } from '@core/profile/changes';

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

function asArray<T>(value: unknown): readonly T[] {
  return Array.isArray(value) ? (value as readonly T[]) : [];
}

function asRecord<T>(value: unknown): Readonly<Record<string, T>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return value as Record<string, T>;
}

/**
 * Приведение прочитанного состояния к текущей форме.
 *
 * Файлы, записанные прежней версией, не содержат новых полей. Читать их
 * как `undefined` и падать на первом обращении нельзя: сохранённые данные
 * пользователя должны переживать обновление кода.
 *
 * Проверяется не только наличие поля, но и его ФОРМА. Файл на диске —
 * внешние данные: его мог испортить сбой записи, ручная правка или чужая
 * версия кода. Поле правильного имени, но неверного типа (`progress` строкой
 * вместо объекта) прежде проходило насквозь и роняло первого, кто обратится
 * к нему как к объекту, — уже далеко от места настоящей ошибки.
 */
export function normalizeUserState(raw: unknown, ownerId: string): UserState {
  const source = asRecord<unknown>(raw);
  const storedOwner = source['ownerId'];

  return {
    ownerId: typeof storedOwner === 'string' && storedOwner ? storedOwner : ownerId,
    profileRevisions: asArray<ApplicantProfileRevision>(source['profileRevisions']),
    progress: asRecord<ProgressState>(source['progress']),
    ledger: asArray<AppliedOperation>(source['ledger']),
    audit: asArray<AuditEntry>(source['audit']),
    outbox: asArray<OutboxRecord>(source['outbox']),
    draft: (source['draft'] as ProfileDraft | null) ?? null,
    activeGoalId: typeof source['activeGoalId'] === 'string' ? source['activeGoalId'] : null,
    // Сводка могла быть записана до появления `firstTime`: досчитываем
    // признак, ничего не переписывая на диске.
    lastRecalc: normalizeRecalcSummary((source['lastRecalc'] as RecalcSummary | null) ?? null),
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
