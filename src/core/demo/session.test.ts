/**
 * Что именно показывает расчёт до и без выбора цели.
 *
 * Здесь закрыты две проверенные ошибки:
 *  • пустая анкета давала активную программу и готовый маршрут, хотя ответов
 *    не было вовсе — персональный результат без персональных данных;
 *  • профиль с годом, на который кампаний нет, получал 0 рекомендаций, но
 *    маршрут всё равно строился к исключённой кампании прошлого набора.
 *
 * Данные синтетические, часы фиксированные, хранилище не используется.
 *
 * Запуск: npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { known } from '../kernel/profile.ts';
import { buildDemoProfile, buildEmptyProfile } from './profile.ts';
import { buildSession, DEMO_CLOCK } from './session.ts';

const AT = DEMO_CLOCK.now;

test('Пустой профиль не получает персональной цели и готового маршрута', () => {
  const s = buildSession({ profile: buildEmptyProfile(AT, 'user-new'), clock: DEMO_CLOCK });

  assert.equal(s.profileStarted, false, 'анкета не начата');
  assert.equal(s.activeGoalSource, 'none', 'автоматическая цель не выбирается');
  assert.equal(s.activeGoal, null, 'активной цели нет');
  assert.equal(s.route, null, 'маршрута нет');
  assert.equal(s.taskViews.length, 0, 'задач нет');

  // Диагностика при этом уже отвечает, чего не хватает.
  assert.ok(s.diagnosis.missingAnswers.length > 0, 'названы недостающие ответы');
});

test('Год без кампаний не подменяется прошлым набором', () => {
  const base = buildDemoProfile(AT, 'user-year');
  const s = buildSession({
    profile: { ...base, admissionYear: known(2029) },
    clock: DEMO_CLOCK,
  });

  assert.equal(s.recommendation.recommended.length, 0, 'подходящих нет');
  assert.equal(s.recommendation.alternatives.length, 0, 'альтернатив тоже нет');
  assert.equal(s.recommendation.requestedYearAvailable, false);
  assert.equal(s.activeGoal, null, 'маршрут к чужому году не строится');
  assert.equal(s.route, null);

  // Причина названа, и в ней перечислены годы, на которые данные есть.
  assert.ok(s.recommendation.shortfallReason);
  assert.match(s.recommendation.shortfallReason!, /2029/);
  assert.match(s.recommendation.shortfallReason!, /нет опубликованных кампаний/i);

  // Исключённые кампании остаются видимыми — с причиной, но не как цель.
  assert.ok(s.recommendation.notSuitable.length > 0);
  assert.ok(
    s.recommendation.notSuitable.every((a) => a.access.code === 'YEAR_MISMATCH'),
    'все исключены именно по году',
  );
});

test('Исключённый вариант никогда не становится автоматической целью', () => {
  const base = buildDemoProfile(AT, 'user-auto');
  const s = buildSession({
    profile: { ...base, admissionYear: known(2029) },
    clock: DEMO_CLOCK,
  });

  assert.equal(s.goals.length > 0, true, 'варианты в каталоге есть');
  assert.ok(
    s.goals.every((g) => g.assessment.bucket === 'not_suitable'),
    'все рассмотренные варианты исключены',
  );
  assert.equal(s.activeGoal, null, 'но целью ни один не выбран');
});

test('Подходящий профиль получает автоматическую цель и маршрут', () => {
  const s = buildSession({ profile: buildDemoProfile(AT, 'user-ok'), clock: DEMO_CLOCK });

  assert.equal(s.profileStarted, true);
  assert.equal(s.activeGoalSource, 'auto');
  assert.ok(s.activeGoal, 'цель выбрана');
  assert.notEqual(s.activeGoal!.assessment.bucket, 'not_suitable');
  assert.ok((s.route?.tasks.length ?? 0) > 0, 'маршрут построен');
  assert.ok(s.recommendation.recommended.length >= 3, 'минимум три подходящих варианта');
});

test('Сохранённая цель, переставшая подходить, остаётся выбранной с объяснением', () => {
  const base = buildDemoProfile(AT, 'user-goal');
  const first = buildSession({ profile: base, clock: DEMO_CLOCK });
  const goalId = first.activeGoal!.path.id;

  // Меняем ключевой ответ так, чтобы прежняя цель перестала проходить.
  const narrowed = buildSession({
    profile: { ...base, admissionYear: known(2029) },
    clock: DEMO_CLOCK,
    activePathId: goalId,
  });

  assert.equal(narrowed.activeGoal?.path.id, goalId, 'цель не подменена другой');
  assert.equal(narrowed.activeGoalSource, 'chosen');
  assert.ok(narrowed.activeGoalIssue, 'причина названа');
  assert.equal(narrowed.activeGoalIssue!.code, 'BLOCKED');
  assert.match(narrowed.activeGoalIssue!.message, /не подходит/i);
});

test('Рекомендуемые активности не блокируют подачу и не считаются требованием', () => {
  const s = buildSession({ profile: buildDemoProfile(AT, 'user-act'), clock: DEMO_CLOCK });
  const tasks = s.route?.tasks ?? [];

  const advisory = tasks.filter((t) => t.template.advisory);
  assert.ok(advisory.length > 0, 'для IT-направления предложены активности');

  for (const task of advisory) {
    assert.deepEqual(task.closesLeafIds, [], 'активность не закрывает условий приёма');
  }

  const submit = tasks.find((t) => t.semanticKey === 'application:submit');
  assert.ok(submit);
  for (const task of advisory) {
    assert.ok(
      !submit!.dependsOn.includes(task.id),
      'подача заявления не ждёт рекомендуемую активность',
    );
  }
});
