/**
 * ST-04 / ST-13 — diff «было → станет» и цепочки причин.
 *
 * ST-13: сравниваются ТОЛЬКО baseline и сценарий. Изменения источников или
 * просто прошедшее время событию не приписываются — для них есть отдельный
 * diff обновления baseline (см. `diffBaselineDrift`).
 */

import { formatMoneyRu, type Money } from '../kernel/money';
import { daysBetween, type PlainDate } from '../kernel/time';
import type { BridgeResult, BridgeRoute, FeasibilityStatus } from '../planning/bridge';
import { EVENT_LABEL_RU, type ScenarioEvent } from './overlay';

export type TaskChangeKind = 'added' | 'moved' | 'replaced' | 'obsolete' | 'unchanged';

export const TASK_CHANGE_LABEL_RU: Record<TaskChangeKind, string> = {
  added: 'Добавлена',
  moved: 'Перенесена',
  replaced: 'Заменена',
  obsolete: 'Стала неактуальной',
  unchanged: 'Без изменений',
};

export interface TaskChange {
  readonly kind: TaskChangeKind;
  readonly semanticKey: string;
  readonly title: string;
  readonly before?: { readonly start: PlainDate; readonly finish: PlainDate };
  readonly after?: { readonly start: PlainDate; readonly finish: PlainDate };
  readonly shiftDays?: number;
  readonly note?: string;
}

/** ST-04: цепочка причин `событие → условие/ограничение → задача/программа`. */
export interface CauseChain {
  readonly eventId: string;
  readonly eventLabel: string;
  readonly constraint: string;
  readonly effect: string;
  readonly targetKind: 'task' | 'program' | 'budget' | 'funding';
  readonly targetId: string;
}

export interface ScenarioDiff {
  readonly goalStatusBefore: FeasibilityStatus;
  readonly goalStatusAfter: FeasibilityStatus;
  readonly statusChanged: boolean;
  readonly taskChanges: readonly TaskChange[];
  /** ST-05: результаты, которые остаются применимыми и переиспользуются. */
  readonly preservedResults: readonly string[];
  readonly lostApplicability: readonly string[];
  readonly newCosts: readonly { readonly label: string; readonly amount: string }[];
  readonly nextStepBefore: string | null;
  readonly nextStepAfter: string | null;
  readonly uncertainties: readonly string[];
  readonly confirmedAlternatives: readonly string[];
  readonly causeChains: readonly CauseChain[];
}

/* ------------------------------------------------------------------ */
/* Основной diff                                                       */
/* ------------------------------------------------------------------ */

export function diffScenario(
  baseline: BridgeResult,
  scenario: BridgeResult,
  events: readonly ScenarioEvent[],
): ScenarioDiff {
  const baseRoute = baseline.routes[0] ?? null;
  const scenRoute = scenario.routes[0] ?? null;

  const taskChanges = diffTasks(baseRoute, scenRoute);
  const causeChains = buildCauseChains(events, baseline, scenario, taskChanges);

  const goalStatusBefore = baseRoute?.feasibility.status ?? 'search_incomplete';
  const goalStatusAfter = scenRoute?.feasibility.status ?? 'search_incomplete';

  return {
    goalStatusBefore,
    goalStatusAfter,
    statusChanged: goalStatusBefore !== goalStatusAfter,
    taskChanges,
    preservedResults: collectPreserved(baseRoute, scenRoute),
    lostApplicability: collectLostApplicability(baseRoute, scenRoute),
    newCosts: collectNewCosts(baseRoute, scenRoute),
    nextStepBefore: baseline.nextAction?.template.title ?? null,
    nextStepAfter: scenario.nextAction?.template.title ?? null,
    uncertainties: [
      ...new Set([
        ...scenario.warnings.map((w) => w.message),
        ...(scenRoute?.feasibility.limitations ?? []).map((l) => l.message),
      ]),
    ],
    confirmedAlternatives: collectAlternatives(scenario),
    causeChains,
  };
}

