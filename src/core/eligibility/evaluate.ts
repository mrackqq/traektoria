/**
 * ENG-02 / ENG-05 / ENG-07 / ENG-08 — вычисление дерева требований.
 *
 * Инварианты, которые здесь нельзя нарушать:
 *  • все дочерние результаты сохраняются, даже когда итог группы уже известен
 *    (ENG-02) — выполненная альтернатива не скрывает конфликт в другом пути;
 *  • применимость проверяется до оценки узла;
 *  • неизвестное обязательное условие никогда не становится MET;
 *  • расчёт возвращает машинно-читаемые reason_codes и ссылки на источники.
 */

import {
  combineGroup,
  EVALUATED,
  NOT_APPLICABLE,
  STATUS_RANK,
  type Applicability,
  type NodeOutcome,
  type ReqStatus,
} from '../kernel/status';
import type {
  ApplicabilityScope,
  LeafPredicate,
  RequirementLeaf,
  RequirementNode,
} from '../kernel/requirement';
import type { ApplicantProfileRevision, Provenance } from '../kernel/profile';
import { valueOf } from '../kernel/profile';
import type { PlainDate, PlanningClock } from '../kernel/time';
import { daysBetween } from '../kernel/time';
import { computeFreshness, type CatalogSnapshot, type SourceConflict } from '../catalog/types';

export type ReasonCode =
  | 'NOT_APPLICABLE'
  | 'APPLICABILITY_UNKNOWN'
  | 'SOURCE_CONFLICT'
  | 'SOURCE_RETRACTED'
  | 'SOURCE_STALE_CRITICAL'
  | 'EXAM_NOT_TAKEN'
  | 'EXAM_SCHEDULED'
  | 'EXAM_AWAITING_RESULT'
  | 'EXAM_SCORE_BELOW'
  | 'EXAM_COMPONENT_BELOW'
  | 'EXAM_COMPONENT_UNKNOWN'
  | 'EXAM_RESULT_EXPIRED'
  | 'EXAM_EXPIRES_BEFORE_CONTROL_DATE'
  | 'GPA_BELOW'
  | 'GPA_UNKNOWN'
  | 'SUBJECT_MISSING'
  | 'SUBJECT_SCORE_BELOW'
  | 'DOCUMENT_MISSING'
  | 'DOCUMENT_EXPIRES_BEFORE_CONTROL_DATE'
  | 'CATEGORY_MISMATCH'
  | 'CATEGORY_UNKNOWN'
  | 'EDUCATION_LEVEL_MISMATCH'
  | 'EDUCATION_LEVEL_UNKNOWN'
  | 'MET_SELF_REPORTED'
  | 'MET_VERIFIED'
  | 'MET_DEMO'
  | 'GROUP_EMPTY_AFTER_FILTER'
  | 'AT_LEAST_CARDINALITY_UNREACHABLE';

export interface EvaluatedNode {
  readonly nodeId: string;
  readonly title: string;
  readonly kind: 'LEAF' | 'ALL' | 'ANY' | 'AT_LEAST';
  readonly k?: number;
  readonly outcome: NodeOutcome;
  readonly reasonCodes: readonly ReasonCode[];
  /** Человеческое объяснение, собранное детерминированно (AI-04: не от LLM). */
  readonly explanation: string;
  readonly sourceIds: readonly string[];
  readonly provenance?: Provenance;
  readonly critical: boolean;
  /** Значения профиля, повлиявшие на результат (ENG-05). */
  readonly evidence: readonly { readonly label: string; readonly value: string }[];
  readonly children: readonly EvaluatedNode[];
  /** ENG-08: логический элемент для подсчёта мощности. */
  readonly countingKey?: string;
}

export interface EvaluationInput {
  readonly profile: ApplicantProfileRevision;
  readonly node: RequirementNode;
  readonly controlDate: PlainDate;
  readonly catalog: CatalogSnapshot;
  readonly clock: PlanningClock;
  readonly admissionPathId: string;
  readonly nearestDeadline?: PlainDate;
}

