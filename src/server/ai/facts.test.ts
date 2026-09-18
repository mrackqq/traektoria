/**
 * Привязка утверждений модели к конкретным фактам расчёта.
 *
 * Тесты начинаются с трёх формулировок, которые прежняя проверка принимала,
 * хотя ни одну из них расчёт не подтверждает:
 *  • «Подайте заявление до 12 октября 2027 года» — год существует, дата нет;
 *  • «требуется IELTS 4.6» — 4.6 это средний балл профиля, а не порог экзамена;
 *  • «Обучение на этой программе бесплатное» — чисел нет вовсе.
 *
 * Плюс перенос стоимости между программами: число реально существует,
 * но принадлежит другому варианту.
 *
 * Запуск: npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { checkScoped, FactCatalogue, findDates, type FactSubject } from './facts.ts';

const PATH_A: FactSubject = { kind: 'path', id: 'sdu-cs-2027-paid' };
const PATH_B: FactSubject = { kind: 'path', id: 'nu-cs-2027-paid' };

function catalogue(): FactCatalogue {
  const c = new FactCatalogue();

  // Профиль.
  c.add({ subject: { kind: 'profile' }, measure: 'gpa', valueKind: 'number',
    display: '4.6', normalized: '4.6', label: 'Ваш средний балл' });
  c.add({ subject: { kind: 'profile' }, measure: 'budget_limit', valueKind: 'money',
    display: '3 000 000 ₸', normalized: '3000000', label: 'Ваш бюджет' });

  // Программа A: дешёвая, порог IELTS 6.0, отсечка 5 июля 2027.
  c.add({ subject: PATH_A, measure: 'tuition_cost', valueKind: 'money',
    display: '1 300 000 ₸', normalized: '1300000', label: 'Обязательные расходы' });
  c.add({ subject: PATH_A, measure: 'requirement_ielts', valueKind: 'number',
    display: '6', normalized: '6', label: 'IELTS — минимум' });
  c.add({ subject: PATH_A, measure: 'deadline', valueKind: 'date',
    display: '5 июля 2027', normalized: '2027-07-05', label: 'Ближайшая отсечка' });

  // Программа B: дороже, другой порог.
  c.add({ subject: PATH_B, measure: 'tuition_cost', valueKind: 'money',
    display: '3 500 000 ₸', normalized: '3500000', label: 'Обязательные расходы' });
  c.add({ subject: PATH_B, measure: 'requirement_ielts', valueKind: 'number',
    display: '6.5', normalized: '6.5', label: 'IELTS — минимум' });

  return c;
}

const CAT = catalogue();

test('Выдуманная дата отбрасывается, даже если её год есть в расчёте', () => {
  // 2027 существует у этой программы, но дата отсечки — 5 июля, не 12 октября.
  const problem = checkScoped('Подайте заявление до 12 октября 2027 года.', PATH_A, CAT);

  assert.ok(problem, 'дата не подтверждена');
  assert.equal(problem!.code, 'UNGROUNDED_DATE');
  assert.match(problem!.detail, /12 октября 2027/);
});

test('Подтверждённая дата проходит', () => {
  assert.equal(checkScoped('Ближайшая отсечка — 5 июля 2027 года.', PATH_A, CAT), null);
});

test('Средний балл не переносится в порог IELTS', () => {
  const problem = checkScoped(
    'Для поступления в эту программу требуется IELTS 4.6.',
    PATH_A,
    CAT,
  );

  assert.ok(problem, '4.6 — это GPA, а не порог экзамена');
  assert.equal(problem!.code, 'WRONG_MEASURE');
});

test('Настоящий порог IELTS этой программы проходит', () => {
  assert.equal(checkScoped('Нужен IELTS от 6 баллов.', PATH_A, CAT), null);
});

test('Порог другой программы не подтверждает эту', () => {
  // 6.5 существует в каталоге, но принадлежит программе B.
  const problem = checkScoped('Здесь требуется IELTS 6.5.', PATH_A, CAT);

  assert.ok(problem, 'чужой порог не подходит');
  assert.equal(problem!.code, 'WRONG_MEASURE');
});

test('Стоимость одной программы не переносится в другую', () => {
  const problem = checkScoped('Обучение стоит 3 500 000 ₸ в год.', PATH_A, CAT);

  assert.ok(problem, 'это стоимость другой программы');
  assert.equal(problem!.code, 'WRONG_MEASURE');

  // Собственная стоимость при этом проходит.
  assert.equal(checkScoped('Обучение стоит 1 300 000 ₸ в год.', PATH_A, CAT), null);
});

test('Неподтверждённое «бесплатное обучение» отбрасывается', () => {
  const problem = checkScoped('Обучение на этой программе бесплатное.', PATH_A, CAT);

  assert.ok(problem, 'чисел нет, но это утверждение о стоимости');
  assert.equal(problem!.code, 'UNSUPPORTED_ZERO_COST');
});

test('Бесплатность проходит, когда стоимость в каталоге нулевая', () => {
  const free = catalogue();
  const PATH_FREE: FactSubject = { kind: 'path', id: 'tum-cs-2027-intl' };
  free.add({ subject: PATH_FREE, measure: 'tuition_cost', valueKind: 'money',
    display: '0 ₸', normalized: '0', label: 'Обязательные расходы' });

  assert.equal(checkScoped('Платы за обучение нет.', PATH_FREE, free), null);
});

test('Малое число не проходит автоматически, когда речь о балле', () => {
  // 5 меньше порога «счётных» чисел, но это утверждение о балле IELTS.
  const problem = checkScoped('Достаточно IELTS 5.', PATH_A, CAT);

  assert.ok(problem, 'балл обязан подтверждаться фактом');
  assert.equal(problem!.code, 'WRONG_MEASURE');
});

test('Малое число проходит, когда это счёт, а не показатель', () => {
  assert.equal(checkScoped('Разбейте подготовку на 3 этапа.', PATH_A, CAT), null);
});

test('Факты профиля доступны в области любой программы', () => {
  assert.equal(checkScoped('Ваш средний балл 4.6 уже выше порога.', PATH_A, CAT), null);
});

test('Разбор дат понимает оба формата', () => {
  assert.deepEqual(findDates('срок 2027-07-05').map((d) => d.iso), ['2027-07-05']);
  assert.deepEqual(findDates('до 12 октября 2027 года').map((d) => d.iso), ['2027-10-12']);
});

test('Факты в области субъекта включают профиль и не включают чужую программу', () => {
  const scoped = CAT.inScope(PATH_A);
  assert.ok(scoped.some((f) => f.subject.kind === 'profile'), 'профиль доступен');
  assert.ok(
    !scoped.some((f) => f.subject.kind === 'path' && f.subject.id === 'nu-cs-2027-paid'),
    'чужая программа недоступна',
  );
});

/* ------------------------------------------------------------------ */
/* Примеры, которые фильтр пропускал                                   */
/* ------------------------------------------------------------------ */

