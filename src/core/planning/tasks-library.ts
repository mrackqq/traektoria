/**
 * BR-03 / BR-04 / BR-08 — библиотека шаблонов действий.
 *
 * BR-03: у каждой задачи есть требуемый результат, источник, действия
 * и критерий завершения. «Повысить английский» без результата и основания
 * задачей не является.
 *
 * BR-08: длительность подготовки, трудозатраты и внешнее ожидание —
 * три РАЗНЫЕ величины, и они хранятся раздельно.
 */

import { fromMajor, type Money } from '../kernel/money';
import type { ExamState } from '../kernel/profile';
import type { PlainDate } from '../kernel/time';

export interface Range {
  readonly min: number;
  readonly max: number;
}

export type EstimateBasis = 'catalog_default' | 'user_provided' | 'source_published';

export type TaskKind =
  | 'prepare'
  | 'register'
  | 'take_exam'
  | 'await_result'
  | 'obtain_document'
  | 'improve_grade'
  | 'study_subject'
  | 'submit_application'
  | 'verify_data'
  | 'activity';

export const TASK_KIND_LABEL_RU: Record<TaskKind, string> = {
  prepare: 'Подготовка',
  register: 'Регистрация',
  take_exam: 'Сдача экзамена',
  await_result: 'Ожидание результата',
  obtain_document: 'Получение документа',
  improve_grade: 'Улучшение оценок',
  study_subject: 'Изучение предмета',
  submit_application: 'Подача заявления',
  verify_data: 'Уточнение данных',
  activity: 'Активность и портфолио',
};

export interface TaskTemplate {
  /** BR-05: семантический ключ объединения. Одинаковое название — не основание. */
  readonly semanticKey: string;
  readonly kind: TaskKind;
  readonly title: string;
  /** BR-03: проверяемый выходной результат. */
  readonly requiredOutcome: string;
  readonly completionCriterion: string;
  readonly instruction: string;
  /** BR-08: календарная длительность активной работы. */
  readonly durationDays: Range;
  /** BR-08: трудозатраты в часах — основа проверки недельной нагрузки (BR-10). */
  readonly effortHours: Range;
  /** BR-08: внешнее ожидание, на которое пользователь не влияет. */
  readonly externalWaitDays: Range;
  readonly estimateBasis: EstimateBasis;
  readonly dependsOnKeys: readonly string[];
  readonly cost?: Money;
  /** Опубликованные окна проведения. Пусто — окон нет, можно в любой рабочий день. */
  readonly sessionDates?: readonly PlainDate[];
  /**
   * Рекомендация, а не требование приёма.
   *
   * Такое действие полезно для поступающего, но ни одно условие каталога его
   * не требует. Поэтому оно не закрывает формальных условий, не блокирует
   * подачу заявления и не учитывается в проверке недельной нагрузки: иначе
   * полезный совет выглядел бы как обязанность вуза.
   */
  readonly advisory?: boolean;
}

/* ------------------------------------------------------------------ */
/* Демонстрационные окна экзаменов                                     */
/* ------------------------------------------------------------------ */

/** Демо-расписание сессий. В production это опубликованные данные каталога. */
const IELTS_SESSIONS: PlainDate[] = [
  '2026-10-17', '2026-11-14', '2026-12-12', '2027-01-16', '2027-02-13',
  '2027-03-13', '2027-04-17', '2027-05-15', '2027-06-12',
];

const TOEFL_SESSIONS: PlainDate[] = [
  '2026-10-24', '2026-11-21', '2026-12-19', '2027-01-23', '2027-02-20',
  '2027-03-20', '2027-04-24', '2027-05-22', '2027-06-19',
];

const ENT_SESSIONS: PlainDate[] = ['2027-03-20', '2027-05-15', '2027-06-20'];

/* ------------------------------------------------------------------ */
/* Шаблоны                                                             */
/* ------------------------------------------------------------------ */

