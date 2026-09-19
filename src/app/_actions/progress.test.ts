/**
 * Server Actions прогресса — граница доверия между браузером и ядром.
 *
 * Здесь разбирается `FormData`, пришедшая от пользователя: значения
 * приводятся вручную (`String`, `Number`), без схемы. Проверяется не то,
 * что ядро умеет считать, а то, что мусор с границы доходит до ядра в
 * распознаваемом виде и получает осмысленный отказ вместо исключения.
 *
 * `next/cache`, `next/headers` и `next/navigation` подменяются: вне рантайма
 * Next они недоступны, а нам нужна именно логика действия.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after, mock } from 'node:test';
import assert from 'node:assert/strict';

const dataDir = await mkdtemp(path.join(tmpdir(), 'trajectory-actions-'));
process.env.TRAJECTORY_DATA_DIR = dataDir;
// Демо-владелец даёт готовый профиль с целью и маршрутом: иначе действовать
// не над чем — у пустого посетителя ни задач, ни цели нет.
const SESSION = 'demoactions123';

const revalidated: string[] = [];

mock.module('next/cache', {
  namedExports: {
    revalidatePath: (p: string, type?: string) => void revalidated.push(type ? `${p} (${type})` : p),
    revalidateTag: () => undefined,
  },
});

const jar = new Map<string, string>([
  ['trk_sid', SESSION],
  ['trk_mode', 'demo'],
]);

mock.module('next/headers', {
  namedExports: {
    cookies: async () => ({
      get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)! } : undefined),
      set: (n: string, v: string) => void jar.set(n, v),
      delete: (n: string) => void jar.delete(n),
    }),
  },
});

mock.module('next/navigation', {
  namedExports: {
    redirect: (to: string) => {
      throw new Error(`REDIRECT:${to}`);
    },
    notFound: () => {
      throw new Error('NOT_FOUND');
    },
  },
});

const actions = await import('./progress.ts');
const { loadSessionView } = await import('@/server/progress-service');
const { demoOwnerId } = await import('@core/demo/profile');

const ownerId = demoOwnerId(SESSION);

after(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

/** Текущее состояние: цель, первая задача и ревизии. */
async function context() {
  const view = await loadSessionView(ownerId);
  const s = view.snapshot;
  return {
    goalId: s.activeGoal!.path.id,
    taskId: s.taskViews[0]!.task.id,
    progressRevision: s.progress.revision,
    profileRevision: s.profile.revision,
  };
}

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const idle = { ok: true } as never;

/* ------------------------------------------------------------------ */
/* changeStatusAction                                                  */
/* ------------------------------------------------------------------ */

test('Смена статуса на допустимый проходит и обновляет страницы', async () => {
  const c = await context();
  revalidated.length = 0;

  const r = await actions.changeStatusAction(
    idle,
    form({
      goalId: c.goalId,
      taskId: c.taskId,
      to: 'in_progress',
      expectedProgressRevision: String(c.progressRevision),
    }),
  );

  assert.equal(r.ok, true, JSON.stringify(r));
  // Сброс делается одним вызовом на всё поддерево, а не перечислением
  // страниц: перечисление заставляло клиент перезапрашивать каждую из них,
  // и ответ действия приходил с задержкой в десятки секунд.
  assert.deepEqual(
    revalidated,
    ['/ (layout)'],
    'прогресс меняет все разделы сразу, поэтому сброс должен быть один',
  );
});

test('Статус вне перечисления отвергается, а не роняет обработчик', async () => {
  // `to` приводится к типу без проверки: значение из формы попадает в ядро
  // как есть. Ядро обязано ответить отказом, а не исключением.
  const c = await context();

  const r = await actions.changeStatusAction(
    idle,
    form({
      goalId: c.goalId,
      taskId: c.taskId,
      to: 'hacked_status',
      expectedProgressRevision: String(c.progressRevision),
    }),
  );

  assert.equal(r.ok, false);
  assert.ok(!JSON.stringify(r).includes('undefined'), 'в тексте пользователю не должно быть «undefined»');
});

test('Несуществующая задача даёт понятный отказ', async () => {
  const c = await context();

  const r = await actions.changeStatusAction(
    idle,
    form({
      goalId: c.goalId,
      taskId: 'нет-такой-задачи',
      to: 'in_progress',
      expectedProgressRevision: String(c.progressRevision),
    }),
  );

  assert.equal(r.ok, false);
});

test('Устаревшая ревизия прогресса не затирает чужое изменение', async () => {
  const c = await context();

  const r = await actions.changeStatusAction(
    idle,
    form({
      goalId: c.goalId,
      taskId: c.taskId,
      to: 'in_progress',
      expectedProgressRevision: '0',
    }),
  );

  assert.equal(r.ok, false, 'ревизия 0 давно не актуальна');
});

