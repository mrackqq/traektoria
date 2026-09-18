/**
 * UX-03 — карточка программы.
 *
 * Содержит причины выбора, текущие пробелы, полноту стоимости, кампанию,
 * источник и дату проверки. DATA-09: неполная сумма не называется «полной
 * стоимостью». DATA-04: расхождение источников показывается с обеими
 * версиями, а не сводится к удобной.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';

import type { CatalogCostItem, CatalogSnapshot } from '@core/catalog/types';
import { formatMoneyRu } from '@core/kernel/money';
import type { CostPeriod } from '@core/kernel/money';
import { FUNDING_STATE_LABEL_RU } from '@core/kernel/profile';

import { RequirementTree, Sources } from '../../_components/requirement-tree';
import {
  BudgetBadge,
  DataQualityBadge,
  DeadlineLine,
  EligibilityBadge,
  FeasibilityBadge,
  Notice,
} from '../../_components/ui';
import { Suspense } from 'react';

import { AiPending, AiSingleProgramNote } from '../../_components/ai-insight';
import { SelectGoalButton } from '../../_components/select-goal';
import { getAdviceFor, getPageSession, type PageSession } from '../../_lib/session';

export const dynamic = 'force-dynamic';

const PERIOD_RU: Record<CostPeriod, string> = {
  academic_year: 'за учебный год',
  one_time: 'разово',
  per_month: 'в месяц',
  whole_programme: 'за всю программу',
};

export default async function ProgramPage({ params }: { params: Promise<{ pathId: string }> }) {
  const { pathId } = await params;
  const page = await getPageSession();
  const s = page.snapshot;
  const goal = s.goals.find((g) => g.path.id === pathId);
  if (!goal) notFound();

  const a = goal.assessment;
  const conflicts = s.catalog.conflicts.filter((c) =>
    c.targetId.startsWith(goal.path.id) || goal.path.sourceIds.includes(c.versions[0]?.sourceId ?? ''),
  );

  const mandatory = goal.path.costs.filter((c) => c.mandatory);
  const estimated = goal.path.costs.some((c) => c.isEstimate);

  return (
    <div className="stack">
      <header className="stack-tight">
        <p className="card__eyebrow">
          <Link href="/programs">Программы</Link> · {goal.intake.label} · {goal.path.label}
        </p>
        <h1>
          {goal.program.title} — {goal.university.shortName}
        </h1>
        <p className="lede">
          {goal.university.name}, {goal.university.city}. {goal.program.summary}
        </p>

        <ul className="badge-row">
          <li>
            <EligibilityBadge status={a.eligibility} />
          </li>
          <li>
            <DataQualityBadge quality={a.dataQuality} />
          </li>
          <li>
            <BudgetBadge verdict={a.financial} />
          </li>
          {s.route && s.activeGoal?.path.id === goal.path.id ? (
            <li>
              <FeasibilityBadge status={s.route.feasibility.status} />
            </li>
          ) : null}
        </ul>
        <div className="actions program-page-actions">
          <a className="btn" href="#choose-goal">Выбрать программу и построить план</a>
          <a className="btn btn--ghost" href="#conditions">Проверить требования</a>
          <a className="btn btn--ghost" href="#costs">Посмотреть стоимость</a>
        </div>
      </header>

      {a.reasons.length > 0 ? (
        <section className="card stack-tight" aria-labelledby="reasons">
          <p className="card__eyebrow">Почему эта программа здесь</p>
          <h2 id="reasons">Почему этот вариант вам показан</h2>
          <ul className="stack-tight">
            {a.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
          {a.exclusionReason ? (
            <p>
              <strong>Причина исключения:</strong> {a.exclusionReason}
            </p>
          ) : null}
        </section>
      ) : null}

      {conflicts.length > 0 ? (
        <Notice tone="risk" title="Источники расходятся">
          {conflicts.map((c) => (
            <div key={c.id} className="stack-tight">
              <p>{c.description}</p>
              <ul className="stack-tight small">
                {c.versions.map((v) => {
                  const src = s.catalog.sources.find((x) => x.id === v.sourceId);
                  return (
                    <li key={v.sourceId}>
                      <strong>{src?.publisher ?? v.sourceId}:</strong> {v.claim}
                    </li>
                  );
                })}
              </ul>
              <p className="small muted">
                Пока расхождение не разрешено, положительное заключение по этому условию
                не выдаётся.
              </p>
            </div>
          ))}
        </Notice>
      ) : null}

      <Suspense fallback={<AiPending title="Готовим пояснение" />}>
        <AiProgram page={page} pathId={pathId} />
      </Suspense>

      <section className="stack-tight" aria-labelledby="conditions">
        <h2 id="conditions">Условия приёма</h2>
        <p className="muted small">
          Что уже выполнено, к чему нужно подготовиться и что уточнить.
          Если есть несколько способов выполнить требование, они показаны отдельно.
        </p>
        <ul className="tasks">
          <RequirementTree node={a.tree} catalog={s.catalog} />
        </ul>
      </section>

      <section className="card stack-tight" aria-labelledby="deadlines">
        <p className="card__eyebrow">Кампания</p>
        <h2 id="deadlines">Важные сроки поступления</h2>
        {goal.deadlines.length === 0 ? (
          <p className="muted">Даты не опубликованы источником.</p>
        ) : (
          goal.deadlines.map((d) => <DeadlineLine key={d.id} deadline={d} />)
        )}
        <p className="small muted">
          Контрольная дата действительности результатов:{' '}
          {goal.intake.resultValidityControlDate}.
        </p>
      </section>

      <section className="card stack-tight" aria-labelledby="costs">
        <p className="card__eyebrow">Стоимость</p>
        <h2 id="costs">{estimated ? 'Стоимость, часть сумм оценочные' : 'Стоимость по источникам'}</h2>

        {goal.path.costs.length === 0 ? (
          <p className="muted">Стоимость не опубликована.</p>
        ) : (
          <ul className="tasks">
            {goal.path.costs.map((c) => (
              <CostRow key={c.id} item={c} catalog={s.catalog} />
            ))}
          </ul>
        )}

        <p className="small muted">
          {mandatory.length === goal.path.costs.length
            ? 'Все перечисленные категории обязательные.'
            : `Обязательных категорий: ${mandatory.length} из ${goal.path.costs.length}.`}{' '}
          {estimated
            ? 'Часть значений — оценка, поэтому итог не называется полной стоимостью.'
            : 'Итог считается только по перечисленным категориям.'}
        </p>
      </section>

      {goal.path.funding.length > 0 ? (
        <section className="card stack-tight" aria-labelledby="funding">
          <p className="card__eyebrow">Финансирование</p>
          <h2 id="funding">Гранты и стипендии</h2>
          <ul className="tasks">
            {goal.path.funding.map((f) => (
              <li key={f.id} className="task">
                <h3 className="task__title">{f.label}</h3>
                <p className="task__meta">
                  <span>{formatMoneyRu(f.amount)}</span>
                  <span>Статус по умолчанию: {FUNDING_STATE_LABEL_RU[f.defaultState]}</span>
                </p>
                <p className="task__outcome">{f.conditions}</p>
                <p className="small muted">
                  В фактическом расчёте бюджета учитываются только подтверждённые и
                  полученные суммы — ожидаемый грант деньгами не считается.
                </p>
                <Sources ids={f.sourceIds} catalog={s.catalog} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="card stack-tight" aria-labelledby="choose-goal">
        <p className="card__eyebrow">Выбор цели</p>
        <h2 id="choose-goal">Сделать эту программу своей целью</h2>
        <p className="small muted">
          Маршрут строится к одной выбранной цели, и выбор сохраняется: изменение
          рейтинга программ его не переключит.
        </p>
        <SelectGoalButton
          goalId={goal.path.id}
          isActive={s.activeGoal?.path.id === goal.path.id && page.goalChosen}
        />
        <p className="small muted">
          <Link href="/route">Открыть активный маршрут</Link>
        </p>
      </section>
    </div>
  );
}

async function AiProgram({ page, pathId }: { page: PageSession; pathId: string }) {
  const advice = await getAdviceFor(page);
  return <AiSingleProgramNote advice={advice} pathId={pathId} />;
}

function CostRow({
  item,
  catalog,
}: {
  item: CatalogCostItem;
  catalog: CatalogSnapshot;
}) {
  const same = item.min.amountMinor === item.max.amountMinor;

  return (
    <li className="task">
      <h3 className="task__title">{item.label}</h3>
      <p className="task__meta">
        <span>
          {same ? formatMoneyRu(item.min) : `${formatMoneyRu(item.min)} — ${formatMoneyRu(item.max)}`}{' '}
          {PERIOD_RU[item.period]}
        </span>
        <span>{item.mandatory ? 'обязательно' : 'по обстоятельствам'}</span>
        {item.isEstimate ? <span>оценка, не публикация источника</span> : null}
      </p>
      <Sources ids={item.sourceIds} catalog={catalog} />
    </li>
  );
}
