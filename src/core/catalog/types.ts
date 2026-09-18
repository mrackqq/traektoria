/**
 * DATA-01…DATA-09 — каталог образовательных данных.
 *
 * DATA-01: условия разных кампаний, категорий заявителя, кампусов, языков
 * и грантового/платного путей нельзя объединять в один универсальный набор.
 * Поэтому требования висят на AdmissionPath внутри Intake, а не на Program.
 */

import { fnv1a } from '../kernel/hash';
import type { CostRange, Money } from '../kernel/money';
import type { RequirementGroup } from '../kernel/requirement';
import type { Deadline, PlainDate } from '../kernel/time';
import type { FundingState } from '../kernel/profile';

/* ------------------------------------------------------------------ */
/* Источники и свежесть (DATA-02, DATA-05, DATA-06)                    */
/* ------------------------------------------------------------------ */

export type FreshnessState = 'fresh' | 'stale' | 'retracted';

export const FRESHNESS_LABEL_RU: Record<FreshnessState, string> = {
  fresh: 'проверено',
  stale: 'требует перепроверки',
  retracted: 'отозвано',
};

/** Тип данных определяет интервал перепроверки (DATA-05). */
export type SourceDataKind = 'deadline' | 'mandatory_requirement' | 'cost' | 'funding' | 'general';

/** DATA-05: проектная политика свежести, настраиваемая по типу данных. */
export const FRESHNESS_POLICY_DAYS: Record<SourceDataKind, number> = {
  deadline: 7,
  mandatory_requirement: 7,
  cost: 30,
  funding: 30,
  general: 30,
};

/** DATA-05: за 30 дней до известного дедлайна интервал сжимается до суток. */
export const NEAR_DEADLINE_WINDOW_DAYS = 30;
export const NEAR_DEADLINE_POLICY_DAYS = 1;

export interface Source {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly publisher: string;
  readonly dataKind: SourceDataKind;
  /** Время извлечения (DATA-02). */
  readonly retrievedAt: string;
  /** Время последней успешной проверки. Недоступность сайта его не обновляет (DATA-05). */
  readonly verifiedAt: string;
  readonly verifiedBy: string;
  readonly freshness: FreshnessState;
  /**
   * DATA-08: демонстрационный контур изолирован и всегда промаркирован.
   * Синтетические источники не маскируются под настоящие.
   */
  readonly isDemo: boolean;
  /** DATA-02: разрешённый снимок или контрольная сумма. */
  readonly snapshotChecksum?: string;
  readonly excerpt?: string;
}

/**
 * DATA-04: при конфликте официальных источников условие получает CONFLICT.
 * Источник не выбирается молча по удобному значению.
 */
export interface SourceConflict {
  readonly id: string;
  /** Узел дерева требований или идентификатор дедлайна/расхода. */
  readonly targetId: string;
  readonly description: string;
  readonly versions: readonly { readonly sourceId: string; readonly claim: string }[];
  readonly openedAt: string;
}

/* ------------------------------------------------------------------ */
/* Каталог                                                             */
/* ------------------------------------------------------------------ */

export interface University {
  readonly id: string;
  readonly name: string;
  readonly shortName: string;
  readonly country: string;
  readonly city: string;
  readonly website: string;
  readonly isDemo: boolean;
}

export type StudyField =
  | 'computer_science'
  | 'engineering'
  | 'business'
  | 'medicine'
  | 'natural_sciences'
  | 'social_sciences'
  | 'arts_design'
  | 'law'
  | 'education';

export const STUDY_FIELD_LABEL_RU: Record<StudyField, string> = {
  computer_science: 'Информатика и IT',
  engineering: 'Инженерия',
  business: 'Бизнес и экономика',
  medicine: 'Медицина',
  natural_sciences: 'Естественные науки',
  social_sciences: 'Социальные науки',
  arts_design: 'Искусство и дизайн',
  law: 'Право',
  education: 'Образование',
};

export interface Program {
  readonly id: string;
  readonly universityId: string;
  readonly title: string;
  readonly field: StudyField;
  readonly degreeLevel: 'bachelor';
  readonly instructionLanguages: readonly string[];
  readonly campus: string;
  readonly durationYears: number;
  readonly summary: string;
  readonly isDemo: boolean;
}

/** Кампания приёма. PR-04: цель всегда привязана к кампании и пути подачи. */
export interface Intake {
  readonly id: string;
  readonly programId: string;
  readonly admissionYear: number;
  readonly label: string;
  readonly deadlines: readonly Deadline[];
  /** Контрольная дата, на которую проверяется действительность результатов (AC-06). */
  readonly resultValidityControlDate: PlainDate;
  readonly isDemo: boolean;
}

/** Путь подачи: грант/платное/квота. Условия и стоимость у путей разные (DATA-01). */
export interface AdmissionPath {
  readonly id: string;
  readonly intakeId: string;
  readonly label: string;
  readonly kind: 'grant' | 'paid' | 'quota' | 'scholarship';
  readonly applicantCategories: readonly string[];
  readonly requirementTree: RequirementGroup;
  readonly requirementTreeVersion: number;
  readonly costs: readonly CatalogCostItem[];
  readonly funding: readonly FundingOption[];
  readonly deadlines: readonly Deadline[];
  readonly sourceIds: readonly string[];
  readonly isDemo: boolean;
}

export interface CatalogCostItem extends CostRange {
  readonly id: string;
  readonly label: string;
  readonly category: 'tuition' | 'living' | 'one_time' | 'insurance' | 'exam_fee';
  readonly sourceIds: readonly string[];
  /** DATA-09: неполная сумма не называется «полной стоимостью». */
  readonly isEstimate: boolean;
}

