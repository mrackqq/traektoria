/**
 * PR-02 / PR-03 / UX-03 — «Программы».
 *
 * PR-02: показываем минимум три подходящие программы, ЕСЛИ данные позволяют.
 * Если подходящих меньше — честная причина и раздельные группы, а не добор
 * неподходящих вариантов до красивого числа.
 *
 * ENG-03: измерения (условия, качество данных, деньги) остаются раздельными
 * и нигде не сворачиваются в один «шанс».
 */

import Link from 'next/link';

import type { ProgramAssessment } from '@core/eligibility/program-result';

import { BucketBadge, BudgetBadge, DataQualityBadge, EligibilityBadge, Notice } from '../_components/ui';
import { Suspense } from 'react';

import { AiPending, AiProgramNotes } from '../_components/ai-insight';
import { getAdviceFor, getPageSession, type PageSession, type SessionSnapshot } from '../_lib/session';
import { Icon } from '../_components/icon';

export const metadata = { title: 'Программы — Траектория' };

export const dynamic = 'force-dynamic';

export default async function ProgramsPage() {
  const page = await getPageSession();
  const s = page.snapshot;
  const { recommendation } = s;

  const groups = [
    {
      key: 'recommended',
      title: 'Подходят вам по известным условиям',
      items: recommendation.recommended,
      note: 'Проходят по условиям и попадают в выбранные вами направления и страны.',
    },
    {
      key: 'alternatives',
      title: 'Альтернативы за пределами ваших фильтров',
      items: recommendation.alternatives,
      note:
        'По условиям они вам доступны, но лежат вне выбранных направлений или стран. ' +
        'Показываем их с объяснением, а не прячем.',
    },
    {
      key: 'needs_verification',
      title: 'Требуют проверки',
      items: recommendation.needsVerification,
      note: 'По ним есть неизвестные или противоречивые условия — положительный вывод не делается.',
    },
    {
      key: 'not_suitable',
      title: 'Сейчас не подходят',
      items: recommendation.notSuitable,
      note: 'Причина исключения указана у каждой карточки.',
    },
  ] as const;

  return (
    <div className="stack">
      <header className="page-heading">
        <div><p className="card__eyebrow">Найдите своё направление</p><h1>Программы для вашего будущего</h1>
        <p className="lede">
          Рассмотрено вариантов: {recommendation.consideredPathCount}. Посмотрите, какие условия уже выполнены, что нужно уточнить и подходит ли бюджет.
        </p>
        </div>
        <Link className="btn" href="/compare">
          Сравнить программы <Icon name="arrow" size={16} />
        </Link>
      </header>

      {recommendation.shortfallReason ? (
        <Notice tone="warn" title="Подходящих программ меньше трёх">
          <p>{recommendation.shortfallReason}</p>
        </Notice>
      ) : null}

      {groups.map((g) => (
        <section key={g.key} className="stack-tight" aria-labelledby={`group-${g.key}`}>
          <h2 className="group-heading" id={`group-${g.key}`}>
            {g.title} <span className="muted">{g.items.length}</span>
          </h2>
          {g.items.length > 0 ? <p className="small muted">{g.note}</p> : null}

          {g.items.length === 0 ? (
            <p className="muted">
              {g.key === 'recommended'
                ? 'Ни один вариант не проходит и по условиям, и по вашим фильтрам. Это не отказ: ниже перечислено, чего не хватает.'
                : 'В этой группе пока нет программ.'}
            </p>
          ) : (
            <div className="grid">
              {g.items.map((a) => (
                <ProgramCard key={a.admissionPathId} assessment={a} session={s} />
              ))}
            </div>
          )}
        </section>
      ))}

      <details className="stack-tight">
        <summary className="btn btn--secondary" style={{ display: 'inline-flex', cursor: 'pointer' }}>
          Пояснения к подбору
        </summary>
        <Suspense fallback={<AiPending title="Готовим объяснения" />}>
          <AiPrograms page={page} />
        </Suspense>
      </details>
    </div>
  );
}

/** Пояснения модели по показанным вариантам. */
async function AiPrograms({ page }: { page: PageSession }) {
  const advice = await getAdviceFor(page);
  const titles = new Map(
    page.snapshot.goals.map((g) => [
      g.path.id,
      `${g.program.title} — ${g.university.shortName}, ${g.path.label}`,
    ]),
  );
  return <AiProgramNotes advice={advice} titles={titles} />;
}

function ProgramCard({
  assessment,
  session,
}: {
  assessment: ProgramAssessment;
  session: SessionSnapshot;
}) {
  const goal = session.goals.find((g) => g.path.id === assessment.admissionPathId);
  if (!goal) return null;

  const counts = assessment.counts;

  return (
    <article className="card program-card stack-tight">
      <div className="program-card__university"><span className="program-card__monogram">{goal.university.shortName}</span><div><p className="card__eyebrow">{goal.university.shortName} · {goal.university.city}</p><p className="small muted">{goal.intake.label} · {goal.path.label}</p></div></div>
      <h3>
        <Link href={`/programs/${goal.path.id}`}>{goal.program.title}</Link>
      </h3>

      <ul className="badge-row">
        <li>
          <BucketBadge bucket={assessment.bucket} />
        </li>
        <li>
          <EligibilityBadge status={assessment.eligibility} />
        </li>
        <li>
          <DataQualityBadge quality={assessment.dataQuality} />
        </li>
        <li>
          <BudgetBadge verdict={assessment.financial} />
        </li>
      </ul>

      {/* UX-03: причины выбора и текущие пробелы — на карточке, без перехода в чат. */}
      {assessment.reasons.length > 0 ? (
        <ul className="stack-tight small">
          {assessment.reasons.slice(0, 3).map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      ) : null}

      {assessment.exclusionReason ? (
        <p className="small">
          <strong>Почему исключена:</strong> {assessment.exclusionReason}
        </p>
      ) : null}

      <p className="task__meta">
        <span>Условий выполнено: {counts.MET}</span>
        <span>пробелов: {counts.NOT_MET}</span>
        <span>неизвестно: {counts.UNKNOWN}</span>
        {counts.CONFLICT > 0 ? <span>конфликтов: {counts.CONFLICT}</span> : null}
      </p>
      <Link className="program-card__link" href={`/programs/${goal.path.id}`}>Подробнее о программе <Icon name="arrow" size={17} /></Link>
    </article>
  );
}
