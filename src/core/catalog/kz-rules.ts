/**
 * Государственные правила приёма в вузы Казахстана.
 *
 * Условия поступления в казахстанский вуз задаются не вузом, а общими
 * правилами: структурой ЕНТ, порогами по блокам и парой профильных предметов,
 * закреплённой за группой образовательных программ. Вуз сверху добавляет своё
 * — порог на платное, внутренний экзамен, стоимость, — но общая часть одна для
 * всех, и держать её нужно в одном месте, а не переписывать в каждом дереве
 * требований.
 *
 * Источники (проверено 18 сентября 2026):
 *  • перечень групп образовательных программ с профильными предметами —
 *    Национальный центр тестирования, testcenter.kz (PDF от 05.2026);
 *  • структура ЕНТ и пороги по блокам — там же;
 *  • минимальные пороговые баллы конкурса на грант 2026 — приказ МНВО,
 *    изложение: tengrinews.kz, qrnews.kz.
 *
 * Здесь только ПРАВИЛА. Проходные баллы конкурса сюда не попадают: они
 * становятся известны после конкурса и на следующий год другие — обещать их
 * нельзя.
 */

/** Блок ЕНТ: сколько заданий, сколько баллов и ниже какого балла не проходят. */
export interface EntBlock {
  readonly id: string;
  readonly title: string;
  readonly questions: number;
  readonly maxScore: number;
  /** Пороговый балл по блоку: ниже — не допускают независимо от суммы. */
  readonly minScore: number;
  readonly required: boolean;
}

export const ENT_BLOCKS: readonly EntBlock[] = [
  { id: 'history_kz', title: 'История Казахстана', questions: 20, maxScore: 20, minScore: 5, required: true },
  { id: 'math_literacy', title: 'Математическая грамотность', questions: 10, maxScore: 10, minScore: 3, required: true },
  { id: 'reading_literacy', title: 'Грамотность чтения', questions: 10, maxScore: 10, minScore: 3, required: true },
  { id: 'profile_1', title: 'Первый профильный предмет', questions: 40, maxScore: 50, minScore: 5, required: true },
  { id: 'profile_2', title: 'Второй профильный предмет', questions: 40, maxScore: 50, minScore: 5, required: true },
];

/** Максимум ЕНТ: сумма блоков. */
export const ENT_MAX_SCORE = ENT_BLOCKS.reduce((sum, b) => sum + b.maxScore, 0);

/**
 * Минимальный балл ЕНТ для участия в конкурсе на грант — 2026.
 *
 * Это ПОРОГ допуска, а не проходной балл. Проходной определяется конкурсом:
 * он зависит от числа грантов и результатов всех подавших.
 */
export type GrantThreshold =
  | 'pedagogy_law'
  | 'healthcare'
  | 'national_university'
  | 'other';

export const ENT_GRANT_THRESHOLD: Readonly<Record<GrantThreshold, number>> = {
  pedagogy_law: 75,
  healthcare: 70,
  national_university: 65,
  other: 50,
};

/**
 * Группа образовательных программ и закреплённая за ней пара профильных
 * предметов ЕНТ.
 *
 * Пара не выбирается свободно: она определяется специальностью. Сдавший
 * «математика + информатика» не может подать на специальность, где нужна
 * «математика + физика», — и менять пару после первой попытки основного
 * этапа нельзя.
 */
export interface ProgramGroup {
  readonly code: string;
  readonly title: string;
  readonly profileSubjects: readonly [string, string];
}

