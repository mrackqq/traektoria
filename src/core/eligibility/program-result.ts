/**
 * Результат по программе.
 *
 * Измерения не сводятся в «шанс поступления» — они остаются раздельными.
 * Но интерфейсу нужен один порядок показа, поэтому здесь задано явное правило
 * композиции измерений в бакет показа и детерминированный ключ сортировки.
 *
 * Отдельно от бакета живёт `matchKind`: попадает ли вариант в выбранные
 * пользователем направления и страны. Это МЯГКОЕ предпочтение — оно меняет
 * группу показа и порядок, но никогда не делает нарушенное обязательное
 * условие выполненным и никогда не выбрасывает вариант из выдачи.
 */

import type { ReqStatus } from '../kernel/status';
import type { BudgetVerdict } from '../kernel/money';
import type { EvaluatedNode } from './evaluate';
import { countByStatus, flattenLeaves } from './evaluate';

/** Статус формальных условий. */
export type EligibilityStatus =
  | 'conditions_met'
  | 'gaps_identified'
  | 'blocked'
  | 'undetermined';

export const ELIGIBILITY_LABEL_RU: Record<EligibilityStatus, string> = {
  // Подпись именно такая: «поступление» здесь не обещается.
  conditions_met: 'Известные формальные условия соответствуют указанным данным',
  gaps_identified: 'Есть устранимые пробелы',
  blocked: 'Есть жёсткое препятствие',
  undetermined: 'Не определено: не хватает проверенных данных',
};

/** Качество данных как отдельное измерение. */
export type DataQuality = 'verified' | 'self_reported' | 'stale' | 'conflict' | 'demo';

/** Планируемость приходит из планировщика и не смешивается с условиями. */
export type PlanningStatus =
  | 'feasible_under_assumptions'
  | 'infeasible_under_assumptions'
  | 'undetermined'
  | 'search_incomplete'
  | 'not_computed';

/** Бакет показа. Программы с существенными неизвестными — отдельно. */
export type ProgramBucket = 'recommended' | 'needs_verification' | 'not_suitable';

export const BUCKET_LABEL_RU: Record<ProgramBucket, string> = {
  recommended: 'Подходит',
  needs_verification: 'Требует проверки',
  not_suitable: 'Сейчас не подходит',
};

/* ------------------------------------------------------------------ */
/* Жёсткие ограничения доступа                                         */
/* ------------------------------------------------------------------ */

/**
 * Доступность пути подачи, проверяемая ДО оценки дерева требований.
 *
 * Дерева недостаточно: ограничение по категории заявителя и год кампании
 * лежат на самой кампании и пути подачи, а не в условиях. Пока это не
 * проверялось, иностранный заявитель получал путь «только для граждан РК»
 * в основной группе, а выбор 2028 года молча давал набор 2027.
 */
export type AccessCode =
  | 'CATEGORY_NOT_ALLOWED'
  | 'CATEGORY_UNKNOWN'
  | 'YEAR_MISMATCH'
  | 'YEAR_UNKNOWN';

export interface AccessCheck {
  readonly status: 'allowed' | 'blocked' | 'needs_input';
  readonly code?: AccessCode;
  /** Человеческая формулировка: почему путь закрыт или что уточнить. */
  readonly message?: string;
}

export const ACCESS_ALLOWED: AccessCheck = { status: 'allowed' };

/* ------------------------------------------------------------------ */
/* Мягкие предпочтения                                                 */
/* ------------------------------------------------------------------ */

/** Совпадает ли вариант с выбранными направлениями и странами. */
export type MatchKind = 'preferred' | 'alternative';

export interface PreferenceMatch {
  /** Мягкое соответствие предпочтениям, 0…1. Жёсткие условия не трогает. */
  readonly score: number;
  readonly interestMatched: boolean;
  readonly countryMatched: boolean;
  readonly languageMatched: boolean;
  readonly fundingAvailable: boolean;
  /** Какие именно выбранные фильтры вариант не проходит. Пусто — проходит все. */
  readonly outsideFilters: readonly string[];
}

export interface ProgramAssessment {
  readonly programId: string;
  readonly intakeId: string;
  readonly admissionPathId: string;

  /** Раздельные измерения. */
  readonly eligibility: EligibilityStatus;
  readonly dataQuality: DataQuality;
  readonly financial: BudgetVerdict;
  readonly planning: PlanningStatus;
  readonly access: AccessCheck;
  readonly preference: PreferenceMatch;
  readonly matchKind: MatchKind;

  readonly bucket: ProgramBucket;
  readonly tree: EvaluatedNode;
  readonly counts: Record<ReqStatus | 'NOT_APPLICABLE', number>;
  /** Для неподходящего варианта сохраняется объяснение исключения. */
  readonly exclusionReason?: string;
  readonly reasons: readonly string[];
}

/**
 * Статус условий из корня дерева.
 *
 * Невыполненный лист — текущий пробел, а не автоматически невозможность.
 * Жёсткое препятствие определяется отдельно: это условия, которые пользователь
 * не может изменить подготовкой (категория заявителя, уровень образования).
 */
export function deriveEligibility(root: EvaluatedNode): {
  status: EligibilityStatus;
  hardObstacles: EvaluatedNode[];
} {
  if (root.outcome.kind === 'not_applicable') {
    return { status: 'undetermined', hardObstacles: [] };
  }

  const leaves = flattenLeaves(root);
  const hardObstacles = leaves.filter(
    (l) =>
      l.outcome.kind === 'evaluated' &&
      l.outcome.status === 'NOT_MET' &&
      (l.reasonCodes.includes('CATEGORY_MISMATCH') ||
        l.reasonCodes.includes('EDUCATION_LEVEL_MISMATCH')),
  );

  if (hardObstacles.length > 0) return { status: 'blocked', hardObstacles };

  switch (root.outcome.status) {
    case 'MET':
      return { status: 'conditions_met', hardObstacles: [] };
    case 'NOT_MET':
      return { status: 'gaps_identified', hardObstacles: [] };
    // При конфликте источников положительное заключение запрещено.
    case 'CONFLICT':
    case 'UNKNOWN':
      return { status: 'undetermined', hardObstacles: [] };
  }
}

