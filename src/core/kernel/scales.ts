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
    // Блоки ЕНТ: у каждого свой пороговый балл, и вуз может требовать
    // конкретный блок отдельно от суммы (NU — грамотность чтения 8 из 10).
    components: ['history_kz', 'math_literacy', 'reading_literacy', 'profile_1', 'profile_2'],
    validityMonths: 12,
  },
  {
    id: 'nuet_0_240',
    label: 'NUET, 0–240',
    min: 0,
    max: 240,
    step: 1,
    examKind: 'NUET',
    components: ['math', 'critical_thinking'],
    // Результат используется в кампании своего года: отдельного срока
    // действия политика приёма NU не устанавливает.
    validityMonths: 12,
  },
  {
    id: 'sat_400_1600',
    label: 'SAT, 400–1600',
    min: 400,
    max: 1600,
    step: 10,
    examKind: 'SAT',
    components: [],
    // Политика приёма NU: сертификат действует два года со дня сдачи.
    validityMonths: 24,
  },
  {
    id: 'act_1_36',
    label: 'ACT, 1–36',
    min: 1,
    max: 36,
    step: 1,
    examKind: 'ACT',
    components: [],
    validityMonths: 24,
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

  // Кратность считается в единицах шага и от минимума шкалы.
  //
  // Прежняя формула строила множитель как `Math.round(1 / step)` и работала
  // только при шаге не больше единицы. Для SAT с шагом 10 множитель
  // обращался в ноль, деление давало NaN, а любое сравнение с NaN ложно —
  // поэтому проверка шага молча пропускала всё подряд, включая
  // несуществующие баллы вроде 1245.
  //
  // Отсчёт именно от минимума: у SAT шкала начинается с 400, и кратность
  // нулю здесь ничего не значит. Сравнение с допуском оставлено, потому что
  // деление дробных шагов в двоичной арифметике точным не бывает.
  const stepsFromMin = (value - scale.min) / scale.step;
  if (Math.abs(stepsFromMin - Math.round(stepsFromMin)) > 1e-9) {
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
