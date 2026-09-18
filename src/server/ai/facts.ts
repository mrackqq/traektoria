/**
 * Каталог проверяемых фактов расчёта.
 *
 * Набор чисел «где-то в контексте» проверкой факта не является: год 2027 есть
 * у любой кампании, 4.6 — это средний балл профиля, а не порог IELTS, а
 * стоимость одной программы ничего не говорит о другой. Поэтому факт здесь
 * всегда тройка:
 *
 *     СУБЪЕКТ (программа, задача или профиль) + ПОКАЗАТЕЛЬ + ЗНАЧЕНИЕ
 *
 * По этой тройке решаются две задачи:
 *  • модель ссылается на факт идентификатором, а значение подставляет сервер —
 *    так числовые условия, сроки и стоимость показываются из расчёта, а не из
 *    свободного текста;
 *  • свободный текст проверяется В ОБЛАСТИ своего субъекта: число, встреченное
 *    в объяснении про программу X, должно подтверждаться фактом программы X
 *    или профиля, и по тому же показателю, о котором идёт речь.
 */

/** Кому принадлежит факт. */
export type FactSubject =
  | { readonly kind: 'path'; readonly id: string }
  | { readonly kind: 'task'; readonly id: string }
  | { readonly kind: 'profile' };

/**
 * Что именно измеряет факт.
 *
 * Показатель — это не подпись, а тип: он запрещает переносить средний балл
 * в порог IELTS, а стоимость — в срок подачи.
 */
export type FactMeasure =
  | 'gpa'
  | 'exam_score_ielts'
  | 'exam_score_toefl'
  | 'exam_score_ent'
  | 'requirement_ielts'
  | 'requirement_toefl'
  | 'requirement_ent'
  | 'requirement_gpa'
  | 'tuition_cost'
  | 'budget_limit'
  | 'funding_amount'
  | 'deadline'
  | 'date_generic'
  | 'weekly_hours'
  | 'conditions_count'
  | 'duration_years';

export type FactValueKind = 'number' | 'money' | 'date' | 'text';

export interface CatalogFact {
  /** Короткий идентификатор для ссылки из ответа модели. */
  readonly id: string;
  readonly subject: FactSubject;
  readonly measure: FactMeasure;
  readonly valueKind: FactValueKind;
  /** Готовое к показу значение. Его подставляет сервер, а не модель. */
  readonly display: string;
  /** Нормализованное значение для сверки с текстом. */
  readonly normalized: string;
  /** Человеческая подпись показателя. */
  readonly label: string;
}

/**
 * Ключевые слова показателя.
 *
 * Это не список запрещённых фраз, а словарь распознавания темы предложения:
 * увидев «IELTS», проверка требует факт именно с показателем IELTS у именно
 * этого субъекта. Словарь маленький и типизированный, потому что закрывает
 * ровно те показатели, которые мы умеем подтверждать.
 */
const MEASURE_KEYWORDS: Readonly<Record<FactMeasure, readonly RegExp[]>> = {
  gpa: [/средн\p{L}*\s+балл/iu, /GPA/iu, /аттестат\p{L}*\s+балл/iu],
  requirement_gpa: [/средн\p{L}*\s+балл/iu, /GPA/iu],
  exam_score_ielts: [/IELTS/iu],
  requirement_ielts: [/IELTS/iu],
  exam_score_toefl: [/TOEFL/iu],
  requirement_toefl: [/TOEFL/iu],
  exam_score_ent: [/ЕНТ/iu],
  requirement_ent: [/ЕНТ/iu],
  tuition_cost: [/стоимост/iu, /обучени\p{L}*\s+сто/iu, /цен[аыу]/iu, /₸/u, /тенге/iu, /расход/iu, /плат[аыу]/iu],
  budget_limit: [/бюджет/iu],
  funding_amount: [/грант/iu, /скидк/iu, /стипенди/iu, /финансировани/iu],
  deadline: [/дедлайн/iu, /срок/iu, /отсечк/iu, /подайте|подача|подать/iu],
  date_generic: [/дат\p{L}*/iu],
  weekly_hours: [/час\p{L}*\s+в\s+недел/iu, /недельн\p{L}*\s+нагрузк/iu],
  conditions_count: [/услови\p{L}*\s+выполнен/iu, /из\s+\d+\s+услови/iu],
  duration_years: [/длительност/iu, /лет\s+обучени/iu],
};

