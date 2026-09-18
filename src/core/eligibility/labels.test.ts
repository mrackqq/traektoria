/**
 * Русские подписи в тексте требований.
 *
 * Объяснения и свидетельства читает человек, а `school_certificate`,
 * `grade_11`, `gpa_5` и `kz_citizen` — ключи данных. Раньше они попадали
 * в текст как есть: «Документ «school_certificate» ещё не получен».
 *
 * Проверяется именно ТЕКСТ. Предикаты, статусы и правила подбора здесь не
 * участвуют: те же деревья оцениваются обычным `evaluateTree`, а тест
 * смотрит только на `explanation` и `evidence`.
 *
 * Запуск: npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSeedCatalog } from '../catalog/seed.ts';
import { buildDemoProfile } from '../demo/profile.ts';
import type { LeafPredicate, RequirementNode } from '../kernel/requirement.ts';
import { evaluateTree, flattenLeaves, type EvaluatedNode } from './evaluate.ts';

const AT = '2026-09-18T09:00:00.000Z';
const CONTROL_DATE = '2027-07-01';

const catalog = buildSeedCatalog(AT);
const clock = { now: AT, today: '2026-09-18' as const, timezone: 'Asia/Almaty' };
const profile = buildDemoProfile(AT, 'demo-user');

/** Один лист с нужным предикатом — без источников, чтобы не мешала свежесть. */
function leafOf(predicate: LeafPredicate): RequirementNode {
  return {
    nodeType: 'LEAF',
    id: 'test-leaf',
    title: 'Проверка подписи',
    countingKey: 'test',
    critical: false,
    sourceRefs: [],
    predicate,
  };
}

function evaluate(predicate: LeafPredicate): EvaluatedNode {
  return evaluateTree({
    profile,
    node: leafOf(predicate),
    controlDate: CONTROL_DATE,
    catalog,
    clock,
    admissionPathId: 'sdu-cs-2027-paid',
  });
}

/** Весь текст узла одной строкой: объяснение и подписи свидетельств. */
function textOf(node: EvaluatedNode): string {
  return [node.explanation, ...node.evidence.map((e) => `${e.label}=${e.value}`)].join(' | ');
}

test('Документ называется по-русски, а не кодом', () => {
  // В демо-профиле аттестат ещё не получен.
  const text = textOf(evaluate({ type: 'document', documentKind: 'school_certificate' }));

  assert.match(text, /аттестат о среднем образовании/);
  assert.ok(!text.includes('school_certificate'), 'кода документа в тексте нет');
});

test('Полученный документ подписан по-русски в свидетельствах', () => {
  const withDoc = evaluateTree({
    profile: {
      ...profile,
      documents: [{ documentKind: 'id_document', obtained: true, provenance: 'self_reported' }],
    },
    node: leafOf({ type: 'document', documentKind: 'id_document' }),
    controlDate: CONTROL_DATE,
    catalog,
    clock,
    admissionPathId: 'sdu-cs-2027-paid',
  });

  assert.equal(withDoc.outcome.kind === 'evaluated' && withDoc.outcome.status, 'MET');
  assert.deepEqual(withDoc.evidence, [{ label: 'удостоверение личности', value: 'получен' }]);
});

test('Уровень образования называется по-русски и в объяснении, и в свидетельстве', () => {
  // Демо-профиль — 11 класс, требуется выпускник школы.
  const mismatch = textOf(evaluate({ type: 'education_level', allowed: ['school_graduate'] }));

  assert.match(mismatch, /Требуется один из уровней: выпускник школы\./);
  assert.match(mismatch, /Ваш уровень=11 класс/);
  assert.ok(!mismatch.includes('grade_11'), 'кода уровня в тексте нет');
  assert.ok(!mismatch.includes('school_graduate'), 'кода требуемого уровня в тексте нет');

  // Совпадение: уровень попадает в свидетельство той же подписью.
  const match = evaluate({ type: 'education_level', allowed: ['grade_11', 'school_graduate'] });
  assert.deepEqual(match.evidence, [{ label: 'Уровень образования', value: '11 класс' }]);
});

