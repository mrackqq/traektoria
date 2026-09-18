/**
 * Контракт ответа модели.
 *
 * Одна и та же форма описана дважды и намеренно:
 *  • JSON Schema уходит в запрос, чтобы провайдер отдал структуру, а не прозу;
 *  • Zod проверяет то, что реально пришло. Модель может вернуть валидный JSON
 *    неправильной формы, пустые строки или лишние поля — доверять заявленному
 *    `strict` нельзя, проверка на нашей стороне обязательна.
 *
 * Схема сознательно не содержит ни одного числового поля: у модели нет
 * возможности «оценить шанс в процентах», потому что такого поля просто нет.
 * Все фактические значения — баллы, стоимость, даты — берутся из каталога
 * и подставляются интерфейсом, а не текстом ответа.
 */

import { z } from 'zod';

const shortText = z.string().trim().min(1).max(400);
const longText = z.string().trim().min(1).max(900);

/** Ссылки на факты расчёта: значения по ним подставляет сервер. */
const factRefs = z.array(z.string().trim().min(1).max(16)).max(6);

export const programExplanationSchema = z.object({
  pathId: z.string().trim().min(1).max(120),
  why: longText,
  tradeoff: longText,
  factRefs,
});

export const taskGuidanceSchema = z.object({
  taskId: z.string().trim().min(1).max(160),
  howTo: longText,
  watchOut: shortText,
  factRefs,
});

export const adviceSchema = z.object({
  profileSummary: z.object({
    headline: shortText,
    strengths: z.array(shortText).max(5),
    limits: z.array(shortText).max(5),
    focus: longText,
  }),
  programExplanations: z.array(programExplanationSchema).max(8),
  comparison: z.object({
    summary: longText,
    tradeoffs: z.array(shortText).max(6),
  }),
  taskGuidance: z.array(taskGuidanceSchema).max(8),
  nextAction: z.object({
    what: shortText,
    why: longText,
    firstStep: shortText,
    factRefs,
  }),
});

export type Advice = z.infer<typeof adviceSchema>;
export type ProgramExplanation = z.infer<typeof programExplanationSchema>;
export type TaskGuidance = z.infer<typeof taskGuidanceSchema>;

/**
 * JSON Schema для `response_format`.
 *
 * Строгий режим OpenAI-совместимых провайдеров требует, чтобы у каждого
 * объекта были `additionalProperties: false` и полный список `required`.
 */
export const ADVICE_JSON_SCHEMA = {
  name: 'admission_advice',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['profileSummary', 'programExplanations', 'comparison', 'taskGuidance', 'nextAction'],
    properties: {
      profileSummary: {
        type: 'object',
        additionalProperties: false,
        required: ['headline', 'strengths', 'limits', 'focus'],
        properties: {
          headline: { type: 'string', description: 'Одно предложение: кто пользователь и к чему идёт.' },
          strengths: {
            type: 'array',
            maxItems: 5,
            items: { type: 'string' },
            description: 'Сильные стороны строго по переданным фактам.',
          },
          limits: {
            type: 'array',
            maxItems: 5,
            items: { type: 'string' },
            description: 'Ограничения строго по переданным фактам и ограничениям каталога.',
          },
          focus: { type: 'string', description: 'На чём сосредоточиться в первую очередь и почему.' },
        },
      },
      programExplanations: {
        type: 'array',
        maxItems: 8,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['pathId', 'why', 'tradeoff', 'factRefs'],
          properties: {
            pathId: { type: 'string', description: 'Идентификатор пути подачи ровно из переданного списка.' },
            why: { type: 'string', description: 'Почему вариант подходит именно этому профилю. Числа и даты не пиши — сошлись на факт через factRefs.' },
            tradeoff: { type: 'string', description: 'Чем придётся заплатить: деньги, сроки, нагрузка, риск.' },
            factRefs: {
              type: 'array',
              maxItems: 6,
              items: { type: 'string' },
              description: 'Идентификаторы фактов из verifiableFacts, относящиеся к ЭТОМУ pathId. Значения подставит сервис.',
            },
          },
        },
      },
      comparison: {
        type: 'object',
        additionalProperties: false,
        required: ['summary', 'tradeoffs'],
        properties: {
          summary: { type: 'string', description: 'Чем варианты отличаются по сути, без выбора за пользователя.' },
          tradeoffs: {
            type: 'array',
            maxItems: 6,
            items: { type: 'string' },
            description: 'Компромиссы: что выигрываешь и что теряешь при каждом выборе.',
          },
        },
      },
      taskGuidance: {
        type: 'array',
        maxItems: 8,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['taskId', 'howTo', 'watchOut', 'factRefs'],
          properties: {
            taskId: { type: 'string', description: 'Идентификатор задачи ровно из переданного списка.' },
            howTo: { type: 'string', description: 'Как выполнить это действие применительно к профилю. Сроки не пиши словами — сошлись через factRefs.' },
            watchOut: { type: 'string', description: 'Типичная ошибка или риск на этом шаге.' },
            factRefs: {
              type: 'array',
              maxItems: 6,
              items: { type: 'string' },
              description: 'Идентификаторы фактов из verifiableFacts, относящиеся к ЭТОЙ задаче.',
            },
          },
        },
      },
      nextAction: {
        type: 'object',
        additionalProperties: false,
        required: ['what', 'why', 'firstStep', 'factRefs'],
        properties: {
          what: { type: 'string', description: 'Что делать прямо сейчас.' },
          why: { type: 'string', description: 'Почему именно это, со ссылкой на сроки и зависимости из данных.' },
          firstStep: { type: 'string', description: 'Первый конкретный шаг, выполнимый сегодня.' },
          factRefs: {
            type: 'array',
            maxItems: 6,
            items: { type: 'string' },
            description: 'Идентификаторы фактов из verifiableFacts по ближайшему действию.',
          },
        },
      },
    },
  },
} as const;