/**
 * Семейство показателя: к какой величине относится число.
 *
 * Внутри семейства ещё есть разница между результатом пользователя и
 * требованием программы, но между семействами переноса быть не может:
 * средний балл никогда не подтверждает порог IELTS.
 */
type MeasureFamily = 'gpa' | 'ielts' | 'toefl' | 'ent' | 'money' | 'date' | 'hours' | 'duration';

const FAMILY_OF: Readonly<Record<FactMeasure, MeasureFamily>> = {
  gpa: 'gpa',
  requirement_gpa: 'gpa',
  exam_score_ielts: 'ielts',
  requirement_ielts: 'ielts',
  exam_score_toefl: 'toefl',
  requirement_toefl: 'toefl',
  exam_score_ent: 'ent',
  requirement_ent: 'ent',
  tuition_cost: 'money',
  budget_limit: 'money',
  funding_amount: 'money',
  deadline: 'date',
  date_generic: 'date',
  weekly_hours: 'hours',
  conditions_count: 'duration',
  duration_years: 'duration',
};

/** Семейства, в которых число всегда фактическое: балл, сумма, срок. */
const FACTUAL_FAMILIES: ReadonlySet<MeasureFamily> = new Set<MeasureFamily>([
  'gpa', 'ielts', 'toefl', 'ent', 'money', 'date',
]);

/**
 * Требование программы или результат пользователя.
 *
 * «Требуется IELTS 6» и «у вас IELTS 6» — разные утверждения, и подтверждать
 * их должны разные факты.
 */
type Stance = 'requirement' | 'result' | 'any';

const REQUIREMENT_CUE = /требу|нужн|необходим|минимум|не\s+ниже|порог|от\s+\d/iu;
const RESULT_CUE = /ваш|у\s+вас|вы\s+набрал|ваши\s+баллы|вами\s+получен/iu;

const REQUIREMENT_MEASURES: ReadonlySet<FactMeasure> = new Set<FactMeasure>([
  'requirement_gpa', 'requirement_ielts', 'requirement_toefl', 'requirement_ent',
]);
const RESULT_MEASURES: ReadonlySet<FactMeasure> = new Set<FactMeasure>([
  'gpa', 'exam_score_ielts', 'exam_score_toefl', 'exam_score_ent',
]);

const ZERO_COST_CLAIM = /бесплатн|без\s+плат|не\s+нужно\s+плат|без\s+оплат/i;

/* ------------------------------------------------------------------ */
/* Нормализация значений                                               */
/* ------------------------------------------------------------------ */

export function normalizeNumber(raw: string): string {
  const cleaned = raw.replace(/[\s ]/g, '').replace(',', '.');
  const value = Number(cleaned);
  return Number.isFinite(value) ? String(value) : cleaned;
}

const MONTHS: Readonly<Record<string, string>> = {
  январ: '01', феврал: '02', март: '03', апрел: '04', ма: '05', июн: '06',
  июл: '07', август: '08', сентябр: '09', октябр: '10', ноябр: '11', декабр: '12',
};

/** Дата в тексте: «12 октября 2027», «5 июля 2027 года», «2027-07-05». */
export interface FoundDate {
  readonly raw: string;
  /** ГГГГ-ММ-ДД. */
  readonly iso: string;
}

export function findDates(text: string): FoundDate[] {
  const out: FoundDate[] = [];

  const isoRe = /(\d{4})-(\d{2})-(\d{2})/g;
  for (const m of text.matchAll(isoRe)) {
    out.push({ raw: m[0], iso: `${m[1]}-${m[2]}-${m[3]}` });
  }

  const ruRe = /(\d{1,2})\s+([а-яё]+)\s+(\d{4})/gi;
  for (const m of text.matchAll(ruRe)) {
    const monthKey = Object.keys(MONTHS).find((k) => m[2]!.toLowerCase().startsWith(k));
    if (!monthKey) continue;
    const day = m[1]!.padStart(2, '0');
    out.push({ raw: m[0], iso: `${m[3]}-${MONTHS[monthKey]}-${day}` });
  }

  return out;
}

/** Даты нормализуются целиком: отдельно встреченный год ничего не подтверждает. */
export function normalizeDate(display: string): string {
  const found = findDates(display);
  return found[0]?.iso ?? display.trim();
}

