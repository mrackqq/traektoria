/**
 * Поведение AI-слоя в плохих условиях.
 *
 * Проверяется не «модель хорошо пишет», а то, что продукт остаётся честным
 * и работающим, когда модель недоступна, молчит, отвечает мусором или
 * пытается сказать лишнее. Ни один тест здесь не ходит в сеть по-настоящему:
 * `fetch` подменяется, поэтому прогон бесплатный и воспроизводимый.
 *
 * Запуск: npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildDemoProfile } from '@core/demo/profile';
import { buildSession, DEMO_CLOCK } from '@core/demo/session';

import { adviceCacheKey, clearAdviceCache, getAdvice, humanizeIdentifiers } from './advisor.ts';
import { buildAdviceContext } from './context.ts';
import { adviceSchema } from './schema.ts';

const AT = DEMO_CLOCK.now;
/** Часы тестов совпадают с часами расчёта: иначе кеш истекает мгновенно. */
const AT_MS = Date.parse(AT);
const OWNER = 'test-owner';

function session(profile = buildDemoProfile(AT, OWNER), nowIso = AT) {
  return buildSession({ profile, clock: { ...DEMO_CLOCK, now: nowIso } });
}

/**
 * Счётчик реальных обращений к модели.
 *
 * Справочный вызов `/models` не считается: он бесплатный и кешируется
 * отдельно. Нас интересует число платных запросов на completions.
 */
function countingFetch(payloadFor: () => unknown) {
  const calls = { completions: 0 };
  const restore = mockFetch((url) => {
    if (url.includes('/models')) return jsonResponse({ data: [] });
    calls.completions++;
    return completion(payloadFor());
  });
  return { calls, restore };
}

/** Корректный ответ модели для подменённого fetch. */
function validPayload(pathId: string, taskId: string) {
  return {
    profileSummary: {
      headline: 'Вы в 11 классе и идёте на компьютерные науки в Казахстане.',
      strengths: ['Средний балл 4.6 выше порога большинства программ.'],
      limits: ['Языкового сертификата пока нет.'],
      focus: 'Сначала закройте языковое требование, оно открывает больше вариантов.',
    },
    programExplanations: [
      {
        pathId,
        why: 'Программа совпадает с вашим направлением и бюджетом.',
        tradeoff: 'Кампус за городом.',
        factRefs: [],
      },
    ],
    comparison: {
      summary: 'Варианты отличаются стоимостью и языком обучения.',
      tradeoffs: ['Дешевле — дальше от дома.'],
    },
    taskGuidance: [
      {
        taskId,
        howTo: 'Дождитесь публикации результата и отметьте его в маршруте.',
        watchOut: 'Не пропустите срок подачи.',
        factRefs: [],
      },
    ],
    nextAction: {
      what: 'Дождаться результата ЕНТ.',
      why: 'Это внешнее ожидание, оно блокирует подачу заявления.',
      firstStep: 'Проверьте личный кабинет тестирования.',
      factRefs: [],
    },
  };
}

/**
 * Подмена fetch.
 *
 * Сигнал отмены обрабатывается так же, как настоящим fetch: иначе тест
 * таймаута висел бы вечно, потому что обработчик просто не отвечает.
 */
function mockFetch(handler: (url: string, body?: string) => Promise<Response> | Response) {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const signal = init?.signal;
    const body = typeof init?.body === 'string' ? init.body : undefined;
    return new Promise<Response>((resolve, reject) => {
      const abort = () => {
        const error = new Error('The operation was aborted.');
        error.name = 'AbortError';
        reject(error);
      };
      if (signal?.aborted) return abort();
      signal?.addEventListener('abort', abort, { once: true });
      Promise.resolve(handler(String(input), body)).then(resolve, reject);
    });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function completion(content: unknown): Response {
  return jsonResponse({
    choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }],
  });
}

function withKey<T>(fn: () => T): T {
  const previous = process.env.OPENROUTER_API_KEY;
  // Значение синтетическое: настоящий ключ в тестах не нужен и не читается.
  process.env.OPENROUTER_API_KEY = 'test-key-not-a-real-secret';
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previous;
  }
}

test.beforeEach(() => clearAdviceCache());

