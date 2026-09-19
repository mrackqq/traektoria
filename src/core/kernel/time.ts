/**
 * BR-06 / BR-07 / MODEL-03 — даты, дедлайны и планировочные часы.
 *
 * Главный инвариант этого модуля (BR-07): отсутствие времени или часовой зоны
 * в критическом источнике означает НЕОПРЕДЕЛЁННОСТЬ, а не автоматические 23:59.
 * Ни одна функция здесь не придумывает недостающий момент времени.
 *
 * MODEL-03: планировщик получает clock явно. Внутри модуля нет Date.now().
 */

/** Явные планировочные часы. Передаются в расчёт, а не берутся из окружения. */
export interface PlanningClock {
  /** Момент расчёта, UTC ISO-8601. */
  readonly now: string;
  /** Часовой пояс пользователя (IANA), для отображения и рабочего календаря. */
  readonly timezone: string;
}

/** Календарная дата без времени. Хранится как дата, не как выдуманный instant. */
export type PlainDate = string; // YYYY-MM-DD

export type DeadlineKind =
  | 'application_submission'
  | 'document_receipt'
  | 'result_submission'
  | 'funding_competition'
  | 'personal_target';

export const DEADLINE_KIND_LABEL_RU: Record<DeadlineKind, string> = {
  application_submission: 'Приём заявления',
  document_receipt: 'Получение документа',
  result_submission: 'Предоставление результата',
  funding_competition: 'Конкурс финансирования',
  personal_target: 'Личная цель',
};

/** Исходная точность источника. `unknown` — источник не задал дату однозначно. */
export type DeadlinePrecision = 'instant' | 'date_only' | 'month_only' | 'unknown';

export interface Deadline {
  readonly id: string;
  readonly kind: DeadlineKind;
  readonly precision: DeadlinePrecision;
  readonly localDate?: PlainDate;
  /** HH:mm. Отсутствует, если источник не указал время. Не подставляется. */
  readonly localTime?: string;
  /** IANA-зона. Отсутствует, если источник не указал зону. Не подставляется. */
  readonly timezone?: string;
  /** Правило включительности. 'unknown' — источник не уточнил. */
  readonly inclusive: boolean | 'unknown';
  /**
   * BR-07: жёсткая внешняя отсечка не переносится планировщиком.
   * Личная целевая дата переносима, но всегда отличается от внешней.
   */
  readonly hard: boolean;
  readonly sourceId: string | null;
  readonly note?: string;
}

/**
 * Разрешение дедлайна в момент времени.
 *
 * `certain` — источник задал дату, время и зону.
 * `range`   — известен день (или месяц), но не момент: даём интервал и признак
 *             неопределённости. Планировщик обязан использовать консервативную
 *             границу и показать неопределённость (AC-08).
 * `unresolved` — планировать по этому дедлайну нельзя, нужна задача проверки.
 */
export type ResolvedDeadline =
  | { kind: 'certain'; instantUtc: string }
  | { kind: 'range'; earliestUtc: string; latestUtc: string; reason: DeadlineUncertainty }
  | { kind: 'unresolved'; reason: DeadlineUncertainty };

export type DeadlineUncertainty =
  | 'missing_time'
  | 'missing_timezone'
  | 'month_precision_only'
  | 'no_date';

/**
 * Перевод локального времени в конкретной IANA-зоне в UTC-инстант.
 * Двухпроходная коррекция смещения покрывает переходы летнего времени.
 */
export function zonedToUtc(date: PlainDate, time: string, timeZone: string): string {
  const naive = Date.parse(`${date}T${time}:00Z`);
  if (Number.isNaN(naive)) throw new RangeError(`Некорректная дата/время: ${date}T${time}`);
  let utc = naive;
  for (let i = 0; i < 2; i++) {
    const offset = zoneOffsetMs(utc, timeZone);
    utc = naive - offset;
  }
  return new Date(utc).toISOString();
}

/** Смещение зоны (мс) в указанный момент. */
function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') === 24 ? 0 : get('hour'),
    get('minute'),
    get('second'),
  );
  return asUtc - utcMs;
}

/**
 * BR-07 в чистом виде: если источник не дал время или зону — возвращается
 * интервал с причиной, а не выдуманный момент. AC-08 проверяет именно это.
 */
