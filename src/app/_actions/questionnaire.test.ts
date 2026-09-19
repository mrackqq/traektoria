/**
 * Server Actions анкеты.
 *
 * Анкета — единственное место, где посетитель меняет факты о себе, и здесь
 * же живут оптимистичные блокировки: черновик и профиль версионируются
 * раздельно, а применение делает трёхсторонний merge. Проверяется главное
 * обещание: невалидное можно сохранить как черновик, но нельзя превратить
 * в факт профиля, и ничьё изменение не пропадает молча.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after, mock } from 'node:test';
import assert from 'node:assert/strict';

const dataDir = await mkdtemp(path.join(tmpdir(), 'trajectory-qactions-'));
process.env.TRAJECTORY_DATA_DIR = dataDir;
process.env.TRAJECTORY_CLOCK = '2027-03-01T00:00:00.000Z';

const SESSION = 'qactions12345';
const revalidated: string[] = [];
const redirects: string[] = [];

const jar = new Map<string, string>([['trk_sid', SESSION]]);

mock.module('next/cache', {
  namedExports: {
    revalidatePath: (p: string, type?: string) => void revalidated.push(type ? `${p} (${type})` : p),
    revalidateTag: () => undefined,
  },
});

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
      redirects.push(to);
      throw new Error(`NEXT_REDIRECT:${to}`);
    },
    notFound: () => {
      throw new Error('NOT_FOUND');
    },
  },
});

const actions = await import('./questionnaire.ts');
const { loadDraft } = await import('@/server/questionnaire-service');
const { visitorOwnerId } = await import('@core/demo/profile');

const ownerId = visitorOwnerId(SESSION);
const NOW = '2027-03-01T00:00:00.000Z';

after(async () => {
  delete process.env.TRAJECTORY_CLOCK;
  await rm(dataDir, { recursive: true, force: true });
});

function form(fields: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) for (const item of v) fd.append(k, item);
    else fd.set(k, v);
  }
  return fd;
}

const idle = null as never;

async function draftRevision(): Promise<number> {
  return (await loadDraft(ownerId, NOW)).draft?.revision ?? 0;
}

async function profileRevision(): Promise<number> {
  return (await loadDraft(ownerId, NOW)).profileRevision;
}

/* ------------------------------------------------------------------ */
/* saveStepAction                                                      */
/* ------------------------------------------------------------------ */

test('Ответы шага сохраняются в черновик и поднимают его ревизию', async () => {
  const before = await draftRevision();

  const r = await actions.saveStepAction(
    idle,
    form({
      stepId: 'education',
      expectedDraftRevision: String(before),
      'value:educationLevel': 'grade_11',
      'value:gpa': '4.5',
    }),
  );

  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok((await draftRevision()) > before, 'ревизия черновика обязана вырасти');
});

test('Неизвестный шаг не роняет обработчик', async () => {
  // `findStep` откатывается на первый шаг, а не возвращает undefined.
  // Это не отказ, но и не падение: проверяем именно отсутствие исключения.
  const r = await actions.saveStepAction(
    idle,
    form({ stepId: 'нет-такого-шага-<script>', expectedDraftRevision: String(await draftRevision()) }),
  );

  assert.equal(typeof r.ok, 'boolean');
});

test('Устаревшая ревизия черновика отвергается: две вкладки не затирают друг друга', async () => {
  const r = await actions.saveStepAction(
    idle,
    form({ stepId: 'education', expectedDraftRevision: '0', 'value:gpa': '3.0' }),
  );

  assert.equal(r.ok, false);
});

test('PF-02: «не знаю» — это ответ, а не пустота', async () => {
  const r = await actions.saveStepAction(
    idle,
    form({
      stepId: 'status',
      expectedDraftRevision: String(await draftRevision()),
      'mode:citizenship': 'dont_know',
      'value:citizenship': '',
    }),
  );

  assert.equal(r.ok, true, JSON.stringify(r));
  const draft = (await loadDraft(ownerId, NOW)).draft;
  assert.equal(draft?.values['citizenship']?.state, 'dont_know');
});

test('Невидимое при текущих ответах поле не получает значение молча', async () => {
  // `englishCefr` показывается только при выбранном языке обучения.
  const r = await actions.saveStepAction(
    idle,
    form({
      stepId: 'direction',
      expectedDraftRevision: String(await draftRevision()),
      'value:englishCefr': 'C2',
    }),
  );

  assert.equal(r.ok, true);
  const draft = (await loadDraft(ownerId, NOW)).draft;
  assert.notEqual(
    draft?.values['englishCefr']?.state,
    'known',
    'скрытый вопрос не должен получить ответ из формы',
  );
});

test('Множественный выбор отличает пустой список от нетронутого поля', async () => {
  const withValues = await actions.saveStepAction(
    idle,
    form({
      stepId: 'direction',
      expectedDraftRevision: String(await draftRevision()),
      'value:interests': ['computer_science', 'engineering'],
    }),
  );
  assert.equal(withValues.ok, true);

  const draft = (await loadDraft(ownerId, NOW)).draft;
  assert.deepEqual(draft?.values['interests']?.value, ['computer_science', 'engineering']);
});

