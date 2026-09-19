/**
 * Реакция подбора и маршрута на изменение анкеты.
 *
 * Это сквозной снимок поведения: одно изменение в профиле — одно ожидаемое
 * следствие в выдаче. Такие проверки дёшевы и ловят регрессии в двадцати
 * тысячах строк доменной логики, которые юнит-тест отдельной функции
 * пропустит: считает-то каждая функция правильно, а вместе получается не то.
 *
 * Числа здесь измерены на посеянном каталоге при фиксированных часах. Если
 * каталог осознанно меняют, эти числа меняются вместе с ним — тест обязан
 * упасть и потребовать подтверждения, а не подстроиться молча.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSession, DEMO_CLOCK } from './session.ts';
import { buildDemoProfile } from './profile.ts';
import { known } from '../kernel/profile.ts';
import { money } from '../kernel/money.ts';
import { addDays, utcMsToPlainDate } from '../kernel/time.ts';

const BASE = buildDemoProfile(DEMO_CLOCK.now);
const TODAY = utcMsToPlainDate(Date.parse(DEMO_CLOCK.now));

type Profile = typeof BASE;

const session = (profile: Profile = BASE) => buildSession({ profile, clock: DEMO_CLOCK });

const counts = (profile: Profile = BASE) => {
  const r = session(profile).recommendation;
  return {
    recommended: r.recommended.length,
    alternatives: r.alternatives.length,
    needsVerification: r.needsVerification.length,
    notSuitable: r.notSuitable.length,
    first: r.recommended[0]?.admissionPathId ?? null,
  };
};

const budgetOf = (amountMinor: bigint) =>
  known({
    limit: money(amountMinor, 'KZT'),
    scope: 'total' as const,
    period: 'academic_year' as const,
    availability: [],
  });

/* ------------------------------------------------------------------ */
/* Базовый снимок                                                      */
/* ------------------------------------------------------------------ */

test('Демо-профиль даёт устойчивую раскладку по группам', () => {
  const c = counts();

  assert.deepEqual(c, {
    recommended: 4,
    alternatives: 3,
    needsVerification: 6,
    notSuitable: 12,
    first: 'sdu-cs-2027-paid',
  });
});

test('Сумма групп равна числу рассмотренных путей', () => {
  const r = session().recommendation;
  const total =
    r.recommended.length + r.alternatives.length + r.needsVerification.length + r.notSuitable.length;

  assert.equal(total, r.consideredPathCount);
});

test('Маршрут демо-профиля состоит из ожидаемых действий', () => {
  const tasks = session().route?.tasks.map((t) => t.semanticKey) ?? [];

  assert.deepEqual(tasks, [
    'doc:school_certificate',
    'ent:result',
    'activity:portfolio',
    'activity:competition',
    'application:submit',
  ]);
});

/* ------------------------------------------------------------------ */
/* Деньги                                                              */
/* ------------------------------------------------------------------ */

test('Сокращение бюджета втрое сужает подбор и меняет первый вариант', () => {
  const rich = counts();
  const poor = counts({ ...BASE, budget: budgetOf(120_000_000n) });

  assert.ok(poor.recommended < rich.recommended, `было ${rich.recommended}, стало ${poor.recommended}`);
  assert.ok(
    poor.notSuitable > rich.notSuitable,
    'то, что стало не по карману, обязано уйти в исключённые с причиной',
  );
  assert.notEqual(poor.first, rich.first, 'первым становится другой, более дешёвый вариант');
});

test('Исключённые по деньгам объясняют причину', () => {
  const r = session({ ...BASE, budget: budgetOf(120_000_000n) }).recommendation;
  const byMoney = r.notSuitable.filter((a) => a.financial.kind === 'known_gap');

  assert.ok(byMoney.length > 0, 'при урезанном бюджете кто-то обязан не пройти по деньгам');
  for (const a of byMoney) {
    assert.ok(a.exclusionReason, `вариант ${a.admissionPathId} исключён молча`);
  }
});

/* ------------------------------------------------------------------ */
/* Фильтры                                                             */
/* ------------------------------------------------------------------ */

test('Страна вне каталога не даёт подходящих, но и не прячет варианты', () => {
  // Каталог содержит только Казахстан. Честный ответ — «в ваших фильтрах
  // ничего нет, вот что есть за их пределами», а не пустой экран.
  const c = counts({ ...BASE, targetCountries: ['TR'] });

  assert.equal(c.recommended, 0);
  assert.ok(c.alternatives > 0, 'варианты за пределами фильтров обязаны быть показаны');
});

test('Смена интереса переносит варианты в альтернативы, а не удаляет их', () => {
  const base = counts();
  const business = counts({ ...BASE, interests: ['business_economics'] });

  assert.ok(business.alternatives > base.alternatives, 'прежние варианты уходят за фильтр');
  assert.equal(
    business.recommended + business.alternatives + business.needsVerification + business.notSuitable,
    base.recommended + base.alternatives + base.needsVerification + base.notSuitable,
    'общее число рассмотренных путей от смены интереса не меняется',
  );
});

