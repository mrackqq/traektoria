/**
 * Описание формы результата для конкретного действия.
 *
 * TASK-02: результат — это структурированное значение с происхождением,
 * поэтому поля формы выводятся из вида действия, а не пишутся руками на
 * каждой странице. Идентификаторы шкал и видов документов берутся теми же,
 * что используют условия каталога, — иначе введённый результат не закрыл бы
 * требование, и пользователь получил бы «ввёл, а ничего не изменилось».
 */

import type { ScheduledTask } from '@core/planning/bridge';

export interface ResultField {
  readonly name: string;
  readonly label: string;
  readonly type: 'number' | 'date' | 'text';
  readonly required: boolean;
  readonly hint?: string;
  readonly step?: string;
}

export interface ResultSpec {
  readonly resultKind: 'exam_score' | 'document' | 'grade' | 'subject';
  readonly title: string;
  readonly hiddenFields: Readonly<Record<string, string>>;
  readonly fields: readonly ResultField[];
}

const EXAM_BY_PREFIX: Record<string, { examKind: string; scaleId: string; components: string[]; step: string }> = {
  ielts: { examKind: 'IELTS', scaleId: 'ielts_0_9', components: ['writing'], step: '0.5' },
  toefl: { examKind: 'TOEFL', scaleId: 'toefl_0_120', components: [], step: '1' },
  ent: { examKind: 'ЕНТ', scaleId: 'ent_0_140', components: [], step: '1' },
};

const COMPONENT_LABEL_RU: Record<string, string> = {
  writing: 'Writing',
  reading: 'Reading',
  listening: 'Listening',
  speaking: 'Speaking',
};

/** null — у действия нет собственного результата, оно закрывается отметкой. */
export function resultSpecFor(task: ScheduledTask): ResultSpec | null {
  const prefix = task.semanticKey.split(':')[0] ?? '';

  switch (task.template.kind) {
    case 'await_result': {
      const exam = EXAM_BY_PREFIX[prefix];
      if (!exam) return null;
      return {
        resultKind: 'exam_score',
        title: `Результат ${exam.examKind}`,
        hiddenFields: { examKind: exam.examKind, scaleId: exam.scaleId },
        fields: [
          {
            name: 'overall',
            label: 'Общий балл',
            type: 'number',
            required: true,
            step: exam.step,
            hint: 'Так, как он напечатан в официальном отчёте.',
          },
          ...exam.components.map((c) => ({
            name: `component:${c}`,
            label: `Балл за ${COMPONENT_LABEL_RU[c] ?? c}`,
            type: 'number' as const,
            required: false,
            step: exam.step,
            hint: 'Компонентный порог проверяется отдельно от общего балла.',
          })),
          { name: 'takenOn', label: 'Дата сдачи', type: 'date', required: true },
          {
            name: 'resultOn',
            label: 'Дата публикации результата',
            type: 'date',
            required: true,
            hint: 'Может отличаться от даты сдачи.',
          },
          {
            name: 'validUntil',
            label: 'Действителен до',
            type: 'date',
            required: false,
            hint: 'Если срок не указан в отчёте — оставьте пустым, мы не будем его выдумывать.',
          },
        ],
      };
    }

    case 'obtain_document':
      return {
        resultKind: 'document',
        title: 'Документ получен',
        hiddenFields: { documentKind: task.semanticKey.replace('doc:', '') },
        fields: [
          {
            name: 'validUntil',
            label: 'Действителен до',
            type: 'date',
            required: false,
            hint: 'Если срок действия не ограничен — оставьте пустым.',
          },
        ],
      };

    case 'improve_grade':
      return {
        resultKind: 'grade',
        title: 'Итоговый средний балл',
        hiddenFields: { scaleId: 'gpa_5' },
        fields: [
          {
            name: 'value',
            label: 'Средний балл по пятибалльной шкале',
            type: 'number',
            required: true,
            step: '0.01',
            hint: 'Балл меняется только по итогам учебного периода.',
          },
        ],
      };

    case 'study_subject':
      return {
        resultKind: 'subject',
        title: 'Предмет закрыт оценкой',
        hiddenFields: {},
        fields: [
          { name: 'subjectId', label: 'Предмет', type: 'text', required: true },
          { name: 'score', label: 'Оценка', type: 'number', required: false, step: '1' },
        ],
      };

    default:
      return null;
  }
}
