/**
 * Анкета: черновик и применение.
 *
 * Два уровня конкурентного доступа, и они разные:
 *  • черновик — своя ревизия. Вторая вкладка, сохраняющая шаг поверх чужого
 *    изменения, получает конфликт и видит, что именно разошлось, вместо тихой
 *    потери половины ответов;
 *  • профиль — своя ревизия. Применение анкеты создаёт новую ревизию и
 *    проверяет ожидаемую, как и любое изменение факта.
 *
 * Черновик намеренно НЕ является профилем: пока анкета не применена, расчёт
 * идёт по действующей ревизии. Незаконченный ответ не должен менять выводы.
 *
 * Два правила, которые здесь держатся жёстко:
 *  • ошибочные ответы не становятся фактами. Сохранить черновик с ошибкой
 *    можно, применить — нет. Проверка идёт на сервере непосредственно перед
 *    применением, а не только в атрибутах полей формы;
 *  • устаревший черновик не перезаписывает новые факты целиком. Применяются
 *    только те поля, которые пользователь действительно менял; поле, которое
 *    изменилось и в профиле, и в черновике, даёт явный конфликт.
 */

import { buildDemoProfile, buildEmptyProfile, isDemoOwner } from '@core/demo/profile';
import { buildSession } from '@core/demo/session';
import type { ApplicantProfileRevision } from '@core/kernel/profile';
import { diffAnswers, summarizeRecalc, type RecalcSummary } from '@core/profile/changes';
import {
  applyDraftToProfile,
  changedFieldIds,
  describeAnswer,
  draftFromProfile,
  fieldLabel,
  findStep,
  sameAnswer,
  UNANSWERED,
  validateAll,
  validateStep,
  type Answer,
  type DraftValues,
  type FieldError,
  type ProfileDraft,
} from '@core/profile/questionnaire';

import { appClock } from './clock';
import { getStore } from './file-store';
import { headProfile, profileRevision, type UserState } from './ports';

/** Профиль по умолчанию: демонстрационный для демо, пустой для новичка. */
export function defaultProfileFor(ownerId: string, nowIso: string): ApplicantProfileRevision {
  return isDemoOwner(ownerId)
    ? buildDemoProfile(nowIso, ownerId)
    : buildEmptyProfile(nowIso, ownerId);
}

export function currentProfile(state: UserState, nowIso: string): ApplicantProfileRevision {
  return headProfile(state) ?? defaultProfileFor(state.ownerId, nowIso);
}

export interface DraftView {
  readonly draft: ProfileDraft;
  readonly profileRevision: number;
  /** Черновик построен на устаревшей ревизии профиля: факты изменились под ним. */
  readonly staleBase: boolean;
}

export async function loadDraft(ownerId: string, at: string): Promise<DraftView> {
  const state = await getStore().read(ownerId);
  const profile = currentProfile(state, at);
  const draft = state.draft ?? draftFromProfile(profile, at);

  return {
    draft,
    profileRevision: profile.revision,
    staleBase: draft.basedOnProfileRevision !== profile.revision,
  };
}

export type SaveStepResult =
  | {
      readonly ok: true;
      readonly draftRevision: number;
      readonly errors: readonly FieldError[];
      readonly message: string;
    }
  | {
      readonly ok: false;
      readonly kind: 'conflict';
      readonly expected: number;
      readonly actual: number;
      readonly message: string;
    };

/**
 * Сохранить ответы шага.
 *
 * Ошибки валидации НЕ отменяют сохранение — введённое сохраняется вместе
 * с ошибками, иначе пользователь теряет набранное при первой опечатке.
 * Ошибки возвращаются с адресами полей, чтобы подсветить именно их.
 */
export async function saveDraftStep(input: {
  readonly ownerId: string;
  readonly stepId: string;
  readonly answers: DraftValues;
  readonly expectedDraftRevision: number;
  readonly at: string;
}): Promise<SaveStepResult> {
  return getStore().transact<SaveStepResult>(input.ownerId, (state) => {
    const profile = currentProfile(state, input.at);
    const current = state.draft ?? draftFromProfile(profile, input.at);

    if (current.revision !== input.expectedDraftRevision) {
      return {
        kind: 'abort',
        result: {
          ok: false,
          kind: 'conflict',
          expected: input.expectedDraftRevision,
          actual: current.revision,
          message:
            `Анкету изменили в другом месте: вы редактировали версию ${input.expectedDraftRevision}, ` +
            `сейчас версия ${current.revision}. Ваши ответы не сохранены и не потеряны — ` +
            'обновите страницу и внесите их заново поверх актуальных.',
        },
      };
    }

    const merged: DraftValues = { ...current.values, ...input.answers };
    const step = findStep(input.stepId);
    const errors = validateStep(step, merged, { today: input.at.slice(0, 10) });

    const next: ProfileDraft = {
      revision: current.revision + 1,
      basedOnProfileRevision: current.basedOnProfileRevision,
      updatedAt: input.at,
      values: merged,
    };

    return {
      kind: 'commit',
      next: { ...state, draft: next },
      result: {
        ok: true,
        draftRevision: next.revision,
        errors,
        message:
          errors.length === 0
            ? 'Ответы сохранены.'
            : 'Ответы сохранены, но часть полей требует исправления.',
      },
    };
  });
}

