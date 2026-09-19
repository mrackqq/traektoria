/**
 * Правило годности идентификатора посетителя.
 *
 * Здесь закрыт дефект, при котором любой непригодный идентификатор
 * превращался в общую строку `'guest'`: все посетители без валидной cookie
 * сходились на одного владельца `user-guest` и читали и перезаписывали
 * анкету и прогресс друг друга.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { newSessionId, sanitizeSessionId } from './session-id.ts';
import { demoOwnerId, visitorOwnerId } from '@core/demo/profile';

test('PRIV-01: непригодный идентификатор не превращается в общего владельца', () => {
  for (const raw of [undefined, '', 'abc', '1234567', '!!!!!!!!', '   ', '../..']) {
    assert.equal(
      sanitizeSessionId(raw),
      null,
      `«${String(raw)}» обязано считаться отсутствием идентификатора, а не запасным значением`,
    );
  }
});

test('Опасный путь обезвреживается, а не отвергается целиком', () => {
  // После вычистки остаётся достаточно символов, поэтому значение годно —
  // но выйти из каталога данных им уже нельзя.
  const cleaned = sanitizeSessionId('../../etc/passwd');
  assert.equal(cleaned, 'etcpasswd');
  assert.ok(cleaned && !cleaned.includes('/') && !cleaned.includes('.'));
});

test('PRIV-01: общей строки «guest» больше нет ни в каком виде', () => {
  const outputs = [undefined, '', 'abc', '!!!!!!!!'].map((raw) => sanitizeSessionId(raw));
  assert.ok(
    outputs.every((v) => v === null),
    'любое запасное значение стало бы общим бакетом данных для всех таких посетителей',
  );
});

test('Годный идентификатор проходит без изменений', () => {
  assert.equal(sanitizeSessionId('abcdefgh'), 'abcdefgh', 'ровно 8 символов — минимальная годная длина');
  assert.equal(sanitizeSessionId('a1b2c3d4e5f6'), 'a1b2c3d4e5f6');
  assert.equal(sanitizeSessionId('with-dash_and_underscore'), 'with-dash_and_underscore');
});

test('Посторонние символы вычищаются, а не принимаются', () => {
  assert.equal(sanitizeSessionId('abcd<script>efgh'), 'abcdscriptefgh');
  assert.equal(sanitizeSessionId('абвгдежз12345678'), '12345678', 'кириллица не входит в алфавит идентификатора');
  assert.equal(
    sanitizeSessionId('ab!@#cd'),
    null,
    'после вычистки осталось 4 символа — этого мало, значит идентификатора нет',
  );
});

test('Длина ограничена сверху', () => {
  const long = 'a'.repeat(200);
  assert.equal(sanitizeSessionId(long)?.length, 64, 'значение обрезается до 64 символов');
});

test('Запасные идентификаторы уникальны и дают разных владельцев', () => {
  const a = newSessionId();
  const b = newSessionId();

  assert.notEqual(a, b, 'два обращения подряд не должны дать один идентификатор');
  assert.equal(sanitizeSessionId(a), a, 'выданный идентификатор обязан проходить собственную проверку');
  assert.notEqual(
    visitorOwnerId(a),
    visitorOwnerId(b),
    'разные посетители без cookie обязаны получить разные пространства данных',
  );
});

test('Демо и собственный профиль — разные владельцы при одной сессии', () => {
  const sid = 'abcdefgh12345';
  assert.notEqual(
    demoOwnerId(sid),
    visitorOwnerId(sid),
    'просмотр демо не должен писать в собственный профиль посетителя',
  );
});
