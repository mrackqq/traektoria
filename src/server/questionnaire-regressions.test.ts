/**
 * Регрессии анкеты: пустое применение, явная очистка списка и первое
 * заполнение.
 *
 * Все три проверяются через настоящий серверный путь «сохранить шаг →
 * применить анкету → пересчитать сессию», а не через отдельно взятую чистую
 * функцию: ошибки были именно на стыке — разбор формы, слияние с профилем и
 * признак «анкета начата».
 *
 * Запуск: npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dataDir = await mkdtemp(path.join(tmpdir(), 'trajectory-qr-'));
process.env.TRAJECTORY_DATA_DIR = dataDir;

const service = await import('./questionnaire-service.ts');
const progress = await import('./progress-service.ts');
const { getStore } = await import('./file-store.ts');

const AT = '2026-09-18T09:00:00Z';

test.after(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

/** Сохранить шаг и применить анкету целиком — как это делает форма. */
async function applyStep(
  ownerId: string,
  stepId: string,
  answers: Record<string, ReturnType<typeof service.parseAnswer>>,
) {
  const view = await service.loadDraft(ownerId, AT);

  const saved = await service.saveDraftStep({
    ownerId,
    stepId,
    answers,
    expectedDraftRevision: view.draft.revision,
    at: AT,
  });
  assert.equal(saved.ok, true, 'шаг обязан сохраниться');
  if (!saved.ok) throw new Error('unreachable');

  const committed = await service.commitDraft({
    ownerId,
    expectedProfileRevision: view.profileRevision,
    expectedDraftRevision: saved.draftRevision,
    at: AT,
  });
  assert.equal(committed.ok, true, 'анкета обязана примениться');
  if (!committed.ok) throw new Error('unreachable');

  return committed;
}

/* ------------------------------------------------------------------ */
/* Баг 1. Пустая анкета не делает вид, что человек ответил              */
/* ------------------------------------------------------------------ */

test('Пустая анкета не создаёт ни цели, ни маршрута — ни в первый раз, ни при повторе', async () => {
  const owner = 'regress-empty';

  const clean = await progress.loadSession(owner);
  assert.equal(clean.profileStarted, false, 'до анкеты профиль не начат');
  assert.equal(clean.activeGoal, null, 'цели нет');
  assert.equal(clean.route, null, 'маршрута нет');

  // Пользователь открыл шаг и нажал «Сохранить и продолжить», ничего не введя.
  const first = await applyStep(owner, 'education', {});
  assert.equal(first.profileRevision, 2, 'техническая ревизия выросла');

  const afterFirst = await progress.loadSession(owner);
  assert.equal(afterFirst.profileStarted, false, 'ревизия — не ответ пользователя');
  assert.equal(afterFirst.activeGoal, null, 'цель не выдумывается');
  assert.equal(afterFirst.route, null, 'маршрут не строится');

  // Повтор: второе применение пустой анкеты тоже ничего не должно создать.
  await applyStep(owner, 'resources', {});

  const afterSecond = await progress.loadSession(owner);
  assert.equal(afterSecond.profile.revision, 3, 'ревизия снова выросла');
  assert.equal(afterSecond.profileStarted, false, 'анкета по-прежнему пуста');
  assert.equal(afterSecond.activeGoal, null, 'цели по-прежнему нет');
  assert.equal(afterSecond.route, null, 'маршрута по-прежнему нет');
});

test('Один ответ уже делает анкету начатой: частичное заполнение сохраняется', async () => {
  const owner = 'regress-partial';

  await applyStep(owner, 'resources', {
    weeklyHours: service.parseAnswer('25', 'known'),
  });

  const session = await progress.loadSession(owner);
  assert.equal(session.profileStarted, true, 'ответ есть — анкета начата');
  assert.deepEqual(session.profile.weeklyHours, { state: 'known', value: 25 });

  // Незаполненное остальное сохранению не мешает.
  assert.equal(session.profile.educationLevel.state, 'unanswered');
});

