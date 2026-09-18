/**
 * PF-01…PF-07 — профиль, факты и происхождение данных.
 *
 * §12: раздельные пространства фактов, будущих целей и контрфактических
 * допущений. Гипотеза никогда не записывается в фактический профиль (ST-09).
 */

import type { BudgetConstraint } from './money';
import type { PlainDate } from './time';

/** PF-05: происхождение каждого существенного сведения. */
export type Provenance = 'self_reported' | 'institution_verified' | 'demo';

export const PROVENANCE_LABEL_RU: Record<Provenance, string> = {
  self_reported: 'со слов пользователя',
  institution_verified: 'подтверждено организацией',
  demo: 'демонстрационные данные',
};

/**
 * PF-02: различаем отсутствующее значение, «не знаю», «не применимо» и ноль.
 * Это НЕ то же самое, что `undefined`: «не знаю» — осознанный ответ пользователя.
 */
export type Known<T> =
  | { readonly state: 'known'; readonly value: T }
  | { readonly state: 'dont_know' }
  | { readonly state: 'not_applicable' }
  | { readonly state: 'unanswered' };

export const known = <T>(value: T): Known<T> => ({ state: 'known', value });
export const dontKnow = <T>(): Known<T> => ({ state: 'dont_know' });
export const notApplicable = <T>(): Known<T> => ({ state: 'not_applicable' });
export const unanswered = <T>(): Known<T> => ({ state: 'unanswered' });

export function valueOf<T>(k: Known<T> | undefined): T | undefined {
  return k && k.state === 'known' ? k.value : undefined;
}

/* ------------------------------------------------------------------ */
/* Экзамены (PF-04)                                                    */
/* ------------------------------------------------------------------ */

export type ExamState =
  | 'not_taken'
  | 'scheduled'
  | 'taken_awaiting_result'
  | 'result_reported'
  | 'expired';

export const EXAM_STATE_LABEL_RU: Record<ExamState, string> = {
  not_taken: 'не сдавал',
  scheduled: 'записан',
  taken_awaiting_result: 'сдал, жду результат',
  result_reported: 'результат получен',
  expired: 'результат истёк',
};

export interface ExamComponentScore {
  readonly component: string;
  readonly score: number;
}

/**
 * Фактический экзаменационный результат.
 * PF-04: запись на экзамен, сдача и подходящий результат — разные события.
 * Прогнозируемый балл сюда не попадает никогда — он живёт в PlanningTarget.
 */
export interface ExamRecord {
  readonly id: string;
  readonly examKind: string;
  readonly scaleId: string;
  readonly state: ExamState;
  readonly overall?: number;
  readonly components?: readonly ExamComponentScore[];
  /** Дата сдачи. */
  readonly takenOn?: PlainDate;
  /** Дата публикации результата (может отличаться от даты сдачи). */
  readonly resultOn?: PlainDate;
  /** Срок действительности результата — AC-06. */
  readonly validUntil?: PlainDate;
  /** Дата записи, если state = scheduled. */
  readonly scheduledFor?: PlainDate;
  readonly provenance: Provenance;
}

/* ------------------------------------------------------------------ */
/* Профиль                                                             */
/* ------------------------------------------------------------------ */

export interface GradeRecord {
  readonly scaleId: string;
  readonly value: number;
  readonly provenance: Provenance;
}

export interface SubjectRecord {
  readonly subjectId: string;
  readonly score?: number;
  readonly scaleId?: string;
  readonly provenance: Provenance;
}

export interface DocumentRecord {
  readonly documentKind: string;
  readonly obtained: boolean;
  readonly validUntil?: PlainDate;
  readonly provenance: Provenance;
}

export type EducationLevel =
  | 'grade_9'
  | 'grade_10'
  | 'grade_11'
  | 'school_graduate'
  | 'college_student'
  | 'college_graduate';

export const EDUCATION_LEVEL_LABEL_RU: Record<EducationLevel, string> = {
  grade_9: '9 класс',
  grade_10: '10 класс',
  grade_11: '11 класс',
  school_graduate: 'выпускник школы',
  college_student: 'студент колледжа',
  college_graduate: 'выпускник колледжа',
};

/**
 * PF-01 — неизменяемая ревизия профиля (§12 ApplicantProfileRevision).
 * Изменение создаёт новую ревизию, а не перезаписывает старую (MODEL-02).
 */
export interface ApplicantProfileRevision {
  readonly id: string;
  readonly ownerId: string;
  readonly revision: number;
  readonly createdAt: string;
  readonly changeReason: string;

  readonly educationLevel: Known<EducationLevel>;
  readonly expectedGraduation: Known<PlainDate>;
  readonly citizenship: Known<string>;
  readonly applicantCategory: Known<string>;

  readonly interests: readonly string[];
  readonly grades: readonly GradeRecord[];
  readonly subjects: readonly SubjectRecord[];
  readonly languages: readonly { readonly language: string; readonly cefr: string }[];
  readonly exams: readonly ExamRecord[];
  readonly documents: readonly DocumentRecord[];

  readonly targetCountries: readonly string[];
  readonly instructionLanguages: readonly string[];
  readonly admissionYear: Known<number>;
  /** Доступная недельная нагрузка в часах — BR-10 проверяет расписание по ней. */
  readonly weeklyHours: Known<number>;
  readonly budget: Known<BudgetConstraint>;
  readonly constraints: readonly string[];
}

/* ------------------------------------------------------------------ */
/* Цели и допущения (§12, ST-03, ST-09)                                */
/* ------------------------------------------------------------------ */

/**
 * Будущая цель: «планирую получить IELTS 7.0 к марту».
 * Никогда не считается фактом (AC-07, AC-16).
 */
export interface PlanningTarget {
  readonly id: string;
  readonly kind: 'exam_score' | 'document' | 'subject';
  readonly examKind?: string;
  readonly documentKind?: string;
  readonly subjectId?: string;
  readonly targetValue?: number;
  readonly byDate?: PlainDate;
  readonly note?: string;
}

/** Контрфактическое допущение сценария. Живёт только в overlay (ST-03). */
export interface ScenarioAssumption {
  readonly id: string;
  readonly description: string;
}

/** Статусы финансирования (MODEL-05). */
export type FundingState =
  | 'expected'
  | 'applied'
  | 'offered_conditional'
  | 'confirmed'
  | 'received'
  | 'rejected'
  | 'revoked';

export const FUNDING_STATE_LABEL_RU: Record<FundingState, string> = {
  expected: 'ожидается',
  applied: 'подана заявка',
  offered_conditional: 'условное предложение',
  confirmed: 'подтверждено',
  received: 'получено',
  rejected: 'отказано',
  revoked: 'отозвано',
};

/** MODEL-05: в фактическом расчёте учитываются только подтверждённые суммы. */
export function countsAsActualFunding(state: FundingState): boolean {
  return state === 'confirmed' || state === 'received';
}
