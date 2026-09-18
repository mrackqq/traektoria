/**
 * ENG-02 — четырёхзначная решётка состояний условия.
 *
 * Ядро не зависит от React, HTTP и LLM (ARCH-02). Здесь нет ввода-вывода
 * и нет обращения к системным часам: время всегда приходит параметром (MODEL-03).
 */

/** Состояние листа или группы требований. */
export type ReqStatus = 'MET' | 'NOT_MET' | 'UNKNOWN' | 'CONFLICT';

/**
 * Применимость условия к конкретному заявителю.
 *
 * REV-05: в исходном ТЗ применимость бинарна, из-за чего профиль со значением
 * «не знаю» в поле гражданства/категории (PF-02, UX-02 требуют такой вариант)
 * приводил к неопределённому поведению. Введено третье состояние: неизвестная
 * применимость не фильтрует узел, а даёт UNKNOWN и порождает задачу уточнения.
 */
export type Applicability = 'applicable' | 'not_applicable' | 'applicability_unknown';

/** Результат узла после применения applicability-фильтра. */
export type NodeOutcome =
  | { kind: 'evaluated'; status: ReqStatus }
  /** Узел не относится к заявителю — он исключается у родителя, а не заменяется UNKNOWN (ENG-02). */
  | { kind: 'not_applicable' };

export const EVALUATED = (status: ReqStatus): NodeOutcome => ({ kind: 'evaluated', status });
export const NOT_APPLICABLE: NodeOutcome = { kind: 'not_applicable' };

/**
 * ENG-02, группа ALL:
 * любой NOT_MET → NOT_MET; иначе любой CONFLICT → CONFLICT;
 * иначе любой UNKNOWN → UNKNOWN; иначе MET.
 */
export function combineAll(children: readonly ReqStatus[]): ReqStatus {
  if (children.some((s) => s === 'NOT_MET')) return 'NOT_MET';
  if (children.some((s) => s === 'CONFLICT')) return 'CONFLICT';
  if (children.some((s) => s === 'UNKNOWN')) return 'UNKNOWN';
  return 'MET';
}

/**
 * ENG-02, группа ANY:
 * любой MET → MET; иначе любой CONFLICT → CONFLICT;
 * иначе любой UNKNOWN → UNKNOWN; иначе NOT_MET.
 */
export function combineAny(children: readonly ReqStatus[]): ReqStatus {
  if (children.some((s) => s === 'MET')) return 'MET';
  if (children.some((s) => s === 'CONFLICT')) return 'CONFLICT';
  if (children.some((s) => s === 'UNKNOWN')) return 'UNKNOWN';
  return 'NOT_MET';
}

/**
 * ENG-02 / ENG-08, группа AT_LEAST(k):
 * не менее k MET → MET;
 * MET + UNKNOWN + CONFLICT < k → NOT_MET (достичь k уже невозможно);
 * иначе наличие CONFLICT → CONFLICT; иначе UNKNOWN.
 *
 * `children` — уже применимые элементы, посчитанные по `counting_key` (ENG-08):
 * дубликаты одного логического элемента схлопываются ДО вызова.
 */
export function combineAtLeast(children: readonly ReqStatus[], k: number): ReqStatus {
  if (!Number.isInteger(k) || k < 1) {
    throw new RangeError(`AT_LEAST: k должно быть целым ≥ 1, получено ${k}`);
  }
  const met = children.filter((s) => s === 'MET').length;
  if (met >= k) return 'MET';
  const reachable = children.filter(
    (s) => s === 'MET' || s === 'UNKNOWN' || s === 'CONFLICT',
  ).length;
  if (reachable < k) return 'NOT_MET';
  if (children.some((s) => s === 'CONFLICT')) return 'CONFLICT';
  return 'UNKNOWN';
}

/**
 * Свести результаты детей группы в результат группы.
 *
 * REV-04: краевой случай, не закрытый в исходном ТЗ. ENG-08 запрещает пустые
 * ALL/ANY только в опубликованном шаблоне — это проверка времени публикации.
 * Но группа, ВСЕ дети которой неприменимы к данному заявителю, схлопывается
 * в пустую уже во время вычисления. Классическая семантика дала бы
 * ALL(∅) = MET (vacuous truth) → ложный `conditions_met`, то есть дефект
 * Critical по REL-01. Поэтому пустая после фильтрации группа сама становится
 * неприменимой и исключается у родителя.
 */
export function combineGroup(
  group: { type: 'ALL' } | { type: 'ANY' } | { type: 'AT_LEAST'; k: number },
  childOutcomes: readonly NodeOutcome[],
): NodeOutcome {
  const applicable = childOutcomes
    .filter((o): o is { kind: 'evaluated'; status: ReqStatus } => o.kind === 'evaluated')
    .map((o) => o.status);

  if (applicable.length === 0) return NOT_APPLICABLE;

  switch (group.type) {
    case 'ALL':
      return EVALUATED(combineAll(applicable));
    case 'ANY':
      return EVALUATED(combineAny(applicable));
    case 'AT_LEAST': {
      // ENG-08: если после applicability-фильтрации применимых элементов меньше k,
      // требуемую мощность набрать нечем → NOT_MET (а не UNKNOWN).
      if (applicable.length < group.k) return EVALUATED('NOT_MET');
      return EVALUATED(combineAtLeast(applicable, group.k));
    }
  }
}

/**
 * Порядок «полезности» состояния для пользователя: чем меньше, тем лучше исход.
 * Используется только для сортировки и выбора формулировок, не для вычисления.
 */
export const STATUS_RANK: Record<ReqStatus, number> = {
  MET: 0,
  UNKNOWN: 1,
  CONFLICT: 2,
  NOT_MET: 3,
};

/** Человеческие подписи. ENG-06: MET по самоотчёту — не «официально проверено». */
export const STATUS_LABEL_RU: Record<ReqStatus, string> = {
  MET: 'Соответствует',
  NOT_MET: 'Не выполнено',
  UNKNOWN: 'Неизвестно',
  CONFLICT: 'Конфликт источников',
};