export const PROGRAM_GROUPS: readonly ProgramGroup[] = [
  { code: 'В001', title: 'Педагогика и психология', profileSubjects: ['biology', 'geography'] },
  { code: 'В002', title: 'Дошкольное обучение и воспитание', profileSubjects: ['biology', 'geography'] },
  { code: 'В003', title: 'Педагогика и методика начального обучения', profileSubjects: ['biology', 'geography'] },
  { code: 'В004', title: 'Подготовка учителей начальной военной подготовки', profileSubjects: ['creative_exam', 'creative_exam'] },
  { code: 'В005', title: 'Подготовка учителей физической культуры', profileSubjects: ['creative_exam', 'creative_exam'] },
  { code: 'В006', title: 'Подготовка учителей музыки', profileSubjects: ['creative_exam', 'creative_exam'] },
  { code: 'В007', title: 'Подготовка учителей художественного труда и черчения', profileSubjects: ['creative_exam', 'creative_exam'] },
  { code: 'В008', title: 'Подготовка учителей основы права и экономики', profileSubjects: ['world_history', 'geography'] },
  { code: 'В009', title: 'Подготовк а учителей математики', profileSubjects: ['math', 'physics'] },
  { code: 'В010', title: 'Подготовка учителей физики', profileSubjects: ['physics', 'math'] },
  { code: 'В011', title: 'Подготовка учителей информатики', profileSubjects: ['math', 'informatics'] },
  { code: 'В012', title: 'Подготовка учителей химии', profileSubjects: ['chemistry', 'biology'] },
  { code: 'В013', title: 'Подготовка учителей биологии', profileSubjects: ['biology', 'chemistry'] },
  { code: 'В014', title: 'Подготовка учителей географии', profileSubjects: ['geography', 'world_history'] },
  { code: 'В015', title: 'Подготовка учителей по гуманитарным ам', profileSubjects: ['world_history', 'geography'] },
  { code: 'В016', title: 'Подготовка учителей казахского языка и литературы', profileSubjects: ['kazakh_language', 'kazakh_literature'] },
  { code: 'В017', title: 'Подготовка учителей русского языка и литературы', profileSubjects: ['russian_language', 'russian_literature'] },
  { code: 'В018', title: 'Подготовка учителей иностранного языка', profileSubjects: ['foreign_language', 'world_history'] },
  { code: 'В019', title: 'Подготовка социальных педагогов', profileSubjects: ['biology', 'geography'] },
  { code: 'В020', title: 'Специальная педагогика', profileSubjects: ['biology', 'geography'] },
  { code: 'В120', title: 'Подготовка педагогов профессионального обучения (по профилю)', profileSubjects: ['physics', 'math'] },
  { code: 'В021', title: 'Исполнительское искусство', profileSubjects: ['creative_exam', 'creative_exam'] },
  { code: 'В022', title: 'Музыковедение', profileSubjects: ['creative_exam', 'creative_exam'] },
  { code: 'В023', title: 'Режиссура, арт - менеджмент', profileSubjects: ['creative_exam', 'creative_exam'] },
  { code: 'В024', title: 'Искусствоведение', profileSubjects: ['creative_exam', 'creative_exam'] },
  { code: 'В025', title: 'Дирижирование', profileSubjects: ['creative_exam', 'creative_exam'] },
  { code: 'В026', title: 'Композиция', profileSubjects: ['creative_exam', 'creative_exam'] },
  { code: 'В027', title: 'Театральное искусство', profileSubjects: ['creative_exam', 'creative_exam'] },
  { code: 'В028', title: 'Хореография', profileSubjects: ['creative_exam', 'creative_exam'] },
  { code: 'В029', title: 'Аудиовизуальные средства и медиа производство', profileSubjects: ['creative_exam', 'creative_exam'] },
  { code: 'В030', title: 'Изобразительное искусство', profileSubjects: ['creative_exam', 'creative_exam'] },
  { code: 'В031', title: 'Мода, дизайн', profileSubjects: ['creative_exam', 'creative_exam'] },
  { code: 'В099', title: 'Инструментальное исполнительство', profileSubjects: ['creative_exam', 'creative_exam'] },
  { code: 'В100', title: 'Вокальное искусство', profileSubjects: ['creative_exam', 'creative_exam'] },
  { code: 'В101', title: 'Традиционное музыкальное искусство', profileSubjects: ['creative_exam', 'creative_exam'] },
  { code: 'В102', title: 'Искусство эстрады', profileSubjects: ['creative_exam', 'creative_exam'] },
  { code: 'В103', title: 'Режиссура кино и ТВ', profileSubjects: ['creative_exam', 'creative_exam'] },
  { code: 'В104', title: 'Режиссура сценических искусств и цирка', profileSubjects: ['creative_exam', 'creative_exam'] },
  { code: 'В105', title: 'Режиссура анимации', profileSubjects: ['creative_exam', 'creative_exam'] },
  { code: 'В106', title: 'Операторское и фото искусство', profileSubjects: ['creative_exam', 'creative_exam'] },
  { code: 'В107', title: 'Медиаискусство и цифровые технологии', profileSubjects: ['creative_exam', 'creative_exam'] },
  { code: 'В108', title: 'Сценография', profileSubjects: ['creative_exam', 'creative_exam'] },
  { code: 'В109', title: 'Декоративное искусство', profileSubjects: ['creative_exam', 'creative_exam'] },
  { code: 'В110', title: 'Фэшн дизайн', profileSubjects: ['creative_exam', 'creative_exam'] },
  { code: 'В032', title: 'Философия и этика', profileSubjects: ['world_history', 'geography'] },
  { code: 'В033', title: 'Религия и теология', profileSubjects: ['creative_exam', 'creative_exam'] },
  { code: 'В034', title: 'История', profileSubjects: ['world_history', 'geography'] },
  { code: 'В134', title: 'Археология и этнология', profileSubjects: ['world_history', 'geography'] },
  { code: 'В035', title: 'Тюркология', profileSubjects: ['world_history', 'foreign_language'] },
  { code: 'В135', title: 'Востоковедение', profileSubjects: ['world_history', 'foreign_language'] },
  { code: 'В036', title: 'Переводческое дело', profileSubjects: ['foreign_language', 'world_history'] },
  { code: 'В037', title: 'Филология', profileSubjects: ['kazakh_or_russian_language', 'kazakh_or_russian_literature'] },
  { code: 'В038', title: 'Социология', profileSubjects: ['math', 'geography'] },
  { code: 'В039', title: 'Культурология', profileSubjects: ['world_history', 'foreign_language'] },
  { code: 'В040', title: 'Политология', profileSubjects: ['world_history', 'foreign_language'] },
  { code: 'В140', title: 'Международные отношения и дипломатия', profileSubjects: ['world_history', 'foreign_language'] },
  { code: 'В041', title: 'Психология', profileSubjects: ['biology', 'geography'] },
  { code: 'В042', title: 'Журналистика и репортерское дело', profileSubjects: ['creative_exam', 'creative_exam'] },
  { code: 'В043', title: 'Библиотечное дело, обработка информации и архивное дело', profileSubjects: ['kazakh_or_russian_language', 'kazakh_or_russian_literature'] },
  { code: 'В044', title: 'Менеджмент и управление', profileSubjects: ['math', 'geography'] },
  { code: 'В045', title: 'Аудит и налогообложение', profileSubjects: ['math', 'geography'] },
  { code: 'В145', title: 'Государственный аудит', profileSubjects: ['math', 'geography'] },
  { code: 'В046', title: 'Финансы, экономика, банковское и страховое дело', profileSubjects: ['math', 'geography'] },
  { code: 'В047', title: 'Маркетинг и реклама', profileSubjects: ['math', 'geography'] },
  { code: 'В048', title: 'Трудовые навыки', profileSubjects: ['math', 'geography'] },
  { code: 'В049', title: 'Право', profileSubjects: ['world_history', 'law_basics'] },
  { code: 'В050', title: 'Биологические и смежные науки', profileSubjects: ['biology', 'chemistry'] },
  { code: 'В051', title: 'Окружающая среда', profileSubjects: ['biology', 'geography'] },
  { code: 'В052', title: 'Наука о земле', profileSubjects: ['math', 'geography'] },
  { code: 'В053', title: 'Химия', profileSubjects: ['chemistry', 'biology'] },
  { code: 'В054', title: 'Физика', profileSubjects: ['physics', 'math'] },
  { code: 'В055', title: 'Математика и статистика', profileSubjects: ['math', 'physics'] },
  { code: 'В056', title: 'Механика', profileSubjects: ['math', 'physics'] },
  { code: 'В057', title: 'Информационные технологии', profileSubjects: ['math', 'informatics'] },
  { code: 'В058', title: 'Информационная безопасность', profileSubjects: ['math', 'informatics'] },
  { code: 'В158', title: 'Криптология', profileSubjects: ['math', 'informatics'] },
  { code: 'В059', title: 'Коммуникации и коммуникационные технологии', profileSubjects: ['math', 'physics'] },
  { code: 'В060', title: 'Химическая инженерия и процессы', profileSubjects: ['chemistry', 'physics_or_biology'] },
  { code: 'В061', title: 'Материаловедение и технологии', profileSubjects: ['math', 'physics'] },
  { code: 'В062', title: 'Электротехника и энергетика', profileSubjects: ['math', 'physics'] },
  { code: 'В063', title: 'Электротехника и автоматизация', profileSubjects: ['math', 'physics'] },
  { code: 'В064', title: 'Механика и металлообработка', profileSubjects: ['math', 'physics'] },
  { code: 'В065', title: 'Транспортная техника и технологии', profileSubjects: ['math', 'physics'] },
  { code: 'В066', title: 'Морской транспорт и технологии', profileSubjects: ['math', 'physics'] },
  { code: 'В067', title: 'Воздушный транспорт и технологии', profileSubjects: ['math', 'physics'] },
  { code: 'В167', title: 'Летная эксплуатация летательных аппаратов и двигателей*****', profileSubjects: ['math', 'physics'] },
  { code: 'В165', title: 'Магистральные сети и инфраструктура', profileSubjects: ['math', 'physics'] },
  { code: 'В166', title: 'Транспортные сооружения', profileSubjects: ['math', 'physics'] },
  { code: 'В068', title: 'Производство продуктов питания', profileSubjects: ['biology', 'chemistry'] },
  { code: 'В069', title: 'Производство материалов (стекло, бумага, пластик, дерево)', profileSubjects: ['math', 'physics'] },
  { code: 'В070', title: 'Текстиль: одежда, обувь и кожаные изделия', profileSubjects: ['math', 'physics'] },
  { code: 'В071', title: 'Горное дело и добыча полезных ископаемых', profileSubjects: ['math', 'physics'] },
  { code: 'В072', title: 'Технология фармацевтического производства', profileSubjects: ['chemistry', 'biology'] },
  { code: 'В073', title: 'Архитектура', profileSubjects: ['creative_exam', 'creative_exam'] },
  { code: 'В173', title: 'Гидромелиорация', profileSubjects: ['math', 'physics'] },
  { code: 'В175', title: 'Водоснабжение и водоотведение', profileSubjects: ['math', 'physics'] },
  { code: 'В074', title: 'Градостроительство, строительные работы и гражданское строительство', profileSubjects: ['math', 'physics'] },
  { code: 'В126', title: 'Транспортное строительство', profileSubjects: ['math', 'physics'] },
  { code: 'В176', title: 'Гидротехническое строительство и управление водными ресурсами', profileSubjects: ['math', 'physics'] },
  { code: 'В075', title: 'Кадастр и землеустройство', profileSubjects: ['math', 'geography'] },
  { code: 'В076', title: 'Стандартизация, сертификация и метрология (по отраслям)', profileSubjects: ['math', 'physics'] },
  { code: 'В077', title: 'Растениеводство', profileSubjects: ['biology', 'chemistry'] },
  { code: 'В078', title: 'Животноводство', profileSubjects: ['biology', 'chemistry'] },
  { code: 'В079', title: 'Лесное хозяйство', profileSubjects: ['biology', 'geography'] },
  { code: 'В080', title: 'Рыбное хозяйство', profileSubjects: ['biology', 'chemistry'] },
  { code: 'В081', title: 'Землеустройство', profileSubjects: ['math', 'physics'] },
  { code: 'В082', title: 'Водные ресурсы и водопользования', profileSubjects: ['math', 'physics'] },
  { code: 'В183', title: 'Агроинженерия', profileSubjects: ['math', 'physics'] },
  { code: 'В083', title: 'Ветеринария', profileSubjects: ['biology', 'chemistry'] },
  { code: 'В091', title: 'Туризм', profileSubjects: ['geography', 'foreign_language'] },
  { code: 'В092', title: 'Досуг', profileSubjects: ['creative_exam', 'creative_exam'] },
  { code: 'В093', title: 'Ресторанное дело и гостиничный бизнес', profileSubjects: ['geography', 'foreign_language'] },
  { code: 'В094', title: 'Санитарно - профилактические мероприятия', profileSubjects: ['math', 'physics'] },
  { code: 'В095', title: 'Транспортные услуги', profileSubjects: ['math', 'geography'] },
  { code: 'В090', title: 'Социальная работа', profileSubjects: ['biology', 'geography'] },
  { code: 'В098', title: 'Спорт', profileSubjects: ['creative_exam', 'creative_exam'] },
  { code: 'В084', title: 'Сестринское дело', profileSubjects: ['biology', 'chemistry'] },
  { code: 'В085', title: 'Фармация', profileSubjects: ['biology', 'chemistry'] },
  { code: 'ВМ086', title: 'Медицина', profileSubjects: ['biology', 'chemistry'] },
  { code: 'ВМ087', title: 'Стоматология', profileSubjects: ['biology', 'chemistry'] },
  { code: 'ВМ088', title: 'Педиатрия', profileSubjects: ['biology', 'chemistry'] },
  { code: 'В089', title: 'Общественное здоровье', profileSubjects: ['biology', 'chemistry'] },
  { code: 'ВМ089', title: 'Медико - профилактическое дело', profileSubjects: ['biology', 'chemistry'] },
  { code: 'В096', title: 'Правоохранительная деятельность', profileSubjects: ['world_history', 'law_basics'] },
  { code: 'В097', title: 'Пожарная безопасность', profileSubjects: ['math', 'physics'] },
];

