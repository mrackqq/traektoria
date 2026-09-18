/**
 * Проверки §8 (TASK-01…TASK-06) и двух дыр покрытия из ревью ТЗ:
 *  • REV-20 — TASK-04: объяснение приоритета обязательно, а при отсутствии
 *    готовых действий показывается конкретная блокировка, не пустой экран;
 *  • REV-21 — TASK-05: нулевой знаменатель обрабатывается явно.
 *
 * Запуск: npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { EVALUATED, NOT_APPLICABLE, type ReqStatus } from '../kernel/status.ts';
import type { EvaluatedNode } from '../eligibility/evaluate.ts';
import type { ApplicantProfileRevision } from '../kernel/profile.ts';
import { known, unanswered } from '../kernel/profile.ts';
import { findTemplate, type TaskTemplate } from '../planning/tasks-library.ts';
import type { ScheduledTask } from '../planning/bridge.ts';

import {
  applyEvidence,
  applyStatusChange,
  canTransition,
  findTask,
  initProgress,
  syncWithRoute,
  type Actor,
  type AppliedOperation,
  type EvidenceCommand,
  type ProgressState,
  type StatusChangeCommand,
  type StructuredResult,
  type TaskSeed,
} from './state.ts';
import { buildTaskViews, selectNextAction, type TaskView } from './next-action.ts';
import { computeCounters } from './counters.ts';

/* ------------------------------------------------------------------ */
/* Фикстуры                                                            */
/* ------------------------------------------------------------------ */

const USER: Actor = { kind: 'user', userId: 'u-1' };
const AT = '2026-09-18T09:00:00Z';
const TODAY = '2026-09-18';

function tmpl(key: string): TaskTemplate {
  const t = findTemplate(key);
  assert.ok(t, `шаблон ${key} должен существовать`);
  return t;
}

function task(over: Partial<ScheduledTask> & { id: string; semanticKey: string }): ScheduledTask {
  const template = over.template ?? tmpl(over.semanticKey);
  return {
    id: over.id,
    semanticKey: over.semanticKey,
    template,
    critical: over.critical ?? true,
    closesLeafIds: over.closesLeafIds ?? [],
    dependsOn: over.dependsOn ?? [],
    boundByDeadlineId: over.boundByDeadlineId ?? 'dl-1',
    earliestStart: over.earliestStart ?? '2026-09-18',
    earliestFinish: over.earliestFinish ?? '2026-10-18',
    latestStart: over.latestStart ?? '2026-11-01',
    latestFinish: over.latestFinish ?? '2026-12-01',
    slackDays: over.slackDays ?? 30,
    ...(over.sessionDate ? { sessionDate: over.sessionDate } : {}),
    violatesDeadline: over.violatesDeadline ?? false,
    deadlineUncertain: over.deadlineUncertain ?? false,
  };
}

function seeds(tasks: readonly ScheduledTask[]): TaskSeed[] {
  return tasks.map((t) => ({
    id: t.id,
    semanticKey: t.semanticKey,
    kind: t.template.kind,
    dependsOn: t.dependsOn,
  }));
}

function progressFor(tasks: readonly ScheduledTask[]): ProgressState {
  return initProgress('u-1', 'goal-1', seeds(tasks));
}

function profile(): ApplicantProfileRevision {
  return {
    id: 'u-1-r4',
    ownerId: 'u-1',
    revision: 4,
    createdAt: '2026-09-01T00:00:00Z',
    changeReason: 'первичное заполнение',
    educationLevel: known('grade_11'),
    expectedGraduation: known('2027-05-25'),
    citizenship: known('KZ'),
    applicantCategory: unanswered(),
    entProfilePair: unanswered(),
  interests: ['cs'],
    grades: [{ scaleId: 'kz-5', value: 4.6, provenance: 'self_reported' }],
    subjects: [{ subjectId: 'math', score: 92, scaleId: 'ent-140', provenance: 'self_reported' }],
    languages: [{ language: 'en', cefr: 'B2' }],
    exams: [
      {
        id: 'exam-ENT-2026',
        examKind: 'ENT',
        scaleId: 'ent-140',
        state: 'result_reported',
        overall: 118,
        takenOn: '2026-06-20',
        resultOn: '2026-06-25',
        provenance: 'self_reported',
      },
    ],
    documents: [{ documentKind: 'school_certificate', obtained: false, provenance: 'self_reported' }],
    targetCountries: ['KZ'],
    instructionLanguages: ['ru', 'en'],
    admissionYear: known(2027),
    weeklyHours: known(10),
    budget: unanswered(),
    constraints: [],
  };
}

