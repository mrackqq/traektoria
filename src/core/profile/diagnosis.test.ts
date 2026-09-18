/**
 * Диагностика и сводка «что изменилось» — без модели.
 *
 * Краткая сводка обязана быть доступна при отсутствии ключа, таймауте и любой
 * ошибке OpenRouter: она считается правилами. Раньше она жила только внутри
 * AI-компонента и исчезала вместе с ним.
 *
 * Запуск: npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { fromMajor } from '../kernel/money.ts';
import { known } from '../kernel/profile.ts';
import { buildDemoProfile, buildEmptyProfile } from '../demo/profile.ts';
import { buildSession, DEMO_CLOCK } from '../demo/session.ts';
import { diffAnswers, summarizeRecalc } from './changes.ts';
import { draftFromProfile } from './questionnaire.ts';

const AT = DEMO_CLOCK.now;

test('Диагностика считается правилами и не требует модели', () => {
  const s = buildSession({ profile: buildDemoProfile(AT, 'user-diag'), clock: DEMO_CLOCK });
  const d = s.diagnosis;

  // Ни одно поле диагностики не приходит из сети: это чистый расчёт.
  assert.ok(d.goalSummary.length > 0, 'образовательная цель сформулирована');
  assert.ok(d.strengths.length > 0, 'есть сильные стороны');
  assert.ok(d.priorities.length > 0, 'есть приоритет подготовки');
  assert.ok(d.gaps.length > 0, 'перечислены незакрытые условия');

  assert.match(d.goalSummary, /11 класс/);
  assert.match(d.goalSummary, /Информатика/);
});

test('Пустая анкета: диагностика называет недостающие ответы, а не молчит', () => {
  const s = buildSession({ profile: buildEmptyProfile(AT, 'user-empty'), clock: DEMO_CLOCK });
  const d = s.diagnosis;

  assert.ok(d.goalSummary.length > 0);
  assert.ok(d.missingAnswers.length >= 4, 'перечислено, чего не хватает');
  assert.ok(
    d.missingAnswers.some((m) => m.id === 'admissionYear'),
    'год поступления назван среди недостающего',
  );
  assert.ok(
    d.missingAnswers.some((m) => m.id === 'applicantCategory'),
    'категория заявителя названа среди недостающего',
  );
});

test('Сводка «что изменилось» строится из двух расчётов и не выдумывает сравнений', () => {
  const before = buildDemoProfile(AT, 'user-change');
  const budget = before.budget.state === 'known' ? before.budget.value : null;
  assert.ok(budget);

  const after = {
    ...before,
    id: 'user-change-r2',
    revision: before.revision + 1,
    budget: known({ ...budget, limit: fromMajor(1_200_000, 'KZT') }),
  };

  const sessionBefore = buildSession({ profile: before, clock: DEMO_CLOCK });
  const sessionAfter = buildSession({ profile: after, clock: DEMO_CLOCK });

  const changes = diffAnswers(
    draftFromProfile(before, AT).values,
    draftFromProfile(after, AT).values,
    ['budgetLimit'],
  );

  const summary = summarizeRecalc({
    at: AT,
    before: sessionBefore,
    after: sessionAfter,
    changes,
  });

  assert.equal(summary.profileRevisionBefore, before.revision);
  assert.equal(summary.profileRevisionAfter, after.revision);

  assert.equal(summary.changes.length, 1);
  assert.equal(summary.changes[0]!.fieldId, 'budgetLimit');
  assert.match(summary.changes[0]!.before, /3000000|3 000 000/);
  assert.match(summary.changes[0]!.after, /1200000|1 200 000/);

  // Сокращение бюджета обязано уменьшить число подходящих вариантов.
  assert.ok(summary.fitAfter < summary.fitBefore, 'изменение видно в рекомендациях');
  assert.ok(summary.notes.length > 0, 'изменение проговаривается словами');
  assert.ok(
    summary.notes.some((n) => /меньше/i.test(n)),
    'сказано, что подходящих стало меньше',
  );
});

test('Без изменений сводка честно говорит, что ничего не поменялось', () => {
  const profile = buildDemoProfile(AT, 'user-same');
  const s = buildSession({ profile, clock: DEMO_CLOCK });

  const summary = summarizeRecalc({ at: AT, before: s, after: s, changes: [] });

  assert.deepEqual(summary.changes, []);
  assert.equal(summary.fitBefore, summary.fitAfter);
  assert.equal(summary.tasksBefore, summary.tasksAfter);
  assert.ok(
    summary.notes.some((n) => /не изменились/i.test(n)),
    'вместо выдуманной разницы — прямая формулировка',
  );
});

test('Сводка привязана к ревизии профиля, на которой посчитана', () => {
  const before = buildDemoProfile(AT, 'user-rev');
  const after = { ...before, id: 'user-rev-r2', revision: before.revision + 1 };

  const summary = summarizeRecalc({
    at: AT,
    before: buildSession({ profile: before, clock: DEMO_CLOCK }),
    after: buildSession({ profile: after, clock: DEMO_CLOCK }),
    changes: [],
  });

  // Интерфейс показывает блок только при совпадении с текущей ревизией,
  // поэтому это поле обязано быть точным.
  assert.equal(summary.profileRevisionAfter, after.revision);
  assert.notEqual(summary.profileRevisionAfter, before.revision);
});
