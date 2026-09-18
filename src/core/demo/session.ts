/**
 * Сборка пользовательского пути целиком: профиль → условия → подбор →
 * диагностика → мост → прогресс → ближайшее действие.
 *
 * Это единственное место, где модули ядра соединяются. Интерфейс не считает
 * ничего сам: страницы читают готовый снимок.
 *
 * Часы приходят параметром, `Date.now()` здесь нет. Прикладной слой передаёт
 * реальные часы; фиксированный `DEMO_CLOCK` остаётся для воспроизводимых
 * тестов и явно обозначенной демонстрации.
 */

import { buildSeedCatalog } from '../catalog/seed';
import {
  catalogScopeHash,
  FRESHNESS_POLICY_DAYS,
  NEAR_DEADLINE_POLICY_DAYS,
  NEAR_DEADLINE_WINDOW_DAYS,
  type AdmissionPath,
  type CatalogSnapshot,
  type Intake,
  type Program,
  type University,
} from '../catalog/types';
import {
  computeCalculationKey,
  expiryBoundary,
  type CalculationKey,
  type ValidityBoundary,
} from '../kernel/reproducibility';
import { conservativeCutoff, daysBetween, isUncertain } from '../kernel/time';
import { DEFAULT_SEARCH_LIMITS } from '../planning/satisfaction';
import { valueOf, type ApplicantProfileRevision } from '../kernel/profile';
import type { Deadline, PlanningClock } from '../kernel/time';
import { utcMsToPlainDate } from '../kernel/time';
import { DEMO_FX_RATES, recommend, type RecommendationResult } from '../eligibility/recommend';
import type { ProgramAssessment } from '../eligibility/program-result';
import { buildBridge, type BridgeResult, type BridgeRoute } from '../planning/bridge';
import {
  examProgressFromProfile,
  mergeTaskOverrides,
  profilePlanningWarnings,
  profileTaskOverrides,
} from '../planning/profile-constraints';
import { advisoryKeysForField } from '../planning/tasks-library';
import { initProgress, seedFromPlanned, type ProgressState } from '../progress/state';
import {
  buildTaskViews,
  selectNextAction,
  type NextActionOutcome,
  type TaskView,
} from '../progress/next-action';
import { computeCounters, type ProgressCounters } from '../progress/counters';
import { buildDiagnosis, type Diagnosis } from '../profile/diagnosis';
import { isProfileStarted } from './profile';

/** Фиксированные часы для воспроизводимых тестов и записи демонстрации. */
export const DEMO_CLOCK: PlanningClock = {
  now: '2026-09-18T06:00:00Z',
  timezone: 'Asia/Almaty',
};

/** Программа со всем контекстом, который нужен карточке. */
export interface GoalContext {
  readonly assessment: ProgramAssessment;
  readonly program: Program;
  readonly university: University;
  readonly intake: Intake;
  readonly path: AdmissionPath;
  readonly deadlines: readonly Deadline[];
}

/** Откуда взялась активная цель. */
export type ActiveGoalSource = 'chosen' | 'auto' | 'none';

/**
 * Почему сохранённая цель требует внимания.
 *
 * Выбранная пользователем цель НЕ переключается автоматически: она остаётся
 * активной, даже если перестала проходить по условиям. Вместо тихой подмены
 * показывается причина и предлагается выбор.
 */
export interface ActiveGoalIssue {
  readonly code: 'NOT_IN_CATALOG' | 'BLOCKED' | 'NEEDS_VERIFICATION' | 'OUTSIDE_FILTERS';
  readonly message: string;
}