const BY_CODE = new Map(PROGRAM_GROUPS.map((g) => [g.code, g]));

/** Группа по коду. Неизвестный код — null: выдумывать пару нельзя. */
export function programGroup(code: string): ProgramGroup | null {
  return BY_CODE.get(code) ?? null;
}

/* ------------------------------------------------------------------ */
/* Национальный календарь приёма                                       */
/* ------------------------------------------------------------------ */

/**
 * Приём в казахстанские вузы — это ОДНА общая кампания, а не расписание
 * каждого вуза по отдельности.
 *
 * Абитуриент сдаёт ЕНТ в общегосударственные сроки, подаёт ОДНО заявление на
 * конкурс грантов в окно 13–20 июля и после объявления итогов несёт оригиналы
 * в выбранный вуз. Вуз добавляет сверху только свои сроки на платное и
 * внутренние экзамены. Поэтому календарь живёт здесь, а не в карточке вуза.
 *
 * Даты хранятся как «месяц-день» цикла 2026 года: правила ежегодно повторяют
 * структуру, но точные числа объявляются приказом на каждый цикл. Для другого
 * года календарь помечается предварительным — выдавать прошлогоднее число за
 * подтверждённое нельзя.
 *
 * Источники (проверено 18 сентября 2026): Национальный центр тестирования
 * (testcenter.kz), приказ о пороговых баллах 2026, публикации МНВО о сроках
 * приёмной кампании 2026.
 */

