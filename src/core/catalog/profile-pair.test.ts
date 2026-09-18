/**
 * Профильная пара ЕНТ — самый жёсткий фильтр казахстанского приёма.
 *
 * Пара закреплена за группой образовательных программ. С чужой парой подать
 * на специальность нельзя вообще, каким бы высоким ни был балл, а менять её
 * после первой попытки основного этапа не разрешено. До этого каталог
 * проверял «изучали ли вы предмет» — совсем не то же самое.
 *
 * Запуск: npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildEmptyProfile } from '../demo/profile.ts';
import { evaluateTree, flattenLeaves } from '../eligibility/evaluate.ts';
import type { ApplicantProfileRevision } from '../kernel/profile.ts';
import { known } from '../kernel/profile.ts';
import type { RequirementNode } from '../kernel/requirement.ts';
import {
  PROFILE_PAIRS,
  PROGRAM_GROUPS,
  findProfilePair,
  pairForGroup,
  profilePairId,
  samePair,
} from './kz-rules.ts';
import { buildSeedCatalog } from './seed.ts';

const AT = '2026-09-18T09:00:00.000Z';
const catalog = buildSeedCatalog(AT);
const clock = { now: AT, today: '2026-09-18' as const, timezone: 'Asia/Almaty' };

function leafFor(subjects: readonly [string, string], groupCode: string): RequirementNode {
  return {
    nodeType: 'LEAF', id: 'pair-leaf', title: 'Профильная пара',
    countingKey: 'exam:ent:pair', critical: true, sourceRefs: [],
    predicate: { type: 'ent_profile_pair', subjects, groupCode },
  };
}

function evaluatePair(profile: ApplicantProfileRevision, subjects: readonly [string, string]) {
  const tree = evaluateTree({
    profile, node: leafFor(subjects, 'В057'), controlDate: '2027-08-01',
    catalog, clock, admissionPathId: 'test',
  });
  return {
    status: tree.outcome.kind === 'evaluated' ? tree.outcome.status : 'NOT_APPLICABLE',
    explanation: tree.explanation,
    evidence: tree.evidence,
  };
}

const profileWith = (pair: readonly [string, string]) => ({
  ...buildEmptyProfile(AT, 'test-owner'),
  entProfilePair: known(pair),
});

/* ------------------------------------------------------------------ */
/* Предикат                                                            */
/* ------------------------------------------------------------------ */

test('Своя пара закрывает условие', () => {
  const r = evaluatePair(profileWith(['math', 'informatics']), ['math', 'informatics']);
  assert.equal(r.status, 'MET');
});

test('Порядок предметов в паре не имеет значения', () => {
  // Перечень называет первый и второй профильный, но сданный набор
  // от перестановки не меняется.
  const r = evaluatePair(profileWith(['informatics', 'math']), ['math', 'informatics']);
  assert.equal(r.status, 'MET');
});

test('Чужая пара — отказ, и в объяснении названы обе', () => {
  const r = evaluatePair(profileWith(['math', 'physics']), ['math', 'informatics']);

  assert.equal(r.status, 'NOT_MET');
  assert.match(r.explanation, /Нужна пара «математика и информатика»/);
  assert.match(r.explanation, /вы сдаёте «математика и физика»/);
  assert.match(r.explanation, /независимо от балла/);
  assert.deepEqual(r.evidence.map((e) => e.label), ['Нужная пара', 'Ваша пара']);
});

test('Невыбранная пара — «неизвестно», а не отказ', () => {
  // Десятикласснику пару ещё предстоит выбрать: отказывать не за что.
  const r = evaluatePair(buildEmptyProfile(AT, 'test-owner'), ['math', 'informatics']);

  assert.equal(r.status, 'UNKNOWN');
  assert.match(r.explanation, /Не указано, какой парой/);
});

/* ------------------------------------------------------------------ */
/* Справочник пар                                                      */
/* ------------------------------------------------------------------ */

test('Пары схлопнуты по составу, а не по порядку', () => {
  for (const a of PROFILE_PAIRS) {
    const twins = PROFILE_PAIRS.filter((b) => samePair(a.subjects, b.subjects));
    assert.equal(twins.length, 1, `пара ${a.id} встречается один раз`);
  }
});