function examChain(
  examKey: string,
  examName: string,
  prepDays: Range,
  prepHours: Range,
  sessions: PlainDate[],
  resultWaitDays: Range,
  fee: Money,
  targetDescription: string,
): TaskTemplate[] {
  return [
    {
      semanticKey: `${examKey}:prepare`,
      kind: 'prepare',
      title: `Подготовка к ${examName}`,
      requiredOutcome: targetDescription,
      completionCriterion: `Пробный тест показывает уровень не ниже целевого по всем компонентам.`,
      instruction:
        `Занимайтесь по официальным материалам ${examName}, минимум два пробных теста ` +
        'в полном формате и разбор ошибок по компонентам.',
      durationDays: prepDays,
      effortHours: prepHours,
      externalWaitDays: { min: 0, max: 0 },
      estimateBasis: 'catalog_default',
      dependsOnKeys: [],
    },
    {
      semanticKey: `${examKey}:register`,
      kind: 'register',
      title: `Регистрация на ${examName}`,
      requiredOutcome: 'Подтверждённая запись на конкретную дату сессии',
      completionCriterion: 'Получено подтверждение регистрации с датой и местом.',
      instruction: `Выберите дату сессии ${examName} и оплатите регистрационный взнос.`,
      durationDays: { min: 1, max: 2 },
      effortHours: { min: 1, max: 2 },
      externalWaitDays: { min: 0, max: 0 },
      estimateBasis: 'catalog_default',
      dependsOnKeys: [],
      cost: fee,
    },
    {
      semanticKey: `${examKey}:take`,
      kind: 'take_exam',
      title: `Сдать ${examName}`,
      // AC-07: сдача закрывает действие, но не требование к результату.
      requiredOutcome: 'Экзамен сдан. Требование закрывается результатом, а не сдачей.',
      completionCriterion: 'Экзамен сдан в назначенную дату.',
      instruction: `Явитесь на сессию ${examName} с документом, удостоверяющим личность.`,
      durationDays: { min: 1, max: 1 },
      effortHours: { min: 3, max: 4 },
      externalWaitDays: { min: 0, max: 0 },
      estimateBasis: 'source_published',
      dependsOnKeys: [`${examKey}:prepare`, `${examKey}:register`],
      sessionDates: sessions,
    },
    {
      semanticKey: `${examKey}:result`,
      kind: 'await_result',
      title: `Получить результат ${examName}`,
      requiredOutcome: targetDescription,
      completionCriterion: 'Официальный результат опубликован и соответствует требованию.',
      instruction: 'Дождитесь публикации результата. Это внешнее ожидание, ускорить его нельзя.',
      durationDays: { min: 0, max: 0 },
      effortHours: { min: 0, max: 0 },
      externalWaitDays: resultWaitDays,
      estimateBasis: 'source_published',
      dependsOnKeys: [`${examKey}:take`],
    },
  ];
}

