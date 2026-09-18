/**
 * ST-01…ST-13, UX-06, UX-07 — «Сценарии» (стресс-тест маршрута).
 *
 * UX-06: метка симуляции видна на всех экранах сценария. Выход из сценария
 * не меняет основные данные — здесь это гарантировано структурно: расчёт
 * чистый, ничего не сохраняется, фактический профиль не передаётся в запись.
 * UX-07: показывается полный diff «было → станет» с причинами ДО любого
 * подтверждения; автоматического применения нет вовсе.
 */

import Link from 'next/link';

import { DEMO_SCENARIOS, findDemoScenario, runScenario } from '@core/demo/scenario';
import { EVENT_LABEL_RU } from '@core/scenarios/overlay';
import { TASK_CHANGE_LABEL_RU, type TaskChange } from '@core/scenarios/diff';
import { formatPlainDateRu } from '@core/kernel/time';

import { Badge, FeasibilityBadge, Notice } from '../_components/ui';
import { getSession } from '../_lib/session';

export const metadata = { title: 'Сценарии — Траектория' };
export const dynamic = 'force-dynamic';

export default async function ScenariosPage({
  searchParams,
}: {
  searchParams: Promise<{ case?: string }>;
}) {
  const { case: caseId } = await searchParams;
  const session = await getSession();
  const demo = findDemoScenario(caseId);
  const run = runScenario(session, demo.title, demo.build(session));
  const diff = run.diff;

  return (
    <div className="stack">
      <header className="stack-tight">
        <p className="card__eyebrow">Меняйте предположения, не данные</p>
        <h1>А что, если?</h1>
        <p className="lede">
          Стресс-тест отвечает на вопрос «что будет, если». Расчёт идёт на копии ваших
          данных: ни профиль, ни маршрут, ни результаты не меняются — ни при сохранении,
          ни при ошибке, ни при выходе с экрана.
        </p>
        <ul className="badge-row">
          <li>
            <Badge tone="demo" glyph="≈">
              Симуляция: гипотеза, а не факт
            </Badge>
          </li>
        </ul>
      </header>

      <nav className="card stack-tight" aria-label="Выбор сценария">
        <p className="card__eyebrow">Что проверяем</p>
        <ul className="badge-row">
          {DEMO_SCENARIOS.map((s) => (
            <li key={s.id}>
              <Link
                className={`btn ${s.id === demo.id ? '' : 'btn--secondary'}`}
                href={`/scenarios?case=${s.id}`}
              >
                {s.title}
              </Link>
            </li>
          ))}
        </ul>
        <p className="muted">{demo.question}</p>
      </nav>

      {run.conflicts.length > 0 ? (
        <Notice tone="risk" title="Параметры сценария противоречивы">
          <ul className="stack-tight">
            {run.conflicts.map((c) => (
              <li key={c.code + c.eventIds.join(',')}>{c.message}</li>
            ))}
          </ul>
          <p className="small">
            Расчёт не запускался: противоречие в параметрах разрешает пользователь, а не
            система молча.
          </p>
        </Notice>
      ) : null}

      {!run.goal ? (
        <Notice tone="warn" title="Нет активной цели">
          <p>Сценарий строится поверх маршрута. Сначала выберите цель.</p>
          <p>
            <Link className="btn" href="/programs">
              К программам
            </Link>
          </p>
        </Notice>
      ) : null}

      {run.events.length > 0 ? (
        <section className="card stack-tight" aria-labelledby="events">
          <p className="card__eyebrow">События сценария</p>
          <h2 id="events">Предположения</h2>
          <ul className="tasks">
            {run.events.map((e) => (
              <li key={e.id} className="task">
                <h3 className="task__title">{EVENT_LABEL_RU[e.type]}</h3>
                <p className="task__outcome">{e.explanation}</p>
                <p className="task__meta">
                  <span>Действует с {formatPlainDateRu(e.effectiveDate)}</span>
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {diff ? (
        <>
          <section className="card stack-tight" aria-labelledby="verdict">
            <p className="card__eyebrow">Было → станет</p>
            <h2 id="verdict">Выполнимость графика</h2>
            <ul className="badge-row">
              <li>
                <span className="small muted">Сейчас:</span>{' '}
                <FeasibilityBadge status={diff.goalStatusBefore} />
              </li>
              <li>
                <span className="small muted">В сценарии:</span>{' '}
                <FeasibilityBadge status={diff.goalStatusAfter} />
              </li>
            </ul>
            <p>
              {diff.statusChanged
                ? 'Статус меняется — ниже перечислено, из-за чего именно.'
                : 'Статус графика не меняется. Это не значит, что не меняется ничего: смотрите изменения действий и денег.'}
            </p>
            <p className="task__meta">
              <span>Следующий шаг сейчас: {diff.nextStepBefore ?? 'нет'}</span>
              <span>В сценарии: {diff.nextStepAfter ?? 'нет'}</span>
            </p>
          </section>

          <section className="stack-tight" aria-labelledby="causes">
            <h2 id="causes">Почему так</h2>
            <p className="small muted">
              Цепочка причин: событие → ограничение → что изменилось. Изменения источников
              и просто прошедшее время сюда не приписываются.
            </p>
            <ul className="tasks">
              {diff.causeChains.map((c, i) => (
                <li key={`${c.eventId}-${i}`} className="task">
                  <p className="task__meta">
                    <strong>{c.eventLabel}</strong>
                    <span aria-hidden="true">→</span>
                    <span>{c.constraint}</span>
                    <span aria-hidden="true">→</span>
                    <span>{c.effect}</span>
                  </p>
                </li>
              ))}
            </ul>
          </section>

          <section className="stack-tight" aria-labelledby="changes">
            <h2 id="changes">Изменения действий</h2>
            <ul className="tasks">
              {diff.taskChanges.map((c) => (
                <TaskChangeRow key={c.semanticKey} change={c} />
              ))}
            </ul>
          </section>

          <div className="grid">
            <section className="card stack-tight" aria-labelledby="preserved">
              <p className="card__eyebrow">Результаты и документы</p>
              <h2 id="preserved">Что сохраняется</h2>
              {diff.preservedResults.length === 0 ? (
                <p className="muted">Переиспользуемых результатов нет.</p>
              ) : (
                <ul className="stack-tight small">
                  {diff.preservedResults.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              )}
              {diff.lostApplicability.length > 0 ? (
                <>
                  <h3>Теряет применимость</h3>
                  <ul className="stack-tight small">
                    {diff.lostApplicability.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </>
              ) : null}
            </section>

            <section className="card stack-tight" aria-labelledby="uncertain">
              <p className="card__eyebrow">Ограничения сценария</p>
              <h2 id="uncertain">Чего мы не знаем</h2>
              {diff.uncertainties.length === 0 ? (
                <p className="muted">Дополнительных неопределённостей сценарий не добавил.</p>
              ) : (
                <ul className="stack-tight small">
                  {diff.uncertainties.map((u, i) => (
                    <li key={i}>{u}</li>
                  ))}
                </ul>
              )}
              {diff.newCosts.length > 0 ? (
                <>
                  <h3>Новые расходы</h3>
                  <ul className="stack-tight small">
                    {diff.newCosts.map((c) => (
                      <li key={c.label}>
                        {c.label}: {c.amount}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </section>
          </div>

          <Notice tone="info" title="Сценарий ничего не изменил">
            <p>
              Это предпросмотр. Фактический профиль, основная стратегия, результаты экзаменов
              и прогресс остались прежними. Чтобы часть сценария стала планом, её нужно
              подтвердить явно — автоматического применения при закрытии страницы нет.
            </p>
            <div className="actions">
              <Link className="btn btn--secondary" href="/route">
                Вернуться к основному маршруту
              </Link>
            </div>
          </Notice>
        </>
      ) : null}
    </div>
  );
}

function TaskChangeRow({ change }: { change: TaskChange }) {
  const tone =
    change.kind === 'obsolete'
      ? 'risk'
      : change.kind === 'added'
        ? 'warn'
        : change.kind === 'unchanged'
          ? 'neutral'
          : 'unknown';

  return (
    <li className="task">
      <h3 className="task__title">{change.title}</h3>
      <ul className="badge-row">
        <li>
          <Badge tone={tone} glyph={change.kind === 'unchanged' ? '=' : '≠'}>
            {TASK_CHANGE_LABEL_RU[change.kind]}
          </Badge>
        </li>
        {change.shiftDays !== undefined && change.shiftDays !== 0 ? (
          <li>
            <Badge tone={change.shiftDays > 0 ? 'warn' : 'ok'} glyph={change.shiftDays > 0 ? '→' : '←'}>
              {change.shiftDays > 0
                ? `на ${change.shiftDays} дн. позже`
                : `на ${Math.abs(change.shiftDays)} дн. раньше`}
            </Badge>
          </li>
        ) : null}
      </ul>
      {change.before || change.after ? (
        <p className="task__meta">
          {change.before ? (
            <span>
              Было: {formatPlainDateRu(change.before.start)} — {formatPlainDateRu(change.before.finish)}
            </span>
          ) : (
            <span>Было: действия не было</span>
          )}
          {change.after ? (
            <span>
              Станет: {formatPlainDateRu(change.after.start)} — {formatPlainDateRu(change.after.finish)}
            </span>
          ) : (
            <span>Станет: действие не нужно</span>
          )}
        </p>
      ) : null}
      {change.note ? <p className="small muted">{change.note}</p> : null}
    </li>
  );
}
