/**
 * Композиция измерений в бакет показа.
 *
 * `deriveBucket` — каскад ворот, и порядок ворот здесь и есть бизнес-правило:
 * именно он решает, попадёт программа в «начните с этих», «требуют проверки»
 * или «сейчас не подходят». Ни одно измерение не превращается в «шанс
 * поступления» — они остаются раздельными.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compareAssessments,
  deriveBucket,
  deriveDataQuality,
  deriveEligibility,
  type ProgramAssessment,
} from './program-result.ts';
import type { EvaluatedNode, ReasonCode } from './evaluate.ts';
import type { ReqStatus } from '../kernel/status.ts';
import { money } from '../kernel/money.ts';

/* ------------------------------------------------------------------ */
/* Заготовки                                                           */
/* ------------------------------------------------------------------ */

const leaf = (
  over: Partial<EvaluatedNode> & { status?: ReqStatus; codes?: ReasonCode[] } = {},
): EvaluatedNode => {
  const { status = 'MET', codes = [], ...rest } = over;
  return {
    nodeId: 'leaf-1',
    title: 'Условие',
    kind: 'LEAF',
    outcome: { kind: 'evaluated', status },
    reasonCodes: codes,
    explanation: '',
    sourceIds: [],
    critical: true,
    evidence: [],
    children: [],
    ...rest,
  };
};

const group = (children: EvaluatedNode[], status: ReqStatus = 'MET'): EvaluatedNode => ({
  nodeId: 'root',
  title: 'Требования',
  kind: 'ALL',
  outcome: { kind: 'evaluated', status },
  reasonCodes: [],
  explanation: '',
  sourceIds: [],
  critical: true,
  evidence: [],
  children,
});

const bucketInput = (over: Partial<Parameters<typeof deriveBucket>[0]> = {}) => ({
  eligibility: 'conditions_met' as const,
  dataQuality: 'self_reported' as const,
  financial: { kind: 'compatible_in_known_range' as const },
  planning: 'feasible_under_assumptions' as const,
  access: { status: 'allowed' as const },
  counts: { MET: 3, NOT_MET: 0, UNKNOWN: 0, CONFLICT: 0, NOT_APPLICABLE: 0 },
  ...over,
});

/* ------------------------------------------------------------------ */
/* Качество данных                                                     */
/* ------------------------------------------------------------------ */

test('Пометка «демо» не прячет расхождение источников', () => {
  // Синтетичность данных и их качество — разные утверждения, и менее
  // тревожное не должно заменять более тревожное. В посеянном каталоге
  // расхождение источников заложено намеренно, чтобы продукт его показывал.
  const tree = group([leaf({ codes: ['SOURCE_CONFLICT'], status: 'CONFLICT' })], 'CONFLICT');

  assert.equal(deriveDataQuality(tree, false), 'conflict');
  assert.equal(deriveDataQuality(tree, true), 'conflict', 'флаг isDemo не должен маскировать конфликт');
});

test('Пометка «демо» не прячет устаревший критический источник', () => {
  const stale = group([leaf({ codes: ['SOURCE_STALE_CRITICAL'], status: 'UNKNOWN' })], 'UNKNOWN');
  const retracted = group([leaf({ codes: ['SOURCE_RETRACTED'], status: 'UNKNOWN' })], 'UNKNOWN');

  assert.equal(deriveDataQuality(stale, true), 'stale');
  assert.equal(deriveDataQuality(retracted, true), 'stale');
});

test('Конфликт важнее устаревания', () => {
  const tree = group([
    leaf({ nodeId: 'a', codes: ['SOURCE_STALE_CRITICAL'] }),
    leaf({ nodeId: 'b', codes: ['SOURCE_CONFLICT'] }),
  ]);
  assert.equal(deriveDataQuality(tree, false), 'conflict');
});

test('Без проблем с источниками демо остаётся демо', () => {
  const clean = group([leaf({ provenance: 'demo' })]);
  assert.equal(deriveDataQuality(clean, true), 'demo');
});

test('Все выполненные условия подтверждены вузом — данные проверенные', () => {
  const verified = group([leaf({ provenance: 'institution_verified' })]);
  assert.equal(deriveDataQuality(verified, false), 'verified');
});

test('Хотя бы одно условие со слов заявителя снимает статус «проверено»', () => {
  const mixed = group([
    leaf({ nodeId: 'a', provenance: 'institution_verified' }),
    leaf({ nodeId: 'b', provenance: 'self_reported' }),
  ]);
  assert.equal(deriveDataQuality(mixed, false), 'self_reported');
});

/* ------------------------------------------------------------------ */
/* Пригодность                                                         */
/* ------------------------------------------------------------------ */

test('Жёсткое препятствие важнее статуса корня', () => {
  // Категорию заявителя и уровень образования нельзя изменить подготовкой,
  // поэтому такая программа блокирована даже при выполненном корне.
  for (const code of ['CATEGORY_MISMATCH', 'EDUCATION_LEVEL_MISMATCH'] as ReasonCode[]) {
    const tree = group([leaf({ status: 'NOT_MET', codes: [code] })], 'MET');
    const r = deriveEligibility(tree);
    assert.equal(r.status, 'blocked', `${code} обязан блокировать вариант`);
    assert.equal(r.hardObstacles.length, 1, 'препятствие обязано быть названо, а не просто учтено');
  }
});

test('Неприменимый корень — неопределённость, а не отказ', () => {
  const tree = { ...group([]), outcome: { kind: 'not_applicable' as const } };
  assert.equal(deriveEligibility(tree).status, 'undetermined');
});

