'use client';

/**
 * UX-07 / TASK-02 — ввод результата с предпросмотром последствий.
 *
 * Порядок жёсткий: сначала «Показать последствия», потом «Подтвердить».
 * Кнопка подтверждения включается только для тех значений, для которых
 * предпросмотр реально посчитан; изменили поле — предпросмотр устарел и
 * подтверждение снова недоступно. Автоматического применения нет: ни по
 * закрытию блока, ни по уходу со страницы, ни по нажатию Enter (Enter
 * запускает предпросмотр).
 *
 * UX-08: введённое сохраняется при любой ошибке — поля контролируемые,
 * отказ сервера их не очищает.
 */

import { useActionState, useState } from 'react';

import { FEASIBILITY_LABEL_RU } from '@core/planning/bridge';
import { TASK_CHANGE_LABEL_RU } from '@core/scenarios/diff';

import { previewResultAction, recordResultAction } from '../_actions/progress';
import type { CommandResult, ResultPreview } from '@/server/progress-service';
import type { ResultSpec } from './result-spec';
import { CommandMessage } from './task-controls';

export function ResultForm({
  goalId,
  taskId,
  spec,
  progressRevision,
  profileRevision,
}: {
  goalId: string;
  taskId: string;
  spec: ResultSpec;
  progressRevision: number;
  profileRevision: number;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [previewedKey, setPreviewedKey] = useState<string | null>(null);

  const [preview, previewAction, previewPending] = useActionState<ResultPreview | null, FormData>(
    previewResultAction,
    null,
  );
  const [saved, saveAction, savePending] = useActionState<CommandResult | null, FormData>(
    recordResultAction,
    null,
  );

  const currentKey = JSON.stringify(values);
  const previewFresh = preview?.ok === true && previewedKey === currentKey;

  const set = (name: string, value: string) =>
    setValues((v) => ({ ...v, [name]: value }));

  return (
    <details className="stack-tight">
      <summary className="btn btn--secondary" style={{ display: 'inline-flex', cursor: 'pointer' }}>
        Внести результат
      </summary>

      <form action={previewAction} className="stack-tight" style={{ marginTop: 'var(--s-3)' }}>
        <input type="hidden" name="goalId" value={goalId} />
        <input type="hidden" name="taskId" value={taskId} />
        <input type="hidden" name="resultKind" value={spec.resultKind} />
        <input type="hidden" name="expectedProgressRevision" value={progressRevision} />
        <input type="hidden" name="expectedProfileRevision" value={profileRevision} />
        {Object.entries(spec.hiddenFields).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}

        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="card__eyebrow">{spec.title}</legend>
          <div className="facts">
            {spec.fields.map((f) => {
              const id = `${taskId}-${f.name}`;
              return (
                <div key={f.name}>
                  <label className="facts__term" htmlFor={id}>
                    {f.label}
                    {f.required ? '' : ' (необязательно)'}
                  </label>
                  <input
                    id={id}
                    name={f.name}
                    type={f.type}
                    {...(f.step ? { step: f.step } : {})}
                    required={f.required}
                    value={values[f.name] ?? ''}
                    onChange={(e) => set(f.name, e.target.value)}
                    style={{
                      display: 'block',
                      width: '100%',
                      minHeight: 'var(--tap)',
                      padding: '0 var(--s-3)',
                      border: '1px solid var(--c-border-strong)',
                      borderRadius: 'var(--r-md)',
                      background: 'var(--c-surface)',
                      color: 'var(--c-text)',
                      font: 'inherit',
                    }}
                    {...(f.hint ? { 'aria-describedby': `${id}-hint` } : {})}
                  />
                  {f.hint ? (
                    <span className="facts__note" id={`${id}-hint`}>
                      {f.hint}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        </fieldset>

        <p className="small muted">
          Происхождение результата — «с ваших слов». Условие закроется именно с этим
          происхождением, и оно будет видно на карточке программы.
        </p>

        <div className="actions">
          <button
            type="submit"
            className="btn btn--secondary"
            disabled={previewPending || savePending}
            onClick={() => setPreviewedKey(currentKey)}
          >
            Показать последствия
          </button>
          <button
            type="submit"
            className="btn"
            formAction={saveAction}
            disabled={!previewFresh || savePending || previewPending}
          >
            Подтвердить и сохранить
          </button>
        </div>

        {previewPending ? (
          <p className="small muted" role="status" aria-live="polite">
            Считаем последствия…
          </p>
        ) : null}

        {preview && !previewPending ? <PreviewBlock preview={preview} /> : null}

        {!previewFresh && preview?.ok && !previewPending ? (
          <p className="small muted" role="status" aria-live="polite">
            Значения изменились — предпросмотр устарел. Посчитайте последствия заново.
          </p>
        ) : null}

        <CommandMessage state={saved} pending={savePending} />
      </form>
    </details>
  );
}

function PreviewBlock({ preview }: { preview: ResultPreview }) {
  if (!preview.ok) {
    return (
      <div className="notice notice--risk" role="alert">
        <p>{preview.message}</p>
      </div>
    );
  }

  const diff = preview.diff;
  const changed = (diff?.taskChanges ?? []).filter((c) => c.kind !== 'unchanged');

  return (
    <section className="notice notice--info" aria-label="Последствия результата">
      <h4 style={{ margin: 0 }}>Что изменится, если подтвердить</h4>

      {diff ? (
        <>
          <p className="small">
            Выполнимость графика: {FEASIBILITY_LABEL_RU[diff.goalStatusBefore]} →{' '}
            <strong>{FEASIBILITY_LABEL_RU[diff.goalStatusAfter]}</strong>
          </p>
          <p className="small">
            Следующий шаг: {diff.nextStepBefore ?? 'нет'} → <strong>{diff.nextStepAfter ?? 'нет'}</strong>
          </p>
          {changed.length === 0 ? (
            <p className="small">Состав и даты действий не меняются.</p>
          ) : (
            <ul className="small stack-tight">
              {changed.map((c) => (
                <li key={c.semanticKey}>
                  {TASK_CHANGE_LABEL_RU[c.kind]}: «{c.title}»
                  {c.shiftDays ? ` — сдвиг на ${c.shiftDays} дн.` : ''}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="small">Маршрут не пересчитывается: активной цели нет.</p>
      )}

      <p className="small">
        Ревизия профиля станет {preview.profileRevisionAfter}. {preview.message}
      </p>
    </section>
  );
}
