/**
 * Проверки решётки ENG-02 и property-based инварианты из §16 ТЗ.
 *
 * Запуск: npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  combineAll,
  combineAny,
  combineAtLeast,
  combineGroup,
  EVALUATED,
  NOT_APPLICABLE,
  type NodeOutcome,
  type ReqStatus,
} from './status.ts';

const ALL_STATUSES: ReqStatus[] = ['MET', 'NOT_MET', 'UNKNOWN', 'CONFLICT'];

/** Все комбинации длины n из четырёх состояний. */
function combos(n: number): ReqStatus[][] {
  if (n === 0) return [[]];
  const rest = combos(n - 1);
  return ALL_STATUSES.flatMap((s) => rest.map((r) => [s, ...r]));
}

test('ENG-02: ALL есть частный случай AT_LEAST(n) на всех комбинациях', () => {
  for (const n of [1, 2, 3]) {
    for (const c of combos(n)) {
      assert.equal(
        combineAll(c),
        combineAtLeast(c, n),
        `ALL(${c.join(',')}) должно совпадать с AT_LEAST(${n})`,
      );
    }
  }
});

test('ENG-02: ANY есть частный случай AT_LEAST(1) на всех комбинациях', () => {
  for (const n of [1, 2, 3]) {
    for (const c of combos(n)) {
      assert.equal(
        combineAny(c),
        combineAtLeast(c, 1),
        `ANY(${c.join(',')}) должно совпадать с AT_LEAST(1)`,
      );
    }
  }
});

test('ENG-02: приоритеты внутри ALL и ANY', () => {
  assert.equal(combineAll(['MET', 'NOT_MET', 'CONFLICT', 'UNKNOWN']), 'NOT_MET');
  assert.equal(combineAll(['MET', 'CONFLICT', 'UNKNOWN']), 'CONFLICT');
  assert.equal(combineAll(['MET', 'UNKNOWN']), 'UNKNOWN');
  assert.equal(combineAll(['MET', 'MET']), 'MET');

  assert.equal(combineAny(['NOT_MET', 'MET', 'CONFLICT']), 'MET');
  assert.equal(combineAny(['NOT_MET', 'CONFLICT', 'UNKNOWN']), 'CONFLICT');
  assert.equal(combineAny(['NOT_MET', 'UNKNOWN']), 'UNKNOWN');
  assert.equal(combineAny(['NOT_MET', 'NOT_MET']), 'NOT_MET');
});

/**
 * Ось истинности (Belnap four-valued logic).
 *
 * Важно: UNKNOWN и CONFLICT НЕСРАВНИМЫ между собой — оба означают
 * «определённого ответа нет», но по разным причинам (нет данных / данные
 * противоречат). Тотального порядка «лучше-хуже» у четырёх состояний не
 * существует, поэтому монотонность проверяется по уровню истинности,
 * а не по произвольной шкале полезности.
 */
const TRUTH_LEVEL: Record<ReqStatus, number> = {
  NOT_MET: 0,
  UNKNOWN: 1,
  CONFLICT: 1,
  MET: 2,
};

test('§16 property: улучшение свидетельства не понижает уровень истинности группы', () => {
  for (const c of combos(3)) {
    for (let i = 0; i < c.length; i++) {
      for (const improved of ALL_STATUSES) {
        // Рассматриваем только настоящие улучшения по оси истинности.
        if (TRUTH_LEVEL[improved] <= TRUTH_LEVEL[c[i]!]) continue;
        const next = [...c];
        next[i] = improved;

        for (const [name, fn] of [
          ['ALL', (x: ReqStatus[]) => combineAll(x)],
          ['ANY', (x: ReqStatus[]) => combineAny(x)],
          ['AT_LEAST(2)', (x: ReqStatus[]) => combineAtLeast(x, 2)],
        ] as const) {
          assert.ok(
            TRUTH_LEVEL[fn(next)] >= TRUTH_LEVEL[fn(c)],
            `${name}: улучшение ${c[i]}→${improved} понизило истинность ${c.join(',')}: ` +
              `${fn(c)} → ${fn(next)}`,
          );
        }
      }
    }
  }
});

