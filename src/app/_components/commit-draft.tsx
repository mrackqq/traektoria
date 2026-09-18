'use client';

/**
 * Применение анкеты.
 *
 * Это создание новой ревизии профиля, поэтому команда несёт обе ожидаемые
 * ревизии: профиля и черновика. Если параллельно записали результат экзамена
 * или другая вкладка дописала шаг, анкета не перезапишет это молча — вернётся
 * конфликт с объяснением, а черновик останется на месте.
 */

import { useActionState } from 'react';

import { commitDraftAction, discardDraftAction } from '../_actions/questionnaire';
import { NextSteps } from './start-screen';
import type { CommitDraftResult, DiscardDraftResult } from '@/server/questionnaire-service';

export function CommitDraft({
  profileRevision,
  draftRevision,
}: {
  profileRevision: number;
  draftRevision: number;
}) {
  const [state, formAction, pending] = useActionState<CommitDraftResult | null, FormData>(
    commitDraftAction,
    null,
  );
  const [discarded, discardAction, discarding] = useActionState<DiscardDraftResult | null, FormData>(
    discardDraftAction,
    null,
  );

  return (
    <section className="card stack-tight" aria-labelledby="commit">
      <p className="card__eyebrow">Применение</p>
      <h2 id="commit">Записать ответы в профиль</h2>
      <p>
        Текущая ревизия профиля — {profileRevision}. Применение создаст следующую;
        прежняя останется в истории, и расчёт на ней можно повторить.
      </p>

      <form action={formAction} className="stack-tight">
        <input type="hidden" name="expectedProfileRevision" value={profileRevision} />
        <input type="hidden" name="expectedDraftRevision" value={draftRevision} />
        <div className="actions">
          <button type="submit" className="btn" disabled={pending || discarding}>
            Применить анкету
          </button>
          <button
            type="submit"
            className="btn btn--secondary"
            formAction={discardAction}
            disabled={pending || discarding}
          >
            Отбросить черновик
          </button>
        </div>

        {pending ? (
          <p className="small muted" role="status" aria-live="polite">
            Записываем…
          </p>
        ) : null}

        {state && !pending ? (
          state.ok ? (
            <div className="stack-tight" role="status" aria-live="polite">
              <p className="small">
                <span className="badge badge--ok">
                  <span className="badge__glyph" aria-hidden="true">
                    ✓
                  </span>
                  Применено
                </span>{' '}
                {state.message}
              </p>

              {/* Одно заметное действие, остальные шаги — обычными ссылками. */}
              <div className="actions">
                <a className="btn" href="/profile">
                  Посмотреть диагностику
                </a>
              </div>

              <NextSteps />
            </div>
          ) : (
            <div className="notice notice--warn" role="alert">
              <p>{state.message}</p>

              {state.errors && state.errors.length > 0 ? (
                <ul className="small stack-tight">
                  {state.errors.map((e) => (
                    <li key={e.fieldId}>{e.message}</li>
                  ))}
                </ul>
              ) : null}

              {state.conflicts && state.conflicts.length > 0 ? (
                <ul className="small stack-tight">
                  {state.conflicts.map((c) => (
                    <li key={c.fieldId}>
                      <strong>{c.label}:</strong> в профиле «{c.current}», у вас «{c.yours}»
                      {c.base !== c.current ? ` (было «${c.base}»)` : ''}
                    </li>
                  ))}
                </ul>
              ) : null}

              <p className="small">
                Черновик не потерян. Обновите страницу, чтобы увидеть актуальные значения,
                и примените ещё раз.
              </p>
            </div>
          )
        ) : null}

        {discarded && !discarded.ok && !discarding ? (
          <div className="notice notice--warn" role="alert">
            <p>{discarded.message}</p>
          </div>
        ) : null}
      </form>
    </section>
  );
}