function leaf(nodeId: string, status: ReqStatus | 'NA'): EvaluatedNode {
  return {
    nodeId,
    title: `Условие ${nodeId}`,
    kind: 'LEAF',
    outcome: status === 'NA' ? NOT_APPLICABLE : EVALUATED(status),
    reasonCodes: [],
    explanation: '',
    sourceIds: [],
    critical: true,
    evidence: [],
    children: [],
  };
}

function tree(children: EvaluatedNode[]): EvaluatedNode {
  return {
    nodeId: 'root',
    title: 'Корень',
    kind: 'ALL',
    outcome: EVALUATED('UNKNOWN'),
    reasonCodes: [],
    explanation: '',
    sourceIds: [],
    critical: true,
    evidence: [],
    children,
  };
}

const NO_LEDGER: readonly AppliedOperation[] = [];

function statusCmd(over: Partial<StatusChangeCommand> & { taskId: string; to: StatusChangeCommand['to'] }): StatusChangeCommand {
  return {
    idempotencyKey: over.idempotencyKey ?? `key-${over.taskId}-${over.to}`,
    taskId: over.taskId,
    to: over.to,
    at: over.at ?? AT,
    actor: over.actor ?? USER,
    basis: over.basis ?? 'отметка пользователя',
    expectedProgressRevision: over.expectedProgressRevision ?? 1,
  };
}

const IELTS_RESULT: StructuredResult = {
  kind: 'exam_score',
  examKind: 'IELTS',
  // Шкала из реестра: сервер сверяет её с задачей и диапазоном балла.
  scaleId: 'ielts_0_9',
  overall: 7,
  components: [{ component: 'writing', score: 6.5 }],
  // Даты в прошлом относительно момента команды: опубликованный результат
  // не может быть датирован будущим.
  takenOn: '2026-08-15',
  resultOn: '2026-08-28',
  validUntil: '2028-08-28',
  provenance: 'self_reported',
};

function evidenceCmd(over: Partial<EvidenceCommand> & { taskId: string }): EvidenceCommand {
  return {
    idempotencyKey: over.idempotencyKey ?? `ev-${over.taskId}`,
    taskId: over.taskId,
    result: over.result ?? IELTS_RESULT,
    at: over.at ?? AT,
    actor: over.actor ?? USER,
    basis: over.basis ?? 'пользователь ввёл результат',
    expectedProgressRevision: over.expectedProgressRevision ?? 1,
    expectedProfileRevision: over.expectedProfileRevision ?? 4,
  };
}

/* ------------------------------------------------------------------ */
/* TASK-01 — жизненный цикл                                            */
/* ------------------------------------------------------------------ */

test('TASK-01: у перехода есть дата, автор и основание', () => {
  const t = task({ id: 't1', semanticKey: 'ielts:prepare' });
  const out = applyStatusChange({
    progress: progressFor([t]),
    ledger: NO_LEDGER,
    command: statusCmd({ taskId: 't1', to: 'in_progress', basis: 'начал заниматься' }),
  });

  assert.equal(out.kind, 'applied');
  if (out.kind !== 'applied') return;
  assert.deepEqual(out.effect.transition.from, 'todo');
  assert.equal(out.effect.transition.to, 'in_progress');
  assert.equal(out.effect.transition.at, AT);
  assert.deepEqual(out.effect.transition.actor, USER);
  assert.equal(out.effect.transition.basis, 'начал заниматься');
  assert.equal(out.effect.audit.actorRef, 'user:u-1');
  assert.equal(out.effect.progress.revision, 2);
});

