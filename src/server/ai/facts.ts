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
  gpa: [/средн\w*\s+балл/i, /\bGPA\b/i, /аттестат\w*\s+балл/i],
  requirement_gpa: [/средн\w*\s+балл/i, /\bGPA\b/i],
  exam_score_ielts: [/\bIELTS\b/i],
  requirement_ielts: [/\bIELTS\b/i],
  exam_score_toefl: [/\bTOEFL\b/i],
  requirement_toefl: [/\bTOEFL\b/i],
  exam_score_ent: [/\bЕНТ\b/i],
  requirement_ent: [/\bЕНТ\b/i],
  tuition_cost: [/стоимост/i, /обучени\w*\s+сто/i, /цен[аыу]/i, /₸/, /тенге/i, /расход/i, /плат[аыу]/i],
  budget_limit: [/бюджет/i],
  funding_amount: [/грант/i, /скидк/i, /стипенди/i, /финансировани/i],
  deadline: [/дедлайн/i, /срок/i, /отсечк/i, /подайте|подача|подать/i, /до\s+\d/i],
  date_generic: [/\bдат\w*/i],
  weekly_hours: [/час\w*\s+в\s+недел/i, /недельн\w*\s+нагрузк/i],
  conditions_count: [/услови\w*\s+выполнен/i, /из\s+\d+\s+услови/i],
  duration_years: [/длительност/i, /лет\s+обучени/i],
};

/**
 * Утверждения, которые выглядят как факт, но числа не содержат.
 *
 * «Обучение бесплатное» — это утверждение о стоимости: его нельзя принимать
 * без факта стоимости, равного нулю.
 */
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

/**
 * Показатели, при которых любое число считается фактическим.
 *
 * Балл, сумма, дата и требование не бывают «просто счётом», поэтому
 * послабление для маленьких чисел здесь не действует.
 */
const FACTUAL_MEASURES: ReadonlySet<FactMeasure> = new Set<FactMeasure>([
  'gpa', 'requirement_gpa',
  'exam_score_ielts', 'requirement_ielts',
  'exam_score_toefl', 'requirement_toefl',
  'exam_score_ent', 'requirement_ent',
  'tuition_cost', 'budget_limit', 'funding_amount',
  'deadline', 'date_generic',
]);

const GENERIC_MAX = 12;
const NUMBER_TOKEN_RE = /\d[\d\s ]*(?:[.,]\d+)?/g;

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?;])\s+/).filter((s) => s.trim().length > 0);
}

/**
 * Проверка фрагмента в области конкретного субъекта.
 *
 * Правила по порядку:
 *  1. даты сверяются целиком с датами субъекта;
 *  2. если предложение говорит о показателе, число обязано совпасть со
 *     значением факта этого субъекта ПО ЭТОМУ ЖЕ показателю;
 *  3. если показатель не назван, число должно встречаться среди значений
 *     субъекта; мелкие целые считаются счётными и пропускаются;
 *  4. утверждение о бесплатности требует факта нулевой стоимости.
 */
export function checkScoped(
  text: string,
  subject: FactSubject,
  catalogue: FactCatalogue,
): ScopedProblem | null {
  const scope = catalogue.inScope(subject);

  for (const sentence of splitSentences(text)) {
    const measures = detectMeasures(sentence);
    const factual = measures.filter((m) => FACTUAL_MEASURES.has(m));

    // 1. Даты — целиком.
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

    // 4. Бесплатность.
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

    // 2 и 3. Числа.
    const dateRaws = dates.map((d) => d.raw);
    const numbers = (sentence.match(NUMBER_TOKEN_RE) ?? []).filter(
      (n) => !dateRaws.some((d) => d.includes(n.trim())),
    );

    for (const raw of numbers) {
      const normalized = normalizeNumber(raw);
      const value = Number(normalized);

      if (factual.length > 0) {
        const allowed = scope.filter((f) => factual.includes(f.measure));
        if (!allowed.some((f) => f.normalized === normalized)) {
          return {
            code: 'WRONG_MEASURE',
            detail:
              `значение ${raw.trim()} не подтверждено фактом по показателю ` +
              `«${factual.join(', ')}» для этого варианта`,
          };
        }
        continue;
      }

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