export function resolveDeadline(d: Deadline): ResolvedDeadline {
  if (!d.localDate) {
    return {
      kind: 'unresolved',
      reason: d.precision === 'month_only' ? 'month_precision_only' : 'no_date',
    };
  }
  if (d.precision === 'month_only') {
    return { kind: 'unresolved', reason: 'month_precision_only' };
  }
  if (!d.timezone) {
    // Зона неизвестна: реальный момент может отличаться примерно на сутки.
    // Планировать можно только по самой ранней из возможных границ.
    const earliest = `${d.localDate}T00:00:00.000Z`;
    const latest = new Date(Date.parse(`${d.localDate}T23:59:59.999Z`) + 14 * 3600_000).toISOString();
    return { kind: 'range', earliestUtc: earliest, latestUtc: latest, reason: 'missing_timezone' };
  }
  if (!d.localTime) {
    // День известен, момент — нет. Не подставляем 23:59 (BR-07).
    return {
      kind: 'range',
      earliestUtc: zonedToUtc(d.localDate, '00:00', d.timezone),
      latestUtc: zonedToUtc(d.localDate, '23:59', d.timezone),
      reason: 'missing_time',
    };
  }
  return { kind: 'certain', instantUtc: zonedToUtc(d.localDate, d.localTime, d.timezone) };
}

/**
 * Консервативная планировочная граница: самый ранний момент, к которому
 * обязательство точно должно быть исполнено. Для неопределённого дедлайна это
 * ранняя граница интервала — планировщик не вправе рассчитывать на позднюю.
 */
export function conservativeCutoff(d: Deadline): { utc: string; uncertain: boolean } | null {
  const r = resolveDeadline(d);
  if (r.kind === 'certain') return { utc: r.instantUtc, uncertain: false };
  if (r.kind === 'range') return { utc: r.earliestUtc, uncertain: true };
  return null;
}

export function isUncertain(d: Deadline): boolean {
  return resolveDeadline(d).kind !== 'certain';
}

/* ------------------------------------------------------------------ */
/* Арифметика дат и рабочий календарь (BR-06)                          */
/* ------------------------------------------------------------------ */

export const DAY_MS = 86_400_000;

export function plainDateToUtcMidnight(d: PlainDate): number {
  const ms = Date.parse(`${d}T00:00:00Z`);
  if (Number.isNaN(ms)) throw new RangeError(`Некорректная дата: ${d}`);

  // `Date.parse` не проверяет существование числа в месяце, а молча
  // переносит его вперёд: «2027-02-31» превращается в 3 марта. Дальше по
  // расчёту это уже не ошибка, а другая настоящая дата — срок подачи,
  // сдвинутый на трое суток без единого предупреждения. Сверяем обратным
  // преобразованием: настоящая дата обязана совпасть сама с собой.
  if (new Date(ms).toISOString().slice(0, 10) !== d) {
    throw new RangeError(`Несуществующая дата: ${d}`);
  }
  return ms;
}

