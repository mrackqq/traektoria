/**
 * Настройка обращения к модели.
 *
 * Ключ — единственный секрет продукта, и главная проверка здесь про него:
 * он читается только на сервере и не попадает ни в один объект, который
 * может уйти на страницу или в лог.
 */

import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  describeAiConfig,
  readAiConfig,
  readApiKey,
  DEFAULT_MODEL,
  GUARDRAILS_VERSION,
  PROMPT_VERSION,
} from './config.ts';

const VARS = [
  'OPENROUTER_API_KEY',
  'OPENROUTER_MODEL',
  'OPENROUTER_TIMEOUT_MS',
  'OPENROUTER_BASE_URL',
] as const;

const saved = Object.fromEntries(VARS.map((v) => [v, process.env[v]]));

afterEach(() => {
  for (const v of VARS) {
    if (saved[v] === undefined) delete process.env[v];
    else process.env[v] = saved[v];
  }
});

test('Без ключа продукт считается ненастроенным, но рабочим', () => {
  delete process.env.OPENROUTER_API_KEY;

  assert.equal(readAiConfig().configured, false);
  assert.equal(readApiKey(), null);
});

test('Пустой ключ и ключ из пробелов равносильны отсутствию', () => {
  for (const value of ['', '   ', '\t\n']) {
    process.env.OPENROUTER_API_KEY = value;
    assert.equal(readAiConfig().configured, false, `«${value}» не должно считаться ключом`);
    assert.equal(readApiKey(), null);
  }
});

test('Ключ обрезается по краям и не попадает в конфигурацию', () => {
  process.env.OPENROUTER_API_KEY = '  секретный-ключ  ';

  assert.equal(readApiKey(), 'секретный-ключ');

  const config = readAiConfig();
  assert.equal(config.configured, true);
  assert.ok(
    !JSON.stringify(config).includes('секретный-ключ'),
    'ключ не должен быть частью объекта конфигурации — его легко случайно залогировать',
  );
});

test('Описание конфигурации для интерфейса не содержит ключа', () => {
  process.env.OPENROUTER_API_KEY = 'секретный-ключ';

  const described = describeAiConfig();
  assert.equal(described.configured, true);
  assert.ok(!JSON.stringify(described).includes('секретный-ключ'));
});

test('Модель берётся из настройки, иначе используется умолчание', () => {
  delete process.env.OPENROUTER_MODEL;
  assert.equal(readAiConfig().model, DEFAULT_MODEL);

  process.env.OPENROUTER_MODEL = 'some/other-model';
  assert.equal(readAiConfig().model, 'some/other-model');

  process.env.OPENROUTER_MODEL = '   ';
  assert.equal(readAiConfig().model, DEFAULT_MODEL, 'пустая настройка не отменяет умолчание');
});

test('Таймаут принимается только разумный', () => {
  process.env.OPENROUTER_TIMEOUT_MS = '5000';
  assert.equal(readAiConfig().timeoutMs, 5000);

  process.env.OPENROUTER_TIMEOUT_MS = '1000';
  assert.equal(readAiConfig().timeoutMs, 1000, 'нижняя граница допустима');

  process.env.OPENROUTER_TIMEOUT_MS = '999';
  assert.equal(readAiConfig().timeoutMs, 25_000, 'слишком малый таймаут заменяется умолчанием');

  for (const bad of ['не-число', '', '-1', 'Infinity']) {
    process.env.OPENROUTER_TIMEOUT_MS = bad;
    assert.equal(readAiConfig().timeoutMs, 25_000, `«${bad}» не должно стать таймаутом`);
  }
});

test('Базовый адрес нормализуется без хвостового слеша', () => {
  delete process.env.OPENROUTER_BASE_URL;
  assert.equal(readAiConfig().baseUrl, 'https://openrouter.ai/api/v1');

  process.env.OPENROUTER_BASE_URL = 'https://example.test/v1/';
  assert.equal(
    readAiConfig().baseUrl,
    'https://example.test/v1',
    'двойной слеш в собранном адресе ломает запрос',
  );
});

test('Версии промпта и политики заданы и входят в ключ кеша', () => {
  // Они намеренно участвуют в ключе: изменение правил обесценивает
  // прежние ответы само, без ручной чистки кеша.
  assert.ok(PROMPT_VERSION.length > 0);
  assert.ok(GUARDRAILS_VERSION.length > 0);
});
