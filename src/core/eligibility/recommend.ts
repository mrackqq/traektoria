/**
 * Подбор и сравнение программ.
 *
 * Показываем минимум три подходящие программы, ЕСЛИ подтверждённые данные и
 * ограничения это позволяют. Если меньше — показываем фактическое количество,
 * причину и объяснённые альтернативы, а не подставляем заведомо неподходящие
 * варианты до красивого числа.
 *
 * Здесь же проходит граница между двумя разными вещами:
 *  • ЖЁСТКОЕ ограничение (категория заявителя, год кампании, деньги, условия) —
 *    меняет бакет показа и сопровождается причиной;
 *  • МЯГКОЕ предпочтение (направление, страна, язык, наличие финансирования) —
 *    меняет группу «подходит вам» / «альтернатива» и порядок, но не выбрасывает
 *    вариант и ничего не закрывает.
 */

import {
  assessBudget,
  convert,
  type BudgetConstraint,
  type BudgetVerdict,
  type CostRange,
  type FxRate,
  type Money,
} from '../kernel/money';
import type { ApplicantProfileRevision } from '../kernel/profile';
import { valueOf } from '../kernel/profile';
import type { PlanningClock } from '../kernel/time';
import { conservativeCutoff, formatPlainDateRu, utcMsToPlainDate } from '../kernel/time';
import {
  getProgram,
  getUniversity,
  pathsForIntake,
  STUDY_FIELD_LABEL_RU,
  type AdmissionPath,
  type CatalogSnapshot,
  type Intake,
} from '../catalog/types';
import { applicantCategoryRu, countryRu, languageRu } from '../i18n/labels';
import { evaluateTree, type EvaluatedNode } from './evaluate';
import {
  ACCESS_ALLOWED,
  compareAssessments,
  deriveBucket,
  deriveDataQuality,
  deriveEligibility,
  type AccessCheck,
  type MatchKind,
  type PreferenceMatch,
  type ProgramAssessment,
} from './program-result';
import { countByStatus } from './evaluate';
import { ELIGIBILITY_LABEL_RU } from './program-result';
import { formatMoneyRu } from '../kernel/money';
import { countRu, FORMS_YEAR } from '../kernel/plural';

/** Демонстрационные курсы: у конверсии есть источник, дата и правило. */
export const DEMO_FX_RATES: readonly FxRate[] = [
  { from: 'EUR', to: 'KZT', numerator: 5600n, denominator: 10n, asOf: '2026-09-17', sourceId: 'demo-fx', rounding: 'half_up' },
  { from: 'USD', to: 'KZT', numerator: 4800n, denominator: 10n, asOf: '2026-09-17', sourceId: 'demo-fx', rounding: 'half_up' },
  { from: 'TRY', to: 'KZT', numerator: 140n, denominator: 10n, asOf: '2026-09-17', sourceId: 'demo-fx', rounding: 'half_up' },
];

export interface RecommendationInput {
  readonly profile: ApplicantProfileRevision;
  readonly catalog: CatalogSnapshot;
  readonly clock: PlanningClock;
  readonly fxRates?: readonly FxRate[];
}

export interface RecommendationResult {
  readonly assessments: readonly ProgramAssessment[];
  /** Проходят по известным условиям И попадают в выбранные направления и страны. */
  readonly recommended: readonly ProgramAssessment[];
  /** Проходят по условиям, но лежат за пределами выбранных фильтров. */
  readonly alternatives: readonly ProgramAssessment[];
  readonly needsVerification: readonly ProgramAssessment[];
  readonly notSuitable: readonly ProgramAssessment[];
  /** Если подходящих меньше трёх — честная причина. */
  readonly shortfallReason: string | null;
  readonly consideredPathCount: number;
  /** Годы набора, на которые в каталоге вообще есть данные. */
  readonly availableYears: readonly number[];
  /** Год, выбранный в анкете. null — не указан. */
  readonly requestedYear: number | null;
  /** Выбранный год есть в каталоге. */
  readonly requestedYearAvailable: boolean;
}