/* ------------------------------------------------------------------ */
/* Применимость (REV-05)                                               */
/* ------------------------------------------------------------------ */

/**
 * Три состояния вместо двух. «Не знаю» в поле, от которого зависит область
 * применимости, даёт `applicability_unknown` — узел не отбрасывается и не
 * считается выполненным, а порождает задачу уточнения профиля.
 */
export function resolveApplicability(
  scope: ApplicabilityScope | undefined,
  profile: ApplicantProfileRevision,
  admissionPathId: string,
): Applicability {
  if (!scope) return 'applicable';

  if (scope.admissionPathIds && !scope.admissionPathIds.includes(admissionPathId)) {
    return 'not_applicable';
  }

  if (scope.citizenship) {
    const c = profile.citizenship;
    if (c.state === 'dont_know' || c.state === 'unanswered') return 'applicability_unknown';
    if (c.state === 'not_applicable') return 'not_applicable';
    if (!scope.citizenship.includes(c.value)) return 'not_applicable';
  }

  if (scope.applicantCategory) {
    const cat = profile.applicantCategory;
    if (cat.state === 'dont_know' || cat.state === 'unanswered') return 'applicability_unknown';
    if (cat.state === 'not_applicable') return 'not_applicable';
    if (!scope.applicantCategory.includes(cat.value)) return 'not_applicable';
  }

  if (scope.instructionLanguage) {
    const overlap = profile.instructionLanguages.some((l) =>
      scope.instructionLanguage!.includes(l),
    );
    if (profile.instructionLanguages.length === 0) return 'applicability_unknown';
    if (!overlap) return 'not_applicable';
  }

  return 'applicable';
}

/* ------------------------------------------------------------------ */
/* Точка входа                                                         */
/* ------------------------------------------------------------------ */

export function evaluateTree(input: EvaluationInput): EvaluatedNode {
  return evaluateNode(input.node, input);
}

function evaluateNode(node: RequirementNode, ctx: EvaluationInput): EvaluatedNode {
  const applicability = resolveApplicability(node.scope, ctx.profile, ctx.admissionPathId);

  if (applicability === 'not_applicable') {
    return {
      nodeId: node.id,
      title: node.title,
      kind: node.nodeType === 'LEAF' ? 'LEAF' : node.groupType,
      outcome: NOT_APPLICABLE,
      reasonCodes: ['NOT_APPLICABLE'],
      explanation: 'Условие не относится к вашей категории заявителя.',
      sourceIds: node.nodeType === 'LEAF' ? node.sourceRefs : [],
      critical: node.nodeType === 'LEAF' ? node.critical : false,
      evidence: [],
      children: [],
      ...(node.nodeType === 'LEAF' ? { countingKey: node.countingKey } : {}),
    };
  }

  if (applicability === 'applicability_unknown') {
    return {
      nodeId: node.id,
      title: node.title,
      kind: node.nodeType === 'LEAF' ? 'LEAF' : node.groupType,
      outcome: EVALUATED('UNKNOWN'),
      reasonCodes: ['APPLICABILITY_UNKNOWN'],
      explanation:
        'Неизвестно, относится ли это условие к вам: в профиле не хватает ответа ' +
        'о гражданстве или категории заявителя.',
      sourceIds: node.nodeType === 'LEAF' ? node.sourceRefs : [],
      critical: node.nodeType === 'LEAF' ? node.critical : false,
      evidence: [],
      children: [],
      ...(node.nodeType === 'LEAF' ? { countingKey: node.countingKey } : {}),
    };
  }

  return node.nodeType === 'LEAF' ? evaluateLeaf(node, ctx) : evaluateGroup(node, ctx);
}

/* ------------------------------------------------------------------ */
/* Группы                                                              */
/* ------------------------------------------------------------------ */

