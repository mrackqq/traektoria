/**
 * BR-05 / BR-09 — перебор способов выполнить дерево требований.
 *
 * Это единственный комбинаторный алгоритм в ядре, и опасность у него
 * своя: взрыв числа вариантов. Поэтому проверяются не только правильные
 * ответы, но и поведение на пределе — частичный результат обязан быть
 * честно помечен неполным, а не выдан за исчерпывающий.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  enumerateSatisfaction,
  DEFAULT_SEARCH_LIMITS,
  type SatisfactionPlan,
} from './satisfaction.ts';
import type { EvaluatedNode } from '../eligibility/evaluate.ts';
import type { ReqStatus } from '../kernel/status.ts';

/* ------------------------------------------------------------------ */
/* Заготовки дерева                                                    */
/* ------------------------------------------------------------------ */

let seq = 0;

const leaf = (id: string, status: ReqStatus = 'NOT_MET'): EvaluatedNode => ({
  nodeId: id,
  title: id,
  kind: 'LEAF',
  outcome: { kind: 'evaluated', status },
  reasonCodes: [],
  explanation: '',
  sourceIds: [],
  critical: true,
  evidence: [],
  children: [],
  countingKey: id,
});

const naLeaf = (id: string): EvaluatedNode => ({
  ...leaf(id),
  outcome: { kind: 'not_applicable' },
});

const node = (
  kind: 'ALL' | 'ANY' | 'AT_LEAST',
  children: EvaluatedNode[],
  k?: number,
): EvaluatedNode => ({
  nodeId: `g${++seq}`,
  title: 'группа',
  kind,
  ...(k === undefined ? {} : { k }),
  outcome: { kind: 'evaluated', status: 'NOT_MET' },
  reasonCodes: [],
  explanation: '',
  sourceIds: [],
  critical: true,
  evidence: [],
  children,
});

const ids = (p: SatisfactionPlan): string[] => [...p.requiredLeafIds].sort();
const plansOf = (root: EvaluatedNode, limits = DEFAULT_SEARCH_LIMITS) =>
  enumerateSatisfaction(root, limits);

/* ------------------------------------------------------------------ */
/* Базовые формы                                                       */
/* ------------------------------------------------------------------ */

test('Невыполненный лист требует сам себя', () => {
  const r = plansOf(leaf('a'));

  assert.equal(r.plans.length, 1);
  assert.deepEqual(ids(r.plans[0]!), ['a']);
  assert.equal(r.complete, true);
});

test('Уже выполненный лист ничего не требует, но помнит себя как выполненный', () => {
  const r = plansOf(leaf('a', 'MET'));

  assert.equal(r.plans.length, 1);
  assert.deepEqual(r.plans[0]!.requiredLeafIds, []);
  assert.deepEqual(r.plans[0]!.alreadyMetLeafIds, ['a']);
});

test('ALL требует все листья одним планом', () => {
  const r = plansOf(node('ALL', [leaf('a'), leaf('b'), leaf('c')]));

  assert.equal(r.plans.length, 1, 'у конъюнкции один способ: сделать всё');
  assert.deepEqual(ids(r.plans[0]!), ['a', 'b', 'c']);
});

test('BR-05: ANY даёт отдельный план на каждую альтернативу', () => {
  // Именно это правило отличает «сдать один экзамен из трёх» от «сдать все».
  const r = plansOf(node('ANY', [leaf('a'), leaf('b'), leaf('c')]));

  assert.equal(r.plans.length, 3);
  assert.deepEqual(r.plans.map(ids).sort(), [['a'], ['b'], ['c']]);
});

test('AT_LEAST(k) перебирает сочетания по k', () => {
  const r = plansOf(node('AT_LEAST', [leaf('a'), leaf('b'), leaf('c')], 2));

  assert.equal(r.plans.length, 3, 'C(3,2) = 3');
  assert.deepEqual(r.plans.map(ids).sort(), [
    ['a', 'b'],
    ['a', 'c'],
    ['b', 'c'],
  ]);
});

test('AT_LEAST(1) совпадает с ANY', () => {
  const any = plansOf(node('ANY', [leaf('a'), leaf('b')])).plans.map(ids).sort();
  const atLeast = plansOf(node('AT_LEAST', [leaf('a'), leaf('b')], 1)).plans.map(ids).sort();

  assert.deepEqual(atLeast, any);
});

test('AT_LEAST(n) совпадает с ALL', () => {
  const all = plansOf(node('ALL', [leaf('a'), leaf('b')])).plans.map(ids).sort();
  const atLeast = plansOf(node('AT_LEAST', [leaf('a'), leaf('b')], 2)).plans.map(ids).sort();

  assert.deepEqual(atLeast, all);
});

/* ------------------------------------------------------------------ */
/* Неприменимое и пустое                                               */
/* ------------------------------------------------------------------ */

test('Неприменимый лист ничего не требует', () => {
  const r = plansOf(naLeaf('a'));

  assert.equal(r.plans.length, 1);
  assert.deepEqual(r.plans[0]!.requiredLeafIds, []);
});

test('Группа только из неприменимых детей выполнима пустым планом', () => {
  // REV-04: иначе неприменимая ветка выглядела бы как невыполнимое условие.
  const r = plansOf(node('ALL', [naLeaf('a'), naLeaf('b')]));

  assert.equal(r.plans.length, 1);
  assert.deepEqual(r.plans[0]!.requiredLeafIds, []);
});