export interface SessionSnapshot {
  readonly clock: PlanningClock;
  readonly today: string;
  /** Чем воспроизводится этот расчёт и до какого момента он годен. */
  readonly key: CalculationKey;
  readonly catalog: CatalogSnapshot;
  readonly profile: ApplicantProfileRevision;
  /** Заполнена ли анкета настолько, чтобы подбор имел смысл. */
  readonly profileStarted: boolean;
  readonly recommendation: RecommendationResult;
  readonly diagnosis: Diagnosis;
  readonly goals: readonly GoalContext[];
  /** Активная цель. null — подходящих путей в каталоге нет вовсе. */
  readonly activeGoal: GoalContext | null;
  readonly activeGoalSource: ActiveGoalSource;
  readonly activeGoalIssue: ActiveGoalIssue | null;
  readonly bridge: BridgeResult | null;
  readonly route: BridgeRoute | null;
  readonly progress: ProgressState;
  readonly taskViews: readonly TaskView[];
  readonly nextAction: NextActionOutcome;
  readonly counters: ProgressCounters;
}

export interface SessionInput {
  readonly profile: ApplicantProfileRevision;
  readonly clock?: PlanningClock;
  /** Сохранённая цель пользователя. Не задана — берётся лучшая по ранжированию. */
  readonly activePathId?: string;
  /** Уже накопленный прогресс. Не задан — маршрут считается с нуля. */
  readonly progress?: ProgressState;
}

export function buildSession(input: SessionInput): SessionSnapshot {
  const clock = input.clock ?? DEMO_CLOCK;
  const today = utcMsToPlainDate(Date.parse(clock.now));
  const catalog = buildSeedCatalog(clock.now);

  const recommendation = recommend({ profile: input.profile, catalog, clock });
  const goals = recommendation.assessments
    .map((a) => contextFor(catalog, a))
    .filter((g): g is GoalContext => g !== null);

  const diagnosis = buildDiagnosis({ profile: input.profile, recommendation, catalog, today });

  const chosen = input.activePathId
    ? goals.find((g) => g.path.id === input.activePathId)
    : undefined;

  /**
   * Автовыбор цели.
   *
   * Берём только то, что расчёт действительно считает доступным: сначала
   * подходящее по фильтрам, затем подходящее по условиям вне фильтров, затем
   * требующее проверки. Исключённый вариант (`not_suitable`) автоматической
   * целью не становится НИКОГДА — иначе профиль с годом, на который кампаний
   * нет, молча получал маршрут к прошлогоднему набору.
   *
   * Изменение рейтинга сохранённую цель не переключает: автовыбор работает
   * только когда пользователь ещё ничего не выбрал сам.
   */
  const profileStarted = isProfileStarted(input.profile);

  const autoCandidate = !profileStarted
    ? // Нет ответов — нет и персональной цели. Пустая анкета не должна
      // выглядеть как посчитанный под человека результат.
      null
    : goals.find((g) => g.assessment.bucket === 'recommended' && g.assessment.matchKind === 'preferred') ??
      goals.find((g) => g.assessment.bucket === 'recommended') ??
      goals.find((g) => g.assessment.bucket === 'needs_verification') ??
      null;

  const activeGoal = chosen ?? (input.activePathId ? null : autoCandidate);
  const activeGoalSource: ActiveGoalSource = chosen ? 'chosen' : activeGoal ? 'auto' : 'none';
  const activeGoalIssue = describeGoalIssue(input.activePathId, chosen ?? null, activeGoal, activeGoalSource);

  const key = calculationKey(catalog, input.profile, clock.now, activeGoal);

  if (!activeGoal) {
    const progress = input.progress ?? initProgress(input.profile.ownerId, 'none', []);
    return {
      clock,
      today,
      key,
      catalog,
      profile: input.profile,
      profileStarted,
      recommendation,
      diagnosis,
      goals,
      activeGoal: null,
      activeGoalSource,
      activeGoalIssue,
      bridge: null,
      route: null,
      progress,
      taskViews: [],
      // Состояние «целей нет»: объяснение обязательно и здесь.
      nextAction: selectNextAction({ views: [], today, weeklyHours: null }),
      counters: computeCounters(progress, null),
    };
  }

  const weeklyHours = valueOf(input.profile.weeklyHours) ?? null;
  const bridge = buildBridge({
    programId: activeGoal.program.id,
    intakeId: activeGoal.intake.id,
    admissionPathId: activeGoal.path.id,
    evaluation: activeGoal.assessment.tree,
    deadlines: activeGoal.deadlines,
    clock,
    weeklyHours,
    // Факты профиля ограничивают план: аттестат не раньше выпуска,
    // уже сданный экзамен заново не назначается.
    examProgress: examProgressFromProfile(input.profile),
    taskOverrides: profileTaskOverrides(input.profile, today),
    warnings: profilePlanningWarnings(input.profile),
    advisoryKeys: advisoryKeysForField(activeGoal.program.field),
  });

  const route = bridge.routes[0] ?? null;
  const tasks = route?.tasks ?? [];
  const progress =
    input.progress ??
    initProgress(input.profile.ownerId, activeGoal.path.id, tasks.map(seedFromPlanned));

  const taskViews = buildTaskViews(tasks, progress, today);

  return {
    clock,
    today,
    key,
    catalog,
    profile: input.profile,
    profileStarted,
    recommendation,
    diagnosis,
    goals,
    activeGoal,
    activeGoalSource,
    activeGoalIssue,
    bridge,
    route,
    progress,
    taskViews,
    nextAction: selectNextAction({
      views: taskViews,
      today,
      weeklyHours,
      evaluation: activeGoal.assessment.tree,
    }),
    counters: computeCounters(progress, activeGoal.assessment.tree),
  };
}

