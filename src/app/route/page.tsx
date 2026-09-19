/**
 * BR-01…BR-12, UX-04, UX-05 — «Маршрут» («Мост к мечте»).
 *
 * UX-04: два полноценных представления. Первичен вертикальный список —
 * он самодостаточен; карта зависимостей объясняет связи и ничего не требует.
 * BR-09: до трёх содержательно разных путей, с честной пометкой «лучшие среди
 * рассмотренных» и числом рассмотренных альтернатив.
 * BR-10: положительный статус означает выполнимость ГРАФИКА при указанных
 * предположениях, а не достижение балла и не поступление.
 */

import Link from 'next/link';

import { flattenLeaves } from '@core/eligibility/evaluate';
import { formatPlainDateRu } from '@core/kernel/time';
import type { TaskView } from '@core/progress/next-action';

import { isClosed, requiresStructuredResult, type TaskStatus } from '@core/progress/state';
import { findTemplate } from '@core/planning/tasks-library';

import { ResultForm } from '../_components/result-form';
import { resultSpecFor } from '../_components/result-spec';
import { RouteMap } from '../_components/route-map';
import { TaskControls, type StatusOption } from '../_components/task-controls';
import {
  CalculationStamp,
  Counters,
  FeasibilityBadge,
  Notice,
  TaskStatusBadge,
} from '../_components/ui';
import { Suspense } from 'react';

import { AiPending, AiTaskGuidance } from '../_components/ai-insight';
import { getAdviceFor, getPageSession, type PageSession, type SessionSnapshot } from '../_lib/session';
import { Icon } from '../_components/icon';
import { NeedsAnswers } from '../_components/needs-answers';

export const metadata = { title: 'Маршрут — Траектория' };

export const dynamic = 'force-dynamic';