test('TASK-01: недопустимый переход отклоняется, состояние не меняется', () => {
  assert.equal(canTransition('obsolete', 'done'), false);
  const t = task({ id: 't1', semanticKey: 'ielts:prepare' });
  const progress = progressFor([t]);
  const obsoleted = syncWithRoute(progress, [], AT, 'маршрут пересчитан');

  const out = applyStatusChange({
    progress: obsoleted,
    ledger: NO_LEDGER,
    command: statusCmd({ taskId: 't1', to: 'done', expectedProgressRevision: obsoleted.revision }),
  });

  assert.equal(out.kind, 'rejected');
  if (out.kind !== 'rejected') return;
  assert.equal(out.code, 'TRANSITION_NOT_ALLOWED');
});

test('TASK-01: блокировка и просрочка — признаки, а не статусы', () => {
  const a = task({ id: 't1', semanticKey: 'ielts:prepare', latestFinish: '2026-09-01', slackDays: -5 });
  const b = task({ id: 't2', semanticKey: 'ielts:take', dependsOn: ['t1'] });
  const views = buildTaskViews([a, b], progressFor([a, b]), TODAY);

  const va = views.find((v) => v.task.id === 't1')!;
  const vb = views.find((v) => v.task.id === 't2')!;

  assert.equal(va.state.status, 'todo', 'просрочка не подменяет статус');
  assert.equal(va.flags.overdue, true);
  assert.equal(vb.state.status, 'todo', 'блокировка не подменяет статус');
  assert.deepEqual(vb.flags.blockedBy, ['t1']);
});

test('BR-07: при неполной отсечке просрочка не выставляется', () => {
  const t = task({
    id: 't1',
    semanticKey: 'ielts:prepare',
    latestFinish: '2026-09-01',
    deadlineUncertain: true,
  });
  const [view] = buildTaskViews([t], progressFor([t]), TODAY);
  assert.equal(view!.flags.overdue, false);
  assert.equal(view!.flags.dueUncertain, true);
});

test('TASK-01: исчезнувшая из маршрута задача становится obsolete, выполненная — нет', () => {
  const a = task({ id: 't1', semanticKey: 'ielts:prepare' });
  const b = task({ id: 't2', semanticKey: 'ielts:register' });
  let progress = progressFor([a, b]);

  const done = applyStatusChange({
    progress,
    ledger: NO_LEDGER,
    command: statusCmd({ taskId: 't1', to: 'done' }),
  });
  assert.equal(done.kind, 'applied');
  if (done.kind !== 'applied') return;
  progress = done.effect.progress;

  const c = task({ id: 't3', semanticKey: 'toefl:prepare' });
  const synced = syncWithRoute(progress, seeds([c]), AT, 'выбран другой экзамен');

  assert.equal(findTask(synced, 't1')!.status, 'done', 'факт выполнения сохраняется');
  assert.equal(findTask(synced, 't2')!.status, 'obsolete');
  assert.equal(findTask(synced, 't3')!.status, 'todo');
  assert.equal(synced.revision, progress.revision + 1);
});

/* ------------------------------------------------------------------ */
/* TASK-02 / TASK-03 — действие против условия                         */
/* ------------------------------------------------------------------ */

test('AC-07 / TASK-02: сдача экзамена закрывается отметкой, а получение результата — нет', () => {
  const take = task({ id: 't-take', semanticKey: 'ielts:take' });
  const res = task({ id: 't-res', semanticKey: 'ielts:result', dependsOn: ['t-take'] });
  const progress = progressFor([take, res]);

  const okTake = applyStatusChange({
    progress,
    ledger: NO_LEDGER,
    command: statusCmd({ taskId: 't-take', to: 'done' }),
  });
  assert.equal(okTake.kind, 'applied', 'действие «сдать» закрывается отметкой');

  const badResult = applyStatusChange({
    progress,
    ledger: NO_LEDGER,
    command: statusCmd({ taskId: 't-res', to: 'done' }),
  });
  assert.equal(badResult.kind, 'rejected');
  if (badResult.kind !== 'rejected') return;
  assert.equal(badResult.code, 'RESULT_REQUIRED');
});

test('TASK-02: результат без корректного значения не принимается', () => {
  const res = task({ id: 't-res', semanticKey: 'ielts:result' });
  const out = applyEvidence({
    progress: progressFor([res]),
    profile: profile(),
    ledger: NO_LEDGER,
    command: evidenceCmd({
      taskId: 't-res',
      result: { ...IELTS_RESULT, overall: Number.NaN },
    }),
  });

  assert.equal(out.kind, 'rejected');
  if (out.kind !== 'rejected') return;
  assert.equal(out.code, 'RESULT_INVALID');
});

