/**
 * Транспорт к модели.
 *
 * Ни один исход сетевого вызова не имеет права стать исключением: страница
 * обязана открыться с расчётом по правилам при любом поведении провайдера.
 * Поэтому здесь перебираются именно отказы — таймаут, лимит, битый ответ.
 */

import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { chatJson, parseJsonContent, supportsStructuredOutput } from './openrouter.ts';

const realFetch = globalThis.fetch;
const savedKey = process.env.OPENROUTER_API_KEY;

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = 'тестовый-ключ';
});

afterEach(() => {
  globalThis.fetch = realFetch;
  if (savedKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = savedKey;
});

const request = {
  messages: [{ role: 'user' as const, content: 'привет' }],
  jsonSchema: { name: 'advice', schema: { type: 'object' } } as never,
};

/** Ответ провайдера с заданным телом и кодом. */
function respondWith(status: number, body: unknown): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
}

const chatBody = (content: string) => ({
  model: 'test/model',
  choices: [{ message: { content } }],
});

/* ------------------------------------------------------------------ */
/* Разбор содержимого                                                  */
/* ------------------------------------------------------------------ */

test('Чистый JSON разбирается', () => {
  const r = parseJsonContent('{"a":1}');
  assert.ok(r.ok);
  assert.deepEqual(r.value, { a: 1 });
});

test('Ограждения кода снимаются', () => {
  for (const wrapped of ['```json\n{"a":1}\n```', '```\n{"a":1}\n```', '  ```json {"a":1} ```  ']) {
    const r = parseJsonContent(wrapped);
    assert.ok(r.ok, `не разобрано: ${wrapped}`);
    assert.deepEqual(r.value, { a: 1 });
  }
});

test('Битый JSON даёт отказ, а не исключение', () => {
  for (const bad of ['', 'не json', '{"a":', '```json\n{"a":\n```']) {
    const r = parseJsonContent(bad);
    assert.equal(r.ok, false, `«${bad}» должно быть отвергнуто`);
    assert.ok(!r.ok && r.code === 'BAD_JSON');
  }
});

/* ------------------------------------------------------------------ */
/* Отказы транспорта                                                   */
/* ------------------------------------------------------------------ */

test('Без ключа сеть вообще не трогается', async () => {
  delete process.env.OPENROUTER_API_KEY;
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return new Response('{}');
  }) as typeof fetch;

  const r = await chatJson(request);

  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.code === 'NO_API_KEY');
  assert.equal(called, false, 'запрос без ключа бессмыслен и не должен уходить');
});

test('Ошибка сети не всплывает исключением', async () => {
  globalThis.fetch = (async () => {
    throw new Error('соединение разорвано');
  }) as typeof fetch;

  const r = await chatJson(request);
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.code === 'NETWORK_ERROR');
});

test('Превышение лимита распознаётся отдельно от прочих ошибок', async () => {
  respondWith(429, { error: 'too many requests' });

  const r = await chatJson(request);
  assert.ok(!r.ok && r.code === 'RATE_LIMITED');
});

test('Прочие коды ответа дают HTTP_ERROR без тела в сообщении', async () => {
  respondWith(500, { error: 'внутри всё сломалось', echo: 'СЕКРЕТ-ИЗ-ЗАПРОСА' });

  const r = await chatJson(request);
  assert.ok(!r.ok && r.code === 'HTTP_ERROR');
  assert.ok(
    !r.message.includes('СЕКРЕТ-ИЗ-ЗАПРОСА'),
    'тело ответа может повторять запрос — в сообщение оно попадать не должно',
  );
});

test('Пустой ответ модели распознаётся', async () => {
  respondWith(200, chatBody('   '));

  const r = await chatJson(request);
  assert.ok(!r.ok && r.code === 'EMPTY_RESPONSE');
});

test('Отсутствующий или пустой список ответов не роняет разбор', async () => {
  for (const body of [{ model: 'm' }, { model: 'm', choices: [] }, { model: 'm', choices: [{}] }]) {
    respondWith(200, body);
    const r = await chatJson(request);
    assert.equal(r.ok, false, `форма ${JSON.stringify(body)} должна быть отвергнута`);
  }
});

test('Таймаут прерывает ожидание и распознаётся', async () => {
  process.env.OPENROUTER_TIMEOUT_MS = '1000';
  globalThis.fetch = ((_url: string, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      });
    })) as unknown as typeof fetch;

  const r = await chatJson({ ...request, timeoutMs: 1000 });
  delete process.env.OPENROUTER_TIMEOUT_MS;

  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.code === 'TIMEOUT');
});

test('Удачный ответ возвращает содержимое и запрошенную модель', async () => {
  process.env.OPENROUTER_MODEL = 'нужная/модель';
  respondWith(200, chatBody('{"summary":"всё хорошо"}'));

  const r = await chatJson(request);
  delete process.env.OPENROUTER_MODEL;

  assert.ok(r.ok);
  assert.equal(r.content, '{"summary":"всё хорошо"}');
  assert.equal(
    r.model,
    'нужная/модель',
    'называется модель, которую мы запросили, — именно она входит в ключ кеша',
  );
});

test('Ключ уходит в заголовок, но не в тело запроса', async () => {
  let seen: { headers?: Record<string, string>; body?: string } = {};
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    seen = { headers: init?.headers as Record<string, string>, body: String(init?.body ?? '') };
    return new Response(JSON.stringify(chatBody('{}')), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;

  await chatJson(request);

  assert.match(seen.headers!['Authorization']!, /Bearer тестовый-ключ/);
  assert.ok(!seen.body!.includes('тестовый-ключ'), 'секрет не должен дублироваться в теле');
});

/* ------------------------------------------------------------------ */
/* Проба возможностей модели                                           */
/* ------------------------------------------------------------------ */

test('Недоступность справочника не отключает AI, а понижает строгость', async () => {
  globalThis.fetch = (async () => {
    throw new Error('справочник недоступен');
  }) as typeof fetch;

  assert.equal(
    await supportsStructuredOutput('никому/не-известная-модель'),
    false,
    'неудача пробы — это «строгий режим недоступен», а не отказ от объяснений',
  );
});

test('Без ключа проба не ходит в сеть', async () => {
  delete process.env.OPENROUTER_API_KEY;
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return new Response('{}');
  }) as typeof fetch;

  assert.equal(await supportsStructuredOutput('any/model'), false);
  assert.equal(called, false);
});

test('Поддержка структурированного вывода определяется по справочнику', async () => {
  respondWith(200, {
    data: [{ id: 'есть/структура', supported_parameters: ['structured_outputs'] }],
  });
  assert.equal(await supportsStructuredOutput('есть/структура'), true);

  respondWith(200, { data: [{ id: 'нет/структуры', supported_parameters: ['temperature'] }] });
  assert.equal(await supportsStructuredOutput('нет/структуры'), false);
});

test('Модель, которой нет в справочнике, считается без поддержки', async () => {
  respondWith(200, { data: [{ id: 'чужая/модель', supported_parameters: ['structured_outputs'] }] });

  assert.equal(await supportsStructuredOutput('наша/модель'), false);
});