test('Без ключа продукт работает и честно называет режим', async () => {
  const previous = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;

  try {
    const advice = await getAdvice(OWNER, session());
    assert.equal(advice.mode, 'rules');
    assert.equal(advice.fallbackCode, 'DISABLED');
    assert.match(advice.fallbackReason ?? '', /не настроен/i);
    assert.equal(advice.advice, null);
  } finally {
    if (previous !== undefined) process.env.OPENROUTER_API_KEY = previous;
  }
});

test('Таймаут не ломает страницу: показываются объяснения по правилам', async () => {
  const restore = mockFetch(
    (url) =>
      url.includes('/models')
        ? jsonResponse({ data: [] })
        : new Promise<Response>(() => {
            // Ответ не приходит никогда: ждём срабатывания таймаута.
          }),
  );

  try {
    const advice = await withKey(() => getAdvice(OWNER, session(), { timeoutMs: 1000 }));
    assert.equal(advice.mode, 'rules');
    assert.equal(advice.fallbackCode, 'TIMEOUT');
    assert.match(advice.fallbackReason ?? '', /по правилам/i);
  } finally {
    restore();
  }
});

test('Ошибка HTTP не выдаётся за ответ модели', async () => {
  const restore = mockFetch((url) =>
    url.includes('/models') ? jsonResponse({ data: [] }) : jsonResponse({ error: 'nope' }, 500),
  );

  try {
    const advice = await withKey(() => getAdvice(OWNER, session()));
    assert.equal(advice.mode, 'rules');
    assert.equal(advice.fallbackCode, 'HTTP_ERROR');
    // Статус — единственное, что попадает в текст: тело ответа не пересказываем.
    assert.match(advice.fallbackReason ?? '', /500/);
  } finally {
    restore();
  }
});

test('Ответ не по схеме отбрасывается целиком', async () => {
  const restore = mockFetch((url) =>
    url.includes('/models')
      ? jsonResponse({ data: [] })
      : completion({ profileSummary: { headline: 'без остальных полей' } }),
  );

  try {
    const advice = await withKey(() => getAdvice(OWNER, session()));
    assert.equal(advice.mode, 'rules');
    assert.equal(advice.fallbackCode, 'INVALID_SHAPE');
    assert.equal(advice.advice, null);
  } finally {
    restore();
  }
});

test('Невалидный JSON не принимается', async () => {
  const restore = mockFetch((url) =>
    url.includes('/models') ? jsonResponse({ data: [] }) : completion('это не json'),
  );

  try {
    const advice = await withKey(() => getAdvice(OWNER, session()));
    assert.equal(advice.mode, 'rules');
    assert.equal(advice.fallbackCode, 'BAD_JSON');
  } finally {
    restore();
  }
});

test('Корректный ответ принимается и попадает в кеш', async () => {
  const s = session();
  const pathId = s.goals[0]!.path.id;
  const taskId = s.taskViews[0]!.task.id;

  let calls = 0;
  const restore = mockFetch((url) => {
    if (url.includes('/models')) return jsonResponse({ data: [] });
    calls++;
    return completion(validPayload(pathId, taskId));
  });

  try {
    const first = await withKey(() => getAdvice(OWNER, s, { nowMs: AT_MS }));
    assert.equal(first.mode, 'ai');
    assert.equal(first.cached, false);
    assert.ok(first.advice);
    assert.equal(first.advice?.programExplanations[0]?.pathId, pathId);

    // Второй переход по страницам не делает нового платного запроса.
    const second = await withKey(() => getAdvice(OWNER, s, { nowMs: AT_MS }));
    assert.equal(second.mode, 'ai');
    assert.equal(second.cached, true);
    assert.equal(calls, 1, 'повторный показ берётся из кеша');
  } finally {
    restore();
  }
});

test('Выдуманные идентификаторы программ и задач отбрасываются', async () => {
  const s = session();
  const restore = mockFetch((url) => {
    if (url.includes('/models')) return jsonResponse({ data: [] });
    return completion(validPayload('нет-такой-программы', 'task:нет-такой-задачи'));
  });

  try {
    const advice = await withKey(() => getAdvice(OWNER, s));
    assert.equal(advice.mode, 'ai');
    assert.deepEqual(advice.advice?.programExplanations, [], 'чужая программа не показывается');
    assert.deepEqual(advice.advice?.taskGuidance, [], 'чужая задача не показывается');
    assert.ok(advice.warnings.length >= 2, 'отбрасывание проговаривается');
  } finally {
    restore();
  }
});

