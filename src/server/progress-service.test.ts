/**
 * Проверки прикладного слоя: сохранение между запросами, конфликты ревизий
 * (PF-06, AC-32), идемпотентность (API-04) и сквозной путь «результат →
 * факт профиля → пересчёт условия» (TASK-02, TASK-03, TASK-06).
 *
 * Хранилище — файловое, во временном каталоге: проверяется реальная запись,
 * а не подменённый объект в памяти.
 *
 * Запуск: npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dataDir = await mkdtemp(path.join(tmpdir(), 'trajectory-test-'));
process.env.TRAJECTORY_DATA_DIR = dataDir;

// Каталог данных читается модулем при загрузке, поэтому импорт динамический.
const service = await import('./progress-service.ts');
const { getStore } = await import('./file-store.ts');

const OWNER = 'demo-user';
const AT = '2026-09-18T09:00:00Z';

test.after(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

/**
 * Первое действие маршрута активной цели.
 *
 * Берём любое действие со статусом «к выполнению», а не конкретно подготовку:
 * у демо-профиля ЕНТ уже сдан и ждёт результата, поэтому подготовки в плане
 * справедливо нет — план не назначает заново то, что уже сделано.
 */
async function firstTask() {
  const session = await service.loadSession(OWNER);
  const goalId = session.activeGoal?.path.id;
  assert.ok(goalId, 'в демо-каталоге должна быть активная цель');
  // Детерминированный выбор по идентификатору: три теста подряд работают
  // с одним и тем же действием, а не с тем, что случайно осталось в `todo`.
  const view = [...session.taskViews].sort((a, b) => a.task.id.localeCompare(b.task.id))[0];
  assert.ok(view, 'в маршруте должно быть хотя бы одно действие');
  return { goalId, taskId: view.task.id, session };
}