test('Средний балл не подтверждает порог IELTS в одном предложении', () => {
  // 4.6 — настоящий средний балл профиля, но порог IELTS здесь 6.
  // Раньше проверка объединяла показатели предложения, и оба числа проходили.
  const problem = checkScoped(
    'Ваш средний балл GPA 4.6, поэтому требуется IELTS 4.6.',
    PATH_A,
    CAT,
  );

  assert.ok(problem, 'второе число не подтверждено');
  assert.equal(problem!.code, 'WRONG_MEASURE');
  assert.match(problem!.detail, /требованию программы/);
});

test('Неверный средний балл отбрасывается: кириллица распознаётся', () => {
  // Раньше /средн\w*\s+балл/ не срабатывал на «средний»: \w не покрывает
  // кириллицу, показатель не определялся, и 8 проходило как мелкое число.
  const problem = checkScoped('Средний балл 8.', PATH_A, CAT);

  assert.ok(problem, 'число обязано подтверждаться фактом');
  assert.equal(problem!.code, 'WRONG_MEASURE');
});

test('Неподтверждённое требование ЕНТ отбрасывается', () => {
  // ЕНТ не работал:  опирается на \w, а кириллица в него не входит.
  const problem = checkScoped('Требуется ЕНТ 5.', PATH_A, CAT);

  assert.ok(problem, 'порога ЕНТ у этой программы нет');
  assert.equal(problem!.code, 'WRONG_MEASURE');
});

test('Настоящий результат пользователя проходит, а требование с тем же числом — нет', () => {
  const withEnt = catalogue();
  withEnt.add({ subject: { kind: 'profile' }, measure: 'exam_score_ent', valueKind: 'number',
    display: '95', normalized: '95', label: 'Ваш результат ЕНТ' });

  assert.equal(
    checkScoped('Ваш результат ЕНТ 95 уже есть.', PATH_A, withEnt),
    null,
    'результат пользователя подтверждён',
  );

  const asRequirement = checkScoped('Требуется ЕНТ 95.', PATH_A, withEnt);
  assert.ok(asRequirement, 'то же число как требование программы не подтверждено');
  assert.equal(asRequirement!.code, 'WRONG_MEASURE');
});

test('Корректные утверждения по разным показателям проходят', () => {
  const ok = [
    'Ваш средний балл 4.6 выше порога этой программы.',
    'Нужен IELTS от 6 баллов.',
    'Обязательные расходы 1 300 000 ₸ укладываются в бюджет 3 000 000 ₸.',
    'Ближайшая отсечка — 5 июля 2027 года.',
    'Разбейте подготовку на 3 этапа.',
  ];

  for (const text of ok) {
    assert.equal(checkScoped(text, PATH_A, CAT), null, text);
  }
});

test('Запреты на выдумки сохранены', () => {
  assert.equal(checkScoped('Подайте заявление до 1 марта 2031 года.', PATH_A, CAT)?.code, 'UNGROUNDED_DATE');
  assert.equal(checkScoped('Обучение бесплатное.', PATH_A, CAT)?.code, 'UNSUPPORTED_ZERO_COST');
  assert.equal(checkScoped('Стоимость обучения 9 900 000 ₸.', PATH_A, CAT)?.code, 'WRONG_MEASURE');
});