function diffTasks(before: BridgeRoute | null, after: BridgeRoute | null): TaskChange[] {
  const beforeTasks = new Map((before?.tasks ?? []).map((t) => [t.semanticKey, t]));
  const afterTasks = new Map((after?.tasks ?? []).map((t) => [t.semanticKey, t]));
  const changes: TaskChange[] = [];

  for (const [key, a] of afterTasks) {
    const b = beforeTasks.get(key);
    if (!b) {
      changes.push({
        kind: 'added',
        semanticKey: key,
        title: a.template.title,
        after: { start: a.earliestStart, finish: a.earliestFinish },
      });
      continue;
    }
    const shift = daysBetween(b.earliestStart, a.earliestStart);
    if (shift !== 0) {
      changes.push({
        kind: 'moved',
        semanticKey: key,
        title: a.template.title,
        before: { start: b.earliestStart, finish: b.earliestFinish },
        after: { start: a.earliestStart, finish: a.earliestFinish },
        shiftDays: shift,
        note:
          shift > 0
            ? `Сдвиг на ${shift} дн. позже`
            : `Сдвиг на ${Math.abs(shift)} дн. раньше`,
      });
    } else {
      changes.push({
        kind: 'unchanged',
        semanticKey: key,
        title: a.template.title,
        before: { start: b.earliestStart, finish: b.earliestFinish },
        after: { start: a.earliestStart, finish: a.earliestFinish },
      });
    }
  }

  for (const [key, b] of beforeTasks) {
    if (afterTasks.has(key)) continue;
    // Задача исчезла: либо путь заменён альтернативой, либо стала неактуальной.
    const replacedByAlternative = (after?.tasks ?? []).some(
      (t) => t.template.kind === b.template.kind && t.semanticKey !== key,
    );
    changes.push({
      kind: replacedByAlternative ? 'replaced' : 'obsolete',
      semanticKey: key,
      title: b.template.title,
      before: { start: b.earliestStart, finish: b.earliestFinish },
      note: replacedByAlternative
        ? 'Путь заменён допустимой альтернативой того же типа.'
        : 'В новом сценарии это действие больше не требуется.',
    });
  }

  const order: Record<TaskChangeKind, number> = {
    added: 0, moved: 1, replaced: 2, obsolete: 3, unchanged: 4,
  };
  return changes.sort(
    (x, y) => order[x.kind] - order[y.kind] || x.semanticKey.localeCompare(y.semanticKey),
  );
}

/**
 * ST-05: переиспользуются только результаты, которые остаются применимыми
 * и действительными. Результаты не удаляются при смене стратегии.
 */
function collectPreserved(before: BridgeRoute | null, after: BridgeRoute | null): string[] {
  const beforeMet = new Set(before?.plan.alreadyMetLeafIds ?? []);
  const afterMet = new Set(after?.plan.alreadyMetLeafIds ?? []);
  return [...afterMet].filter((id) => beforeMet.has(id));
}

function collectLostApplicability(before: BridgeRoute | null, after: BridgeRoute | null): string[] {
  const beforeMet = new Set(before?.plan.alreadyMetLeafIds ?? []);
  const afterMet = new Set(after?.plan.alreadyMetLeafIds ?? []);
  return [...beforeMet].filter((id) => !afterMet.has(id));
}

function collectNewCosts(
  before: BridgeRoute | null,
  after: BridgeRoute | null,
): { label: string; amount: string }[] {
  const beforeKeys = new Set((before?.tasks ?? []).map((t) => t.semanticKey));
  const out: { label: string; amount: string }[] = [];
  for (const t of after?.tasks ?? []) {
    if (beforeKeys.has(t.semanticKey)) continue;
    const cost: Money | undefined = t.template.cost;
    if (!cost) continue;
    out.push({ label: t.template.title, amount: formatMoneyRu(cost) });
  }
  return out;
}

/**
 * BR-11 / ST-06: предлагать можно только ПОДТВЕРЖДЁННЫЕ альтернативы.
 * Новый источник, неизвестное окно или грант ради красивого плана не выдумываются.
 */
function collectAlternatives(scenario: BridgeResult): string[] {
  return scenario.routes
    .slice(1)
    .map((r) => `${r.label}: ${r.rationale}`);
}

/* ------------------------------------------------------------------ */
/* Цепочки причин (ST-04)                                              */
/* ------------------------------------------------------------------ */

