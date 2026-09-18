/**
 * UX-02 — анкета: короткая, пошаговая, с явным «не знаю».
 *
 * Шаг — это URL (`?step=…`), а не состояние в памяти: шаг можно открыть
 * заново, вернуться назад и переслать ссылку, а обновление страницы не
 * теряет ответы — они лежат в черновике на сервере.
 *
 * Последний шаг — проверка: пользователь видит, что именно изменится,
 * и применяет анкету явным действием. Автоматического применения нет.
 */

import {
  completeness,
  findStep,
  STEPS,
  stepIndex,
  validateAll,
  visibleFields,
} from '@core/profile/questionnaire';

import { QuestionnaireStep } from '../../_components/questionnaire-step';
import { StepNavProvider, StepTabs } from '../../_components/step-nav';
import { CommitDraft } from '../../_components/commit-draft';
import { Notice } from '../../_components/ui';
import { appNow } from '@/server/clock';
import { loadDraft } from '@/server/questionnaire-service';
import { visitorContext } from '@/server/session-context';

export const metadata = { title: 'Анкета — Траектория' };
export const dynamic = 'force-dynamic';

export default async function QuestionnairePage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string }>;
}) {
  const { step: stepParam } = await searchParams;
  const { ownerId } = await visitorContext();
  const view = await loadDraft(ownerId, appNow());
  const isReview = stepParam === 'review';
  const step = findStep(stepParam);
  const index = stepIndex(step);
  const progress = completeness(view.draft.values);
  const today = appNow().slice(0, 10);

  const nextHref =
    index < STEPS.length - 1
      ? `/profile/edit?step=${STEPS[index + 1]!.id}`
      : '/profile/edit?step=review';
  const prevHref = index > 0 ? `/profile/edit?step=${STEPS[index - 1]!.id}` : null;

  return (
    <StepNavProvider>
      <div className="stack questionnaire">
        <header className="stack-tight">
          <p className="card__eyebrow">
            Анкета · шаг {isReview ? STEPS.length + 1 : index + 1} из {STEPS.length + 1}
          </p>
          <h1>{isReview ? 'Проверьте ваши ответы' : step.title}</h1>
          <p className="lede">{isReview ? 'Всё верно? Нажмите «Применить анкету», чтобы получить обновлённый подбор и план.' : step.intro}</p>

          {/*
            Вкладки шагов сохраняют текущий шаг перед переходом: см. step-nav.
          */}
          <StepTabs
            steps={STEPS.map((s) => ({ id: s.id, title: s.title }))}
            currentId={step.id}
            isReview={isReview}
          />

          <p className="small muted">
            Отвечено на {progress.answered} из {progress.visible} вопросов. Не знаете ответ?
            Можно оставить его на потом. Подбор обновится после применения анкеты.
          </p>
        </header>

        {view.staleBase ? (
          <Notice tone="warn" title="Профиль изменился, пока анкета была открыта">
            <p>
              Черновик начат на ревизии {view.draft.basedOnProfileRevision}, а профиль уже
              ревизии {view.profileRevision}: за это время был записан результат или другое
              изменение факта. Ответы сохранены — при применении они лягут поверх актуальной
              версии, и мы покажем конфликт, если что-то разошлось.
            </p>
          </Notice>
        ) : null}

        {isReview ? (
          <ReviewStep view={view} today={today} />
        ) : (
          <QuestionnaireStep
            key={step.id}
            step={step}
            initialValues={view.draft.values}
            draftRevision={view.draft.revision}
            nextHref={nextHref}
            prevHref={prevHref}
          />
        )}
      </div>
    </StepNavProvider>
  );
}

function ReviewStep({ view, today }: { view: Awaited<ReturnType<typeof loadDraft>>; today: string }) {
  const values = view.draft.values;
  const errors = validateAll(values, { today });

  return (
    <div className="stack">
      <section className="card stack-tight" aria-labelledby="answers">
        <p className="card__eyebrow">Ваши ответы</p>
        <h2 id="answers">Что будет записано</h2>

        {STEPS.map((s) => (
          <div key={s.id} className="stack-tight">
            <h3>{s.title}</h3>
            <dl className="facts">
              {visibleFields(s, values).map((f) => {
                const a = values[f.id] ?? { state: 'unanswered' as const };
                const text =
                  a.state === 'answered'
                    ? Array.isArray(a.value)
                      ? a.value
                          .map((v) => f.options?.find((o) => o.value === v)?.label ?? v)
                          .join(', ')
                      : f.options?.find((o) => o.value === a.value)?.label ?? String(a.value)
                    : a.state === 'dont_know'
                      ? 'Не знаю'
                      : a.state === 'not_applicable'
                        ? 'Не применимо'
                        : 'Не заполнено';
                return (
                  <div key={f.id}>
                    <dt className="facts__term">{f.label}</dt>
                    <dd className="facts__value">
                      {text}
                      {a.state === 'dont_know' ? (
                        <span className="facts__note">
                          Зависящие условия останутся неопределёнными.
                        </span>
                      ) : null}
                      {a.state === 'unanswered' ? (
                        <span className="facts__note">
                          Значение не будет записано в профиль.
                        </span>
                      ) : null}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>
        ))}
      </section>

      {errors.length > 0 ? (
        <Notice tone="warn" title="Есть поля с ошибками">
          <ul className="stack-tight small">
            {errors.map((e) => (
              <li key={e.fieldId}>{e.message}</li>
            ))}
          </ul>
          <p className="small">Перед применением вернитесь к указанным полям и исправьте ошибки.</p>
        </Notice>
      ) : null}

      <CommitDraft
        profileRevision={view.profileRevision}
        draftRevision={view.draft.revision}
      />
    </div>
  );
}
