import test from 'node:test';
import assert from 'node:assert/strict';
import { readableLabel } from './readable-label.ts';

test('UI: внутренние коды документа и класса показываются человеческими названиями', () => {
  assert.equal(readableLabel('Документ «school_certificate» ещё не получен.'), 'Документ «аттестат о среднем образовании» ещё не получен.');
  assert.equal(readableLabel('grade_11'), '11 класс');
});

test('UI: подписи не меняют неизвестные ключи, баллы и обычный текст', () => {
  assert.equal(readableLabel('IELTS 6.5, новый код custom_unknown'), 'IELTS 6.5, новый код custom_unknown');
  assert.equal(readableLabel('math · gpa_5 · kz_citizen'), 'математика · пятибалльная шкала · гражданин Казахстана');
});
