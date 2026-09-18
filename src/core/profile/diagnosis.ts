/**
 * Краткая диагностика профиля.
 *
 * Между анкетой и рекомендациями пользователю нужен ответ на вопрос «что вы
 * вообще обо мне поняли». Диагностика собирается из уже посчитанных данных:
 * фактов профиля и оценок путей подачи. Своей логики подбора здесь нет —
 * иначе на экране появилось бы второе мнение, расходящееся с рекомендациями.
 *
 * Ни одно утверждение здесь не является прогнозом поступления.
 */

import type { CatalogSnapshot } from '../catalog/types';
import { STUDY_FIELD_LABEL_RU, type StudyField } from '../catalog/types';
import { getProgram } from '../catalog/types';
import { flattenLeaves } from '../eligibility/evaluate';
import type { RecommendationResult } from '../eligibility/recommend';
import type { ProgramAssessment } from '../eligibility/program-result';
import { applicantCategoryRu, countryRu, languageRu, subjectRu } from '../i18n/labels';
import { formatMoneyRu } from '../kernel/money';
import {
  EDUCATION_LEVEL_LABEL_RU,
  EXAM_STATE_LABEL_RU,
  valueOf,
  type ApplicantProfileRevision,
  type EducationLevel,
} from '../kernel/profile';
import { formatPlainDateRu, type PlainDate } from '../kernel/time';

export interface DiagnosisItem {
  readonly id: string;
  readonly text: string;
}

export interface PreparationPriority {
  readonly countingKey: string;
  readonly title: string;
  /** По скольким рассмотренным вариантам это требование открыто. */
  readonly blocksCount: number;
  readonly explanation: string;
}

export interface Diagnosis {
  /** Образовательная цель одной фразой: уровень, направление, страна, год. */
  readonly goalSummary: string;
  readonly strengths: readonly DiagnosisItem[];
  readonly limits: readonly DiagnosisItem[];
  readonly gaps: readonly DiagnosisItem[];
  readonly priorities: readonly PreparationPriority[];
  /** Чего не хватает в анкете, чтобы выводы перестали быть неопределёнными. */
  readonly missingAnswers: readonly DiagnosisItem[];
  readonly fitCount: number;
  readonly alternativesCount: number;
  readonly consideredCount: number;
}

export function buildDiagnosis(input: {
  readonly profile: ApplicantProfileRevision;
  readonly recommendation: RecommendationResult;
  readonly catalog: CatalogSnapshot;
  readonly today: PlainDate;
}): Diagnosis {
  const { profile, recommendation, catalog } = input;

  return {
    goalSummary: goalSummary(profile),
    strengths: strengths(profile, recommendation),
    limits: limits(profile, recommendation),
    gaps: gaps(recommendation, catalog),
    priorities: priorities(recommendation),
    missingAnswers: missingAnswers(profile),
    fitCount: recommendation.recommended.length,
    alternativesCount: recommendation.alternatives.length,
    consideredCount: recommendation.consideredPathCount,
  };
}

/* ------------------------------------------------------------------ */

function goalSummary(profile: ApplicantProfileRevision): string {
  const level = valueOf(profile.educationLevel);
  const year = valueOf(profile.admissionYear);

  const who = level ? EDUCATION_LEVEL_LABEL_RU[level as EducationLevel] : 'уровень образования не указан';
  const fields =
    profile.interests.length > 0
      ? profile.interests.map((f) => STUDY_FIELD_LABEL_RU[f as StudyField] ?? f).join(', ')
      : 'направление не выбрано';
  const where =
    profile.targetCountries.length > 0
      ? profile.targetCountries.map(countryRu).join(', ')
      : 'страна не ограничена';
  const when = year ? `поступление в ${year} году` : 'год поступления не указан';

  return `${capitalizeFirst(who)}: ${fields}. География — ${where}. ${capitalizeFirst(when)}.`;
}