function evaluateGroup(
  node: Extract<RequirementNode, { nodeType: 'GROUP' }>,
  ctx: EvaluationInput,
): EvaluatedNode {
  // ENG-02: считаем ВСЕХ детей, даже если итог уже предопределён.
  const children = node.children.map((c) => evaluateNode(c, ctx));

  let outcome: NodeOutcome;
  const reasons: ReasonCode[] = [];

  if (node.groupType === 'AT_LEAST') {
    // ENG-08: дубликаты одного логического элемента схлопываются ДО подсчёта.
    const collapsed = collapseByCountingKey(children);
    outcome = combineGroup({ type: 'AT_LEAST', k: node.k }, collapsed);
    if (outcome.kind === 'evaluated' && outcome.status === 'NOT_MET') {
      reasons.push('AT_LEAST_CARDINALITY_UNREACHABLE');
    }
  } else {
    outcome = combineGroup(
      { type: node.groupType },
      children.map((c) => c.outcome),
    );
  }

  if (outcome.kind === 'not_applicable' && children.length > 0) {
    // REV-04: группа опустела после applicability-фильтрации.
    reasons.push('GROUP_EMPTY_AFTER_FILTER');
  }

  const anyConflict = children.some(
    (c) => c.outcome.kind === 'evaluated' && c.outcome.status === 'CONFLICT',
  );
  if (anyConflict && !reasons.includes('SOURCE_CONFLICT')) reasons.push('SOURCE_CONFLICT');

  return {
    nodeId: node.id,
    title: node.title,
    kind: node.groupType,
    ...(node.groupType === 'AT_LEAST' ? { k: node.k } : {}),
    outcome,
    reasonCodes: reasons,
    explanation: explainGroup(node, children, outcome),
    sourceIds: [...new Set(children.flatMap((c) => c.sourceIds))],
    critical: children.some((c) => c.critical),
    evidence: [],
    children,
  };
}

/**
 * ENG-08 / AC-34: сводим дубликаты одного `counting_key` к одному элементу,
 * беря лучший достигнутый статус. Один документ может подтвердить несколько
 * действительно разных элементов, но один предмет не считается дважды.
 */
function collapseByCountingKey(children: readonly EvaluatedNode[]): NodeOutcome[] {
  const byKey = new Map<string, NodeOutcome>();
  const unkeyed: NodeOutcome[] = [];

  for (const child of children) {
    if (child.outcome.kind === 'not_applicable') continue;
    const key = child.countingKey;
    if (!key) {
      unkeyed.push(child.outcome);
      continue;
    }
    const prev = byKey.get(key);
    if (!prev || prev.kind === 'not_applicable') {
      byKey.set(key, child.outcome);
      continue;
    }
    const prevRank = STATUS_RANK[prev.status];
    const curRank = STATUS_RANK[child.outcome.status];
    if (curRank < prevRank) byKey.set(key, child.outcome);
  }

  return [...byKey.values(), ...unkeyed];
}

function explainGroup(
  node: Extract<RequirementNode, { nodeType: 'GROUP' }>,
  children: readonly EvaluatedNode[],
  outcome: NodeOutcome,
): string {
  if (outcome.kind === 'not_applicable') return 'Ни одно условие группы не относится к вам.';
  const total = children.filter((c) => c.outcome.kind === 'evaluated').length;
  const met = children.filter(
    (c) => c.outcome.kind === 'evaluated' && c.outcome.status === 'MET',
  ).length;

  switch (node.groupType) {
    case 'ALL':
      return `Нужно выполнить все условия: ${met} из ${total}.`;
    case 'ANY':
      return `Достаточно одного условия из ${total}. Выполнено: ${met}.`;
    case 'AT_LEAST':
      return `Нужно не менее ${node.k} из ${total}. Выполнено: ${met}.`;
  }
}

/* ------------------------------------------------------------------ */
/* Листья                                                              */
/* ------------------------------------------------------------------ */