export function utcMsToPlainDate(ms: number): PlainDate {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(d: PlainDate, days: number): PlainDate {
  return utcMsToPlainDate(plainDateToUtcMidnight(d) + days * DAY_MS);
}

export function daysBetween(from: PlainDate, to: PlainDate): number {
  return Math.round((plainDateToUtcMidnight(to) - plainDateToUtcMidnight(from)) / DAY_MS);
}

/** Календарь рабочих дней. BR-06 требует учитывать выходные по выбранному календарю. */
export interface WorkCalendar {
  readonly id: string;
  /** 0 = воскресенье … 6 = суббота. */
  readonly weekend: readonly number[];
  readonly holidays: readonly PlainDate[];
}

export const KZ_CALENDAR: WorkCalendar = {
  id: 'kz-2026-demo',
  weekend: [0, 6],
  // Демонстрационный набор: официальный производственный календарь —
  // отдельный источник, который должен публиковаться через каталог (DATA-02).
  holidays: [
    '2026-01-01', '2026-01-02', '2026-03-08', '2026-03-21', '2026-03-22',
    '2026-03-23', '2026-05-01', '2026-05-07', '2026-05-09', '2026-07-06',
    '2026-08-30', '2026-10-25', '2026-12-16', '2026-12-17',
    '2027-01-01', '2027-01-02', '2027-03-08', '2027-03-21', '2027-03-22',
    '2027-03-23', '2027-05-01', '2027-05-07', '2027-05-09', '2027-07-06',
    '2027-08-30', '2027-10-25', '2027-12-16', '2027-12-17',
  ],
};

export function isWorkingDay(d: PlainDate, cal: WorkCalendar): boolean {
  const dow = new Date(plainDateToUtcMidnight(d)).getUTCDay();
  if (cal.weekend.includes(dow)) return false;
  return !cal.holidays.includes(d);
}

/**
 * Проверка счётчика дней.
 *
 * Отрицательное N прежде проходило молча: цикл `while (left > 0)` не
 * выполнялся ни разу, и функция возвращала исходную дату. Для планировщика
 * это худший из исходов — расчёт «сдвинули на −5 дней» выглядел как
 * «сдвигать не понадобилось», и ошибка в вызывающем коде растворялась
 * в правдоподобном расписании. Направление задаётся выбором функции,
 * а не знаком аргумента.
 */
function assertDayCount(fn: string, n: number): void {
  if (!Number.isInteger(n) || n < 0) {
    throw new RangeError(`${fn}: число дней должно быть целым неотрицательным, получено ${n}`);
  }
}

/** Сдвиг на N рабочих дней вперёд (N ≥ 0). */
export function addWorkingDays(d: PlainDate, n: number, cal: WorkCalendar): PlainDate {
  assertDayCount('addWorkingDays', n);
  let cur = d;
  let left = n;
  let guard = 0;
  while (left > 0) {
    cur = addDays(cur, 1);
    if (isWorkingDay(cur, cal)) left--;
    if (++guard > 10_000) throw new Error('addWorkingDays: превышен лимит итераций');
  }
  return cur;
}

/** Сдвиг на N рабочих дней назад — основа обратного планирования (BR-06). */
export function subWorkingDays(d: PlainDate, n: number, cal: WorkCalendar): PlainDate {
  assertDayCount('subWorkingDays', n);
  let cur = d;
  let left = n;
  let guard = 0;
  while (left > 0) {
    cur = addDays(cur, -1);
    if (isWorkingDay(cur, cal)) left--;
    if (++guard > 10_000) throw new Error('subWorkingDays: превышен лимит итераций');
  }
  return cur;
}

export function countWorkingDays(from: PlainDate, to: PlainDate, cal: WorkCalendar): number {
  if (daysBetween(from, to) < 0) return 0;
  let n = 0;
  let cur = from;
  let guard = 0;
  while (daysBetween(cur, to) >= 0) {
    if (isWorkingDay(cur, cal)) n++;
    cur = addDays(cur, 1);
    if (++guard > 10_000) throw new Error('countWorkingDays: превышен лимит итераций');
  }
  return n;
}

/* ------------------------------------------------------------------ */
/* Форматирование (NFR-08)                                             */
/* ------------------------------------------------------------------ */

const MONTHS_RU_GEN = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

export function formatPlainDateRu(d: PlainDate, opts?: { withYear?: boolean }): string {
  const ms = plainDateToUtcMidnight(d);
  const dt = new Date(ms);
  const day = dt.getUTCDate();
  const month = MONTHS_RU_GEN[dt.getUTCMonth()];
  const year = dt.getUTCFullYear();
  return opts?.withYear === false ? `${day} ${month}` : `${day} ${month} ${year}`;
}

/**
 * Подпись дедлайна для интерфейса. UX-05: внешняя отсечка и личная дата
 * отличаются подписью, не только цветом. Неопределённость проговаривается.
 */
export function describeDeadlineRu(d: Deadline): string {
  const r = resolveDeadline(d);
  if (!d.localDate) return 'Дата не опубликована';
  const base = formatPlainDateRu(d.localDate);
  switch (r.kind) {
    case 'certain':
      return `${base}, ${d.localTime} (${d.timezone})`;
    case 'range':
      return r.reason === 'missing_time'
        ? `${base}, время не указано в источнике`
        : `${base}, часовой пояс не указан в источнике`;
    case 'unresolved':
      return 'Дата не определена источником';
  }
}
