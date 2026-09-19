/**
 * PF-01…PF-07, PRIV-01 — «Профиль».
 *
 * PF-02: «не указано», «не знаю», «не применимо» и ноль — разные состояния,
 * и на экране они разные. Прочерк без пояснения запрещён (UX-03).
 * PF-05: у каждого существенного сведения видно происхождение.
 * PRIV-01: дата рождения, паспортные данные, адрес, медицинские сведения
 * и сканы документов не собираются вовсе — это видно прямо на экране, а не
 * только в политике.
 */

import Link from 'next/link';

import {
  EDUCATION_LEVEL_LABEL_RU,
  EXAM_STATE_LABEL_RU,
  PROVENANCE_LABEL_RU,
  type Known,
  type Provenance,
} from '@core/kernel/profile';
import { formatMoneyRu } from '@core/kernel/money';
import { applicantCategoryRu, citizenshipRu, subjectRu, documentRu, scaleRu, examRu, capitalize } from '@core/i18n/labels';
import { NeedsAnswers } from '../_components/needs-answers';
import { Icon } from '../_components/icon';

import { Badge, Notice } from '../_components/ui';
import { Suspense } from 'react';

import { AiPending, AiProfileSummary } from '../_components/ai-insight';
import { DiagnosisBlock } from '../_components/diagnosis';
import { NextSection } from '../_components/next-section';
import { getAdviceFor, getPageSession, type PageSession } from '../_lib/session';

export const metadata = { title: 'Профиль — Траектория' };