/* ------------------------------------------------------------------ */
/* Каталог                                                             */
/* ------------------------------------------------------------------ */

export class FactCatalogue {
  private readonly facts: CatalogFact[] = [];
  private counter = 0;

  add(fact: Omit<CatalogFact, 'id'>): CatalogFact {
    const id = `f${++this.counter}`;
    const stored: CatalogFact = { ...fact, id };
    this.facts.push(stored);
    return stored;
  }

  all(): readonly CatalogFact[] {
    return this.facts;
  }

  byId(id: string): CatalogFact | undefined {
    return this.facts.find((f) => f.id === id);
  }

  /** Факты субъекта плюс общие факты профиля: профиль относится ко всем. */
  inScope(subject: FactSubject): CatalogFact[] {
    return this.facts.filter((f) => sameSubject(f.subject, subject) || f.subject.kind === 'profile');
  }

  /** Компактный вид для отправки модели. */
  forPrompt(): { id: string; subject: string; measure: FactMeasure; label: string; value: string }[] {
    return this.facts.map((f) => ({
      id: f.id,
      subject:
        f.subject.kind === 'profile'
          ? 'профиль'
          : `${f.subject.kind}:${f.subject.id}`,
      measure: f.measure,
      label: f.label,
      value: f.display,
    }));
  }
}

export function sameSubject(a: FactSubject, b: FactSubject): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'profile' || b.kind === 'profile') return true;
  return a.id === (b as { id: string }).id;
}

/* ------------------------------------------------------------------ */
/* Проверка текста в области субъекта                                  */
/* ------------------------------------------------------------------ */

export interface ScopedProblem {
  readonly code:
    | 'UNGROUNDED_NUMBER'
    | 'WRONG_MEASURE'
    | 'UNGROUNDED_DATE'
    | 'UNSUPPORTED_ZERO_COST';
  readonly detail: string;
}

/** Показатели, о которых говорит предложение. */
export function detectMeasures(sentence: string): FactMeasure[] {
  const out: FactMeasure[] = [];
  for (const [measure, patterns] of Object.entries(MEASURE_KEYWORDS) as [FactMeasure, readonly RegExp[]][]) {
    if (patterns.some((re) => re.test(sentence))) out.push(measure);
  }
  return out;
}

const GENERIC_MAX = 12;
const NUMBER_TOKEN_RE = /\d[\d\s ]*(?:[.,]\d+)?/g;

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?;])\s+/u).filter((s) => s.trim().length > 0);
}

interface KeywordHit {
  readonly index: number;
  readonly measure: FactMeasure;
}

/** Все упоминания показателей с позицией в предложении. */
function keywordHits(sentence: string): KeywordHit[] {
  const hits: KeywordHit[] = [];
  for (const [measure, patterns] of Object.entries(MEASURE_KEYWORDS) as [FactMeasure, readonly RegExp[]][]) {
    for (const re of patterns) {
      const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
      for (const m of sentence.matchAll(global)) {
        if (m.index !== undefined) hits.push({ index: m.index, measure });
      }
    }
  }
  return hits.sort((a, b) => a.index - b.index);
}

/**
 * К какому утверждению относится число.
 *
 * Берётся БЛИЖАЙШЕЕ упоминание показателя слева: в предложении
 * «ваш средний балл 4.6, поэтому требуется IELTS 4.6» первое число
 * относится к среднему баллу, второе — к IELTS. Раньше проверка объединяла
 * все показатели предложения, и балл 4.6 «подтверждал» порог IELTS.
 */
function familyForNumber(hits: readonly KeywordHit[], at: number): MeasureFamily | null {
  let chosen: KeywordHit | null = null;
  for (const hit of hits) {
    if (hit.index < at) chosen = hit;
    else if (chosen === null) chosen = hit; // число раньше любого упоминания
  }
  return chosen ? FAMILY_OF[chosen.measure] : null;
}

/** Требование это или результат — по словам вокруг числа. */
function stanceFor(sentence: string, at: number): Stance {
  const before = sentence.slice(0, at);
  // Смотрим последнюю подсказку: она относится к ближайшему утверждению.
  const req = lastIndexOfMatch(before, REQUIREMENT_CUE);
  const res = lastIndexOfMatch(before, RESULT_CUE);
  if (req === -1 && res === -1) return 'any';
  return req > res ? 'requirement' : 'result';
}