export function recommend(input: RecommendationInput): RecommendationResult {
  const fx = input.fxRates ?? DEMO_FX_RATES;
  const assessments: ProgramAssessment[] = [];
  let considered = 0;

  for (const intake of input.catalog.intakes) {
    const program = getProgram(input.catalog, intake.programId);
    if (!program) continue;

    for (const path of pathsForIntake(input.catalog, intake.id)) {
      considered++;
      assessments.push(assessPath(input, intake, path, fx));
    }
  }

  assessments.sort(compareAssessments);

  const fits = assessments.filter((a) => a.bucket === 'recommended');
  const recommended = fits.filter((a) => a.matchKind === 'preferred');
  const alternatives = fits.filter((a) => a.matchKind === 'alternative');
  const needsVerification = assessments.filter((a) => a.bucket === 'needs_verification');
  const notSuitable = assessments.filter((a) => a.bucket === 'not_suitable');

  const availableYears = [...new Set(input.catalog.intakes.map((i) => i.admissionYear))].sort();
  const requestedYear = valueOf(input.profile.admissionYear) ?? null;

  return {
    assessments,
    recommended,
    alternatives,
    needsVerification,
    notSuitable,
    shortfallReason: explainShortfall({
      recommendedCount: recommended.length,
      alternatives,
      needsVerification,
      notSuitable,
      requestedYear,
      availableYears,
    }),
    consideredPathCount: considered,
    availableYears,
    requestedYear,
    requestedYearAvailable: requestedYear === null || availableYears.includes(requestedYear),
  };
}

function explainShortfall(input: {
  recommendedCount: number;
  alternatives: readonly ProgramAssessment[];
  needsVerification: readonly ProgramAssessment[];
  notSuitable: readonly ProgramAssessment[];
  requestedYear: number | null;
  availableYears: readonly number[];
}): string | null {
  const { recommendedCount, alternatives, needsVerification, notSuitable } = input;
  if (recommendedCount >= 3) return null;

  const parts: string[] = [];

  if (input.requestedYear !== null && !input.availableYears.includes(input.requestedYear)) {
    parts.push(
      `На ${input.requestedYear} год в каталоге нет опубликованных кампаний приёма. ` +
        `Данные есть на ${input.availableYears.join(' и ')}. Прошлогодний набор вместо ` +
        'выбранного года мы не показываем.',
    );
  } else if (recommendedCount === 0) {
    parts.push('Сейчас ни один вариант не проходит полностью по известным условиям и вашим фильтрам.');
  } else {
    parts.push(
      `По вашим данным и фильтрам подходящих вариантов ${recommendedCount}, а не три. ` +
        'Недостающие не подставляются.',
    );
  }

  if (alternatives.length > 0) {
    parts.push(
      `Ещё ${alternatives.length} проходят по условиям, но лежат за пределами выбранных ` +
        'направлений или стран — они показаны как альтернативы с объяснением.',
    );
  }
  if (needsVerification.length > 0) {
    parts.push(
      `${needsVerification.length} требуют проверки: по ним есть неизвестные или ` +
        'противоречивые условия.',
    );
  }
  if (notSuitable.length > 0) {
    parts.push(`${notSuitable.length} исключены — причина указана у каждой карточки.`);
  }
  return parts.join(' ');
}

/* ------------------------------------------------------------------ */
/* Жёсткая доступность пути                                            */
/* ------------------------------------------------------------------ */

/**
 * Доступен ли путь подачи этому заявителю в этом году.
 *
 * Проверяется ДО оценки дерева: ограничение по категории лежит на самом пути
 * (`applicantCategories`), а год — на кампании. Ни то, ни другое не выводится
 * из условий, и без этой проверки закрытый путь попадал в основную группу.
 */
