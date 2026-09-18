/**
 * Демонстрационный профиль и пустой профиль нового посетителя.
 *
 * Это синтетические данные для показа и проверки ядра, а не «пример реального
 * пользователя». Профиль намеренно неполный: у него есть один экзамен в
 * состоянии ожидания результата и нет языкового сертификата, поэтому он
 * прогоняет все четыре состояния решётки условий, а не только «соответствует».
 *
 * Профиль строится от момента расчёта: год поступления должен совпадать с
 * ближайшей кампанией каталога, иначе демонстрация через год показывала бы
 * «на выбранный год данных нет».
 */

import { fromMajor } from '../kernel/money';
import {
  known,
  unanswered,
  type ApplicantProfileRevision,
} from '../kernel/profile';
import { addDays } from '../kernel/time';
import { baseAdmissionYear } from '../catalog/seed';

export const DEMO_OWNER_ID = 'demo-user';

/** Идентификатор демонстрационного профиля конкретного посетителя. */
export function demoOwnerId(sessionId: string): string {
  return `demo-${sessionId}`;
}

/** Идентификатор собственного профиля посетителя. */
export function visitorOwnerId(sessionId: string): string {
  return `user-${sessionId}`;
}

/**
 * Демонстрационный ли это владелец.
 *
 * По владельцу выбирается профиль по умолчанию: демонстрационному наливается
 * синтетический пример, обычному — пустая анкета. Так «посмотреть демо» не
 * подменяет собственные ответы посетителя.
 */
export function isDemoOwner(ownerId: string): boolean {
  return ownerId === DEMO_OWNER_ID || ownerId.startsWith('demo-');
}

/**
 * Демонстрационный профиль: ученик 11 класса, сдал ЕНТ и ждёт результат.
 *
 * Состояние «сдал, жду результат» выбрано намеренно: оно показывает и то, что
 * план не назначает сдачу второй раз, и то, что требование закрывается
 * результатом, а не фактом сдачи.
 */
export function buildDemoProfile(nowIso: string, ownerId: string = DEMO_OWNER_ID): ApplicantProfileRevision {
  const year = baseAdmissionYear(nowIso);
  const today = new Date(Date.parse(nowIso)).toISOString().slice(0, 10);

  return {
    id: `${ownerId}-r1`,
    ownerId,
    revision: 1,
    createdAt: nowIso,
    changeReason: 'Демонстрационный профиль',

    educationLevel: known('grade_11'),
    expectedGraduation: known(`${year}-05-25`),
    citizenship: known('KZ'),
    applicantCategory: known('kz_citizen'),

    interests: ['computer_science', 'engineering'],
    grades: [{ scaleId: 'gpa_5', value: 4.6, provenance: 'self_reported' }],
    subjects: [
      { subjectId: 'math', provenance: 'self_reported' },
      { subjectId: 'physics', provenance: 'self_reported' },
    ],
    languages: [{ language: 'en', cefr: 'B2' }],
    exams: [
      {
        id: 'demo-exam-ent',
        examKind: 'ЕНТ',
        scaleId: 'ent_0_140',
        state: 'taken_awaiting_result',
        takenOn: addDays(today, -1),
        resultOn: addDays(today, 7),
        provenance: 'self_reported',
      },
    ],
    documents: [
      { documentKind: 'school_certificate', obtained: false, provenance: 'self_reported' },
    ],

    targetCountries: ['KZ', 'TR'],
    instructionLanguages: ['ru', 'en'],
    admissionYear: known(year),
    weeklyHours: known(12),
    budget: known({
      limit: fromMajor(3_000_000, 'KZT'),
      scope: 'tuition_only',
      period: 'academic_year',
      // Помесячная доступность средств пользователем не указана.
      availability: [],
    }),
    constraints: [],
  };
}

/**
 * Профиль нового посетителя: пусто везде, где пользователь ещё не отвечал.
 *
 * Пустой профиль — не то же самое, что демонстрационный. Пока анкета не
 * заполнена, выводы по условиям честно неопределённые, и продукт ведёт
 * пользователя в анкету, а не показывает чужие рекомендации.
 */
export function buildEmptyProfile(nowIso: string, ownerId: string): ApplicantProfileRevision {
  return {
    id: `${ownerId}-r1`,
    ownerId,
    revision: 1,
    createdAt: nowIso,
    changeReason: 'Новый профиль: анкета ещё не заполнена',

    educationLevel: unanswered(),
    expectedGraduation: unanswered(),
    citizenship: unanswered(),
    applicantCategory: unanswered(),

    interests: [],
    grades: [],
    subjects: [],
    languages: [],
    exams: [],
    documents: [],

    targetCountries: [],
    instructionLanguages: [],
    admissionYear: unanswered(),
    weeklyHours: unanswered(),
    budget: unanswered(),
    constraints: [],
  };
}

/** Заполнена ли анкета настолько, чтобы подбор имел смысл. */
export function isProfileStarted(profile: ApplicantProfileRevision): boolean {
  return (
    profile.educationLevel.state !== 'unanswered' ||
    profile.interests.length > 0 ||
    profile.admissionYear.state !== 'unanswered' ||
    profile.revision > 1
  );
}
