'use client';

/**
 * Управление статусом действия (TASK-01) и обязательные состояния экрана
 * (UX-08): сохранение, успех, конфликт ревизий, отказ, недоступность.
 *
 * UX-09: результат команды объявляется через live-region, а не только
 * меняет цвет кнопки; у каждой кнопки есть текст, у каждого состояния —
 * подпись и доступное следующее действие.
 */

import { useActionState } from 'react';

import type { TaskStatus } from '@core/progress/state';

import { changeStatusAction } from '../_actions/progress';
import type { CommandResult } from '@/server/progress-service';

export interface StatusOption {
  readonly to: TaskStatus;
  readonly label: string;
  readonly primary?: boolean;
}

export function TaskControls({
  goalId,
  taskId,
  progressRevision,
  options,
  blockedReason,
}: {
  goalId: string;
  taskId: string;
  progressRevision: number;
  options: readonly StatusOption[];
  blockedReason?: string;
}) {
  const [state, formAction, pending] = useActionState<CommandResult | null, FormData>(
    changeStatusAction,
    null,
  );

  if (options.length === 0) {
    return (
      <p className="small muted" role="note">
        Доступных переходов нет: действие закрыто.
      </p>
    );
  }

  return (
    <form action={formAction} className="stack-tight">
      <input type="hidden" name="goalId" value={goalId} />
      <input type="hidden" name="taskId" value={taskId} />
      <input type="hidden" name="expectedProgressRevision" value={progressRevision} />

      {blockedReason ? (
        <p className="small muted">
          {blockedReason} Отметить можно и сейчас — блокировка это признак, а не запрет.
        </p>
      ) : null}

      <div className="actions">
        {options.map((o) => (
          <button
            key={o.to}
            type="submit"
            name="to"
            value={o.to}
            className={`btn ${o.primary ? '' : 'btn--secondary'}`}
            disabled={pending}
          >
            {o.label}
          </button>
        ))}
      </div>

      <CommandMessage state={state} pending={pending} />
    </form>
  );
}

export function CommandMessage({
  state,
  pending,
}: {
  state: CommandResult | null;
  pending: boolean;
}) {
  if (pending) {
    return (
      <p className="small muted" role="status" aria-live="polite">
        Сохраняем…
      </p>
    );
  }
  if (!state) return null;

  if (state.ok) {
    return (
      <p className="small" role="status" aria-live="polite">
        <span className="badge badge--ok">
          <span className="badge__glyph" aria-hidden="true">
            ✓
          </span>
          {state.kind === 'replayed' ? 'Уже применено' : 'Сохранено'}
        </span>{' '}
        {state.message}
      </p>
    );
  }

  if (state.kind === 'conflict') {
    return (
      <div className="notice notice--warn" role="alert">
        <p>
          <strong>Данные изменились в другом месте.</strong> {state.message}
        </p>
        <p className="small">
          Введённое не потеряно. Обновите страницу, чтобы увидеть актуальное состояние,
          и повторите действие.
        </p>
      </div>
    );
  }

  return (
    <div className="notice notice--risk" role="alert">
      <p>{state.message}</p>
      <p className="small">Код отказа: {state.code}</p>
    </div>
  );
}
