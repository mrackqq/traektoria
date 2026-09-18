/**
 * UX-03 — показ дерева условий.
 *
 * ENG-02: сохранены ВСЕ дочерние результаты, даже когда итог группы уже
 * известен, — выполненная альтернатива не прячет конфликт в соседней ветке.
 * UX-03: неизвестное не заменяется прочерком; у каждого узла видно, почему
 * он в таком состоянии, на чём основан и когда источник проверялся.
 */

import type { EvaluatedNode } from '@core/eligibility/evaluate';
import { FRESHNESS_LABEL_RU, type CatalogSnapshot } from '@core/catalog/types';
import { STATUS_LABEL_RU, type ReqStatus } from '@core/kernel/status';
import { formatPlainDateRu } from '@core/kernel/time';

import { Badge } from './ui';
import { readableLabel } from './readable-label';

const STATUS_VIEW: Record<ReqStatus, { tone: 'ok' | 'warn' | 'risk' | 'unknown'; glyph: string }> = {
  MET: { tone: 'ok', glyph: '✓' },
  NOT_MET: { tone: 'warn', glyph: '△' },
  UNKNOWN: { tone: 'unknown', glyph: '?' },
  CONFLICT: { tone: 'risk', glyph: '≠' },
};

const GROUP_RULE_RU = (node: EvaluatedNode): string => {
  switch (node.kind) {
    case 'ALL':
      return 'Нужны все условия ниже';
    case 'ANY':
      return 'Достаточно любого одного условия ниже';
    case 'AT_LEAST':
      return `Нужно не менее ${node.k ?? '?'} условий из списка`;
    case 'LEAF':
      return '';
  }
};

export function RequirementTree({
  node,
  catalog,
  level = 0,
}: {
  node: EvaluatedNode;
  catalog: CatalogSnapshot;
  level?: number;
}) {
  const notApplicable = node.outcome.kind === 'not_applicable';
  const status = node.outcome.kind === 'evaluated' ? node.outcome.status : null;

  return (
    <li className={`task requirement-node${node.kind !== 'LEAF' ? ' requirement-node--group' : ''}`} data-status={status ?? 'not-applicable'}>
      <div className="stack-tight">
        <h3 className="task__title">{node.title}</h3>

        <ul className="badge-row">
          <li>
            {notApplicable ? (
              <Badge tone="neutral" glyph="—">
                Не относится к вам
              </Badge>
            ) : (
              <Badge tone={STATUS_VIEW[status!].tone} glyph={STATUS_VIEW[status!].glyph}>
                {STATUS_LABEL_RU[status!]}
              </Badge>
            )}
          </li>
          {node.critical ? (
            <li>
              <Badge tone="neutral" glyph="!">
                Обязательное
              </Badge>
            </li>
          ) : null}
          {node.kind !== 'LEAF' ? (
            <li>
              <Badge tone="neutral" glyph="⊂">
                {GROUP_RULE_RU(node)}
              </Badge>
            </li>
          ) : null}
        </ul>

        {node.explanation ? <p className="task__outcome">{readableLabel(node.explanation)}</p> : null}

        {node.evidence.length > 0 ? (
          <p className="task__meta">
            {node.evidence.map((e) => (
              <span key={`${e.label}-${e.value}`}>
                {readableLabel(e.label)}: <strong>{readableLabel(e.value)}</strong>
              </span>
            ))}
          </p>
        ) : null}

        <Sources ids={node.sourceIds} catalog={catalog} />

        {node.children.length > 0 ? (
          <ul className="tasks requirement-node__children">
            {node.children.map((c) => (
              <RequirementTree key={c.nodeId} node={c} catalog={catalog} level={level + 1} />
            ))}
          </ul>
        ) : null}
      </div>
    </li>
  );
}

/** DATA-02 / UX-03: источник и дата проверки рядом с условием, а не в сноске. */
export function Sources({ ids, catalog }: { ids: readonly string[]; catalog: CatalogSnapshot }) {
  const sources = ids
    .map((id) => catalog.sources.find((s) => s.id === id))
    .filter((s): s is NonNullable<typeof s> => s !== undefined);

  if (sources.length === 0) {
    return (
      <p className="task__meta">
        <span>Источник не указан — условие требует проверки у первоисточника.</span>
      </p>
    );
  }

  return (
    <p className="task__meta sources-line">
      {sources.map((s) => (
        <span key={s.id}>
          Источник: <a href={s.url} target="_blank" rel="noreferrer">{s.publisher}</a> · {FRESHNESS_LABEL_RU[s.freshness]}{' '}
          {formatPlainDateRu(s.verifiedAt.slice(0, 10))}
          {s.isDemo ? ' · значение ориентировочное' : ''}
        </span>
      ))}
    </p>
  );
}