test('У каждой группы программ есть пара из справочника', () => {
  for (const group of PROGRAM_GROUPS) {
    const pair = pairForGroup(group.code);
    assert.ok(pair, `у группы ${group.code} есть пара`);
    assert.ok(samePair(pair.subjects, group.profileSubjects), `пара группы ${group.code} совпадает`);
  }
});

test('Группы, доступные с парой, перечислены полностью', () => {
  const pair = findProfilePair(profilePairId('math', 'informatics'));
  assert.ok(pair);

  // В057 «Информационные технологии» и В058 «Информационная безопасность».
  assert.ok(pair.groups.includes('В057'));
  assert.ok(pair.groups.includes('В058'));

  for (const code of pair.groups) {
    assert.ok(samePair(pairForGroup(code)!.subjects, pair.subjects), `группа ${code} из этой пары`);
  }
});

test('Неизвестная пара не выдумывается', () => {
  assert.equal(findProfilePair('math+astronomy'), null);
  assert.equal(pairForGroup('В999'), null);
});

/* ------------------------------------------------------------------ */
/* Каталог                                                             */
/* ------------------------------------------------------------------ */

test('У казахстанских программ ЕНТ проверяется парой, суммой и блоками', () => {
  const kz = catalog.paths.find((p) => p.id.startsWith('kbtu-cs-'));
  assert.ok(kz, 'путь КБТУ есть в каталоге');

  const ids = flattenLeaves(
    evaluateTree({
      profile: buildEmptyProfile(AT, 'test-owner'), node: kz.requirementTree,
      controlDate: '2027-08-01', catalog, clock, admissionPathId: kz.id,
    }),
  ).map((l) => l.nodeId);

  assert.ok(ids.some((id) => id.endsWith('-ent-pair')), 'профильная пара проверяется');
  assert.ok(ids.some((id) => id.endsWith('-ent-overall')), 'сумма проверяется');

  for (const block of ['history_kz', 'math_literacy', 'reading_literacy', 'profile_1', 'profile_2']) {
    assert.ok(ids.some((id) => id.endsWith(`-ent-${block}`)), `блок ${block} проверяется`);
  }

  // Старая проверка «изучали ли вы предмет» ушла: она про другое.
  assert.ok(!ids.some((id) => id.includes('-stem-')), 'списка изучаемых предметов больше нет');
});

test('IT-программа требует математику с информатикой, экономическая — с географией', () => {
  const pairOf = (prefix: string) => {
    const p = catalog.paths.find((x) => x.id.startsWith(prefix));
    assert.ok(p, `путь ${prefix} есть`);
    const leaf = flattenLeaves(
      evaluateTree({
        profile: buildEmptyProfile(AT, 'test-owner'), node: p.requirementTree,
        controlDate: '2027-08-01', catalog, clock, admissionPathId: p.id,
      }),
    ).find((l) => l.nodeId.endsWith('-ent-pair'));
    assert.ok(leaf, `у ${prefix} есть лист пары`);
    return leaf.title;
  };

  assert.match(pairOf('kbtu-cs-'), /математика и информатика/);
  assert.match(pairOf('kbtu-fin-'), /математика и география/);
  assert.match(pairOf('satbayev-eng-'), /математика и физика/);
});

test('Абитуриент с чужой парой не проходит на IT-программу', () => {
  const kz = catalog.paths.find((p) => p.id.startsWith('kbtu-cs-'));
  assert.ok(kz);

  const tree = evaluateTree({
    profile: profileWith(['biology', 'chemistry']), node: kz.requirementTree,
    controlDate: '2027-08-01', catalog, clock, admissionPathId: kz.id,
  });

  const pairLeaf = flattenLeaves(tree).find((l) => l.nodeId.endsWith('-ent-pair'));
  assert.equal(pairLeaf?.outcome.kind === 'evaluated' && pairLeaf.outcome.status, 'NOT_MET');
  assert.equal(tree.outcome.kind === 'evaluated' && tree.outcome.status, 'NOT_MET');
});
