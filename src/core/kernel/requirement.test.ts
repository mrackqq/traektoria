/**
 * ENG-08 / BR-04 / AC-34 — проверка шаблона дерева требований.
 *
 * Это сторож на публикации: некорректный шаблон обязан блокировать выпуск,
 * а не «чиниться» на лету. Ошибка здесь не видна пользователю напрямую —
 * она проявится кривым подбором у всех сразу, поэтому проверяются все
 * поводы отказать.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  collectCountingKeys,
  countLeaves,
  findNode,
  validateTemplate,
  type RequirementNode,
} from './requirement.ts';

const leaf = (id: string, countingKey = id): RequirementNode => ({
  nodeType: 'LEAF',
  id,
  title: id,
  predicate: { type: 'document', documentKind: 'school_certificate' },
  countingKey,
  critical: true,
  sourceRefs: [],
});

const all = (id: string, children: RequirementNode[]): RequirementNode => ({
  nodeType: 'GROUP',
  id,
  title: id,
  groupType: 'ALL',
  children,
});

const any = (id: string, children: RequirementNode[]): RequirementNode => ({
  nodeType: 'GROUP',
  id,
  title: id,
  groupType: 'ANY',
  children,
});

const atLeast = (id: string, k: number, children: RequirementNode[]): RequirementNode => ({
  nodeType: 'GROUP',
  id,
  title: id,
  groupType: 'AT_LEAST',
  k,
  children,
});

const codes = (node: RequirementNode): string[] => validateTemplate(node).map((p) => p.code);

/* ------------------------------------------------------------------ */
/* Корректные шаблоны                                                  */
/* ------------------------------------------------------------------ */

test('Корректное дерево не вызывает возражений', () => {
  const tree = all('root', [
    leaf('a'),
    any('alt', [leaf('b'), leaf('c')]),
    atLeast('pick', 2, [leaf('d'), leaf('e'), leaf('f')]),
  ]);

  assert.deepEqual(validateTemplate(tree), []);
});

test('Одиночный лист — корректный шаблон', () => {
  assert.deepEqual(validateTemplate(leaf('a')), []);
});

/* ------------------------------------------------------------------ */
/* ENG-08: пустые группы                                               */
/* ------------------------------------------------------------------ */

test('Пустая группа запрещена в опубликованном шаблоне', () => {
  for (const empty of [all('g', []), any('g', []), atLeast('g', 1, [])]) {
    assert.ok(codes(empty).includes('EMPTY_GROUP'), 'пустая группа ничего не требует и ничего не значит');
  }
});

test('Пустая группа в глубине дерева тоже находится', () => {
  const tree = all('root', [leaf('a'), any('deep', [all('deeper', [])])]);
  assert.ok(codes(tree).includes('EMPTY_GROUP'));
});

/* ------------------------------------------------------------------ */
/* ENG-08: мощность AT_LEAST                                           */
/* ------------------------------------------------------------------ */

test('k вне диапазона 1…число элементов отвергается', () => {
  for (const k of [0, -1, 4]) {
    const tree = atLeast('g', k, [leaf('a'), leaf('b'), leaf('c')]);
    assert.ok(codes(tree).includes('INVALID_K'), `k=${k} обязано быть отвергнуто`);
  }
});

test('Дробное k отвергается', () => {
  assert.ok(codes(atLeast('g', 1.5, [leaf('a'), leaf('b')])).includes('INVALID_K'));
});

test('Границы k допустимы', () => {
  assert.deepEqual(validateTemplate(atLeast('g', 1, [leaf('a'), leaf('b')])), []);
  assert.deepEqual(validateTemplate(atLeast('g', 2, [leaf('a'), leaf('b')])), []);
});

test('ENG-08: мощность считается по уникальным ключам, а не по числу листьев', () => {
  // Два листа с одним ключом подсчёта — один логический элемент.
  // Дублирование предиката не должно позволять требовать «два из двух»,
  // когда элемент на самом деле один.
  const tree = atLeast('g', 2, [leaf('a', 'shared'), leaf('b', 'shared')]);

  assert.ok(
    codes(tree).includes('INVALID_K') || codes(tree).includes('DUPLICATE_COUNTING_KEY_IN_AT_LEAST'),
    'дублированный ключ не увеличивает мощность',
  );
});

/* ------------------------------------------------------------------ */
/* Уникальность идентификаторов                                        */
/* ------------------------------------------------------------------ */

test('Повторяющийся идентификатор узла запрещён', () => {
  const tree = all('root', [leaf('dup'), leaf('dup')]);
  assert.ok(codes(tree).includes('DUPLICATE_NODE_ID'));
});

test('Повтор идентификатора находится и в разных ветках', () => {
  const tree = all('root', [any('l', [leaf('dup')]), any('r', [leaf('dup')])]);
  assert.ok(codes(tree).includes('DUPLICATE_NODE_ID'), 'проверка сквозная по всему дереву');
});

test('Идентификатор группы тоже участвует в проверке', () => {
  const tree = all('same', [leaf('a'), any('same', [leaf('b')])]);
  assert.ok(codes(tree).includes('DUPLICATE_NODE_ID'));
});

/* ------------------------------------------------------------------ */
/* Обход дерева                                                        */
/* ------------------------------------------------------------------ */

test('Подсчёт листьев не считает группы', () => {
  assert.equal(countLeaves(leaf('a')), 1);
  assert.equal(countLeaves(all('g', [leaf('a'), leaf('b')])), 2);
  assert.equal(countLeaves(all('g', [any('h', [leaf('a'), leaf('b')]), leaf('c')])), 3);
});

test('Ключи подсчёта собираются со всей глубины', () => {
  const tree = all('root', [leaf('a', 'ka'), any('g', [leaf('b', 'kb'), leaf('c', 'kc')])]);
  assert.deepEqual(collectCountingKeys(tree).sort(), ['ka', 'kb', 'kc']);
});

test('Повторяющийся ключ возвращается столько раз, сколько встречен', () => {
  // Дедупликацию делает вызывающий: сама функция не должна решать за него,
  // одно это условие или два.
  const tree = all('root', [leaf('a', 'same'), leaf('b', 'same')]);
  assert.deepEqual(collectCountingKeys(tree), ['same', 'same']);
});

test('Поиск узла находит и лист, и группу', () => {
  const tree = all('root', [leaf('a'), any('g', [leaf('b')])]);

  assert.equal(findNode(tree, 'root')?.id, 'root');
  assert.equal(findNode(tree, 'g')?.id, 'g');
  assert.equal(findNode(tree, 'b')?.id, 'b');
});

test('Поиск несуществующего узла даёт null, а не исключение', () => {
  assert.equal(findNode(all('root', [leaf('a')]), 'нет-такого'), null);
});

test('Глубокая вложенность обходится целиком', () => {
  let tree: RequirementNode = leaf('bottom');
  for (let i = 0; i < 50; i++) tree = all(`g${i}`, [tree]);

  assert.equal(countLeaves(tree), 1);
  assert.equal(findNode(tree, 'bottom')?.id, 'bottom');
  assert.deepEqual(validateTemplate(tree), []);
});
