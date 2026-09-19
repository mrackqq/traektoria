'use server';

/**
 * Команды анкеты.
 *
 * Форма отправляет по полю три вещи: сырое значение, режим ответа
 * («знаю» / «не знаю» / «не применимо») и — для множественного выбора —
 * список. Разбор здесь, семантика в ядре: пустая строка это «не отвечено»,
 * а «не знаю» — отдельное состояние, и они не сливаются.
 */

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { findStep, STEPS, visibleFields, type DraftValues } from '@core/profile/questionnaire';

import { appNow } from '@/server/clock';
import { MODE_COOKIE } from '@/server/session-context';
import { visitorContext } from '@/server/session-context';
import {
  commitDraft,
  discardDraft,
  parseAnswer,
  saveDraftStep,
  type CommitDraftResult,
  type DiscardDraftResult,
  type SaveStepResult,
} from '@/server/questionnaire-service';

function revalidateAll(): void {
  for (const p of ['/', '/profile', '/profile/edit', '/programs', '/compare', '/route', '/goals', '/scenarios']) {
    revalidatePath(p);
  }
}

/**
 * Полный сброс кеша вместе с макетом.
 *
 * Смена режима меняет не одну страницу, а ВСЁ пространство данных сразу,
 * включая шапку с признаком примера. Постраничного сброса здесь мало:
 * `switchModeAction` перенаправляет на «/», и при переключении со стартового
 * экрана адрес не меняется. Клиентский роутер считал такой переход ничем и
 * оставлял на экране прежнюю разметку — cookie уже стояла, демо уже
 * работало, а человек видел ту же страницу и ту же кнопку «Посмотреть демо».
 */
function revalidateEverything(): void {
  revalidatePath('/', 'layout');
  revalidateAll();
}

export async function saveStepAction(
  _prev: SaveStepResult | null,
  formData: FormData,
): Promise<SaveStepResult> {
  const { ownerId } = await visitorContext();
  const stepId = String(formData.get('stepId') ?? '');
  const step = findStep(stepId);
  const expected = Number(formData.get('expectedDraftRevision') ?? 0);

  // Читаем только поля этого шага и только видимые при текущих ответах:
  // невидимый вопрос не должен молча получить значение.
  const previous = parseDraftValues(formData);
  const answers: Record<string, ReturnType<typeof parseAnswer>> = {};

  for (const field of visibleFields(step, previous)) {
    const mode = formData.get(`mode:${field.id}`);
    const list =
      field.kind === 'multiselect'
        ? formData.getAll(`value:${field.id}`).map(String).filter(Boolean)
        : undefined;
    const raw = field.kind === 'multiselect' ? null : formData.get(`value:${field.id}`);

    answers[field.id] = parseAnswer(
      raw === null ? null : String(raw),
      mode === null ? null : String(mode),
      list,
    );
  }

  const result = await saveDraftStep({
    ownerId,
    stepId,
    answers,
    expectedDraftRevision: expected,
    at: appNow(),
  });

  if (result.ok) revalidateAll();
  return result;
}

/**
 * Черновик, каким его видит форма прямо сейчас.
 *
 * Нужен для вычисления видимости полей ДО сохранения: если пользователь
 * на этом же шаге выбрал английский язык обучения, вопрос про CEFR должен
 * считаться видимым уже в этой отправке.
 */
function parseDraftValues(formData: FormData): DraftValues {
  const values: Record<string, ReturnType<typeof parseAnswer>> = {};
  for (const step of STEPS) {
    for (const field of step.fields) {
      const mode = formData.get(`mode:${field.id}`);
      if (mode === null && !formData.has(`value:${field.id}`)) continue;
      const list =
        field.kind === 'multiselect'
          ? formData.getAll(`value:${field.id}`).map(String).filter(Boolean)
          : undefined;
      const raw = field.kind === 'multiselect' ? null : formData.get(`value:${field.id}`);
      values[field.id] = parseAnswer(
        raw === null ? null : String(raw),
        mode === null ? null : String(mode),
        list,
      );
    }
  }
  return values;
}

export async function commitDraftAction(
  _prev: CommitDraftResult | null,
  formData: FormData,
): Promise<CommitDraftResult> {
  const { ownerId } = await visitorContext();

  const result = await commitDraft({
    ownerId,
    expectedProfileRevision: Number(formData.get('expectedProfileRevision') ?? 0),
    expectedDraftRevision: Number(formData.get('expectedDraftRevision') ?? 0),
    at: appNow(),
  });

  if (result.ok) revalidateAll();
  return result;
}

export async function discardDraftAction(
  _prev: DiscardDraftResult | null,
  formData: FormData,
): Promise<DiscardDraftResult> {
  const { ownerId } = await visitorContext();

  const result = await discardDraft({
    ownerId,
    expectedDraftRevision: Number(formData.get('expectedDraftRevision') ?? 0),
  });

  if (result.ok) revalidateAll();
  return result;
}

/**
 * Переключение между собственным профилем и демонстрационным.
 *
 * Это разные владельцы данных: демо не трогает ответы посетителя, а посетитель
 * не редактирует общий пример. Обе стороны переживают обновление страницы.
 */
export async function switchModeAction(formData: FormData): Promise<void> {
  const mode = String(formData.get('mode') ?? 'own') === 'demo' ? 'demo' : 'own';
  const jar = await cookies();
  jar.set(MODE_COOKIE, mode, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    secure: process.env.NODE_ENV === 'production',
  });

  revalidateEverything();
  redirect(mode === 'demo' ? '/' : '/profile/edit');
}