test('Команда сохраняется между запросами и поднимает ревизию прогресса', async () => {
  const { goalId, taskId, session } = await firstTask();
  assert.equal(session.progress.revision, 1);

  const result = await service.changeTaskStatus({
    ownerId: OWNER,
    goalId,
    taskId,
    to: 'in_progress',
    basis: 'тест',
    idempotencyKey: 'k-start',
    expectedProgressRevision: 1,
    at: AT,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.progressRevision, 2);

  // Новый запрос читает состояние с диска, а не из памяти вызова.
  const reloaded = await service.loadSession(OWNER);
  const task = reloaded.progress.tasks.find((t) => t.taskId === taskId);
  assert.equal(task?.status, 'in_progress');
  assert.equal(reloaded.progress.revision, 2);
});

test('API-04: повтор той же команды не применяет её второй раз', async () => {
  const { goalId, taskId } = await firstTask();

  const again = await service.changeTaskStatus({
    ownerId: OWNER,
    goalId,
    taskId,
    to: 'in_progress',
    basis: 'тест',
    idempotencyKey: 'k-start',
    expectedProgressRevision: 1,
    at: AT,
  });

  assert.equal(again.ok, true);
  if (!again.ok) return;
  assert.equal(again.kind, 'replayed');

  const state = await getStore().read(OWNER);
  assert.equal(state.ledger.filter((o) => o.idempotencyKey === 'k-start').length, 1);
});

test('PF-06 / AC-32: команда с устаревшей ревизией отклоняется, а не перезаписывает', async () => {
  const { goalId, taskId } = await firstTask();

  const stale = await service.changeTaskStatus({
    ownerId: OWNER,
    goalId,
    taskId,
    to: 'todo',
    basis: 'вторая вкладка',
    idempotencyKey: 'k-stale',
    // Страница была отрисована на ревизии 1, но состояние уже ушло вперёд.
    expectedProgressRevision: 1,
    at: AT,
  });

  assert.equal(stale.ok, false);
  if (stale.ok) return;
  assert.equal(stale.kind, 'conflict');
  if (stale.kind !== 'conflict') return;
  assert.equal(stale.on, 'progress');
  assert.match(stale.message, /не потеряно/);

  const after = await service.loadSession(OWNER);
  const task = after.progress.tasks.find((t) => t.taskId === taskId);
  assert.equal(task?.status, 'in_progress', 'состояние не откатилось');
});

test('Параллельные команды не теряют друг друга', async () => {
  const session = await service.loadSession(OWNER);
  const goalId = session.activeGoal!.path.id;
  const revision = session.progress.revision;

  const two = session.taskViews
    .filter((v) => v.state.status === 'todo')
    .slice(0, 2)
    .map((v) => v.task.id);
  assert.equal(two.length, 2, 'нужны две свободные задачи');

  const [a, b] = await Promise.all([
    service.changeTaskStatus({
      ownerId: OWNER,
      goalId,
      taskId: two[0]!,
      to: 'in_progress',
      basis: 'параллель A',
      idempotencyKey: 'par-a',
      expectedProgressRevision: revision,
      at: AT,
    }),
    service.changeTaskStatus({
      ownerId: OWNER,
      goalId,
      taskId: two[1]!,
      to: 'in_progress',
      basis: 'параллель B',
      idempotencyKey: 'par-b',
      expectedProgressRevision: revision,
      at: AT,
    }),
  ]);

  // Одна выигрывает, вторая получает конфликт — но обе получают ОТВЕТ,
  // и ни одна не перезаписывает чужую запись молча.
  const outcomes = [a.ok, b.ok].sort();
  assert.deepEqual(outcomes, [false, true]);

  const state = await getStore().read(OWNER);
  const progress = state.progress[goalId]!;
  // Считаем только эти две задачи: другие могли быть начаты раньше по ходу теста.
  const startedOfTwo = progress.tasks.filter(
    (t) => two.includes(t.taskId) && t.status === 'in_progress',
  );
  assert.equal(startedOfTwo.length, 1, 'применилась ровно одна из двух параллельных команд');
  assert.equal(progress.revision, revision + 1, 'ревизия выросла ровно на одну запись');
});

test('TASK-02/TASK-03/TASK-06: результат создаёт ревизию профиля и закрывает условие', async () => {
  const before = await service.loadSession(OWNER);
  const goalId = before.activeGoal!.path.id;
  const resultTask = before.taskViews.find((v) => v.task.template.kind === 'await_result');
  assert.ok(resultTask, 'в маршруте есть ожидание результата экзамена');

  const examKind = resultTask.task.semanticKey.split(':')[0]!.toUpperCase() === 'ENT'
    ? 'ЕНТ'
    : resultTask.task.semanticKey.split(':')[0]!.toUpperCase();

  const metBefore = before.counters.conditions.met;

  const saved = await service.recordResult({
    ownerId: OWNER,
    goalId,
    taskId: resultTask.task.id,
    result: {
      kind: 'exam_score',
      examKind,
      scaleId: 'ent_0_140',
      overall: 138,
      // Опубликованный результат не может быть датирован будущим: сервер
      // отличает факт от намерения именно по дате.
      takenOn: '2026-09-10',
      resultOn: '2026-09-17',
      provenance: 'self_reported',
    },
    basis: 'тест',
    idempotencyKey: 'k-result',
    expectedProgressRevision: before.progress.revision,
    expectedProfileRevision: before.profile.revision,
    at: AT,
  });

  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  assert.equal(saved.profileRevision, before.profile.revision + 1);

  const after = await service.loadSession(OWNER);
  assert.equal(after.profile.revision, before.profile.revision + 1);
  assert.ok(
    after.profile.exams.some((e) => e.examKind === examKind && e.overall === 138),
    'факт записан в профиль',
  );
  assert.ok(
    after.counters.conditions.met > metBefore,
    `результат должен закрыть условие: было ${metBefore}, стало ${after.counters.conditions.met}`,
  );

  const state = await getStore().read(OWNER);
  // TASK-06: одной транзакцией — обе ревизии, аудит и события.
  assert.equal(state.profileRevisions.length, 2, 'исходная ревизия сохранена вместе с новой');
  assert.ok(state.audit.some((a) => a.action === 'task_result_recorded'));
  assert.ok(state.outbox.some((m) => m.type === 'profile.fact_changed'));
  assert.ok(
    state.outbox.every((m) => !JSON.stringify(m.payload).includes('138')),
    'балл не попадает в событие outbox',
  );
});

test('UX-07: предпросмотр ничего не записывает', async () => {
  const before = await service.loadSession(OWNER);
  const goalId = before.activeGoal!.path.id;
  const docTask = before.taskViews.find((v) => v.task.template.kind === 'obtain_document');
  assert.ok(docTask, 'в маршруте есть получение документа');

  const preview = await service.previewResult({
    ownerId: OWNER,
    goalId,
    taskId: docTask.task.id,
    result: {
      kind: 'document',
      documentKind: docTask.task.semanticKey.replace('doc:', ''),
      provenance: 'self_reported',
    },
    basis: 'тест',
    expectedProgressRevision: before.progress.revision,
    expectedProfileRevision: before.profile.revision,
    at: AT,
  });

  assert.equal(preview.ok, true);
  assert.equal(preview.profileRevisionAfter, before.profile.revision + 1);

  const after = await service.loadSession(OWNER);
  assert.equal(after.profile.revision, before.profile.revision, 'профиль не изменился');
  assert.equal(after.progress.revision, before.progress.revision, 'прогресс не изменился');
});