function evaluateLeaf(leaf: RequirementLeaf, ctx: EvaluationInput): EvaluatedNode {
  const base = {
    nodeId: leaf.id,
    title: leaf.title,
    kind: 'LEAF' as const,
    sourceIds: leaf.sourceRefs,
    critical: leaf.critical,
    children: [] as EvaluatedNode[],
    countingKey: leaf.countingKey,
  };

  // DATA-04: конфликт источников важнее любого вычисленного значения.
  const conflict = findConflict(ctx.catalog.conflicts, leaf.id);
  if (conflict) {
    return {
      ...base,
      outcome: EVALUATED('CONFLICT'),
      reasonCodes: ['SOURCE_CONFLICT'],
      explanation: `Официальные источники расходятся: ${conflict.description}`,
      evidence: conflict.versions.map((v) => ({ label: v.sourceId, value: v.claim })),
    };
  }

  // ENG-07: применимое критическое условие со stale/retracted свидетельством
  // получает UNKNOWN для текущего решения. Историческое значение положительного
  // заключения не даёт.
  const sourceState = worstSourceState(leaf.sourceRefs, ctx);
  if (leaf.critical && sourceState === 'retracted') {
    return {
      ...base,
      outcome: EVALUATED('UNKNOWN'),
      reasonCodes: ['SOURCE_RETRACTED'],
      explanation: 'Источник условия отозван. Нужна перепроверка перед выводом.',
      evidence: [],
    };
  }
  if (leaf.critical && sourceState === 'stale') {
    return {
      ...base,
      outcome: EVALUATED('UNKNOWN'),
      reasonCodes: ['SOURCE_STALE_CRITICAL'],
      explanation:
        'Срок проверки источника истёк. Пока условие не перепроверено, считать его ' +
        'выполненным нельзя.',
      evidence: [],
    };
  }

  const controlDate = leaf.validAtOverride ?? ctx.controlDate;
  const r = evaluatePredicate(leaf.predicate, ctx.profile, controlDate);

  return {
    ...base,
    outcome: EVALUATED(r.status),
    reasonCodes: r.reasons,
    explanation: r.explanation,
    evidence: r.evidence,
    ...(r.provenance ? { provenance: r.provenance } : {}),
  };
}

function findConflict(conflicts: readonly SourceConflict[], nodeId: string): SourceConflict | undefined {
  return conflicts.find((c) => c.targetId === nodeId);
}

function worstSourceState(
  sourceIds: readonly string[],
  ctx: EvaluationInput,
): 'fresh' | 'stale' | 'retracted' {
  let worst: 'fresh' | 'stale' | 'retracted' = 'fresh';
  for (const id of sourceIds) {
    const src = ctx.catalog.sources.find((s) => s.id === id);
    if (!src) {
      // Ссылка на отсутствующий источник — не повод считать условие проверенным.
      worst = 'stale';
      continue;
    }
    const state = computeFreshness(src, ctx.clock.now, ctx.nearestDeadline);
    if (state === 'retracted') return 'retracted';
    if (state === 'stale') worst = 'stale';
  }
  return worst;
}

/* ------------------------------------------------------------------ */
/* Предикаты                                                           */
/* ------------------------------------------------------------------ */

interface PredicateResult {
  readonly status: ReqStatus;
  readonly reasons: ReasonCode[];
  readonly explanation: string;
  readonly evidence: { label: string; value: string }[];
  readonly provenance?: Provenance;
}

function evaluatePredicate(
  p: LeafPredicate,
  profile: ApplicantProfileRevision,
  controlDate: PlainDate,
): PredicateResult {
  switch (p.type) {
    case 'exam_score':
      return evaluateExam(p, profile, controlDate);
    case 'gpa':
      return evaluateGpa(p, profile);
    case 'subject':
      return evaluateSubject(p, profile);
    case 'document':
      return evaluateDocument(p, profile, controlDate);
    case 'applicant_category':
      return evaluateCategory(p, profile);
    case 'education_level':
      return evaluateEducationLevel(p, profile);
  }
}

