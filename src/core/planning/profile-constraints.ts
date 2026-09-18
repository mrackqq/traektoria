/**
 * Ограничения плана, вытекающие из фактов профиля.
 *
 * Планировщик — чистая функция от входа и не знает про профиль. Поэтому
 * перевод фактов в ограничения живёт здесь, между профилем и мостом.
 *
 * Две ошибки, которые закрывает этот модуль:
 *  • аттестат начинали получать сегодня, хотя школа заканчивается через год:
 *    дата выпуска не доходила до планировщика;
 *  • уже сданный экзамен планировался заново: состояние экзамена не доходило
 *    до построения цепочки действий.
 */

import type { ApplicantProfileRevision } from '../kernel/profile';
import { valueOf } from '../kernel/profile';
import type { PlainDate } from '../kernel/time';
import { daysBetween } from '../kernel/time';
import type { BridgeWarning, TaskOverride } from './bridge';
import { EXAM_KEY_BY_KIND, type ExamProgress } from './tasks-library';

/** Состояние экзаменов профиля в виде, понятном планировщику. */
export function examProgressFromProfile(
  profile: ApplicantProfileRevision,
): Map<string, ExamProgress> {
  const out = new Map<string, ExamProgress>();
  for (const exam of profile.exams) {
    const key = EXAM_KEY_BY_KIND[exam.examKind];
    if (!key) continue;
    out.set(key, {
      state: exam.state,
      ...(exam.scheduledFor ? { scheduledFor: exam.scheduledFor } : {}),
      ...(exam.resultOn ? { resultOn: exam.resultOn } : {}),
    });
  }
  return out;
}

/**
 * Сдвиги действий, вытекающие из фактов.
 *
 * Аттестат не может быть получен раньше окончания школы, экзамен нельзя сдать
 * раньше даты, на которую человек записан, а внешний результат не приходит
 * раньше объявленной даты публикации.
 */
export function profileTaskOverrides(
  profile: ApplicantProfileRevision,
  today: PlainDate,
): Map<string, TaskOverride> {
  const out = new Map<string, TaskOverride>();

  const graduation = valueOf(profile.expectedGraduation);
  if (graduation && daysBetween(today, graduation) > 0) {
    out.set('doc:school_certificate', { availableFrom: graduation });
  }

  for (const exam of profile.exams) {
    const key = EXAM_KEY_BY_KIND[exam.examKind];
    if (!key) continue;

    if (exam.state === 'scheduled' && exam.scheduledFor) {
      // Человек записан на конкретную дату: подбирать ему другое окно нельзя.
      out.set(`${key}:take`, {
        availableFrom: exam.scheduledFor,
        pinnedDate: exam.scheduledFor,
      });
    }
    if (exam.state === 'taken_awaiting_result' && exam.resultOn) {
      out.set(`${key}:result`, { resultAvailableFrom: exam.resultOn });
    }
  }

  return out;
}

/** Объединение двух наборов сдвигов: поздний источник дополняет ранний. */
export function mergeTaskOverrides(
  base: ReadonlyMap<string, TaskOverride>,
  extra: ReadonlyMap<string, TaskOverride>,
): Map<string, TaskOverride> {
  const out = new Map<string, TaskOverride>(base);
  for (const [key, value] of extra) {
    out.set(key, { ...out.get(key), ...value });
  }
  return out;
}

/**
 * Чего планировщику не хватает, чтобы посчитать честно.
 *
 * Неизвестная дата выпуска — не повод молча начать получение аттестата
 * сегодня. Это ограничение расчёта, и оно проговаривается.
 */
export function profilePlanningWarnings(profile: ApplicantProfileRevision): BridgeWarning[] {
  const warnings: BridgeWarning[] = [];
  const level = valueOf(profile.educationLevel);
  const stillStudying = level === 'grade_9' || level === 'grade_10' || level === 'grade_11' || level === 'college_student';

  if (stillStudying && profile.expectedGraduation.state !== 'known') {
    warnings.push({
      code: 'GRADUATION_UNKNOWN',
      message:
        'Дата окончания школы не указана, а документ об образовании нельзя получить раньше неё. ' +
        'Пока даты нет, сроки получения аттестата и зависящей от него подачи считаются приблизительно — ' +
        'укажите дату в анкете, чтобы план стал точным.',
    });
  }

  for (const exam of profile.exams) {
    if (exam.state === 'taken_awaiting_result' && !exam.resultOn) {
      warnings.push({
        code: 'RESULT_DATE_UNKNOWN',
        message:
          `Экзамен ${exam.examKind} сдан, но дата публикации результата не указана. ` +
          'Ожидание в плане показано по типовому сроку, а не по объявленной дате.',
      });
    }
  }

  return warnings;
}