export function deriveDataQuality(root: EvaluatedNode, isDemo: boolean): DataQuality {
  if (isDemo) return 'demo';
  const leaves = flattenLeaves(root);
  if (leaves.some((l) => l.reasonCodes.includes('SOURCE_CONFLICT'))) return 'conflict';
  if (
    leaves.some(
      (l) =>
        l.reasonCodes.includes('SOURCE_STALE_CRITICAL') ||
        l.reasonCodes.includes('SOURCE_RETRACTED'),
    )
  ) {
    return 'stale';
  }
  const metLeaves = leaves.filter(
    (l) => l.outcome.kind === 'evaluated' && l.outcome.status === 'MET',
  );
  if (metLeaves.length > 0 && metLeaves.every((l) => l.provenance === 'institution_verified')) {
    return 'verified';
  }
  return 'self_reported';
}

/**
 * Правило композиции измерений в бакет показа.
 *
 * Композиция определяет только БАКЕТ ПОКАЗА. Измерения остаются раздельными
 * в `ProgramAssessment`, и ни одно из них не превращается в «шанс поступления».
 */
export function deriveBucket(input: {
  eligibility: EligibilityStatus;
  dataQuality: DataQuality;
  financial: BudgetVerdict;
  planning: PlanningStatus;
  access: AccessCheck;
  counts: Record<ReqStatus | 'NOT_APPLICABLE', number>;
}): { bucket: ProgramBucket; exclusionReason?: string } {
  const { eligibility, dataQuality, financial, planning, access, counts } = input;

  // Жёсткое ограничение доступа проверяется раньше условий: путь, закрытый
  // для категории заявителя или относящийся к другому году набора, не может
  // оказаться в основной группе из-за хорошо закрытого дерева требований.
  if (access.status === 'blocked') {
    return {
      bucket: 'not_suitable',
      exclusionReason: access.message ?? 'Этот путь подачи вам сейчас недоступен.',
    };
  }

  if (eligibility === 'blocked') {
    return { bucket: 'not_suitable', exclusionReason: 'Есть условие, которое нельзя выполнить подготовкой.' };
  }
  if (planning === 'infeasible_under_assumptions') {
    return {
      bucket: 'not_suitable',
      exclusionReason: 'Подготовка не укладывается в сроки ни по одному рассмотренному пути.',
    };
  }
  // Известный финансовый разрыв — это известный факт, а не неизвестность.
  if (financial.kind === 'known_gap') {
    return {
      bucket: 'not_suitable',
      exclusionReason: 'Обязательные расходы превышают указанный бюджет по известному диапазону.',
    };
  }

  if (access.status === 'needs_input') return { bucket: 'needs_verification' };

  // Конфликт и устаревшее критическое условие не дают положительного
  // заключения — программа уходит в «требует проверки».
  if (dataQuality === 'conflict' || dataQuality === 'stale') {
    return { bucket: 'needs_verification' };
  }
  if (eligibility === 'undetermined') return { bucket: 'needs_verification' };
  if (counts.UNKNOWN > 0 || counts.CONFLICT > 0) return { bucket: 'needs_verification' };
  if (financial.kind === 'needs_clarification') return { bucket: 'needs_verification' };

  return { bucket: 'recommended' };
}

/**
 * Детерминированный порядок.
 *
 * Мягкие предпочтения влияют только на ранжирование и никогда не делают
 * нарушенное обязательное условие выполненным. Порядок ключей:
 * бакет → попадание в выбранные направления и страны → состояние условий →
 * число открытых пробелов → остальные предпочтения → идентификатор.
 */
export function compareAssessments(a: ProgramAssessment, b: ProgramAssessment): number {
  const bucketRank: Record<ProgramBucket, number> = {
    recommended: 0,
    needs_verification: 1,
    not_suitable: 2,
  };
  if (bucketRank[a.bucket] !== bucketRank[b.bucket]) {
    return bucketRank[a.bucket] - bucketRank[b.bucket];
  }

  const matchRank: Record<MatchKind, number> = { preferred: 0, alternative: 1 };
  if (matchRank[a.matchKind] !== matchRank[b.matchKind]) {
    return matchRank[a.matchKind] - matchRank[b.matchKind];
  }

  const eligRank: Record<EligibilityStatus, number> = {
    conditions_met: 0,
    gaps_identified: 1,
    undetermined: 2,
    blocked: 3,
  };
  if (eligRank[a.eligibility] !== eligRank[b.eligibility]) {
    return eligRank[a.eligibility] - eligRank[b.eligibility];
  }

  // Меньше открытых пробелов — выше.
  const aGaps = a.counts.NOT_MET + a.counts.UNKNOWN + a.counts.CONFLICT;
  const bGaps = b.counts.NOT_MET + b.counts.UNKNOWN + b.counts.CONFLICT;
  if (aGaps !== bGaps) return aGaps - bGaps;

  if (a.preference.score !== b.preference.score) return b.preference.score - a.preference.score;

  // Детерминированный tie-break.
  return a.admissionPathId.localeCompare(b.admissionPathId);
}

export function assessmentCounts(root: EvaluatedNode) {
  return countByStatus(root);
}
