/**
 * Реестр шкал: единственное место, где записано, какие значения вообще
 * возможны у экзамена или средней оценки.
 *
 * Зачем отдельный модуль: диапазон шкалы нужен трём разным местам — форме
 * ввода, серверной проверке результата и проверке анкеты. Пока он был
 * записан только в атрибутах поля формы, сервер принимал IELTS 99 и ЕНТ 999.
 * Атрибут HTML — подсказка, а не контракт.
 */

export interface ScaleDefinition {
  readonly id: string;
  readonly label: string;
  /** Минимально возможное значение по шкале. */
  readonly min: number;
  /** Максимально возможное значение по шкале. */
  readonly max: number;
  /** Шаг шкалы. 0.5 у IELTS, 1 у ЕНТ и TOEFL, 0.01 у среднего балла. */
  readonly step: number;
  /** Экзамен, которому принадлежит шкала. Отсутствует у школьных оценок. */
  readonly examKind?: string;
  /** Компоненты, по которым публикуется отдельный балл. */
  readonly components?: readonly string[];
  /** Обычный срок действия результата в месяцах. null — срок не ограничен. */
  readonly validityMonths: number | null;
}

export const SCALES: readonly ScaleDefinition[] = [
  {
    id: 'ielts_0_9',
    label: 'IELTS Academic, 0–9',
    min: 0,
    max: 9,
    step: 0.5,
    examKind: 'IELTS',
    components: ['listening', 'reading', 'writing', 'speaking'],
    validityMonths: 24,
  },
  {
    id: 'toefl_0_120',
    label: 'TOEFL iBT, 0–120',
    min: 0,
    max: 120,
    step: 1,
    examKind: 'TOEFL',
    components: ['listening', 'reading', 'writing', 'speaking'],
    validityMonths: 24,
  },
  {
    id: 'ent_0_140',
    label: 'ЕНТ, 0–140',
    min: 0,
    max: 140,
    step: 1,
    examKind: 'ЕНТ',
    components: [],
    validityMonths: 12,
  },
  {
    id: 'gpa_5',
    label: 'Средний балл, 2–5',
    min: 2,
    max: 5,
    step: 0.01,
    validityMonths: null,
  },
  {
    id: 'ent_subject',
    label: 'Балл ЕНТ по предмету, 0–40',
    min: 0,
    max: 40,
    step: 1,
    validityMonths: null,
  },
];

export function findScale(scaleId: string): ScaleDefinition | undefined {
  return SCALES.find((s) => s.id === scaleId);
}

/** Шкала экзамена по его виду. У одного вида экзамена шкала одна. */
export function scaleForExam(examKind: string): ScaleDefinition | undefined {
  return SCALES.find((s) => s.examKind === examKind);
}

export type ScaleProblem =
  | { readonly code: 'UNKNOWN_SCALE'; readonly message: string }
  | { readonly code: 'OUT_OF_RANGE'; readonly message: string }
  | { readonly code: 'BAD_STEP'; readonly message: string }
  | { readonly code: 'NOT_A_NUMBER'; readonly message: string };

/**
 * Проверка значения по шкале.
 *
 * Шаг проверяется через целые числа: 6.5 / 0.5 в двоичной арифметике даёт
 * 12.999999999999998, и наивная проверка остатка отвергла бы правильный балл.
 */
export function checkScaleValue(
  scaleId: string,
  value: number,
  what: string,
): ScaleProblem | null {
  const scale = findScale(scaleId);
  if (!scale) {
    return { code: 'UNKNOWN_SCALE', message: `${what}: шкала «${scaleId}» неизвестна` };
  }
  if (!Number.isFinite(value)) {
    return { code: 'NOT_A_NUMBER', message: `${what}: значение не является числом` };
  }
  if (value < scale.min || value > scale.max) {
    return {
      code: 'OUT_OF_RANGE',
      message: `${what}: допустимы значения от ${scale.min} до ${scale.max} (${scale.label})`,
    };
  }

  const factor = Math.round(1 / scale.step);
  const scaled = Math.round(value * factor);
  if (Math.abs(scaled / factor - value) > 1e-9) {
    return {
      code: 'BAD_STEP',
      message: `${what}: шаг шкалы ${scale.step}, значение ${value} ему не соответствует`,
    };
  }
  return null;
}

/** Строка шага для атрибута формы: форма и проверка берут одно значение. */
export function stepAttr(scaleId: string): string {
  const scale = findScale(scaleId);
  return scale ? String(scale.step) : 'any';
}