test('Отсутствующая ревизия не считается «любой»', async () => {
  // Поле не прислано — `Number(null)` даёт 0, и это выглядит как «я видел
  // нулевую ревизию». Команда обязана отвергнуться, а не примениться вслепую.
  const c = await context();

  const r = await actions.changeStatusAction(
    idle,
    form({ goalId: c.goalId, taskId: c.taskId, to: 'done' }),
  );

  assert.equal(r.ok, false);
});

test('Отказ не вызывает обновление страниц', async () => {
  const c = await context();
  revalidated.length = 0;

  await actions.changeStatusAction(
    idle,
    form({
      goalId: c.goalId,
      taskId: c.taskId,
      to: 'hacked_status',
      expectedProgressRevision: String(c.progressRevision),
    }),
  );

  assert.deepEqual(revalidated, [], 'ничего не изменилось — перерисовывать нечего');
});

/* ------------------------------------------------------------------ */
/* setGoalAction                                                       */
/* ------------------------------------------------------------------ */

test('Несуществующая цель отвергается сверкой с каталогом', async () => {
  const r = await actions.setGoalAction(idle, form({ goalId: 'нет-такой-программы' }));

  assert.equal(r.ok, false);
  assert.match(JSON.stringify(r), /каталог/i, 'причина обязана быть понятна пользователю');
});

test('Пустая цель не принимается', async () => {
  const r = await actions.setGoalAction(idle, form({ goalId: '' }));
  assert.equal(r.ok, false);
});

test('Существующая цель сохраняется', async () => {
  const c = await context();
  const r = await actions.setGoalAction(idle, form({ goalId: c.goalId }));
  assert.equal(r.ok, true, JSON.stringify(r));
});

/* ------------------------------------------------------------------ */
/* previewResultAction                                                 */
/* ------------------------------------------------------------------ */

test('Предпросмотр не меняет состояние ни при каких входных данных', async () => {
  const before = await context();

  for (const overall of ['не-число', '-5', '99999', 'Infinity', '7.33', '']) {
    await actions.previewResultAction(
      idle,
      form({
        goalId: before.goalId,
        taskId: before.taskId,
        resultKind: 'exam_score',
        examKind: 'IELTS',
        scaleId: 'ielts_0_9',
        overall,
        takenOn: '2027-04-01',
        resultOn: '2027-04-10',
        expectedProgressRevision: String(before.progressRevision),
        expectedProfileRevision: String(before.profileRevision),
      }),
    );
  }

  const after = await context();
  assert.equal(after.progressRevision, before.progressRevision, 'предпросмотр не пишет прогресс');
  assert.equal(after.profileRevision, before.profileRevision, 'предпросмотр не пишет профиль');
});

test('Числовой мусор в баллах доходит до ядра как отказ, а не как исключение', async () => {
  const c = await context();

  for (const overall of ['не-число', '-5', '99999']) {
    const r = await actions.previewResultAction(
      idle,
      form({
        goalId: c.goalId,
        taskId: c.taskId,
        resultKind: 'exam_score',
        examKind: 'IELTS',
        scaleId: 'ielts_0_9',
        overall,
        takenOn: '2027-04-01',
        resultOn: '2027-04-10',
        expectedProgressRevision: String(c.progressRevision),
        expectedProfileRevision: String(c.profileRevision),
      }),
    );
    assert.equal(r.ok, false, `«${overall}» обязано быть отвергнуто`);
  }
});

test('Отсутствие обязательных дат ловится до обращения к ядру', async () => {
  const c = await context();

  const r = await actions.previewResultAction(
    idle,
    form({
      goalId: c.goalId,
      taskId: c.taskId,
      resultKind: 'exam_score',
      examKind: 'IELTS',
      scaleId: 'ielts_0_9',
      overall: '7',
      expectedProgressRevision: String(c.progressRevision),
      expectedProfileRevision: String(c.profileRevision),
    }),
  );

  assert.equal(r.ok, false);
});

test('Неизвестный вид результата не принимается', async () => {
  const c = await context();

  const r = await actions.previewResultAction(
    idle,
    form({
      goalId: c.goalId,
      taskId: c.taskId,
      resultKind: 'выдуманный_вид',
      expectedProgressRevision: String(c.progressRevision),
      expectedProfileRevision: String(c.profileRevision),
    }),
  );

  assert.equal(r.ok, false);
});

test('Имена компонентов из формы не загрязняют прототип', async () => {
  const c = await context();

  await actions.previewResultAction(
    idle,
    form({
      goalId: c.goalId,
      taskId: c.taskId,
      resultKind: 'exam_score',
      examKind: 'IELTS',
      scaleId: 'ielts_0_9',
      overall: '7',
      'component:__proto__': '9',
      'component:constructor': '9',
      'component:polluted': '9',
      takenOn: '2027-04-01',
      resultOn: '2027-04-10',
      expectedProgressRevision: String(c.progressRevision),
      expectedProfileRevision: String(c.profileRevision),
    }),
  );

  assert.equal(
    ({} as Record<string, unknown>)['polluted'],
    undefined,
    'ключи из формы не должны попадать в Object.prototype',
  );
});