test('Нехватка подходящих всегда объясняется', () => {
  const r = session({ ...BASE, targetCountries: ['TR'] }).recommendation;

  assert.ok(r.shortfallReason, 'ноль подходящих без объяснения — худший вариант пустого экрана');
});

/* ------------------------------------------------------------------ */
/* Категория заявителя                                                 */
/* ------------------------------------------------------------------ */

test('Иностранный заявитель теряет пути «только для граждан РК»', () => {
  const kz = counts();
  const foreign = counts({ ...BASE, applicantCategory: known('foreign' as const) });

  assert.ok(
    foreign.notSuitable > kz.notSuitable,
    `исключённых должно стать больше: было ${kz.notSuitable}, стало ${foreign.notSuitable}`,
  );
  assert.ok(foreign.recommended < kz.recommended);
});

/* ------------------------------------------------------------------ */
/* Год поступления                                                     */
/* ------------------------------------------------------------------ */

test('Год без кампаний: пусто везде, кроме исключённых, и названы доступные годы', () => {
  const r = session({ ...BASE, admissionYear: known(2029) }).recommendation;

  assert.equal(r.recommended.length, 0);
  assert.equal(r.alternatives.length, 0);
  assert.equal(r.needsVerification.length, 0);
  assert.ok(r.notSuitable.length > 0, 'варианты не исчезают — они исключены с причиной');

  assert.equal(r.requestedYear, 2029);
  assert.ok(r.shortfallReason);
  assert.ok(r.availableYears.length > 0);
  assert.ok(!r.availableYears.includes(2029));
});

test('Маршрут к прошлогоднему набору не строится', () => {
  const s = session({ ...BASE, admissionYear: known(2029) });

  assert.equal(s.activeGoal, null, 'подставлять чужой год вместо выбранного нельзя');
  assert.equal(s.route, null);
});

/* ------------------------------------------------------------------ */
/* Экзамен сдан                                                        */
/* ------------------------------------------------------------------ */

/** ЕНТ сдан: балл выше порогов, результат действителен на контрольную дату. */
const ENT_PASSED: Profile = {
  ...BASE,
  exams: BASE.exams.map((e) =>
    e.examKind !== 'ЕНТ'
      ? e
      : {
          ...e,
          state: 'result_reported' as const,
          overall: 125,
          takenOn: addDays(TODAY, -30),
          resultOn: addDays(TODAY, -20),
          validUntil: '2029-12-31',
          components: [
            { component: 'history_kz', score: 18 },
            { component: 'math_literacy', score: 9 },
            { component: 'reading_literacy', score: 9 },
            { component: 'profile_1', score: 45 },
            { component: 'profile_2', score: 44 },
          ],
        },
  ),
};

test('Сданный экзамен убирает из плана подготовку, регистрацию, сдачу и ожидание', () => {
  const before = session().route?.tasks.map((t) => t.semanticKey) ?? [];
  const after = session(ENT_PASSED).route?.tasks.map((t) => t.semanticKey) ?? [];

  assert.ok(before.includes('ent:result'), 'до сдачи ожидание результата в плане есть');
  assert.deepEqual(
    after.filter((k) => k.startsWith('ent:')),
    [],
    'после сдачи ни одно действие по ЕНТ в плане остаться не должно',
  );
  assert.ok(after.includes('application:submit'), 'подача заявления никуда не девается');
});

test('AC-06: результат, истекающий до контрольной даты, не считается выполненным условием', () => {
  // Тот же сданный экзамен, но срок действия кончается слишком рано.
  const expiring: Profile = {
    ...ENT_PASSED,
    exams: ENT_PASSED.exams.map((e) =>
      e.examKind === 'ЕНТ' ? { ...e, validUntil: addDays(TODAY, 5) } : e,
    ),
  };

  const tasks = session(expiring).route?.tasks.map((t) => t.semanticKey) ?? [];

  assert.ok(
    tasks.some((k) => k.startsWith('ent:')),
    'если результат истекает раньше контрольной даты, экзамен придётся пересдать',
  );
});

/* ------------------------------------------------------------------ */
/* Воспроизводимость                                                   */
/* ------------------------------------------------------------------ */

test('Повторный расчёт на тех же данных даёт тот же ключ и ту же выдачу', () => {
  const a = session();
  const b = session();

  assert.equal(a.key.inputHash, b.key.inputHash);
  assert.deepEqual(
    a.recommendation.assessments.map((x) => x.admissionPathId),
    b.recommendation.assessments.map((x) => x.admissionPathId),
  );
  assert.deepEqual(
    a.route?.tasks.map((t) => t.semanticKey),
    b.route?.tasks.map((t) => t.semanticKey),
  );
});
