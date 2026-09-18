/**
 * Анкета профиля.
 *
 * Правила, из которых выведён этот модуль:
 *  • у каждого вопроса есть явный вариант «не знаю», и он НЕ равен пустому
 *    ответу: «не указано», «не знаю», «не применимо» и ноль — четыре разных
 *    состояния;
 *  • условные вопросы появляются только при применимости — применимость
 *    считается здесь, а не проверяется вёрсткой;
 *  • валидация привязана к полю: ответ возвращается с адресом поля, чтобы
 *    интерфейс подсветил именно его и сохранил введённое;
 *  • диапазоны берутся из реестра шкал, а не из атрибутов формы. Атрибут
 *    HTML — подсказка, контракт живёт здесь и проверяется на сервере;
 *  • в анкете нет и не может быть даты рождения, паспортных данных, адреса,
 *    медицинских сведений и сканов — их негде ввести и незачем хранить.
 *
 * Модуль чистый: он не читает часы и не пишет в хранилище.
 */

import {
  dontKnow,
  known,
  notApplicable,
  unanswered,
  type ApplicantProfileRevision,
  type EducationLevel,
  type ExamComponentScore,
  type ExamRecord,
  type ExamState,
  type Known,
  type SubjectRecord,
} from '../kernel/profile';
import { fromMajor, type BudgetScope } from '../kernel/money';
import { checkScaleValue, findScale, scaleForExam } from '../kernel/scales';
import type { PlainDate } from '../kernel/time';
import { addDays, daysBetween } from '../kernel/time';
import { STUDY_FIELD_LABEL_RU, type StudyField } from '../catalog/types';
import { SUBJECT_OPTIONS, COUNTRY_OPTIONS } from '../i18n/labels';

/* ------------------------------------------------------------------ */
/* Ответы                                                              */
/* ------------------------------------------------------------------ */

export type AnswerState = 'answered' | 'dont_know' | 'not_applicable' | 'unanswered';

export interface Answer {
  readonly state: AnswerState;
  /** Сырое значение поля. Для множественного выбора — список. */
  readonly value?: string | readonly string[];
}

export const UNANSWERED: Answer = { state: 'unanswered' };

export type DraftValues = Readonly<Record<string, Answer>>;

/**
 * Черновик анкеты.
 *
 * У черновика своя ревизия. Две вкладки, редактирующие анкету одновременно,
 * получают конфликт у проигравшей, а не тихую потерю половины ответов.
 */
export interface ProfileDraft {
  readonly revision: number;
  readonly basedOnProfileRevision: number;
  readonly updatedAt: string;
  readonly values: DraftValues;
}

/* ------------------------------------------------------------------ */
/* Схема                                                               */
/* ------------------------------------------------------------------ */

export type FieldKind = 'select' | 'multiselect' | 'number' | 'date' | 'money';

export interface FieldOption {
  readonly value: string;
  readonly label: string;
}

/**
 * Правило видимости вопроса — ДАННЫЕ, а не функция.
 *
 * Причина принципиальная: схема анкеты пересекает границу сервер → клиент,
 * а функции через неё не проходят. Правило как данные ещё и проверяемо:
 * его можно показать, залогировать и протестировать отдельно от вёрстки.
 */
export type VisibilityRule =
  /** Поле заполнено конкретным значением. */
  | { readonly kind: 'answered'; readonly field: string }
  /** На вопрос ответили хоть как-то, включая «не знаю». */
  | { readonly kind: 'attempted'; readonly field: string }
  /** В множественном выборе отмечено значение. */
  | { readonly kind: 'includes'; readonly field: string; readonly value: string }
  /** Поле заполнено и его значение НЕ из перечисленных. */
  | { readonly kind: 'notOneOf'; readonly field: string; readonly values: readonly string[] }
  /** Поле заполнено одним из перечисленных значений. */
  | { readonly kind: 'oneOf'; readonly field: string; readonly values: readonly string[] };

export function ruleHolds(rule: VisibilityRule, values: DraftValues): boolean {
  const answer = values[rule.field] ?? UNANSWERED;

  switch (rule.kind) {
    case 'attempted':
      return answer.state !== 'unanswered';
    case 'answered':
      return answer.state === 'answered';
    case 'includes':
      return answer.state === 'answered' && toList(answer.value).includes(rule.value);
    case 'notOneOf':
      return (
        answer.state === 'answered' &&
        typeof answer.value === 'string' &&
        !rule.values.includes(answer.value)
      );
    case 'oneOf':
      return (
        answer.state === 'answered' &&
        typeof answer.value === 'string' &&
        rule.values.includes(answer.value)
      );
  }
}

function toList(value: string | readonly string[] | undefined): readonly string[] {
  if (Array.isArray(value)) return value;
  return typeof value === 'string' && value !== '' ? [value] : [];
}

export interface Field {
  readonly id: string;
  readonly label: string;
  readonly kind: FieldKind;
  readonly hint?: string;
  readonly options?: readonly FieldOption[];
  readonly min?: number;
  readonly max?: number;
  readonly step?: string;
  readonly unit?: string;
  /** Подзаголовок внутри шага: три экзамена не должны сливаться в один список. */
  readonly group?: string;
  /** Можно ли ответить «не знаю». Для части вопросов это единственный честный ответ. */
  readonly allowDontKnow: boolean;
  /** Видимость вопроса зависит от уже данных ответов. */
  readonly visibleIf?: VisibilityRule;
  /** Почему вопрос появился — показывается рядом, чтобы он не выглядел внезапным. */
  readonly appearsBecause?: string;
}