export function checkPathAccess(
  profile: ApplicantProfileRevision,
  intake: Intake,
  path: AdmissionPath,
): AccessCheck {
  const year = valueOf(profile.admissionYear);
  if (year !== undefined && year !== intake.admissionYear) {
    return {
      status: 'blocked',
      code: 'YEAR_MISMATCH',
      message:
        `Это кампания ${intake.admissionYear} года, а вы указали поступление в ${year}. ` +
        'Набор другого года вместо выбранного не показывается.',
    };
  }

  const category = profile.applicantCategory;
  if (path.applicantCategories.length > 0) {
    if (category.state !== 'known') {
      return {
        status: 'needs_input',
        code: 'CATEGORY_UNKNOWN',
        message:
          'Путь открыт не всем категориям заявителей, а ваша категория не указана. ' +
          'Пока она неизвестна, вывод по доступности не делается.',
      };
    }
    if (!path.applicantCategories.includes(category.value)) {
      const allowed = path.applicantCategories.map(applicantCategoryRu).join(', ');
      return {
        status: 'blocked',
        code: 'CATEGORY_NOT_ALLOWED',
        message:
          `Путь подачи открыт только для категорий: ${allowed}. ` +
          `Ваша категория — ${applicantCategoryRu(category.value)}.`,
      };
    }
  }

  if (year === undefined) {
    return {
      status: 'needs_input',
      code: 'YEAR_UNKNOWN',
      message:
        'Год поступления не указан, поэтому кампании показаны все. ' +
        'Укажите год, чтобы отсеять чужие сроки.',
    };
  }

  return ACCESS_ALLOWED;
}

/* ------------------------------------------------------------------ */
/* Оценка одного пути                                                  */
/* ------------------------------------------------------------------ */

export function assessPath(
  input: RecommendationInput,
  intake: Intake,
  path: AdmissionPath,
  fx: readonly FxRate[],
): ProgramAssessment {
  const nearest = nearestDeadlineDate(intake);

  const tree: EvaluatedNode = evaluateTree({
    profile: input.profile,
    node: path.requirementTree,
    controlDate: intake.resultValidityControlDate,
    catalog: input.catalog,
    clock: input.clock,
    admissionPathId: path.id,
    ...(nearest ? { nearestDeadline: nearest } : {}),
  });

  const { status: eligibility } = deriveEligibility(tree);
  const dataQuality = deriveDataQuality(tree, path.isDemo);
  const counts = countByStatus(tree);
  const financial = assessPathBudget(input.profile, path, fx);
  const access = checkPathAccess(input.profile, intake, path);
  const preference = computePreference(input, intake, path);
  const matchKind: MatchKind = preference.outsideFilters.length === 0 ? 'preferred' : 'alternative';

  const { bucket, exclusionReason } = deriveBucket({
    eligibility,
    dataQuality,
    financial,
    // Планируемость на экране подбора не считается: она требует полного
    // расчёта моста. Измерения держатся раздельно, поэтому здесь честно
    // «не вычислялось», а не оптимистичное предположение.
    planning: 'not_computed',
    access,
    counts,
  });

  return {
    programId: intake.programId,
    intakeId: intake.id,
    admissionPathId: path.id,
    eligibility,
    dataQuality,
    financial,
    planning: 'not_computed',
    access,
    preference,
    matchKind,
    bucket,
    tree,
    counts,
    ...(exclusionReason ? { exclusionReason } : {}),
    reasons: buildReasons(input, intake, path, {
      eligibility,
      counts,
      financial,
      access,
      preference,
      tree,
    }),
  };
}

function nearestDeadlineDate(intake: Intake): string | undefined {
  const dates = intake.deadlines
    .map((d) => conservativeCutoff(d))
    .filter((c): c is { utc: string; uncertain: boolean } => c !== null)
    .map((c) => utcMsToPlainDate(Date.parse(c.utc)))
    .sort();
  return dates[0];
}

/**
 * Приводим расходы к валюте бюджета, если есть курс.
 * Без пригодного курса вывод остаётся неопределённым, а не «примерным».
 */