test('TASK-02: у действия без собственного результата команда результата отклоняется', () => {
  const prep = task({ id: 't-prep', semanticKey: 'ielts:prepare' });
  const out = applyEvidence({
    progress: progressFor([prep]),
    profile: profile(),
    ledger: NO_LEDGER,
    command: evidenceCmd({ taskId: 't-prep' }),
  });

  assert.equal(out.kind, 'rejected');
  if (out.kind !== 'rejected') return;
  assert.equal(out.code, 'RESULT_NOT_EXPECTED');
});

test('TASK-03: запись результата не удаляет другие сведения профиля', () => {
  const res = task({ id: 't-res', semanticKey: 'ielts:result' });
  const before = profile();
  const out = applyEvidence({
    progress: progressFor([res]),
    profile: before,
    ledger: NO_LEDGER,
    command: evidenceCmd({ taskId: 't-res' }),
  });

  assert.equal(out.kind, 'applied');
  if (out.kind !== 'applied') return;
  const after = out.effect.profile;

  assert.equal(after.revision, before.revision + 1);
  assert.ok(after.exams.some((e) => e.examKind === 'ENT'), 'прежний экзамен сохранился');
  assert.ok(after.exams.some((e) => e.examKind === 'IELTS' && e.overall === 7));
  assert.deepEqual(after.subjects, before.subjects);
  assert.deepEqual(after.grades, before.grades);
  assert.equal(before.exams.length, 1, 'исходная ревизия не мутирована');
  assert.equal(out.effect.recompute.factKeys[0], 'exam:IELTS');
});

test('TASK-03: снятие отметки обратимо и не стирает историю', () => {
  const prep = task({ id: 't1', semanticKey: 'ielts:prepare' });
  const first = applyStatusChange({
    progress: progressFor([prep]),
    ledger: NO_LEDGER,
    command: statusCmd({ taskId: 't1', to: 'done' }),
  });
  assert.equal(first.kind, 'applied');
  if (first.kind !== 'applied') return;

  const undo = applyStatusChange({
    progress: first.effect.progress,
    ledger: NO_LEDGER,
    command: statusCmd({
      taskId: 't1',
      to: 'in_progress',
      idempotencyKey: 'undo-1',
      expectedProgressRevision: first.effect.progress.revision,
      basis: 'отметка снята',
    }),
  });

  assert.equal(undo.kind, 'applied');
  if (undo.kind !== 'applied') return;
  assert.equal(findTask(undo.effect.progress, 't1')!.history.length, 2);
});

/* ------------------------------------------------------------------ */
/* TASK-06 / AC-32 — две ревизии в одной транзакции                    */
/* ------------------------------------------------------------------ */

test('TASK-06: эффект результата содержит обе новые ревизии, аудит и outbox', () => {
  const res = task({ id: 't-res', semanticKey: 'ielts:result' });
  const out = applyEvidence({
    progress: progressFor([res]),
    profile: profile(),
    ledger: NO_LEDGER,
    command: evidenceCmd({ taskId: 't-res' }),
  });

  assert.equal(out.kind, 'applied');
  if (out.kind !== 'applied') return;
  const e = out.effect;

  assert.equal(e.progress.revision, 2);
  assert.equal(e.profile.revision, 5);
  assert.equal(e.audit.progressRevision, 2);
  assert.equal(e.audit.profileRevision, 5);
  assert.equal(e.outbox.length, 2);
  assert.deepEqual(
    [...e.outbox].map((m) => m.type).sort(),
    ['profile.fact_changed', 'progress.task_changed'],
  );
});

test('AC-32: устаревшая ревизия профиля даёт конфликт, а не потерю результата', () => {
  const res = task({ id: 't-res', semanticKey: 'ielts:result' });
  const out = applyEvidence({
    progress: progressFor([res]),
    profile: profile(),
    ledger: NO_LEDGER,
    command: evidenceCmd({ taskId: 't-res', expectedProfileRevision: 3 }),
  });

  assert.equal(out.kind, 'conflict');
  if (out.kind !== 'conflict') return;
  assert.equal(out.on, 'profile');
  assert.equal(out.expected, 3);
  assert.equal(out.actual, 4);
  assert.match(out.message, /не потеряно/);
});