function buildCauseChains(
  events: readonly ScenarioEvent[],
  baseline: BridgeResult,
  scenario: BridgeResult,
  taskChanges: readonly TaskChange[],
): CauseChain[] {
  const chains: CauseChain[] = [];

  for (const e of events) {
    const label = EVENT_LABEL_RU[e.type];

    switch (e.type) {
      case 'budget_changed': {
        chains.push({
          eventId: e.id,
          eventLabel: label,
          constraint: `Новый предел бюджета с ${e.effectiveDate}: ${formatMoneyRu(e.budget.limit)} (${
            e.budget.scope === 'tuition_only' ? 'только обучение' : 'общий предел'
          })`,
          effect:
            'Пересчитана финансовая совместимость программ. Прошлые фактические платежи ' +
            'не изменены.',
          targetKind: 'budget',
          targetId: e.id,
        });
        break;
      }
      case 'certificate_delayed': {
        const constraint = `Результат ${e.examKind} ожидается не раньше ${e.newResultDate}`;
        const moved = taskChanges.filter((c) => c.kind === 'moved');
        const direct = moved.filter((c) => c.semanticKey.startsWith(examKeyPrefix(e.examKind)));
        // Задержка результата сдвигает и то, что от него зависит. Молчать об этом
        // нельзя: ST-04 требует цепочку до фактического последствия, а не до
        // ближайшего к событию действия.
        const downstream = moved.filter(
          (c) => !c.semanticKey.startsWith(examKeyPrefix(e.examKind)),
        );

        if (moved.length === 0) {
          chains.push({
            eventId: e.id,
            eventLabel: label,
            constraint,
            effect: 'Окна предоставления результата пересчитаны; сдвига задач не потребовалось.',
            targetKind: 'program',
            targetId: scenario.programId,
          });
        }

        for (const c of direct) {
          chains.push({
            eventId: e.id,
            eventLabel: label,
            constraint,
            effect: `«${c.title}» ${c.note ?? 'сдвинута'}`,
            targetKind: 'task',
            targetId: c.semanticKey,
          });
        }

        for (const c of downstream) {
          chains.push({
            eventId: e.id,
            eventLabel: label,
            constraint: `${constraint}, поэтому зависимые действия начинаются позже`,
            effect: `«${c.title}» ${c.note ?? 'сдвинута'}`,
            targetKind: 'task',
            targetId: c.semanticKey,
          });
        }
        break;
      }
      case 'funding_not_received': {
        chains.push({
          eventId: e.id,
          eventLabel: label,
          constraint: `Финансирование ${e.fundingId} не получено с ${e.effectiveDate}`,
          effect:
            'Пересчитана только зависимая предпосылка. Другое подтверждённое финансирование ' +
            'и прошлые факты не затронуты.',
          targetKind: 'funding',
          targetId: e.fundingId,
        });
        break;
      }
      case 'task_skipped': {
        const change = taskChanges.find((c) => c.semanticKey === e.taskSemanticKey);
        chains.push({
          eventId: e.id,
          eventLabel: label,
          constraint:
            `«${e.taskSemanticKey}» недоступна до ${e.newAvailabilityDate}` +
            (e.completedFraction > 0
              ? `, выполнено ${Math.round(e.completedFraction * 100)}%`
              : ''),
          effect: change
            ? `${TASK_CHANGE_LABEL_RU[change.kind]}: ${change.note ?? change.title}`
            : 'Зависимые задачи пересчитаны.',
          targetKind: 'task',
          targetId: e.taskSemanticKey,
        });
        break;
      }
    }
  }

  // Изменение статуса цели — тоже следствие, и оно должно быть объяснено.
  const before = baseline.routes[0]?.feasibility.status;
  const after = scenario.routes[0]?.feasibility.status;
  if (before && after && before !== after) {
    chains.push({
      eventId: 'aggregate',
      eventLabel: 'Совокупный эффект событий',
      constraint: `Статус выполнимости: ${before}`,
      effect: `Стал: ${after}`,
      targetKind: 'program',
      targetId: scenario.programId,
    });
  }

  return chains;
}

function examKeyPrefix(examKind: string): string {
  const k = examKind.toLowerCase();
  if (k.includes('ielts')) return 'ielts';
  if (k.includes('toefl')) return 'toefl';
  if (k.includes('ент') || k.includes('ent')) return 'ent';
  return k;
}

/* ------------------------------------------------------------------ */
/* Дрейф baseline (ST-13)                                              */
/* ------------------------------------------------------------------ */

export interface BaselineDrift {
  readonly changed: boolean;
  readonly items: readonly string[];
}

/**
 * ST-13: разница СТАРОЙ сохранённой стратегии и ТЕКУЩЕГО baseline показывается
 * отдельно как «изменения времени и данных». Эти изменения не приписываются
 * событиям сценария (AC-33).
 */
export function diffBaselineDrift(
  savedAt: string,
  savedRoute: BridgeRoute | null,
  currentRoute: BridgeRoute | null,
): BaselineDrift {
  const items: string[] = [];

  if (!savedRoute || !currentRoute) {
    return { changed: false, items: [] };
  }

  if (savedRoute.feasibility.status !== currentRoute.feasibility.status) {
    items.push(
      `Статус выполнимости изменился с «${savedRoute.feasibility.status}» на ` +
        `«${currentRoute.feasibility.status}» без каких-либо действий с вашей стороны.`,
    );
  }

  const savedKeys = new Set(savedRoute.tasks.map((t) => t.semanticKey));
  const currentKeys = new Set(currentRoute.tasks.map((t) => t.semanticKey));
  for (const k of currentKeys) {
    if (!savedKeys.has(k)) items.push(`Появилось новое действие «${k}» из-за обновления данных.`);
  }
  for (const k of savedKeys) {
    if (!currentKeys.has(k)) items.push(`Действие «${k}» больше не требуется по текущим данным.`);
  }

  for (const cur of currentRoute.tasks) {
    const saved = savedRoute.tasks.find((t) => t.semanticKey === cur.semanticKey);
    if (!saved) continue;
    const shift = daysBetween(saved.earliestStart, cur.earliestStart);
    if (shift !== 0) {
      items.push(
        `«${cur.template.title}»: срок сместился на ${Math.abs(shift)} дн. ` +
          `${shift > 0 ? 'позже' : 'раньше'} — это следствие прошедшего времени или обновления ` +
          'источника, а не сценария.',
      );
    }
  }

  if (items.length > 0) {
    items.unshift(`План сохранён ${savedAt.slice(0, 10)}. С тех пор изменилось:`);
  }

  return { changed: items.length > 0, items };
}
