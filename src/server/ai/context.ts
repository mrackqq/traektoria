/**
 * Что именно уходит в модель.
 *
 * Два правила формируют этот модуль:
 *  • отдаём минимум. Модель объясняет уже посчитанное, поэтому ей нужны
 *    выводы ядра и подписи каталога, а не всё состояние пользователя.
 *    Идентификаторы владельца, ревизии, хэши расчёта и журнал операций
 *    не передаются — они ничего не добавляют к объяснению;
 *  • отдаём только факты. Стоимость, сроки и пороги приходят из каталога уже
 *    отформатированными, чтобы модели нечего было «вспоминать» самой.
 */

import type { SessionSnapshot } from '@core/demo/session';
import { STUDY_FIELD_LABEL_RU, type StudyField } from '@core/catalog/types';
import { totalMandatoryCost, DEMO_FX_RATES } from '@core/eligibility/recommend';
import { ELIGIBILITY_LABEL_RU } from '@core/eligibility/program-result';
import { FEASIBILITY_LABEL_RU } from '@core/planning/bridge';
import { applicantCategoryRu, countryRu, documentRu, languageRu, subjectRu } from '@core/i18n/labels';
import { formatMoneyRu } from '@core/kernel/money';
import { EXAM_STATE_LABEL_RU, EDUCATION_LEVEL_LABEL_RU, valueOf, type EducationLevel } from '@core/kernel/profile';
import { TASK_STATUS_LABEL_RU } from '@core/progress/state';
import { conservativeCutoff, formatPlainDateRu } from '@core/kernel/time';
import { flattenLeaves } from '@core/eligibility/evaluate';
import { FactCatalogue, normalizeDate, normalizeNumber } from './facts';

/** Сколько вариантов показываем модели: больше не улучшает объяснение. */
const MAX_OPTIONS = 6;
const MAX_TASKS = 8;

export interface AdviceContext {
  readonly payload: Record<string, unknown>;
  /** Идентификаторы, которые модель имеет право упоминать. */
  readonly allowedPathIds: readonly string[];
  readonly allowedTaskIds: readonly string[];
  /**
   * Подписи идентификаторов.
   *
   * Нужны, чтобы вычистить из текста служебные строки вида
   * `sdu-cs-2027-paid`: модель иногда вставляет их в прозу, и пользователю
   * это ничего не говорит.
   */
  readonly idTitles: ReadonlyMap<string, string>;
  /** Выбранные пользователем варианты, прошедшие проверку существования. */
  readonly focusPathIds: readonly string[];
  /**
   * Проверяемые факты расчёта.
   *
   * Модель ссылается на них идентификатором, значение подставляет сервер,
   * а свободный текст проверяется в области своего субъекта.
   */
  readonly facts: FactCatalogue;
}

/**
 * @param focusPathIds Пути подачи, которые пользователь выбрал сам — например,
 * галочками на экране сравнения. Они попадают в контекст ОБЯЗАТЕЛЬНО, даже
 * если не входят в общий топ: иначе модель разбирала бы не то, что выбрано.
 */
