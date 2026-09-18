/**
 * ENG-05 / ST-10 / REV-08 — ключ воспроизводимости расчёта.
 *
 * Два разных вопроса, которые часто путают:
 *  1. «Тот же ли это вход?» — отвечает `inputHash` вместе с версиями движка
 *     и политик. Один и тот же вход обязан давать один и тот же результат;
 *     формулировка от LLM в инвариант не входит (ENG-05).
 *  2. «Ещё ли он годен?» — отвечает `validUntil`. Даже при неизменных
 *     ревизиях расчёт протухает просто от времени: истекает результат
 *     экзамена, проходит внешняя отсечка, источник уходит в stale (ST-10).
 *
 * Поэтому текущее время НЕ входит в `inputHash`: иначе хэш менялся бы
 * каждую секунду и перестал отвечать на первый вопрос. Время учитывается
 * отдельно, через окно годности с явно названной причиной ограничения.
 *
 * REV-03: каталог входит в ключ скоупом фактически прочитанных условий,
 * а не глобальным счётчиком ревизий.
 */

import { payloadHash } from './hash';
import type { PlainDate } from './time';

/** Версия детерминированного ядра. Меняется при изменении семантики расчёта. */
export const ENGINE_VERSION = '1.0.0';

/**
 * Версия политик расчёта: лимиты перебора, календарь, правила свежести,
 * порядок ранжирования. §19 относит их к решениям, требующим утверждения,
 * поэтому они версионируются отдельно от кода движка.
 */
export const POLICY_VERSION = '1.0.0';

/** ST-10: расчёт не считается годным дольше этого срока ни при каких условиях. */
export const MAX_AGE_MINUTES = 15;

export type ValidityReason =
  | { readonly kind: 'max_age'; readonly limitMinutes: number }
  | { readonly kind: 'source_freshness'; readonly sourceId: string }
  | { readonly kind: 'result_expiry'; readonly examKind: string }
  | { readonly kind: 'external_deadline'; readonly deadlineId: string };

export const VALIDITY_REASON_RU = (r: ValidityReason): string => {
  switch (r.kind) {
    case 'max_age':
      return `предельный возраст расчёта ${r.limitMinutes} мин`;
    case 'source_freshness':
      return `источник ${r.sourceId} требует перепроверки`;
    case 'result_expiry':
      return `истекает действительность результата ${r.examKind}`;
    case 'external_deadline':
      return `наступает внешняя отсечка ${r.deadlineId}`;
  }
};

export interface CalculationKey {
  readonly engineVersion: string;
  readonly policyVersion: string;
  /** Хэш канонизованного входа без времени. */
  readonly inputHash: string;
  readonly catalogScopeHash: string;
  readonly profileRevision: number;
  readonly calculatedAt: string;
  readonly validUntil: string;
  /** ST-10: в proposal указывается причина ограничения срока. */
  readonly validityReason: ValidityReason;
  /**
   * ST-10: неизвестная существенная граница остаётся предупреждением,
   * а не превращается в выдуманную дату.
   */
  readonly unknownBoundaries: readonly string[];
}

/** Граница годности: момент и причина. */
export interface ValidityBoundary {
  readonly atUtc: string;
  readonly reason: ValidityReason;
}

export interface CalculationInputs {
  readonly profileId: string;
  readonly profileRevision: number;
  /** Пути подачи, которые расчёт фактически читал. */
  readonly admissionPathIds: readonly string[];
  readonly catalogScopeHash: string;
  /**
   * Отпечаток политик: лимиты перебора, идентификатор календаря, курсы.
   * Всё, что меняет результат при неизменных данных.
   */
  readonly policyFingerprint: unknown;
  readonly calculatedAt: string;
  readonly boundaries: readonly ValidityBoundary[];
  readonly unknownBoundaries?: readonly string[];
}

export function computeCalculationKey(input: CalculationInputs): CalculationKey {
  const inputHash = payloadHash({
    engineVersion: ENGINE_VERSION,
    policyVersion: POLICY_VERSION,
    profileId: input.profileId,
    profileRevision: input.profileRevision,
    // Порядок путей не должен влиять на хэш: множество прочитанного важнее
    // порядка обхода.
    admissionPathIds: [...input.admissionPathIds].sort(),
    catalogScopeHash: input.catalogScopeHash,
    policy: input.policyFingerprint,
  });

  const maxAge: ValidityBoundary = {
    atUtc: new Date(Date.parse(input.calculatedAt) + MAX_AGE_MINUTES * 60_000).toISOString(),
    reason: { kind: 'max_age', limitMinutes: MAX_AGE_MINUTES },
  };

  // Границы в прошлом не годятся: они уже наступили и ограничивают не срок
  // годности, а сам результат (его считает планировщик).
  const future = input.boundaries.filter((b) => b.atUtc > input.calculatedAt);
  const nearest = [...future, maxAge].reduce((a, b) => (a.atUtc <= b.atUtc ? a : b));

  return {
    engineVersion: ENGINE_VERSION,
    policyVersion: POLICY_VERSION,
    inputHash,
    catalogScopeHash: input.catalogScopeHash,
    profileRevision: input.profileRevision,
    calculatedAt: input.calculatedAt,
    validUntil: nearest.atUtc,
    validityReason: nearest.reason,
    unknownBoundaries: input.unknownBoundaries ?? [],
  };
}

/** ST-10: истёкший расчёт применять нельзя, продление без пересчёта запрещено. */
export function isExpired(key: CalculationKey, nowUtc: string): boolean {
  return nowUtc >= key.validUntil;
}

/**
 * Пригоден ли предпросмотр к применению.
 *
 * ST-10: непригодным его делает и смена любого существенного входа,
 * и просто истёкшее время — поэтому проверяются оба условия, а не только
 * совпадение хэшей.
 */
export function isApplicable(
  key: CalculationKey,
  current: { readonly inputHash: string; readonly engineVersion: string; readonly policyVersion: string },
  nowUtc: string,
): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  if (key.engineVersion !== current.engineVersion) {
    return { ok: false, reason: 'Изменилась версия расчётного ядра — нужен новый расчёт' };
  }
  if (key.policyVersion !== current.policyVersion) {
    return { ok: false, reason: 'Изменились политики расчёта — нужен новый расчёт' };
  }
  if (key.inputHash !== current.inputHash) {
    return { ok: false, reason: 'Исходные данные изменились с момента предпросмотра' };
  }
  if (isExpired(key, nowUtc)) {
    return {
      ok: false,
      reason: `Срок годности расчёта истёк (${VALIDITY_REASON_RU(key.validityReason)})`,
    };
  }
  return { ok: true };
}

/** Момент, когда результат экзамена перестаёт быть действительным. */
export function expiryBoundary(examKind: string, validUntil: PlainDate): ValidityBoundary {
  return {
    atUtc: `${validUntil}T00:00:00.000Z`,
    reason: { kind: 'result_expiry', examKind },
  };
}
