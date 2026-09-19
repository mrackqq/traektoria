/**
 * PR-03 / UX-03 / UX-10 / AC-01 — сравнение программ.
 *
 * Сравниваются пути подачи, а не вузы: у гранта и платного приёма разные
 * условия и разные деньги (DATA-01), поэтому строка «вуз» здесь не главная.
 *
 * UX-03: неизвестное значение показывается словами и помечается, а не
 * заменяется прочерком. Выбор программ работает обычной формой с GET —
 * без JavaScript, с клавиатуры, и ссылку на сравнение можно сохранить.
 */

import Link from 'next/link';

import { buildComparison, type ComparisonItem } from '@core/eligibility/recommend';

import { BucketBadge, CalculationStamp, EligibilityBadge, Notice } from '../_components/ui';
import { Suspense } from 'react';

import { AiComparison, AiPending } from '../_components/ai-insight';
import { getAdviceFor, getPageSession, type PageSession } from '../_lib/session';
import { NeedsAnswers } from '../_components/needs-answers';
import { Icon } from '../_components/icon';

export const metadata = { title: 'Сравнение — Траектория' };
export const dynamic = 'force-dynamic';

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string | string[] }>;
}) {
  const params = await searchParams;
  const page = await getPageSession();
  const s = page.snapshot;

  if (!s.profileStarted) {
    return (
      <NeedsAnswers
        lede="Сравнение показывает два-три варианта рядом: стоимость, язык, сроки и условия приёма."
        gives={[
          'Программы рядом, строка к строке',
          'Где варианты расходятся, а где совпадают',
          'Что по каждому из них известно неточно',
        ]}
      />
    );
  }

  const requested = normalize(params.ids);
  const selected =
    requested.length > 0
      ? s.goals.filter((g) => requested.includes(g.path.id))
      : // По умолчанию — те, что подходят по известным условиям. Если таких
        // меньше двух, добор неподходящими не делаем (PR-02).
        s.goals.filter((g) => g.assessment.bucket === 'recommended').slice(0, 3);

  const items: ComparisonItem[] = selected.map((g) => ({
    assessment: g.assessment,
    intake: g.intake,
    path: g.path,
    programTitle: g.program.title,
    universityShortName: g.university.shortName,
    city: g.university.city,
    instructionLanguages: g.program.instructionLanguages,
    durationYears: g.program.durationYears,
  }));

  const rows = items.length >= 2 ? buildComparison(items) : [];
  // В модель уходят идентификаторы фактически показанных вариантов, а не то,
  // что пришло в адресной строке: несуществующий id отсеивается фильтром выше.
  const selectedIds = selected.map((g) => g.path.id);

  return (
    <div className="stack">
      <header className="stack-tight">
        <p className="card__eyebrow">Шаг 2 · Выберите между вариантами</p>
        <h1>Сравните программы</h1>
        <p className="lede">
          Отметьте минимум два варианта. Сопоставьте расходы, язык и требования,
          затем откройте понравившуюся программу и выберите её своей целью.
        </p>
      </header>

      <form method="get" className="card stack-tight">
        <details className="comparison-picker" open={items.length < 2}>
          <summary><span><strong>Выбрано вариантов: {selected.length}</strong><span className="facts__note">Изменить выбор программ</span></span><Icon name="chevron" size={18} /></summary>
        <fieldset className="stack-tight" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="card__eyebrow">Что сравнить</legend>
          <div className="picker">
            {s.goals.map((g) => (
              <label className="picker__item" key={g.path.id}>
                <input
                  type="checkbox"
                  name="ids"
                  value={g.path.id}
                  defaultChecked={selected.some((x) => x.path.id === g.path.id)}
                />
                <span>
                  <strong>{g.program.title}</strong>
                  <span className="facts__note">
                    {g.university.shortName} · {g.intake.label} · {g.path.label}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="actions">
          <button type="submit" className="btn">
            Сравнить выбранные
          </button>
        </div>
        </details>
        <Link className="btn btn--ghost" href="/programs">← К списку программ</Link>
      </form>

      {items.length < 2 ? (
        <Notice tone="warn" title="Нужно минимум две программы">
          <p>
            {s.goals.length < 2
              ? 'В каталоге сейчас меньше двух подходящих путей подачи — сравнивать не с чем.'
              : 'Отметьте хотя бы два варианта выше. Недостающие мы не подставляем.'}
          </p>
        </Notice>
      ) : (
        <section
          className="compare"
          aria-label="Таблица сравнения"
          style={{ ['--compare-rows' as string]: String(rows.length + 1) }}
        >
          {items.map((item, index) => (
            <article className="compare__card" key={item.path.id}>
              <header className="compare__row">
                <h2 style={{ margin: 0, fontSize: '1.0625rem' }}>
                  <Link href={`/programs/${item.path.id}`}>{item.programTitle}</Link>
                </h2>
                <ul className="badge-row" style={{ marginTop: 'var(--s-2)' }}>
                  <li>
                    <BucketBadge bucket={item.assessment.bucket} />
                  </li>
                  <li>
                    <EligibilityBadge status={item.assessment.eligibility} />
                  </li>
                </ul>
              </header>

              {rows.map((row) => {
                const cell = row.values[index];
                if (!cell) return null;
                const classes = [
                  'compare__value',
                  cell.tone ? `compare__value--${cell.tone}` : '',
                  cell.unknown ? 'compare__value--unknown' : '',
                ]
                  .filter(Boolean)
                  .join(' ');

                return (
                  <div className="compare__row" key={row.key}>
                    <span className="compare__label">{row.label}</span>
                    <span className={classes}>
                      {cell.text}
                      {cell.unknown ? (
                        <span className="visually-hidden"> — значение неизвестно или неполно</span>
                      ) : null}
                    </span>
                  </div>
                );
              })}
              <Link className="btn btn--secondary" href={`/programs/${item.assessment.admissionPathId}`}>Открыть программу и выбрать</Link>
            </article>
          ))}
        </section>
      )}

      {/* Меньше двух вариантов — сравнивать нечего, и выдумывать второй нельзя. */}
      {items.length >= 2 ? (
        <Suspense fallback={<AiPending title="Готовим разбор компромиссов" />}>
          <AiCompare page={page} pathIds={selectedIds} />
        </Suspense>
      ) : null}

      <p className="small muted">
        Сравнение не ранжирует вузы и не предсказывает поступление. Оно показывает, чем
        отличаются известные условия, деньги и сроки — решение остаётся за вами.
      </p>

      <CalculationStamp keyInfo={s.key} />
    </div>
  );
}

/**
 * Разбор компромиссов между ВЫБРАННЫМИ вариантами.
 *
 * Идентификаторы выбора уходят и в контекст модели, и в ключ кеша: другая
 * пара — другой ответ, та же пара — ответ из кеша. Вариант вне общего топа
 * при этом не теряется, потому что попадает в контекст принудительно.
 */
async function AiCompare({ page, pathIds }: { page: PageSession; pathIds: readonly string[] }) {
  const advice = await getAdviceFor(page, { focusPathIds: pathIds });
  return <AiComparison advice={advice} />;
}

function normalize(ids: string | string[] | undefined): string[] {
  if (!ids) return [];
  const list = Array.isArray(ids) ? ids : [ids];
  return list.flatMap((x) => x.split(',')).map((x) => x.trim()).filter(Boolean);
}