test('TASK-06: изменение только статуса не требует ревизии профиля', () => {
  const prep = task({ id: 't1', semanticKey: 'ielts:prepare' });
  const out = applyStatusChange({
    progress: progressFor([prep]),
    ledger: NO_LEDGER,
    command: statusCmd({ taskId: 't1', to: 'in_progress' }),
  });

  assert.equal(out.kind, 'applied');
  if (out.kind !== 'applied') return;
  assert.equal(out.effect.audit.profileRevision, null);
  assert.equal(out.effect.operation.profileRevision, null);
});

test('OPS-02 / PRIV-06: значение результата не попадает в outbox', () => {
  const res = task({ id: 't-res', semanticKey: 'ielts:result' });
  const out = applyEvidence({
    progress: progressFor([res]),
    profile: profile(),
    ledger: NO_LEDGER,
    command: evidenceCmd({ taskId: 't-res' }),
  });

  assert.equal(out.kind, 'applied');
  if (out.kind !== 'applied') return;
  const serialized = JSON.stringify(out.effect.outbox);
  assert.doesNotMatch(serialized, /"overall"|\b7\b/, 'балл не должен уходить в событие');
});

test('API-04: повтор ключа возвращает зафиксированный результат, другой payload — отказ', () => {
  const res = task({ id: 't-res', semanticKey: 'ielts:result' });
  const progress = progressFor([res]);

  const first = applyEvidence({
    progress,
    profile: profile(),
    ledger: NO_LEDGER,
    command: evidenceCmd({ taskId: 't-res', idempotencyKey: 'k-1' }),
  });
  assert.equal(first.kind, 'applied');
  if (first.kind !== 'applied') return;
  const ledger = [first.effect.operation];

  const repeat = applyEvidence({
    progress,
    profile: profile(),
    ledger,
    command: evidenceCmd({ taskId: 't-res', idempotencyKey: 'k-1' }),
  });
  assert.equal(repeat.kind, 'replayed');

  const reused = applyEvidence({
    progress,
    profile: profile(),
    ledger,
    command: evidenceCmd({
      taskId: 't-res',
      idempotencyKey: 'k-1',
      result: { ...IELTS_RESULT, overall: 8 },
    }),
  });
  assert.equal(reused.kind, 'rejected');
  if (reused.kind !== 'rejected') return;
  assert.equal(reused.code, 'IDEMPOTENCY_KEY_REUSED');
});

/* ------------------------------------------------------------------ */
/* TASK-04 / REV-20 — ближайшее действие и объяснение                  */
/* ------------------------------------------------------------------ */

test('AC-01 / TASK-04: выбрано действие с наименьшим резервом, объяснение непустое', () => {
  const a = task({ id: 't-a', semanticKey: 'ielts:prepare', slackDays: 40 });
  const b = task({ id: 't-b', semanticKey: 'doc:school_certificate', slackDays: 5 });
  const views = buildTaskViews([a, b], progressFor([a, b]), TODAY);

  const out = selectNextAction({ views, today: TODAY, weeklyHours: 10 });

  assert.equal(out.kind, 'action');
  if (out.kind !== 'action') return;
  assert.equal(out.view.task.id, 't-b');
  assert.ok(out.factors.length > 0, 'объяснение приоритета обязательно');
  assert.match(out.explanation, /резерв 5 дн/);
  assert.equal(out.alternativesCount, 1);
});

test('TASK-04: при равенстве всех признаков выбор детерминирован по идентификатору', () => {
  const a = task({ id: 't-a', semanticKey: 'ielts:prepare' });
  const b = task({ id: 't-b', semanticKey: 'toefl:prepare' });
  const straight = selectNextAction({
    views: buildTaskViews([a, b], progressFor([a, b]), TODAY),
    today: TODAY,
    weeklyHours: null,
  });
  const reversed = selectNextAction({
    views: buildTaskViews([b, a], progressFor([b, a]), TODAY),
    today: TODAY,
    weeklyHours: null,
  });

  assert.equal(straight.kind, 'action');
  assert.equal(reversed.kind, 'action');
  if (straight.kind !== 'action' || reversed.kind !== 'action') return;
  assert.equal(straight.view.task.id, reversed.view.task.id);
  assert.equal(straight.view.task.id, 't-a');
});