export interface AnswerConflict {
  readonly fieldId: string;
  readonly label: string;
  /** Что было в профиле, когда открывали анкету. */
  readonly base: string;
  /** Что в профиле сейчас. */
  readonly current: string;
  /** Что вы ввели. */
  readonly yours: string;
}

export type CommitDraftResult =
  | {
      readonly ok: true;
      readonly profileRevision: number;
      readonly message: string;
      readonly summary: RecalcSummary;
    }
  | {
      readonly ok: false;
      readonly kind: 'conflict' | 'invalid' | 'stale_draft' | 'empty';
      readonly message: string;
      readonly errors?: readonly FieldError[];
      readonly conflicts?: readonly AnswerConflict[];
    };

/**
 * Применить анкету: новая ревизия профиля.
 *
 * Старая ревизия остаётся, черновик очищается только после успешной записи,
 * ожидаемые ревизии профиля и черновика проверяются — параллельная запись
 * факта не будет молча перезаписана.
 */
export async function commitDraft(input: {
  readonly ownerId: string;
  readonly expectedProfileRevision: number;
  /** Ревизия черновика, которую пользователь видел на экране проверки. */
  readonly expectedDraftRevision: number;
  readonly at: string;
}): Promise<CommitDraftResult> {
  const clock = appClock();

  return getStore().transact<CommitDraftResult>(input.ownerId, (state) => {
    const profile = currentProfile(state, input.at);

    if (!state.draft) {
      return {
        kind: 'abort',
        result: { ok: false, kind: 'empty', message: 'Черновик анкеты пуст — нечего применять.' },
      };
    }

    const draft = state.draft;

    // Подтверждаются ИМЕННО те ответы, которые пользователь видел на экране
    // проверки. Если другая вкладка успела дописать шаг, применение
    // остановится, а не запишет невиденные изменения.
    if (draft.revision !== input.expectedDraftRevision) {
      return {
        kind: 'abort',
        result: {
          ok: false,
          kind: 'stale_draft',
          message:
            `Анкета изменилась после того, как вы открыли проверку: вы видели версию ` +
            `${input.expectedDraftRevision}, сейчас ${draft.revision}. Обновите страницу и ` +
            'перечитайте ответы — применять невиденные изменения мы не будем.',
        },
      };
    }

    if (profile.revision !== input.expectedProfileRevision) {
      return {
        kind: 'abort',
        result: {
          ok: false,
          kind: 'conflict',
          message:
            `Профиль изменился: ожидалась ревизия ${input.expectedProfileRevision}, ` +
            `сейчас ${profile.revision}. Черновик сохранён — обновите страницу и примените ` +
            'его поверх актуальной версии.',
        },
      };
    }

    // Ошибочные значения не превращаются в факты профиля.
    const errors = validateAll(draft.values, { today: input.at.slice(0, 10) });
    if (errors.length > 0) {
      return {
        kind: 'abort',
        result: {
          ok: false,
          kind: 'invalid',
          message:
            `В анкете ${errors.length} ошибочных значений. Пока они не исправлены, ` +
            'анкета не применяется: неверный балл или невозможная дата не должны стать фактом.',
          errors,
        },
      };
    }

    // Слияние: применяем только изменённые пользователем поля.
    const merge = mergeDraft(state, profile, draft, input.at);
    if (!merge.ok) {
      return { kind: 'abort', result: merge.result };
    }

    const nextProfile = merge.profile;
    const seeded = state.profileRevisions.length === 0 ? [profile] : [];

    // Что изменилось: считаем оба снимка на одних и тех же часах.
    const before = buildSession({
      profile,
      clock,
      ...(state.activeGoalId ? { activePathId: state.activeGoalId } : {}),
    });
    const after = buildSession({
      profile: nextProfile,
      clock,
      ...(state.activeGoalId ? { activePathId: state.activeGoalId } : {}),
    });
    const summary = summarizeRecalc({ at: input.at, before, after, changes: merge.changes });

    return {
      kind: 'commit',
      next: {
        ...state,
        profileRevisions: [...state.profileRevisions, ...seeded, nextProfile],
        draft: null,
        lastRecalc: summary,
        audit: [
          ...state.audit,
          {
            at: input.at,
            actorRef: `user:${input.ownerId}`,
            action: 'profile_updated',
            taskId: 'profile:questionnaire',
            // Прогресс этой командой не менялся: аудит фиксирует только профиль.
            progressRevision: 0,
            profileRevision: nextProfile.revision,
            basis: 'Применение анкеты',
          },
        ],
      },
      result: {
        ok: true,
        profileRevision: nextProfile.revision,
        message: `Анкета применена. Профиль стал ревизией ${nextProfile.revision}, расчёт пересчитан.`,
        summary,
      },
    };
  });
}