test('Обещания поступления и проценты шансов вырезаются', async () => {
  const s = session();
  const pathId = s.goals[0]!.path.id;
  const taskId = s.taskViews[0]!.task.id;

  const payload = validPayload(pathId, taskId);
  payload.profileSummary.strengths = ['Ваши шансы на поступление около 85%.'];
  payload.programExplanations[0]!.why = 'Мы гарантируем зачисление на эту программу.';

  const restore = mockFetch((url) =>
    url.includes('/models') ? jsonResponse({ data: [] }) : completion(payload),
  );

  try {
    const advice = await withKey(() => getAdvice(OWNER, s));
    assert.equal(advice.mode, 'ai');
    assert.deepEqual(advice.advice?.profileSummary.strengths, [], 'процент шансов не показывается');
    assert.deepEqual(advice.advice?.programExplanations, [], 'гарантия не показывается');
    assert.ok(
      advice.warnings.some((w) => /вероятност|обещание зачисления/i.test(w)),
      'убранное проговаривается пользователю',
    );
  } finally {
    restore();
  }
});

test('Изменение ответа анкеты делает прежний ответ модели неактуальным', () => {
  const base = buildDemoProfile(AT, OWNER);
  const before = buildSession({ profile: base, clock: DEMO_CLOCK });

  // Меняем ключевой ответ: бюджет вдвое меньше.
  const budget = base.budget.state === 'known' ? base.budget.value : null;
  assert.ok(budget);
  const changed = buildSession({
    profile: {
      ...base,
      revision: base.revision + 1,
      id: `${OWNER}-r2`,
      budget: {
        state: 'known',
        value: { ...budget, limit: { ...budget.limit, amountMinor: budget.limit.amountMinor / 2n } },
      },
    },
    clock: DEMO_CLOCK,
  });

  assert.notEqual(
    adviceCacheKey(OWNER, before),
    adviceCacheKey(OWNER, changed),
    'после изменения профиля прежний текст не найдётся по ключу кеша',
  );
});

test('Данные двух посетителей не перемешиваются в кеше', () => {
  const s = session();
  assert.notEqual(adviceCacheKey('user-a', s), adviceCacheKey('user-b', s));
});

test('Служебные идентификаторы заменяются человеческими названиями', () => {
  const titles = new Map([
    ['sdu-cs-2027-paid', 'Компьютерные науки — «Сулейман», платное обучение'],
    ['task:doc:school_certificate', 'Получить аттестат'],
  ]);

  const cleaned = humanizeIdentifiers(
    'Программы в Казахстане (sdu-cs-2027-paid) требуют task:doc:school_certificate.',
    titles,
  );

  assert.ok(!cleaned.includes('sdu-cs-2027-paid'), 'идентификатор программы не остаётся в тексте');
  assert.ok(!cleaned.includes('task:doc'), 'идентификатор задачи не остаётся в тексте');
  assert.match(cleaned, /Сулейман/);
  assert.match(cleaned, /Получить аттестат/);
});

/* ------------------------------------------------------------------ */
/* Стабильность кеша                                                   */
/* ------------------------------------------------------------------ */

test('Неизменный профиль на двух близких моментах времени даёт один запрос', async () => {
  const profile = buildDemoProfile(AT, OWNER);
  const morning = session(profile, '2026-09-18T06:00:00.000Z');
  const minuteLater = session(profile, '2026-09-18T06:01:00.000Z');

  // Каталог внутри периода обновления тот же, значит и отпечаток входа тот же.
  assert.equal(morning.key.inputHash, minuteLater.key.inputHash);
  assert.equal(adviceCacheKey(OWNER, morning), adviceCacheKey(OWNER, minuteLater));

  const pathId = morning.goals[0]!.path.id;
  const taskId = morning.taskViews[0]!.task.id;
  const { calls, restore } = countingFetch(() => validPayload(pathId, taskId));

  try {
    const first = await withKey(() => getAdvice(OWNER, morning, { nowMs: AT_MS }));
    const second = await withKey(() => getAdvice(OWNER, minuteLater, { nowMs: AT_MS }));

    assert.equal(first.mode, 'ai');
    assert.equal(second.mode, 'ai');
    assert.equal(second.cached, true, 'второй переход берёт ответ из кеша');
    assert.equal(calls.completions, 1, 'платный запрос сделан ровно один раз');
  } finally {
    restore();
  }
});