export const TASK_TEMPLATES: readonly TaskTemplate[] = [
  ...examChain(
    'ielts', 'IELTS Academic',
    { min: 60, max: 120 }, { min: 80, max: 160 },
    IELTS_SESSIONS, { min: 11, max: 13 },
    fromMajor(135_000, 'KZT'),
    'Общий балл и все компоненты не ниже требуемых',
  ),
  ...examChain(
    'toefl', 'TOEFL iBT',
    { min: 60, max: 120 }, { min: 80, max: 160 },
    TOEFL_SESSIONS, { min: 6, max: 10 },
    fromMajor(120_000, 'KZT'),
    'Общий балл не ниже требуемого',
  ),
  ...examChain(
    'ent', 'ЕНТ',
    { min: 90, max: 180 }, { min: 150, max: 300 },
    ENT_SESSIONS, { min: 3, max: 7 },
    fromMajor(2_500, 'KZT'),
    'Балл ЕНТ не ниже требуемого',
  ),

  {
    semanticKey: 'doc:school_certificate',
    kind: 'obtain_document',
    title: 'Получить аттестат о среднем образовании',
    requiredOutcome: 'Оригинал аттестата на руках',
    completionCriterion: 'Аттестат выдан школой, данные совпадают с профилем.',
    instruction: 'Аттестат выдаётся после окончания 11 класса и итоговой аттестации.',
    durationDays: { min: 1, max: 1 },
    effortHours: { min: 1, max: 2 },
    externalWaitDays: { min: 5, max: 20 },
    estimateBasis: 'catalog_default',
    dependsOnKeys: [],
  },
  {
    semanticKey: 'doc:certified_translation',
    kind: 'obtain_document',
    title: 'Сделать заверенный перевод аттестата',
    requiredOutcome: 'Нотариально заверенный перевод на требуемый язык',
    completionCriterion: 'Перевод заверен и принят приёмной комиссией по формальным признакам.',
    instruction: 'Обратитесь в бюро переводов с нотариальным заверением. Нужен оригинал аттестата.',
    durationDays: { min: 3, max: 7 },
    effortHours: { min: 2, max: 4 },
    externalWaitDays: { min: 3, max: 10 },
    estimateBasis: 'catalog_default',
    dependsOnKeys: ['doc:school_certificate'],
    cost: fromMajor(25_000, 'KZT'),
  },
  {
    semanticKey: 'gpa:improve',
    kind: 'improve_grade',
    title: 'Поднять средний балл аттестата',
    requiredOutcome: 'Средний балл не ниже требуемого в указанной шкале',
    completionCriterion: 'Итоговые оценки за учебный период закрыты и средний балл достигнут.',
    instruction:
      'Средний балл меняется только по итогам учебного периода. Сфокусируйтесь на предметах ' +
      'с наибольшим отставанием и согласуйте план с учителями.',
    durationDays: { min: 90, max: 180 },
    effortHours: { min: 60, max: 140 },
    externalWaitDays: { min: 0, max: 0 },
    estimateBasis: 'catalog_default',
    dependsOnKeys: [],
  },
  {
    semanticKey: 'subject:study',
    kind: 'study_subject',
    title: 'Изучить профильный предмет',
    requiredOutcome: 'Предмет изучен и подтверждён оценкой',
    completionCriterion: 'Предмет закрыт с итоговой оценкой и отражён в аттестате.',
    instruction: 'Согласуйте включение предмета в учебный план или подготовьтесь к аттестации экстерном.',
    durationDays: { min: 60, max: 150 },
    effortHours: { min: 50, max: 120 },
    externalWaitDays: { min: 0, max: 0 },
    estimateBasis: 'catalog_default',
    dependsOnKeys: [],
  },
  {
    semanticKey: 'application:submit',
    kind: 'submit_application',
    title: 'Подать заявление',
    requiredOutcome: 'Заявление принято приёмной комиссией',
    completionCriterion: 'Получено подтверждение о приёме заявления.',
    // PR-06: сервис не подаёт заявление за пользователя.
    instruction:
      'Подайте заявление самостоятельно на официальном портале приёма. Сервис не отправляет ' +
      'заявления от вашего имени.',
    durationDays: { min: 1, max: 3 },
    effortHours: { min: 2, max: 5 },
    externalWaitDays: { min: 0, max: 0 },
    estimateBasis: 'catalog_default',
    dependsOnKeys: [],
  },
  {
    semanticKey: 'activity:portfolio',
    kind: 'activity',
    title: 'Собрать портфолио проектов',
    requiredOutcome: 'Несколько завершённых работ, которые можно показать',
    completionCriterion: 'Работы собраны в одном месте с коротким описанием вашей роли.',
    instruction:
      'Соберите 2–3 своих проекта: что делали, зачем и что получилось. Это не требование ' +
      'приёмной комиссии — портфолио помогает на собеседованиях, в заявках на стипендии ' +
      'и при выборе направления.',
    durationDays: { min: 30, max: 90 },
    effortHours: { min: 20, max: 60 },
    externalWaitDays: { min: 0, max: 0 },
    estimateBasis: 'catalog_default',
    dependsOnKeys: [],
    advisory: true,
  },
  {
    semanticKey: 'activity:competition',
    kind: 'activity',
    title: 'Участвовать в профильной олимпиаде или конкурсе',
    requiredOutcome: 'Опыт участия, а при удаче — подтверждённый результат',
    completionCriterion: 'Вы зарегистрировались и приняли участие хотя бы в одном отборе.',
    instruction:
      'Найдите олимпиаду или конкурс по вашему направлению и подайте заявку. ' +
      'Условия приёма этого не требуют; участие даёт практику и иногда влияет ' +
      'на отдельные стипендии.',
    durationDays: { min: 20, max: 60 },
    effortHours: { min: 15, max: 40 },
    externalWaitDays: { min: 0, max: 0 },
    estimateBasis: 'catalog_default',
    dependsOnKeys: [],
    advisory: true,
  },
  {
    semanticKey: 'data:verify',
    kind: 'verify_data',
    title: 'Уточнить условие у первоисточника',
    requiredOutcome: 'Условие подтверждено официальным источником с датой проверки',
    completionCriterion: 'Получен однозначный ответ приёмной комиссии или обновлённая публикация.',
    instruction:
      'Свяжитесь с приёмной комиссией и зафиксируйте ответ. Пока условие не подтверждено, ' +
      'планировать его выполнение нельзя.',
    durationDays: { min: 1, max: 3 },
    effortHours: { min: 1, max: 3 },
    externalWaitDays: { min: 2, max: 14 },
    estimateBasis: 'catalog_default',
    dependsOnKeys: [],
  },
];

export function findTemplate(semanticKey: string): TaskTemplate | undefined {
  return TASK_TEMPLATES.find((t) => t.semanticKey === semanticKey);
}

/**
 * Рекомендуемые активности, уместные для направления программы.
 *
 * Это подсказка продукта, а не условие вуза: ни один узел дерева требований
 * на неё не ссылается, и закрытие такого действия ничего не «зачитывает».
 */
export function advisoryKeysForField(field: string): string[] {
  switch (field) {
    case 'computer_science':
    case 'engineering':
    case 'natural_sciences':
      return ['activity:portfolio', 'activity:competition'];
    case 'arts_design':
      return ['activity:portfolio'];
    case 'business':
    case 'social_sciences':
    case 'law':
      return ['activity:competition'];
    default:
      return [];
  }
}

/* ------------------------------------------------------------------ */
/* Экзамены: ключ цепочки и уже пройденные шаги                        */
/* ------------------------------------------------------------------ */

