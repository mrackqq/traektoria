/**
 * UX-02 / PF-02 / PRIV-01 — анкета.
 *
 * Проверяется то, что легко сломать незаметно: условный вопрос, различие
 * четырёх состояний ответа, привязка ошибки к полю и отсутствие в схеме
 * запрещённых к сбору данных.
 *
 * Запуск: npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyDraftToProfile,
  completeness,
  draftFromProfile,
  findStep,
  STEPS,
  validateStep,
  visibleFields,
  type Answer,
  type DraftValues,
  type ProfileDraft,
} from './questionnaire.ts';
import { buildDemoProfile } from '../demo/profile.ts';

const AT = '2026-09-18T09:00:00Z';

// Демо-профиль строится от часов: фиксируем момент, чтобы тест был воспроизводим.
const DEMO_PROFILE = buildDemoProfile(AT);

function draft(values: DraftValues): ProfileDraft {
  return { revision: 1, basedOnProfileRevision: 1, updatedAt: AT, values };
}

const answer = (value: string): Answer => ({ state: 'answered', value });

test('UX-02: условный вопрос появляется только при применимости', () => {
  const direction = findStep('direction');

  const withoutEnglish = visibleFields(direction, {
    instructionLanguages: { state: 'answered', value: ['ru'] },
  });
  assert.equal(
    withoutEnglish.some((f) => f.id === 'englishCefr'),
    false,
    'вопрос про CEFR не нужен, если английский не выбран',
  );

  const withEnglish = visibleFields(direction, {
    instructionLanguages: { state: 'answered', value: ['ru', 'en'] },
  });
  assert.equal(withEnglish.some((f) => f.id === 'englishCefr'), true);
});

test('UX-02: вопрос о дате выпуска не задаётся тем, кто уже выпустился', () => {
  const education = findStep('education');

  const student = visibleFields(education, { educationLevel: answer('grade_11') });
  assert.equal(student.some((f) => f.id === 'expectedGraduation'), true);

  const graduate = visibleFields(education, { educationLevel: answer('school_graduate') });
  assert.equal(graduate.some((f) => f.id === 'expectedGraduation'), false);
});

test('PF-02: «не знаю», «не применимо» и «не заполнено» — три разных исхода', () => {
  const base = DEMO_PROFILE;

  const unknown = applyDraftToProfile(
    base,
    draft({ citizenship: { state: 'dont_know' } }),
    AT,
  );
  assert.equal(unknown.citizenship.state, 'dont_know');

  const notApplicable = applyDraftToProfile(
    base,
    draft({ citizenship: { state: 'not_applicable' } }),
    AT,
  );
  assert.equal(notApplicable.citizenship.state, 'not_applicable');

  const empty = applyDraftToProfile(base, draft({ citizenship: { state: 'unanswered' } }), AT);
  assert.equal(empty.citizenship.state, 'unanswered');

  const zero = applyDraftToProfile(base, draft({ weeklyHours: answer('0') }), AT);
  assert.equal(zero.weeklyHours.state, 'known');
  if (zero.weeklyHours.state !== 'known') return;
  assert.equal(zero.weeklyHours.value, 0, 'ноль — это значение, а не отсутствие ответа');
});

test('UX-02: ошибка валидации привязана к полю, «не знаю» ошибкой не является', () => {
  const step = findStep('education');

  const bad = validateStep(step, { gpa: answer('7') });
  assert.equal(bad.length, 1);
  assert.equal(bad[0]!.fieldId, 'gpa');

  const unknown = validateStep(step, { gpa: { state: 'dont_know' } });
  assert.deepEqual(unknown, [], '«не знаю» — валидный ответ');

  const emptyStep = validateStep(step, {});
  assert.deepEqual(emptyStep, [], 'незаполненная анкета не является ошибкой');
});

test('MODEL-02: применение анкеты создаёт новую ревизию и не трогает результаты', () => {
  const before = {
    ...DEMO_PROFILE,
    exams: [
      {
        id: 'exam-ENT-2026',
        examKind: 'ЕНТ',
        scaleId: 'ent_0_140',
        state: 'result_reported' as const,
        overall: 120,
        takenOn: '2026-06-20',
        resultOn: '2026-06-25',
        provenance: 'self_reported' as const,
      },
    ],
  };

  const after = applyDraftToProfile(
    before,
    draft({
      educationLevel: answer('school_graduate'),
      gpa: answer('4.9'),
      weeklyHours: answer('20'),
    }),
    AT,
    'Заполнение анкеты',
  );

  assert.equal(after.revision, before.revision + 1);
  assert.equal(after.changeReason, 'Заполнение анкеты');
  assert.deepEqual(
    after.exams,
    before.exams,
    'экзамен, по которому в анкете нет ответа, сохраняется как есть',
  );
  assert.deepEqual(after.documents, before.documents);
  assert.equal(before.grades.find((g) => g.scaleId === 'gpa_5')?.value, 4.6, 'исходная ревизия цела');
  assert.equal(after.grades.find((g) => g.scaleId === 'gpa_5')?.value, 4.9);
  assert.equal(
    after.grades.find((g) => g.scaleId === 'gpa_5')?.provenance,
    'self_reported',
    'PF-05: у введённого вручную значения происхождение «с ваших слов»',
  );
});

test('Нераспознанное значение не становится «известным»', () => {
  const after = applyDraftToProfile(
    DEMO_PROFILE,
    draft({ educationLevel: answer('нет такого уровня'), admissionYear: answer('не число') }),
    AT,
  );

  assert.equal(after.educationLevel.state, 'unanswered');
  assert.equal(after.admissionYear.state, 'unanswered');
});

test('Черновик из профиля переносит все четыре состояния обратно', () => {
  const d = draftFromProfile(DEMO_PROFILE, AT);

  assert.equal(d.basedOnProfileRevision, DEMO_PROFILE.revision);
  assert.equal(d.values['educationLevel']?.state, 'answered');
  assert.equal(d.values['educationLevel']?.value, 'grade_11');
  assert.equal(d.values['gpa']?.value, '4.6');

  // Круговой прогон: профиль → черновик → профиль не теряет ответов.
  const back = applyDraftToProfile(DEMO_PROFILE, d, AT);
  assert.deepEqual(back.interests, DEMO_PROFILE.interests);
  assert.deepEqual(back.instructionLanguages, DEMO_PROFILE.instructionLanguages);
  assert.equal(back.weeklyHours.state, 'known');
  assert.equal(back.budget.state, 'known');
  if (back.budget.state !== 'known') return;
  assert.equal(
    back.budget.value.limit.amountMinor,
    (DEMO_PROFILE.budget.state === 'known' ? DEMO_PROFILE.budget.value.limit.amountMinor : 0n),
    'сумма не теряется на круге профиль → анкета → профиль',
  );
});

test('PRIV-01: в анкете нет полей, которые нельзя собирать', () => {
  const forbiddenIds = ['birth', 'passport', 'iin', 'address', 'medical', 'scan', 'document_scan'];
  const forbiddenLabels = ['рожден', 'паспорт', 'иин', 'адрес', 'медицин', 'скан', 'диагноз'];

  for (const step of STEPS) {
    for (const field of step.fields) {
      const id = field.id.toLowerCase();
      const label = field.label.toLowerCase();

      for (const bad of forbiddenIds) {
        assert.equal(id.includes(bad), false, `поле ${field.id} собирает запрещённое (${bad})`);
      }
      for (const bad of forbiddenLabels) {
        assert.equal(
          label.includes(bad),
          false,
          `подпись «${field.label}» просит запрещённое (${bad})`,
        );
      }
    }
  }
});

test('Индикатор заполненности считает только применимые вопросы', () => {
  const partial: DraftValues = {
    educationLevel: answer('grade_11'),
    instructionLanguages: { state: 'answered', value: ['ru'] },
  };

  const a = completeness(partial);
  assert.equal(a.answered, 2);

  // Английский добавляет ещё один применимый вопрос — знаменатель растёт.
  const withEnglish = completeness({
    ...partial,
    instructionLanguages: { state: 'answered', value: ['ru', 'en'] },
  });
  assert.equal(withEnglish.visible, a.visible + 1);
});