test('Новый период обновления каталога даёт новый результат', () => {
  const profile = buildDemoProfile(AT, OWNER);
  const today = session(profile, '2026-09-18T06:00:00.000Z');
  const tomorrow = session(profile, '2026-09-19T06:00:00.000Z');

  assert.notEqual(today.catalog.version, tomorrow.catalog.version);
  assert.notEqual(adviceCacheKey(OWNER, today), adviceCacheKey(OWNER, tomorrow));
});

test('Смена цели и смена прогресса дают разные ключи', () => {
  const profile = buildDemoProfile(AT, OWNER);
  const base = buildSession({ profile, clock: DEMO_CLOCK });

  const other = base.goals.find((g) => g.path.id !== base.activeGoal?.path.id);
  assert.ok(other, 'в каталоге есть вторая цель');
  const switched = buildSession({ profile, clock: DEMO_CLOCK, activePathId: other.path.id });
  assert.notEqual(adviceCacheKey(OWNER, base), adviceCacheKey(OWNER, switched));

  const advanced = buildSession({
    profile,
    clock: DEMO_CLOCK,
    progress: { ...base.progress, revision: base.progress.revision + 1 },
  });
  assert.notEqual(adviceCacheKey(OWNER, base), adviceCacheKey(OWNER, advanced));
});

test('Срок кеша ограничен годностью самого расчёта', async () => {
  const s = session();
  const pathId = s.goals[0]!.path.id;
  const taskId = s.taskViews[0]!.task.id;
  const { calls, restore } = countingFetch(() => validPayload(pathId, taskId));

  // Расчёт объявляет собственный срок годности: объяснять устаревший расчёт
  // нельзя, даже если текст модели ещё «свежий».
  const validUntil = Date.parse(s.key.validUntil);
  assert.ok(validUntil > AT_MS, 'расчёт годен хотя бы какое-то время');

  try {
    await withKey(() => getAdvice(OWNER, s, { nowMs: AT_MS }));
    assert.equal(calls.completions, 1);

    const still = await withKey(() => getAdvice(OWNER, s, { nowMs: validUntil - 1000 }));
    assert.equal(still.cached, true, 'пока расчёт годен, ответ берётся из кеша');
    assert.equal(calls.completions, 1);

    const after = await withKey(() => getAdvice(OWNER, s, { nowMs: validUntil + 1000 }));
    assert.equal(after.cached, false, 'после истечения годности расчёта ответ пересчитывается');
    assert.equal(calls.completions, 2);
  } finally {
    restore();
  }
});

test('Разные посетители не читают чужой ответ', async () => {
  const s = session();
  const pathId = s.goals[0]!.path.id;
  const taskId = s.taskViews[0]!.task.id;
  const { calls, restore } = countingFetch(() => validPayload(pathId, taskId));

  try {
    const a = await withKey(() => getAdvice('user-a', s, { nowMs: AT_MS }));
    const b = await withKey(() => getAdvice('user-b', s, { nowMs: AT_MS }));

    assert.equal(a.cached, false);
    assert.equal(b.cached, false, 'второй посетитель не получает чужой кеш');
    assert.equal(calls.completions, 2);
  } finally {
    restore();
  }
});