export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const page = await getPageSession();
  const s = page.snapshot;

  if (!s.profileStarted) {
    return (
      <NeedsAnswers
        lede="Диагностика — это разбор ваших ответов: сильные стороны, ограничения и что стоит закрыть в первую очередь."
        gives={[
          'Сильные стороны вашего профиля',
          'Ограничения и что на них влияет',
          'Каких ответов не хватает для точного подбора',
        ]}
      />
    );
  }
  const p = s.profile;

  return (
    <div className="stack">
      <header className="page-heading">
        <div><p className="card__eyebrow">Шаг 1 · Ваши ответы</p><h1>Что мы поняли о вас</h1>
        <p className="lede">
          Образование, результаты и бюджет помогают проверить условия поступления. Меняйте ответы в анкете, когда ваши планы меняются.
        </p>
        <p className="small muted">Ответы обновлены {p.createdAt.slice(0, 10)}</p></div>
        <Link className={`btn${s.profileStarted ? ' btn--secondary' : ''}`} href="/profile/edit">
          Изменить анкету <Icon name="arrow" size={16} />
        </Link>
      </header>

      {s.profileStarted ? <NextSection title="Посмотрите программы под ваши условия" description="У каждого варианта есть причины выбора. Затем можно сравнить программы и выбрать цель." href="/programs" label="Перейти к программам" /> : null}

      {/* Диагностика по правилам — обязательная и не зависит от модели. */}
      <DiagnosisBlock diagnosis={s.diagnosis} />

      <Suspense fallback={<AiPending title="Готовим разбор профиля" />}>
        <AiProfile page={page} />
      </Suspense>

      <section className="card stack-tight" aria-labelledby="basics">
        <p className="card__eyebrow">Образование и статус</p>
        <h2 id="basics">Основные сведения</h2>
        <dl className="facts">
          <Fact
            term="Уровень образования"
            value={p.educationLevel}
            render={(v) => EDUCATION_LEVEL_LABEL_RU[v]}
            provenance="self_reported"
          />
          <Fact term="Ожидаемое окончание" value={p.expectedGraduation} provenance="self_reported" />
          <Fact
            term="Гражданство"
            value={p.citizenship}
            render={(v) => capitalize(citizenshipRu(v))}
            provenance="self_reported"
            note="Влияет на применимость условий, поэтому хранится отдельно."
          />
          <Fact
            term="Категория заявителя"
            value={p.applicantCategory}
            render={(v) => capitalize(applicantCategoryRu(v))}
            provenance="self_reported"
            note="От неё зависит, применимы ли условия гранта."
          />
          <Fact term="Год поступления" value={p.admissionYear} provenance="self_reported" />
          <Fact
            term="Доступное время в неделю"
            value={p.weeklyHours}
            render={(v) => `${v} ч`}
            provenance="self_reported"
            note="По нему проверяется выполнимость графика."
          />
        </dl>
      </section>

      <section className="card stack-tight" aria-labelledby="money">
        <p className="card__eyebrow">Финансы</p>
        <h2 id="money">Бюджет</h2>
        {p.budget.state === 'known' ? (
          <dl className="facts">
            <div>
              <dt className="facts__term">Предел</dt>
              <dd className="facts__value">{formatMoneyRu(p.budget.value.limit)}</dd>
            </div>
            <div>
              <dt className="facts__term">Что входит</dt>
              <dd className="facts__value">
                {p.budget.value.scope === 'tuition_only' ? 'Только обучение' : 'Все расходы'}
                <span className="facts__note">
                  Если бюджет задан только на обучение, а у программы есть обязательные
                  расходы сверх него, вывод помечается как неопределённый, а не «влезает».
                </span>
              </dd>
            </div>
            <div>
              <dt className="facts__term">Период</dt>
              <dd className="facts__value">
                {{ academic_year: 'За учебный год', one_time: 'Разово', per_month: 'В месяц', whole_programme: 'За всю программу' }[p.budget.value.period]}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="muted">Бюджет не указан — денежные выводы остаются неопределёнными.</p>
        )}
      </section>

      <section className="card stack-tight" aria-labelledby="results">
        <p className="card__eyebrow">Результаты</p>
        <h2 id="results">Экзамены, оценки и документы</h2>

        <h3>Экзамены</h3>
        {p.exams.length === 0 ? (
          <p className="muted">
            Подтверждённых результатов нет. Запись на экзамен и сдача — не результат:
            условие закрывается только опубликованным баллом.
          </p>
        ) : (
          <ul className="tasks">
            {p.exams.map((e) => (
              <li key={e.id} className="task">
                <h4 className="task__title">{examRu(e.examKind)}</h4>
                <p className="task__meta">
                  <span>{EXAM_STATE_LABEL_RU[e.state]}</span>
                  {e.overall !== undefined ? <span>Общий балл: {e.overall}</span> : null}
                  {e.validUntil ? <span>Действителен до: {e.validUntil}</span> : null}
                  <ProvenanceBadge provenance={e.provenance} />
                </p>
              </li>
            ))}
          </ul>
        )}

        <h3>Оценки и предметы</h3>
        <dl className="facts">
          {p.grades.map((g) => (
            <div key={g.scaleId}>
              <dt className="facts__term">Средний балл · {scaleRu(g.scaleId)}</dt>
              <dd className="facts__value">
                {g.value}
                <span className="facts__note">{PROVENANCE_LABEL_RU[g.provenance]}</span>
              </dd>
            </div>
          ))}
          {p.subjects.map((sub) => (
            <div key={sub.subjectId}>
              <dt className="facts__term">{capitalize(subjectRu(sub.subjectId))}</dt>
              <dd className="facts__value">
                {sub.score ?? 'без оценки'}
                <span className="facts__note">{PROVENANCE_LABEL_RU[sub.provenance]}</span>
              </dd>
            </div>
          ))}
        </dl>

        <h3>Документы</h3>
        <dl className="facts">
          {p.documents.map((d) => (
            <div key={d.documentKind}>
              <dt className="facts__term">{capitalize(documentRu(d.documentKind))}</dt>
              <dd className="facts__value">
                {d.obtained ? 'Получен' : 'Ещё не получен'}
                <span className="facts__note">{PROVENANCE_LABEL_RU[d.provenance]}</span>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <Notice tone="info" title="Что этот сервис не собирает">
        <p>
          Не собираются и не хранятся: дата рождения, паспортные и удостоверяющие данные,
          домашний адрес, медицинские сведения и сканы документов. Их нет ни в форме ввода,
          ни в схеме хранения — не только в логах.
        </p>
        <p className="small">
          В демонстрации достаточно ответов в анкете — загружать личные документы не нужно.
        </p>
      </Notice>
    </div>
  );
}

/* ------------------------------------------------------------------ */

async function AiProfile({ page }: { page: PageSession }) {
  const advice = await getAdviceFor(page);
  return <AiProfileSummary advice={advice} />;
}

function Fact<T extends string | number>({
  term,
  value,
  render,
  provenance,
  note,
}: {
  term: string;
  value: Known<T>;
  render?: (v: T) => string;
  provenance?: Provenance;
  note?: string;
}) {
  const shown =
    value.state === 'known'
      ? (render ? render(value.value) : String(value.value))
      : value.state === 'dont_know'
        ? 'Не знаю'
        : value.state === 'not_applicable'
          ? 'Не применимо'
          : 'Не заполнено';

  const explanation =
    value.state === 'dont_know'
      ? 'Пока значение неизвестно, зависящие условия остаются неопределёнными, а не невыполненными.'
      : value.state === 'unanswered'
        ? 'Вопрос ещё не задан или пропущен.'
        : value.state === 'not_applicable'
          ? 'К вашему случаю не относится.'
          : provenance
            ? PROVENANCE_LABEL_RU[provenance]
            : undefined;

  return (
    <div>
      <dt className="facts__term">{term}</dt>
      <dd className="facts__value">
        {shown}
        {explanation ? <span className="facts__note">{explanation}</span> : null}
        {note ? <span className="facts__note">{note}</span> : null}
      </dd>
    </div>
  );
}

function ProvenanceBadge({ provenance }: { provenance: Provenance }) {
  const tone = provenance === 'institution_verified' ? 'ok' : provenance === 'demo' ? 'demo' : 'neutral';
  return (
    <Badge tone={tone} glyph="•">
      {PROVENANCE_LABEL_RU[provenance]}
    </Badge>
  );
}