type MergeOutcome =
  | {
      ok: true;
      profile: ApplicantProfileRevision;
      changes: ReturnType<typeof diffAnswers>;
    }
  | { ok: false; result: Extract<CommitDraftResult, { ok: false }> };

/**
 * Слияние черновика с актуальным профилем.
 *
 * Пока черновик применялся целиком, происходило вот что: пользователь открыл
 * анкету на ревизии 1, в другой вкладке записал результат экзамена (ревизия 2),
 * вернулся и применил анкету — и профиль откатывался к старым значениям.
 *
 * Правильное поведение: взять базовую ревизию, на которой черновик начат,
 * вычислить РАЗНИЦУ, и наложить только её. Поле, изменившееся с обеих сторон,
 * пользователь разрешает сам — молча выбирать победителя нельзя.
 */
function mergeDraft(
  state: UserState,
  profile: ApplicantProfileRevision,
  draft: ProfileDraft,
  at: string,
): MergeOutcome {
  const currentValues = draftFromProfile(profile, at).values;
  const baseProfile = profileRevision(state, draft.basedOnProfileRevision);

  // База неизвестна (первое применение): считаем, что пользователь отвечал
  // поверх текущего профиля — сравнивать не с чем, применяем как есть.
  const baseValues = baseProfile ? draftFromProfile(baseProfile, at).values : currentValues;

  const changedByUser = changedFieldIds(baseValues, draft.values);
  const changedInProfile = changedFieldIds(baseValues, currentValues);

  const conflicts: AnswerConflict[] = [];
  for (const fieldId of changedByUser) {
    if (!changedInProfile.includes(fieldId)) continue;
    // Совпавшие значения конфликтом не являются.
    if (sameAnswer(draft.values[fieldId] ?? UNANSWERED, currentValues[fieldId] ?? UNANSWERED)) {
      continue;
    }
    conflicts.push({
      fieldId,
      label: fieldLabel(fieldId),
      base: describeAnswer(fieldId, baseValues[fieldId]),
      current: describeAnswer(fieldId, currentValues[fieldId]),
      yours: describeAnswer(fieldId, draft.values[fieldId]),
    });
  }

  if (conflicts.length > 0) {
    return {
      ok: false,
      result: {
        ok: false,
        kind: 'conflict',
        message:
          `Пока анкета была открыта, ${conflicts.length} из ваших ответов изменились и в профиле ` +
          '— например, вы внесли результат экзамена в маршруте. Выбрать за вас, какое значение ' +
          'верное, мы не можем: обновите анкету и введите нужное заново.',
        conflicts,
      },
    };
  }

  // Наложение: актуальные значения + только то, что менял пользователь.
  const mergedValues: Record<string, Answer> = { ...currentValues };
  for (const fieldId of changedByUser) {
    mergedValues[fieldId] = draft.values[fieldId] ?? UNANSWERED;
  }

  const mergedDraft: ProfileDraft = {
    ...draft,
    basedOnProfileRevision: profile.revision,
    values: mergedValues,
  };

  return {
    ok: true,
    profile: applyDraftToProfile(profile, mergedDraft, at, 'Заполнение анкеты'),
    changes: diffAnswers(currentValues, mergedValues, changedByUser),
  };
}

export type DiscardDraftResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly kind: 'conflict'; readonly message: string };

/**
 * Отбросить черновик, не трогая профиль.
 *
 * Тоже под ожидаемой ревизией: отбрасывать чужие свежие ответы, которых
 * пользователь не видел, — та же потеря данных, что и применить их.
 */
export async function discardDraft(input: {
  readonly ownerId: string;
  readonly expectedDraftRevision: number;
}): Promise<DiscardDraftResult> {
  return getStore().transact<DiscardDraftResult>(input.ownerId, (state) => {
    if (!state.draft) return { kind: 'commit', next: state, result: { ok: true } };

    if (state.draft.revision !== input.expectedDraftRevision) {
      return {
        kind: 'abort',
        result: {
          ok: false,
          kind: 'conflict',
          message:
            `Анкета изменилась: вы видели версию ${input.expectedDraftRevision}, сейчас ` +
            `${state.draft.revision}. Обновите страницу — отбрасывать невиденные ответы мы не будем.`,
        },
      };
    }

    return { kind: 'commit', next: { ...state, draft: null }, result: { ok: true } };
  });
}

/** Разбор ответа одного поля из формы. */
export function parseAnswer(
  raw: string | null,
  mode: string | null,
  list?: readonly string[],
): Answer {
  if (mode === 'dont_know') return { state: 'dont_know' };
  if (mode === 'not_applicable') return { state: 'not_applicable' };
  // Пустой список — это ОТВЕТ «ничего не выбрано», а не отсутствие ответа.
  // `list` передаётся только для полей множественного выбора, которые реально
  // были на форме; раньше пустой список превращался в «не отвечено», и снятие
  // всех галочек не могло очистить профиль.
  if (list) return { state: 'answered', value: list };
  if (raw === null || raw.trim() === '') return { state: 'unanswered' };
  return { state: 'answered', value: raw };
}