test('Пустая группа не ломает перебор', () => {
  const r = plansOf(node('ALL', []));

  assert.equal(r.plans.length, 1);
  assert.deepEqual(r.plans[0]!.requiredLeafIds, []);
  assert.equal(r.complete, true);
});

test('Неприменимые дети не попадают в сочетания AT_LEAST', () => {
  const r = plansOf(node('AT_LEAST', [leaf('a'), leaf('b'), naLeaf('x')], 2));

  for (const p of r.plans) {
    assert.ok(!p.requiredLeafIds.includes('x'), 'неприменимое не может быть способом выполнить');
  }
});

/* ------------------------------------------------------------------ */
/* Вложенность                                                         */
/* ------------------------------------------------------------------ */

test('ALL из двух ANY даёт декартово произведение альтернатив', () => {
  const r = plansOf(
    node('ALL', [node('ANY', [leaf('a1'), leaf('a2')]), node('ANY', [leaf('b1'), leaf('b2')])]),
  );

  assert.equal(r.plans.length, 4);
  assert.deepEqual(r.plans.map(ids).sort(), [
    ['a1', 'b1'],
    ['a1', 'b2'],
    ['a2', 'b1'],
    ['a2', 'b2'],
  ]);
});

test('Выполненная часть вложенного дерева не попадает в требуемое', () => {
  const r = plansOf(node('ALL', [leaf('done', 'MET'), leaf('todo')]));

  assert.deepEqual(ids(r.plans[0]!), ['todo']);
  assert.deepEqual(r.plans[0]!.alreadyMetLeafIds, ['done']);
});

/* ------------------------------------------------------------------ */
/* BR-09: порядок и дедупликация                                       */
/* ------------------------------------------------------------------ */

test('BR-09: планы упорядочены от коротких к длинным', () => {
  const r = plansOf(node('ANY', [node('ALL', [leaf('a'), leaf('b'), leaf('c')]), leaf('z')]));

  const lengths = r.plans.map((p) => p.requiredLeafIds.length);
  assert.deepEqual(
    lengths,
    [...lengths].sort((x, y) => x - y),
    'план из меньшего числа действий обязан идти первым',
  );
});

test('Одинаковые по составу планы не дублируются', () => {
  // Две ветки могут привести к одному и тому же набору действий — показывать
  // его дважды значит выдавать один способ за два.
  const r = plansOf(node('ANY', [leaf('a'), leaf('a')]));
  const unique = new Set(r.plans.map((p) => ids(p).join(',')));

  assert.equal(unique.size, r.plans.length);
});

test('Порядок листьев внутри плана не влияет на дедупликацию', () => {
  const left = plansOf(node('ALL', [leaf('a'), leaf('b')])).plans.map(ids);
  const right = plansOf(node('ALL', [leaf('b'), leaf('a')])).plans.map(ids);

  assert.deepEqual(left, right);
});

/* ------------------------------------------------------------------ */
/* Пределы перебора                                                    */
/* ------------------------------------------------------------------ */

test('Число планов не превышает заданный предел', () => {
  const wide = node(
    'ALL',
    Array.from({ length: 6 }, (_, i) =>
      node('ANY', [leaf(`x${i}a`), leaf(`x${i}b`), leaf(`x${i}c`)]),
    ),
  );

  const r = plansOf(wide, { maxPlans: 10, maxBranches: 20_000 });
  assert.ok(r.plans.length <= 10, `планов ${r.plans.length} при пределе 10`);
});

test('Упёршись в предел, поиск честно помечает себя неполным', () => {
  // Молчаливая выдача усечённого перебора за исчерпывающий — худший исход:
  // пользователь решил бы, что других способов поступить не существует.
  const wide = node(
    'ALL',
    Array.from({ length: 8 }, (_, i) =>
      node('ANY', [leaf(`y${i}a`), leaf(`y${i}b`), leaf(`y${i}c`)]),
    ),
  );

  const r = plansOf(wide, { maxPlans: 4, maxBranches: 50 });

  assert.equal(r.complete, false);
  assert.ok(r.stopReason === 'plan_limit' || r.stopReason === 'branch_limit');
});

test('Небольшое дерево проходится целиком и помечается полным', () => {
  const r = plansOf(node('ANY', [leaf('a'), leaf('b')]));

  assert.equal(r.complete, true);
  assert.equal(r.stopReason, undefined);
  assert.ok(r.branchesExplored > 0, 'счётчик обхода обязан работать');
});

test('AT_LEAST(k) никогда не возвращает план короче k', () => {
  for (const k of [1, 2, 3]) {
    const r = plansOf(node('AT_LEAST', [leaf('a'), leaf('b'), leaf('c'), leaf('d')], k));

    for (const p of r.plans) {
      assert.ok(
        p.requiredLeafIds.length >= k,
        `k=${k}, но план требует лишь ${p.requiredLeafIds.length} действий`,
      );
    }
  }
});

test('Перебор детерминирован: два прогона дают один результат', () => {
  const tree = node('ALL', [
    node('ANY', [leaf('a'), leaf('b')]),
    node('AT_LEAST', [leaf('c'), leaf('d'), leaf('e')], 2),
  ]);

  const one = plansOf(tree).plans.map(ids);
  const two = plansOf(tree).plans.map(ids);

  assert.deepEqual(one, two);
});