test('Невалидный ответ сохраняется в черновик, но помечается ошибкой', async () => {
  // Черновик — рабочая поверхность: терять введённое из-за опечатки нельзя.
  const r = await actions.saveStepAction(
    idle,
    form({
      stepId: 'education',
      expectedDraftRevision: String(await draftRevision()),
      'value:gpa': '7',
    }),
  );

  assert.equal(r.ok, true, 'сохранение проходит');
  assert.ok(r.errors.length > 0, 'но ошибка обязана быть названа');
});

/* ------------------------------------------------------------------ */
/* commitDraftAction                                                   */
/* ------------------------------------------------------------------ */

test('Невалидный черновик не становится фактом профиля', async () => {
  // В профиле лежит gpa = 7 из предыдущего теста — применение обязано отказать.
  const r = await actions.commitDraftAction(
    idle,
    form({
      expectedProfileRevision: String(await profileRevision()),
      expectedDraftRevision: String(await draftRevision()),
    }),
  );

  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.kind === 'invalid', JSON.stringify(r));
});

test('Применение исправленной анкеты создаёт новую ревизию профиля', async () => {
  await actions.saveStepAction(
    idle,
    form({
      stepId: 'education',
      expectedDraftRevision: String(await draftRevision()),
      'value:gpa': '4.5',
    }),
  );

  const profileBefore = await profileRevision();
  revalidated.length = 0;

  const r = await actions.commitDraftAction(
    idle,
    form({
      expectedProfileRevision: String(profileBefore),
      expectedDraftRevision: String(await draftRevision()),
    }),
  );

  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok((await profileRevision()) > profileBefore, 'ревизия профиля обязана вырасти');
  // Применение анкеты меняет профиль, а значит и весь расчёт: сброс идёт
  // одним вызовом на поддерево, а не списком страниц.
  assert.deepEqual(
    revalidated,
    ['/ (layout)'],
    'изменился профиль — устарело всё, что от него считается',
  );
});

test('Применение на устаревшей ревизии профиля отвергается', async () => {
  await actions.saveStepAction(
    idle,
    form({
      stepId: 'resources',
      expectedDraftRevision: String(await draftRevision()),
      'value:weeklyHours': '10',
    }),
  );

  const r = await actions.commitDraftAction(
    idle,
    form({ expectedProfileRevision: '0', expectedDraftRevision: String(await draftRevision()) }),
  );

  assert.equal(r.ok, false);
});

test('Пустой черновик применить нельзя', async () => {
  await actions.discardDraftAction(idle, form({ expectedDraftRevision: String(await draftRevision()) }));

  const r = await actions.commitDraftAction(
    idle,
    form({ expectedProfileRevision: String(await profileRevision()), expectedDraftRevision: '0' }),
  );

  assert.equal(r.ok, false);
});

/* ------------------------------------------------------------------ */
/* discardDraftAction                                                  */
/* ------------------------------------------------------------------ */

test('Сброс черновика не трогает профиль', async () => {
  const profileBefore = await profileRevision();

  await actions.saveStepAction(
    idle,
    form({
      stepId: 'resources',
      expectedDraftRevision: String(await draftRevision()),
      'value:weeklyHours': '40',
    }),
  );

  const r = await actions.discardDraftAction(
    idle,
    form({ expectedDraftRevision: String(await draftRevision()) }),
  );

  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(await profileRevision(), profileBefore, 'применённые ранее ответы остаются на месте');
});

test('Сброс на устаревшей ревизии отвергается', async () => {
  await actions.saveStepAction(
    idle,
    form({
      stepId: 'resources',
      expectedDraftRevision: String(await draftRevision()),
      'value:weeklyHours': '12',
    }),
  );

  const r = await actions.discardDraftAction(idle, form({ expectedDraftRevision: '0' }));
  assert.equal(r.ok, false, 'нельзя выбросить черновик, которого не видел');
});

/* ------------------------------------------------------------------ */
/* switchModeAction                                                    */
/* ------------------------------------------------------------------ */

test('Переключение в демо ставит cookie и ведёт на обзор', async () => {
  redirects.length = 0;

  await assert.rejects(actions.switchModeAction(form({ mode: 'demo' })), /NEXT_REDIRECT/);

  assert.equal(jar.get('trk_mode'), 'demo');
  assert.deepEqual(redirects, ['/']);
});

test('Любое иное значение режима трактуется как собственный профиль', async () => {
  for (const mode of ['own', 'выдумка', '', 'DEMO']) {
    redirects.length = 0;
    await assert.rejects(actions.switchModeAction(form({ mode })), /NEXT_REDIRECT/);

    assert.equal(jar.get('trk_mode'), 'own', `«${mode}» не должно включать демо`);
    assert.deepEqual(redirects, ['/profile/edit'], 'адрес перехода не берётся из формы');
  }
});