function evaluateExam(
  p: Extract<LeafPredicate, { type: 'exam_score' }>,
  profile: ApplicantProfileRevision,
  controlDate: PlainDate,
): PredicateResult {
  const rec = profile.exams.find((e) => e.examKind === p.examKind && e.scaleId === p.scaleId);

  if (!rec || rec.state === 'not_taken') {
    return {
      status: 'NOT_MET',
      reasons: ['EXAM_NOT_TAKEN'],
      explanation: `Экзамен ${p.examKind} ещё не сдан.`,
      evidence: [],
    };
  }

  // AC-07: регистрация и сдача не закрывают требование к результату.
  if (rec.state === 'scheduled') {
    return {
      status: 'NOT_MET',
      reasons: ['EXAM_SCHEDULED'],
      explanation: `Вы записаны на ${p.examKind}${
        rec.scheduledFor ? ` на ${rec.scheduledFor}` : ''
      }, но результата ещё нет.`,
      evidence: [],
      provenance: rec.provenance,
    };
  }
  if (rec.state === 'taken_awaiting_result') {
    return {
      status: 'NOT_MET',
      reasons: ['EXAM_AWAITING_RESULT'],
      explanation: `Экзамен ${p.examKind} сдан, результат ещё не получен. Требование ` +
        'закрывается результатом, а не фактом сдачи.',
      evidence: [],
      provenance: rec.provenance,
    };
  }
  if (rec.state === 'expired') {
    return {
      status: 'NOT_MET',
      reasons: ['EXAM_RESULT_EXPIRED'],
      explanation: `Результат ${p.examKind} истёк.`,
      evidence: [],
      provenance: rec.provenance,
    };
  }

  // AC-06: результат действителен сегодня, но истекает к контрольной дате.
  if (rec.validUntil && daysBetween(rec.validUntil, controlDate) > 0) {
    return {
      status: 'NOT_MET',
      reasons: ['EXAM_EXPIRES_BEFORE_CONTROL_DATE'],
      explanation:
        `Результат ${p.examKind} действителен до ${rec.validUntil}, а требуется на ` +
        `${controlDate}. Для этой кампании он не засчитывается.`,
      evidence: [
        { label: 'Действителен до', value: rec.validUntil },
        { label: 'Требуется на', value: controlDate },
      ],
      provenance: rec.provenance,
    };
  }

  // AC-05: компонентный балл ниже порога при достаточном общем.
  if (p.target === 'component') {
    const comp = rec.components?.find((c) => c.component === p.component);
    if (comp === undefined) {
      return {
        status: 'UNKNOWN',
        reasons: ['EXAM_COMPONENT_UNKNOWN'],
        explanation: `Не указан балл по компоненту «${p.component}» экзамена ${p.examKind}.`,
        evidence: [],
        provenance: rec.provenance,
      };
    }
    if (comp.score < p.min) {
      return {
        status: 'NOT_MET',
        reasons: ['EXAM_COMPONENT_BELOW'],
        explanation:
          `Компонент «${p.component}»: ${comp.score} при минимуме ${p.min}. ` +
          'Общий балл здесь не компенсирует компонентный.',
        evidence: [
          { label: `${p.examKind} · ${p.component}`, value: String(comp.score) },
          { label: 'Минимум', value: String(p.min) },
        ],
        provenance: rec.provenance,
      };
    }
    return met(rec.provenance, [
      { label: `${p.examKind} · ${p.component}`, value: String(comp.score) },
      { label: 'Минимум', value: String(p.min) },
    ]);
  }

  if (rec.overall === undefined) {
    return {
      status: 'UNKNOWN',
      reasons: ['EXAM_COMPONENT_UNKNOWN'],
      explanation: `Общий балл ${p.examKind} не указан.`,
      evidence: [],
      provenance: rec.provenance,
    };
  }
  if (rec.overall < p.min) {
    return {
      status: 'NOT_MET',
      reasons: ['EXAM_SCORE_BELOW'],
      explanation: `${p.examKind}: ${rec.overall} при минимуме ${p.min}.`,
      evidence: [
        { label: p.examKind, value: String(rec.overall) },
        { label: 'Минимум', value: String(p.min) },
      ],
      provenance: rec.provenance,
    };
  }
  return met(rec.provenance, [
    { label: p.examKind, value: String(rec.overall) },
    { label: 'Минимум', value: String(p.min) },
  ]);
}