test('Явно выбранную цель пустая анкета не удаляет', async () => {
  const owner = 'regress-chosen-goal';

  await applyStep(owner, 'resources', {
    weeklyHours: service.parseAnswer('20', 'known'),
  });

  const withAnswers = await progress.loadSession(owner);
  const target = withAnswers.goals[0];
  assert.ok(target, 'в каталоге есть варианты');

  const set = await progress.setActiveGoal({ ownerId: owner, goalId: target.path.id });
  assert.equal(set.ok, true, 'цель выбирается пользователем явно');

  const chosen = await progress.loadSession(owner);
  assert.equal(chosen.activeGoal?.path.id, target.path.id);

  // Ещё одно применение анкеты без ответов не трогает выбор пользователя.
  await applyStep(owner, 'education', {});

  const after = await progress.loadSession(owner);
  assert.equal(after.activeGoal?.path.id, target.path.id, 'цель осталась выбранной');
});

/* ------------------------------------------------------------------ */
/* Баг 2. Снятие всех галочек очищает список                            */
/* ------------------------------------------------------------------ */

/**
 * Пустой множественный выбор приходит с формы как отсутствие полей `value:`,
 * поэтому разбор обязан различать «поле не редактировали» и «пользователь
 * снял все галочки». Ровно это и проверяется: разбор идёт тем же
 * `parseAnswer`, что и в серверном действии.
 */
test('Снятие всех галочек очищает предметы в профиле', async () => {
  const owner = 'regress-subjects-clear';

  await applyStep(owner, 'education', {
    subjects: service.parseAnswer(null, 'known', ['math', 'physics']),
  });

  const filled = await progress.loadSession(owner);
  assert.deepEqual(
    filled.profile.subjects.map((s) => s.subjectId),
    ['math', 'physics'],
  );

  // Пользователь снял все галочки и применил анкету.
  const cleared = await applyStep(owner, 'education', {
    subjects: service.parseAnswer(null, 'known', []),
  });
  assert.equal(cleared.ok, true, 'пустой список — валидный ответ, а не ошибка');

  const after = await progress.loadSession(owner);
  assert.deepEqual(after.profile.subjects, [], 'список действительно очищен');

  // Состав каталога от очистки не меняется: пересчёт идёт по тем же вариантам.
  assert.equal(
    after.recommendation.assessments.length,
    filled.recommendation.assessments.length,
    'варианты каталога те же',
  );

  // Раньше здесь проверялось, что выдача переупорядочилась: у казахстанских
  // программ стояло условие «не менее двух профильных предметов». Теперь
  // допуск определяет ПАРА профильных предметов ЕНТ, а список изучаемых
  // предметов на подбор не влияет — и это правильно: на специальность пускает
  // сданная пара, а не то, что человек изучал в школе.
  assert.deepEqual(
    after.profile.subjects,
    [],
    'очистка дошла до профиля и не откатилась при пересчёте',
  );
});

test('Снятие одной галочки убирает один предмет, остальные остаются', async () => {
  const owner = 'regress-subjects-one';

  await applyStep(owner, 'education', {
    subjects: service.parseAnswer(null, 'known', ['math', 'physics', 'informatics']),
  });

  await applyStep(owner, 'education', {
    subjects: service.parseAnswer(null, 'known', ['math', 'informatics']),
  });

  const after = await progress.loadSession(owner);
  assert.deepEqual(
    after.profile.subjects.map((s) => s.subjectId),
    ['math', 'informatics'],
  );
});

test('Правка другого шага не стирает нетронутый список предметов', async () => {
  const owner = 'regress-subjects-keep';

  await applyStep(owner, 'education', {
    subjects: service.parseAnswer(null, 'known', ['math', 'chemistry']),
  });

  // Шаг «Ресурсы» о предметах ничего не знает: их полей в форме нет вовсе.
  await applyStep(owner, 'resources', {
    weeklyHours: service.parseAnswer('15', 'known'),
  });

  const after = await progress.loadSession(owner);
  assert.deepEqual(
    after.profile.subjects.map((s) => s.subjectId),
    ['math', 'chemistry'],
    'нетронутое поле сохраняется',
  );
  assert.deepEqual(after.profile.weeklyHours, { state: 'known', value: 15 });
});

test('Разбор формы различает «не трогали» и «сняли всё»', () => {
  // Не множественный выбор с пустым значением — поле не заполнено.
  assert.deepEqual(service.parseAnswer('', 'known'), { state: 'unanswered' });
  // Множественный выбор с пустым списком — осознанный ответ.
  assert.deepEqual(service.parseAnswer(null, 'known', []), { state: 'answered', value: [] });
  // Поля вообще не было на форме — списка нет, ответа нет.
  assert.deepEqual(service.parseAnswer(null, null), { state: 'unanswered' });
});