export default async function RoutePage() {
  const page = await getPageSession();
  const s = page.snapshot;
  const goal = s.activeGoal;
  const route = s.route;

  // Новичку здесь нечего показать — но это не тревога, а нормальное начало.
  // Янтарная плашка «Маршрут не построен» сообщала о поломке там, где ничего
  // не сломалось, и выбивалась из того, как о пустоте говорят остальные
  // разделы. Отсутствие цели у заполнившего анкету — другое дело: там
  // действительно нужно вмешаться, и предупреждение остаётся.
  if (!s.profileStarted) {
    return (
      <NeedsAnswers
        lede="План собирается под конкретную программу: экзамены, документы и сроки зависят от того, куда вы поступаете."
        gives={[
          'Шаги до подачи документов в понятном порядке',
          'Сроки, к которым каждый шаг надо успеть',
          'Один ближайший шаг, с которого начать сегодня',
        ]}
      />
    );
  }

  if (!goal || !route) {
    return (
      <div className="stack">
        <h1>Ваш план действий</h1>
        <Notice tone="warn" title="Маршрут не построен">
          <p>Ответы есть, но программа ещё не выбрана — а план строится под конкретную программу.</p>
          <p>
            <Link className="btn" href="/programs">
              Выбрать программу
            </Link>
          </p>
        </Notice>
      </div>
    );
  }

  const nextTaskId = s.nextAction.kind === 'action' ? s.nextAction.view.task.id : undefined;
  const leafTitles = new Map(
    flattenLeaves(goal.assessment.tree).map((l) => [l.nodeId, l.title] as const),
  );

  return (
    <div className="stack">
      <header className="stack-tight">
        <p className="card__eyebrow">Шаг 4 · Подготовка к поступлению</p>
        <h1>Ваш маршрут поступления</h1>
        <p className="lede">
          {goal.program.title} — {goal.university.shortName}, {goal.path.label}.
          Начните с выделенного шага и отмечайте прогресс. Сроки приёма нужно подтвердить у вуза.
        </p>
        <ul className="badge-row">
          <li>
            <FeasibilityBadge status={route.feasibility.status} />
          </li>
          <li className="small muted route-search-note">
            Рассмотрено вариантов: {s.bridge?.consideredCount ?? 0}
            {s.bridge?.searchComplete ? ', перебор полный' : ', перебор неполный'}
          </li>
        </ul>
      </header>

      {/*
        Сохранённая цель могла перестать подходить. Предупреждение стоит ПЕРЕД
        планом: иначе выполнимый график читается как подтверждение доступности
        поступления, чем он не является.
      */}
      {s.activeGoalIssue ? (
        <Notice tone="warn" title="Эта цель перестала подходить по вашим данным">
          <p>{s.activeGoalIssue.message}</p>
          {s.activeGoalIssue.code === 'BLOCKED' &&
          s.recommendation.requestedYear !== null &&
          s.recommendation.requestedYear !== goal.intake.admissionYear ? (
            <p className="small">
              Кампания относится к {goal.intake.admissionYear} году набора, а в анкете
              указан {s.recommendation.requestedYear}. План ниже построен к выбранной
              вами цели и не подтверждает, что подача в этом году возможна.
            </p>
          ) : null}
          <p className="small">
            Цель и отмеченный прогресс сохранены: автоматически мы её не переключаем.
          </p>
          <div className="actions">
            <Link className="btn btn--secondary" href="/profile/edit">
              Изменить анкету
            </Link>
            <Link className="btn btn--secondary" href="/programs">
              Выбрать другую программу
            </Link>
          </div>
        </Notice>
      ) : null}

      {s.nextAction.kind === 'action' ? (
        <section className="card next-card route-next stack-tight" aria-labelledby="route-next-heading">
          <p className="card__eyebrow"><Icon name="route" size={17} /> Начните с этого</p>
          <h2 id="route-next-heading">{s.nextAction.view.task.template.title}</h2>
          <p>{s.nextAction.view.task.template.requiredOutcome}</p>
          <p className="small muted">{s.nextAction.explanation}</p>
          <a className="btn" href={`#task-${s.nextAction.view.task.id}`}>Перейти к шагу <Icon name="arrow" size={17} /></a>
        </section>
      ) : (
        <Notice title="Что делать сейчас"><p>{s.nextAction.explanation}</p><p>{s.nextAction.hint}</p><a href="#list-heading">Посмотреть действия и их статусы</a></Notice>
      )}

      <section className="card stack-tight" aria-labelledby="feasibility">
        <p className="card__eyebrow">Выполнимость графика</p>
        <h2 id="feasibility">{route.label}</h2>
        <p>{route.rationale}</p>
        <p className="task__meta">
          <span>
            Нагрузка: требуется ≈{Math.round(route.feasibility.requiredWeeklyHours)} ч/нед
          </span>
          <span>
            {route.feasibility.availableWeeklyHours === null
              ? 'доступное время не указано в профиле'
              : `доступно ${route.feasibility.availableWeeklyHours} ч/нед`}
          </span>
          <span>
            Трудозатраты всего: {route.totalEffortHours.min}–{route.totalEffortHours.max} ч
          </span>
        </p>

        {route.feasibility.limitations.length > 0 ? (
          <div className="notice notice--warn">
            <h3>Что мешает</h3>
            <ul className="stack-tight">
              {route.feasibility.limitations.map((l, i) => (
                <li key={`${l.code}-${i}`}>{l.message}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <details className="card disclosure">
        <summary id="map-heading"><span><strong>Как связаны действия</strong><small>Откройте карту, если хотите понять порядок подготовки.</small></span><Icon name="chevron" size={19} /></summary>
        <RouteMap views={s.taskViews} {...(nextTaskId ? { nextTaskId } : {})} />
      </details>

      <section className="stack-tight route-actions" aria-labelledby="list-heading">
        <h2 id="list-heading">Действия по порядку</h2>
        <p className="small muted">
          Выделен ближайший доступный шаг. У каждого действия есть инструкция,
          результат и сроки. Если шаг ждёт другой задачи — это указано на карточке.
        </p>
        <ul className="tasks">
          {s.taskViews.map((v) => (
            <TaskItem
              key={v.task.id}
              view={v}
              isNext={v.task.id === nextTaskId}
              leafTitles={leafTitles}
              goalTitle={`${goal.program.title} · ${goal.path.label}`}
              goalId={goal.path.id}
              progressRevision={s.progress.revision}
              profileRevision={s.profile.revision}
            />
          ))}
        </ul>
      </section>

      <Suspense fallback={<AiPending title="Готовим подсказки к действиям" />}>
        <AiRoute page={page} />
      </Suspense>

      <ClosedOutsideRoute session={s} goalId={goal.path.id} />

      {s.bridge && s.bridge.routes.length > 1 ? (
        <section className="stack-tight" aria-labelledby="alt-heading">
          <h2 id="alt-heading">Другие рассмотренные пути</h2>
          <p className="small muted">
            Это лучшие среди рассмотренных вариантов, а не все возможные.
          </p>
          <div className="grid">
            {s.bridge.routes.slice(1).map((r) => (
              <article key={r.id} className="card stack-tight">
                <h3>{r.label}</h3>
                <p className="small">{r.rationale}</p>
                <ul className="badge-row">
                  <li>
                    <FeasibilityBadge status={r.feasibility.status} />
                  </li>
                </ul>
                <p className="task__meta">
                  <span>действий: {r.tasks.length}</span>
                  <span>
                    трудозатраты: {r.totalEffortHours.min}–{r.totalEffortHours.max} ч
                  </span>
                </p>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="card stack-tight" aria-labelledby="progress-heading">
        <p className="card__eyebrow">Прогресс</p>
        <h2 id="progress-heading">Действия и условия</h2>
        <Counters counters={s.counters} />
      </section>

      <CalculationStamp keyInfo={s.key} />
    </div>
  );
}

/** Подсказки модели по действиям текущего маршрута. */
async function AiRoute({ page }: { page: PageSession }) {
  const advice = await getAdviceFor(page);
  const titles = new Map(
    page.snapshot.taskViews.map((v) => [v.task.id, v.task.template.title]),
  );
  return <AiTaskGuidance advice={advice} titles={titles} />;
}

/**
 * Действия, закрытые пользователем и больше не нужные маршруту.
 *
 * TASK-01/TASK-03: выполненная задача не исчезает бесследно. Когда факт
 * закрыл условие, действие уходит из плана — но его результат остаётся,
 * и снять отметку должно быть можно, иначе ошибочная отметка необратима.
 */
function ClosedOutsideRoute({
  session,
  goalId,
}: {
  session: SessionSnapshot;
  goalId: string;
}) {
  const inRoute = new Set((session.route?.tasks ?? []).map((t) => t.id));
  const closed = session.progress.tasks.filter(
    (t) => !inRoute.has(t.taskId) && isClosed(t.status),
  );
  if (closed.length === 0) return null;

  return (
    <section className="stack-tight" aria-labelledby="closed-heading">
      <h2 id="closed-heading">Закрытые действия ({closed.length})</h2>
      <p className="small muted">
        Этих действий больше нет в плане: их результат уже учтён в условиях. История
        и возможность снять отметку сохраняются.
      </p>
      <ul className="tasks">
        {closed.map((t) => {
          const title = findTemplate(t.semanticKey)?.title ?? t.semanticKey;
          const last = t.history[t.history.length - 1];
          return (
            <li key={t.taskId} className="task task--done">
              <div className="stack-tight">
                <h3 className="task__title">{title}</h3>
                <ul className="badge-row">
                  <li>
                    <TaskStatusBadge status={t.status} />
                  </li>
                </ul>
                {last ? (
                  <p className="task__meta">
                    <span>Отмечено: {last.at.slice(0, 10)}</span>
                    <span>Основание: {last.basis}</span>
                  </p>
                ) : null}
                <TaskControls
                  goalId={goalId}
                  taskId={t.taskId}
                  progressRevision={session.progress.revision}
                  options={statusOptions(t.status, requiresStructuredResult(t.kind))}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * UX-05: у задачи доступны требуемый результат, инструкция, источник условия,
 * тип даты, зависимости и связанные цели — без перехода на другой экран.
 */
function TaskItem({
  view,
  isNext,
  leafTitles,
  goalTitle,
  goalId,
  progressRevision,
  profileRevision,
}: {
  view: TaskView;
  isNext: boolean;
  leafTitles: ReadonlyMap<string, string>;
  goalTitle: string;
  goalId: string;
  progressRevision: number;
  profileRevision: number;
}) {
  const t = view.task;
  const needsResult = requiresStructuredResult(t.template.kind);
  const spec = needsResult ? resultSpecFor(t) : null;
  const closes = t.closesLeafIds
    .map((id) => leafTitles.get(id))
    .filter((x): x is string => x !== undefined);

  const classes = [
    'task',
    isNext ? 'task--next' : '',
    view.flags.blocked ? 'task--blocked' : '',
    view.state.status === 'done' ? 'task--done' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <li className={classes} id={`task-${t.id}`}>
      <div className="stack-tight">
        <h3 className="task__title">
          {isNext ? <span className="visually-hidden">Следующее действие: </span> : null}
          {t.template.title}
        </h3>

        <ul className="badge-row">
          <li>
            <TaskStatusBadge status={view.state.status} />
          </li>
          {t.template.advisory ? (
            <li>
              <span className="badge badge--neutral">
                <span className="badge__glyph" aria-hidden="true">
                  ☆
                </span>
                Рекомендуем, не требование приёма
              </span>
            </li>
          ) : null}
          {isNext ? (
            <li>
              <span className="badge badge--ok">
                <span className="badge__glyph" aria-hidden="true">
                  ▸
                </span>
                Следующий шаг
              </span>
            </li>
          ) : null}
          {view.flags.blocked ? (
            <li>
              <span className="badge badge--warn">
                <span className="badge__glyph" aria-hidden="true">
                  ⋯
                </span>
                Ждёт: {view.flags.blockedBy.length} действ.
              </span>
            </li>
          ) : null}
          {view.flags.overdue ? (
            <li>
              <span className="badge badge--risk">
                <span className="badge__glyph" aria-hidden="true">
                  !
                </span>
                Срок прошёл
              </span>
            </li>
          ) : null}
          {view.flags.dueUncertain ? (
            <li>
              <span className="badge badge--unknown">
                <span className="badge__glyph" aria-hidden="true">
                  ?
                </span>
                Отсечка известна не полностью
              </span>
            </li>
          ) : null}
        </ul>

        <p className="task__outcome">
          <strong>{t.template.advisory ? 'Что даст' : 'Требуемый результат'}:</strong>{' '}
          {t.template.requiredOutcome}
        </p>
        {t.template.advisory ? (
          <p className="small muted">
            Это совет сервиса: ни одно условие приёма его не требует, и отметка здесь
            не закрывает формальных условий и не мешает подать заявление.
          </p>
        ) : null}
        <p className="task__outcome muted">{t.template.instruction}</p>
        <p className="small muted">
          <strong>Готово, когда:</strong> {t.template.completionCriterion}
        </p>

        <p className="task__meta">
          <span>Начать: {formatPlainDateRu(t.earliestStart)}</span>
          <span>Закончить: {formatPlainDateRu(t.earliestFinish)}</span>
          {t.latestFinish ? (
            <span>
              Крайний срок{view.flags.dueUncertain ? ' (приблизительный)' : ''}:{' '}
              {formatPlainDateRu(t.latestFinish)}
            </span>
          ) : (
            <span>Крайний срок не определён источником</span>
          )}
          {t.slackDays !== null ? <span>Резерв: {t.slackDays} дн.</span> : null}
          {t.sessionDate ? <span>Сессия: {formatPlainDateRu(t.sessionDate)}</span> : null}
        </p>

        <details className="task-details">
          <summary>Нагрузка и связанные условия <Icon name="chevron" size={13} /></summary>
        <p className="task__meta">
          <span>
            Трудозатраты: {t.template.effortHours.min}–{t.template.effortHours.max} ч
          </span>
          <span>
            Длительность: {t.template.durationDays.min}–{t.template.durationDays.max} дн.
          </span>
          {t.template.externalWaitDays.max > 0 ? (
            <span>
              Внешнее ожидание: {t.template.externalWaitDays.min}–
              {t.template.externalWaitDays.max} дн.
            </span>
          ) : null}
        </p>

        <p className="task__meta">
          <span>Цель: {goalTitle}</span>
          {closes.length > 0 ? <span>Закрывает условие: {closes.join(', ')}</span> : null}
          {t.dependsOn.length > 0 ? <span>Зависит от: {t.dependsOn.length} действ.</span> : null}
        </p>
        </details>

        <hr className="divider" style={{ margin: 'var(--s-3) 0' }} />

        <TaskControls
          goalId={goalId}
          taskId={t.id}
          progressRevision={progressRevision}
          options={statusOptions(view.state.status, needsResult)}
          {...(view.flags.blocked
            ? { blockedReason: `Ждёт завершения других действий: ${view.flags.blockedBy.length}.` }
            : {})}
        />

        {spec && view.state.status !== 'done' ? (
          <ResultForm
            goalId={goalId}
            taskId={t.id}
            spec={spec}
            progressRevision={progressRevision}
            profileRevision={profileRevision}
          />
        ) : null}

        {needsResult && view.state.status !== 'done' ? (
          <p className="small muted">
            Это действие закрывается подтверждённым результатом со значением и происхождением:
            отметка «выполнено» сама по себе условие не закроет.
          </p>
        ) : null}
      </div>
    </li>
  );
}

/**
 * TASK-01: предлагаем только те переходы, которые разрешены жизненным циклом
 * и имеют смысл для этого вида действия. Закрыть результатом — отдельная
 * команда, поэтому у таких задач кнопки «Выполнено» нет.
 */
function statusOptions(status: TaskStatus, needsResult: boolean): StatusOption[] {
  switch (status) {
    case 'todo':
      return [
        { to: 'in_progress', label: 'Начать', primary: true },
        ...(needsResult
          ? [{ to: 'awaiting_result' as const, label: 'Жду результат' }]
          : [{ to: 'done' as const, label: 'Выполнено' }]),
        { to: 'skipped', label: 'Пропустить' },
      ];
    case 'in_progress':
      return [
        ...(needsResult
          ? [{ to: 'awaiting_result' as const, label: 'Жду результат', primary: true }]
          : [{ to: 'done' as const, label: 'Выполнено', primary: true }]),
        { to: 'todo', label: 'Вернуть в план' },
        { to: 'skipped', label: 'Пропустить' },
      ];
    case 'awaiting_result':
      return [
        { to: 'in_progress', label: 'Вернуть в работу' },
        { to: 'skipped', label: 'Пропустить' },
      ];
    case 'done':
      return [{ to: 'in_progress', label: 'Снять отметку' }];
    case 'skipped':
      return [{ to: 'todo', label: 'Вернуть в план', primary: true }];
    case 'obsolete':
      return [];
  }
}
