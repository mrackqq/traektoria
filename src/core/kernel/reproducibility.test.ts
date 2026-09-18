/**
 * ENG-05 / ST-10 — воспроизводимость расчёта и срок годности.
 *
 * Проверяется то, ради чего ключ существует: одинаковый вход даёт одинаковый
 * хэш, любое существенное изменение входа — другой, а срок годности берётся
 * по ближайшей реальной границе с названной причиной и не выдумывается там,
 * где граница неизвестна.
 *
 * Запуск: npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeCalculationKey,
  isApplicable,
  isExpired,
  ENGINE_VERSION,
  MAX_AGE_MINUTES,
  POLICY_VERSION,
  type CalculationInputs,
} from './reproducibility.ts';
import { buildSession } from '../demo/session.ts';
import { buildDemoProfile } from '../demo/profile.ts';

const DEMO_PROFILE = buildDemoProfile('2026-09-18T06:00:00Z');

const AT = '2026-09-18T06:00:00.000Z';

function inputs(over: Partial<CalculationInputs> = {}): CalculationInputs {
  return {
    profileId: 'demo-user-r1',
    profileRevision: 1,
    admissionPathIds: ['path-a', 'path-b'],
    catalogScopeHash: 'abcd1234',
    policyFingerprint: { searchLimits: { maxPlans: 64 }, calendar: 'KZ' },
    calculatedAt: AT,
    boundaries: [],
    ...over,
  };
}

test('ENG-05: одинаковый вход даёт одинаковый хэш, порядок путей не влияет', () => {
  const a = computeCalculationKey(inputs());
  const b = computeCalculationKey(
    inputs({ admissionPathIds: ['path-b', 'path-a'], calculatedAt: '2026-09-19T10:00:00.000Z' }),
  );

  assert.equal(a.inputHash, b.inputHash, 'ни порядок путей, ни время расчёта в хэш не входят');
});

test('ENG-05: любое существенное изменение входа меняет хэш', () => {
  const base = computeCalculationKey(inputs()).inputHash;

  assert.notEqual(computeCalculationKey(inputs({ profileRevision: 2 })).inputHash, base);
  assert.notEqual(computeCalculationKey(inputs({ catalogScopeHash: 'ffff0000' })).inputHash, base);
  assert.notEqual(
    computeCalculationKey(inputs({ admissionPathIds: ['path-a'] })).inputHash,
    base,
    'сузился набор прочитанных путей — это другой расчёт',
  );
  assert.notEqual(
    computeCalculationKey(inputs({ policyFingerprint: { searchLimits: { maxPlans: 8 } } })).inputHash,
    base,
    'смена лимита перебора обязана менять хэш',
  );
});

test('ST-10: срок годности ограничен предельным возрастом расчёта', () => {
  const key = computeCalculationKey(inputs());

  assert.equal(key.validityReason.kind, 'max_age');
  assert.equal(
    Date.parse(key.validUntil) - Date.parse(AT),
    MAX_AGE_MINUTES * 60_000,
  );
});

test('ST-10: ближайшая реальная граница вытесняет предельный возраст и называет причину', () => {
  const soon = new Date(Date.parse(AT) + 5 * 60_000).toISOString();
  const key = computeCalculationKey(
    inputs({
      boundaries: [
        { atUtc: soon, reason: { kind: 'external_deadline', deadlineId: 'dl-apply' } },
        {
          atUtc: new Date(Date.parse(AT) + 3 * 86_400_000).toISOString(),
          reason: { kind: 'source_freshness', sourceId: 'src-1' },
        },
      ],
    }),
  );

  assert.equal(key.validUntil, soon);
  assert.deepEqual(key.validityReason, { kind: 'external_deadline', deadlineId: 'dl-apply' });
});

test('ST-10: граница в прошлом не сокращает срок годности до отрицательного', () => {
  const past = new Date(Date.parse(AT) - 86_400_000).toISOString();
  const key = computeCalculationKey(
    inputs({
      boundaries: [{ atUtc: past, reason: { kind: 'result_expiry', examKind: 'IELTS' } }],
    }),
  );

  assert.ok(key.validUntil > AT, 'срок годности не может быть в прошлом');
  assert.equal(key.validityReason.kind, 'max_age');
});

test('ST-10: неизвестная граница остаётся предупреждением, а не датой', () => {
  const key = computeCalculationKey(
    inputs({ unknownBoundaries: ['Отсечка dl-docs известна не полностью'] }),
  );

  assert.equal(key.unknownBoundaries.length, 1);
  assert.equal(key.validityReason.kind, 'max_age', 'неизвестное не подставляется как граница');
});

test('ST-10: предпросмотр непригоден при смене входа, версии или по времени', () => {
  const key = computeCalculationKey(inputs());
  const same = {
    inputHash: key.inputHash,
    engineVersion: ENGINE_VERSION,
    policyVersion: POLICY_VERSION,
  };

  assert.equal(isApplicable(key, same, AT).ok, true);

  const changedInput = isApplicable(key, { ...same, inputHash: 'deadbeef' }, AT);
  assert.equal(changedInput.ok, false);

  const changedEngine = isApplicable(key, { ...same, engineVersion: '2.0.0' }, AT);
  assert.equal(changedEngine.ok, false);

  // AC-22: устарел ТОЛЬКО из-за времени — ревизии те же.
  const later = new Date(Date.parse(AT) + (MAX_AGE_MINUTES + 1) * 60_000).toISOString();
  assert.equal(isExpired(key, later), true);
  const expired = isApplicable(key, same, later);
  assert.equal(expired.ok, false);
  if (expired.ok) return;
  assert.match(expired.reason, /Срок годности/);
});

test('Расчёт сессии воспроизводим: два прогона на одних данных дают один ключ', () => {
  const a = buildSession({ profile: DEMO_PROFILE });
  const b = buildSession({ profile: DEMO_PROFILE });

  assert.equal(a.key.inputHash, b.key.inputHash);
  assert.equal(a.key.catalogScopeHash, b.key.catalogScopeHash);
  assert.equal(a.key.profileRevision, DEMO_PROFILE.revision);
  assert.ok(a.key.validUntil > a.key.calculatedAt);
});

test('Изменение профиля меняет ключ расчёта', () => {
  const base = buildSession({ profile: DEMO_PROFILE });
  const changed = buildSession({
    profile: { ...DEMO_PROFILE, id: 'demo-user-r2', revision: 2 },
  });

  assert.notEqual(base.key.inputHash, changed.key.inputHash);
});