/* ------------------------------------------------------------------ */
/* Баг 5. Первое заполнение — не «было → стало»                         */
/* ------------------------------------------------------------------ */

test('Первое заполнение помечается отдельно от правки существующего ответа', async () => {
  const owner = 'regress-first-fill';

  const first = await applyStep(owner, 'status', {
    admissionYear: service.parseAnswer('2027', 'known'),
  });

  const firstChange = first.summary.changes.find((c) => c.fieldId === 'admissionYear');
  assert.ok(firstChange, 'изменение поля попало в сводку');
  assert.equal(firstChange.firstTime, true, 'поле заполнено впервые');
  assert.equal(firstChange.after, '2027');

  const second = await applyStep(owner, 'status', {
    admissionYear: service.parseAnswer('2028', 'known'),
  });

  const secondChange = second.summary.changes.find((c) => c.fieldId === 'admissionYear');
  assert.ok(secondChange, 'правка тоже попала в сводку');
  assert.equal(secondChange.firstTime, false, 'прежний ответ был — это правка');
  assert.equal(secondChange.before, '2027');
  assert.equal(secondChange.after, '2028');
});

test('«Не знаю» — это ответ: его замена показывается как правка', async () => {
  const owner = 'regress-dont-know';

  const first = await applyStep(owner, 'resources', {
    weeklyHours: service.parseAnswer('', 'dont_know'),
  });
  assert.equal(
    first.summary.changes.find((c) => c.fieldId === 'weeklyHours')?.firstTime,
    true,
    'первый ответ по полю — впервые',
  );

  const second = await applyStep(owner, 'resources', {
    weeklyHours: service.parseAnswer('20', 'known'),
  });
  const change = second.summary.changes.find((c) => c.fieldId === 'weeklyHours');
  assert.equal(change?.firstTime, false, '«не знаю» был ответом, теперь его меняют');
  assert.equal(change?.before, 'не знаю');
});

/* ------------------------------------------------------------------ */
/* Совместимость: сводка, записанная до появления firstTime            */
/* ------------------------------------------------------------------ */

test('Старая сводка на диске читается с досчитанным firstTime и не переписывается', async () => {
  const owner = 'regress-legacy-recalc';
  const file = path.join(dataDir, `${owner}.json`);

  // Файл прежней версии: у изменений нет `firstTime`, профиль и прогресс пусты.
  const stored = {
    ownerId: owner,
    profileRevisions: [],
    progress: {},
    ledger: [],
    audit: [],
    outbox: [],
    draft: null,
    activeGoalId: null,
    lastRecalc: {
      at: AT,
      profileRevisionBefore: 1,
      profileRevisionAfter: 2,
      changes: [
        { fieldId: 'admissionYear', label: 'Год поступления', before: 'не заполнено', after: '2027' },
        { fieldId: 'gpa', label: 'Средний балл', before: 'не знаю', after: '4.6' },
      ],
      fitBefore: 0, fitAfter: 1,
      alternativesBefore: 0, alternativesAfter: 0,
      topBefore: null, topAfter: null,
      activeGoalTitle: null, activeGoalStillFits: null, activeGoalNote: null,
      tasksBefore: 0, tasksAfter: 3,
      nextActionBefore: null, nextActionAfter: 'Сдать ЕНТ',
      notes: [],
    },
  };
  const raw = JSON.stringify(stored, null, 2);
  await writeFile(file, raw, 'utf8');

  const state = await getStore().read(owner);

  assert.equal(state.lastRecalc?.changes[0]?.firstTime, true, 'первое заполнение распознано');
  assert.equal(state.lastRecalc?.changes[1]?.firstTime, false, '«не знаю» был ответом');
  assert.equal(state.lastRecalc?.profileRevisionAfter, 2, 'ревизия сводки не тронута');

  // Миграция не создаёт ревизий и вообще ничего не пишет на диск.
  assert.deepEqual(state.profileRevisions, [], 'профиль не появился');
  assert.equal(await readFile(file, 'utf8'), raw, 'файл на диске не изменился');
});