/** Год, по приказам которого записаны даты. */
export const CALENDAR_REFERENCE_YEAR = 2026;

/** Окно «месяц-день» внутри цикла. */
export interface CalendarWindow {
  readonly from: string;
  readonly to: string;
}

export interface EntStage {
  readonly id: string;
  readonly title: string;
  /** Окно приёма заявлений на этап. null — окно объявляется отдельно. */
  readonly registration: CalendarWindow | null;
  readonly testing: CalendarWindow;
  /** Идёт ли результат в конкурс на государственный грант. */
  readonly countsForGrant: boolean;
  /** Сколько попыток даёт этап. */
  readonly attempts: number;
  readonly note: string;
}

export const ENT_STAGES: readonly EntStage[] = [
  {
    id: 'january',
    title: 'Январский этап',
    registration: null,
    testing: { from: '01-10', to: '02-10' },
    countsForGrant: false,
    attempts: 1,
    note: 'Результат годится для платного отделения, в конкурсе на грант не участвует.',
  },
  {
    id: 'march',
    title: 'Мартовский этап',
    registration: { from: '02-15', to: '02-25' },
    testing: { from: '03-01', to: '04-06' },
    countsForGrant: false,
    attempts: 1,
    note: 'Результат годится для платного отделения, в конкурсе на грант не участвует.',
  },
  {
    id: 'main',
    title: 'Основной этап',
    registration: { from: '04-10', to: '04-25' },
    testing: { from: '05-10', to: '07-10' },
    countsForGrant: true,
    attempts: 2,
    note:
      'Единственный этап, результат которого идёт в конкурс на грант. Две попытки, ' +
      'в конкурсе учитывается лучший сертификат. Профильные предметы между попытками ' +
      'менять нельзя.',
  },
  {
    id: 'august',
    title: 'Августовский этап',
    registration: { from: '07-25', to: '08-05' },
    testing: { from: '08-10', to: '08-20' },
    countsForGrant: false,
    attempts: 1,
    note: 'Последняя возможность в цикле и только для платного отделения.',
  },
];