function evaluateGpa(
  p: Extract<LeafPredicate, { type: 'gpa' }>,
  profile: ApplicantProfileRevision,
): PredicateResult {
  // PF-02: приведение между шкалами только по утверждённому правилу.
  // Правила нет — сравниваем строго в одной шкале, иначе UNKNOWN.
  const g = profile.grades.find((x) => x.scaleId === p.scaleId);
  if (!g) {
    return {
      status: 'UNKNOWN',
      reasons: ['GPA_UNKNOWN'],
      explanation: `Средний балл в шкале «${p.scaleId}» не указан. Пересчёт из другой ` +
        'шкалы без утверждённого правила не выполняется.',
      evidence: [],
    };
  }
  if (g.value < p.min) {
    return {
      status: 'NOT_MET',
      reasons: ['GPA_BELOW'],
      explanation: `Средний балл ${g.value} при минимуме ${p.min} (шкала ${p.scaleId}).`,
      evidence: [
        { label: `Средний балл (${p.scaleId})`, value: String(g.value) },
        { label: 'Минимум', value: String(p.min) },
      ],
      provenance: g.provenance,
    };
  }
  return met(g.provenance, [
    { label: `Средний балл (${p.scaleId})`, value: String(g.value) },
    { label: 'Минимум', value: String(p.min) },
  ]);
}

function evaluateSubject(
  p: Extract<LeafPredicate, { type: 'subject' }>,
  profile: ApplicantProfileRevision,
): PredicateResult {
  const s = profile.subjects.find((x) => x.subjectId === p.subjectId);
  if (!s) {
    return {
      status: 'NOT_MET',
      reasons: ['SUBJECT_MISSING'],
      explanation: `Предмет «${p.subjectId}» не указан в профиле.`,
      evidence: [],
    };
  }
  if (p.minScore !== undefined) {
    if (s.score === undefined || (p.scaleId && s.scaleId !== p.scaleId)) {
      return {
        status: 'UNKNOWN',
        reasons: ['SUBJECT_SCORE_BELOW'],
        explanation: `Балл по предмету «${p.subjectId}» в нужной шкале не указан.`,
        evidence: [],
        provenance: s.provenance,
      };
    }
    if (s.score < p.minScore) {
      return {
        status: 'NOT_MET',
        reasons: ['SUBJECT_SCORE_BELOW'],
        explanation: `«${p.subjectId}»: ${s.score} при минимуме ${p.minScore}.`,
        evidence: [
          { label: p.subjectId, value: String(s.score) },
          { label: 'Минимум', value: String(p.minScore) },
        ],
        provenance: s.provenance,
      };
    }
  }
  return met(s.provenance, [
    { label: p.subjectId, value: s.score !== undefined ? String(s.score) : 'изучен' },
  ]);
}

function evaluateDocument(
  p: Extract<LeafPredicate, { type: 'document' }>,
  profile: ApplicantProfileRevision,
  controlDate: PlainDate,
): PredicateResult {
  const d = profile.documents.find((x) => x.documentKind === p.documentKind);
  if (!d || !d.obtained) {
    return {
      status: 'NOT_MET',
      reasons: ['DOCUMENT_MISSING'],
      explanation: `Документ «${p.documentKind}» ещё не получен.`,
      evidence: [],
    };
  }
  if (d.validUntil && daysBetween(d.validUntil, controlDate) > 0) {
    return {
      status: 'NOT_MET',
      reasons: ['DOCUMENT_EXPIRES_BEFORE_CONTROL_DATE'],
      explanation:
        `Документ действителен до ${d.validUntil}, а нужен на ${controlDate}.`,
      evidence: [{ label: 'Действителен до', value: d.validUntil }],
      provenance: d.provenance,
    };
  }
  return met(d.provenance, [{ label: p.documentKind, value: 'получен' }]);
}