test('§16 property: определённый результат не возникает из ничего', () => {
  // Если ни один ребёнок не определён, группа не может стать определённой.
  for (const c of combos(3)) {
    if (c.some((s) => s === 'MET' || s === 'NOT_MET')) continue;
    for (const [name, fn] of [
      ['ALL', (x: ReqStatus[]) => combineAll(x)],
      ['ANY', (x: ReqStatus[]) => combineAny(x)],
    ] as const) {
      assert.equal(
        TRUTH_LEVEL[fn(c)],
        1,
        `${name}(${c.join(',')}) выдал определённый результат ${fn(c)} из неопределённых входов`,
      );
    }
  }
});

test('§16 property: неизвестное обязательное условие никогда не становится MET', () => {
  for (const c of combos(3)) {
    if (!c.includes('UNKNOWN')) continue;
    // В ALL любое UNKNOWN без NOT_MET/CONFLICT не даёт MET.
    if (!c.includes('NOT_MET') && !c.includes('CONFLICT')) {
      assert.notEqual(combineAll(c), 'MET');
    }
    // В AT_LEAST(k) при k больше числа MET результат не MET.
    const met = c.filter((s) => s === 'MET').length;
    assert.notEqual(combineAtLeast(c, met + 1), 'MET');
  }
});

test('AC-03: A AND (B OR C), A=MET, B=NOT_MET, C=MET → MET; при A=UNKNOWN → не MET', () => {
  const inner = combineAny(['NOT_MET', 'MET']);
  assert.equal(inner, 'MET');
  assert.equal(combineAll(['MET', inner]), 'MET');
  assert.equal(combineAll(['UNKNOWN', inner]), 'UNKNOWN');
  assert.notEqual(combineAll(['UNKNOWN', inner]), 'MET');
});

test('AT_LEAST: k вне диапазона отвергается', () => {
  assert.throws(() => combineAtLeast(['MET'], 0), RangeError);
  assert.throws(() => combineAtLeast(['MET'], -1), RangeError);
  assert.throws(() => combineAtLeast(['MET'], 1.5), RangeError);
});

test('AT_LEAST: недостижимая мощность даёт NOT_MET, а не UNKNOWN', () => {
  // Два элемента, нужно три — добрать неоткуда.
  assert.equal(combineAtLeast(['MET', 'UNKNOWN'], 3), 'NOT_MET');
  // Достижима: один MET + один UNKNOWN могут дать два.
  assert.equal(combineAtLeast(['MET', 'UNKNOWN'], 2), 'UNKNOWN');
  // Конфликт важнее неизвестности, когда мощность ещё достижима.
  assert.equal(combineAtLeast(['MET', 'CONFLICT', 'UNKNOWN'], 2), 'CONFLICT');
});

test('REV-04: группа, опустевшая после applicability-фильтрации, не даёт ложный MET', () => {
  const allInapplicable: NodeOutcome[] = [NOT_APPLICABLE, NOT_APPLICABLE];

  // Наивная семантика дала бы ALL(∅) = MET (vacuous truth) и ложный conditions_met.
  assert.deepEqual(combineGroup({ type: 'ALL' }, allInapplicable), NOT_APPLICABLE);
  assert.deepEqual(combineGroup({ type: 'ANY' }, allInapplicable), NOT_APPLICABLE);
  assert.deepEqual(combineGroup({ type: 'AT_LEAST', k: 1 }, allInapplicable), NOT_APPLICABLE);
});

test('REV-04: частично неприменимая группа считается по оставшимся детям', () => {
  const mixed: NodeOutcome[] = [NOT_APPLICABLE, EVALUATED('NOT_MET'), EVALUATED('MET')];
  assert.deepEqual(combineGroup({ type: 'ALL' }, mixed), EVALUATED('NOT_MET'));
  assert.deepEqual(combineGroup({ type: 'ANY' }, mixed), EVALUATED('MET'));
});

test('ENG-08: после фильтрации применимых меньше k → NOT_MET', () => {
  const outcomes: NodeOutcome[] = [NOT_APPLICABLE, NOT_APPLICABLE, EVALUATED('MET')];
  // Применим только один элемент, а требуется два.
  assert.deepEqual(combineGroup({ type: 'AT_LEAST', k: 2 }, outcomes), EVALUATED('NOT_MET'));
});
