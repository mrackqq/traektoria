/**
 * Подбор программ — верхний вход всего продукта.
 *
 * `recommend` отвечает на главный вопрос экрана «что мне подходит», поэтому
 * здесь проверяется не арифметика оценок, а обещания: ничего не выдумывается
 * (год, категория, стоимость), нехватка вариантов объясняется причиной,
 * а неизвестное не прячется за прочерк.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildComparison,
  checkPathAccess,
  computePreference,
  recommend,
  totalMandatoryCost,
  DEMO_FX_RATES,
  type RecommendationInput,
} from './recommend.ts';
import { buildSeedCatalog } from '../catalog/seed.ts';
import { buildDemoProfile, buildEmptyProfile } from '../demo/profile.ts';
import { DEMO_CLOCK } from '../demo/session.ts';
import { known, notApplicable, unanswered } from '../kernel/profile.ts';
import { money } from '../kernel/money.ts';

const CATALOG = buildSeedCatalog(DEMO_CLOCK.now);
const PROFILE = buildDemoProfile(DEMO_CLOCK.now);

const input = (over: Partial<RecommendationInput> = {}): RecommendationInput => ({
  profile: PROFILE,
  catalog: CATALOG,
  clock: DEMO_CLOCK,
  fxRates: DEMO_FX_RATES,
  ...over,
});

const firstIntake = CATALOG.intakes[0]!;
const firstPath = CATALOG.paths.find((p) => p.intakeId === firstIntake.id)!;

/* ------------------------------------------------------------------ */
/* Доступ к пути подачи                                                */
/* ------------------------------------------------------------------ */

test('Чужой год набора закрывает путь и называет оба года', () => {
  const profile = { ...PROFILE, admissionYear: known(firstIntake.admissionYear + 5) };
  const access = checkPathAccess(profile, firstIntake, firstPath);

  assert.equal(access.status, 'blocked');
  assert.match(access.message!, new RegExp(String(firstIntake.admissionYear)));
  assert.match(access.message!, new RegExp(String(firstIntake.admissionYear + 5)));
});

test('Неуказанный год не закрывает путь, а просит ответ', () => {
  const profile = { ...PROFILE, admissionYear: unanswered<number>() };
  const restricted = { ...firstPath, applicantCategories: [] };

  const access = checkPathAccess(profile, firstIntake, restricted);
  assert.equal(access.status, 'needs_input');
  assert.equal(access.code, 'YEAR_UNKNOWN');
});

test('Категория проверяется раньше неизвестного года', () => {
  // Порядок ворот — бизнес-правило: при неизвестном годе И неподходящей
  // категории пользователь должен узнать про категорию, а не про год.
  const profile = {
    ...PROFILE,
    admissionYear: unanswered<number>(),
    applicantCategory: known('foreign' as const),
  };
  const kzOnly = { ...firstPath, applicantCategories: ['kz_citizen' as const] };

  const access = checkPathAccess(profile, firstIntake, kzOnly);
  assert.equal(access.status, 'blocked');
  assert.equal(access.code, 'CATEGORY_NOT_ALLOWED');
});

test('Неизвестная категория на ограниченном пути — просьба ответить, а не отказ', () => {
  const profile = { ...PROFILE, applicantCategory: unanswered<'kz_citizen' | 'foreign'>() };
  const kzOnly = { ...firstPath, applicantCategories: ['kz_citizen' as const] };

  const access = checkPathAccess(profile, firstIntake, kzOnly);
  assert.equal(access.status, 'needs_input');
  assert.equal(access.code, 'CATEGORY_UNKNOWN');
});

test('Путь без ограничений по категории открыт при любой категории', () => {
  const profile = {
    ...PROFILE,
    admissionYear: known(firstIntake.admissionYear),
    applicantCategory: known('foreign' as const),
  };
  const open = { ...firstPath, applicantCategories: [] };

  assert.equal(checkPathAccess(profile, firstIntake, open).status, 'allowed');
});

/* ------------------------------------------------------------------ */
/* Предпочтения                                                        */
/* ------------------------------------------------------------------ */

test('Пустой фильтр означает «подходит любое», а не «не подходит ничто»', () => {
  // Правило легко инвертировать при правке, а цена ошибки велика: пустая
  // анкета перестала бы показывать что-либо вообще.
  const blank = { ...PROFILE, interests: [], targetCountries: [], instructionLanguages: [] };
  const pref = computePreference(input({ profile: blank }), firstIntake, firstPath);

  assert.equal(pref.interestMatched, true);
  assert.equal(pref.countryMatched, true);
  assert.equal(pref.languageMatched, true);
});