function lastIndexOfMatch(text: string, re: RegExp): number {
  const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  let last = -1;
  for (const m of text.matchAll(global)) if (m.index !== undefined) last = m.index;
  return last;
}

/**
 * Проверка фрагмента в области конкретного субъекта.
 *
 * Правила по порядку:
 *  1. даты сверяются целиком с датами субъекта;
 *  2. утверждение о бесплатности требует факта нулевой стоимости;
 *  3. каждое число привязывается к БЛИЖАЙШЕМУ показателю и проверяется
 *     фактом того же семейства у того же субъекта; требование и результат
 *     различаются;
 *  4. послабление для мелких чисел действует только там, где показателя нет
 *     вовсе: балл, сумма и срок «просто счётом» не бывают.
 */
export function checkScoped(
  text: string,
  subject: FactSubject,
  catalogue: FactCatalogue,
): ScopedProblem | null {
  const scope = catalogue.inScope(subject);

  for (const sentence of splitSentences(text)) {
    const dates = findDates(sentence);
    if (dates.length > 0) {
      const allowed = new Set(
        scope.filter((f) => f.valueKind === 'date').map((f) => f.normalized),
      );
      const bad = dates.find((d) => !allowed.has(d.iso));
      if (bad) {
        return {
          code: 'UNGROUNDED_DATE',
          detail: `дата «${bad.raw}» не совпадает ни с одной датой из расчёта для этого варианта`,
        };
      }
    }

    if (ZERO_COST_CLAIM.test(sentence)) {
      const zeroCost = scope.some(
        (f) => f.measure === 'tuition_cost' && Number(f.normalized) === 0,
      );
      if (!zeroCost) {
        return {
          code: 'UNSUPPORTED_ZERO_COST',
          detail: 'утверждение об отсутствии оплаты не подтверждено стоимостью из каталога',
        };
      }
    }

    const hits = keywordHits(sentence);
    const dateRaws = dates.map((d) => d.raw);

    for (const m of sentence.matchAll(NUMBER_TOKEN_RE)) {
      const raw = m[0];
      const at = m.index ?? 0;
      if (dateRaws.some((d) => d.includes(raw.trim()))) continue;

      const normalized = normalizeNumber(raw);
      const value = Number(normalized);
      const family = familyForNumber(hits, at);

      if (family !== null && FACTUAL_FAMILIES.has(family)) {
        const stance = stanceFor(sentence, at);
        const allowed = scope.filter((f) => {
          if (FAMILY_OF[f.measure] !== family) return false;
          if (stance === 'requirement') return REQUIREMENT_MEASURES.has(f.measure);
          if (stance === 'result') return RESULT_MEASURES.has(f.measure) || !REQUIREMENT_MEASURES.has(f.measure);
          return true;
        });

        if (!allowed.some((f) => f.normalized === normalized)) {
          const what =
            stance === 'requirement' ? 'требованию программы'
            : stance === 'result' ? 'вашему результату'
            : 'показателю';
          return {
            code: 'WRONG_MEASURE',
            detail: `значение ${raw.trim()} не подтверждено фактом по ${what} для этого варианта`,
          };
        }
        continue;
      }

      // Показателя рядом нет — число считается счётным, но только мелкое.
      if (Number.isInteger(value) && Math.abs(value) <= GENERIC_MAX) continue;

      if (!scope.some((f) => f.normalized === normalized)) {
        return {
          code: 'UNGROUNDED_NUMBER',
          detail: `значения ${raw.trim()} нет среди фактов этого варианта`,
        };
      }
    }
  }

  return null;
}

export function describeScopedProblem(problem: ScopedProblem): string {
  switch (problem.code) {
    case 'UNGROUNDED_DATE':
      return 'Убран фрагмент с датой, которой нет в расчёте: сроки показываются из каталога.';
    case 'WRONG_MEASURE':
      return 'Убран фрагмент, где число не подтверждено показателем этого варианта — например, средний балл выдан за порог экзамена.';
    case 'UNSUPPORTED_ZERO_COST':
      return 'Убрано утверждение об отсутствии оплаты: стоимость в каталоге его не подтверждает.';
    case 'UNGROUNDED_NUMBER':
      return 'Убран фрагмент с числом, которого нет среди фактов этого варианта.';
  }
}