function assessPathBudget(
  profile: ApplicantProfileRevision,
  path: AdmissionPath,
  fx: readonly FxRate[],
): BudgetVerdict {
  const budget = valueOf(profile.budget);
  if (!budget) return { kind: 'needs_clarification', reason: 'unknown_mandatory_category' };

  const converted: CostRange[] = [];
  let hasUnknown = false;

  for (const item of path.costs) {
    const minC = convert(item.min, budget.limit.currency, fx);
    const maxC = convert(item.max, budget.limit.currency, fx);
    if (!minC.ok || !maxC.ok) {
      hasUnknown = true;
      continue;
    }
    converted.push({
      min: minC.value,
      max: maxC.value,
      period: item.period,
      scope: item.scope,
      mandatory: item.mandatory,
    });
  }

  if (hasUnknown) return { kind: 'needs_clarification', reason: 'no_fx_rate' };

  // Бюджет «только на обучение» сравнивается только с обучением.
  const relevant =
    budget.scope === 'tuition_only'
      ? converted.filter((c) => c.scope === 'tuition_only')
      : converted;

  if (relevant.length === 0) {
    return { kind: 'needs_clarification', reason: 'unknown_mandatory_category' };
  }

  return assessBudget(budget as BudgetConstraint, relevant, {
    hasUnknownMandatoryCategory: false,
  });
}

/**
 * Мягкие предпочтения.
 *
 * Пустой список у пользователя означает «ограничения нет»: тогда вариант
 * считается попадающим в фильтр, а не выпадающим из него.
 */
export function computePreference(
  input: RecommendationInput,
  _intake: Intake,
  path: AdmissionPath,
): PreferenceMatch {
  const program = getProgram(input.catalog, _intake.programId);
  const uni = program ? getUniversity(input.catalog, program.universityId) : undefined;

  if (!program) {
    return {
      score: 0,
      interestMatched: false,
      countryMatched: false,
      languageMatched: false,
      fundingAvailable: false,
      outsideFilters: [],
    };
  }

  const interests = input.profile.interests;
  const countries = input.profile.targetCountries;
  const languages = input.profile.instructionLanguages;

  const interestMatched = interests.length === 0 || interests.includes(program.field);
  const countryMatched = countries.length === 0 || (!!uni && countries.includes(uni.country));
  const languageMatched =
    languages.length === 0 || program.instructionLanguages.some((l) => languages.includes(l));
  const fundingAvailable = path.kind === 'grant' || path.funding.length > 0;

  const outsideFilters: string[] = [];
  if (interests.length > 0 && !interestMatched) outsideFilters.push('выбранные направления');
  if (countries.length > 0 && !countryMatched) outsideFilters.push('выбранные страны');

  // Веса: направление весит больше страны, страна — больше языка.
  const weights = { interest: 4, country: 3, language: 2, funding: 1 };
  const total = weights.interest + weights.country + weights.language + weights.funding;
  const earned =
    (interestMatched ? weights.interest : 0) +
    (countryMatched ? weights.country : 0) +
    (languageMatched ? weights.language : 0) +
    (fundingAvailable ? weights.funding : 0);

  return {
    score: Math.round((earned / total) * 100) / 100,
    interestMatched,
    countryMatched,
    languageMatched,
    fundingAvailable,
    outsideFilters,
  };
}

/**
 * Причины подбора человеческим языком.
 *
 * Предметные, а не общие: совпавшее направление, страна, язык, деньги,
 * ключевой пробел и что предстоит сделать. Это то, что пользователь читает
 * вместо «рекомендовано алгоритмом».
 */