/** Вид экзамена в каталоге → префикс его цепочки действий. */
export const EXAM_KEY_BY_KIND: Readonly<Record<string, string>> = {
  IELTS: 'ielts',
  TOEFL: 'toefl',
  'ЕНТ': 'ent',
};

export const EXAM_KIND_BY_KEY: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(EXAM_KEY_BY_KIND).map(([kind, key]) => [key, kind]),
);

/** Что с экзаменом уже произошло, по фактам профиля. */
export interface ExamProgress {
  readonly state: ExamState;
  readonly scheduledFor?: PlainDate;
  /** Дата публикации результата: фактическая или ожидаемая. */
  readonly resultOn?: PlainDate;
}

const FULL_CHAIN = (key: string): string[] => [
  `${key}:prepare`,
  `${key}:register`,
  `${key}:take`,
  `${key}:result`,
];

/**
 * Какие шаги цепочки ещё нужны при текущем состоянии экзамена.
 *
 * Здесь закрывается ошибка, из-за которой уже сданный экзамен назначался
 * заново: план предлагал подготовку, регистрацию и сдачу человеку, который
 * сдал экзамен вчера и ждёт результат. Состояние экзамена — часть входа
 * планировщика, а не деталь профиля.
 */
export function chainForExam(key: string, progress: ExamProgress | undefined): string[] {
  if (!progress) return FULL_CHAIN(key);

  switch (progress.state) {
    case 'scheduled':
      // Регистрация уже сделана: остаётся доготовиться, прийти и дождаться.
      return [`${key}:prepare`, `${key}:take`, `${key}:result`];
    case 'taken_awaiting_result':
      // Работа выполнена. Остаётся внешнее ожидание и проверка результата.
      return [`${key}:result`];
    case 'result_reported':
      // Результат есть, но условие не закрыто — значит балла не хватает
      // или он истекает к контрольной дате. Нужна полноценная пересдача.
      return FULL_CHAIN(key);
    case 'expired':
    case 'not_taken':
    default:
      return FULL_CHAIN(key);
  }
}

/**
 * Сопоставление листа требований с цепочкой действий, которая его закрывает.
 * Возвращает семантические ключи в порядке зависимости.
 */
export function templatesForCountingKey(
  countingKey: string,
  exams?: ReadonlyMap<string, ExamProgress>,
): string[] {
  const chain = (key: string) => chainForExam(key, exams?.get(key));

  if (countingKey.startsWith('lang:ielts')) return chain('ielts');
  if (countingKey.startsWith('lang:toefl')) return chain('toefl');
  if (countingKey.startsWith('exam:ent')) return chain('ent');
  if (countingKey === 'doc:school_certificate') return ['doc:school_certificate'];
  if (countingKey === 'doc:certified_translation') {
    return ['doc:school_certificate', 'doc:certified_translation'];
  }
  if (countingKey.startsWith('gpa:')) return ['gpa:improve'];
  if (countingKey.startsWith('subject:')) return ['subject:study'];
  if (countingKey.startsWith('level:')) return ['doc:school_certificate'];
  return [];
}

/**
 * Какой структурированный результат ожидает действие.
 *
 * Один источник правды для трёх мест: формы ввода, серверной проверки
 * («ЕНТ 999 в задаче получения аттестата») и подписей. Раньше форма и
 * проверка знали об этом каждая своё, и результат чужого вида проходил.
 */
export type ExpectedResult =
  | { readonly kind: 'exam_score'; readonly examKind: string; readonly scaleId: string; readonly components: readonly string[] }
  | { readonly kind: 'document'; readonly documentKind: string }
  | { readonly kind: 'grade'; readonly scaleId: string }
  | { readonly kind: 'subject' };

const EXAM_SCALE_BY_KEY: Readonly<Record<string, { scaleId: string; components: string[] }>> = {
  ielts: { scaleId: 'ielts_0_9', components: ['writing'] },
  toefl: { scaleId: 'toefl_0_120', components: [] },
  ent: { scaleId: 'ent_0_140', components: [] },
};

export function expectedResultFor(semanticKey: string): ExpectedResult | null {
  if (semanticKey.endsWith(':result')) {
    const key = semanticKey.slice(0, -':result'.length);
    const scale = EXAM_SCALE_BY_KEY[key];
    const examKind = EXAM_KIND_BY_KEY[key];
    if (!scale || !examKind) return null;
    return { kind: 'exam_score', examKind, scaleId: scale.scaleId, components: scale.components };
  }
  if (semanticKey.startsWith('doc:')) {
    return { kind: 'document', documentKind: semanticKey.slice('doc:'.length) };
  }
  if (semanticKey === 'gpa:improve') return { kind: 'grade', scaleId: 'gpa_5' };
  if (semanticKey === 'subject:study') return { kind: 'subject' };
  return null;
}