test('Одинаковые параллельные запросы объединяются в один', async () => {
  const s = session();
  const pathId = s.goals[0]!.path.id;
  const taskId = s.taskViews[0]!.task.id;

  // Тип пишем явно: TypeScript сужает присвоенную в колбэке переменную до never.
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  let completions = 0;
  const restore = mockFetch(async (url) => {
    if (url.includes('/models')) return jsonResponse({ data: [] });
    completions++;
    await gate;
    return completion(validPayload(pathId, taskId));
  });

  try {
    const both = Promise.all([
      withKey(() => getAdvice(OWNER, s, { nowMs: AT_MS })),
      withKey(() => getAdvice(OWNER, s, { nowMs: AT_MS })),
    ]);
    // Обе страницы уже ушли в ожидание — только теперь отпускаем ответ.
    await new Promise((r) => setTimeout(r, 40));
    release();

    const [first, second] = await both;
    assert.equal(first.mode, 'ai');
    assert.equal(second.mode, 'ai');
    assert.equal(completions, 1, 'два параллельных рендера дали один платный запрос');
  } finally {
    restore();
  }
});

/* ------------------------------------------------------------------ */
/* Сравнение выбранных вариантов                                       */
/* ------------------------------------------------------------------ */

test('Выбранная пара уходит в модель и попадает в ключ', async () => {
  const s = session();
  const pair = s.goals.slice(0, 2).map((g) => g.path.id);
  const otherPair = [s.goals[0]!.path.id, s.goals[2]!.path.id];

  assert.notEqual(
    adviceCacheKey(OWNER, s, pair),
    adviceCacheKey(OWNER, s, otherPair),
    'другая пара — другой ключ',
  );
  assert.equal(
    adviceCacheKey(OWNER, s, pair),
    adviceCacheKey(OWNER, s, [...pair].reverse()),
    'порядок галочек значения не имеет',
  );
  assert.notEqual(
    adviceCacheKey(OWNER, s, pair),
    adviceCacheKey(OWNER, s),
    'сравнение пары отличается от общего пояснения',
  );

  let sent = '';
  const restore = mockFetch(async (url, body) => {
    if (url.includes('/models')) return jsonResponse({ data: [] });
    sent = body ?? '';
    return completion(validPayload(pair[0]!, s.taskViews[0]!.task.id));
  });

  try {
    await withKey(() => getAdvice(OWNER, s, { focusPathIds: pair }));
    for (const id of pair) {
      assert.ok(sent.includes(id), 'выбранный вариант передан модели: ' + id);
    }
    assert.match(sent, /выбрал для сравнения/i);
  } finally {
    restore();
  }
});

test('Повторный запрос той же пары берётся из кеша', async () => {
  const s = session();
  const pair = s.goals.slice(0, 2).map((g) => g.path.id);
  const { calls, restore } = countingFetch(() =>
    validPayload(pair[0]!, s.taskViews[0]!.task.id),
  );

  try {
    const first = await withKey(() => getAdvice(OWNER, s, { focusPathIds: pair, nowMs: AT_MS }));
    const second = await withKey(() => getAdvice(OWNER, s, { focusPathIds: [...pair].reverse(), nowMs: AT_MS }));

    assert.equal(first.cached, false);
    assert.equal(second.cached, true);
    assert.equal(calls.completions, 1);
  } finally {
    restore();
  }
});

test('Выбранный вариант вне общего топа не теряется', async () => {
  const s = session();
  // Заведомо не первый вариант: сам по себе он в контекст не попал бы.
  const outsider = s.goals[s.goals.length - 1]!.path.id;
  const top = s.goals[0]!.path.id;

  const context = buildAdviceContext(s, [outsider, top]);
  assert.ok(
    context.allowedPathIds.includes(outsider),
    'вариант вне топа добавлен в контекст принудительно',
  );
  assert.deepEqual([...context.focusPathIds].sort(), [outsider, top].sort());

  let sent = '';
  const restore = mockFetch(async (url, body) => {
    if (url.includes('/models')) return jsonResponse({ data: [] });
    sent = body ?? '';
    return completion(validPayload(outsider, s.taskViews[0]!.task.id));
  });

  try {
    const advice = await withKey(() => getAdvice(OWNER, s, { focusPathIds: [outsider, top] }));
    assert.ok(sent.includes(outsider), 'вариант вне топа передан модели');
    assert.equal(
      advice.advice?.programExplanations[0]?.pathId,
      outsider,
      'объяснение по нему принято, а не отброшено как чужое',
    );
  } finally {
    restore();
  }
});

