/**
 * PR-04 / §12 — «Цели».
 *
 * Цель всегда привязана к кампании и пути подачи: «поступить в X» без года
 * приёма и без выбора «грант / платное» — не цель, потому что условия у них
 * разные (DATA-01).
 *
 * §12 и AC-07/AC-16: будущая цель («планирую IELTS 7.0 к марту») живёт
 * отдельно от фактов и никогда не превращается в факт сама по себе.
 */

import Link from 'next/link';

import { EXAM_STATE_LABEL_RU } from '@core/kernel/profile';

import { BucketBadge, EligibilityBadge, FeasibilityBadge, Notice } from '../_components/ui';
import { getSession } from '../_lib/session';
import { NeedsAnswers } from '../_components/needs-answers';

export const metadata = { title: 'Цели — Траектория' };

export const dynamic = 'force-dynamic';

export default async function GoalsPage() {
  const s = await getSession();

  if (!s.profileStarted) {
    return (
      <NeedsAnswers
        lede="Цель — программа, к которой сервис построит план подготовки. Выбирать её можно только из подходящих вам."
        gives={[
          'Выбранную цель и почему она подходит',
          'Другие варианты, между которыми можно переключиться',
          'Что изменится в плане при смене цели',
        ]}
      />
    );
  }
  const active = s.activeGoal;
  const others = s.goals.filter((g) => g.path.id !== active?.path.id);

  return (
    <div className="stack">
      <header className="stack-tight">
        <p className="card__eyebrow">Шаг 3 · Цель поступления</p>
        <h1>К какой программе строить план</h1>
        <p className="lede">
          Выберите одну программу и вариант поступления: грант или платное обучение.
          Мы соберём план именно к этой цели. Её можно поменять позже.
        </p>
      </header>

      {active ? (
        <section className="card stack-tight" aria-labelledby="active-goal">
          <p className="card__eyebrow">{s.activeGoalSource === 'chosen' ? 'Выбранная вами программа' : 'Предложенный вариант — вы ещё не закрепили цель'}</p>
          <h2 id="active-goal">
            {active.program.title} — {active.university.shortName}
          </h2>
          <p className="muted">
            {active.intake.label} · {active.path.label} · год поступления{' '}
            {active.intake.admissionYear}
          </p>
          <ul className="badge-row">
            <li>
              <EligibilityBadge status={active.assessment.eligibility} />
            </li>
            {s.route ? (
              <li>
                <FeasibilityBadge status={s.route.feasibility.status} />
              </li>
            ) : null}
          </ul>
          <div className="actions">
            <Link className="btn" href={s.activeGoalSource === 'chosen' ? '/route' : `/programs/${active.path.id}#choose-goal`}>
              {s.activeGoalSource === 'chosen' ? 'Открыть план действий' : 'Посмотреть и выбрать эту программу'}
            </Link>
            <Link className="btn btn--secondary" href={`/programs/${active.path.id}`}>
              Условия и стоимость
            </Link>
          </div>
        </section>
      ) : (
        <Notice tone="warn" title="Активной цели нет">
          <p>Выберите кампанию в разделе «Программы» — маршрут строится только под цель.</p>
        </Notice>
      )}

      <section className="stack-tight" aria-labelledby="other-goals">
        <h2 id="other-goals">Другие варианты ({others.length})</h2>
        <p className="small muted">
          Варианты расположены с учётом известных условий, качества данных и бюджета. Откройте программу, чтобы изучить детали.
        </p>
        <div className="grid">
          {others.map((g) => (
            <article key={g.path.id} className="card stack-tight">
              {/*
                Год набора обязателен в подписи: одна и та же программа идёт
                двумя кампаниями, и без года карточки 2027 и 2028 выглядели
                как дубликаты.
              */}
              <p className="card__eyebrow">
                {g.university.shortName} · {g.intake.label} · {g.path.label}
              </p>
              <h3>
                <Link href={`/programs/${g.path.id}`}>{g.program.title}</Link>
              </h3>
              <ul className="badge-row">
                <li>
                  <BucketBadge bucket={g.assessment.bucket} />
                </li>
                <li>
                  <EligibilityBadge status={g.assessment.eligibility} />
                </li>
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className="card stack-tight" aria-labelledby="targets">
        <p className="card__eyebrow">Экзамены в вашем профиле</p>
        <h2 id="targets">Результат и намерение — не одно и то же</h2>
        <p>
          «Планирую IELTS на 7.0» — ещё не результат. Пока балл не опубликован и не указан в профиле, условие поступления остаётся неподтверждённым. Ниже показаны экзамены, которые уже есть в вашем профиле.
        </p>

        {s.profile.exams.length === 0 ? (
          <p className="muted">
            Экзаменационных результатов в профиле пока нет. Имеющиеся результаты можно указать в анкете, а новые — внести в соответствующую задачу маршрута.
          </p>
        ) : (
          <ul className="tasks">
            {s.profile.exams.map((e) => (
              <li key={e.id} className="task">
                <h3 className="task__title">{e.examKind}</h3>
                <p className="task__meta">
                  <span>Состояние: {EXAM_STATE_LABEL_RU[e.state]}</span>
                  {e.overall !== undefined ? <span>Балл: {e.overall}</span> : null}
                  {e.validUntil ? <span>Действителен до: {e.validUntil}</span> : null}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
