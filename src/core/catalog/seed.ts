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
  tum: 'https://www.tum.de/en/studies/application',
  metu: 'https://www.metu.edu.tr/prospective-students',
} as const satisfies Record<string, string>;

const SOURCE_SPECS: readonly SourceSpec[] = [
  { id: 'src-nu-req', title: 'Условия приёма: Nazarbayev University', publisher: 'Nazarbayev University', url: ADMISSION_PAGES['nu'], dataKind: 'mandatory_requirement', verifiedDaysAgo: 2,
    excerpt: 'Минимальный общий балл IELTS 6.5, ни один компонент не ниже 6.0.' },
  { id: 'src-nu-dl', title: 'Сроки приёма: Nazarbayev University', publisher: 'Nazarbayev University', url: ADMISSION_PAGES['nu'], dataKind: 'deadline', verifiedDaysAgo: 1 },
  { id: 'src-nu-cost', title: 'Стоимость обучения: Nazarbayev University', publisher: 'Nazarbayev University', url: ADMISSION_PAGES['nu'], dataKind: 'cost', verifiedDaysAgo: 17 },

  { id: 'src-kbtu-req', title: 'Условия приёма: КБТУ', publisher: 'Казахстанско-Британский технический университет', url: ADMISSION_PAGES['kbtu'], dataKind: 'mandatory_requirement', verifiedDaysAgo: 3 },
  { id: 'src-kbtu-dl', title: 'Сроки приёма: КБТУ', publisher: 'Казахстанско-Британский технический университет', url: ADMISSION_PAGES['kbtu'], dataKind: 'deadline', verifiedDaysAgo: 1 },
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

  { id: 'src-tum-req', title: 'Условия международного приёма: TUM', publisher: 'Technical University of Munich', url: ADMISSION_PAGES['tum'], dataKind: 'mandatory_requirement', verifiedDaysAgo: 2 },
  // DATA-04: источники расходятся по этому сроку — см. SEED_CONFLICTS.
  { id: 'src-tum-dl-a', title: 'Сроки подачи TUM: страница приёма', publisher: 'Technical University of Munich', url: ADMISSION_PAGES['tum'], dataKind: 'deadline', verifiedDaysAgo: 1 },
  { id: 'src-tum-dl-b', title: 'Сроки подачи TUM: сторонний агрегатор', publisher: 'Сторонний агрегатор (не вуз)', url: ADMISSION_PAGES['tum'], dataKind: 'deadline', verifiedDaysAgo: 1 },
  { id: 'src-tum-cost', title: 'Семестровый взнос и расходы: TUM', publisher: 'Technical University of Munich', url: ADMISSION_PAGES['tum'], dataKind: 'cost', verifiedDaysAgo: 6 },

  { id: 'src-metu-req', title: 'Условия приёма: METU', publisher: 'Middle East Technical University', url: ADMISSION_PAGES['metu'], dataKind: 'mandatory_requirement', verifiedDaysAgo: 3 },
  { id: 'src-metu-dl', title: 'Сроки приёма: METU', publisher: 'Middle East Technical University', url: ADMISSION_PAGES['metu'], dataKind: 'deadline', verifiedDaysAgo: 2 },
  { id: 'src-metu-cost', title: 'Стоимость обучения: METU', publisher: 'Middle East Technical University', url: ADMISSION_PAGES['metu'], dataKind: 'cost', verifiedDaysAgo: 12 },
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

/** DATA-04 / AC-09: конфликт применимых источников по сроку подачи перевода. */
function buildConflicts(baseYear: number, epochIso: string): SourceConflict[] {
  return [
    {
      id: 'conflict-tum-deadline',
      targetId: `tum-cs-${baseYear}-intl-leaf-deadline-doc`,
      description:
        'Срок предоставления заверенного перевода аттестата: версия A называет 15 января, ' +
        'версия B — 1 февраля. Пока расхождение не разрешено, вывод по условию не делается.',
      versions: [
        { sourceId: 'src-tum-dl-a', claim: `15 января ${baseYear}` },
        { sourceId: 'src-tum-dl-b', claim: `1 февраля ${baseYear}` },
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
  uni('tum', 'Technical University of Munich', 'TUM', 'DE', 'Мюнхен', 'https://www.tum.de'),
  uni('metu', 'Middle East Technical University', 'METU', 'TR', 'Анкара', 'https://www.metu.edu.tr'),
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
  prog('tum-cs', 'tum', 'Informatik (B.Sc.)', 'computer_science', ['de', 'en'], 'Мюнхен',
    'Платы за обучение нет, есть семестровый взнос; высокие требования к документам и языку.'),
  prog('metu-cs', 'metu', 'Computer Engineering', 'computer_science', ['en'], 'Анкара',
    'Англоязычная инженерная программа, умеренная стоимость для иностранцев.'),
  prog('metu-ba', 'metu', 'Business Administration', 'business', ['en'], 'Анкара',
    'Англоязычная программа по управлению, международная среда.'),
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

function ntAll(prefix: string, sourceIds: string[], min: number): RequirementGroup {
  return {
    nodeType: 'GROUP', groupType: 'ALL', id: `${prefix}-nt`, title: 'Единое национальное тестирование',
    children: [leafExam(`${prefix}-nt-overall`, `ЕНТ от ${min} баллов`, 'ЕНТ', 'ent_0_140', min, sourceIds, 'exam:ent:overall')],
  };
}

function docsAll(prefix: string, sourceIds: string[]): RequirementGroup {
  return {
    nodeType: 'GROUP', groupType: 'ALL', id: `${prefix}-docs`, title: 'Документы',
    children: [
      leafDoc(`${prefix}-docs-diploma`, 'Аттестат о среднем образовании', 'school_certificate', sourceIds, 'doc:school_certificate'),
      leafLevel(`${prefix}-level`, 'Выпускник школы или 11 класс', ['grade_11', 'school_graduate'], sourceIds, 'level:secondary'),
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

  /* --- «Астана Рисёрч», Computer Science --- */
  if (take('nu-cs')) {
    const iid = `nu-cs-${year}`;
    add(
      {
        id: iid, programId: 'nu-cs', admissionYear: year, label,
        resultValidityControlDate: `${year}-06-30`, isDemo: true,
        deadlines: [
          dl(`${iid}-apply`, 'application_submission', `${year}-01-20`, { sourceId: 'src-nu-dl', ...(note ? { note } : {}) }),
          dl(`${iid}-result`, 'result_submission', `${year}-02-10`, { sourceId: 'src-nu-dl' }),
        ],
      },
      [
        {
          id: `${iid}-grant`, intakeId: iid, label: 'Грант', kind: 'grant',
          applicantCategories: ['kz_citizen'], requirementTreeVersion: 3, isDemo: true,
          sourceIds: ['src-nu-req', 'src-nu-dl', 'src-nu-cost'], deadlines: [],
          requirementTree: {
            nodeType: 'GROUP', groupType: 'ALL', id: `${iid}-grant-root`, title: 'Условия гранта',
            children: [
              englishAny(`${iid}-grant`, ['src-nu-req'], 6.5, 90),
              leafGpa(`${iid}-grant-gpa`, 'Средний балл аттестата от 4.5', 'gpa_5', 4.5, ['src-nu-req'], 'gpa:5'),
              stemAtLeast(`${iid}-grant`, ['src-nu-req'], 2),
              docsAll(`${iid}-grant`, ['src-nu-req']),
            ],
          },
          costs: [
            cost(`${iid}-grant-living`, 'Проживание и питание', 'living', 900_000, 1_400_000, 'KZT', ['src-nu-cost'], 'total', 'academic_year', true, true),
            cost(`${iid}-grant-onetime`, 'Разовые расходы на поступление', 'one_time', 60_000, 120_000, 'KZT', ['src-nu-cost'], 'total', 'one_time'),
          ],
          funding: [{
            id: `${iid}-grant-full`, label: 'Государственный образовательный грант (демо)',
            amount: fromMajor(3_500_000, 'KZT'), coverage: 'tuition_full', defaultState: 'expected',
            conditions: 'Конкурс по баллу ЕНТ и портфолио.', sourceIds: ['src-nu-cost'],
          }],
        },
        {
          id: `${iid}-paid`, intakeId: iid, label: 'Платное обучение', kind: 'paid',
          applicantCategories: ['kz_citizen', 'foreign'], requirementTreeVersion: 3, isDemo: true,
          sourceIds: ['src-nu-req', 'src-nu-dl', 'src-nu-cost'], deadlines: [],
          requirementTree: {
            nodeType: 'GROUP', groupType: 'ALL', id: `${iid}-paid-root`, title: 'Условия платного приёма',
            children: [
              englishAny(`${iid}-paid`, ['src-nu-req'], 6.5, 90),
              leafGpa(`${iid}-paid-gpa`, 'Средний балл аттестата от 4.0', 'gpa_5', 4.0, ['src-nu-req'], 'gpa:5'),
              docsAll(`${iid}-paid`, ['src-nu-req']),
            ],
          },
          costs: [
            cost(`${iid}-paid-tuition`, 'Обучение', 'tuition', 3_500_000, 3_500_000, 'KZT', ['src-nu-cost'], 'tuition_only', 'academic_year'),
            cost(`${iid}-paid-living`, 'Проживание и питание', 'living', 900_000, 1_400_000, 'KZT', ['src-nu-cost'], 'total', 'academic_year', true, true),
          ],
          funding: [],
        },
      ],
    );
  }

  /* --- «Астана Рисёрч», электроника --- */
  if (take('nu-ee')) {
    const iid = `nu-ee-${year}`;
    add(
      {
        id: iid, programId: 'nu-ee', admissionYear: year, label,
        resultValidityControlDate: `${year}-06-30`, isDemo: true,
        deadlines: [dl(`${iid}-apply`, 'application_submission', `${year}-01-20`, { sourceId: 'src-nu-dl' })],
      },
      [{
        id: `${iid}-paid`, intakeId: iid, label: 'Платное обучение', kind: 'paid',
        applicantCategories: ['kz_citizen', 'foreign'], requirementTreeVersion: 2, isDemo: true,
        sourceIds: ['src-nu-req', 'src-nu-dl', 'src-nu-cost'], deadlines: [],
        requirementTree: {
          nodeType: 'GROUP', groupType: 'ALL', id: `${iid}-paid-root`, title: 'Условия приёма',
          children: [
            englishAny(`${iid}-paid`, ['src-nu-req'], 6.0, 80),
            stemAtLeast(`${iid}-paid`, ['src-nu-req'], 2),
            docsAll(`${iid}-paid`, ['src-nu-req']),
          ],
        },
        costs: [
          cost(`${iid}-paid-tuition`, 'Обучение', 'tuition', 3_200_000, 3_200_000, 'KZT', ['src-nu-cost'], 'tuition_only', 'academic_year'),
        ],
        funding: [],
      }],
    );
  }

  /* --- «Алматы Тех», информационные системы --- */
  if (take('kbtu-cs')) {
    const iid = `kbtu-cs-${year}`;
    add(
      {
        id: iid, programId: 'kbtu-cs', admissionYear: year, label,
        resultValidityControlDate: `${year}-07-15`, isDemo: true,
        deadlines: [
          dl(`${iid}-apply`, 'application_submission', `${year}-06-25`, { sourceId: 'src-kbtu-dl', ...(note ? { note } : {}) }),
          // Источник указал день, но не время и не зону: планировщик обязан
          // показать неопределённость, а не подставить 23:59.
          dl(`${iid}-docs`, 'document_receipt', `${year}-06-10`, {
            precision: 'date_only',
            localTime: undefined,
            timezone: undefined,
            inclusive: 'unknown',
            sourceId: 'src-kbtu-dl',
            note: 'Источник не указал время и часовой пояс.',
          }),
        ],
      },
      [{
        id: `${iid}-paid`, intakeId: iid, label: 'Платное обучение', kind: 'paid',
        applicantCategories: ['kz_citizen', 'foreign'], requirementTreeVersion: 2, isDemo: true,
        sourceIds: ['src-kbtu-req', 'src-kbtu-dl', 'src-kbtu-cost'], deadlines: [],
        requirementTree: {
          nodeType: 'GROUP', groupType: 'ALL', id: `${iid}-paid-root`, title: 'Условия приёма',
          children: [
            ntAll(`${iid}-paid`, ['src-kbtu-req'], 95),
            englishAny(`${iid}-paid`, ['src-kbtu-req'], 5.5, 72),
            stemAtLeast(`${iid}-paid`, ['src-kbtu-req'], 2),
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
        deadlines: [dl(`${iid}-apply`, 'application_submission', `${year}-06-25`, { sourceId: 'src-kbtu-dl' })],
      },
      [{
        id: `${iid}-paid`, intakeId: iid, label: 'Платное обучение', kind: 'paid',
        applicantCategories: ['kz_citizen', 'foreign'], requirementTreeVersion: 2, isDemo: true,
        sourceIds: ['src-kbtu-req', 'src-kbtu-dl', 'src-kbtu-cost'], deadlines: [],
        requirementTree: {
          nodeType: 'GROUP', groupType: 'ALL', id: `${iid}-paid-root`, title: 'Условия приёма',
          children: [
            ntAll(`${iid}-paid`, ['src-kbtu-req'], 90),
            englishAny(`${iid}-paid`, ['src-kbtu-req'], 5.5, 72),
            econAtLeast(`${iid}-paid`, ['src-kbtu-req'], 2),
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
        deadlines: [dl(`${iid}-apply`, 'application_submission', `${year}-06-25`, { sourceId: 'src-kbtu-dl' })],
      },
      [{
        id: `${iid}-paid`, intakeId: iid, label: 'Платное обучение', kind: 'paid',
        applicantCategories: ['kz_citizen', 'foreign'], requirementTreeVersion: 1, isDemo: true,
        sourceIds: ['src-kbtu-req', 'src-kbtu-dl', 'src-kbtu-cost'], deadlines: [],
        requirementTree: {
          nodeType: 'GROUP', groupType: 'ALL', id: `${iid}-paid-root`, title: 'Условия приёма',
          children: [
            ntAll(`${iid}-paid`, ['src-kbtu-req'], 85),
            stemAtLeast(`${iid}-paid`, ['src-kbtu-req'], 2),
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
        deadlines: [dl(`${iid}-apply`, 'application_submission', `${year}-07-01`, { sourceId: 'src-aitu-dl', ...(note ? { note } : {}) })],
      },
      [{
        id: `${iid}-paid`, intakeId: iid, label: 'Платное обучение', kind: 'paid',
        applicantCategories: ['kz_citizen', 'foreign'], requirementTreeVersion: 1, isDemo: true,
        sourceIds: ['src-aitu-req', 'src-aitu-dl', 'src-aitu-cost'], deadlines: [],
        requirementTree: {
          nodeType: 'GROUP', groupType: 'ALL', id: `${iid}-paid-root`, title: 'Условия приёма',
          children: [
            ntAll(`${iid}-paid`, ['src-aitu-req'], 85),
            stemAtLeast(`${iid}-paid`, ['src-aitu-req'], 2),
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
        deadlines: [dl(`${iid}-apply`, 'application_submission', `${year}-07-01`, { sourceId: 'src-aitu-dl' })],
      },
      [{
        id: `${iid}-paid`, intakeId: iid, label: 'Платное обучение', kind: 'paid',
        applicantCategories: ['kz_citizen', 'foreign'], requirementTreeVersion: 1, isDemo: true,
        sourceIds: ['src-aitu-req', 'src-aitu-dl', 'src-aitu-cost'], deadlines: [],
        requirementTree: {
          nodeType: 'GROUP', groupType: 'ALL', id: `${iid}-paid-root`, title: 'Условия приёма',
          children: [
            ntAll(`${iid}-paid`, ['src-aitu-req'], 80),
            econAtLeast(`${iid}-paid`, ['src-aitu-req'], 2),
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
        deadlines: [dl(`${iid}-apply`, 'application_submission', `${year}-07-05`, { sourceId: 'src-sdu-dl', ...(note ? { note } : {}) })],
      },
      [{
        id: `${iid}-paid`, intakeId: iid, label: 'Платное обучение', kind: 'paid',
        applicantCategories: ['kz_citizen', 'foreign'], requirementTreeVersion: 1, isDemo: true,
        sourceIds: ['src-sdu-req', 'src-sdu-dl', 'src-sdu-cost'], deadlines: [],
        requirementTree: {
          nodeType: 'GROUP', groupType: 'ALL', id: `${iid}-paid-root`, title: 'Условия приёма',
          children: [
            ntAll(`${iid}-paid`, ['src-sdu-req'], 75),
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
        deadlines: [dl(`${iid}-apply`, 'application_submission', `${year}-07-05`, { sourceId: 'src-sdu-dl' })],
      },
      [{
        id: `${iid}-paid`, intakeId: iid, label: 'Платное обучение', kind: 'paid',
        applicantCategories: ['kz_citizen', 'foreign'], requirementTreeVersion: 1, isDemo: true,
        sourceIds: ['src-sdu-req', 'src-sdu-dl', 'src-sdu-cost'], deadlines: [],
        requirementTree: {
          nodeType: 'GROUP', groupType: 'ALL', id: `${iid}-paid-root`, title: 'Условия приёма',
          children: [
            ntAll(`${iid}-paid`, ['src-sdu-req'], 70),
            econAtLeast(`${iid}-paid`, ['src-sdu-req'], 2),
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
        deadlines: [dl(`${iid}-apply`, 'application_submission', `${year}-07-10`, { sourceId: 'src-satbayev-dl' })],
      },
      [{
        id: `${iid}-paid`, intakeId: iid, label: 'Платное обучение', kind: 'paid',
        applicantCategories: ['kz_citizen'], requirementTreeVersion: 1, isDemo: true,
        sourceIds: ['src-satbayev-req', 'src-satbayev-dl', 'src-satbayev-cost'], deadlines: [],
        requirementTree: {
          nodeType: 'GROUP', groupType: 'ALL', id: `${iid}-paid-root`, title: 'Условия приёма',
          children: [
            ntAll(`${iid}-paid`, ['src-satbayev-req'], 70),
            stemAtLeast(`${iid}-paid`, ['src-satbayev-req'], 2),
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
        deadlines: [dl(`${iid}-apply`, 'application_submission', `${year}-07-05`, { sourceId: 'src-iitu-dl' })],
      },
      [{
        id: `${iid}-paid`, intakeId: iid, label: 'Платное обучение', kind: 'paid',
        applicantCategories: ['kz_citizen', 'foreign'], requirementTreeVersion: 1, isDemo: true,
        sourceIds: ['src-iitu-req', 'src-iitu-dl', 'src-iitu-cost'], deadlines: [],
        requirementTree: {
          nodeType: 'GROUP', groupType: 'ALL', id: `${iid}-paid-root`, title: 'Условия приёма',
          children: [
            ntAll(`${iid}-paid`, ['src-iitu-req'], 80),
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

  /* --- ДТУМ, Германия: конфликт источников по сроку документа --- */
  if (take('tum-cs')) {
    const iid = `tum-cs-${year}`;
    add(
      {
        id: iid, programId: 'tum-cs', admissionYear: year, label: preliminary ? label : `Приём ${year} (зимний)`,
        resultValidityControlDate: `${year}-07-15`, isDemo: true,
        deadlines: [
          dl(`${iid}-apply`, 'application_submission', `${year}-01-15`, {
            timezone: 'Europe/Berlin', sourceId: 'src-tum-dl-a',
          }),
          dl(`${iid}-docs`, 'document_receipt', `${year}-01-15`, {
            timezone: 'Europe/Berlin', sourceId: 'src-tum-dl-a',
            note: 'По версии A. Версия B называет 1 февраля — расхождение не разрешено.',
          }),
        ],
      },
      [{
        id: `${iid}-intl`, intakeId: iid, label: 'Международный приём', kind: 'paid',
        applicantCategories: ['foreign', 'kz_citizen'], requirementTreeVersion: 4, isDemo: true,
        sourceIds: ['src-tum-req', 'src-tum-dl-a', 'src-tum-dl-b', 'src-tum-cost'], deadlines: [],
        requirementTree: {
          nodeType: 'GROUP', groupType: 'ALL', id: `${iid}-intl-root`, title: 'Условия международного приёма',
          children: [
            englishAny(`${iid}-intl`, ['src-tum-req'], 6.5, 88),
            leafGpa(`${iid}-intl-gpa`, 'Средний балл аттестата от 4.6', 'gpa_5', 4.6, ['src-tum-req'], 'gpa:5'),
            stemAtLeast(`${iid}-intl`, ['src-tum-req'], 2),
            {
              nodeType: 'GROUP', groupType: 'ALL', id: `${iid}-intl-docs`, title: 'Документы',
              children: [
                leafDoc(`${iid}-intl-leaf-diploma`, 'Аттестат о среднем образовании', 'school_certificate', ['src-tum-req'], 'doc:school_certificate'),
                // По этому узлу открыт конфликт источников.
                leafDoc(`${iid}-intl-leaf-deadline-doc`, 'Заверенный перевод аттестата', 'certified_translation', ['src-tum-dl-a', 'src-tum-dl-b'], 'doc:certified_translation'),
              ],
            },
          ],
        },
        costs: [
          cost(`${iid}-semester`, 'Семестровый взнос', 'one_time', 170, 170, 'EUR', ['src-tum-cost'], 'tuition_only', 'academic_year'),
          cost(`${iid}-living`, 'Проживание в Мюнхене', 'living', 11_000, 14_000, 'EUR', ['src-tum-cost'], 'total', 'academic_year', true, true),
        ],
        funding: [],
      }],
    );
  }

  /* --- ДТУА, Турция --- */
  if (take('metu-cs')) {
    const iid = `metu-cs-${year}`;
    add(
      {
        id: iid, programId: 'metu-cs', admissionYear: year, label,
        resultValidityControlDate: `${year}-07-01`, isDemo: true,
        deadlines: [dl(`${iid}-apply`, 'application_submission', `${year}-05-20`, {
          timezone: 'Europe/Istanbul', sourceId: 'src-metu-dl',
        })],
      },
      [{
        id: `${iid}-intl`, intakeId: iid, label: 'Международный приём', kind: 'paid',
        applicantCategories: ['foreign', 'kz_citizen'], requirementTreeVersion: 2, isDemo: true,
        sourceIds: ['src-metu-req', 'src-metu-dl', 'src-metu-cost'], deadlines: [],
        requirementTree: {
          nodeType: 'GROUP', groupType: 'ALL', id: `${iid}-intl-root`, title: 'Условия приёма',
          children: [
            englishAny(`${iid}-intl`, ['src-metu-req'], 6.0, 79),
            leafGpa(`${iid}-intl-gpa`, 'Средний балл аттестата от 4.0', 'gpa_5', 4.0, ['src-metu-req'], 'gpa:5'),
            docsAll(`${iid}-intl`, ['src-metu-req']),
          ],
        },
        costs: [
          cost(`${iid}-tuition`, 'Обучение', 'tuition', 2_400, 2_400, 'USD', ['src-metu-cost'], 'tuition_only', 'academic_year'),
          cost(`${iid}-living`, 'Проживание в Анкаре', 'living', 3_600, 5_000, 'USD', ['src-metu-cost'], 'total', 'academic_year', true, true),
        ],
        funding: [],
      }],
    );
  }

  /* --- ДТУА, управление --- */
  if (take('metu-ba')) {
    const iid = `metu-ba-${year}`;
    add(
      {
        id: iid, programId: 'metu-ba', admissionYear: year, label,
        resultValidityControlDate: `${year}-07-01`, isDemo: true,
        deadlines: [dl(`${iid}-apply`, 'application_submission', `${year}-05-20`, {
          timezone: 'Europe/Istanbul', sourceId: 'src-metu-dl',
        })],
      },
      [{
        id: `${iid}-intl`, intakeId: iid, label: 'Международный приём', kind: 'paid',
        applicantCategories: ['foreign', 'kz_citizen'], requirementTreeVersion: 1, isDemo: true,
        sourceIds: ['src-metu-req', 'src-metu-dl', 'src-metu-cost'], deadlines: [],
        requirementTree: {
          nodeType: 'GROUP', groupType: 'ALL', id: `${iid}-intl-root`, title: 'Условия приёма',
          children: [
            englishAny(`${iid}-intl`, ['src-metu-req'], 6.0, 79),
            leafGpa(`${iid}-intl-gpa`, 'Средний балл аттестата от 3.8', 'gpa_5', 3.8, ['src-metu-req'], 'gpa:5'),
            docsAll(`${iid}-intl`, ['src-metu-req']),
          ],
        },
        costs: [
          cost(`${iid}-tuition`, 'Обучение', 'tuition', 2_100, 2_100, 'USD', ['src-metu-cost'], 'tuition_only', 'academic_year'),
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