test('TASK-04: исчерпанная недельная нагрузка не порождает совет начать ещё одну задачу', () => {
  const started = task({ id: 't-started', semanticKey: 'ielts:prepare', slackDays: 40 });
  const fresh = task({ id: 't-fresh', semanticKey: 'doc:school_certificate', slackDays: 5 });
  let progress = progressFor([started, fresh]);

  const begin = applyStatusChange({
    progress,
    ledger: NO_LEDGER,
    command: statusCmd({ taskId: 't-started', to: 'in_progress' }),
  });
  assert.equal(begin.kind, 'applied');
  if (begin.kind !== 'applied') return;
  progress = begin.effect.progress;

  const views = buildTaskViews([started, fresh], progress, TODAY);
  const out = selectNextAction({ views, today: TODAY, weeklyHours: 4 });

  assert.equal(out.kind, 'action');
  if (out.kind !== 'action') return;
  assert.equal(out.view.task.id, 't-started', 'сначала доводим начатое');
  assert.ok(out.factors.some((f) => f.code === 'LOAD_LIMIT'));
});

test('REV-20 / TASK-04: внешнее ожидание показывается конкретно, а не пустым экраном', () => {
  const res = task({ id: 't-res', semanticKey: 'ielts:result', earliestFinish: '2026-12-01' });
  let progress = progressFor([res]);
  const wait = applyStatusChange({
    progress,
    ledger: NO_LEDGER,
    command: statusCmd({ taskId: 't-res', to: 'awaiting_result' }),
  });
  assert.equal(wait.kind, 'applied');
  if (wait.kind !== 'applied') return;
  progress = wait.effect.progress;

  const out = selectNextAction({
    views: buildTaskViews([res], progress, TODAY),
    today: TODAY,
    weeklyHours: 10,
  });

  assert.equal(out.kind, 'awaiting_external');
  if (out.kind !== 'awaiting_external') return;
  assert.ok(out.explanation.includes('Получить результат IELTS Academic'));
  assert.match(out.hint, /1 декабря/);
});

test('REV-20 / TASK-04: когда всё заблокировано, называется блокирующее действие', () => {
  const blocker = task({ id: 't-blocker', semanticKey: 'ielts:take' });
  const dependent = task({ id: 't-dep', semanticKey: 'ielts:result', dependsOn: ['t-blocker'] });
  let progress = progressFor([blocker, dependent]);

  const wait = applyStatusChange({
    progress,
    ledger: NO_LEDGER,
    command: statusCmd({ taskId: 't-blocker', to: 'skipped', basis: 'решил не сдавать сейчас' }),
  });
  assert.equal(wait.kind, 'applied');
  if (wait.kind !== 'applied') return;

  // Пропуск зависимость НЕ снимает: пропустить сдачу экзамена не значит сдать
  // его. Зависимое действие остаётся заблокированным, и названо именно то
  // действие, которое нужно вернуть в план.
  const afterSkip = selectNextAction({
    views: buildTaskViews([blocker, dependent], wait.effect.progress, TODAY),
    today: TODAY,
    weeklyHours: 10,
  });
  assert.equal(afterSkip.kind, 'blocked');
  if (afterSkip.kind !== 'blocked') return;
  assert.ok(afterSkip.blockers.some((b) => b.task.id === 't-blocker'));
  assert.match(afterSkip.explanation, /пропущ/i);

  // А пока зависимость не закрыта — конкретная блокировка с подсказкой.
  const views: TaskView[] = buildTaskViews([blocker, dependent], progress, TODAY).map((v) =>
    v.task.id === 't-blocker'
      ? { ...v, state: { ...v.state, status: 'awaiting_result' as const } }
      : v,
  );
  const blockedOut = selectNextAction({ views, today: TODAY, weeklyHours: 10 });
  assert.equal(blockedOut.kind, 'awaiting_external');
  if (blockedOut.kind !== 'awaiting_external') return;
  assert.ok(blockedOut.hint.length > 0);
});