function evaluateCategory(
  p: Extract<LeafPredicate, { type: 'applicant_category' }>,
  profile: ApplicantProfileRevision,
): PredicateResult {
  const cat = profile.applicantCategory;
  if (cat.state !== 'known') {
    return {
      status: 'UNKNOWN',
      reasons: ['CATEGORY_UNKNOWN'],
      explanation: 'Категория заявителя не указана в профиле.',
      evidence: [],
    };
  }
  if (!p.allowed.includes(cat.value)) {
    return {
      status: 'NOT_MET',
      reasons: ['CATEGORY_MISMATCH'],
      explanation: `Путь доступен категориям: ${p.allowed.join(', ')}.`,
      evidence: [{ label: 'Ваша категория', value: cat.value }],
    };
  }
  return met('self_reported', [{ label: 'Категория', value: cat.value }]);
}

function evaluateEducationLevel(
  p: Extract<LeafPredicate, { type: 'education_level' }>,
  profile: ApplicantProfileRevision,
): PredicateResult {
  const lvl = valueOf(profile.educationLevel);
  if (lvl === undefined) {
    return {
      status: 'UNKNOWN',
      reasons: ['EDUCATION_LEVEL_UNKNOWN'],
      explanation: 'Класс или уровень образования не указан.',
      evidence: [],
    };
  }
  if (!p.allowed.includes(lvl)) {
    return {
      status: 'NOT_MET',
      reasons: ['EDUCATION_LEVEL_MISMATCH'],
      explanation: `Требуется один из уровней: ${p.allowed.join(', ')}.`,
      evidence: [{ label: 'Ваш уровень', value: lvl }],
    };
  }
  return met('self_reported', [{ label: 'Уровень образования', value: lvl }]);
}

/** ENG-02: MET по самоотчёту подписывается иначе, чем официально подтверждённое. */
function met(provenance: Provenance, evidence: { label: string; value: string }[]): PredicateResult {
  const reason: ReasonCode =
    provenance === 'institution_verified'
      ? 'MET_VERIFIED'
      : provenance === 'demo'
        ? 'MET_DEMO'
        : 'MET_SELF_REPORTED';
  const explanation =
    provenance === 'institution_verified'
      ? 'Условие подтверждено проверенными данными.'
      : 'Соответствует указанным вами данным. Это не официальная проверка.';
  return { status: 'MET', reasons: [reason], explanation, evidence, provenance };
}

/* ------------------------------------------------------------------ */
/* Обход результата                                                    */
/* ------------------------------------------------------------------ */

export function flattenLeaves(node: EvaluatedNode): EvaluatedNode[] {
  if (node.kind === 'LEAF') return [node];
  return node.children.flatMap(flattenLeaves);
}

/** Пробелы: применимые листья, которые сейчас не выполнены. */
export function collectGaps(node: EvaluatedNode): EvaluatedNode[] {
  return flattenLeaves(node).filter(
    (l) => l.outcome.kind === 'evaluated' && l.outcome.status !== 'MET',
  );
}

export function countByStatus(node: EvaluatedNode): Record<ReqStatus | 'NOT_APPLICABLE', number> {
  const acc: Record<ReqStatus | 'NOT_APPLICABLE', number> = {
    MET: 0,
    NOT_MET: 0,
    UNKNOWN: 0,
    CONFLICT: 0,
    NOT_APPLICABLE: 0,
  };
  for (const leaf of flattenLeaves(node)) {
    if (leaf.outcome.kind === 'not_applicable') acc.NOT_APPLICABLE++;
    else acc[leaf.outcome.status]++;
  }
  return acc;
}