export type AdmissionStepKind =
  | 'ent_registration'
  | 'ent_testing'
  | 'creative_exam'
  | 'special_exam'
  | 'grant_application'
  | 'grant_results'
  | 'enrollment';

export interface AdmissionStep {
  readonly id: string;
  readonly title: string;
  readonly kind: AdmissionStepKind;
  readonly window: CalendarWindow;
  /** Обязателен для всех или только для части абитуриентов. */
  readonly appliesTo: 'everyone' | 'grant_applicants' | 'creative_programs' | 'special_programs';
  readonly note: string;
}

export const ADMISSION_STEPS: readonly AdmissionStep[] = [
  {
    id: 'creative-exam',
    title: 'Творческий экзамен',
    kind: 'creative_exam',
    window: { from: '07-07', to: '07-20' },
    appliesTo: 'creative_programs',
    note:
      'Нужен группам, где профильные предметы заменены творческим экзаменом. ' +
      'Претендующим на грант надо закрыть его до 20 июля; для платного приём ' +
      'экзаменов продолжается до середины августа.',
  },
  {
    id: 'special-exam',
    title: 'Специальный экзамен',
    kind: 'special_exam',
    window: { from: '06-20', to: '07-20' },
    appliesTo: 'special_programs',
    note:
      'Требуется частью программ здравоохранения и педагогики. Для конкурса на ' +
      'грант должен быть сдан до 20 июля.',
  },
  {
    id: 'grant-application',
    title: 'Заявление на конкурс образовательных грантов',
    kind: 'grant_application',
    window: { from: '07-13', to: '07-20' },
    appliesTo: 'grant_applicants',
    note:
      'Одно заявление на всю страну: до четырёх групп образовательных программ и ' +
      'до четырёх вузов, строго по приоритетам. Подаётся через приёмную комиссию ' +
      'или портал электронного правительства.',
  },
  {
    id: 'grant-results',
    title: 'Итоги конкурса грантов',
    kind: 'grant_results',
    window: { from: '08-07', to: '08-10' },
    appliesTo: 'grant_applicants',
    note: 'Проходной балл становится известен только здесь: он зависит от числа грантов и результатов всех участников.',
  },
  {
    id: 'enrollment',
    title: 'Подача документов в вуз и зачисление',
    kind: 'enrollment',
    window: { from: '06-20', to: '08-25' },
    appliesTo: 'everyone',
    note:
      'Общее окно приёма документов. Получившие грант несут оригиналы в выбранный ' +
      'вуз, поступающие на платное подают документы напрямую.',
  },
];

