'use client';

/**
 * UX-02 — один шаг анкеты.
 *
 * Что здесь важно и почему именно так:
 *  • у каждого вопроса три режима ответа — «знаю», «не знаю», «не применимо».
 *    Это радиогруппа, а не чекбокс: состояния взаимоисключающие, и пустое
 *    поле («не отвечено») от «не знаю» отличается явно (PF-02);
 *  • ошибка валидации привязана к полю через `aria-describedby`, введённое
 *    при этом остаётся на месте — поля контролируемые (UX-02, UX-08);
 *  • условный вопрос появляется сразу при выборе, от которого он зависит,
 *    и объясняет, почему он появился.
 */

import { useActionState, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import {
  visibleFields,
  type Answer,
  type DraftValues,
  type Field,
  type Step,
} from '@core/profile/questionnaire';

import { saveStepAction } from '../_actions/questionnaire';
import type { SaveStepResult } from '@/server/questionnaire-service';

const INPUT_STYLE: React.CSSProperties = {
  display: 'block',
  width: '100%',
  minHeight: 'var(--tap)',
  padding: '0 var(--s-3)',
  border: '1px solid var(--c-border-strong)',
  borderRadius: 'var(--r-md)',
  background: 'var(--c-surface)',
  color: 'var(--c-text)',
  font: 'inherit',
};

export function QuestionnaireStep({
  step,
  initialValues,
  draftRevision,
  nextHref,
  prevHref,
}: {
  step: Step;
  initialValues: DraftValues;
  draftRevision: number;
  nextHref: string | null;
  prevHref: string | null;
}) {
  const [values, setValues] = useState<DraftValues>(initialValues);
  const [state, formAction, pending] = useActionState<SaveStepResult | null, FormData>(
    saveStepAction,
    null,
  );

  /**
   * Куда уйти после сохранения.
   *
   * Раньше кнопка «Сохранить» только сохраняла и оставалась на месте, а рядом
   * стояла ссылка «Пропустить шаг», которая уводила дальше НЕ сохраняя. Введённое
   * при этом молча пропадало, и анкету приходилось заполнять заново. Теперь любая
   * навигация по шагам сначала сохраняет ответы.
   */
  const router = useRouter();
  const goAfterSave = useRef<string | null>(null);
  const lastRevision = useRef<number | null>(null);

  useEffect(() => {
    if (!state?.ok) return;
    if (lastRevision.current === state.draftRevision) return;
    lastRevision.current = state.draftRevision;

    const target = goAfterSave.current;
    goAfterSave.current = null;
    // При ошибках в полях остаёмся на шаге: пусть пользователь их увидит.
    if (target && state.errors.length === 0) router.push(target);
  }, [state, router]);

  const fields = visibleFields(step, values);
  const errors = state?.ok ? state.errors : [];
  const errorFor = (id: string) => errors.find((e) => e.fieldId === id)?.message;

  const setAnswer = (id: string, answer: Answer) =>
    setValues((v) => ({ ...v, [id]: answer }));

  const revision = state?.ok ? state.draftRevision : draftRevision;

  return (
    <form action={formAction} className="stack-tight">
      <input type="hidden" name="stepId" value={step.id} />
      <input type="hidden" name="expectedDraftRevision" value={revision} />

      {/*
        Поля с общим `group` собираются под один подзаголовок: три экзамена
        подряд без разделителей читались как один длинный список.
      */}
      <div className="stack">
        {fields.map((field, index) => {
          const previous = index > 0 ? fields[index - 1] : undefined;
          const startsGroup = !!field.group && field.group !== previous?.group;
          return (
            <div key={field.id} className="stack-tight">
              {startsGroup ? (
                <h3 className="card__eyebrow" style={{ marginBottom: 0 }}>
                  {field.group}
                </h3>
              ) : null}
              <Question
                field={field}
                answer={values[field.id] ?? { state: 'unanswered' }}
                error={errorFor(field.id)}
                onChange={(a) => setAnswer(field.id, a)}
              />
            </div>
          );
        })}
      </div>

      <div className="actions form-actions">
        {prevHref ? (
          <button
            type="submit"
            className="btn btn--secondary"
            disabled={pending}
            onClick={() => {
              goAfterSave.current = prevHref;
            }}
          >
            Назад
          </button>
        ) : null}
        <button
          type="submit"
          className="btn"
          disabled={pending}
          onClick={() => {
            goAfterSave.current = nextHref ?? '/profile/edit?step=review';
          }}
        >
          {pending
            ? 'Сохраняем…'
            : nextHref
              ? 'Сохранить и продолжить'
              : 'Сохранить и проверить ответы'}
        </button>
      </div>
      <p className="small muted">
        Ответы сохраняются на сервере при каждом переходе. Незаполненное не мешает:
        анкету можно дозаполнить позже.
      </p>

      <StepMessage state={state} pending={pending} nextHref={nextHref} />
    </form>
  );
}

function StepMessage({
  state,
  pending,
  nextHref,
}: {
  state: SaveStepResult | null;
  pending: boolean;
  nextHref: string | null;
}) {
  if (pending) {
    return (
      <p className="small muted" role="status" aria-live="polite">
        Сохраняем ответы…
      </p>
    );
  }
  if (!state) return null;

  if (!state.ok) {
    return (
      <div className="notice notice--warn" role="alert">
        <p>{state.message}</p>
      </div>
    );
  }

  if (state.errors.length > 0) {
    return (
      <div className="notice notice--warn" role="alert">
        <p>{state.message}</p>
        <ul className="small stack-tight">
          {state.errors.map((e) => (
            <li key={e.fieldId}>{e.message}</li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="notice notice--info" role="status" aria-live="polite">
      <p className="small">
      <span className="badge badge--ok">
        <span className="badge__glyph" aria-hidden="true">
          ✓
        </span>
        Сохранено
      </span>{' '}
      {state.message}</p>
      <div className="actions">
      {nextHref ? (
        <a className="btn" href={nextHref}>Далее — следующий шаг →</a>
      ) : (
        <a className="btn" href="/profile/edit?step=review">Проверить ответы →</a>
      )}
      </div>
    </div>
  );
}

function Question({
  field,
  answer,
  error,
  onChange,
}: {
  field: Field;
  answer: Answer;
  error?: string | undefined;
  onChange: (a: Answer) => void;
}) {
  const id = `q-${field.id}`;
  const hintId = field.hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  const disabled = answer.state === 'dont_know' || answer.state === 'not_applicable';
  const listValue = Array.isArray(answer.value) ? answer.value : [];
  const textValue = typeof answer.value === 'string' ? answer.value : '';

  return (
    <fieldset className="question-card">
      <legend>{field.label}</legend>

      {field.appearsBecause ? (
        <p className="small muted" style={{ marginTop: 0 }}>
          {field.appearsBecause}
        </p>
      ) : null}

      {field.kind === 'multiselect' ? (
        <div className="picker">
          {(field.options ?? []).map((o) => (
            <label className="picker__item" key={o.value}>
              <input
                type="checkbox"
                name={`value:${field.id}`}
                value={o.value}
                checked={listValue.includes(o.value)}
                onChange={(e) => {
                  const next = e.target.checked
                    ? [...listValue, o.value]
                    : listValue.filter((x) => x !== o.value);
                  onChange({ state: next.length > 0 ? 'answered' : 'unanswered', value: next });
                }}
              />
              <span>{o.label}</span>
            </label>
          ))}
        </div>
      ) : field.kind === 'select' ? (
        <select
          id={id}
          name={`value:${field.id}`}
          value={textValue}
          disabled={disabled}
          aria-label={field.label}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          onChange={(e) =>
            onChange({
              state: e.target.value ? 'answered' : 'unanswered',
              value: e.target.value,
            })
          }
          style={INPUT_STYLE}
        >
          <option value="">Не выбрано</option>
          {(field.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          name={`value:${field.id}`}
          type={field.kind === 'date' ? 'date' : 'number'}
          value={textValue}
          disabled={disabled}
          aria-label={field.label}
          {...(field.min !== undefined ? { min: field.min } : {})}
          {...(field.max !== undefined ? { max: field.max } : {})}
          {...(field.step ? { step: field.step } : {})}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          onChange={(e) =>
            onChange({
              state: e.target.value ? 'answered' : 'unanswered',
              value: e.target.value,
            })
          }
          style={INPUT_STYLE}
        />
      )}

      {field.unit ? <span className="facts__note">Единица: {field.unit}</span> : null}

      {/* PF-02: «не знаю» — это ответ, а не пустое поле. */}
      {field.allowDontKnow ? (
        <div className="answer-modes">
          <label className="picker__item">
            <input
              type="radio"
              name={`mode:${field.id}`}
              value="known"
              checked={answer.state === 'answered' || answer.state === 'unanswered'}
              /* UX-08: переключение режима не стирает уже введённое. */
              onChange={() => onChange(keepValue(answer, hasValue(answer) ? 'answered' : 'unanswered'))}
            />
            <span className="small">Отвечу</span>
          </label>
          <label className="picker__item">
            <input
              type="radio"
              name={`mode:${field.id}`}
              value="dont_know"
              checked={answer.state === 'dont_know'}
              onChange={() => onChange(keepValue(answer, 'dont_know'))}
            />
            <span className="small">Не знаю</span>
          </label>
          <label className="picker__item">
            <input
              type="radio"
              name={`mode:${field.id}`}
              value="not_applicable"
              checked={answer.state === 'not_applicable'}
              onChange={() => onChange(keepValue(answer, 'not_applicable'))}
            />
            <span className="small">Не применимо</span>
          </label>
        </div>
      ) : (
        <input type="hidden" name={`mode:${field.id}`} value="known" />
      )}

      {answer.state === 'dont_know' ? (
        <p className="small muted">
          Зависящие от этого условия останутся неопределёнными — это честнее, чем угадать.
        </p>
      ) : null}

      {field.hint ? (
        <p className="small muted" id={hintId}>
          {field.hint}
        </p>
      ) : null}

      {error ? (
        <p className="small" id={errorId} role="alert" style={{ color: 'var(--c-risk)' }}>
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

function hasValue(answer: Answer): boolean {
  return Array.isArray(answer.value) ? answer.value.length > 0 : Boolean(answer.value);
}

/**
 * Смена режима ответа сохраняет набранное: передумать и вернуться к «отвечу»
 * не должно означать «набирай заново» (UX-08).
 */
function keepValue(answer: Answer, state: Answer['state']): Answer {
  return answer.value !== undefined ? { state, value: answer.value } : { state };
}