function buildReasons(
  input: RecommendationInput,
  intake: Intake,
  path: AdmissionPath,
  ctx: {
    eligibility: string;
    counts: Record<string, number>;
    financial: BudgetVerdict;
    access: AccessCheck;
    preference: PreferenceMatch;
    tree: EvaluatedNode;
  },
): string[] {
  const program = getProgram(input.catalog, intake.programId);
  const uni = program ? getUniversity(input.catalog, program.universityId) : undefined;
  const reasons: string[] = [];

  if (program && ctx.preference.interestMatched && input.profile.interests.length > 0) {
    reasons.push(`Направление «${STUDY_FIELD_LABEL_RU[program.field]}» есть в ваших интересах.`);
  }
  if (uni && ctx.preference.countryMatched && input.profile.targetCountries.length > 0) {
    reasons.push(`Страна — ${countryRu(uni.country)}, она есть в вашем списке.`);
  }
  if (ctx.preference.outsideFilters.length > 0) {
    const where = uni ? `${countryRu(uni.country)}` : 'другая страна';
    const field = program ? STUDY_FIELD_LABEL_RU[program.field] : 'другое направление';
    reasons.push(
      `Это альтернатива за пределами ваших фильтров (${ctx.preference.outsideFilters.join(' и ')}): ` +
        `${field}, ${where}. Показываем, потому что по условиям вариант вам доступен.`,
    );
  }
  if (program && ctx.preference.languageMatched && input.profile.instructionLanguages.length > 0) {
    const matched = program.instructionLanguages.filter((l) =>
      input.profile.instructionLanguages.includes(l),
    );
    if (matched.length > 0) {
      reasons.push(`Язык обучения подходит: ${matched.map(languageRu).join(', ')}.`);
    }
  }

  switch (ctx.financial.kind) {
    case 'compatible_in_known_range':
      reasons.push('Обязательные расходы укладываются в указанный бюджет.');
      break;
    case 'known_gap':
      reasons.push(
        `По известным суммам не хватает ${formatMoneyRu(ctx.financial.shortfall)} ` +
          'к указанному бюджету.',
      );
      break;
    case 'needs_clarification':
      reasons.push('Денежный вывод неопределён: не все обязательные суммы сопоставимы с бюджетом.');
      break;
  }

  if (path.funding.length > 0) {
    reasons.push(`Есть финансирование: ${path.funding.map((f) => f.label).join('; ')}.`);
  }

  // Ключевой пробел: первый невыполненный лист — это и есть «что делать».
  const gap = firstGapTitle(ctx.tree);
  if (gap) reasons.push(`Ближайший пробел: ${gap}.`);

  const metCount = ctx.counts.MET ?? 0;
  const total =
    metCount + (ctx.counts.NOT_MET ?? 0) + (ctx.counts.UNKNOWN ?? 0) + (ctx.counts.CONFLICT ?? 0);
  if (total > 0) {
    reasons.push(`Из известных условий выполнено ${metCount} из ${total}.`);
  }
  if (ctx.access.status === 'needs_input' && ctx.access.message) {
    reasons.push(ctx.access.message);
  }
  if (ctx.eligibility === 'undetermined') {
    reasons.push('Часть условий не подтверждена — вывод по ним не делается.');
  }

  return reasons;
}

function firstGapTitle(tree: EvaluatedNode): string | null {
  const stack: EvaluatedNode[] = [tree];
  const gaps: EvaluatedNode[] = [];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.children.length > 0) {
      stack.push(...node.children);
      continue;
    }
    if (node.outcome.kind === 'evaluated' && node.outcome.status === 'NOT_MET') gaps.push(node);
  }
  // Детерминированный выбор: по идентификатору узла, а не по порядку обхода.
  gaps.sort((a, b) => a.nodeId.localeCompare(b.nodeId));
  return gaps[0]?.title ?? null;
}

/* ------------------------------------------------------------------ */
/* Сравнение                                                           */
/* ------------------------------------------------------------------ */

export interface ComparisonRow {
  readonly key: string;
  readonly label: string;
  /** По одному значению на каждую сравниваемую программу, в том же порядке. */
  readonly values: readonly ComparisonCell[];
}

export interface ComparisonCell {
  readonly text: string;
  /** Неизвестное не заменяется прочерком без пояснения. */
  readonly unknown?: boolean;
  readonly tone?: 'good' | 'warn' | 'bad' | 'neutral';
}

/** Что именно сравнивается. Порядок строк одинаков для всех программ. */
export interface ComparisonItem {
  readonly assessment: ProgramAssessment;
  readonly intake: Intake;
  readonly path: AdmissionPath;
  readonly programTitle: string;
  readonly universityShortName: string;
  readonly city: string;
  readonly instructionLanguages: readonly string[];
  readonly durationYears: number;
}