export interface Step {
  readonly id: string;
  readonly title: string;
  readonly intro: string;
  readonly fields: readonly Field[];
}

const EDUCATION_OPTIONS: readonly FieldOption[] = [
  { value: 'grade_9', label: '9 класс' },
  { value: 'grade_10', label: '10 класс' },
  { value: 'grade_11', label: '11 класс' },
  { value: 'school_graduate', label: 'Выпускник школы' },
  { value: 'college_student', label: 'Студент колледжа' },
  { value: 'college_graduate', label: 'Выпускник колледжа' },
];

/**
 * Направления берутся из того же перечня, что и поле `field` у программы.
 *
 * Раньше анкета предлагала `economics`, а финансовая программа имела
 * `business`: совпадение интереса не срабатывало никогда, и выбор направления
 * не влиял на подбор. Единый справочник — условие того, чтобы влиял.
 */
const INTEREST_OPTIONS: readonly FieldOption[] = (
  Object.keys(STUDY_FIELD_LABEL_RU) as StudyField[]
).map((v) => ({ value: v, label: STUDY_FIELD_LABEL_RU[v] }));

/**
 * Старые ответы анкеты, у которых не было пары в каталоге.
 * Сохранённые профили не должны терять смысл после согласования справочников.
 */
const INTEREST_ALIASES: Record<string, StudyField> = {
  economics: 'business',
  mathematics: 'natural_sciences',
  it: 'computer_science',
};

export function normalizeInterest(raw: string): string {
  return INTEREST_ALIASES[raw] ?? raw;
}

export function normalizeInterests(raw: readonly string[]): string[] {
  const out: string[] = [];
  for (const item of raw) {
    const mapped = normalizeInterest(item);
    if (!out.includes(mapped)) out.push(mapped);
  }
  return out;
}

const EXAM_STATE_OPTIONS: readonly FieldOption[] = [
  { value: 'not_taken', label: 'Ещё не сдавал и не записан' },
  { value: 'scheduled', label: 'Записан на дату' },
  { value: 'taken_awaiting_result', label: 'Сдал, жду результат' },
  { value: 'result_reported', label: 'Результат опубликован' },
  { value: 'expired', label: 'Результат уже недействителен' },
];

/** Экзамены, которые анкета умеет принимать. */
export interface ManagedExam {
  readonly key: string;
  readonly examKind: string;
  readonly title: string;
  readonly scaleId: string;
  /** Компоненты, которые спрашиваются отдельно: у них свой порог в условиях. */
  readonly components: readonly string[];
}

export const MANAGED_EXAMS: readonly ManagedExam[] = [
  { key: 'ent', examKind: 'ЕНТ', title: 'ЕНТ', scaleId: 'ent_0_140', components: [] },
  { key: 'ielts', examKind: 'IELTS', title: 'IELTS Academic', scaleId: 'ielts_0_9', components: ['writing'] },
  { key: 'toefl', examKind: 'TOEFL', title: 'TOEFL iBT', scaleId: 'toefl_0_120', components: [] },
];

const COMPONENT_LABEL: Record<string, string> = {
  writing: 'Writing',
  reading: 'Reading',
  listening: 'Listening',
  speaking: 'Speaking',
};

const HAS_RESULT: readonly string[] = ['result_reported', 'expired'];
const WAS_TAKEN: readonly string[] = ['taken_awaiting_result', 'result_reported', 'expired'];

function examFields(exam: ManagedExam): Field[] {
  const scale = findScale(exam.scaleId);
  const stateField = `exam_${exam.key}_state`;
  const numberBounds = scale
    ? { min: scale.min, max: scale.max, step: String(scale.step) }
    : {};

  const fields: Field[] = [
    {
      id: stateField,
      label: `${exam.title}: что уже есть`,
      kind: 'select',
      options: EXAM_STATE_OPTIONS,
      group: exam.title,
      allowDontKnow: true,
      hint: 'Запись на экзамен и сдача — не результат. Условие закрывает опубликованный балл.',
    },
    {
      id: `exam_${exam.key}_scheduled`,
      label: `${exam.title}: дата, на которую вы записаны`,
      kind: 'date',
      group: exam.title,
      allowDontKnow: false,
      visibleIf: { kind: 'oneOf', field: stateField, values: ['scheduled'] },
      appearsBecause: 'Вы отметили, что уже записаны на экзамен.',
    },
    {
      id: `exam_${exam.key}_taken`,
      label: `${exam.title}: дата сдачи`,
      kind: 'date',
      group: exam.title,
      allowDontKnow: false,
      visibleIf: { kind: 'oneOf', field: stateField, values: WAS_TAKEN },
      appearsBecause: 'Вы отметили, что экзамен уже сдан.',
    },
    {
      id: `exam_${exam.key}_expected_result`,
      label: `${exam.title}: когда ожидается результат`,
      kind: 'date',
      group: exam.title,
      allowDontKnow: true,
      visibleIf: { kind: 'oneOf', field: stateField, values: ['taken_awaiting_result'] },
      appearsBecause: 'Результат ещё не опубликован — по этой дате считается ожидание в плане.',
    },
    {
      id: `exam_${exam.key}_result_on`,
      label: `${exam.title}: дата публикации результата`,
      kind: 'date',
      group: exam.title,
      allowDontKnow: false,
      visibleIf: { kind: 'oneOf', field: stateField, values: HAS_RESULT },
      appearsBecause: 'Результат опубликован, поэтому у него есть дата.',
    },
    {
      id: `exam_${exam.key}_overall`,
      label: `${exam.title}: общий балл`,
      kind: 'number',
      ...numberBounds,
      group: exam.title,
      allowDontKnow: false,
      visibleIf: { kind: 'oneOf', field: stateField, values: HAS_RESULT },
      ...(scale ? { hint: `Допустимо от ${scale.min} до ${scale.max}, шаг ${scale.step}.` } : {}),
    },
    ...exam.components.map<Field>((c) => ({
      id: `exam_${exam.key}_c_${c}`,
      label: `${exam.title}: балл за ${COMPONENT_LABEL[c] ?? c}`,
      kind: 'number',
      ...numberBounds,
      group: exam.title,
      allowDontKnow: true,
      visibleIf: { kind: 'oneOf', field: stateField, values: HAS_RESULT },
      hint: 'Компонентный порог проверяется отдельно от общего балла.',
    })),
    {
      id: `exam_${exam.key}_valid_until`,
      label: `${exam.title}: действителен до`,
      kind: 'date',
      group: exam.title,
      allowDontKnow: true,
      visibleIf: { kind: 'oneOf', field: stateField, values: ['result_reported'] },
      hint: 'Если срок не указан в отчёте — отметьте «не знаю», мы его не придумаем.',
    },
  ];

  return fields;
}

