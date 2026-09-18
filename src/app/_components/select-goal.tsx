'use client';

/**
 * Закрепление цели.
 *
 * Раньше кнопка «Построить маршрут к этой цели» была обычной ссылкой на общий
 * маршрут, где цель выбиралась заново по рейтингу: можно было открыть одну
 * программу и увидеть план другой. Теперь выбор сохраняется на сервере и
 * используется обзором, маршрутом, целями и сценариями.
 */

import { useActionState } from 'react';

import { setGoalAction } from '../_actions/progress';
import type { SetGoalResult } from '@/server/progress-service';

export function SelectGoalButton({
  goalId,
  isActive,
  label = 'Построить маршрут к этой цели',
}: {
  goalId: string;
  isActive: boolean;
  label?: string;
}) {
  const [state, formAction, pending] = useActionState<SetGoalResult | null, FormData>(
    setGoalAction,
    null,
  );

  return (
    <form action={formAction} className="stack-tight">
      <input type="hidden" name="goalId" value={goalId} />
      <div className="actions">
        <button type="submit" className="btn" disabled={pending}>
          {pending ? 'Сохраняем цель…' : isActive ? 'Обновить маршрут к этой цели' : label}
        </button>
        {isActive ? (
          <a className="btn btn--secondary" href="/route">
            Открыть маршрут
          </a>
        ) : null}
      </div>

      {isActive && !state ? (
        <p className="small muted">Это ваша текущая активная цель — маршрут строится к ней.</p>
      ) : null}

      {state ? (
        state.ok ? (
          <p className="small" role="status" aria-live="polite">
            <span className="badge badge--ok">
              <span className="badge__glyph" aria-hidden="true">
                ✓
              </span>
              Цель сохранена
            </span>{' '}
            {state.message} <a href="/route">Перейти к маршруту</a>
          </p>
        ) : (
          <div className="notice notice--warn" role="alert">
            <p>{state.message}</p>
          </div>
        )
      ) : null}
    </form>
  );
}
