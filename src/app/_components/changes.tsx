/**
 * «Что изменилось» после применения анкеты.
 *
 * Сводка уже считалась и сохранялась в `lastRecalc`, но нигде не показывалась,
 * хотя после применения анкеты пользователю обещали ссылку «Посмотреть, что
 * изменилось».
 *
 * Блок показывается ТОЛЬКО для текущей ревизии профиля: после следующего
 * изменения старая сводка перестала бы соответствовать тому, что на экране,
 * и вводила бы в заблуждение. Выдуманных сравнений здесь нет — выводится
 * ровно то, что посчитано.
 */

import type { RecalcSummary } from '@core/profile/changes';

export function ChangesBlock({
  summary,
  profileRevision,
}: {
  summary: RecalcSummary | null;
  /** Текущая ревизия профиля: сводка относится только к ней. */
  profileRevision: number;
}) {
  if (!summary) return null;
  if (summary.profileRevisionAfter !== profileRevision) return null;

  // Первое заполнение и правку существующего ответа показываем по-разному:
  // «не заполнено → 2027» выглядит как дефект профиля, а не как ответ.
  const added = summary.changes.filter((c) => c.firstTime);
  const edited = summary.changes.filter((c) => !c.firstTime);

  const recommendationsChanged =
    summary.fitBefore !== summary.fitAfter ||
    summary.alternativesBefore !== summary.alternativesAfter ||
    summary.topBefore !== summary.topAfter;

  const planChanged =
    summary.tasksBefore !== summary.tasksAfter ||
    summary.nextActionBefore !== summary.nextActionAfter;

  return (
    <section className="card stack-tight" aria-labelledby="changes-heading">
      <p className="card__eyebrow">После изменения анкеты</p>
      <h2 id="changes-heading">Что изменилось</h2>

      <p className="small muted">Подбор пересчитан по вашим новым ответам.</p>

      {added.length > 0 ? (
        <details className="answer-changes">
          <summary>Заполнено впервые · {added.length} ответов</summary>
          <ul className="stack-tight small">
            {added.map((c) => (
              <li key={c.fieldId}>
                <strong>{c.label}:</strong> {c.after}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {edited.length > 0 ? (
        <details className="answer-changes">
          <summary>Изменено · {edited.length} ответов</summary>
          <ul className="stack-tight small">
            {edited.map((c) => (
              <li key={c.fieldId}>
                <strong>{c.label}:</strong> было «{c.before}», стало «{c.after}»
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {recommendationsChanged ? (
        <div className="stack-tight">
          <h3>Рекомендации</h3>
          <p className="task__meta">
            <span>
              Подходящих: {summary.fitBefore} → {summary.fitAfter}
            </span>
            <span>
              Альтернатив: {summary.alternativesBefore} → {summary.alternativesAfter}
            </span>
          </p>
          {summary.topBefore !== summary.topAfter ? (
            <p className="small">
              Первый в списке: «{summary.topBefore ?? 'ничего'}» → «{summary.topAfter ?? 'ничего'}».
            </p>
          ) : null}
        </div>
      ) : null}

      {planChanged ? (
        <div className="stack-tight">
          <h3>План</h3>
          <p className="task__meta">
            <span>
              Действий в маршруте: {summary.tasksBefore} → {summary.tasksAfter}
            </span>
          </p>
          {summary.nextActionBefore !== summary.nextActionAfter ? (
            <p className="small">
              Ближайшее действие: «{summary.nextActionBefore ?? 'нет'}» →{' '}
              <strong>«{summary.nextActionAfter ?? 'нет'}»</strong>.
            </p>
          ) : null}
        </div>
      ) : null}

      {summary.activeGoalStillFits === false ? (
        <p className="small">
          <strong>Выбранная цель</strong>
          {summary.activeGoalTitle ? ` («${summary.activeGoalTitle}»)` : ''} больше не проходит
          по вашим данным. Переключать её за вас мы не будем — решение остаётся за вами.
        </p>
      ) : null}

      <ul className="stack-tight small muted">
        {summary.notes.map((n, i) => (
          <li key={i}>{n}</li>
        ))}
      </ul>
    </section>
  );
}
