/**
 * UX-01 — «Обзор»: активная цель, следующий шаг, ближайшая проверенная
 * отсечка, предупреждения и сохранённый прогресс.
 *
 * TASK-04 и REV-20: если готового действия нет, экран показывает конкретную
 * причину и следующий переход — пустого dashboard тут не бывает ни в одной
 * ветке.
 */

import Link from 'next/link';

import { conservativeCutoff, formatPlainDateRu, resolveDeadline, type Deadline } from '@core/kernel/time';
import type { NextActionOutcome } from '@core/progress/next-action';

import {
  BudgetBadge,
  CalculationStamp,
  Counters,
  DataQualityBadge,
  DeadlineLine,
  EligibilityBadge,
  FeasibilityBadge,
  Notice,
} from './_components/ui';
import { Suspense } from 'react';

import { AiNextAction, AiPending, AiProfileSummary } from './_components/ai-insight';
import { getAdviceFor, getPageSession, type PageSession, type SessionSnapshot } from './_lib/session';
import { Icon } from './_components/icon';
import { Welcome } from './_components/welcome';
import { StartScreen } from './_components/start-screen';
import { ChangesBlock } from './_components/changes';
import { DiagnosisBlock } from './_components/diagnosis';

export const dynamic = 'force-dynamic';

export default async function OverviewPage() {
  const page = await getPageSession();
  const s = page.snapshot;
  const goal = s.activeGoal;

  // Пока анкета не заполнена, персональной цели и маршрута не существует.
  // Показывать чужой пример как «ваш результат» нельзя.
  if (!s.profileStarted) {
    return (
      <div className="stack">
        <header className="stack-tight">
          <p className="card__eyebrow">Личный маршрут поступления</p>
          <h1>Давайте найдём ваш путь</h1>
          <p className="lede">
            Сервис помогает абитуриенту бакалавриата: подбирает программы по вашим
            данным, объясняет причины и собирает план с ближайшим шагом.
          </p>
        </header>
        <StartScreen mode={page.context.mode} />
      </div>
    );
  }

  if (!goal) {
    return (
      <div className="stack">
        <header className="stack-tight"><p className="card__eyebrow">Личный маршрут поступления</p><h1>Давайте найдём ваш путь</h1><p className="lede">Начните с профиля, чтобы проверить программы и условия.</p></header>
        <Notice tone="warn" title="Подходящей цели по вашим данным нет">
          <p>
            {s.recommendation.shortfallReason ??
              'Ни одна кампания приёма не проходит по вашим ответам.'}
          </p>
          <p className="small">
            Маршрут к кампании другого года мы не строим: это был бы план к набору,
            на который вы не подаётесь.
          </p>
          <div className="actions">
            <Link className="btn" href="/profile/edit">
              Изменить анкету
            </Link>
            <Link className="btn btn--secondary" href="/programs">
              Посмотреть все варианты и причины
            </Link>
          </div>
        </Notice>

        {/*
          Изменение анкеты могло и убрать все цели — именно тогда результат
          пересчёта важнее всего. Блок тот же самый, дублирования нет:
          в ветке с целью он ниже, здесь — сразу после причины.
        */}
        <ChangesBlock summary={page.lastRecalc} profileRevision={s.profile.revision} />

        <DiagnosisBlock diagnosis={s.diagnosis} />
      </div>
    );
  }

  const nearest = nearestDeadline(goal.deadlines, s.today);

  return (
    <div className="stack">
      <header className="page-heading">
        <div><p className="card__eyebrow">Личный маршрут поступления</p><h1>Ваше будущее начинается здесь</h1>
        <p className="lede">Цель, ближайшее действие и важные сроки — всё в одном месте.</p></div>
      </header>

      <Welcome />

      <div className="dashboard">
      <div className="dashboard__primary">
      <div className="section-heading"><h2>К чему вы движетесь</h2><Link href="/goals">Все цели <Icon name="chevron" size={13} /></Link></div>
      <section className="card goal-card stack-tight" aria-labelledby="goal-heading">
        <div className="goal-card__top"><span className="university-mark"><Icon name="programs" size={25} /></span><div><p className="card__eyebrow">Активная цель · {goal.university.shortName}</p><p>{goal.university.city} · {goal.intake.label}</p></div></div>
        <h2 id="goal-heading">
          {goal.program.title}
        </h2>
        <p className="muted">
          {goal.university.name} · {goal.path.label}
        </p>

        <ul className="badge-row">
          <li>
            <EligibilityBadge status={goal.assessment.eligibility} />
          </li>
          <li>
            <DataQualityBadge quality={goal.assessment.dataQuality} />
          </li>
          <li>
            <BudgetBadge verdict={goal.assessment.financial} />
          </li>
          {s.route ? (
            <li>
              <FeasibilityBadge status={s.route.feasibility.status} />
            </li>
          ) : null}
        </ul>

        <div className="actions">
          <Link className="btn" href="/route">
            Открыть маршрут <Icon name="arrow" size={15} />
          </Link>
          <Link className="btn btn--secondary" href={`/programs/${goal.path.id}`}>
            Условия поступления
          </Link>
          <Link className="btn btn--secondary" href="/compare">
            Сравнить с другими
          </Link>
        </div>
      </section>

      {s.activeGoalIssue ? (
        <Notice tone="warn" title="Обратите внимание на выбранную цель">
          <p>{s.activeGoalIssue.message}</p>
          <div className="actions">
            <Link className="btn btn--secondary" href="/programs">
              Выбрать другую цель
            </Link>
          </div>
        </Notice>
      ) : null}

      <ChangesBlock summary={page.lastRecalc} profileRevision={s.profile.revision} />

      <NextStep outcome={s.nextAction} />

      <Suspense fallback={<AiPending title="Готовим разбор шага" />}>
        <AiOverview page={page} />
      </Suspense>
      </div>

      <div className="dashboard__aside">
      <div className="section-heading"><h2>Важно не пропустить</h2></div>
      <section className="card deadline-card stack-tight" aria-labelledby="deadline-heading">
        <span className="deadline-card__icon"><Icon name="calendar" /></span>
        <p className="card__eyebrow">Ближайший срок</p>
        <h2 id="deadline-heading">
          {nearest ? nearest.title : 'Дата пока неизвестна'}
        </h2>
        {nearest ? (
          <>
            <DeadlineLine deadline={nearest.deadline} />
            <p className="small muted">
              {nearest.daysLeft === null
                ? 'Сколько осталось дней — не считаем: источник не указал момент отсечки.'
                : `Осталось ${nearest.daysLeft} дн. по консервативной границе. Планировщик не переносит внешнюю дату.`}
            </p>
          </>
        ) : (
          <p className="muted">
            В каталоге по этой кампании нет опубликованной даты. Пока её нет, планировать
            обратным отсчётом нельзя — нужна задача уточнения у первоисточника.
          </p>
        )}
      </section>
      <section className="card help-card stack-tight" aria-labelledby="help-heading"><h2 id="help-heading">А если планы изменятся?</h2><p>Проверьте, как другой бюджет или результат экзамена повлияет на маршрут. Основные данные останутся прежними.</p><Link href="/scenarios">Попробовать сценарий <Icon name="arrow" size={16} /></Link></section>
      </div>
      </div>

      <section className="card progress-card stack-tight" aria-labelledby="progress-heading">
        <p className="card__eyebrow">Каждый шаг имеет значение</p>
        <h2 id="progress-heading">Ваш прогресс</h2>
        <Counters counters={s.counters} />
      </section>

      <Warnings session={s} />

      <CalculationStamp keyInfo={s.key} />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function NextStep({ outcome }: { outcome: NextActionOutcome }) {
  if (outcome.kind === 'action') {
    const t = outcome.view.task;
    return (
      <section className="card next-card stack-tight" aria-labelledby="next-heading">
        <p className="card__eyebrow next-card__label"><Icon name="route" size={15} /> Ваш следующий шаг</p>
        <h2 id="next-heading">{t.template.title}</h2>
        <p className="task__outcome">
          <strong>Требуемый результат:</strong> {t.template.requiredOutcome}
        </p>
        <p className="small muted">{outcome.explanation}</p>
        <ul className="badge-row">
          {outcome.factors.map((f) => (
            <li key={f.code} className="small muted">
              · {f.text}
            </li>
          ))}
        </ul>
        <p className="task__meta">
          <span>Можно начать: {formatPlainDateRu(t.earliestStart)}</span>
          {t.latestStart ? <span>Начать не позже: {formatPlainDateRu(t.latestStart)}</span> : null}
          <span>
            {outcome.alternativesCount > 0
              ? `Ещё доступно действий: ${outcome.alternativesCount}`
              : 'Других доступных действий сейчас нет'}
          </span>
        </p>
        <div className="actions">
          <Link className="btn" href="/route">
            Перейти к действию <Icon name="arrow" size={16} />
          </Link>
        </div>
      </section>
    );
  }

  const titles: Record<Exclude<NextActionOutcome['kind'], 'action'>, string> = {
    awaiting_external: 'Идёт внешнее ожидание',
    blocked: 'Действия заблокированы',
    clarification: 'Нужно уточнить данные',
    requirements_open: 'Остались неподтверждённые условия',
    all_done: 'Готовых действий нет',
  };

  return (
    <section className="card next-card stack-tight" aria-labelledby="next-heading">
      <p className="card__eyebrow next-card__label"><Icon name="route" size={15} /> Ваш следующий шаг</p>
      <h2 id="next-heading">{titles[outcome.kind]}</h2>
      <p>{outcome.explanation}</p>
      <p className="muted">{outcome.hint}</p>
      <div className="actions">
        <Link className="btn btn--secondary" href={outcome.kind === 'clarification' ? '/profile' : '/route'}>
          {outcome.kind === 'clarification' ? 'Уточнить в профиле' : 'Открыть маршрут'}
        </Link>
      </div>
    </section>
  );
}

/** Пояснения модели. Отдельный компонент, чтобы сеть не задерживала страницу. */
async function AiOverview({ page }: { page: PageSession }) {
  const advice = await getAdviceFor(page);
  return (
    <>
      <AiNextAction advice={advice} />
      <AiProfileSummary advice={advice} />
    </>
  );
}

function Warnings({ session }: { session: SessionSnapshot }) {
  const limitations = session.route?.feasibility.limitations ?? [];
  const bridgeWarnings = session.bridge?.warnings ?? [];
  const shortfall = session.recommendation.shortfallReason;
  const searchIncomplete = session.bridge && !session.bridge.searchComplete;

  if (
    limitations.length === 0 &&
    bridgeWarnings.length === 0 &&
    !shortfall &&
    !searchIncomplete
  ) {
    return (
      <Notice tone="info" title="Что важно знать о расчёте">
        <p>
          По активной цели график сходится при указанных предположениях, а расхождений
          источников не обнаружено. Это не гарантия поступления — только состояние данных
          и расписания.
        </p>
      </Notice>
    );
  }

  return (
    <Notice tone="warn" title="Предупреждения">
      <ul className="stack-tight">
        {shortfall ? <li>{shortfall}</li> : null}
        {searchIncomplete ? (
          <li>
            Перебор вариантов остановлен по лимиту: отсутствие решения не доказано
            {session.bridge?.stopReason ? ` (${session.bridge.stopReason})` : ''}.
          </li>
        ) : null}
        {bridgeWarnings.map((w) => (
          <li key={w.code}>{w.message}</li>
        ))}
        {limitations.map((l, i) => (
          <li key={`${l.code}-${i}`}>{l.message}</li>
        ))}
      </ul>
    </Notice>
  );
}

/** Ближайшая по консервативной границе отсечка (BR-06, BR-07). */
function nearestDeadline(deadlines: readonly Deadline[], today: string) {
  const items = deadlines
    .map((d) => {
      const cutoff = conservativeCutoff(d);
      if (!cutoff) return null;
      const resolved = resolveDeadline(d);
      const daysLeft =
        resolved.kind === 'certain'
          ? Math.round((Date.parse(cutoff.utc) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)
          : null;
      return {
        deadline: d,
        cutoffUtc: cutoff.utc,
        daysLeft,
        title: d.localDate ? formatPlainDateRu(d.localDate) : 'Дата не опубликована',
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .filter((x) => x.cutoffUtc >= `${today}T00:00:00.000Z`)
    .sort((a, b) => (a.cutoffUtc < b.cutoffUtc ? -1 : a.cutoffUtc > b.cutoffUtc ? 1 : 0));

  return items[0] ?? null;
}