/**
 * Таблица сравнения.
 *
 * Главное правило этой функции: неизвестное значение НЕ заменяется прочерком.
 * Ячейка получает текст с причиной и признак `unknown`, чтобы интерфейс не мог
 * случайно показать «—» вместо «источник не опубликовал».
 */
export function buildComparison(
  items: readonly ComparisonItem[],
  currency: Money['currency'] = 'KZT',
  fx: readonly FxRate[] = DEMO_FX_RATES,
): ComparisonRow[] {
  const cells = (fn: (item: ComparisonItem) => ComparisonCell): ComparisonCell[] =>
    items.map(fn);

  return [
    {
      key: 'university',
      label: 'Вуз и кампус',
      values: cells((i) => ({ text: `${i.universityShortName}, ${i.city}` })),
    },
    {
      key: 'intake',
      label: 'Кампания и путь подачи',
      values: cells((i) => ({ text: `${i.intake.label} · ${i.path.label}` })),
    },
    {
      key: 'fit',
      label: 'Совпадение с вашими фильтрами',
      values: cells((i) =>
        i.assessment.matchKind === 'preferred'
          ? { text: 'Попадает в выбранные направления и страны', tone: 'good' }
          : {
              text: `Альтернатива: вне ваших фильтров (${i.assessment.preference.outsideFilters.join(', ')})`,
              tone: 'neutral',
            },
      ),
    },
    {
      key: 'access',
      label: 'Доступность пути подачи',
      values: cells((i) => {
        const access = i.assessment.access;
        if (access.status === 'allowed') return { text: 'Открыт для вашей категории', tone: 'good' };
        if (access.status === 'blocked') {
          return { text: access.message ?? 'Закрыт', tone: 'bad' };
        }
        return { text: access.message ?? 'Нужно уточнение', unknown: true, tone: 'neutral' };
      }),
    },
    {
      key: 'eligibility',
      label: 'Известные формальные условия',
      values: cells((i) => ({
        text: ELIGIBILITY_LABEL_RU[i.assessment.eligibility],
        tone:
          i.assessment.eligibility === 'conditions_met'
            ? 'good'
            : i.assessment.eligibility === 'blocked'
              ? 'bad'
              : i.assessment.eligibility === 'undetermined'
                ? 'neutral'
                : 'warn',
        unknown: i.assessment.eligibility === 'undetermined',
      })),
    },
    {
      key: 'gaps',
      label: 'Пробелы и неизвестное',
      values: cells((i) => {
        const c = i.assessment.counts;
        const parts = [`выполнено ${c.MET}`, `пробелов ${c.NOT_MET}`];
        if (c.UNKNOWN > 0) parts.push(`неизвестно ${c.UNKNOWN}`);
        if (c.CONFLICT > 0) parts.push(`конфликтов ${c.CONFLICT}`);
        return {
          text: parts.join(', '),
          unknown: c.UNKNOWN > 0 || c.CONFLICT > 0,
          tone: c.NOT_MET === 0 && c.UNKNOWN === 0 ? 'good' : 'neutral',
        };
      }),
    },
    {
      key: 'data_quality',
      label: 'Качество данных',
      values: cells((i) => ({
        text: DATA_QUALITY_RU[i.assessment.dataQuality],
        unknown: i.assessment.dataQuality === 'stale' || i.assessment.dataQuality === 'conflict',
        tone:
          i.assessment.dataQuality === 'conflict'
            ? 'bad'
            : i.assessment.dataQuality === 'stale'
              ? 'warn'
              : 'neutral',
      })),
    },
    {
      key: 'cost',
      label: 'Обязательные расходы',
      values: cells((i) => {
        const total = totalMandatoryCost(i.path, currency, fx);
        if (total.min === 0n && total.max === 0n && total.incomplete) {
          return { text: 'Суммы не опубликованы источником', unknown: true };
        }
        const range =
          total.min === total.max
            ? formatMoneyRu({ amountMinor: total.min, currency })
            : `${formatMoneyRu({ amountMinor: total.min, currency })} — ${formatMoneyRu({ amountMinor: total.max, currency })}`;
        // Неполная сумма не называется полной стоимостью.
        return {
          text: total.incomplete ? `${range}, часть сумм неизвестна` : range,
          unknown: total.incomplete,
        };
      }),
    },
    {
      key: 'budget',
      label: 'Совместимость с вашим бюджетом',
      values: cells((i) => budgetCell(i.assessment.financial)),
    },
    {
      key: 'funding',
      label: 'Финансирование',
      values: cells((i) =>
        i.path.funding.length === 0
          ? { text: 'Не предусмотрено на этом пути подачи' }
          : { text: i.path.funding.map((f) => f.label).join('; ') },
      ),
    },
    {
      key: 'deadline',
      label: 'Ближайшая внешняя отсечка',
      values: cells((i) => {
        const dls = [...i.intake.deadlines, ...i.path.deadlines];
        if (dls.length === 0) return { text: 'Дата не опубликована', unknown: true };
        const withCutoff = dls
          .map((d) => ({ d, c: conservativeCutoff(d) }))
          .filter((x): x is { d: (typeof dls)[number]; c: { utc: string; uncertain: boolean } } => x.c !== null)
          .sort((a, b) => (a.c.utc < b.c.utc ? -1 : 1));
        const first = withCutoff[0];
        if (!first) return { text: 'Дата не определена источником', unknown: true };
        const shown = first.d.localDate ? formatPlainDateRu(first.d.localDate) : null;
        if (!shown) return { text: 'Дата не опубликована', unknown: true };
        return {
          text: first.c.uncertain ? `${shown}, время не указано источником` : shown,
          unknown: first.c.uncertain,
        };
      }),
    },
    {
      key: 'language',
      label: 'Язык обучения',
      values: cells((i) => ({
        text: i.instructionLanguages.map((l) => languageRu(l)).join(', '),
      })),
    },
    {
      key: 'duration',
      label: 'Длительность',
      values: cells((i) => ({ text: countRu(i.durationYears, FORMS_YEAR) })),
    },
  ];
}