test('Неизвестный идентификатор выбора не принимается', async () => {
  const s = session();
  const real = s.goals[0]!.path.id;

  let sent = '';
  const restore = mockFetch(async (url, body) => {
    if (url.includes('/models')) return jsonResponse({ data: [] });
    sent = body ?? '';
    return completion(validPayload(real, s.taskViews[0]!.task.id));
  });

  try {
    await withKey(() => getAdvice(OWNER, s, { focusPathIds: ['нет-такого-пути', real] }));
    assert.ok(!sent.includes('нет-такого-пути'), 'выдуманный идентификатор не уходит в модель');
    assert.ok(sent.includes(real));
  } finally {
    restore();
  }
});

test('Схема ответа не содержит полей для числовых прогнозов', () => {
  const shape = adviceSchema.shape;
  const serialized = JSON.stringify(Object.keys(shape));
  assert.ok(!/chance|probability|score|percent/i.test(serialized));
});

/* ------------------------------------------------------------------ */
/* Поведение при недоступном провайдере                                */
/* ------------------------------------------------------------------ */

test('Недоступный провайдер не превращается в шторм запросов', async () => {
  // Пока неудачи не запоминались вовсе, лежащий OpenRouter означал новый
  // сетевой вызов на КАЖДУЮ загрузку страницы: каждый переход между
  // разделами, каждое обновление и каждый параллельный посетитель заново
  // ждали таймаут — ровно в тот момент, когда провайдер просит сбавить темп.
  clearAdviceCache();
  process.env.OPENROUTER_API_KEY = 'тестовый-ключ';

  let completions = 0;
  const restore = mockFetch((url) => {
    if (url.includes('/models')) return jsonResponse({ data: [] });
    completions++;
    throw new Error('провайдер недоступен');
  });

  try {
    const s = session();
    for (let i = 0; i < 6; i++) {
      const r = await getAdvice(OWNER, s, { nowMs: AT_MS + i * 1000 });
      assert.equal(r.mode, 'rules', 'расчёт по правилам обязан показываться при любой неудаче');
    }

    assert.equal(completions, 1, `шесть загрузок страницы дали ${completions} обращений к модели`);
  } finally {
    restore();
  }
});

test('Пауза после неудачи — именно пауза, а не отключение AI', async () => {
  clearAdviceCache();
  process.env.OPENROUTER_API_KEY = 'тестовый-ключ';

  let completions = 0;
  const restore = mockFetch((url) => {
    if (url.includes('/models')) return jsonResponse({ data: [] });
    completions++;
    throw new Error('провайдер недоступен');
  });

  try {
    const s = session();
    await getAdvice(OWNER, s, { nowMs: AT_MS });
    await getAdvice(OWNER, s, { nowMs: AT_MS + 30_000 });
    assert.equal(completions, 1, 'внутри окна паузы повтора быть не должно');

    await getAdvice(OWNER, s, { nowMs: AT_MS + 61_000 });
    assert.equal(completions, 2, 'за окном попытка обязана повториться');
  } finally {
    restore();
  }
});

test('Неудача не вытесняет удачный ответ другого расчёта', async () => {
  clearAdviceCache();
  process.env.OPENROUTER_API_KEY = 'тестовый-ключ';

  const s = session();
  const goalId = s.activeGoal!.path.id;
  const taskId = s.route!.tasks[0]!.id;

  let ok = mockFetch((url) =>
    url.includes('/models') ? jsonResponse({ data: [] }) : completion(validPayload(goalId, taskId)),
  );
  const good = await getAdvice(OWNER, s, { nowMs: AT_MS });
  ok();
  assert.equal(good.mode, 'ai');

  // Другой посетитель с недоступным провайдером не должен испортить
  // уже сохранённый ответ первого.
  const fail = mockFetch((url) => {
    if (url.includes('/models')) return jsonResponse({ data: [] });
    throw new Error('недоступен');
  });
  await getAdvice('другой-владелец', s, { nowMs: AT_MS + 1000 });
  fail();

  const stillOk = mockFetch(() => {
    throw new Error('сюда ходить не должны');
  });
  const again = await getAdvice(OWNER, s, { nowMs: AT_MS + 2000 });
  stillOk();

  assert.equal(again.mode, 'ai', 'кеш первого владельца обязан пережить чужую неудачу');
  assert.equal(again.cached, true);
});
