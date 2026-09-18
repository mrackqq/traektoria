/**
 * Условия приёма Nazarbayev University — по политике приёма, а не по слухам.
 *
 * До этого в каталоге у NU стояли ЕНТ, «не менее двух профильных предметов»
 * и аттестат первой строкой, а вступительного экзамена не было вовсе. По
 * документу всё наоборот: на грант нужен NUET (или SAT/ACT) и английский,
 * а аттестат с ЕНТ — это порог ПЛАТНОГО приёма, где вступительный экзамен
 * не требуется.
 *
 * Источник: Admission Policy and Procedures, приказ № 38-н/қ от 11.03.2026,
 * Приложение 1. Проверено 18 сентября 2026.
 *
 * Запуск: npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildEmptyProfile } from '../demo/profile.ts';
import { evaluateTree, flattenLeaves, type EvaluatedNode } from '../eligibility/evaluate.ts';
import type { ApplicantProfileRevision, ExamRecord } from '../kernel/profile.ts';
import { known } from '../kernel/profile.ts';
import { buildSeedCatalog } from './seed.ts';

const AT = '2026-09-18T09:00:00.000Z';
const catalog = buildSeedCatalog(AT);
const clock = { now: AT, today: '2026-09-18' as const, timezone: 'Asia/Almaty' };

const nuPaths = catalog.paths.filter((p) => p.id.startsWith('nu-cs-'));
const YEAR = Math.min(...catalog.intakes.filter((i) => i.programId === 'nu-cs').map((i) => i.admissionYear));

function path(suffix: string) {
  const found = nuPaths.find((p) => p.id === `nu-cs-${YEAR}-${suffix}`);
  assert.ok(found, `путь ${suffix} есть в каталоге`);
  return found;
}

function exam(
  examKind: string,
  scaleId: string,
  overall: number,
  components: Record<string, number> = {},
): ExamRecord {
  return {
    id: `test-${examKind}`,
    examKind,
    scaleId,
    state: 'result_reported',
    overall,
    components: Object.entries(components).map(([component, score]) => ({ component, score })),
    resultOn: `${YEAR}-04-01`,
    provenance: 'self_reported',
  };
}

const IELTS_UG = exam('IELTS', 'ielts_0_9', 6.0, { writing: 6.0, reading: 5.5, listening: 5.5, speaking: 5.5 });

/** Школьник 11 класса с аттестатом на руках: всё, кроме экзаменов. */
function schoolLeaver(extra: Partial<ApplicantProfileRevision> = {}): ApplicantProfileRevision {
  const base = buildEmptyProfile(AT, 'test-owner');
  return {
    ...base,
    educationLevel: known('grade_11'),
    documents: [{ documentKind: 'school_certificate', obtained: true, provenance: 'self_reported' }],
    ...extra,
  };
}

function evaluate(suffix: string, profile: ApplicantProfileRevision): EvaluatedNode {
  const p = path(suffix);
  return evaluateTree({
    profile,
    node: p.requirementTree,
    controlDate: `${YEAR}-08-01`,
    catalog,
    clock,
    admissionPathId: p.id,
  });
}

function statusOf(node: EvaluatedNode): string {
  return node.outcome.kind === 'evaluated' ? node.outcome.status : 'NOT_APPLICABLE';
}

function leafStatus(node: EvaluatedNode, idPart: string): string {
  const leaf = flattenLeaves(node).find((l) => l.nodeId.includes(idPart));
  assert.ok(leaf, `лист ${idPart} есть в дереве`);
  return statusOf(leaf);
}

/* ------------------------------------------------------------------ */
/* Грант: вступительный экзамен обязателен                              */
/* ------------------------------------------------------------------ */

test('NUET и английский закрывают грант на бакалавриат', () => {
  const profile = schoolLeaver({
    exams: [IELTS_UG, exam('NUET', 'nuet_0_240', 140, { math: 70, critical_thinking: 70 })],
  });

  assert.equal(statusOf(evaluate('ug-grant', profile)), 'MET');
});

test('Предметный минимум NUET проверяется отдельно от общего балла', () => {
  // 140 общего балла хватает, но по математике 45 при минимуме 50.
  const profile = schoolLeaver({
    exams: [IELTS_UG, exam('NUET', 'nuet_0_240', 140, { math: 45, critical_thinking: 95 })],
  });

  const tree = evaluate('ug-grant', profile);
  assert.equal(statusOf(tree), 'NOT_MET');
  assert.equal(leafStatus(tree, 'nuet-math'), 'NOT_MET');
  assert.equal(leafStatus(tree, 'nuet-overall'), 'MET');
});

test('SAT 1240 — равноправная замена NUET на гранте', () => {
  const profile = schoolLeaver({
    exams: [IELTS_UG, exam('SAT', 'sat_400_1600', 1240)],
  });

  assert.equal(statusOf(evaluate('ug-grant', profile)), 'MET');
});

test('Отличный аттестат грант НЕ открывает', () => {
  // Ровно то заблуждение, из-за которого каталог и переписан: аттестат —
  // порог платного приёма, в конкурсе на грант он не участвует.
  const profile = schoolLeaver({
    exams: [IELTS_UG],
    grades: [{ scaleId: 'gpa_5', value: 5.0, provenance: 'self_reported' }],
  });

  assert.notEqual(statusOf(evaluate('ug-grant', profile)), 'MET');

  const ids = flattenLeaves(evaluate('ug-grant', profile)).map((l) => l.nodeId);
  assert.ok(!ids.some((id) => id.includes('gpa')), 'среднего балла нет в дереве гранта');
});

