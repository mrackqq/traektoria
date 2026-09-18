/**
 * Синтетический каталог демонстрационного контура.
 *
 * Университеты, программы и ссылки на приёмные комиссии — НАСТОЯЩИЕ.
 * Пороговые баллы, стоимость и сроки — ОРИЕНТИРОВОЧНЫЕ: они нужны, чтобы
 * механика подбора и планирования работала на правдоподобных величинах,
 * но официальными значениями не являются.
 *
 * Поэтому каждый источник помечен `isDemo: true` и ведёт на реальную страницу
 * приёма соответствующего вуза: пользователь видит и пометку «требует
 * подтверждения», и адрес, по которому значение можно проверить. Кейс прямо
 * допускает такой вариант — «фактические требования и дедлайны сопровождаются
 * источниками либо пометкой о демонстрационных данных».
 *
 * Каталог строится от ПЕРИОДА ОБНОВЛЕНИЯ, а не от момента чтения.
 *
 * Год набора и даты проверки источников не вписаны руками: иначе через год
 * демонстрация показывала бы кампании в прошлом, а все источники —
 * просроченными. Но и привязывать их к текущей миллисекунде нельзя.
 *
 * Каталог — это опубликованный набор данных со своей версией. Пока идёт один
 * период обновления, версия и метаданные неизменны, поэтому `catalogScopeHash`
 * и `inputHash` стабильны. Раньше `verifiedAt` считался от `snapshotAt`, хэш
 * менялся при каждом запросе, и объяснения пересчитывались на каждом переходе
 * между страницами, хотя ответы пользователя не менялись.
 *
 * Часы приложения при этом остаются настоящими: квантуется публикация
 * каталога, а не время расчёта.
 *
 * REL-03: реальные образовательные данные не считаются подготовленными только
 * потому, что есть схема. Здесь их и нет — это витрина для проверки ядра.
 */

import { CALENDAR_REFERENCE_YEAR, ENT_BLOCKS, admissionCalendar, programGroup } from './kz-rules';
import { subjectRu } from '../i18n/labels';
import { fromMajor } from '../kernel/money';
import type { Deadline, PlainDate } from '../kernel/time';
import type {
  AdmissionPath,
  CatalogCostItem,
  CatalogSnapshot,
  Intake,
  Program,
  Source,
  SourceConflict,
  University,
} from './types';
import type { RequirementGroup } from '../kernel/requirement';

const DAY = 86_400_000;

/**
 * Период обновления каталога.
 *
 * Сутки: демонстрационный каталог «переиздаётся» раз в день, и внутри дня его
 * версия постоянна. Для реального каталога это был бы интервал публикации
 * поставщика данных.
 */
export const CATALOG_REFRESH_PERIOD_MS = DAY;

/**
 * Версия самих данных. Меняется руками при правке состава каталога —
 * так правка данных инвалидирует кеши, не дожидаясь следующего периода.
 */
export const CATALOG_DATA_VERSION = '3';

/** Начало текущего периода обновления для указанного момента. */
export function catalogEpochMs(snapshotAt: string): number {
  const ms = Date.parse(snapshotAt);
  const safe = Number.isNaN(ms) ? Date.now() : ms;
  return Math.floor(safe / CATALOG_REFRESH_PERIOD_MS) * CATALOG_REFRESH_PERIOD_MS;
}

export function catalogEpoch(snapshotAt: string): string {
  return new Date(catalogEpochMs(snapshotAt)).toISOString();
}

/** Версия опубликованного каталога: данные + период обновления. */
export function catalogVersion(snapshotAt: string): string {
  return `demo-v${CATALOG_DATA_VERSION}-${catalogEpoch(snapshotAt).slice(0, 10)}`;
}

/* ------------------------------------------------------------------ */
/* Источники                                                           */
/* ------------------------------------------------------------------ */

interface SourceSpec {
  readonly id: string;
  readonly title: string;
  readonly publisher: string;
  /** Страница приёмной комиссии, на которой значение можно проверить. */
  readonly url: string;
  readonly dataKind: Source['dataKind'];
  /** Сколько дней назад источник проверялся в последний раз. */
  readonly verifiedDaysAgo: number;
  readonly freshness?: Source['freshness'];
  readonly excerpt?: string;
}

/** Официальные страницы приёма. Значения в каталоге — ориентировочные. */
const ADMISSION_PAGES = {
  nu: 'https://nu.edu.kz/admissions',
  kbtu: 'https://kbtu.edu.kz/ru/admission',
  aitu: 'https://astanait.edu.kz/admission/',
  sdu: 'https://sdu.edu.kz/admission/',
  satbayev: 'https://satbayev.university/ru/admission',
  iitu: 'https://iitu.edu.kz/ru/abiturientu/',
} as const satisfies Record<string, string>;

/** Политика приёма NU: первоисточник условий, а не пересказ на странице. */
const NU_POLICY_URL =
  'https://nu.edu.kz/wp-content/uploads/2026/04/admission-policy-and-procedures-to-the-nazarbayev-university-foundation-year-program-and-undergraduate-program-of-nu-1.pdf';

