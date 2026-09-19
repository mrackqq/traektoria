/**
 * ST-04…ST-13 — прогон стресс-теста маршрута целиком.
 *
 * Это единственное место, где overlay, планировщик и diff работают вместе,
 * поэтому здесь проверяется не арифметика, а обещания фичи: симуляция ничего
 * не сохраняет, противоречивые параметры ловятся до расчёта, а изменения
 * объясняются причинно, а не просто перечисляются.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEMO_SCENARIOS,
  findDemoScenario,
  overridesFrom,
  runScenario,
} from './scenario.ts';
import { buildDemoProfile } from './profile.ts';
import { buildSession, DEMO_CLOCK } from './session.ts';
import { applyOverlay, type ScenarioEvent } from '../scenarios/overlay.ts';
import { money } from '../kernel/money.ts';

const SESSION = buildSession({ profile: buildDemoProfile(DEMO_CLOCK.now), clock: DEMO_CLOCK });

const budgetCut: ScenarioEvent = {
  id: 'cut',
  type: 'budget_changed',
  effectiveDate: '2027-03-01',
  budget: {
    limit: money(120_000_000n, 'KZT'),
    scope: 'total',
    period: 'academic_year',
    availability: [],
  },
  explanation: 'бюджет сокращён',
};

/* ------------------------------------------------------------------ */
/* Перевод событий в сдвиги действий                                   */
/* ------------------------------------------------------------------ */

test('Задержка результата превращается в сдвиг соответствующего действия', () => {
  const overlay = applyOverlay(SESSION.profile, [
    {
      id: 'd',
      type: 'certificate_delayed',
      effectiveDate: '2027-03-01',
      examKind: 'IELTS',
      newResultDate: '2027-06-01',
      explanation: '',
    },
  ]);

  const overrides = overridesFrom(overlay);
  assert.equal(overrides.get('ielts:result')?.resultAvailableFrom, '2027-06-01');
});

test('Пропуск задачи сохраняет уже выполненную часть', () => {
  // ST-05: сделанная подготовка не должна обнуляться перестройкой графика.
  const overlay = applyOverlay(SESSION.profile, [
    {
      id: 's',
      type: 'task_skipped',
      effectiveDate: '2027-03-01',
      taskSemanticKey: 'ielts:prepare',
      completedFraction: 0.6,
      newAvailabilityDate: '2027-05-01',
      explanation: '',
    },
  ]);

  const overrides = overridesFrom(overlay);
  assert.deepEqual(overrides.get('ielts:prepare'), {
    availableFrom: '2027-05-01',
    completedFraction: 0.6,
  });
});

test('Задержка и пропуск одного экзамена складываются, а не вытесняют друг друга', () => {
  const overlay = applyOverlay(SESSION.profile, [
    {
      id: 's',
      type: 'task_skipped',
      effectiveDate: '2027-03-01',
      taskSemanticKey: 'ielts:result',
      completedFraction: 0.3,
      newAvailabilityDate: '2027-04-01',
      explanation: '',
    },
    {
      id: 'd',
      type: 'certificate_delayed',
      effectiveDate: '2027-03-01',
      examKind: 'IELTS',
      newResultDate: '2027-06-01',
      explanation: '',
    },
  ]);

  const merged = overridesFrom(overlay).get('ielts:result');
  assert.equal(merged?.completedFraction, 0.3, 'сведения о пропуске обязаны сохраниться');
  assert.equal(merged?.resultAvailableFrom, '2027-06-01', 'как и сведения о задержке');
});

/* ------------------------------------------------------------------ */
/* ST-02: противоречия ловятся до расчёта                              */
/* ------------------------------------------------------------------ */

test('ST-02: при противоречивых параметрах расчёт не запускается', () => {
  const run = runScenario(SESSION, 'противоречие', [
    budgetCut,
    { ...budgetCut, id: 'cut-2', budget: { ...budgetCut.budget, limit: money(1n, 'KZT') } },
  ]);

  assert.ok(run.conflicts.length > 0, 'противоречие обязано быть названо');
  assert.equal(run.scenario, null, 'считать сценарий с неоднозначными входными данными нельзя');
  assert.equal(run.diff, null);
});

test('ST-03: прогон сценария не меняет исходный снимок', () => {
  const before = JSON.stringify(SESSION.profile, (_k, v) => (typeof v === 'bigint' ? String(v) : v));

  runScenario(SESSION, 'проверка', [budgetCut]);

  const after = JSON.stringify(SESSION.profile, (_k, v) => (typeof v === 'bigint' ? String(v) : v));
  assert.equal(after, before, 'симуляция обязана оставить факты нетронутыми');
});

/* ------------------------------------------------------------------ */
/* Полный прогон                                                       */
/* ------------------------------------------------------------------ */