function strengths(
  profile: ApplicantProfileRevision,
  recommendation: RecommendationResult,
): DiagnosisItem[] {
  const out: DiagnosisItem[] = [];

  const gpa = profile.grades.find((g) => g.scaleId === 'gpa_5');
  if (gpa) {
    out.push({
      id: 'gpa',
      text: `Средний балл ${gpa.value} по пятибалльной шкале — он уже сравнивается с порогами программ.`,
    });
  }

  if (profile.subjects.length > 0) {
    out.push({
      id: 'subjects',
      text: `Профильные предметы: ${profile.subjects.map((s) => subjectRu(s.subjectId)).join(', ')}.`,
    });
  }

  for (const exam of profile.exams) {
    if (exam.state === 'result_reported' && exam.overall !== undefined) {
      out.push({
        id: `exam-${exam.examKind}`,
        text: `${exam.examKind}: результат ${exam.overall} уже засчитывается в условиях.`,
      });
    } else if (exam.state === 'taken_awaiting_result') {
      out.push({
        id: `exam-${exam.examKind}`,
        text:
          `${exam.examKind} сдан${exam.resultOn ? `, результат ожидается ${formatPlainDateRu(exam.resultOn)}` : ''}. ` +
          'Подготовку и сдачу план заново не назначает.',
      });
    } else if (exam.state === 'scheduled' && exam.scheduledFor) {
      out.push({
        id: `exam-${exam.examKind}`,
        text: `${exam.examKind}: вы записаны на ${formatPlainDateRu(exam.scheduledFor)}, регистрация в плане не повторяется.`,
      });
    }
  }

  const english = profile.languages.find((l) => l.language === 'en');
  if (english) {
    out.push({
      id: 'english',
      text: `Самооценка английского — ${english.cefr}. Это ориентир для подготовки, условие она не закрывает.`,
    });
  }

  const compatible = recommendation.assessments.filter(
    (a) => a.financial.kind === 'compatible_in_known_range',
  ).length;
  if (compatible > 0) {
    out.push({
      id: 'budget',
      text: `В указанный бюджет укладываются ${compatible} из ${recommendation.consideredPathCount} рассмотренных путей подачи.`,
    });
  }

  if (recommendation.recommended.length >= 3) {
    out.push({
      id: 'fit',
      text: `Вариантов, проходящих по вашим фильтрам и известным условиям: ${recommendation.recommended.length}.`,
    });
  }

  return out;
}

function limits(
  profile: ApplicantProfileRevision,
  recommendation: RecommendationResult,
): DiagnosisItem[] {
  const out: DiagnosisItem[] = [];

  const byCategory = recommendation.assessments.filter(
    (a) => a.access.code === 'CATEGORY_NOT_ALLOWED',
  ).length;
  if (byCategory > 0) {
    const category = valueOf(profile.applicantCategory);
    out.push({
      id: 'category',
      text:
        `${byCategory} пут(ь/и) подачи закрыты для категории «${applicantCategoryRu(category)}» — ` +
        'это ограничение приёма, а не ваш пробел.',
    });
  }

  const byYear = recommendation.assessments.filter((a) => a.access.code === 'YEAR_MISMATCH').length;
  if (byYear > 0 && recommendation.requestedYear !== null) {
    out.push({
      id: 'year',
      text:
        `${byYear} кампаний относятся к другим годам набора и не показаны как подходящие: ` +
        `вы указали ${recommendation.requestedYear}.`,
    });
  }

  const byMoney = recommendation.assessments.filter((a) => a.financial.kind === 'known_gap').length;
  if (byMoney > 0) {
    const budget = valueOf(profile.budget);
    out.push({
      id: 'budget',
      text:
        `${byMoney} вариантов дороже указанного бюджета` +
        (budget ? ` (${formatMoneyRu(budget.limit)})` : '') +
        '. Величина нехватки указана на карточке каждого.',
    });
  }

  const hours = valueOf(profile.weeklyHours);
  if (hours !== undefined && hours <= 6) {
    out.push({
      id: 'hours',
      text: `Доступно ${hours} ч в неделю — это мало для параллельной подготовки к нескольким экзаменам.`,
    });
  }

  if (recommendation.alternatives.length > 0) {
    out.push({
      id: 'filters',
      text:
        `${recommendation.alternatives.length} подходящих по условиям вариантов лежат за пределами ` +
        'выбранных направлений или стран. Они показаны отдельно как альтернативы.',
    });
  }

  return out;
}