export const STEPS: readonly Step[] = [
  {
    id: 'education',
    title: 'Образование',
    intro: 'От уровня образования зависит, какие условия к вам вообще применимы.',
    fields: [
      {
        id: 'educationLevel',
        label: 'Текущий уровень образования',
        kind: 'select',
        options: EDUCATION_OPTIONS,
        allowDontKnow: false,
      },
      {
        id: 'expectedGraduation',
        label: 'Когда получите аттестат или диплом',
        kind: 'date',
        hint:
          'Аттестат нельзя получить раньше окончания школы, поэтому эта дата ограничивает ' +
          'весь план. Если она неизвестна — так и отметьте, мы её не придумаем.',
        allowDontKnow: true,
        visibleIf: {
          kind: 'notOneOf',
          field: 'educationLevel',
          values: ['school_graduate', 'college_graduate'],
        },
        appearsBecause: 'Вы ещё учитесь, поэтому документ об образовании — будущая дата.',
      },
      {
        id: 'gpa',
        label: 'Средний балл аттестата по пятибалльной шкале',
        kind: 'number',
        min: 2,
        max: 5,
        step: '0.01',
        hint: 'Если аттестата ещё нет — укажите текущий средний балл или отметьте «не знаю».',
        allowDontKnow: true,
      },
      {
        id: 'subjects',
        label: 'Профильные предметы, которые вы изучаете или сдавали',
        kind: 'multiselect',
        options: SUBJECT_OPTIONS,
        hint: 'По ним проверяются требования вида «не менее двух профильных предметов».',
        allowDontKnow: false,
      },
    ],
  },
  {
    id: 'status',
    title: 'Гражданство и категория',
    intro:
      'Эти поля разделяют грантовый и платный путь. Если ответ неизвестен, ' +
      'условие останется неопределённым — это честнее, чем угадать.',
    fields: [
      {
        id: 'citizenship',
        label: 'Гражданство',
        kind: 'select',
        options: [
          { value: 'KZ', label: 'Казахстан' },
          { value: 'OTHER', label: 'Другое' },
        ],
        allowDontKnow: true,
      },
      {
        id: 'applicantCategory',
        label: 'Категория заявителя',
        kind: 'select',
        options: [
          { value: 'kz_citizen', label: 'Гражданин Казахстана' },
          { value: 'foreign', label: 'Иностранный заявитель' },
        ],
        hint: 'От категории зависит, какие пути подачи вам вообще доступны.',
        allowDontKnow: true,
        visibleIf: { kind: 'attempted', field: 'citizenship' },
        appearsBecause: 'Категория уточняет условия после указания гражданства.',
      },
      {
        id: 'admissionYear',
        label: 'Год поступления',
        kind: 'number',
        min: 2020,
        max: 2040,
        step: '1',
        hint: 'Кампании приёма считаются по этому году. Данные есть не на каждый год.',
        allowDontKnow: true,
      },
    ],
  },
  {
    id: 'direction',
    title: 'Направление и языки',
    intro: 'По этим ответам подбираются программы и язык обучения.',
    fields: [
      {
        id: 'interests',
        label: 'Интересующие направления',
        kind: 'multiselect',
        options: INTEREST_OPTIONS,
        hint: 'Программы вне выбранных направлений не исчезают — они показываются как альтернативы.',
        allowDontKnow: false,
      },
      {
        id: 'targetCountries',
        label: 'Страны',
        kind: 'multiselect',
        options: COUNTRY_OPTIONS,
        hint: 'Пусто — значит страна не ограничивает подбор.',
        allowDontKnow: false,
      },
      {
        id: 'instructionLanguages',
        label: 'Языки обучения, которые вам подходят',
        kind: 'multiselect',
        options: [
          { value: 'ru', label: 'Русский' },
          { value: 'kk', label: 'Казахский' },
          { value: 'en', label: 'Английский' },
        ],
        allowDontKnow: false,
      },
      {
        id: 'englishCefr',
        label: 'Уровень английского по CEFR',
        kind: 'select',
        options: [
          { value: 'A2', label: 'A2' },
          { value: 'B1', label: 'B1' },
          { value: 'B2', label: 'B2' },
          { value: 'C1', label: 'C1' },
          { value: 'C2', label: 'C2' },
        ],
        hint: 'Это самооценка уровня, а не результат экзамена: условие она не закрывает.',
        allowDontKnow: true,
        visibleIf: { kind: 'includes', field: 'instructionLanguages', value: 'en' },
        appearsBecause: 'Вы отметили обучение на английском.',
      },
    ],
  },
  {
    id: 'exams',
    title: 'Экзамены',
    intro:
      'Что у вас уже есть по каждому экзамену. Это меняет план: уже сданный экзамен ' +
      'не будет назначен заново, а по ожидаемому результату останется только ожидание и проверка.',
    fields: MANAGED_EXAMS.flatMap(examFields),
  },
  {
    id: 'resources',
    title: 'Время и деньги',
    intro:
      'По этим числам проверяется выполнимость графика и совместимость с бюджетом. ' +
      'Оба вопроса можно оставить без ответа — тогда соответствующие выводы будут ' +
      'неопределёнными, а не оптимистичными.',
    fields: [
      {
        id: 'weeklyHours',
        label: 'Сколько часов в неделю готовы уделять подготовке',
        kind: 'number',
        min: 0,
        max: 60,
        step: '1',
        unit: 'ч',
        allowDontKnow: true,
      },
      {
        id: 'budgetLimit',
        label: 'Предел бюджета',
        kind: 'money',
        min: 0,
        max: 100_000_000,
        step: '1000',
        unit: '₸',
        allowDontKnow: true,
      },
      {
        id: 'budgetScope',
        label: 'Что входит в этот предел',
        kind: 'select',
        options: [
          { value: 'tuition_only', label: 'Только обучение' },
          { value: 'total', label: 'Все расходы, включая проживание' },
        ],
        allowDontKnow: false,
        visibleIf: { kind: 'answered', field: 'budgetLimit' },
        appearsBecause: 'Без этого уточнения сумму не с чем сравнивать.',
      },
    ],
  },
];

