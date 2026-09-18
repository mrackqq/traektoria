/**
 * ENG-01 — версионированное типизированное дерево требований.
 *
 * Дерево требований и граф действий (BR-04) — разные структуры.
 * Здесь только «что должно быть истинно», без «что делать».
 */

import type { PlainDate } from './time';

/* ------------------------------------------------------------------ */
/* Применимость (ENG-02 + REV-05)                                      */
/* ------------------------------------------------------------------ */

/**
 * Область применимости узла. Пустые поля означают «ограничения нет».
 * DATA-01: условия разных кампаний, категорий, кампусов, языков и путей
 * подачи нельзя смешивать — поэтому применимость хранится на каждом узле.
 */
export interface ApplicabilityScope {
  readonly citizenship?: readonly string[];
  readonly applicantCategory?: readonly string[];
  readonly admissionPathIds?: readonly string[];
  readonly instructionLanguage?: readonly string[];
}

/* ------------------------------------------------------------------ */
/* Листовые предикаты                                                  */
/* ------------------------------------------------------------------ */

export type LeafPredicate =
  /** Балл экзамена: общий или компонентный (AC-05). */
  | {
      readonly type: 'exam_score';
      readonly examKind: string;
      readonly scaleId: string;
      readonly target: 'overall' | 'component';
      readonly component?: string;
      readonly min: number;
      readonly max?: number;
    }
  /** Средний балл аттестата в названной шкале (PF-02: приведение только по правилу). */
  | {
      readonly type: 'gpa';
      readonly scaleId: string;
      readonly min: number;
    }
  /** Изученный/сданный предмет — участвует в AT_LEAST по counting_key (ENG-08). */
  | {
      readonly type: 'subject';
      readonly subjectId: string;
      readonly minScore?: number;
      readonly scaleId?: string;
    }
  /** Наличие документа. */
  | {
      readonly type: 'document';
      readonly documentKind: string;
    }
  /** Категория заявителя/гражданство как самостоятельное условие, а не только scope. */
  | {
      readonly type: 'applicant_category';
      readonly allowed: readonly string[];
    }
  /** Год окончания школы / статус образования. */
  | {
      readonly type: 'education_level';
      readonly allowed: readonly string[];
    };

export interface RequirementLeaf {
  readonly nodeType: 'LEAF';
  readonly id: string;
  readonly title: string;
  readonly predicate: LeafPredicate;
  readonly scope?: ApplicabilityScope;
  /**
   * ENG-08: ключ подсчёта. Разные листья с одинаковым counting_key — один
   * логический элемент. Дублирование предиката не увеличивает мощность.
   */
  readonly countingKey: string;
  /** Является ли условие критическим — влияет на ENG-07 и DATA-06. */
  readonly critical: boolean;
  readonly sourceRefs: readonly string[];
  /**
   * Дата, на которую результат должен быть действителен (AC-06).
   * Если не задана — берётся контрольная дата кампании.
   */
  readonly validAtOverride?: PlainDate;
  readonly explain?: string;
}

export type RequirementGroup = {
  readonly nodeType: 'GROUP';
  readonly id: string;
  readonly title: string;
  readonly scope?: ApplicabilityScope;
  readonly children: readonly RequirementNode[];
  readonly explain?: string;
} & (
  | { readonly groupType: 'ALL' }
  | { readonly groupType: 'ANY' }
  | { readonly groupType: 'AT_LEAST'; readonly k: number }
);

export type RequirementNode = RequirementLeaf | RequirementGroup;

export interface RequirementTreeVersion {
  readonly id: string;
  readonly version: number;
  readonly intakeId: string;
  readonly root: RequirementGroup;
  readonly publishedAt: string;
}

/* ------------------------------------------------------------------ */
/* Валидация шаблона при публикации (ENG-08, BR-04)                    */
/* ------------------------------------------------------------------ */

export interface TemplateProblem {
  readonly nodeId: string;
  readonly code:
    | 'EMPTY_GROUP'
    | 'INVALID_K'
    | 'DUPLICATE_NODE_ID'
    | 'DUPLICATE_COUNTING_KEY_IN_AT_LEAST';
  readonly message: string;
}

/**
 * ENG-08: пустые ALL/ANY в опубликованном шаблоне запрещены;
 * для AT_LEAST обязательно 1 ≤ k ≤ число уникальных элементов.
 * Некорректный шаблон блокирует публикацию, а не «чинится» на лету (AC-34).
 */
export function validateTemplate(root: RequirementNode): TemplateProblem[] {
  const problems: TemplateProblem[] = [];
  const seenIds = new Set<string>();

  const walk = (node: RequirementNode): void => {
    if (seenIds.has(node.id)) {
      problems.push({
        nodeId: node.id,
        code: 'DUPLICATE_NODE_ID',
        message: `Идентификатор узла «${node.id}» встречается дважды`,
      });
    }
    seenIds.add(node.id);

    if (node.nodeType === 'LEAF') return;

    if (node.children.length === 0) {
      problems.push({
        nodeId: node.id,
        code: 'EMPTY_GROUP',
        message: `Пустая группа «${node.title}» не может быть опубликована`,
      });
      return;
    }

    if (node.groupType === 'AT_LEAST') {
      const uniqueKeys = new Set(collectCountingKeys(node));
      if (!Number.isInteger(node.k) || node.k < 1 || node.k > uniqueKeys.size) {
        problems.push({
          nodeId: node.id,
          code: 'INVALID_K',
          message:
            `AT_LEAST(${node.k}) в «${node.title}»: k должно быть целым в диапазоне ` +
            `1…${uniqueKeys.size} (число уникальных элементов)`,
        });
      }
    }

    node.children.forEach(walk);
  };

  walk(root);
  return problems;
}

/** Уникальные логические элементы поддерева — основа cardinality для AT_LEAST. */
export function collectCountingKeys(node: RequirementNode): string[] {
  if (node.nodeType === 'LEAF') return [node.countingKey];
  return node.children.flatMap(collectCountingKeys);
}

export function countLeaves(node: RequirementNode): number {
  return node.nodeType === 'LEAF' ? 1 : node.children.reduce((n, c) => n + countLeaves(c), 0);
}

export function findNode(root: RequirementNode, id: string): RequirementNode | null {
  if (root.id === id) return root;
  if (root.nodeType === 'LEAF') return null;
  for (const child of root.children) {
    const hit = findNode(child, id);
    if (hit) return hit;
  }
  return null;
}