function gaps(recommendation: RecommendationResult, catalog: CatalogSnapshot): DiagnosisItem[] {
  const pool = [...recommendation.recommended, ...recommendation.alternatives, ...recommendation.needsVerification];
  const seen = new Map<string, DiagnosisItem>();

  for (const assessment of pool.slice(0, 6)) {
    const program = getProgram(catalog, assessment.programId);
    for (const leaf of flattenLeaves(assessment.tree)) {
      if (leaf.outcome.kind !== 'evaluated') continue;
      if (leaf.outcome.status !== 'NOT_MET') continue;
      const key = leaf.countingKey ?? leaf.nodeId;
      if (seen.has(key)) continue;
      seen.set(key, {
        id: key,
        text: `${leaf.title} — например, для «${program?.title ?? assessment.programId}».`,
      });
    }
  }

  return [...seen.values()].slice(0, 6);
}

/**
 * Приоритет подготовки: требование, которое закрывает больше всего вариантов.
 *
 * Это не «шанс» и не рейтинг — просто счёт, по скольким рассмотренным путям
 * условие сейчас не выполнено.
 */
function priorities(recommendation: RecommendationResult): PreparationPriority[] {
  const pool = [...recommendation.recommended, ...recommendation.alternatives, ...recommendation.needsVerification];
  const counter = new Map<string, { title: string; count: number }>();

  for (const assessment of pool) {
    const keys = new Set<string>();
    for (const leaf of flattenLeaves(assessment.tree)) {
      if (leaf.outcome.kind !== 'evaluated') continue;
      if (leaf.outcome.status !== 'NOT_MET') continue;
      const key = leaf.countingKey ?? leaf.nodeId;
      if (keys.has(key)) continue;
      keys.add(key);
      const prev = counter.get(key);
      counter.set(key, { title: prev?.title ?? leaf.title, count: (prev?.count ?? 0) + 1 });
    }
  }

  return [...counter.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([countingKey, { title, count }]) => ({
      countingKey,
      title,
      blocksCount: count,
      explanation:
        count > 1
          ? `Это условие открыто сразу у ${count} рассмотренных вариантов — закрыв его, вы продвинетесь по нескольким целям.`
          : 'Это условие открыто у одного из рассмотренных вариантов.',
    }));
}

function missingAnswers(profile: ApplicantProfileRevision): DiagnosisItem[] {
  const out: DiagnosisItem[] = [];

  if (profile.applicantCategory.state !== 'known') {
    out.push({
      id: 'applicantCategory',
      text: 'Категория заявителя: без неё нельзя сказать, какие пути подачи вам открыты.',
    });
  }
  if (profile.admissionYear.state !== 'known') {
    out.push({
      id: 'admissionYear',
      text: 'Год поступления: без него в выдачу попадают кампании разных лет.',
    });
  }
  if (profile.expectedGraduation.state !== 'known') {
    const level = valueOf(profile.educationLevel);
    if (level !== 'school_graduate' && level !== 'college_graduate') {
      out.push({
        id: 'expectedGraduation',
        text: 'Дата окончания школы: от неё зависит, когда вообще можно получить аттестат.',
      });
    }
  }
  if (profile.budget.state !== 'known') {
    out.push({
      id: 'budgetLimit',
      text: 'Бюджет: без него денежные выводы остаются неопределёнными.',
    });
  }
  if (profile.grades.length === 0) {
    out.push({ id: 'gpa', text: 'Средний балл: по нему проверяется часть обязательных условий.' });
  }
  if (profile.subjects.length === 0) {
    out.push({
      id: 'subjects',
      text: 'Профильные предметы: без них требования вида «не менее двух профильных» не закрываются.',
    });
  }
  if (profile.exams.length === 0) {
    out.push({
      id: 'exams',
      text: 'Экзамены: если что-то уже сдано или назначено, план не будет назначать это заново.',
    });
  }

  return out;
}

function capitalizeFirst(text: string): string {
  return text.length === 0 ? text : text[0]!.toUpperCase() + text.slice(1);
}

export { EXAM_STATE_LABEL_RU, languageRu };
