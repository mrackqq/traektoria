/**
 * Даты, часовые пояса и рабочие дни.
 *
 * BR-07 — главное правило этого модуля: отсутствующие время и зона НЕ
 * подставляются. Срок без часового пояса остаётся интервалом, а не
 * превращается в точный момент, который выглядел бы как факт от источника.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addDays,
  addWorkingDays,
  conservativeCutoff,
  countWorkingDays,
  daysBetween,
  describeDeadlineRu,
  formatPlainDateRu,
  isUncertain,
  isWorkingDay,
  KZ_CALENDAR,
  plainDateToUtcMidnight,
  resolveDeadline,
  subWorkingDays,
  utcMsToPlainDate,
  zonedToUtc,
  type Deadline,
} from './time.ts';

const deadline = (over: Partial<Deadline> = {}): Deadline => ({
  id: 'd1',
  kind: 'application_submission',
  precision: 'date_only',
  localDate: '2027-07-25',
  inclusive: true,
  hard: true,
  sourceId: 's1',
  ...over,
});

/* ------------------------------------------------------------------ */
/* Календарная арифметика                                              */
/* ------------------------------------------------------------------ */

test('Сдвиг на дни и расстояние между датами взаимно обратны', () => {
  assert.equal(addDays('2027-05-01', 10), '2027-05-11');
  assert.equal(addDays('2027-05-01', -1), '2027-04-30');
  assert.equal(daysBetween('2027-05-01', '2027-05-11'), 10);
  assert.equal(daysBetween('2027-05-11', '2027-05-01'), -10);
  assert.equal(daysBetween('2027-05-01', '2027-05-01'), 0);
});

test('Переход через границу года и високосный день', () => {
  assert.equal(addDays('2027-12-31', 1), '2028-01-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29', '2028 — високосный год');
  assert.equal(daysBetween('2028-02-28', '2028-03-01'), 2);
});

test('Календарная арифметика не зависит от перехода на летнее время', () => {
  // Все вычисления идут от полуночи UTC, поэтому «плюс один день» всегда
  // ровно один день, даже когда в местной зоне сутки короче или длиннее.
  assert.equal(addDays('2027-03-27', 1), '2027-03-28');
  assert.equal(daysBetween('2027-03-27', '2027-03-29'), 2);
});

test('Разбор и сборка календарной даты симметричны', () => {
  const ms = plainDateToUtcMidnight('2027-05-01');
  assert.equal(utcMsToPlainDate(ms), '2027-05-01');
  assert.throws(() => plainDateToUtcMidnight('2027-02-31'), RangeError);
  assert.throws(() => plainDateToUtcMidnight('не дата'), RangeError);
});

/* ------------------------------------------------------------------ */
/* Рабочие дни                                                         */
/* ------------------------------------------------------------------ */

test('Выходные и праздники не считаются рабочими днями', () => {
  assert.equal(isWorkingDay('2027-05-03', KZ_CALENDAR), true, 'понедельник');
  assert.equal(isWorkingDay('2027-05-01', KZ_CALENDAR), false, 'суббота');
  assert.equal(isWorkingDay('2027-05-02', KZ_CALENDAR), false, 'воскресенье');
});

test('BR-06: сдвиг на рабочие дни перешагивает выходные', () => {
  // 14 мая 2027 — пятница, 17 мая — понедельник; праздников между ними нет.
  assert.equal(addWorkingDays('2027-05-14', 1, KZ_CALENDAR), '2027-05-17');
  assert.equal(subWorkingDays('2027-05-17', 1, KZ_CALENDAR), '2027-05-14');
});

test('BR-06: государственный праздник тоже пропускается', () => {
  // 7 мая — праздник и пятница, 8–9 мая выходные (9 мая ещё и праздник),
  // поэтому следующий рабочий день после четверга 6 мая — понедельник 10-го.
  assert.equal(isWorkingDay('2027-05-07', KZ_CALENDAR), false, '7 мая — праздник');
  assert.equal(addWorkingDays('2027-05-06', 1, KZ_CALENDAR), '2027-05-10');
  assert.equal(subWorkingDays('2027-05-10', 1, KZ_CALENDAR), '2027-05-06');
});

test('Ноль рабочих дней оставляет дату на месте', () => {
  assert.equal(addWorkingDays('2027-05-03', 0, KZ_CALENDAR), '2027-05-03');
  assert.equal(subWorkingDays('2027-05-03', 0, KZ_CALENDAR), '2027-05-03');
});

test('Отрицательное число дней отвергается, а не игнорируется молча', () => {
  // Прежде цикл `while (left > 0)` не выполнялся ни разу и функция
  // возвращала исходную дату: ошибка в планировщике выглядела как
  // «сдвигать не понадобилось» и растворялась в правдоподобном расписании.
  assert.throws(() => addWorkingDays('2027-05-03', -5, KZ_CALENDAR), RangeError);
  assert.throws(() => subWorkingDays('2027-05-03', -5, KZ_CALENDAR), RangeError);
  assert.throws(() => addWorkingDays('2027-05-03', 1.5, KZ_CALENDAR), RangeError);
});