const SOURCE_SPECS: readonly SourceSpec[] = [
  { id: 'src-kz-rules', title: 'Сроки приёмной кампании и конкурса грантов', publisher: 'Национальный центр тестирования', url: 'https://testcenter.kz/?page_id=15638&lang=ru', dataKind: 'deadline', verifiedDaysAgo: 0,
    excerpt: 'Заявление на конкурс грантов подаётся 13–20 июля, итоги — начало августа, приём документов в вуз — до 25 августа.' },

  { id: 'src-nu-req', title: 'Политика приёма NUFYP и бакалавриата, приказ № 38-н/қ от 11.03.2026', publisher: 'Nazarbayev University', url: NU_POLICY_URL, dataKind: 'mandatory_requirement', verifiedDaysAgo: 0,
    excerpt: 'Приложение 1: IELTS не ниже 6.0 (writing 6.0), NUET — минимум 120 при 50 по каждому предмету, SAT 1240, ACT 26.' },
  { id: 'src-nu-dl', title: 'Сроки приёма: Nazarbayev University', publisher: 'Nazarbayev University', url: ADMISSION_PAGES['nu'], dataKind: 'deadline', verifiedDaysAgo: 0,
    excerpt: 'Сертификаты действительны, если не истекают к 1 августа соответствующего учебного года.' },
  { id: 'src-nu-cost', title: 'Стоимость обучения и финансовая поддержка', publisher: 'Nazarbayev University', url: 'https://nu.edu.kz/admissions/fees-and-funding/', dataKind: 'cost', verifiedDaysAgo: 0,
    excerpt: 'Foundation Year — 12 000 USD в год, бакалавриат — 15 000 USD в год.' },

  { id: 'src-kbtu-req', title: 'Условия приёма: КБТУ', publisher: 'Казахстанско-Британский технический университет', url: ADMISSION_PAGES['kbtu'], dataKind: 'mandatory_requirement', verifiedDaysAgo: 3 },
  { id: 'src-kbtu-dl', title: 'Сроки приёма: КБТУ', publisher: 'Казахстанско-Британский технический университет', url: ADMISSION_PAGES['kbtu'], dataKind: 'deadline', verifiedDaysAgo: 1 },
  { id: 'src-kbtu-alt', title: 'Порог на платное отделение: сторонний агрегатор', publisher: 'Сторонний агрегатор (не вуз)', url: ADMISSION_PAGES['kbtu'], dataKind: 'mandatory_requirement', verifiedDaysAgo: 1 },
  { id: 'src-kbtu-cost', title: 'Стоимость обучения: КБТУ', publisher: 'Казахстанско-Британский технический университет', url: ADMISSION_PAGES['kbtu'], dataKind: 'cost', verifiedDaysAgo: 8 },

  { id: 'src-aitu-req', title: 'Условия приёма: Astana IT University', publisher: 'Astana IT University', url: ADMISSION_PAGES['aitu'], dataKind: 'mandatory_requirement', verifiedDaysAgo: 2 },
  { id: 'src-aitu-dl', title: 'Сроки приёма: Astana IT University', publisher: 'Astana IT University', url: ADMISSION_PAGES['aitu'], dataKind: 'deadline', verifiedDaysAgo: 2 },
  { id: 'src-aitu-cost', title: 'Стоимость обучения: Astana IT University', publisher: 'Astana IT University', url: ADMISSION_PAGES['aitu'], dataKind: 'cost', verifiedDaysAgo: 13 },

  { id: 'src-sdu-req', title: 'Условия приёма: SDU University', publisher: 'SDU University', url: ADMISSION_PAGES['sdu'], dataKind: 'mandatory_requirement', verifiedDaysAgo: 4 },
  { id: 'src-sdu-dl', title: 'Сроки приёма: SDU University', publisher: 'SDU University', url: ADMISSION_PAGES['sdu'], dataKind: 'deadline', verifiedDaysAgo: 2 },
  { id: 'src-sdu-cost', title: 'Стоимость обучения: SDU University', publisher: 'SDU University', url: ADMISSION_PAGES['sdu'], dataKind: 'cost', verifiedDaysAgo: 16 },

  { id: 'src-satbayev-req', title: 'Условия приёма: Satbayev University', publisher: 'Satbayev University', url: ADMISSION_PAGES['satbayev'], dataKind: 'mandatory_requirement', verifiedDaysAgo: 5 },
  { id: 'src-satbayev-dl', title: 'Сроки приёма: Satbayev University', publisher: 'Satbayev University', url: ADMISSION_PAGES['satbayev'], dataKind: 'deadline', verifiedDaysAgo: 3 },
  { id: 'src-satbayev-cost', title: 'Стоимость обучения: Satbayev University', publisher: 'Satbayev University', url: ADMISSION_PAGES['satbayev'], dataKind: 'cost', verifiedDaysAgo: 21 },

  // DATA-06: намеренно устаревший источник обязательного требования.
  // Он показывает, что stale-условие даёт «неизвестно», а не «выполнено».
  { id: 'src-iitu-req', title: 'Условия приёма: МУИТ (давно не проверялось)', publisher: 'Международный университет информационных технологий', url: ADMISSION_PAGES['iitu'], dataKind: 'mandatory_requirement', verifiedDaysAgo: 29, freshness: 'stale' },
  { id: 'src-iitu-dl', title: 'Сроки приёма: МУИТ', publisher: 'Международный университет информационных технологий', url: ADMISSION_PAGES['iitu'], dataKind: 'deadline', verifiedDaysAgo: 2 },
  { id: 'src-iitu-cost', title: 'Стоимость обучения: МУИТ', publisher: 'Международный университет информационных технологий', url: ADMISSION_PAGES['iitu'], dataKind: 'cost', verifiedDaysAgo: 10 },

  // DATA-04: источники расходятся по этому сроку — см. SEED_CONFLICTS.

];

function buildSources(epochMs: number): Source[] {
  return SOURCE_SPECS.map((spec) => {
    // Отсчёт от начала периода публикации, а не от текущей миллисекунды:
    // источник не перепроверяется заново на каждый запрос страницы.
    const verifiedAt = new Date(epochMs - spec.verifiedDaysAgo * DAY).toISOString();
    return {
      id: spec.id,
      title: spec.title,
      url: spec.url,
      publisher: spec.publisher,
      dataKind: spec.dataKind,
      retrievedAt: verifiedAt,
      verifiedAt,
      verifiedBy: 'demo-reviewer',
      freshness: spec.freshness ?? 'fresh',
      isDemo: true,
      snapshotChecksum: `demo-${spec.id}`,
      ...(spec.excerpt ? { excerpt: spec.excerpt } : {}),
    };
  });
}

/**
 * DATA-04 / AC-09: два источника расходятся по одному и тому же числу.
 *
 * Это не выдуманная ситуация: страница вуза и агрегатор регулярно называют
 * разные пороги на платное отделение. Пока расхождение не разрешено, вывод
 * по условию не делается — вместо догадки показывается конфликт.
 */