test('Список допустимых уровней переводится целиком', () => {
  const text = textOf(
    evaluate({ type: 'education_level', allowed: ['college_student', 'college_graduate'] }),
  );

  assert.match(text, /Требуется один из уровней: студент колледжа, выпускник колледжа\./);
});

test('Категория заявителя называется по-русски', () => {
  const mismatch = textOf(evaluate({ type: 'applicant_category', allowed: ['foreign', 'kandas'] }));

  assert.match(mismatch, /Путь доступен категориям: иностранный заявитель, кандас\./);
  assert.match(mismatch, /Ваша категория=гражданин Казахстана/);
  assert.ok(!mismatch.includes('kz_citizen'), 'кода категории в тексте нет');

  const match = evaluate({ type: 'applicant_category', allowed: ['kz_citizen'] });
  assert.deepEqual(match.evidence, [{ label: 'Категория', value: 'гражданин Казахстана' }]);
});

test('Предмет называется по-русски', () => {
  const missing = textOf(evaluate({ type: 'subject', subjectId: 'chemistry' }));
  assert.match(missing, /Предмет «химия» не указан в профиле\./);
  assert.ok(!missing.includes('chemistry'), 'кода предмета в тексте нет');

  const present = evaluate({ type: 'subject', subjectId: 'math' });
  assert.equal(present.evidence[0]?.label, 'математика');
});

test('Шкала среднего балла называется по-русски', () => {
  // Демо-профиль: 4.6 по пятибалльной шкале.
  const below = textOf(evaluate({ type: 'gpa', scaleId: 'gpa_5', min: 5 }));
  assert.match(below, /Средний балл 4\.6 при минимуме 5 \(пятибалльная шкала\)\./);
  assert.match(below, /Средний балл \(пятибалльная шкала\)=4\.6/);
  assert.ok(!below.includes('gpa_5'), 'кода шкалы в тексте нет');

  // Шкалы, которой нет в профиле, — то же правило.
  const unknown = textOf(evaluate({ type: 'gpa', scaleId: 'ent_0_140', min: 90 }));
  assert.match(unknown, /Средний балл \(шкала ЕНТ 0–140\) не указан\./);
  assert.ok(!unknown.includes('ent_0_140'), 'кода шкалы в тексте нет');
});

test('Неизвестный код возвращается как есть, а не прячется', () => {
  // Правило i18n: незнакомый ключ виден при проверке, «—» не подставляется.
  const text = textOf(evaluate({ type: 'subject', subjectId: 'astronomy' }));
  assert.match(text, /Предмет «astronomy» не указан в профиле\./);
});

test('Ни в одном условии каталога не осталось внутренних кодов', () => {
  // Сквозная проверка по настоящим деревьям требований: подписи не должны
  // зависеть от того, какой путь открыл пользователь.
  const CODES = [
    'school_certificate', 'certified_translation', 'college_diploma', 'id_document',
    'grade_9', 'grade_10', 'grade_11', 'school_graduate', 'college_student', 'college_graduate',
    'kz_citizen', 'foreign', 'kandas', 'rural_quota',
    'gpa_5', 'ielts_0_9', 'toefl_0_120', 'ent_0_140', 'ent_subject',
    'math', 'physics', 'informatics', 'chemistry', 'biology', 'geography', 'history',
  ];

  const found: string[] = [];
  for (const path of catalog.paths) {
    const tree = evaluateTree({
      profile,
      node: path.requirementTree,
      controlDate: CONTROL_DATE,
      catalog,
      clock,
      admissionPathId: path.id,
    });

    for (const leaf of flattenLeaves(tree)) {
      const text = textOf(leaf);
      for (const code of CODES) {
        if (text.includes(code)) found.push(`${path.id} · ${leaf.nodeId}: ${code} → ${text}`);
      }
    }
  }

  assert.deepEqual(found, [], 'внутренние коды в пользовательском тексте');
});
