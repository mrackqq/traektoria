'use server';

/**
 * Команды интерфейса.
 *
 * Ключ идемпотентности детерминированный — `цель:задача:переход:ожидаемая
 * ревизия`. Двойная отправка той же кнопки возвращает зафиксированный
 * результат, а не выполняет действие дважды; другое намерение даёт другой
 * ключ. Цель входит в ключ обязательно: журнал операций общий на пользователя,
 * и без неё «начать подготовку» в одной цели засчитывалось как повтор той же
 * команды в другой.
 *
 * Ревизия, на которой была отрисована страница, приходит вместе с командой:
 * если за это время состояние изменилось (другая вкладка, другое устройство),
 * пользователь получает конфликт с объяснением, а не тихую перезапись.
 */

import { revalidatePath } from 'next/cache';

import type { StructuredResult, TaskStatus } from '@core/progress/state';

import { appNow } from '@/server/clock';
import {
  changeTaskStatus,
  previewResult,
  recordResult,
  setActiveGoal,
  type CommandResult,
  type ResultPreview,
  type SetGoalResult,
} from '@/server/progress-service';
import { visitorContext } from '@/server/session-context';

const DEFAULT_BASIS = 'Отметка пользователя в интерфейсе';

/**
 * Один сброс кеша вместо семи.
 *
 * Перечисление путей выглядело безобиднее, чем обходилось: в ответ на
 * действие клиент забирал заново RSC-разметку каждого перечисленного
 * маршрута, а за каждым стоит полный подбор программ и построение
 * маршрута. Отметка одного действия тянула за собой семь пересчётов и
 * отвечала с задержкой в десятки секунд.
 *
 * `revalidatePath('/', 'layout')` помечает устаревшим всё поддерево разом:
 * перерисовывается текущая страница, остальные подтянутся при переходе.
 */
function revalidateEverything(): void {
  revalidatePath('/', 'layout');
}

export async function changeStatusAction(
  _prev: CommandResult | null,
  formData: FormData,
): Promise<CommandResult> {
  const { ownerId } = await visitorContext();
  const goalId = String(formData.get('goalId') ?? '');
  const taskId = String(formData.get('taskId') ?? '');
  const to = String(formData.get('to') ?? '') as TaskStatus;
  const expected = Number(formData.get('expectedProgressRevision') ?? 0);
  const comment = String(formData.get('basis') ?? '').trim();

  const result = await changeTaskStatus({
    ownerId,
    goalId,
    taskId,
    to,
    basis: comment ? `${DEFAULT_BASIS}: ${comment}` : DEFAULT_BASIS,
    idempotencyKey: `${goalId}:${taskId}:${to}:${expected}`,
    expectedProgressRevision: expected,
    at: appNow(),
  });

  if (result.ok) revalidateEverything();
  return result;
}

/** Закрепить выбранную программу как цель. */
export async function setGoalAction(
  _prev: SetGoalResult | null,
  formData: FormData,
): Promise<SetGoalResult> {
  const { ownerId } = await visitorContext();
  const goalId = String(formData.get('goalId') ?? '');

  const result = await setActiveGoal({ ownerId, goalId });
  if (result.ok) revalidateEverything();
  return result;
}

/** Разбор формы результата. Валидность значения проверяет ядро, не форма. */
function readResult(formData: FormData): StructuredResult | { error: string } {
  const kind = String(formData.get('resultKind') ?? '');

  switch (kind) {
    case 'exam_score': {
      const overall = Number(String(formData.get('overall') ?? '').replace(',', '.'));
      const takenOn = String(formData.get('takenOn') ?? '');
      const resultOn = String(formData.get('resultOn') ?? '');
      const validUntil = String(formData.get('validUntil') ?? '');
      if (!takenOn || !resultOn) return { error: 'Укажите дату сдачи и дату публикации результата' };
      // Компонентные баллы вводятся отдельно от общего и отдельно же
      // проверяются. Поля приходят как `component:writing` и т. п.
      const components: { component: string; score: number }[] = [];
      for (const [key, value] of formData.entries()) {
        if (!key.startsWith('component:')) continue;
        const raw = String(value).trim();
        if (raw === '') continue;
        components.push({
          component: key.slice('component:'.length),
          score: Number(raw.replace(',', '.')),
        });
      }

      return {
        kind: 'exam_score',
        examKind: String(formData.get('examKind') ?? ''),
        scaleId: String(formData.get('scaleId') ?? 'unknown'),
        overall,
        ...(components.length > 0 ? { components } : {}),
        takenOn,
        resultOn,
        ...(validUntil ? { validUntil } : {}),
        provenance: 'self_reported',
      };
    }
    case 'document': {
      const validUntil = String(formData.get('validUntil') ?? '');
      return {
        kind: 'document',
        documentKind: String(formData.get('documentKind') ?? ''),
        ...(validUntil ? { validUntil } : {}),
        provenance: 'self_reported',
      };
    }
    case 'grade': {
      return {
        kind: 'grade',
        scaleId: String(formData.get('scaleId') ?? 'gpa_5'),
        value: Number(String(formData.get('value') ?? '').replace(',', '.')),
        provenance: 'self_reported',
      };
    }
    case 'subject': {
      const score = String(formData.get('score') ?? '');
      return {
        kind: 'subject',
        subjectId: String(formData.get('subjectId') ?? ''),
        ...(score ? { score: Number(score.replace(',', '.')) } : {}),
        provenance: 'self_reported',
      };
    }
    default:
      return { error: 'Неизвестный вид результата' };
  }
}

export async function previewResultAction(
  _prev: ResultPreview | null,
  formData: FormData,
): Promise<ResultPreview> {
  const { ownerId } = await visitorContext();
  const parsed = readResult(formData);
  if ('error' in parsed) {
    return { ok: false, message: parsed.error, diff: null, profileRevisionAfter: null };
  }

  return previewResult({
    ownerId,
    goalId: String(formData.get('goalId') ?? ''),
    taskId: String(formData.get('taskId') ?? ''),
    result: parsed,
    basis: DEFAULT_BASIS,
    expectedProgressRevision: Number(formData.get('expectedProgressRevision') ?? 0),
    expectedProfileRevision: Number(formData.get('expectedProfileRevision') ?? 0),
    at: appNow(),
  });
}

export async function recordResultAction(
  _prev: CommandResult | null,
  formData: FormData,
): Promise<CommandResult> {
  const { ownerId } = await visitorContext();
  const parsed = readResult(formData);
  if ('error' in parsed) {
    return { ok: false, kind: 'rejected', code: 'RESULT_INVALID', message: parsed.error };
  }

  const goalId = String(formData.get('goalId') ?? '');
  const taskId = String(formData.get('taskId') ?? '');
  const expectedProgress = Number(formData.get('expectedProgressRevision') ?? 0);
  const expectedProfile = Number(formData.get('expectedProfileRevision') ?? 0);

  const result = await recordResult({
    ownerId,
    goalId,
    taskId,
    result: parsed,
    basis: DEFAULT_BASIS,
    idempotencyKey: `${goalId}:${taskId}:result:${expectedProgress}:${expectedProfile}`,
    expectedProgressRevision: expectedProgress,
    expectedProfileRevision: expectedProfile,
    at: appNow(),
  });

  if (result.ok) revalidateEverything();
  return result;
}