test('REV-20 / TASK-04: маршрут пуст, но условия неизвестны → задача уточнения', () => {
  const evaluation = tree([leaf('l1', 'MET'), leaf('l2', 'UNKNOWN'), leaf('l3', 'NA')]);
  const out = selectNextAction({
    views: [],
    today: TODAY,
    weeklyHours: 10,
    evaluation,
  });

  assert.equal(out.kind, 'clarification');
  if (out.kind !== 'clarification') return;
  assert.deepEqual(out.nodeIds, ['l2']);
  assert.ok(out.hint.length > 0);
});

test('TASK-04: все действия закрыты и неизвестных условий нет → объяснение всё равно есть', () => {
  const t = task({ id: 't1', semanticKey: 'ielts:prepare' });
  const done = applyStatusChange({
    progress: progressFor([t]),
    ledger: NO_LEDGER,
    command: statusCmd({ taskId: 't1', to: 'done' }),
  });
  assert.equal(done.kind, 'applied');
  if (done.kind !== 'applied') return;

  const out = selectNextAction({
    views: buildTaskViews([t], done.effect.progress, TODAY),
    today: TODAY,
    weeklyHours: 10,
    evaluation: tree([leaf('l1', 'MET')]),
  });

  assert.equal(out.kind, 'all_done');
  if (out.kind !== 'all_done') return;
  assert.ok(out.explanation.length > 0 && out.hint.length > 0);
});

/* ------------------------------------------------------------------ */
/* TASK-05 / REV-21 — счётчики и нулевой знаменатель                   */
/* ------------------------------------------------------------------ */

test('REV-21 / TASK-05: пустой маршрут даёт неопределённое отношение, а не 0% и не 100%', () => {
  const counters = computeCounters(initProgress('u-1', 'goal-1', []), null);

  assert.equal(counters.actions.total, 0);
  assert.equal(counters.actionsRatio.kind, 'undefined');
  if (counters.actionsRatio.kind !== 'undefined') return;
  assert.equal(counters.actionsRatio.reason, 'no_tasks');
  assert.ok(counters.actionsRatio.message.length > 0);
});

test('REV-21 / TASK-05: дерево без применимых условий не даёт деления на ноль', () => {
  const counters = computeCounters(
    initProgress('u-1', 'goal-1', []),
    tree([leaf('l1', 'NA'), leaf('l2', 'NA')]),
  );

  assert.equal(counters.conditions.notApplicable, 2);
  assert.equal(counters.conditions.total, 0);
  assert.equal(counters.conditionsRatio.kind, 'undefined');
  if (counters.conditionsRatio.kind !== 'undefined') return;
  assert.equal(counters.conditionsRatio.reason, 'no_applicable_conditions');
});

test('TASK-05: действия и условия считаются раздельно; obsolete не улучшает прогресс', () => {
  const a = task({ id: 't1', semanticKey: 'ielts:prepare' });
  const b = task({ id: 't2', semanticKey: 'ielts:register' });
  let progress = progressFor([a, b]);

  const done = applyStatusChange({
    progress,
    ledger: NO_LEDGER,
    command: statusCmd({ taskId: 't1', to: 'done' }),
  });
  assert.equal(done.kind, 'applied');
  if (done.kind !== 'applied') return;
  progress = syncWithRoute(done.effect.progress, seeds([a]), AT, 'регистрация больше не нужна');

  const counters = computeCounters(progress, tree([leaf('l1', 'MET'), leaf('l2', 'NOT_MET')]));

  assert.equal(counters.actions.obsolete, 1);
  assert.equal(counters.actions.total, 1, 'obsolete исключён из знаменателя');
  assert.equal(counters.actionsRatio.kind, 'ratio');
  if (counters.actionsRatio.kind !== 'ratio') return;
  assert.equal(counters.actionsRatio.percent, 100);

  assert.equal(counters.conditions.met, 1);
  assert.equal(counters.conditions.total, 2);
  assert.equal(counters.conditionsRatio.kind, 'ratio');
  if (counters.conditionsRatio.kind !== 'ratio') return;
  assert.equal(counters.conditionsRatio.percent, 50);
  assert.match(counters.disclaimer, /не вероятность поступления/);
});