function buildConflicts(baseYear: number, epochIso: string): SourceConflict[] {
  return [
    {
      id: 'conflict-kbtu-threshold',
      targetId: `kbtu-cs-${baseYear}-paid-ent-overall`,
      description:
        'Порог ЕНТ на платное отделение: страница приёмной комиссии называет 95 баллов, ' +
        'сторонний агрегатор — 85. Пока расхождение не разрешено, вывод по условию не делается.',
      versions: [
        { sourceId: 'src-kbtu-req', claim: 'ЕНТ от 95 баллов' },
        { sourceId: 'src-kbtu-alt', claim: 'ЕНТ от 85 баллов' },
      ],
      openedAt: epochIso,
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Университеты                                                        */
/* ------------------------------------------------------------------ */

function uni(
  id: string,
  name: string,
  shortName: string,
  country: string,
  city: string,
  website: string,
): University {
  // Вуз настоящий, поэтому `isDemo: false`: пометка «ориентировочно» относится
  // к условиям и суммам, а не к самому факту существования университета.
  return { id, name, shortName, country, city, website, isDemo: false };
}

export const SEED_UNIVERSITIES: readonly University[] = [
  uni('nu', 'Nazarbayev University', 'NU', 'KZ', 'Астана', 'https://nu.edu.kz'),
  uni('kbtu', 'Казахстанско-Британский технический университет', 'КБТУ', 'KZ', 'Алматы', 'https://kbtu.edu.kz'),
  uni('aitu', 'Astana IT University', 'AITU', 'KZ', 'Астана', 'https://astanait.edu.kz'),
  uni('sdu', 'SDU University (Университет имени Сулеймана Демиреля)', 'SDU', 'KZ', 'Каскелен', 'https://sdu.edu.kz'),
  uni('satbayev', 'Satbayev University (КазНИТУ имени К. И. Сатпаева)', 'Satbayev', 'KZ', 'Алматы', 'https://satbayev.university'),
  uni('iitu', 'Международный университет информационных технологий', 'МУИТ', 'KZ', 'Алматы', 'https://iitu.edu.kz'),
];

/* ------------------------------------------------------------------ */
/* Программы                                                           */
/* ------------------------------------------------------------------ */

function prog(
  id: string,
  universityId: string,
  title: string,
  field: Program['field'],
  languages: string[],
  campus: string,
  summary: string,
): Program {
  return {
    id,
    universityId,
    title,
    field,
    degreeLevel: 'bachelor',
    instructionLanguages: languages,
    campus,
    durationYears: 4,
    summary,
    isDemo: false,
  };
}

export const SEED_PROGRAMS: readonly Program[] = [
  prog('nu-cs', 'nu', 'Computer Science', 'computer_science', ['en'], 'Астана',
    'Школа инженерии и цифровых наук, обучение на английском, исследовательские лаборатории.'),
  prog('nu-ee', 'nu', 'Electrical and Computer Engineering', 'engineering', ['en'], 'Астана',
    'Инженерная программа: электроника, встраиваемые системы, робототехника.'),
  prog('kbtu-cs', 'kbtu', 'Информационные системы', 'computer_science', ['en', 'ru'], 'Алматы',
    'Школа информационных технологий и инженерии, прикладная разработка, партнёрства с индустрией.'),
  prog('kbtu-fin', 'kbtu', 'Финансы', 'business', ['en', 'ru'], 'Алматы',
    'Школа бизнеса: количественные финансы и анализ данных.'),
  prog('kbtu-pe', 'kbtu', 'Нефтегазовое дело', 'engineering', ['ru', 'en'], 'Алматы',
    'Школа химической инженерии, производственная практика на профильных предприятиях.'),
  prog('aitu-se', 'aitu', 'Software Engineering', 'computer_science', ['en', 'kk'], 'Астана',
    'Проектное обучение, практика с первого курса, ИТ-направленный вуз.'),
  prog('aitu-bit', 'aitu', 'Информационные системы в бизнесе', 'business', ['ru', 'en'], 'Астана',
    'Управление продуктом и данными на стыке экономики и ИТ.'),
  prog('sdu-cs', 'sdu', 'Computer Science', 'computer_science', ['en', 'ru', 'kk'], 'Каскелен',
    'Кампус в Каскелене, доступная стоимость, университетские скидки за успеваемость.'),
  prog('sdu-econ', 'sdu', 'Экономика', 'business', ['ru', 'en'], 'Каскелен',
    'Экономика с прикладной статистикой, невысокая стоимость обучения.'),
  prog('satbayev-eng', 'satbayev', 'Автоматизация и управление', 'engineering', ['ru', 'kk'], 'Алматы',
    'Классическая инженерная школа Казахстана, производственная практика.'),
  prog('iitu-cs', 'iitu', 'Вычислительная техника и программное обеспечение', 'computer_science', ['ru', 'en'], 'Алматы',
    'ИТ-направление, городской кампус в Алматы.'),
];

/* ------------------------------------------------------------------ */
/* Помощники                                                           */
/* ------------------------------------------------------------------ */

function dl(
  id: string,
  kind: Deadline['kind'],
  date: PlainDate,
  opts: Partial<Deadline> = {},
): Deadline {
  return {
    id,
    kind,
    precision: 'instant',
    localDate: date,
    localTime: '18:00',
    timezone: 'Asia/Almaty',
    inclusive: true,
    hard: true,
    sourceId: null,
    ...opts,
  };
}

/** Языковое требование как ANY: IELTS ИЛИ TOEFL — типовой альтернативный путь. */
function englishAny(prefix: string, sourceIds: string[], ieltsMin: number, toeflMin: number): RequirementGroup {
  return {
    nodeType: 'GROUP', groupType: 'ANY', id: `${prefix}-lang`,
    title: 'Подтверждение английского языка',
    explain: 'Достаточно одного из сертификатов. Назначать оба экзамена не требуется.',
    children: [
      {
        nodeType: 'GROUP', groupType: 'ALL', id: `${prefix}-lang-ielts`, title: 'IELTS Academic',
        children: [
          leafExam(`${prefix}-lang-ielts-overall`, `IELTS общий балл от ${ieltsMin}`, 'IELTS', 'ielts_0_9', ieltsMin, sourceIds, 'lang:ielts:overall'),
          // Компонентный порог проверяется отдельно от общего балла.
          leafComponent(`${prefix}-lang-ielts-writing`, 'IELTS Writing от 6.0', 'IELTS', 'ielts_0_9', 'writing', 6.0, sourceIds, 'lang:ielts:writing'),
        ],
      },
      leafExam(`${prefix}-lang-toefl`, `TOEFL iBT от ${toeflMin}`, 'TOEFL', 'toefl_0_120', toeflMin, sourceIds, 'lang:toefl:overall'),
    ],
  };
}

const leafExam = (
  id: string, title: string, examKind: string, scaleId: string, min: number,
  sourceIds: string[], countingKey: string, critical = true,
) => ({
  nodeType: 'LEAF' as const, id, title, countingKey, critical, sourceRefs: sourceIds,
  predicate: { type: 'exam_score' as const, examKind, scaleId, target: 'overall' as const, min },
});

const leafComponent = (
  id: string, title: string, examKind: string, scaleId: string, component: string,
  min: number, sourceIds: string[], countingKey: string,
) => ({
  nodeType: 'LEAF' as const, id, title, countingKey, critical: true, sourceRefs: sourceIds,
  predicate: { type: 'exam_score' as const, examKind, scaleId, target: 'component' as const, component, min },
});

const leafSubject = (
  id: string, title: string, subjectId: string, sourceIds: string[], countingKey: string,
  minScore?: number, scaleId?: string,
) => ({
  nodeType: 'LEAF' as const, id, title, countingKey, critical: false, sourceRefs: sourceIds,
  predicate: { type: 'subject' as const, subjectId, ...(minScore !== undefined ? { minScore, scaleId } : {}) },
});

const leafDoc = (id: string, title: string, documentKind: string, sourceIds: string[], countingKey: string) => ({
  nodeType: 'LEAF' as const, id, title, countingKey, critical: true, sourceRefs: sourceIds,
  predicate: { type: 'document' as const, documentKind },
});

const leafGpa = (id: string, title: string, scaleId: string, min: number, sourceIds: string[], countingKey: string) => ({
  nodeType: 'LEAF' as const, id, title, countingKey, critical: true, sourceRefs: sourceIds,
  predicate: { type: 'gpa' as const, scaleId, min },
});

const leafLevel = (id: string, title: string, allowed: string[], sourceIds: string[], countingKey: string) => ({
  nodeType: 'LEAF' as const, id, title, countingKey, critical: true, sourceRefs: sourceIds,
  predicate: { type: 'education_level' as const, allowed },
});

/**
 * ЕНТ по государственным правилам, а не одним числом.
 *
 * Сумма — только часть требования. Отдельно стоят пороги по блокам: ниже них
 * не допускают независимо от суммы. И главное — профильная пара: с чужой парой
 * подать на специальность нельзя вообще.
 *
 * Пороги блоков и пара берутся из `kz-rules`, то есть из перечня Нацтестцентра
 * и приказа о пороговых баллах, а не подставляются в каждом вузе заново.
 */
function entAll(
  prefix: string,
  sourceIds: string[],
  min: number,
  groupCode: string,
): RequirementGroup {
  const group = programGroup(groupCode);
  if (!group) throw new Error(`Неизвестная группа образовательных программ: ${groupCode}`);

  const blocks = ENT_BLOCKS.map((block) =>
    leafComponent(
      `${prefix}-ent-${block.id}`,
      `${block.title}: не ниже ${block.minScore} из ${block.maxScore}`,
      'ЕНТ', 'ent_0_140', block.id, block.minScore, sourceIds, `exam:ent:${block.id}`,
    ),
  );

  return {
    nodeType: 'GROUP', groupType: 'ALL', id: `${prefix}-ent`,
    title: 'Единое национальное тестирование',
    explain:
      `Группа образовательных программ ${group.code} — «${group.title}». ` +
      'Порог по каждому блоку проверяется отдельно от суммы.',
    children: [
      {
        nodeType: 'LEAF', id: `${prefix}-ent-pair`,
        title: `Профильные предметы: ${subjectRu(group.profileSubjects[0])} и ${subjectRu(group.profileSubjects[1])}`,
        countingKey: 'exam:ent:pair', critical: true, sourceRefs: sourceIds,
        predicate: {
          type: 'ent_profile_pair' as const,
          subjects: group.profileSubjects,
          groupCode: group.code,
        },
      },
      leafExam(`${prefix}-ent-overall`, `ЕНТ от ${min} баллов`, 'ЕНТ', 'ent_0_140', min, sourceIds, 'exam:ent:overall'),
      ...blocks,
    ],
  };
}

/**
 * Документы к зачислению — отдельно от условий конкурса.
 *
 * Аттестат получают все, кто доучился до конца 11 класса, поэтому он никого
 * не отбирает: в конкурсе решают баллы ЕНТ. Раньше он стоял первой строкой
 * среди условий и первым действием в маршруте — и выглядел как главное
 * требование поступления, чем никогда не был.
 */
function docsAll(prefix: string, sourceIds: string[]): RequirementGroup {
  return {
    nodeType: 'GROUP', groupType: 'ALL', id: `${prefix}-docs`,
    title: 'Документы к зачислению',
    explain: 'Проверяется при зачислении. В конкурсе на грант эти пункты не участвуют.',
    children: [
      leafLevel(`${prefix}-level`, 'Выпускник школы или 11 класс', ['grade_11', 'school_graduate'], sourceIds, 'level:secondary'),
      { ...leafDoc(`${prefix}-docs-diploma`, 'Аттестат о среднем образовании', 'school_certificate', sourceIds, 'doc:school_certificate'), critical: false },
    ],
  };
}

/**
 * AT_LEAST с осмысленной мощностью: нужно не менее двух РАЗНЫХ профильных
 * предметов. Дубликат одного предмета мощность не закрывает — за это отвечает
 * `countingKey`.
 */
function stemAtLeast(prefix: string, sourceIds: string[], k: number): RequirementGroup {
  return {
    nodeType: 'GROUP', groupType: 'AT_LEAST', k, id: `${prefix}-stem`,
    title: `Профильные предметы: не менее ${k}`,
    explain: 'Считаются различные предметы. Один и тот же предмет не засчитывается дважды.',
    children: [
      leafSubject(`${prefix}-stem-math`, 'Математика', 'math', sourceIds, 'subject:math'),
      leafSubject(`${prefix}-stem-physics`, 'Физика', 'physics', sourceIds, 'subject:physics'),
      leafSubject(`${prefix}-stem-informatics`, 'Информатика', 'informatics', sourceIds, 'subject:informatics'),
      // Намеренный дубликат предиката математики с тем же counting_key:
      // источник упоминает её дважды, но логический элемент один.
      leafSubject(`${prefix}-stem-math-alt`, 'Математика (профильная)', 'math', sourceIds, 'subject:math'),
    ],
  };
}

/** Профильные предметы экономического направления. */
function econAtLeast(prefix: string, sourceIds: string[], k: number): RequirementGroup {
  return {
    nodeType: 'GROUP', groupType: 'AT_LEAST', k, id: `${prefix}-stem`,
    title: `Профильные предметы: не менее ${k}`,
    explain: 'Считаются различные предметы. Один и тот же предмет не засчитывается дважды.',
    children: [
      leafSubject(`${prefix}-stem-math`, 'Математика', 'math', sourceIds, 'subject:math'),
      leafSubject(`${prefix}-stem-geography`, 'География', 'geography', sourceIds, 'subject:geography'),
      leafSubject(`${prefix}-stem-informatics`, 'Информатика', 'informatics', sourceIds, 'subject:informatics'),
      leafSubject(`${prefix}-stem-history`, 'История Казахстана', 'history', sourceIds, 'subject:history'),
    ],
  };
}

/* ------------------------------------------------------------------ */
/* Nazarbayev University                                               */
/* ------------------------------------------------------------------ */

const COMPONENT_TITLE: Readonly<Record<string, string>> = {
  writing: 'Writing', reading: 'Reading', listening: 'Listening', speaking: 'Speaking',
};

/**
 * Английский по правилам NU: пороги стоят и на общий балл, и на каждый навык.
 *
 * TOEFL в политике приёма задан не числом, а ссылкой на таблицу соответствия
 * ETS. Подставить сюда «80» значило бы выдумать порог, поэтому TOEFL остаётся
 * оговоркой в пояснении, а не листом с числом.
 */
function nuEnglish(
  prefix: string,
  overall: number,
  sections: Readonly<Record<string, number>>,
): RequirementGroup {
  return {
    nodeType: 'GROUP', groupType: 'ALL', id: `${prefix}-lang`,
    title: `IELTS Academic от ${overall.toFixed(1)}`,
    explain:
      'Сертификат засчитывается только при очной сдаче в центре тестирования: ' +
      'IELTS Online, IELTS Indicator и TOEFL iBT Home Edition не принимаются. ' +
      'TOEFL iBT принимается по таблице соответствия ETS — конкретный порог ' +
      'в политике приёма не указан, поэтому мы его не подставляем.',
    children: [
      leafExam(`${prefix}-lang-overall`, `IELTS общий балл от ${overall.toFixed(1)}`, 'IELTS', 'ielts_0_9', overall, ['src-nu-req'], 'lang:ielts:overall'),
      ...Object.entries(sections).map(([component, min]) =>
        leafComponent(
          `${prefix}-lang-${component}`,
          `IELTS ${COMPONENT_TITLE[component] ?? component} от ${min.toFixed(1)}`,
          'IELTS', 'ielts_0_9', component, min, ['src-nu-req'], `lang:ielts:${component}`,
        ),
      ),
    ],
  };
}

/** NUET: общий балл и обязательный минимум по каждому из двух предметов. */
function nuetAll(prefix: string, overall: number, perSubject: number): RequirementGroup {
  return {
    nodeType: 'GROUP', groupType: 'ALL', id: `${prefix}-nuet`,
    title: `NUET от ${overall} баллов`,
    explain: `Отдельно проверяется каждый предмет: не ниже ${perSubject} по математике и по critical thinking.`,
    children: [
      leafExam(`${prefix}-nuet-overall`, `NUET общий балл от ${overall}`, 'NUET', 'nuet_0_240', overall, ['src-nu-req'], 'exam:nuet:overall'),
      leafComponent(`${prefix}-nuet-math`, `NUET Mathematics от ${perSubject}`, 'NUET', 'nuet_0_240', 'math', perSubject, ['src-nu-req'], 'exam:nuet:math'),
      leafComponent(`${prefix}-nuet-ctps`, `NUET Critical Thinking от ${perSubject}`, 'NUET', 'nuet_0_240', 'critical_thinking', perSubject, ['src-nu-req'], 'exam:nuet:ctps'),
    ],
  };
}

/** Вступительный экзамен для конкурса на грант: NUET, SAT или ACT. */
function nuEntrance(prefix: string, nuetOverall: number, nuetPerSubject: number): RequirementGroup {
  return {
    nodeType: 'GROUP', groupType: 'ANY', id: `${prefix}-entrance`,
    title: 'Вступительный экзамен',
    explain:
      'Достаточно одного из трёх. Политика приёма допускает ещё вход по диплому IB, ' +
      'A-level, аттестату NIS 12 класса и по медалям республиканских и международных ' +
      'олимпиад — эти пути мы пока не проверяем.',
    children: [
      nuetAll(prefix, nuetOverall, nuetPerSubject),
      leafExam(`${prefix}-sat`, 'SAT от 1240', 'SAT', 'sat_400_1600', 1240, ['src-nu-req'], 'exam:sat:overall'),
      leafExam(`${prefix}-act`, 'ACT composite от 26', 'ACT', 'act_1_36', 26, ['src-nu-req'], 'exam:act:overall'),
    ],
  };
}

/**
 * Академический порог платного приёма: аттестат ИЛИ ЕНТ.
 *
 * Это именно порог допуска. Ранжируют поступающих по вступительным экзаменам
 * и английскому — средний балл аттестата места в конкурсе не определяет.
 */
function nuAcademic(
  prefix: string,
  gpaMin: number,
  entOverall: number,
  literacyMin: number,
): RequirementGroup {
  return {
    nodeType: 'GROUP', groupType: 'ANY', id: `${prefix}-academic`,
    title: 'Академический порог: аттестат или ЕНТ',
    explain:
      'Достаточно одного из двух. ЕНТ засчитывается только сданный на английском языке. ' +
      'Это порог допуска к конкурсу, а не место в нём.',
    children: [
      leafGpa(`${prefix}-academic-gpa`, `Средний балл аттестата от ${gpaMin}`, 'gpa_5', gpaMin, ['src-nu-req'], 'gpa:5'),
      {
        nodeType: 'GROUP', groupType: 'ALL', id: `${prefix}-academic-ent`, title: `ЕНТ от ${entOverall} баллов`,
        children: [
          leafExam(`${prefix}-academic-ent-overall`, `ЕНТ от ${entOverall} баллов`, 'ЕНТ', 'ent_0_140', entOverall, ['src-nu-req'], 'exam:ent:overall'),
          leafComponent(`${prefix}-academic-ent-math`, `Математическая грамотность от ${literacyMin} из 10`, 'ЕНТ', 'ent_0_140', 'math_literacy', literacyMin, ['src-nu-req'], 'exam:ent:math_literacy'),
          leafComponent(`${prefix}-academic-ent-reading`, `Грамотность чтения от ${literacyMin} из 10`, 'ЕНТ', 'ent_0_140', 'reading_literacy', literacyMin, ['src-nu-req'], 'exam:ent:reading_literacy'),
        ],
      },
    ],
  };
}

/**
 * Документы к зачислению — отдельно от условий конкурса.
 *
 * Аттестат нужен, чтобы зачислиться, но он не отбирает: его получают все, кто
 * доучился. Поэтому лист некритический и стоит в своей группе, а не первой
 * строкой среди вступительных экзаменов.
 */
function nuDocs(prefix: string): RequirementGroup {
  return {
    nodeType: 'GROUP', groupType: 'ALL', id: `${prefix}-docs`,
    title: 'Документы к зачислению',
    explain: 'Проверяется при зачислении. В конкурсе эти пункты не участвуют.',
    children: [
      leafLevel(`${prefix}-level`, 'Выпускник школы или 11 класс', ['grade_11', 'school_graduate'], ['src-nu-req'], 'level:secondary'),
      { ...leafDoc(`${prefix}-docs-certificate`, 'Аттестат о среднем образовании', 'school_certificate', ['src-nu-req'], 'doc:school_certificate'), critical: false },
    ],
  };
}

/**
 * Четыре разных входа в NU, а не «грант и платное».
 *
 * Различие принципиальное и для человека решающее: на грант нужен
 * вступительный экзамен (NUET, SAT или ACT), а на платное — английский плюс
 * аттестат или ЕНТ, и вступительный экзамен не нужен вовсе. Раньше каталог
 * этого не показывал: у обоих путей стояли ЕНТ и «профильные предметы»,
 * которых у NU нет.
 */
function nuPaths(iid: string, year: number): AdmissionPath[] {
  const sourceIds = ['src-nu-req', 'src-nu-dl', 'src-nu-cost'];
  const base = {
    intakeId: iid,
    applicantCategories: ['kz_citizen', 'foreign'],
    requirementTreeVersion: 4,
    isDemo: false,
    sourceIds,
    deadlines: [],
  } as const;

  const grantFunding = (id: string, tuitionUsd: number) => [{
    id: `${id}-funding`,
    label: 'Грант NU: полное покрытие обучения',
    amount: fromMajor(tuitionUsd, 'USD'),
    coverage: 'tuition_full' as const,
    defaultState: 'expected' as const,
    conditions:
      'Присуждается по результатам вступительных экзаменов и английского. ' +
      'Средний балл аттестата в конкурсе на грант не участвует. Проходной балл ' +
      'определяется конкурсом и заранее неизвестен.',
    sourceIds: ['src-nu-cost'],
  }];

  return [
    {
      ...base,
      id: `${iid}-nufyp-grant`, label: 'Foundation Year (NUFYP), грант', kind: 'grant',
      requirementTree: {
        nodeType: 'GROUP', groupType: 'ALL', id: `${iid}-nufyp-grant-root`,
        title: 'Конкурс на грант, подготовительный год',
        children: [
          nuEnglish(`${iid}-nufyp-grant`, 5.5, { writing: 5.5, reading: 5.5, listening: 5.0, speaking: 5.0 }),
          // SAT и ACT на подготовительный год принимаются только от
          // иностранных заявителей, поэтому здесь остаётся один NUET.
          nuetAll(`${iid}-nufyp-grant`, 120, 50),
          nuDocs(`${iid}-nufyp-grant`),
        ],
      },
      costs: [],
      funding: grantFunding(`${iid}-nufyp-grant`, 12_000),
    },
    {
      ...base,
      id: `${iid}-nufyp-paid`, label: 'Foundation Year (NUFYP), платное', kind: 'paid',
      requirementTree: {
        nodeType: 'GROUP', groupType: 'ALL', id: `${iid}-nufyp-paid-root`,
        title: 'Условия платного приёма, подготовительный год',
        children: [
          nuEnglish(`${iid}-nufyp-paid`, 5.5, { writing: 5.5, reading: 5.5, listening: 5.0, speaking: 5.0 }),
          nuAcademic(`${iid}-nufyp-paid`, 3.5, 75, 7),
          nuDocs(`${iid}-nufyp-paid`),
        ],
      },
      costs: [
        cost(`${iid}-nufyp-paid-tuition`, 'Обучение, подготовительный год', 'tuition', 12_000, 12_000, 'USD', ['src-nu-cost'], 'tuition_only', 'academic_year'),
      ],
      funding: [],
    },
    {
      ...base,
      id: `${iid}-ug-grant`, label: 'Бакалавриат напрямую, грант', kind: 'grant',
      requirementTree: {
        nodeType: 'GROUP', groupType: 'ALL', id: `${iid}-ug-grant-root`,
        title: 'Конкурс на грант, бакалавриат',
        children: [
          nuEnglish(`${iid}-ug-grant`, 6.0, { writing: 6.0, reading: 5.5, listening: 5.5, speaking: 5.5 }),
          nuEntrance(`${iid}-ug-grant`, 120, 50),
          nuDocs(`${iid}-ug-grant`),
        ],
      },
      costs: [],
      funding: grantFunding(`${iid}-ug-grant`, 15_000),
    },
    {
      ...base,
      id: `${iid}-ug-paid`, label: 'Бакалавриат напрямую, платное', kind: 'paid',
      requirementTree: {
        nodeType: 'GROUP', groupType: 'ALL', id: `${iid}-ug-paid-root`,
        title: 'Условия платного приёма, бакалавриат',
        children: [
          nuEnglish(`${iid}-ug-paid`, 6.0, { writing: 6.0, reading: 5.5, listening: 5.5, speaking: 5.5 }),
          nuAcademic(`${iid}-ug-paid`, 4.0, 85, 8),
          nuDocs(`${iid}-ug-paid`),
        ],
      },
      costs: [
        cost(`${iid}-ug-paid-tuition`, 'Обучение, бакалавриат', 'tuition', 15_000, 15_000, 'USD', ['src-nu-cost'], 'tuition_only', 'academic_year'),
      ],
      funding: [],
    },
  ];
}

/**
 * Сроки кампании берутся из государственного календаря, а не выдумываются
 * в карточке каждого вуза.
 *
 * Для абитуриента-казахстанца ключевые даты общие: результат ЕНТ должен быть
 * к началу подачи, заявление на грант подаётся 13–20 июля, итоги конкурса —
 * в начале августа, оригиналы — до 25 августа. Вуз добавляет сверху только
 * свои сроки на платное.
 *
 * Время и часовой пояс не подставляются: приказ задаёт день, и планировщик
 * обязан показать неопределённость вместо выдуманных 23:59.
 */
function kzNationalDeadlines(iid: string, year: number): Deadline[] {
  const preliminary = year !== CALENDAR_REFERENCE_YEAR;
  const mark = (text: string) =>
    preliminary
      ? `${text} Даты цикла ${CALENDAR_REFERENCE_YEAR} года: приказ на ${year} год может их сдвинуть.`
      : text;

  const byId = (id: string) => {
    const found = admissionCalendar(year).find((d) => d.id === id);
    if (!found) throw new Error(`Нет события календаря: ${id}`);
    return found;
  };

  const application = byId('grant-application');
  const results = byId('grant-results');
  const enrollment = byId('enrollment');
  const mainEnt = admissionCalendar(year).find((d) => d.id === 'ent-main-testing')!;

  const dayOnly = (id: string, kind: Deadline['kind'], date: string, note: string): Deadline =>
    dl(id, kind, date, {
      precision: 'date_only',
      localTime: undefined,
      timezone: undefined,
      inclusive: 'unknown',
      sourceId: 'src-kz-rules',
      note: mark(note),
    });

  return [
    dayOnly(
      `${iid}-ent-result`, 'result_submission', mainEnt.to,
      'Основной этап ЕНТ закрывается: результат нужен к подаче заявления на грант.',
    ),
    dayOnly(
      `${iid}-grant-apply`, 'application_submission', application.to,
      `Заявление на конкурс грантов подаётся в окно ${application.from.slice(5)} — ${application.to.slice(5)}: до четырёх групп программ по приоритетам, все из одной профильной пары.`,
    ),
    dayOnly(
      `${iid}-grant-results`, 'funding_competition', results.to,
      'Итоги конкурса. Проходной балл появляется только здесь — заранее его не существует.',
    ),
    dayOnly(
      `${iid}-enrollment`, 'document_receipt', enrollment.to,
      'Последний день подачи документов в вуз: получившие грант несут оригиналы, платники подают напрямую.',
    ),
  ];
}

function cost(
  id: string, label: string, category: CatalogCostItem['category'],
  minMajor: number, maxMajor: number, currency: 'KZT' | 'EUR' | 'USD' | 'TRY',
  sourceIds: string[], scope: 'tuition_only' | 'total', period: CatalogCostItem['period'],
  mandatory = true, isEstimate = false,
): CatalogCostItem {
  return {
    id, label, category, sourceIds, scope, period, mandatory, isEstimate,
    min: fromMajor(minMajor, currency), max: fromMajor(maxMajor, currency),
  };
}

/* ------------------------------------------------------------------ */
/* Кампании и пути подачи                                              */
/* ------------------------------------------------------------------ */

interface YearBuild {
  readonly intakes: Intake[];
  readonly paths: AdmissionPath[];
}

/**
 * Кампании приёма на конкретный год.
 *
 * `preliminary` помечает второй год: по нему в каталоге опубликован состав
 * условий, но даты считаются предварительными. Это нужно, чтобы выбор года
 * в анкете реально менял выдачу, а не молча показывал прошлогодний набор.
 */
function buildYear(year: number, programIds: readonly string[], preliminary: boolean): YearBuild {
  const intakes: Intake[] = [];
  const paths: AdmissionPath[] = [];
  const label = preliminary ? `Приём ${year} (предварительные данные)` : `Приём ${year}`;
  const note = preliminary
    ? 'Кампания следующего цикла: состав условий опубликован, даты предварительные.'
    : undefined;

  const take = (id: string) => programIds.includes(id);

  const add = (intake: Intake, list: AdmissionPath[]) => {
    intakes.push(intake);
    paths.push(...list);
  };

  /* --- Nazarbayev University --- */
  for (const programId of ['nu-cs', 'nu-ee'] as const) {
    if (!take(programId)) continue;
    const iid = `${programId}-${year}`;
    add(
      {
        id: iid, programId, admissionYear: year, label,
        // Правило политики приёма: сертификаты не должны истекать к 1 августа
        // соответствующего учебного года.
        resultValidityControlDate: `${year}-08-01`, isDemo: false,
        deadlines: [
          dl(`${iid}-apply`, 'application_submission', `${year}-08-17`, {
            // Точные сроки следующего цикла NU публикует отдельно, поэтому
            // время и часовой пояс не подставляем: планировщик обязан показать
            // неопределённость, а не выдуманные 18:00.
            precision: 'date_only',
            localTime: undefined,
            timezone: undefined,
            inclusive: 'unknown',
            sourceId: 'src-nu-dl',
            note: note ?? 'Дата предыдущего цикла: точные сроки NU объявляет на своём сайте.',
          }),
          dl(`${iid}-certificates`, 'result_submission', `${year}-08-01`, {
            sourceId: 'src-nu-dl',
            note: 'Сертификаты IELTS, SAT и ACT не должны истекать к этой дате.',
          }),
        ],
      },
      nuPaths(iid, year),
    );
  }

  /* --- «Алматы Тех», информационные системы --- */
  if (take('kbtu-cs')) {
    const iid = `kbtu-cs-${year}`;
    add(
      {
        id: iid, programId: 'kbtu-cs', admissionYear: year, label,
        resultValidityControlDate: `${year}-07-15`, isDemo: true,
        deadlines: kzNationalDeadlines(iid, year),
      },
      [{
        id: `${iid}-paid`, intakeId: iid, label: 'Платное обучение', kind: 'paid',
        applicantCategories: ['kz_citizen', 'foreign'], requirementTreeVersion: 2, isDemo: true,
        sourceIds: ['src-kbtu-req', 'src-kbtu-dl', 'src-kbtu-cost'], deadlines: [],
        requirementTree: {
          nodeType: 'GROUP', groupType: 'ALL', id: `${iid}-paid-root`, title: 'Условия приёма',
          children: [
            entAll(`${iid}-paid`, ['src-kbtu-req'], 95, 'В057'),
            englishAny(`${iid}-paid`, ['src-kbtu-req'], 5.5, 72),
            docsAll(`${iid}-paid`, ['src-kbtu-req']),
          ],
        },
        costs: [
          cost(`${iid}-tuition`, 'Обучение', 'tuition', 2_400_000, 2_400_000, 'KZT', ['src-kbtu-cost'], 'tuition_only', 'academic_year'),
          cost(`${iid}-living`, 'Проживание', 'living', 800_000, 1_200_000, 'KZT', ['src-kbtu-cost'], 'total', 'academic_year', true, true),
        ],
        funding: [],
      }],
    );
  }

  /* --- «Алматы Тех», финансы --- */
  if (take('kbtu-fin')) {
    const iid = `kbtu-fin-${year}`;
    add(
      {
        id: iid, programId: 'kbtu-fin', admissionYear: year, label,
        resultValidityControlDate: `${year}-07-15`, isDemo: true,
        deadlines: kzNationalDeadlines(iid, year),
      },
      [{
        id: `${iid}-paid`, intakeId: iid, label: 'Платное обучение', kind: 'paid',
        applicantCategories: ['kz_citizen', 'foreign'], requirementTreeVersion: 2, isDemo: true,
        sourceIds: ['src-kbtu-req', 'src-kbtu-dl', 'src-kbtu-cost'], deadlines: [],
        requirementTree: {
          nodeType: 'GROUP', groupType: 'ALL', id: `${iid}-paid-root`, title: 'Условия приёма',
          children: [
            entAll(`${iid}-paid`, ['src-kbtu-req'], 90, 'В046'),
            englishAny(`${iid}-paid`, ['src-kbtu-req'], 5.5, 72),
            docsAll(`${iid}-paid`, ['src-kbtu-req']),
          ],
        },
        costs: [
          cost(`${iid}-tuition`, 'Обучение', 'tuition', 2_200_000, 2_200_000, 'KZT', ['src-kbtu-cost'], 'tuition_only', 'academic_year'),
        ],
        funding: [],
      }],
    );
  }

  /* --- «Алматы Тех», нефтегазовое дело --- */
  if (take('kbtu-pe')) {
    const iid = `kbtu-pe-${year}`;
    add(
      {
        id: iid, programId: 'kbtu-pe', admissionYear: year, label,
        resultValidityControlDate: `${year}-07-15`, isDemo: true,
        deadlines: kzNationalDeadlines(iid, year),
      },
      [{
        id: `${iid}-paid`, intakeId: iid, label: 'Платное обучение', kind: 'paid',
        applicantCategories: ['kz_citizen', 'foreign'], requirementTreeVersion: 1, isDemo: true,
        sourceIds: ['src-kbtu-req', 'src-kbtu-dl', 'src-kbtu-cost'], deadlines: [],
        requirementTree: {
          nodeType: 'GROUP', groupType: 'ALL', id: `${iid}-paid-root`, title: 'Условия приёма',
          children: [
            entAll(`${iid}-paid`, ['src-kbtu-req'], 85, 'В071'),
            docsAll(`${iid}-paid`, ['src-kbtu-req']),
          ],
        },
        costs: [
          cost(`${iid}-tuition`, 'Обучение', 'tuition', 2_300_000, 2_300_000, 'KZT', ['src-kbtu-cost'], 'tuition_only', 'academic_year'),
        ],
        funding: [],
      }],
    );
  }

  /* --- «Astana Digital», программная инженерия --- */
  if (take('aitu-se')) {
    const iid = `aitu-se-${year}`;
    add(
      {
        id: iid, programId: 'aitu-se', admissionYear: year, label,
        resultValidityControlDate: `${year}-07-20`, isDemo: true,
        deadlines: kzNationalDeadlines(iid, year),
      },
      [{
        id: `${iid}-paid`, intakeId: iid, label: 'Платное обучение', kind: 'paid',
        applicantCategories: ['kz_citizen', 'foreign'], requirementTreeVersion: 1, isDemo: true,
        sourceIds: ['src-aitu-req', 'src-aitu-dl', 'src-aitu-cost'], deadlines: [],
        requirementTree: {
          nodeType: 'GROUP', groupType: 'ALL', id: `${iid}-paid-root`, title: 'Условия приёма',
          children: [
            entAll(`${iid}-paid`, ['src-aitu-req'], 85, 'В057'),
            docsAll(`${iid}-paid`, ['src-aitu-req']),
          ],
        },
        costs: [
          cost(`${iid}-tuition`, 'Обучение', 'tuition', 1_800_000, 1_800_000, 'KZT', ['src-aitu-cost'], 'tuition_only', 'academic_year'),
          cost(`${iid}-living`, 'Проживание', 'living', 700_000, 1_100_000, 'KZT', ['src-aitu-cost'], 'total', 'academic_year', true, true),
        ],
        funding: [],
      }],
    );
  }

  /* --- «Astana Digital», бизнес-информатика --- */
  if (take('aitu-bit')) {
    const iid = `aitu-bit-${year}`;
    add(
      {
        id: iid, programId: 'aitu-bit', admissionYear: year, label,
        resultValidityControlDate: `${year}-07-20`, isDemo: true,
        deadlines: kzNationalDeadlines(iid, year),
      },
      [{
        id: `${iid}-paid`, intakeId: iid, label: 'Платное обучение', kind: 'paid',
        applicantCategories: ['kz_citizen', 'foreign'], requirementTreeVersion: 1, isDemo: true,
        sourceIds: ['src-aitu-req', 'src-aitu-dl', 'src-aitu-cost'], deadlines: [],
        requirementTree: {
          nodeType: 'GROUP', groupType: 'ALL', id: `${iid}-paid-root`, title: 'Условия приёма',
          children: [
            entAll(`${iid}-paid`, ['src-aitu-req'], 80, 'В057'),
            docsAll(`${iid}-paid`, ['src-aitu-req']),
          ],
        },
        costs: [
          cost(`${iid}-tuition`, 'Обучение', 'tuition', 1_700_000, 1_700_000, 'KZT', ['src-aitu-cost'], 'tuition_only', 'academic_year'),
        ],
        funding: [],
      }],
    );
  }

  /* --- «Сулейман», компьютерные науки --- */
  if (take('sdu-cs')) {
    const iid = `sdu-cs-${year}`;
    add(
      {
        id: iid, programId: 'sdu-cs', admissionYear: year, label,
        resultValidityControlDate: `${year}-07-20`, isDemo: true,
        deadlines: kzNationalDeadlines(iid, year),
      },
      [{
        id: `${iid}-paid`, intakeId: iid, label: 'Платное обучение', kind: 'paid',
        applicantCategories: ['kz_citizen', 'foreign'], requirementTreeVersion: 1, isDemo: true,
        sourceIds: ['src-sdu-req', 'src-sdu-dl', 'src-sdu-cost'], deadlines: [],
        requirementTree: {
          nodeType: 'GROUP', groupType: 'ALL', id: `${iid}-paid-root`, title: 'Условия приёма',
          children: [
            entAll(`${iid}-paid`, ['src-sdu-req'], 75, 'В057'),
            docsAll(`${iid}-paid`, ['src-sdu-req']),
          ],
        },
        costs: [
          cost(`${iid}-tuition`, 'Обучение', 'tuition', 1_300_000, 1_300_000, 'KZT', ['src-sdu-cost'], 'tuition_only', 'academic_year'),
          cost(`${iid}-living`, 'Проживание', 'living', 600_000, 900_000, 'KZT', ['src-sdu-cost'], 'total', 'academic_year', true, true),
        ],
        funding: [{
          id: `${iid}-merit`, label: 'Университетская скидка за успеваемость (демо)',
          amount: fromMajor(650_000, 'KZT'), coverage: 'tuition_partial', defaultState: 'expected',
          conditions: 'Средний балл аттестата от 4.5.', sourceIds: ['src-sdu-cost'],
        }],
      }],
    );
  }

  /* --- «Сулейман», экономика --- */
  if (take('sdu-econ')) {
    const iid = `sdu-econ-${year}`;
    add(
      {
        id: iid, programId: 'sdu-econ', admissionYear: year, label,
        resultValidityControlDate: `${year}-07-20`, isDemo: true,
        deadlines: kzNationalDeadlines(iid, year),
      },
      [{
        id: `${iid}-paid`, intakeId: iid, label: 'Платное обучение', kind: 'paid',
        applicantCategories: ['kz_citizen', 'foreign'], requirementTreeVersion: 1, isDemo: true,
        sourceIds: ['src-sdu-req', 'src-sdu-dl', 'src-sdu-cost'], deadlines: [],
        requirementTree: {
          nodeType: 'GROUP', groupType: 'ALL', id: `${iid}-paid-root`, title: 'Условия приёма',
          children: [
            entAll(`${iid}-paid`, ['src-sdu-req'], 70, 'В046'),
            docsAll(`${iid}-paid`, ['src-sdu-req']),
          ],
        },
        costs: [
          cost(`${iid}-tuition`, 'Обучение', 'tuition', 1_100_000, 1_100_000, 'KZT', ['src-sdu-cost'], 'tuition_only', 'academic_year'),
        ],
        funding: [],
      }],
    );
  }

  /* --- «Сатпаев»: путь только для граждан Казахстана --- */
  if (take('satbayev-eng')) {
    const iid = `satbayev-eng-${year}`;
    add(
      {
        id: iid, programId: 'satbayev-eng', admissionYear: year, label,
        resultValidityControlDate: `${year}-07-20`, isDemo: true,
        deadlines: kzNationalDeadlines(iid, year),
      },
      [{
        id: `${iid}-paid`, intakeId: iid, label: 'Платное обучение', kind: 'paid',
        applicantCategories: ['kz_citizen'], requirementTreeVersion: 1, isDemo: true,
        sourceIds: ['src-satbayev-req', 'src-satbayev-dl', 'src-satbayev-cost'], deadlines: [],
        requirementTree: {
          nodeType: 'GROUP', groupType: 'ALL', id: `${iid}-paid-root`, title: 'Условия приёма',
          children: [
            entAll(`${iid}-paid`, ['src-satbayev-req'], 70, 'В063'),
            docsAll(`${iid}-paid`, ['src-satbayev-req']),
          ],
        },
        costs: [
          cost(`${iid}-tuition`, 'Обучение', 'tuition', 1_100_000, 1_100_000, 'KZT', ['src-satbayev-cost'], 'tuition_only', 'academic_year'),
        ],
        funding: [],
      }],
    );
  }

  /* --- ДУИТ: путь с намеренно устаревшим источником требования --- */
  if (take('iitu-cs')) {
    const iid = `iitu-cs-${year}`;
    add(
      {
        id: iid, programId: 'iitu-cs', admissionYear: year, label,
        resultValidityControlDate: `${year}-07-20`, isDemo: true,
        deadlines: kzNationalDeadlines(iid, year),
      },
      [{
        id: `${iid}-paid`, intakeId: iid, label: 'Платное обучение', kind: 'paid',
        applicantCategories: ['kz_citizen', 'foreign'], requirementTreeVersion: 1, isDemo: true,
        sourceIds: ['src-iitu-req', 'src-iitu-dl', 'src-iitu-cost'], deadlines: [],
        requirementTree: {
          nodeType: 'GROUP', groupType: 'ALL', id: `${iid}-paid-root`, title: 'Условия приёма',
          children: [
            entAll(`${iid}-paid`, ['src-iitu-req'], 80, 'В057'),
            docsAll(`${iid}-paid`, ['src-iitu-req']),
          ],
        },
        costs: [
          cost(`${iid}-tuition`, 'Обучение', 'tuition', 1_500_000, 1_500_000, 'KZT', ['src-iitu-cost'], 'tuition_only', 'academic_year'),
        ],
        funding: [],
      }],
    );
  }

  return { intakes, paths };
}

const ALL_PROGRAM_IDS = SEED_PROGRAMS.map((p) => p.id);

/** Программы, у которых опубликована и следующая кампания. */
const NEXT_CYCLE_PROGRAM_IDS = ['nu-cs', 'kbtu-cs', 'sdu-cs', 'aitu-se', 'sdu-econ'];

/** Год ближайшего набора относительно момента расчёта. */
export function baseAdmissionYear(snapshotAt: string): number {
  const ms = Date.parse(snapshotAt);
  const year = Number.isNaN(ms) ? new Date().getUTCFullYear() : new Date(ms).getUTCFullYear();
  return year + 1;
}

/** Годы набора, для которых в каталоге вообще есть данные. */
export function catalogAdmissionYears(snapshotAt: string): number[] {
  const base = baseAdmissionYear(snapshotAt);
  return [base, base + 1];
}

export function buildSeedCatalog(snapshotAt: string): CatalogSnapshot {
  const epochMs = catalogEpochMs(snapshotAt);
  const epochIso = new Date(epochMs).toISOString();
  const baseYear = baseAdmissionYear(snapshotAt);
  const current = buildYear(baseYear, ALL_PROGRAM_IDS, false);
  const next = buildYear(baseYear + 1, NEXT_CYCLE_PROGRAM_IDS, true);

  return {
    version: catalogVersion(snapshotAt),
    refreshedAt: epochIso,
    universities: SEED_UNIVERSITIES,
    programs: SEED_PROGRAMS,
    intakes: [...current.intakes, ...next.intakes],
    paths: [...current.paths, ...next.paths],
    sources: buildSources(epochMs),
    conflicts: buildConflicts(baseYear, epochIso),
    snapshotAt,
  };
}