function values(v: DraftValues, id: string): Answer {
  return v[id] ?? UNANSWERED;
}

/** Вопросы шага, применимые при текущих ответах. */
export function visibleFields(step: Step, draft: DraftValues): Field[] {
  return step.fields.filter((f) => !f.visibleIf || ruleHolds(f.visibleIf, draft));
}

export function findStep(id: string | undefined): Step {
  return STEPS.find((s) => s.id === id) ?? STEPS[0]!;
}

export function stepIndex(step: Step): number {
  return STEPS.findIndex((s) => s.id === step.id);
}

/* ------------------------------------------------------------------ */
/* Валидация                                                           */
/* ------------------------------------------------------------------ */

export interface FieldError {
  readonly fieldId: string;
  readonly message: string;
}

export interface ValidationContext {
  /** Сегодняшняя дата в календаре пользователя. Нужна для проверки хронологии. */
  readonly today?: PlainDate;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(text: string): boolean {
  if (!DATE_RE.test(text)) return false;
  const ms = Date.parse(`${text}T00:00:00Z`);
  if (Number.isNaN(ms)) return false;
  // 2027-02-31 разбирается Date.parse как 3 марта: сравниваем обратно.
  return new Date(ms).toISOString().slice(0, 10) === text;
}

/** Проверка одного поля по его собственной схеме. */
function validateField(field: Field, draft: DraftValues, errors: FieldError[]): void {
  const answer = values(draft, field.id);
  if (answer.state !== 'answered') return;

  const raw = answer.value;

  if (field.kind === 'multiselect') {
    if (!Array.isArray(raw) || raw.length === 0) {
      errors.push({ fieldId: field.id, message: 'Выберите хотя бы один вариант' });
      return;
    }
    const allowed = new Set((field.options ?? []).map((o) => o.value));
    const unknownValue = raw.find((v) => !allowed.has(v));
    if (unknownValue !== undefined) {
      errors.push({ fieldId: field.id, message: `Значение «${unknownValue}» не из списка` });
    }
    return;
  }

  const text = typeof raw === 'string' ? raw.trim() : '';
  if (text === '') {
    errors.push({ fieldId: field.id, message: 'Заполните поле или выберите «не знаю»' });
    return;
  }

  if (field.kind === 'select') {
    if (!field.options?.some((o) => o.value === text)) {
      errors.push({ fieldId: field.id, message: 'Выберите вариант из списка' });
    }
    return;
  }

  if (field.kind === 'number' || field.kind === 'money') {
    const num = Number(text.replace(',', '.'));
    if (!Number.isFinite(num)) {
      errors.push({ fieldId: field.id, message: 'Нужно число' });
      return;
    }
    if (field.min !== undefined && num < field.min) {
      errors.push({ fieldId: field.id, message: `Не меньше ${field.min}` });
    }
    if (field.max !== undefined && num > field.max) {
      errors.push({ fieldId: field.id, message: `Не больше ${field.max}` });
    }
    return;
  }

  if (field.kind === 'date' && !isRealDate(text)) {
    errors.push({ fieldId: field.id, message: 'Нужна существующая дата в формате ГГГГ-ММ-ДД' });
  }
}

/**
 * Одно поле — одно сообщение.
 *
 * Проверок у поля две: собственная схема и связи с другими полями. Обе нужны,
 * но показывать пользователю «не больше 5» и «допустимы значения от 2 до 5»
 * одновременно бессмысленно — остаётся первая, самая конкретная.
 */
function dedupeByField(errors: readonly FieldError[]): FieldError[] {
  const seen = new Set<string>();
  const out: FieldError[] = [];
  for (const error of errors) {
    if (seen.has(error.fieldId)) continue;
    seen.add(error.fieldId);
    out.push(error);
  }
  return out;
}

export function validateStep(step: Step, draft: DraftValues, ctx: ValidationContext = {}): FieldError[] {
  const errors: FieldError[] = [];
  for (const field of visibleFields(step, draft)) validateField(field, draft, errors);
  errors.push(...crossFieldErrors(draft, ctx, step.id));
  return dedupeByField(errors);
}

/**
 * Проверка всей анкеты.
 *
 * Именно её выполняет сервер непосредственно перед применением: сохранение
 * ошибочного черновика допустимо, превращение ошибочных ответов в факты
 * профиля — нет.
 */
export function validateAll(draft: DraftValues, ctx: ValidationContext = {}): FieldError[] {
  const errors: FieldError[] = [];
  for (const step of STEPS) {
    for (const field of visibleFields(step, draft)) validateField(field, draft, errors);
  }
  errors.push(...crossFieldErrors(draft, ctx));
  return dedupeByField(errors);
}

function answeredText(v: DraftValues, id: string): string | null {
  const a = v[id];
  if (!a || a.state !== 'answered') return null;
  const text = typeof a.value === 'string' ? a.value.trim() : '';
  return text === '' ? null : text;
}

function answeredNumber(v: DraftValues, id: string): number | null {
  const text = answeredText(v, id);
  if (text === null) return null;
  const n = Number(text.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function answeredDate(v: DraftValues, id: string): PlainDate | null {
  const text = answeredText(v, id);
  return text !== null && isRealDate(text) ? text : null;
}

/**
 * Связи между полями: хронология, шкалы и согласованность с выбранным годом.
 * `onlyStep` ограничивает вывод полями одного шага, чтобы пошаговое
 * сохранение не показывало ошибки из ещё не открытых разделов.
 */
function crossFieldErrors(
  draft: DraftValues,
  ctx: ValidationContext,
  onlyStep?: string,
): FieldError[] {
  const errors: FieldError[] = [];
  const today = ctx.today;
  const fieldsOfStep = onlyStep
    ? new Set((STEPS.find((s) => s.id === onlyStep)?.fields ?? []).map((f) => f.id))
    : null;

  const push = (fieldId: string, message: string): void => {
    if (fieldsOfStep && !fieldsOfStep.has(fieldId)) return;
    errors.push({ fieldId, message });
  };

  // Выпуск и год поступления.
  const graduation = answeredDate(draft, 'expectedGraduation');
  const admissionYear = answeredNumber(draft, 'admissionYear');
  if (graduation && admissionYear !== null) {
    // Учебный год начинается осенью: документ должен быть на руках до начала.
    if (graduation > `${admissionYear}-09-01`) {
      push(
        'expectedGraduation',
        `Документ об образовании получен позже начала учебного года ${admissionYear}. ` +
          'Проверьте дату выпуска или год поступления.',
      );
    }
  }
  if (admissionYear !== null && !Number.isInteger(admissionYear)) {
    push('admissionYear', 'Год поступления — целое число');
  }
  if (today && graduation && daysBetween(graduation, today) > 365 * 10) {
    push('expectedGraduation', 'Дата выпуска слишком далеко в прошлом — похоже на опечатку');
  }

  // Средний балл: диапазон берётся из реестра шкал, а не из атрибута формы.
  const gpa = answeredNumber(draft, 'gpa');
  if (gpa !== null) {
    const problem = checkScaleValue('gpa_5', gpa, 'Средний балл');
    if (problem) push('gpa', problem.message);
  }

  // Экзамены.
  for (const exam of MANAGED_EXAMS) {
    const state = answeredText(draft, `exam_${exam.key}_state`);
    if (state === null) continue;

    const scheduledFor = answeredDate(draft, `exam_${exam.key}_scheduled`);
    const takenOn = answeredDate(draft, `exam_${exam.key}_taken`);
    const resultOn = answeredDate(draft, `exam_${exam.key}_result_on`);
    const expectedResult = answeredDate(draft, `exam_${exam.key}_expected_result`);
    const validUntil = answeredDate(draft, `exam_${exam.key}_valid_until`);
    const overall = answeredNumber(draft, `exam_${exam.key}_overall`);

    if (state === 'scheduled' && scheduledFor && today && daysBetween(today, scheduledFor) < 0) {
      push(
        `exam_${exam.key}_scheduled`,
        'Дата записи уже прошла. Если экзамен состоялся — отметьте «сдал, жду результат».',
      );
    }
    if (WAS_TAKEN.includes(state) && takenOn && today && daysBetween(today, takenOn) > 0) {
      push(`exam_${exam.key}_taken`, 'Дата сдачи в будущем. Для будущей даты выберите «записан».');
    }
    if (takenOn && resultOn && daysBetween(takenOn, resultOn) < 0) {
      push(`exam_${exam.key}_result_on`, 'Результат не может быть опубликован раньше сдачи');
    }
    if (takenOn && expectedResult && daysBetween(takenOn, expectedResult) < 0) {
      push(`exam_${exam.key}_expected_result`, 'Ожидаемая дата результата раньше даты сдачи');
    }
    // Будущий результат не становится опубликованным фактом.
    if (state === 'result_reported' && resultOn && today && daysBetween(today, resultOn) > 0) {
      push(
        `exam_${exam.key}_result_on`,
        'Дата публикации в будущем. Пока результата нет, выберите «сдал, жду результат».',
      );
    }
    if (validUntil && resultOn && daysBetween(resultOn, validUntil) < 0) {
      push(`exam_${exam.key}_valid_until`, 'Срок действия истекает раньше публикации результата');
    }
    if (overall !== null) {
      const problem = checkScaleValue(exam.scaleId, overall, `${exam.title}, общий балл`);
      if (problem) push(`exam_${exam.key}_overall`, problem.message);
    }
    for (const c of exam.components) {
      const value = answeredNumber(draft, `exam_${exam.key}_c_${c}`);
      if (value === null) continue;
      const problem = checkScaleValue(
        exam.scaleId,
        value,
        `${exam.title}, ${COMPONENT_LABEL[c] ?? c}`,
      );
      if (problem) push(`exam_${exam.key}_c_${c}`, problem.message);
    }
    if (HAS_RESULT.includes(state) && overall === null) {
      push(`exam_${exam.key}_overall`, 'Укажите общий балл: без него результат не является результатом');
    }
  }

  return errors;
}

/* ------------------------------------------------------------------ */
/* Черновик из профиля и профиль из черновика                          */
/* ------------------------------------------------------------------ */

function fromKnown<T>(k: Known<T>, render: (v: T) => string): Answer {
  switch (k.state) {
    case 'known':
      return { state: 'answered', value: render(k.value) };
    case 'dont_know':
      return { state: 'dont_know' };
    case 'not_applicable':
      return { state: 'not_applicable' };
    case 'unanswered':
      return UNANSWERED;
  }
}

const answeredValue = (value: string | undefined): Answer =>
  value === undefined || value === '' ? UNANSWERED : { state: 'answered', value };

/** Начальный черновик: то, что уже известно о профиле. */
export function draftFromProfile(profile: ApplicantProfileRevision, at: string): ProfileDraft {
  const gpa = profile.grades.find((g) => g.scaleId === 'gpa_5');
  const english = profile.languages.find((l) => l.language === 'en');
  const budget = profile.budget;

  const draftValues: Record<string, Answer> = {
    educationLevel: fromKnown(profile.educationLevel, (v) => v),
    expectedGraduation: fromKnown(profile.expectedGraduation, (v) => v),
    citizenship: fromKnown(profile.citizenship, (v) => v),
    applicantCategory: fromKnown(profile.applicantCategory, (v) => v),
    admissionYear: fromKnown(profile.admissionYear, (v) => String(v)),
    weeklyHours: fromKnown(profile.weeklyHours, (v) => String(v)),
    interests: profile.interests.length > 0
      ? { state: 'answered', value: normalizeInterests(profile.interests) }
      : UNANSWERED,
    targetCountries: profile.targetCountries.length > 0
      ? { state: 'answered', value: [...profile.targetCountries] }
      : UNANSWERED,
    instructionLanguages: profile.instructionLanguages.length > 0
      ? { state: 'answered', value: [...profile.instructionLanguages] }
      : UNANSWERED,
    subjects: profile.subjects.length > 0
      ? { state: 'answered', value: profile.subjects.map((s) => s.subjectId) }
      : UNANSWERED,
    gpa: gpa ? { state: 'answered', value: String(gpa.value) } : UNANSWERED,
    englishCefr: english ? { state: 'answered', value: english.cefr } : UNANSWERED,
    budgetLimit:
      budget.state === 'known'
        ? { state: 'answered', value: String(Number(budget.value.limit.amountMinor) / 100) }
        : fromKnown(budget, () => ''),
    budgetScope:
      budget.state === 'known' ? { state: 'answered', value: budget.value.scope } : UNANSWERED,
  };

  for (const exam of MANAGED_EXAMS) {
    const record = profile.exams.find((e) => e.examKind === exam.examKind);
    draftValues[`exam_${exam.key}_state`] = record
      ? { state: 'answered', value: record.state }
      : UNANSWERED;
    draftValues[`exam_${exam.key}_scheduled`] = answeredValue(record?.scheduledFor);
    draftValues[`exam_${exam.key}_taken`] = answeredValue(record?.takenOn);
    draftValues[`exam_${exam.key}_result_on`] = answeredValue(
      record?.state === 'result_reported' || record?.state === 'expired' ? record.resultOn : undefined,
    );
    draftValues[`exam_${exam.key}_expected_result`] = answeredValue(
      record?.state === 'taken_awaiting_result' ? record.resultOn : undefined,
    );
    draftValues[`exam_${exam.key}_valid_until`] = answeredValue(record?.validUntil);
    draftValues[`exam_${exam.key}_overall`] = answeredValue(
      record?.overall !== undefined ? String(record.overall) : undefined,
    );
    for (const c of exam.components) {
      const comp = record?.components?.find((x) => x.component === c);
      draftValues[`exam_${exam.key}_c_${c}`] = answeredValue(
        comp ? String(comp.score) : undefined,
      );
    }
  }

  return {
    revision: 1,
    basedOnProfileRevision: profile.revision,
    updatedAt: at,
    values: draftValues,
  };
}

function toKnown<T>(answer: Answer, parse: (raw: string) => T | null): Known<T> {
  switch (answer.state) {
    case 'dont_know':
      return dontKnow<T>();
    case 'not_applicable':
      return notApplicable<T>();
    case 'unanswered':
      return unanswered<T>();
    case 'answered': {
      const raw = typeof answer.value === 'string' ? answer.value.trim() : '';
      const parsed = raw === '' ? null : parse(raw);
      // Нераспознанное значение не превращается в «известно»: оно остаётся
      // незаполненным, и расчёт честно считает его неизвестным.
      return parsed === null ? unanswered<T>() : known(parsed);
    }
  }
}

function answeredList(v: DraftValues, id: string): readonly string[] {
  const a = v[id];
  if (!a || a.state !== 'answered') return [];
  return Array.isArray(a.value) ? a.value : a.value ? [a.value] : [];
}

/**
 * Экзамены из анкеты.
 *
 * Запись создаётся только для тех экзаменов, по которым пользователь ответил.
 * Если по экзамену ответа нет, сохраняется прежняя запись профиля: результат,
 * внесённый подтверждением в маршруте, не должен пропадать из-за того, что
 * анкету открыли и пролистали.
 */
function examsFromDraft(
  profile: ApplicantProfileRevision,
  v: DraftValues,
): ExamRecord[] {
  const out: ExamRecord[] = [];
  const managedKinds = new Set(MANAGED_EXAMS.map((e) => e.examKind));

  // Экзамены, которыми анкета не управляет, переносятся как есть.
  for (const record of profile.exams) {
    if (!managedKinds.has(record.examKind)) out.push(record);
  }

  for (const exam of MANAGED_EXAMS) {
    const previous = profile.exams.find((e) => e.examKind === exam.examKind);
    const stateAnswer = values(v, `exam_${exam.key}_state`);

    if (stateAnswer.state !== 'answered') {
      // «Не знаю» по состоянию экзамена — осознанный отказ от записи факта.
      if (stateAnswer.state === 'unanswered' && previous) out.push(previous);
      continue;
    }

    const state = String(stateAnswer.value) as ExamState;
    if (!EXAM_STATE_OPTIONS.some((o) => o.value === state)) {
      if (previous) out.push(previous);
      continue;
    }

    const scheduledFor = answeredDate(v, `exam_${exam.key}_scheduled`);
    const takenOn = answeredDate(v, `exam_${exam.key}_taken`);
    const publishedOn = answeredDate(v, `exam_${exam.key}_result_on`);
    const expectedOn = answeredDate(v, `exam_${exam.key}_expected_result`);
    const validUntil = answeredDate(v, `exam_${exam.key}_valid_until`);
    const overall = answeredNumber(v, `exam_${exam.key}_overall`);

    const components: ExamComponentScore[] = [];
    for (const c of exam.components) {
      const score = answeredNumber(v, `exam_${exam.key}_c_${c}`);
      if (score !== null) components.push({ component: c, score });
    }

    const hasResult = state === 'result_reported' || state === 'expired';
    const resultOn = hasResult ? publishedOn : expectedOn;

    out.push({
      id: `exam-${exam.examKind}-${state}-${resultOn ?? takenOn ?? scheduledFor ?? 'na'}`,
      examKind: exam.examKind,
      scaleId: exam.scaleId,
      state,
      // Балл сохраняется только вместе с опубликованным результатом:
      // ожидание результата баллом не является.
      ...(hasResult && overall !== null ? { overall } : {}),
      ...(hasResult && components.length > 0 ? { components } : {}),
      ...(takenOn ? { takenOn } : {}),
      ...(resultOn ? { resultOn } : {}),
      ...(validUntil ? { validUntil } : {}),
      ...(scheduledFor ? { scheduledFor } : {}),
      provenance: 'self_reported',
    });
  }

  return out;
}

function subjectsFromDraft(
  profile: ApplicantProfileRevision,
  v: DraftValues,
): readonly SubjectRecord[] {
  const answer = values(v, 'subjects');
  if (answer.state !== 'answered') return profile.subjects;

  const chosen = answeredList(v, 'subjects');
  return chosen.map((subjectId) => {
    const previous = profile.subjects.find((s) => s.subjectId === subjectId);
    // Балл по предмету анкетой не спрашивается: если он уже был, он сохраняется.
    return previous ?? { subjectId, provenance: 'self_reported' as const };
  });
}

/**
 * Применение анкеты создаёт НОВУЮ ревизию профиля.
 *
 * Документы анкетой не трогаются: они приходят подтверждёнными результатами
 * в маршруте, а не ответом на вопрос.
 */
export function applyDraftToProfile(
  profile: ApplicantProfileRevision,
  draft: ProfileDraft,
  at: string,
  changeReason = 'Изменение анкеты',
): ApplicantProfileRevision {
  const v = draft.values;

  const budgetLimit = values(v, 'budgetLimit');
  const budgetScopeRaw = answeredText(v, 'budgetScope');
  const gpaRaw = answeredNumber(v, 'gpa');
  const englishCefr = answeredText(v, 'englishCefr');

  const budget: ApplicantProfileRevision['budget'] =
    budgetLimit.state === 'answered' && typeof budgetLimit.value === 'string'
      ? (() => {
          const amount = Number(budgetLimit.value.replace(',', '.'));
          // Нечисловой или отрицательный ответ не становится «бюджет известен».
          if (!Number.isFinite(amount) || amount < 0) return unanswered();
          return known({
            limit: fromMajor(amount, 'KZT'),
            scope: (budgetScopeRaw ?? 'tuition_only') as BudgetScope,
            period: 'academic_year' as const,
            availability: [],
          });
        })()
      : budgetLimit.state === 'dont_know'
        ? dontKnow()
        : budgetLimit.state === 'not_applicable'
          ? notApplicable()
          : unanswered();

  const grades = gpaRaw !== null && checkScaleValue('gpa_5', gpaRaw, 'Средний балл') === null
    ? [
        ...profile.grades.filter((g) => g.scaleId !== 'gpa_5'),
        { scaleId: 'gpa_5', value: gpaRaw, provenance: 'self_reported' as const },
      ]
    : profile.grades.filter((g) => g.scaleId !== 'gpa_5');

  const languages = englishCefr
    ? [...profile.languages.filter((l) => l.language !== 'en'), { language: 'en', cefr: englishCefr }]
    : profile.languages.filter((l) => l.language !== 'en');

  return {
    ...profile,
    id: `${profile.ownerId}-r${profile.revision + 1}`,
    revision: profile.revision + 1,
    createdAt: at,
    changeReason,

    educationLevel: toKnown<EducationLevel>(values(v, 'educationLevel'), (raw) =>
      EDUCATION_OPTIONS.some((o) => o.value === raw) ? (raw as EducationLevel) : null,
    ),
    expectedGraduation: toKnown<PlainDate>(values(v, 'expectedGraduation'), (raw) =>
      isRealDate(raw) ? raw : null,
    ),
    citizenship: toKnown<string>(values(v, 'citizenship'), (raw) => raw),
    applicantCategory: toKnown<string>(values(v, 'applicantCategory'), (raw) => raw),
    admissionYear: toKnown<number>(values(v, 'admissionYear'), (raw) => {
      const n = Number(raw);
      return Number.isInteger(n) && n >= 2020 && n <= 2040 ? n : null;
    }),
    weeklyHours: toKnown<number>(values(v, 'weeklyHours'), (raw) => {
      const n = Number(raw.replace(',', '.'));
      return Number.isFinite(n) && n >= 0 && n <= 60 ? n : null;
    }),

    interests: normalizeInterests(answeredList(v, 'interests')),
    targetCountries: answeredList(v, 'targetCountries'),
    instructionLanguages: answeredList(v, 'instructionLanguages'),
    subjects: subjectsFromDraft(profile, v),
    exams: examsFromDraft(profile, v),
    grades,
    languages,
    budget,
  };
}

/** Сколько применимых вопросов отвечено — для честного индикатора шага. */
export function completeness(draft: DraftValues): { answered: number; visible: number } {
  let answeredCount = 0;
  let visible = 0;
  for (const step of STEPS) {
    for (const field of visibleFields(step, draft)) {
      visible++;
      if (values(draft, field.id).state !== 'unanswered') answeredCount++;
    }
  }
  return { answered: answeredCount, visible };
}

/** Поля, которые пользователь изменил относительно другого набора ответов. */
export function changedFieldIds(before: DraftValues, after: DraftValues): string[] {
  const ids = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed: string[] = [];
  for (const id of ids) {
    if (!sameAnswer(before[id] ?? UNANSWERED, after[id] ?? UNANSWERED)) changed.push(id);
  }
  return changed.sort();
}

export function sameAnswer(a: Answer, b: Answer): boolean {
  if (a.state !== b.state) return false;
  const av = a.value;
  const bv = b.value;
  if (Array.isArray(av) && Array.isArray(bv)) {
    return av.length === bv.length && [...av].sort().every((x, i) => x === [...bv].sort()[i]);
  }
  return String(av ?? '') === String(bv ?? '');
}

/** Подпись поля для сообщений «что изменилось». */
export function fieldLabel(fieldId: string): string {
  return findField(fieldId)?.label ?? fieldId;
}

export function findField(fieldId: string): Field | undefined {
  for (const step of STEPS) {
    const field = step.fields.find((f) => f.id === fieldId);
    if (field) return field;
  }
  return undefined;
}

/** Ответ человеческим текстом: подписи вариантов, а не внутренние значения. */
export function describeAnswer(fieldId: string, answer: Answer | undefined): string {
  const a = answer ?? UNANSWERED;
  if (a.state === 'dont_know') return 'не знаю';
  if (a.state === 'not_applicable') return 'не применимо';
  if (a.state === 'unanswered') return 'не заполнено';

  const field = findField(fieldId);
  const label = (raw: string) => field?.options?.find((o) => o.value === raw)?.label ?? raw;

  if (Array.isArray(a.value)) {
    return a.value.length === 0 ? 'ничего не выбрано' : a.value.map(label).join(', ');
  }
  const raw = String(a.value ?? '');
  const text = label(raw);
  return field?.unit ? `${text} ${field.unit}` : text;
}

export { addDays };