test('Подсчёт рабочих дней в интервале', () => {
  assert.equal(countWorkingDays('2027-05-10', '2027-05-14', KZ_CALENDAR), 5, 'полная рабочая неделя');
  assert.equal(
    countWorkingDays('2027-05-03', '2027-05-07', KZ_CALENDAR),
    4,
    'та же длина недели, но 7 мая — праздник',
  );
  assert.equal(countWorkingDays('2027-05-10', '2027-05-10', KZ_CALENDAR), 1, 'один рабочий день');
  assert.equal(countWorkingDays('2027-05-01', '2027-05-02', KZ_CALENDAR), 0, 'только выходные');
  assert.equal(
    countWorkingDays('2027-05-14', '2027-05-10', KZ_CALENDAR),
    0,
    'перевёрнутый интервал даёт ноль, а не отрицательное число',
  );
});

/* ------------------------------------------------------------------ */
/* Часовые пояса                                                       */
/* ------------------------------------------------------------------ */

test('Местное время переводится в UTC по заданной зоне', () => {
  assert.equal(zonedToUtc('2027-07-25', '18:00', 'Asia/Almaty'), '2027-07-25T13:00:00.000Z');
  assert.equal(zonedToUtc('2027-01-15', '00:00', 'UTC'), '2027-01-15T00:00:00.000Z');
});

test('Перевод учитывает переход на летнее время', () => {
  // В Стамбуле перехода нет (UTC+3 круглый год), в Берлине есть.
  const winter = zonedToUtc('2027-01-15', '12:00', 'Europe/Berlin');
  const summer = zonedToUtc('2027-07-15', '12:00', 'Europe/Berlin');
  assert.equal(winter, '2027-01-15T11:00:00.000Z', 'зимой Берлин — UTC+1');
  assert.equal(summer, '2027-07-15T10:00:00.000Z', 'летом Берлин — UTC+2');
});

test('Непригодные аргументы перевода отвергаются', () => {
  assert.throws(() => zonedToUtc('не дата', '12:00', 'UTC'), RangeError);
  assert.throws(() => zonedToUtc('2027-01-15', '25:99', 'UTC'), RangeError);
});

/* ------------------------------------------------------------------ */
/* BR-07: неопределённость срока                                       */
/* ------------------------------------------------------------------ */

test('BR-07: полностью заданный срок — точный момент', () => {
  const r = resolveDeadline(deadline({ localTime: '18:00', timezone: 'Asia/Almaty' }));
  assert.equal(r.kind, 'certain');
  assert.ok(r.kind === 'certain' && r.instantUtc === '2027-07-25T13:00:00.000Z');
  assert.equal(isUncertain(deadline({ localTime: '18:00', timezone: 'Asia/Almaty' })), false);
});

test('BR-07: срок без времени остаётся интервалом на сутки', () => {
  const r = resolveDeadline(deadline({ timezone: 'Asia/Almaty' }));
  assert.equal(r.kind, 'range');
  assert.ok(r.kind === 'range' && r.reason === 'missing_time');
});

test('BR-07: срок без часового пояса не превращается в точный момент', () => {
  // Источник не указал зону — значит настоящая отсечка может быть где угодно
  // в пределах мирового разброса смещений. Подставить «наверное, Алматы»
  // означало бы выдать догадку за условие приёма.
  const r = resolveDeadline(deadline({ localTime: '18:00' }));
  assert.equal(r.kind, 'range');
  assert.ok(r.kind === 'range' && r.reason === 'missing_timezone');
  assert.ok(r.kind === 'range' && r.earliestUtc < r.latestUtc);
  assert.equal(isUncertain(deadline({ localTime: '18:00' })), true);
});

test('BR-07: точность «только месяц» и отсутствие даты не дают отсечки', () => {
  assert.equal(resolveDeadline(deadline({ precision: 'month_only' })).kind, 'unresolved');

  const noDate = resolveDeadline(deadline({ localDate: undefined }));
  assert.equal(noDate.kind, 'unresolved');
  assert.ok(noDate.kind === 'unresolved' && noDate.reason === 'no_date');
});

test('Консервативная отсечка берёт поздний край интервала и помечает неопределённость', () => {
  const certain = conservativeCutoff(deadline({ localTime: '18:00', timezone: 'Asia/Almaty' }));
  assert.equal(certain?.uncertain, false);

  const vague = conservativeCutoff(deadline({ localTime: '18:00' }));
  assert.equal(vague?.uncertain, true, 'неопределённость обязана дойти до планировщика');

  assert.equal(conservativeCutoff(deadline({ localDate: undefined })), null);
});

/* ------------------------------------------------------------------ */
/* Тексты                                                              */
/* ------------------------------------------------------------------ */

test('NFR-08: дата по-русски в родительном падеже', () => {
  assert.equal(formatPlainDateRu('2027-07-25'), '25 июля 2027');
  assert.equal(formatPlainDateRu('2027-01-01', { withYear: false }), '1 января');
});

test('Описание срока честно называет неопределённость', () => {
  const exact = describeDeadlineRu(deadline({ localTime: '18:00', timezone: 'Asia/Almaty' }));
  const vague = describeDeadlineRu(deadline({ localTime: '18:00' }));

  assert.ok(exact.length > 0);
  assert.notEqual(vague, exact, 'срок без зоны не должен выглядеть так же уверенно, как точный');
});