/**
 * Что не так с сохранённой целью.
 *
 * Цель остаётся выбранной пользователем; задача этой функции — честно
 * назвать причину и дать повод предложить выбор, а не подменить цель молча.
 */
function describeGoalIssue(
  requestedId: string | undefined,
  chosen: GoalContext | null,
  active: GoalContext | null,
  source: ActiveGoalSource,
): ActiveGoalIssue | null {
  // Автоматически выбранный вариант с неизвестными условиями — не
  // подтверждённая рекомендация, и выглядеть ею он не должен.
  if (!requestedId) {
    if (source === 'auto' && active?.assessment.bucket === 'needs_verification') {
      return {
        code: 'NEEDS_VERIFICATION',
        message:
          'Это предварительный выбор: по варианту есть неизвестные или противоречивые условия, ' +
          'поэтому он показан как требующий проверки, а не как подтверждённая рекомендация. ' +
          'Уточните данные или выберите цель сами.',
      };
    }
    return null;
  }

  if (!chosen) {
    return {
      code: 'NOT_IN_CATALOG',
      message:
        'Сохранённой цели больше нет в каталоге: кампания могла закрыться или изменился ' +
        'год набора. Выберите цель заново — прежний прогресс по ней сохранён.',
    };
  }

  const a = chosen.assessment;
  if (a.bucket === 'not_suitable') {
    return {
      code: 'BLOCKED',
      message:
        `Выбранная цель сейчас не подходит. ${a.exclusionReason ?? ''} ` +
        'Цель осталась активной: переключать её за вас мы не будем — решите сами.',
    };
  }
  if (a.bucket === 'needs_verification') {
    return {
      code: 'NEEDS_VERIFICATION',
      message:
        'По выбранной цели есть неизвестные или противоречивые условия. Маршрут построен, ' +
        'но положительный вывод по этим пунктам не делается, пока они не уточнены.',
    };
  }
  if (a.matchKind === 'alternative') {
    return {
      code: 'OUTSIDE_FILTERS',
      message:
        `Выбранная цель лежит за пределами ваших фильтров (${a.preference.outsideFilters.join(', ')}). ` +
        'Это допустимо: цель выбрали вы, и она остаётся активной.',
    };
  }
  return null;
}