test('Статус корня переносится в пригодность без жёстких препятствий', () => {
  assert.equal(deriveEligibility(group([leaf()], 'MET')).status, 'conditions_met');
  assert.equal(deriveEligibility(group([leaf()], 'NOT_MET')).status, 'gaps_identified');
  assert.equal(deriveEligibility(group([leaf()], 'UNKNOWN')).status, 'undetermined');
  assert.equal(deriveEligibility(group([leaf()], 'CONFLICT')).status, 'undetermined');
});

/* ------------------------------------------------------------------ */
/* Порядок ворот в deriveBucket                                        */
/* ------------------------------------------------------------------ */

test('Закрытый доступ проверяется раньше условий', () => {
  // Путь, закрытый для категории заявителя, не может оказаться в основной
  // группе только потому, что дерево требований хорошо закрыто.
  const r = deriveBucket(
    bucketInput({
      access: { status: 'blocked', message: 'Только для граждан РК.' },
      eligibility: 'conditions_met',
    }),
  );
  assert.equal(r.bucket, 'not_suitable');
  assert.equal(r.exclusionReason, 'Только для граждан РК.', 'причина отказа обязана дойти до интерфейса');
});

test('Известный финансовый разрыв исключает вариант, а не помечает «уточнить»', () => {
  // Нехватка денег по известному диапазону — это известный факт,
  // а не неизвестность.
  const r = deriveBucket(
    bucketInput({ financial: { kind: 'known_gap', shortfall: money(500_000n, 'KZT') } }),
  );
  assert.equal(r.bucket, 'not_suitable');
  assert.ok(r.exclusionReason);
});

test('Финансовый разрыв важнее проблем с данными', () => {
  const r = deriveBucket(
    bucketInput({
      financial: { kind: 'known_gap', shortfall: money(1n, 'KZT') },
      dataQuality: 'conflict',
    }),
  );
  assert.equal(r.bucket, 'not_suitable', 'порядок ворот: деньги проверяются раньше качества данных');
});

test('Невыполнимый план исключает вариант', () => {
  const r = deriveBucket(bucketInput({ planning: 'infeasible_under_assumptions' }));
  assert.equal(r.bucket, 'not_suitable');
});

test('Конфликт и устаревание уводят в «требует проверки»', () => {
  assert.equal(deriveBucket(bucketInput({ dataQuality: 'conflict' })).bucket, 'needs_verification');
  assert.equal(deriveBucket(bucketInput({ dataQuality: 'stale' })).bucket, 'needs_verification');
});

test('Нехватка ответов уводит в «требует проверки», а не в отказ', () => {
  const r = deriveBucket(bucketInput({ access: { status: 'needs_input' } }));
  assert.equal(r.bucket, 'needs_verification');
});

test('Любое неизвестное или спорное условие снимает рекомендацию', () => {
  assert.equal(
    deriveBucket(bucketInput({ counts: { MET: 1, NOT_MET: 0, UNKNOWN: 1, CONFLICT: 0, NOT_APPLICABLE: 0 } }))
      .bucket,
    'needs_verification',
  );
  assert.equal(
    deriveBucket(bucketInput({ counts: { MET: 1, NOT_MET: 0, UNKNOWN: 0, CONFLICT: 1, NOT_APPLICABLE: 0 } }))
      .bucket,
    'needs_verification',
  );
});

test('Непрояснённые деньги — «требует проверки», а не отказ', () => {
  const r = deriveBucket(
    bucketInput({ financial: { kind: 'needs_clarification', reason: 'range_crosses_budget' } }),
  );
  assert.equal(r.bucket, 'needs_verification');
});

test('Чистый случай доходит до рекомендации', () => {
  const r = deriveBucket(bucketInput());
  assert.equal(r.bucket, 'recommended');
  assert.equal(r.exclusionReason, undefined);
});

/* ------------------------------------------------------------------ */
/* Детерминированный порядок                                           */
/* ------------------------------------------------------------------ */

const assessment = (over: Partial<ProgramAssessment>): ProgramAssessment =>
  ({
    programId: 'p',
    intakeId: 'i',
    admissionPathId: 'path-1',
    eligibility: 'conditions_met',
    dataQuality: 'self_reported',
    financial: { kind: 'compatible_in_known_range' },
    planning: 'feasible_under_assumptions',
    access: { status: 'allowed' },
    preference: { score: 0.5, matched: [], missed: [] },
    matchKind: 'within_filters',
    bucket: 'recommended',
    tree: group([leaf()]),
    counts: { MET: 1, NOT_MET: 0, UNKNOWN: 0, CONFLICT: 0, NOT_APPLICABLE: 0 },
    reasons: [],
    ...over,
  }) as ProgramAssessment;

test('ENG-04: порядок не зависит от порядка поступления', () => {
  const a = assessment({ admissionPathId: 'a', bucket: 'recommended' });
  const b = assessment({ admissionPathId: 'b', bucket: 'needs_verification' });
  const c = assessment({ admissionPathId: 'c', bucket: 'not_suitable' });

  const one = [a, b, c].sort(compareAssessments).map((x) => x.admissionPathId);
  const two = [c, b, a].sort(compareAssessments).map((x) => x.admissionPathId);
  const three = [b, a, c].sort(compareAssessments).map((x) => x.admissionPathId);

  assert.deepEqual(one, two);
  assert.deepEqual(one, three);
  assert.deepEqual(one, ['a', 'b', 'c'], 'рекомендованные идут раньше требующих проверки и отказов');
});

test('При полном равенстве порядок решает идентификатор', () => {
  const x = assessment({ admissionPathId: 'zzz' });
  const y = assessment({ admissionPathId: 'aaa' });

  assert.deepEqual(
    [x, y].sort(compareAssessments).map((v) => v.admissionPathId),
    ['aaa', 'zzz'],
    'без устойчивого тай-брейка подбор менялся бы между одинаковыми расчётами',
  );
});