function budgetCell(verdict: BudgetVerdict): ComparisonCell {
  switch (verdict.kind) {
    case 'compatible_in_known_range':
      return { text: 'Укладывается в указанный бюджет', tone: 'good' };
    case 'known_gap':
      return { text: `Не хватает ${formatMoneyRu(verdict.shortfall)}`, tone: 'bad' };
    case 'needs_clarification':
      return { text: BUDGET_UNCLEAR_RU[verdict.reason], unknown: true, tone: 'neutral' };
  }
}

const DATA_QUALITY_RU: Record<ProgramAssessment['dataQuality'], string> = {
  verified: 'Проверено источником',
  self_reported: 'С ваших слов',
  stale: 'Требует перепроверки',
  conflict: 'Источники расходятся',
  demo: 'Условия ориентировочные — проверьте у вуза',
};

const BUDGET_UNCLEAR_RU: Record<
  Extract<BudgetVerdict, { kind: 'needs_clarification' }>['reason'],
  string
> = {
  range_crosses_budget: 'Диапазон стоимости пересекает границу бюджета',
  unknown_mandatory_category: 'Не вся обязательная стоимость известна',
  no_fx_rate: 'Нет пригодного курса для сравнения валют',
  scope_mismatch: 'Бюджет задан только на обучение, а расходы шире',
  period_mismatch: 'Периоды бюджета и стоимости не сопоставимы',
};

export function totalMandatoryCost(path: AdmissionPath, to: Money['currency'], fx: readonly FxRate[]) {
  let min = 0n;
  let max = 0n;
  let incomplete = false;
  for (const c of path.costs) {
    if (!c.mandatory) continue;
    const a = convert(c.min, to, fx);
    const b = convert(c.max, to, fx);
    if (!a.ok || !b.ok) {
      incomplete = true;
      continue;
    }
    min += a.value.amountMinor;
    max += b.value.amountMinor;
    if (c.isEstimate) incomplete = true;
  }
  return { min, max, incomplete, currency: to };
}