function contextFor(catalog: CatalogSnapshot, a: ProgramAssessment): GoalContext | null {
  const program = catalog.programs.find((p) => p.id === a.programId);
  const intake = catalog.intakes.find((i) => i.id === a.intakeId);
  const path = catalog.paths.find((p) => p.id === a.admissionPathId);
  if (!program || !intake || !path) return null;
  const university = catalog.universities.find((u) => u.id === program.universityId);
  if (!university) return null;

  return {
    assessment: a,
    program,
    university,
    intake,
    path,
    // Планируем от КАЖДОЙ внешней отсечки — и кампании, и пути подачи.
    deadlines: [...intake.deadlines, ...path.deadlines],
  };
}

/* ------------------------------------------------------------------ */
/* Ключ воспроизводимости                                              */
/* ------------------------------------------------------------------ */

/**
 * Отпечаток политик: всё, что меняет результат при неизменных данных.
 * Если поменять лимит перебора или курс валюты, хэш обязан измениться —
 * иначе старый расчёт будет выглядеть пригодным к применению.
 */
const POLICY_FINGERPRINT = {
  searchLimits: DEFAULT_SEARCH_LIMITS,
  calendar: 'KZ',
  freshnessPolicyDays: FRESHNESS_POLICY_DAYS,
  nearDeadlineWindowDays: NEAR_DEADLINE_WINDOW_DAYS,
  nearDeadlinePolicyDays: NEAR_DEADLINE_POLICY_DAYS,
  fxRates: DEMO_FX_RATES,
};

function calculationKey(
  catalog: CatalogSnapshot,
  profile: ApplicantProfileRevision,
  nowUtc: string,
  activeGoal: GoalContext | null,
): CalculationKey {
  const readPathIds = catalog.paths.map((p) => p.id);
  const boundaries: ValidityBoundary[] = [];
  const unknown: string[] = [];

  // Граница свежести источников: с какого момента данные, на которых построен
  // вывод, потребуют перепроверки.
  const nearest = activeGoal ? nearestCertainCutoff(activeGoal.deadlines) : null;
  for (const source of catalog.sources) {
    const verified = Date.parse(source.verifiedAt);
    if (Number.isNaN(verified)) continue;
    const nearDeadline =
      nearest !== null && daysBetween(utcMsToPlainDate(Date.parse(nowUtc)), nearest) <= NEAR_DEADLINE_WINDOW_DAYS;
    const policyDays = nearDeadline
      ? NEAR_DEADLINE_POLICY_DAYS
      : FRESHNESS_POLICY_DAYS[source.dataKind];
    boundaries.push({
      atUtc: new Date(verified + policyDays * 86_400_000).toISOString(),
      reason: { kind: 'source_freshness', sourceId: source.id },
    });
  }

  // Граница действительности результатов.
  for (const exam of profile.exams) {
    if (exam.validUntil) boundaries.push(expiryBoundary(exam.examKind, exam.validUntil));
  }

  // Внешние отсечки: только определённые. Неполную дату в границу
  // не превращаем — нужно предупреждение, а не выдуманный момент.
  for (const d of activeGoal?.deadlines ?? []) {
    const cutoff = conservativeCutoff(d);
    if (cutoff && !isUncertain(d)) {
      boundaries.push({ atUtc: cutoff.utc, reason: { kind: 'external_deadline', deadlineId: d.id } });
    } else if (isUncertain(d)) {
      unknown.push(`Отсечка ${d.id} известна не полностью — срок годности по ней не считается`);
    }
  }

  return computeCalculationKey({
    profileId: profile.id,
    profileRevision: profile.revision,
    admissionPathIds: readPathIds,
    catalogScopeHash: catalogScopeHash(catalog, readPathIds),
    policyFingerprint: POLICY_FINGERPRINT,
    calculatedAt: nowUtc,
    boundaries,
    unknownBoundaries: unknown,
  });
}

function nearestCertainCutoff(deadlines: readonly Deadline[]): string | null {
  const dates = deadlines
    .filter((d) => !isUncertain(d))
    .map((d) => conservativeCutoff(d))
    .filter((c): c is { utc: string; uncertain: boolean } => c !== null)
    .map((c) => utcMsToPlainDate(Date.parse(c.utc)))
    .sort();
  return dates[0] ?? null;
}
