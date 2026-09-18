/**
 * Диагностика профиля по правилам сервиса.
 *
 * Этот блок обязателен и не зависит от модели. Раньше краткая сводка жила
 * только внутри AI-компонента, и при отсутствии ключа, таймауте или ошибке
 * OpenRouter она исчезала целиком — хотя `session.diagnosis` посчитан
 * детерминированно и доступен всегда.
 *
 * AI ничего здесь не заменяет: он может добавить связное объяснение рядом,
 * но образовательная цель, сильные стороны, ограничения, недостающие ответы
 * и приоритет подготовки показываются из расчёта.
 */

import Link from 'next/link';

import type { Diagnosis } from '@core/profile/diagnosis';

import { Badge } from './ui';

export function DiagnosisBlock({
  diagnosis,
  compact = false,
}: {
  diagnosis: Diagnosis;
  /** Компактный вид: только цель и приоритет — для обзора. */
  compact?: boolean;
}) {
  const hasAnything =
    diagnosis.strengths.length > 0 ||
    diagnosis.limits.length > 0 ||
    diagnosis.priorities.length > 0 ||
    diagnosis.missingAnswers.length > 0;

  return (
    <section className="card stack-tight" aria-labelledby="diagnosis-heading">
      <p className="card__eyebrow">Диагностика</p>
      <h2 id="diagnosis-heading">Что мы поняли по вашим ответам</h2>

      <ul className="badge-row">
        <li>
          <Badge tone="neutral" glyph="§">
            Расчёт по правилам сервиса
          </Badge>
        </li>
      </ul>

      <p className="lede">{diagnosis.goalSummary}</p>

      {!hasAnything ? (
        <p className="muted">
          Пока ответов слишком мало, чтобы делать выводы.{' '}
          <Link href="/profile/edit">Заполните анкету</Link> — после этого здесь появятся
          сильные стороны, ограничения и приоритет подготовки.
        </p>
      ) : null}

      {diagnosis.priorities.length > 0 ? (
        <div className="stack-tight">
          <h3>С чего начинать</h3>
          <ul className="tasks">
            {diagnosis.priorities.map((p) => (
              <li key={p.countingKey} className="task">
                <h4 className="task__title">{p.title}</h4>
                <p className="small muted">{p.explanation}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {compact ? null : (
        <>
          {diagnosis.strengths.length > 0 ? (
            <div className="stack-tight">
              <h3>Сильные стороны</h3>
              <ul className="stack-tight small">
                {diagnosis.strengths.map((s) => (
                  <li key={s.id}>{s.text}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {diagnosis.limits.length > 0 ? (
            <div className="stack-tight">
              <h3>Ограничения</h3>
              <ul className="stack-tight small">
                {diagnosis.limits.map((s) => (
                  <li key={s.id}>{s.text}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {diagnosis.gaps.length > 0 ? (
            <div className="stack-tight">
              <h3>Что пока не выполнено</h3>
              <ul className="stack-tight small">
                {diagnosis.gaps.map((s) => (
                  <li key={s.id}>{s.text}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {diagnosis.missingAnswers.length > 0 ? (
            <div className="stack-tight">
              <h3>Чего не хватает в анкете</h3>
              <ul className="stack-tight small">
                {diagnosis.missingAnswers.map((s) => (
                  <li key={s.id}>{s.text}</li>
                ))}
              </ul>
              <p className="small">
                <Link href="/profile/edit">Дополнить анкету</Link> — без этих ответов часть
                выводов остаётся неопределённой.
              </p>
            </div>
          ) : null}
        </>
      )}

      <p className="task__meta">
        <span>Вариантов по вашим фильтрам: {diagnosis.fitCount}</span>
        <span>альтернатив: {diagnosis.alternativesCount}</span>
        <span>рассмотрено путей подачи: {diagnosis.consideredCount}</span>
      </p>
    </section>
  );
}