/**
 * Сколько строк в заявлении на грант.
 *
 * Все четыре обязаны иметь ОДИНАКОВУЮ пару профильных предметов: заявление
 * собирается под сданный ЕНТ, а не наоборот.
 */
export const GRANT_APPLICATION_CHOICES = 4;

export interface CalendarDate {
  readonly id: string;
  readonly title: string;
  readonly from: string;
  readonly to: string;
  readonly note: string;
  /** Даты взяты из другого цикла и на этот год официально не подтверждены. */
  readonly preliminary: boolean;
}

/**
 * Календарь кампании на конкретный год.
 *
 * Для года, отличного от эталонного, даты помечаются предварительными: числа
 * повторяются из цикла, по которому записаны правила, а приказ на нужный год
 * может их сдвинуть.
 */
export function admissionCalendar(year: number): CalendarDate[] {
  const preliminary = year !== CALENDAR_REFERENCE_YEAR;
  const out: CalendarDate[] = [];

  for (const stage of ENT_STAGES) {
    if (stage.registration) {
      out.push({
        id: `ent-${stage.id}-registration`,
        title: `ЕНТ, ${stage.title.toLowerCase()}: приём заявлений`,
        from: `${year}-${stage.registration.from}`,
        to: `${year}-${stage.registration.to}`,
        note: stage.note,
        preliminary,
      });
    }
    out.push({
      id: `ent-${stage.id}-testing`,
      title: `ЕНТ, ${stage.title.toLowerCase()}`,
      from: `${year}-${stage.testing.from}`,
      to: `${year}-${stage.testing.to}`,
      note: stage.note,
      preliminary,
    });
  }

  for (const step of ADMISSION_STEPS) {
    out.push({
      id: step.id,
      title: step.title,
      from: `${year}-${step.window.from}`,
      to: `${year}-${step.window.to}`,
      note: step.note,
      preliminary,
    });
  }

  return out.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
}

