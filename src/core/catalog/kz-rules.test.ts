/**
 * Государственные правила приёма: данные сверены с первоисточником.
 *
 * Эти цифры — не наша выдумка и не оценка: они взяты из перечня Национального
 * центра тестирования и приказа о пороговых баллах. Тест фиксирует те из них,
 * которые легко испортить при правке, и держит связь с подписями предметов:
 * пара, которую не умеем назвать по-русски, на экране станет кодом.
 *
 * Запуск: npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { subjectRu } from '../i18n/labels.ts';
import {
  ENT_BLOCKS,
  ENT_GRANT_THRESHOLD,
  ENT_MAX_SCORE,
  PROGRAM_GROUPS,
  programGroup,
} from './kz-rules.ts';

test('ЕНТ: пять блоков и 140 баллов максимум', () => {
  assert.equal(ENT_BLOCKS.length, 5);
  assert.equal(ENT_MAX_SCORE, 140);

  assert.deepEqual(
    ENT_BLOCKS.map((b) => [b.id, b.questions, b.maxScore, b.minScore]),
    [
      ['history_kz', 20, 20, 5],
      ['math_literacy', 10, 10, 3],
      ['reading_literacy', 10, 10, 3],
      ['profile_1', 40, 50, 5],
      ['profile_2', 40, 50, 5],
    ],
  );
});

test('Пороги допуска к конкурсу на грант — 2026', () => {
  assert.equal(ENT_GRANT_THRESHOLD.pedagogy_law, 75);
  assert.equal(ENT_GRANT_THRESHOLD.healthcare, 70);
  assert.equal(ENT_GRANT_THRESHOLD.national_university, 65);
  assert.equal(ENT_GRANT_THRESHOLD.other, 50);
});

test('Профильные пары ключевых направлений совпадают с перечнем', () => {
  // Сверено с приёмными страницами AITU и КБТУ: IT — математика с
  // информатикой, связь — с физикой, право — всемирная история с правом.
  assert.deepEqual(programGroup('В057')?.profileSubjects, ['math', 'informatics']);
  assert.deepEqual(programGroup('В058')?.profileSubjects, ['math', 'informatics']);
  assert.deepEqual(programGroup('В059')?.profileSubjects, ['math', 'physics']);
  assert.deepEqual(programGroup('В044')?.profileSubjects, ['math', 'geography']);
  assert.deepEqual(programGroup('В049')?.profileSubjects, ['world_history', 'law_basics']);
  assert.deepEqual(programGroup('В042')?.profileSubjects, ['creative_exam', 'creative_exam']);
});

test('Перечень загружен целиком и без дубликатов', () => {
  assert.equal(PROGRAM_GROUPS.length, 125);

  const codes = new Set(PROGRAM_GROUPS.map((g) => g.code));
  assert.equal(codes.size, PROGRAM_GROUPS.length, 'коды групп уникальны');

  for (const group of PROGRAM_GROUPS) {
    assert.match(group.code, /^ВМ?\d{3}$/, `код группы: ${group.code}`);
    assert.ok(group.title.length > 2, `название группы: ${group.code}`);
    assert.equal(group.profileSubjects.length, 2, `пара предметов: ${group.code}`);
  }
});

test('Незнакомый код группы не выдумывается', () => {
  assert.equal(programGroup('В999'), null);
  assert.equal(programGroup(''), null);
});

test('Каждый профильный предмет умеем назвать по-русски', () => {
  const codes = new Set(PROGRAM_GROUPS.flatMap((g) => [...g.profileSubjects]));

  for (const code of codes) {
    const ru = subjectRu(code);
    assert.notEqual(ru, code, `подпись для «${code}» отсутствует — на экране будет код`);
    assert.match(ru, /^[а-яё]/u, `подпись «${ru}» должна быть русской`);
  }
});

test('Всемирная история и история Казахстана — разные предметы', () => {
  // История Казахстана — обязательный блок ЕНТ, всемирная история —
  // профильный предмет. Их смешение меняло бы смысл требования.
  assert.notEqual(subjectRu('world_history'), subjectRu('history'));
  assert.equal(subjectRu('history'), 'история Казахстана');
  assert.equal(subjectRu('world_history'), 'всемирная история');
});