test('Сокращение бюджета даёт сравнимые маршруты «было» и «станет»', () => {
  const run = runScenario(SESSION, 'бюджет вдвое', [budgetCut]);

  assert.deepEqual(run.conflicts, []);
  assert.ok(run.overlay, 'overlay обязан быть построен');
  assert.ok(run.baseline, 'исходный маршрут нужен для сравнения');
  assert.ok(run.scenario, 'сценарный маршрут обязан посчитаться');
  assert.ok(run.diff, 'без diff сравнивать нечего');
});

test('ST-04: изменения объясняются причинно, а не просто перечисляются', () => {
  const run = runScenario(SESSION, 'бюджет вдвое', [budgetCut]);

  assert.ok(run.diff);
  assert.ok(
    run.diff.causeChains.length > 0,
    'каждое событие обязано получить цепочку «что из чего следует»',
  );

  for (const chain of run.diff.causeChains) {
    assert.ok(chain.constraint.length > 0, 'ограничение обязано быть названо');
    assert.ok(chain.effect.length > 0, 'следствие обязано быть названо');
    assert.ok(chain.eventLabel.length > 0, 'по цепочке должно быть видно, из какого она события');
  }
});

test('ST-05: сохранённое и утраченное перечисляются раздельно', () => {
  const run = runScenario(SESSION, 'бюджет вдвое', [budgetCut]);

  assert.ok(run.diff);
  assert.ok(Array.isArray(run.diff.preservedResults), 'что перенеслось — отдельный список');
  assert.ok(Array.isArray(run.diff.lostApplicability), 'что перестало годиться — тоже');
  assert.equal(
    run.diff.preservedResults.some((r) => run.diff!.lostApplicability.includes(r)),
    false,
    'один и тот же результат не может быть одновременно сохранён и утрачен',
  );
});

test('ST-13: статус выполнимости сравнивается «было → станет»', () => {
  const run = runScenario(SESSION, 'бюджет вдвое', [budgetCut]);

  assert.ok(run.diff);
  assert.ok(run.diff.goalStatusBefore, 'исходный статус обязан быть назван');
  assert.ok(run.diff.goalStatusAfter, 'сценарный статус тоже');
  assert.equal(
    run.diff.statusChanged,
    run.diff.goalStatusBefore !== run.diff.goalStatusAfter,
    'признак изменения обязан соответствовать самим статусам',
  );
});

test('BR-11: альтернативы берутся только из посчитанных планировщиком', () => {
  const run = runScenario(SESSION, 'бюджет вдвое', [budgetCut]);

  assert.ok(run.diff);
  assert.ok(
    run.diff.confirmedAlternatives.length <= Math.max(0, (run.scenario?.routes.length ?? 1) - 1),
    'выдумывать альтернативы нельзя — их ровно столько, сколько построил планировщик',
  );
});

test('Сценарий без активной цели не считается, но и не падает', () => {
  const empty = buildSession({
    profile: { ...buildDemoProfile(DEMO_CLOCK.now), interests: [], targetCountries: [] },
    clock: DEMO_CLOCK,
    activePathId: 'нет-такой-цели',
  });

  const run = runScenario({ ...empty, activeGoal: null }, 'без цели', [budgetCut]);

  assert.equal(run.goal, null);
  assert.equal(run.scenario, null);
  assert.equal(run.diff, null);
});

test('Пустой список событий даёт прогон без изменений', () => {
  const run = runScenario(SESSION, 'ничего не меняем', []);

  assert.deepEqual(run.conflicts, []);
  if (run.diff) {
    assert.equal(run.diff.causeChains.length, 0, 'без событий объяснять нечего');
  }
});

/* ------------------------------------------------------------------ */
/* Готовые демонстрационные сценарии                                   */
/* ------------------------------------------------------------------ */

test('Каждый готовый сценарий строится и считается на демо-профиле', () => {
  for (const demo of DEMO_SCENARIOS) {
    const events = demo.build(SESSION);
    const run = runScenario(SESSION, demo.title, events);

    assert.deepEqual(
      run.conflicts,
      [],
      `сценарий «${demo.id}» не должен содержать противоречий в собственных параметрах`,
    );
    assert.ok(demo.question.length > 0, `у сценария «${demo.id}» должен быть вопрос пользователю`);
    assert.equal(typeof run.title, 'string');
  }
});

test('Идентификаторы готовых сценариев уникальны', () => {
  const ids = DEMO_SCENARIOS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('Неизвестный идентификатор откатывается на первый сценарий', () => {
  assert.equal(findDemoScenario('нет-такого').id, DEMO_SCENARIOS[0]!.id);
  assert.equal(findDemoScenario(undefined).id, DEMO_SCENARIOS[0]!.id);
  assert.equal(findDemoScenario('').id, DEMO_SCENARIOS[0]!.id);
});

test('Известный идентификатор находит именно свой сценарий', () => {
  for (const demo of DEMO_SCENARIOS) {
    assert.equal(findDemoScenario(demo.id).id, demo.id);
  }
});