/** Этап ЕНТ, результат которого можно подать на грант. */
export function grantEligibleStage(): EntStage {
  const stage = ENT_STAGES.find((s) => s.countsForGrant);
  if (!stage) throw new Error('В календаре нет этапа ЕНТ для конкурса на грант');
  return stage;
}

/* ------------------------------------------------------------------ */
/* Профильные пары                                                     */
/* ------------------------------------------------------------------ */

/**
 * Пара профильных предметов как самостоятельная сущность.
 *
 * Абитуриент выбирает пару один раз и ею ограничен: все четыре строки
 * заявления на грант обязаны иметь одну и ту же пару. Поэтому пара — не
 * производная от специальности, а ключ, по которому специальности доступны.
 */
export interface ProfilePair {
  readonly id: string;
  readonly subjects: readonly [string, string];
  /** Группы образовательных программ, доступные с этой парой. */
  readonly groups: readonly string[];
}

/** Ключ пары. Порядок предметов в перечне значим, поэтому не сортируем. */
export function profilePairId(first: string, second: string): string {
  return `${first}+${second}`;
}

/**
 * Совпадают ли пары.
 *
 * Сравнение по составу, а не по порядку: перечень называет первый и второй
 * профильный предмет, но сданный набор от перестановки не меняется.
 */
export function samePair(
  a: readonly [string, string],
  b: readonly [string, string],
): boolean {
  return (a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0]);
}

const PAIRS: ProfilePair[] = [];
for (const group of PROGRAM_GROUPS) {
  const [first, second] = group.profileSubjects;
  // Перечень называет первый и второй профильный предмет, но для абитуриента
  // «математика и физика» и «физика и математика» — одна и та же пара.
  // Без схлопывания по составу в анкете было бы два одинаковых варианта.
  const existing = PAIRS.find((p) => samePair(p.subjects, [first, second]));
  if (existing) {
    (existing.groups as string[]).push(group.code);
  } else {
    PAIRS.push({ id: profilePairId(first, second), subjects: [first, second], groups: [group.code] });
  }
}

export const PROFILE_PAIRS: readonly ProfilePair[] = PAIRS;

export function findProfilePair(id: string): ProfilePair | null {
  return PROFILE_PAIRS.find((p) => p.id === id) ?? null;
}

/**
 * Пара, с которой доступна группа образовательных программ.
 *
 * Поиск идёт по составу, а не по ключу: после схлопывания пара «физика и
 * математика» хранится под ключом «математика+физика», и поиск по ключу
 * перевёрнутой пары не нашёл бы ничего.
 */
export function pairForGroup(code: string): ProfilePair | null {
  const group = programGroup(code);
  if (!group) return null;
  return PROFILE_PAIRS.find((p) => samePair(p.subjects, group.profileSubjects)) ?? null;
}