test('Несовпадающий интерес отмечается как выход за фильтры', () => {
  const narrow = { ...PROFILE, interests: ['medicine' as const] };
  const pref = computePreference(input({ profile: narrow }), firstIntake, firstPath);

  if (!pref.interestMatched) {
    assert.ok(pref.outsideFilters.length > 0, 'несовпадение обязано быть названо пользователю');
  }
});

test('Оценка предпочтения лежит в пределах 0…1', () => {
  for (const path of CATALOG.paths.slice(0, 10)) {
    const intake = CATALOG.intakes.find((i) => i.id === path.intakeId)!;
    const pref = computePreference(input(), intake, path);

    assert.ok(pref.score >= 0 && pref.score <= 1, `оценка вне диапазона: ${pref.score}`);
  }
});

test('Путь на грант считается финансируемым независимо от списка опций', () => {
  const grant = CATALOG.paths.find((p) => p.kind === 'grant');
  if (!grant) return;

  const intake = CATALOG.intakes.find((i) => i.id === grant.intakeId)!;
  const pref = computePreference(input(), intake, { ...grant, funding: [] });

  assert.equal(pref.fundingAvailable, true, 'сам грант и есть финансирование');
});

/* ------------------------------------------------------------------ */
/* Подбор целиком                                                      */
/* ------------------------------------------------------------------ */

test('Каждый рассмотренный путь попадает ровно в одну группу', () => {
  const r = recommend(input());
  const grouped =
    r.recommended.length + r.alternatives.length + r.needsVerification.length + r.notSuitable.length;

  assert.equal(grouped, r.assessments.length, 'вариант не может потеряться или попасть в две группы');
  assert.equal(r.consideredPathCount, r.assessments.length);
});

test('Подбор воспроизводим: два прогона на одних данных совпадают', () => {
  const a = recommend(input()).assessments.map((x) => x.admissionPathId);
  const b = recommend(input()).assessments.map((x) => x.admissionPathId);

  assert.deepEqual(a, b, 'порядок обязан быть детерминированным');
});

test('Исключённый вариант всегда объясняет причину', () => {
  const r = recommend(input());

  for (const a of r.notSuitable) {
    assert.ok(
      a.exclusionReason && a.exclusionReason.length > 0,
      `вариант ${a.admissionPathId} исключён молча`,
    );
  }
});

test('Год без кампаний: подходящих нет, названа причина и доступные годы', () => {
  const r = recommend(input({ profile: { ...PROFILE, admissionYear: known(2099) } }));

  assert.equal(r.recommended.length, 0);
  assert.equal(r.requestedYear, 2099);
  assert.ok(r.shortfallReason, 'нехватка вариантов обязана быть объяснена');
  assert.ok(r.availableYears.length > 0, 'годы, на которые данные есть, обязаны быть названы');
  assert.ok(
    !r.availableYears.includes(2099),
    'год без данных не может оказаться в списке доступных',
  );
});

test('Прошлогодний набор не подставляется вместо запрошенного года', () => {
  const r = recommend(input({ profile: { ...PROFILE, admissionYear: known(2099) } }));

  for (const a of r.recommended) {
    const intake = CATALOG.intakes.find((i) => i.id === a.intakeId)!;
    assert.equal(intake.admissionYear, 2099, 'показывать чужой год вместо выбранного нельзя');
  }
});

test('Пустая анкета не выдаёт отказ и не выдумывает цель', () => {
  const r = recommend(input({ profile: buildEmptyProfile(DEMO_CLOCK.now, 'owner-x') }));

  assert.ok(r.assessments.length > 0, 'варианты каталога всё равно оцениваются');
  assert.equal(typeof r.shortfallReason, r.recommended.length < 3 ? 'string' : 'object');
});

test('Категория «иностранный заявитель» уводит пути «только для граждан РК» в исключённые', () => {
  const foreign = { ...PROFILE, applicantCategory: known('foreign' as const) };
  const r = recommend(input({ profile: foreign }));

  const kzOnlyIds = CATALOG.paths
    .filter((p) => p.applicantCategories.length > 0 && !p.applicantCategories.includes('foreign'))
    .map((p) => p.id);

  for (const id of kzOnlyIds) {
    const a = r.assessments.find((x) => x.admissionPathId === id);
    if (!a) continue;
    assert.equal(a.bucket, 'not_suitable', `путь ${id} закрыт для категории, но не исключён`);
  }
});