/* ------------------------------------------------------------------ */
/* Платное: аттестат ИЛИ ЕНТ, вступительный экзамен не нужен             */
/* ------------------------------------------------------------------ */

test('Аттестат 4.0 и английский закрывают платный бакалавриат без NUET', () => {
  const profile = schoolLeaver({
    exams: [IELTS_UG],
    grades: [{ scaleId: 'gpa_5', value: 4.0, provenance: 'self_reported' }],
  });

  assert.equal(statusOf(evaluate('ug-paid', profile)), 'MET');
});

test('ЕНТ 85 с грамотностями 8 из 10 — вторая дорога на платное', () => {
  const profile = schoolLeaver({
    exams: [
      IELTS_UG,
      exam('ЕНТ', 'ent_0_140', 90, { math_literacy: 8, reading_literacy: 8 }),
    ],
  });

  assert.equal(statusOf(evaluate('ug-paid', profile)), 'MET');
});

test('ЕНТ с провалом по грамотности чтения платное не закрывает', () => {
  const profile = schoolLeaver({
    exams: [
      IELTS_UG,
      exam('ЕНТ', 'ent_0_140', 120, { math_literacy: 9, reading_literacy: 6 }),
    ],
  });

  assert.notEqual(statusOf(evaluate('ug-paid', profile)), 'MET');
});

/* ------------------------------------------------------------------ */
/* Английский                                                          */
/* ------------------------------------------------------------------ */

test('Порог по Writing проверяется отдельно от общего балла', () => {
  const weakWriting = exam('IELTS', 'ielts_0_9', 6.5, {
    writing: 5.5, reading: 6.5, listening: 7.0, speaking: 6.5,
  });
  const profile = schoolLeaver({
    exams: [weakWriting, exam('NUET', 'nuet_0_240', 140, { math: 70, critical_thinking: 70 })],
  });

  const tree = evaluate('ug-grant', profile);
  assert.equal(statusOf(tree), 'NOT_MET');
  assert.equal(leafStatus(tree, 'lang-writing'), 'NOT_MET');
  assert.equal(leafStatus(tree, 'lang-overall'), 'MET');
});

test('Подготовительный год мягче бакалавриата по английскому', () => {
  // IELTS 5.5 с listening 5.0: на NUFYP проходит, на бакалавриат нет.
  const profile = schoolLeaver({
    exams: [
      exam('IELTS', 'ielts_0_9', 5.5, { writing: 5.5, reading: 5.5, listening: 5.0, speaking: 5.0 }),
      exam('NUET', 'nuet_0_240', 130, { math: 65, critical_thinking: 65 }),
    ],
  });

  assert.equal(statusOf(evaluate('nufyp-grant', profile)), 'MET');
  assert.equal(statusOf(evaluate('ug-grant', profile)), 'NOT_MET');
});

/* ------------------------------------------------------------------ */
/* Структура каталога                                                  */
/* ------------------------------------------------------------------ */

test('У NU четыре разных входа, а не «грант и платное»', () => {
  const labels = nuPaths.filter((p) => p.intakeId === `nu-cs-${YEAR}`).map((p) => p.label);

  assert.deepEqual(labels.sort(), [
    'Foundation Year (NUFYP), грант',
    'Foundation Year (NUFYP), платное',
    'Бакалавриат напрямую, грант',
    'Бакалавриат напрямую, платное',
  ]);
});

test('Аттестат стоит в документах к зачислению и не критичен', () => {
  const tree = evaluate('ug-grant', schoolLeaver());
  const docs = flattenLeaves(tree).find((l) => l.nodeId.includes('docs-certificate'));

  assert.ok(docs, 'лист аттестата есть');
  assert.equal(docs.critical, false, 'аттестат не отбирает, а подтверждает');

  // И он не первый среди условий: конкурс — это экзамены.
  const first = flattenLeaves(tree)[0];
  assert.ok(first?.nodeId.includes('lang'), 'первым проверяется английский');
});

test('Профильных предметов и порога ЕНТ в грантовом дереве NU нет', () => {
  const ids = flattenLeaves(evaluate('ug-grant', schoolLeaver())).map((l) => l.nodeId);

  assert.ok(!ids.some((id) => id.includes('stem')), 'профильных предметов у NU нет');
  assert.ok(!ids.some((id) => id.includes('-ent-')), 'ЕНТ в конкурсе на грант не участвует');
});

test('Контрольная дата действительности сертификатов — 1 августа', () => {
  const intake = catalog.intakes.find((i) => i.id === `nu-cs-${YEAR}`);
  assert.equal(intake?.resultValidityControlDate, `${YEAR}-08-01`);
});

test('Стоимость обучения указана в долларах по странице NU', () => {
  const paid = path('ug-paid').costs.find((c) => c.category === 'tuition');
  assert.ok(paid);
  assert.equal(paid.min.currency, 'USD');
  assert.equal(Number(paid.min.amountMinor) / 100, 15_000);

  const foundation = path('nufyp-paid').costs.find((c) => c.category === 'tuition');
  assert.equal(Number(foundation?.min.amountMinor) / 100, 12_000);
});

test('Грант покрывает обучение и честно описан как конкурс', () => {
  const funding = path('ug-grant').funding[0];
  assert.ok(funding);
  assert.equal(funding.coverage, 'tuition_full');
  assert.match(funding.conditions ?? '', /аттестата в конкурсе на грант не участвует/);
  assert.match(funding.conditions ?? '', /Проходной балл/);
});