export function buildAdviceContext(
  session: SessionSnapshot,
  focusPathIds: readonly string[] = [],
): AdviceContext {
  const profile = session.profile;

  const options = [
    ...session.recommendation.recommended,
    ...session.recommendation.alternatives,
    ...session.recommendation.needsVerification,
  ].slice(0, MAX_OPTIONS);

  const include = (pathId: string): void => {
    if (options.some((o) => o.admissionPathId === pathId)) return;
    const found = session.recommendation.assessments.find((a) => a.admissionPathId === pathId);
    if (found) options.unshift(found);
  };

  // Активная цель всегда в списке, даже если она не попала в верхние варианты:
  // без неё модель не сможет объяснить выбранный маршрут.
  const activeId = session.activeGoal?.path.id ?? null;
  if (activeId) include(activeId);

  // Выбранные пользователем варианты — тоже. Неизвестный идентификатор сюда
  // не пройдёт: в `assessments` его просто нет.
  const focus = [...new Set(focusPathIds)];
  for (const pathId of focus) include(pathId);

  const facts = new FactCatalogue();

  // Факты профиля относятся ко всем вариантам.
  const gpaRecord = profile.grades.find((g) => g.scaleId === 'gpa_5');
  if (gpaRecord) {
    facts.add({
      subject: { kind: 'profile' },
      measure: 'gpa',
      valueKind: 'number',
      display: String(gpaRecord.value),
      normalized: normalizeNumber(String(gpaRecord.value)),
      label: 'Ваш средний балл',
    });
  }
  for (const exam of profile.exams) {
    if (exam.overall === undefined) continue;
    const measure =
      exam.examKind === 'IELTS' ? 'exam_score_ielts'
      : exam.examKind === 'TOEFL' ? 'exam_score_toefl'
      : exam.examKind === 'ЕНТ' ? 'exam_score_ent'
      : null;
    if (!measure) continue;
    facts.add({
      subject: { kind: 'profile' },
      measure,
      valueKind: 'number',
      display: String(exam.overall),
      normalized: normalizeNumber(String(exam.overall)),
      label: `Ваш результат ${exam.examKind}`,
    });
  }
  const budgetValue = valueOf(profile.budget);
  if (budgetValue) {
    facts.add({
      subject: { kind: 'profile' },
      measure: 'budget_limit',
      valueKind: 'money',
      display: formatMoneyRu(budgetValue.limit),
      normalized: normalizeNumber(String(Number(budgetValue.limit.amountMinor) / 100)),
      label: 'Ваш бюджет',
    });
  }
  const hoursValue = valueOf(profile.weeklyHours);
  if (hoursValue !== undefined) {
    facts.add({
      subject: { kind: 'profile' },
      measure: 'weekly_hours',
      valueKind: 'number',
      display: `${hoursValue} ч в неделю`,
      normalized: normalizeNumber(String(hoursValue)),
      label: 'Доступное время',
    });
  }

  const optionPayload = options.map((assessment) => {
    const goal = session.goals.find((g) => g.path.id === assessment.admissionPathId);
    if (!goal) return null;

    const cost = totalMandatoryCost(goal.path, 'KZT', DEMO_FX_RATES);
    const nearest = [...goal.deadlines]
      .map((d) => ({ d, c: conservativeCutoff(d) }))
      .filter((x): x is { d: (typeof goal.deadlines)[number]; c: { utc: string; uncertain: boolean } } => x.c !== null)
      .sort((a, b) => (a.c.utc < b.c.utc ? -1 : 1))[0];

    const subject = { kind: 'path' as const, id: goal.path.id };

    const costDisplay =
      cost.min === cost.max
        ? formatMoneyRu({ amountMinor: cost.min, currency: 'KZT' })
        : `${formatMoneyRu({ amountMinor: cost.min, currency: 'KZT' })} — ${formatMoneyRu({ amountMinor: cost.max, currency: 'KZT' })}`;

    // Обязательные расходы: нижняя граница — то значение, которое можно назвать.
    facts.add({
      subject,
      measure: 'tuition_cost',
      valueKind: 'money',
      display: costDisplay,
      normalized: normalizeNumber(String(Number(cost.min) / 100)),
      label: 'Обязательные расходы',
    });

    if (nearest?.d.localDate) {
      facts.add({
        subject,
        measure: 'deadline',
        valueKind: 'date',
        display: formatPlainDateRu(nearest.d.localDate),
        normalized: normalizeDate(nearest.d.localDate),
        label: 'Ближайшая отсечка',
      });
    }

    for (const funding of goal.path.funding) {
      facts.add({
        subject,
        measure: 'funding_amount',
        valueKind: 'money',
        display: formatMoneyRu(funding.amount),
        normalized: normalizeNumber(String(Number(funding.amount.amountMinor) / 100)),
        label: funding.label,
      });
    }

    facts.add({
      subject,
      measure: 'duration_years',
      valueKind: 'number',
      display: String(goal.program.durationYears),
      normalized: normalizeNumber(String(goal.program.durationYears)),
      label: 'Длительность программы',
    });

    // Пороги требований: именно они не должны подменяться средним баллом.
    for (const leaf of flattenLeaves(assessment.tree)) {
      const key = leaf.countingKey ?? '';
      const minEvidence = leaf.evidence.find((e) => e.label === 'Минимум');
      if (!minEvidence) continue;

      const measure =
        key.startsWith('lang:ielts') ? 'requirement_ielts'
        : key.startsWith('lang:toefl') ? 'requirement_toefl'
        : key.startsWith('exam:ent') ? 'requirement_ent'
        : key.startsWith('gpa:') ? 'requirement_gpa'
        : null;
      if (!measure) continue;

      facts.add({
        subject,
        measure,
        valueKind: 'number',
        display: minEvidence.value,
        normalized: normalizeNumber(minEvidence.value),
        label: `${leaf.title} — минимум`,
      });
    }

    return {
      pathId: goal.path.id,
      program: goal.program.title,
      university: goal.university.name,
      city: goal.university.city,
      country: countryRu(goal.university.country),
      field: STUDY_FIELD_LABEL_RU[goal.program.field as StudyField],
      instructionLanguages: goal.program.instructionLanguages.map(languageRu),
      intake: goal.intake.label,
      admissionPath: goal.path.label,
      isActiveGoal: goal.path.id === activeId,
      isSelectedForComparison: focus.includes(goal.path.id),
      verdict: {
        bucket: assessment.bucket,
        matchKind: assessment.matchKind,
        outsideFilters: assessment.preference.outsideFilters,
        eligibility: ELIGIBILITY_LABEL_RU[assessment.eligibility],
        access: assessment.access.message ?? 'путь открыт для вашей категории',
        exclusionReason: assessment.exclusionReason ?? null,
      },
      conditions: {
        met: assessment.counts.MET,
        notMet: assessment.counts.NOT_MET,
        unknown: assessment.counts.UNKNOWN,
        conflict: assessment.counts.CONFLICT,
      },
      money: {
        mandatoryCost:
          cost.min === cost.max
            ? formatMoneyRu({ amountMinor: cost.min, currency: 'KZT' })
            : `${formatMoneyRu({ amountMinor: cost.min, currency: 'KZT' })} — ${formatMoneyRu({ amountMinor: cost.max, currency: 'KZT' })}`,
        incomplete: cost.incomplete,
        budgetVerdict: describeBudget(assessment.financial),
        funding: goal.path.funding.map((f) => `${f.label}: ${formatMoneyRu(f.amount)} (${f.conditions})`),
      },
      nearestDeadline: nearest?.d.localDate
        ? `${formatPlainDateRu(nearest.d.localDate)}${nearest.c.uncertain ? ' (время не указано источником)' : ''}`
        : 'не опубликована',
      ruleBasedReasons: assessment.reasons,
    };
  }).filter((x): x is NonNullable<typeof x> => x !== null);

  for (const view of session.taskViews.slice(0, MAX_TASKS)) {
    const subject = { kind: 'task' as const, id: view.task.id };
    facts.add({
      subject,
      measure: 'date_generic',
      valueKind: 'date',
      display: formatPlainDateRu(view.task.earliestStart),
      normalized: normalizeDate(view.task.earliestStart),
      label: 'Можно начать',
    });
    if (view.task.latestFinish) {
      facts.add({
        subject,
        measure: 'deadline',
        valueKind: 'date',
        display: formatPlainDateRu(view.task.latestFinish),
        normalized: normalizeDate(view.task.latestFinish),
        label: 'Крайний срок',
      });
    }
  }

  const tasks = session.taskViews.slice(0, MAX_TASKS).map((view) => ({
    taskId: view.task.id,
    title: view.task.template.title,
    kind: view.task.template.kind,
    requiredOutcome: view.task.template.requiredOutcome,
    completionCriterion: view.task.template.completionCriterion,
    status: TASK_STATUS_LABEL_RU[view.state.status],
    blocked: view.flags.blocked,
    earliestStart: formatPlainDateRu(view.task.earliestStart),
    latestFinish: view.task.latestFinish ? formatPlainDateRu(view.task.latestFinish) : 'срок не определён источником',
    slackDays: view.flags.slackDays,
    effortHours: `${view.task.template.effortHours.min}–${view.task.template.effortHours.max} ч`,
  }));

  const level = valueOf(profile.educationLevel);

  const payload = {
    today: session.today,
    profile: {
      educationLevel: level ? EDUCATION_LEVEL_LABEL_RU[level as EducationLevel] : 'не указан',
      expectedGraduation: valueOf(profile.expectedGraduation) ?? 'не указана',
      applicantCategory: applicantCategoryRu(valueOf(profile.applicantCategory)),
      admissionYear: valueOf(profile.admissionYear) ?? 'не указан',
      interests: profile.interests.map((f) => STUDY_FIELD_LABEL_RU[f as StudyField] ?? f),
      targetCountries: profile.targetCountries.map(countryRu),
      instructionLanguages: profile.instructionLanguages.map(languageRu),
      gpa: profile.grades.find((g) => g.scaleId === 'gpa_5')?.value ?? 'не указан',
      subjects: profile.subjects.map((s) => subjectRu(s.subjectId)),
      englishSelfAssessment: profile.languages.find((l) => l.language === 'en')?.cefr ?? 'не указан',
      exams: profile.exams.map((e) => ({
        exam: e.examKind,
        state: EXAM_STATE_LABEL_RU[e.state],
        overall: e.overall ?? null,
        resultOn: e.resultOn ?? null,
      })),
      documents: profile.documents.map((d) => ({
        document: documentRu(d.documentKind),
        obtained: d.obtained,
      })),
      weeklyHours: valueOf(profile.weeklyHours) ?? 'не указано',
      budget: (() => {
        const budget = valueOf(profile.budget);
        if (!budget) return 'не указан';
        return `${formatMoneyRu(budget.limit)} (${budget.scope === 'tuition_only' ? 'только обучение' : 'все расходы'}, за учебный год)`;
      })(),
    },
    diagnosisFromRules: {
      goal: session.diagnosis.goalSummary,
      strengths: session.diagnosis.strengths.map((s) => s.text),
      limits: session.diagnosis.limits.map((s) => s.text),
      gaps: session.diagnosis.gaps.map((s) => s.text),
      priorities: session.diagnosis.priorities.map((p) => `${p.title} — ${p.explanation}`),
      missingAnswers: session.diagnosis.missingAnswers.map((m) => m.text),
    },
    options: optionPayload,
    route: session.route
      ? {
          feasibility: FEASIBILITY_LABEL_RU[session.route.feasibility.status],
          requiredWeeklyHours: Math.round(session.route.feasibility.requiredWeeklyHours),
          availableWeeklyHours: session.route.feasibility.availableWeeklyHours,
          limitations: session.route.feasibility.limitations.map((l) => l.message),
          tasks,
        }
      : null,
    nextActionFromRules: {
      kind: session.nextAction.kind,
      taskId: session.nextAction.kind === 'action' ? session.nextAction.view.task.id : null,
      title: session.nextAction.kind === 'action' ? session.nextAction.view.task.template.title : null,
      explanation: session.nextAction.explanation,
    },
    warningsFromRules: (session.bridge?.warnings ?? []).map((w) => w.message),
  };

  const focusSet = new Set(focus.filter((id) => optionPayload.some((o) => o.pathId === id)));
  const idTitles = new Map<string, string>();
  for (const option of optionPayload) {
    idTitles.set(option.pathId, `${option.program} — ${option.university}, ${option.admissionPath}`);
  }
  for (const task of tasks) idTitles.set(task.taskId, task.title);

  return {
    payload: {
      ...payload,
      selectedForComparison: [...focusSet],
      // Факты передаются отдельным списком: на них модель ссылается по id.
      verifiableFacts: facts.forPrompt(),
    },
    allowedPathIds: optionPayload.map((o) => o.pathId),
    allowedTaskIds: tasks.map((t) => t.taskId),
    focusPathIds: [...focusSet],
    idTitles,
    facts,
  };
}

function describeBudget(verdict: SessionSnapshot['goals'][number]['assessment']['financial']): string {
  switch (verdict.kind) {
    case 'compatible_in_known_range':
      return 'укладывается в указанный бюджет';
    case 'known_gap':
      return `не хватает ${formatMoneyRu(verdict.shortfall)}`;
    case 'needs_clarification':
      return 'сравнение с бюджетом неопределённо';
  }
}