export interface FundingOption {
  readonly id: string;
  readonly label: string;
  readonly amount: Money;
  readonly coverage: 'tuition_full' | 'tuition_partial' | 'stipend' | 'living';
  readonly defaultState: FundingState;
  readonly conditions: string;
  readonly sourceIds: readonly string[];
}

/* ------------------------------------------------------------------ */
/* Снимок каталога                                                     */
/* ------------------------------------------------------------------ */

/**
 * ARCH-03 / MODEL-01: ядро работает только с валидированным снимком.
 *
 * REV-03: ревизия каталога скоупится к множеству фактически прочитанных
 * условий, а не берётся глобальным счётчиком. Глобальный счётчик при политике
 * DATA-05 инкрементируется тысячи раз в сутки и обесценивал бы любой proposal
 * по причине, не связанной с пользователем.
 */
export interface CatalogSnapshot {
  /**
   * Версия опубликованного каталога.
   *
   * Каталог — это опубликованный набор данных, а не мгновенный слепок часов.
   * Пока данные и период обновления те же, версия не меняется. Именно она,
   * а не момент чтения, отвечает на вопрос «тот же ли это каталог».
   */
  readonly version: string;
  /** Начало текущего периода обновления каталога. */
  readonly refreshedAt: string;
  readonly universities: readonly University[];
  readonly programs: readonly Program[];
  readonly intakes: readonly Intake[];
  readonly paths: readonly AdmissionPath[];
  readonly sources: readonly Source[];
  readonly conflicts: readonly SourceConflict[];
  /** Момент чтения. Информационное поле: в хэш входа оно не входит. */
  readonly snapshotAt: string;
}

export function getSource(snap: CatalogSnapshot, id: string): Source | undefined {
  return snap.sources.find((s) => s.id === id);
}

export function getProgram(snap: CatalogSnapshot, id: string): Program | undefined {
  return snap.programs.find((p) => p.id === id);
}

export function getUniversity(snap: CatalogSnapshot, id: string): University | undefined {
  return snap.universities.find((u) => u.id === id);
}

export function getIntake(snap: CatalogSnapshot, id: string): Intake | undefined {
  return snap.intakes.find((i) => i.id === id);
}

export function pathsForIntake(snap: CatalogSnapshot, intakeId: string): AdmissionPath[] {
  return snap.paths.filter((p) => p.intakeId === intakeId);
}

export function intakesForProgram(snap: CatalogSnapshot, programId: string): Intake[] {
  return snap.intakes.filter((i) => i.programId === programId);
}

/** REV-03: детерминированный хэш прочитанной части каталога. */
export function catalogScopeHash(
  snap: CatalogSnapshot,
  readPathIds: readonly string[],
): string {
  // Версия каталога — первая и главная часть скоупа. Раньше сюда попадало
  // только время проверки источников, а оно вычислялось от текущего момента:
  // хэш менялся при каждом запросе, и вместе с ним — ключ кеша объяснений.
  const parts: string[] = [`catalog@${snap.version}`];
  for (const pathId of [...readPathIds].sort()) {
    const path = snap.paths.find((p) => p.id === pathId);
    if (!path) continue;
    parts.push(`${path.id}@${path.requirementTreeVersion}`);
    for (const sid of [...path.sourceIds].sort()) {
      const src = getSource(snap, sid);
      if (src) parts.push(`${src.id}@${src.verifiedAt}@${src.freshness}`);
    }
  }
  return fnv1a(parts.join('|'));
}

// Хэш живёт в ядре (kernel/hash), потому что его использует и прогресс (API-04).
export { fnv1a };

/* ------------------------------------------------------------------ */
/* Свежесть (DATA-05, DATA-06)                                         */
/* ------------------------------------------------------------------ */

/**
 * DATA-06: после истечения срока проверки данные становятся `stale`.
 *
 * REV-12 (открытый вопрос ТЗ): ТЗ не определяет, обновляет ли `verified_at`
 * автоматическая перепроверка, не нашедшая расхождений. Здесь принято
 * работающее решение: `verified_unchanged` — автоматическое событие, оно
 * обновляет verified_at; человеческая проверка по DATA-03 требуется только
 * для ОБНАРУЖЕННОГО изменения. Без этого каталог детерминированно уходит
 * в stale и продукт перестаёт выдавать положительные заключения.
 */
export function computeFreshness(
  source: Source,
  nowIso: string,
  nearestDeadline?: PlainDate,
): FreshnessState {
  if (source.freshness === 'retracted') return 'retracted';

  const verifiedMs = Date.parse(source.verifiedAt);
  const nowMs = Date.parse(nowIso);
  if (Number.isNaN(verifiedMs) || Number.isNaN(nowMs)) return 'stale';

  let policyDays = FRESHNESS_POLICY_DAYS[source.dataKind];
  if (nearestDeadline) {
    const daysToDeadline = Math.round((Date.parse(`${nearestDeadline}T00:00:00Z`) - nowMs) / 86_400_000);
    if (daysToDeadline >= 0 && daysToDeadline <= NEAR_DEADLINE_WINDOW_DAYS) {
      policyDays = NEAR_DEADLINE_POLICY_DAYS;
    }
  }

  const ageDays = (nowMs - verifiedMs) / 86_400_000;
  return ageDays > policyDays ? 'stale' : 'fresh';
}

export function sourceAgeDays(source: Source, nowIso: string): number {
  return Math.max(0, Math.floor((Date.parse(nowIso) - Date.parse(source.verifiedAt)) / 86_400_000));
}
