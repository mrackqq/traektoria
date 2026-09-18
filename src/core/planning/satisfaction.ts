/**
 * BR-05 / BR-09 — перебор допустимых путей выполнения дерева требований.
 *
 * По дереву альтернатив строятся наборы листьев, закрытие которых делает
 * корень выполненным. Ключевой смысл (BR-05): для группы ANY назначается ОДИН
 * разрешённый экзамен, а не все сразу.
 *
 * ARCH-07: перебор ограничен и всегда сообщает полноту. Остановка по лимиту —
 * не доказательство отсутствия пути (BR-10 → `search_incomplete`).
 */

import type { EvaluatedNode } from '../eligibility/evaluate';

export interface SatisfactionPlan {
  /** Листья, которые должны стать MET. */
  readonly requiredLeafIds: readonly string[];
  /** Листья, уже выполненные в этом варианте — переиспользуются (ST-05). */
  readonly alreadyMetLeafIds: readonly string[];
}

export interface SatisfactionSearch {
  readonly plans: readonly SatisfactionPlan[];
  /** ARCH-07: сколько ветвей рассмотрено и почему остановились. */
  readonly branchesExplored: number;
  readonly complete: boolean;
  readonly stopReason?: 'branch_limit' | 'plan_limit';
}

export interface SearchLimits {
  readonly maxPlans: number;
  readonly maxBranches: number;
}

export const DEFAULT_SEARCH_LIMITS: SearchLimits = { maxPlans: 64, maxBranches: 20_000 };

interface Ctx {
  branches: number;
  complete: boolean;
  stopReason?: 'branch_limit' | 'plan_limit';
  limits: SearchLimits;
}

/**
 * Перечислить способы выполнить узел.
 *
 * Возвращает список альтернатив; каждая — набор листьев, которые нужно
 * закрыть. Уже выполненные листья попадают в `alreadyMetLeafIds` и не
 * порождают задач.
 */
export function enumerateSatisfaction(
  root: EvaluatedNode,
  limits: SearchLimits = DEFAULT_SEARCH_LIMITS,
): SatisfactionSearch {
  const ctx: Ctx = { branches: 0, complete: true, limits };
  const plans = walk(root, ctx);
  return {
    plans: dedupePlans(plans).slice(0, limits.maxPlans),
    branchesExplored: ctx.branches,
    complete: ctx.complete,
    ...(ctx.stopReason ? { stopReason: ctx.stopReason } : {}),
  };
}

function walk(node: EvaluatedNode, ctx: Ctx): SatisfactionPlan[] {
  if (++ctx.branches > ctx.limits.maxBranches) {
    ctx.complete = false;
    ctx.stopReason = 'branch_limit';
    return [];
  }

  // Неприменимый узел не требует ничего.
  if (node.outcome.kind === 'not_applicable') {
    return [{ requiredLeafIds: [], alreadyMetLeafIds: [] }];
  }

  if (node.kind === 'LEAF') {
    if (node.outcome.status === 'MET') {
      return [{ requiredLeafIds: [], alreadyMetLeafIds: [node.nodeId] }];
    }
    return [{ requiredLeafIds: [node.nodeId], alreadyMetLeafIds: [] }];
  }

  const childPlans = node.children
    .filter((c) => c.outcome.kind === 'evaluated')
    .map((c) => walk(c, ctx));

  if (childPlans.length === 0) return [{ requiredLeafIds: [], alreadyMetLeafIds: [] }];

  switch (node.kind) {
    case 'ALL':
      return cartesian(childPlans, ctx);
    case 'ANY':
      // Альтернативы: достаточно выполнить любого ребёнка (BR-05).
      return childPlans.flat();
    case 'AT_LEAST': {
      const k = node.k ?? 1;
      const combos = chooseCombinations(childPlans.length, k, ctx);
      const out: SatisfactionPlan[] = [];
      for (const combo of combos) {
        const selected = combo.map((i) => childPlans[i]!);
        out.push(...cartesian(selected, ctx));
        if (out.length > ctx.limits.maxPlans * 4) {
          ctx.complete = false;
          ctx.stopReason = 'plan_limit';
          break;
        }
      }
      return out;
    }
  }
}

function cartesian(groups: SatisfactionPlan[][], ctx: Ctx): SatisfactionPlan[] {
  let acc: SatisfactionPlan[] = [{ requiredLeafIds: [], alreadyMetLeafIds: [] }];
  for (const group of groups) {
    if (group.length === 0) return [];
    const next: SatisfactionPlan[] = [];
    for (const a of acc) {
      for (const b of group) {
        next.push({
          requiredLeafIds: [...a.requiredLeafIds, ...b.requiredLeafIds],
          alreadyMetLeafIds: [...a.alreadyMetLeafIds, ...b.alreadyMetLeafIds],
        });
        if (next.length > ctx.limits.maxPlans * 4) {
          ctx.complete = false;
          ctx.stopReason = 'plan_limit';
          return next;
        }
      }
    }
    acc = next;
  }
  return acc;
}

function chooseCombinations(n: number, k: number, ctx: Ctx): number[][] {
  const out: number[][] = [];
  const cur: number[] = [];
  const rec = (start: number): void => {
    if (out.length > ctx.limits.maxPlans) {
      ctx.complete = false;
      ctx.stopReason = 'plan_limit';
      return;
    }
    if (cur.length === k) {
      out.push([...cur]);
      return;
    }
    for (let i = start; i < n; i++) {
      cur.push(i);
      rec(i + 1);
      cur.pop();
    }
  };
  rec(0);
  return out;
}

function dedupePlans(plans: SatisfactionPlan[]): SatisfactionPlan[] {
  const seen = new Set<string>();
  const out: SatisfactionPlan[] = [];
  for (const p of plans) {
    const required = [...new Set(p.requiredLeafIds)].sort();
    const already = [...new Set(p.alreadyMetLeafIds)].sort();
    const key = required.join(',') + '|' + already.join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ requiredLeafIds: required, alreadyMetLeafIds: already });
  }
  // Сначала варианты с наименьшим числом новых задач — это разумный порядок
  // показа, но НЕ утверждение о глобальной оптимальности (BR-09).
  return out.sort(
    (a, b) =>
      a.requiredLeafIds.length - b.requiredLeafIds.length ||
      a.requiredLeafIds.join(',').localeCompare(b.requiredLeafIds.join(',')),
  );
}
