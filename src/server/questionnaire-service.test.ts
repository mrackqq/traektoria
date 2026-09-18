/**
 * PF-06 / REV-22 — конфликт на ЧЕРНОВИКЕ анкеты.
 *
 * Ревью ТЗ отдельно отметило эту дыру: требование «конфликт из двух сессий
 * не приводит к молчаливой потере данных» сформулировано, но приёмочные
 * сценарии покрывают только активацию и факты, не черновик. Здесь она
 * закрыта: вторая вкладка получает отказ и внятное объяснение, а её ответы
 * не затирают чужие.
 *
 * Запуск: npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dataDir = await mkdtemp(path.join(tmpdir(), 'trajectory-q-'));
process.env.TRAJECTORY_DATA_DIR = dataDir;

const service = await import('./questionnaire-service.ts');
const progress = await import('./progress-service.ts');
const { getStore } = await import('./file-store.ts');

const OWNER = 'demo-user';
const AT = '2026-09-18T09:00:00Z';

test.after(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

test('Черновик начинается с текущего профиля и сохраняется между запросами', async () => {
  const view = await service.loadDraft(OWNER, AT);
  assert.equal(view.draft.revision, 1);
  assert.equal(view.staleBase, false);

  const saved = await service.saveDraftStep({
    ownerId: OWNER,
    stepId: 'resources',
    answers: { weeklyHours: { state: 'answered', value: '25' } },
    expectedDraftRevision: 1,
    at: AT,
  });

  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  assert.equal(saved.draftRevision, 2);
  assert.deepEqual(saved.errors, []);

  const reloaded = await service.loadDraft(OWNER, AT);
  assert.equal(reloaded.draft.values['weeklyHours']?.value, '25');
});

test('UX-02: ошибка валидации не отменяет сохранение введённого', async () => {
  const before = await service.loadDraft(OWNER, AT);

  const saved = await service.saveDraftStep({
    ownerId: OWNER,
    stepId: 'education',
    answers: { gpa: { state: 'answered', value: '9.9' } },
    expectedDraftRevision: before.draft.revision,
    at: AT,
  });

  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  assert.equal(saved.errors.length, 1);
  assert.equal(saved.errors[0]!.fieldId, 'gpa');

  const after = await service.loadDraft(OWNER, AT);
  assert.equal(after.draft.values['gpa']?.value, '9.9', 'введённое осталось на месте');
});

test('Ошибочный черновик нельзя применить: неверный балл не становится фактом', async () => {
  const view = await service.loadDraft(OWNER, AT);
  assert.equal(view.draft.values['gpa']?.value, '9.9', 'в черновике лежит ошибочное значение');

  const rejected = await service.commitDraft({
    ownerId: OWNER,
    expectedProfileRevision: view.profileRevision,
    expectedDraftRevision: view.draft.revision,
    at: AT,
  });

  assert.equal(rejected.ok, false, 'применение ошибочной анкеты отклонено');
  if (rejected.ok) return;
  assert.equal(rejected.kind, 'invalid');
  assert.ok(rejected.errors?.some((e) => e.fieldId === 'gpa'));

  const state = await getStore().read(OWNER);
  assert.notEqual(state.draft, null, 'черновик сохранён: сохранять ошибку можно, применять — нет');
  assert.equal(state.profileRevisions.length, 0, 'ревизия профиля не создана');

  // Исправляем значение, чтобы дальше проверять нормальный путь применения.
  const fixed = await service.saveDraftStep({
    ownerId: OWNER,
    stepId: 'education',
    answers: { gpa: { state: 'answered', value: '4.7' } },
    expectedDraftRevision: view.draft.revision,
    at: AT,
  });
  assert.equal(fixed.ok, true);
});

test('PF-06 / REV-22: вторая вкладка получает конфликт, а не затирает ответы', async () => {
  const shared = await service.loadDraft(OWNER, AT);
  const revision = shared.draft.revision;

  // Первая вкладка сохранила шаг.
  const first = await service.saveDraftStep({
    ownerId: OWNER,
    stepId: 'status',
    answers: { citizenship: { state: 'answered', value: 'KZ' } },
    expectedDraftRevision: revision,
    at: AT,
  });
  assert.equal(first.ok, true);

  // Вторая открыла анкету раньше и шлёт свои ответы на той же версии.
  const second = await service.saveDraftStep({
    ownerId: OWNER,
    stepId: 'status',
    answers: { citizenship: { state: 'answered', value: 'OTHER' } },
    expectedDraftRevision: revision,
    at: AT,
  });

  assert.equal(second.ok, false);
  if (second.ok) return;
  assert.equal(second.kind, 'conflict');
  assert.equal(second.expected, revision);
  assert.equal(second.actual, revision + 1);
  assert.match(second.message, /не потеряны/);

  const after = await service.loadDraft(OWNER, AT);
  assert.equal(
    after.draft.values['citizenship']?.value,
    'KZ',
    'ответ первой вкладки не затёрт проигравшей командой',
  );
});

test('MODEL-02: применение анкеты создаёт ревизию профиля и меняет расчёт', async () => {
  const before = await progress.loadSession(OWNER);
  const view = await service.loadDraft(OWNER, AT);

  const committed = await service.commitDraft({
    ownerId: OWNER,
    expectedProfileRevision: view.profileRevision,
    expectedDraftRevision: view.draft.revision,
    at: AT,
  });

  assert.equal(committed.ok, true);
  if (!committed.ok) return;
  assert.equal(committed.profileRevision, view.profileRevision + 1);

  const after = await progress.loadSession(OWNER);
  assert.equal(after.profile.revision, before.profile.revision + 1);
  assert.equal(
    after.profile.weeklyHours.state === 'known' ? after.profile.weeklyHours.value : null,
    25,
    'ответ анкеты дошёл до расчёта',
  );
  assert.notEqual(before.key.inputHash, after.key.inputHash, 'ключ расчёта изменился');

  const state = await getStore().read(OWNER);
  assert.equal(state.draft, null, 'черновик очищен только после успешной записи');
  assert.equal(state.profileRevisions.length, 2, 'прежняя ревизия сохранена');
  assert.ok(state.audit.some((a) => a.action === 'profile_updated'));
});

test('Применение на устаревшей ревизии профиля отклоняется, черновик остаётся', async () => {
  await service.saveDraftStep({
    ownerId: OWNER,
    stepId: 'resources',
    answers: { weeklyHours: { state: 'answered', value: '30' } },
    expectedDraftRevision: 1,
    at: AT,
  });

  const staleView = await service.loadDraft(OWNER, AT);
  const stale = await service.commitDraft({
    ownerId: OWNER,
    expectedProfileRevision: 1,
    expectedDraftRevision: staleView.draft.revision,
    at: AT,
  });

  assert.equal(stale.ok, false);
  if (stale.ok) return;
  assert.equal(stale.kind, 'conflict');

  const state = await getStore().read(OWNER);
  assert.notEqual(state.draft, null, 'черновик не выброшен из-за конфликта');
  assert.equal(state.draft?.values['weeklyHours']?.value, '30');
});

test('Отброшенный черновик не меняет профиль', async () => {
  const before = await progress.loadSession(OWNER);
  const view = await service.loadDraft(OWNER, AT);
  await service.discardDraft({ ownerId: OWNER, expectedDraftRevision: view.draft.revision });

  const state = await getStore().read(OWNER);
  assert.equal(state.draft, null);

  const after = await progress.loadSession(OWNER);
  assert.equal(after.profile.revision, before.profile.revision);
});