test('Сокращение бюджета уменьшает число подходящих', () => {
  const rich = recommend(input()).recommended.length;
  const poor = recommend(
    input({
      profile: {
        ...PROFILE,
        budget: known({
          limit: money(10_000n, 'KZT'),
          scope: 'total' as const,
          period: 'academic_year' as const,
          availability: [],
        }),
      },
    }),
  ).recommended.length;

  assert.ok(poor <= rich, `урезание бюджета не может расширить подбор: было ${rich}, стало ${poor}`);
});

test('Нехватка вариантов объясняется, а изобилие — нет', () => {
  const r = recommend(input());

  if (r.recommended.length < 3) assert.ok(r.shortfallReason, 'меньше трёх — нужна причина');
  else assert.equal(r.shortfallReason, null, 'объяснять нечего, когда вариантов достаточно');
});

/* ------------------------------------------------------------------ */
/* Сравнение                                                           */
/* ------------------------------------------------------------------ */

/** Собрать элемент сравнения так, как это делает страница. */
function comparisonItem(assessment: (typeof COMPARABLE)[number]) {
  const intake = CATALOG.intakes.find((i) => i.id === assessment.intakeId)!;
  const path = CATALOG.paths.find((p) => p.id === assessment.admissionPathId)!;
  const program = CATALOG.programs.find((p) => p.id === assessment.programId)!;
  const university = CATALOG.universities.find((u) => u.id === program.universityId)!;

  return {
    assessment,
    intake,
    path,
    programTitle: program.title,
    universityShortName: university.shortName,
    city: university.city,
    instructionLanguages: program.instructionLanguages,
    durationYears: program.durationYears,
  };
}

const COMPARABLE = recommend(input()).assessments;

test('Сравнение строится по отмеченным вариантам и не прячет неизвестное', () => {
  const items = COMPARABLE.slice(0, 2).map(comparisonItem);
  assert.equal(items.length, 2, 'для сравнения нужны хотя бы два варианта');

  const rows = buildComparison(items, 'KZT', DEMO_FX_RATES);

  assert.ok(rows.length > 0, 'таблица сравнения не может быть пустой');
  for (const row of rows) {
    assert.equal(
      row.values.length,
      items.length,
      `строка «${row.label}» обязана иметь значение для каждой программы`,
    );

    for (const cell of row.values) {
      assert.ok(cell.text.length > 0, `пустая ячейка в строке «${row.label}»`);
      if (cell.unknown) {
        assert.notEqual(
          cell.text.trim(),
          '—',
          'неизвестное обязано объяснять себя, а не прятаться за прочерк',
        );
      }
    }
  }
});

test('Порядок строк сравнения не зависит от набора программ', () => {
  const two = buildComparison(COMPARABLE.slice(0, 2).map(comparisonItem)).map((r) => r.key);
  const three = buildComparison(COMPARABLE.slice(0, 3).map(comparisonItem)).map((r) => r.key);

  assert.deepEqual(two, three, 'сравнивать нужно по одним и тем же признакам');
});

/* ------------------------------------------------------------------ */
/* Стоимость                                                           */
/* ------------------------------------------------------------------ */

test('Итог обязательных расходов помечается неполным, когда сумма не сходится', () => {
  const withEstimate = {
    ...firstPath,
    costs: firstPath.costs.map((c, i) => (i === 0 ? { ...c, isEstimate: true, mandatory: true } : c)),
  };

  const total = totalMandatoryCost(withEstimate, 'KZT', DEMO_FX_RATES);
  if (withEstimate.costs.some((c) => c.mandatory)) {
    assert.equal(total.incomplete, true, 'оценочная сумма не выдаётся за подтверждённую');
  }
});

test('Отсутствие курса делает итог неполным, а не нулевым', () => {
  const total = totalMandatoryCost(firstPath, 'USD', []);

  if (firstPath.costs.some((c) => c.mandatory)) {
    assert.equal(total.incomplete, true, 'без курса итог неизвестен — это не ноль');
  }
});

test('Путь без обязательных расходов даёт полный нулевой итог', () => {
  const free = { ...firstPath, costs: [] };
  const total = totalMandatoryCost(free, 'KZT', DEMO_FX_RATES);

  assert.equal(total.incomplete, false, 'пустой список — это известный факт, а не пробел в данных');
});
