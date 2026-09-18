/**
 * Примитивы показа.
 *
 * Здесь нет вычислений: значения приходят из ядра готовыми. Задача модуля —
 * показать их так, чтобы смысл не зависел от цвета (UX-09) и чтобы
 * неизвестное не превращалось в прочерк без пояснения (UX-03).
 */

import type { ReactNode } from 'react';

import { ELIGIBILITY_LABEL_RU, type EligibilityStatus, type DataQuality, type ProgramBucket, BUCKET_LABEL_RU } from '@core/eligibility/program-result';
import { FEASIBILITY_LABEL_RU, type FeasibilityStatus } from '@core/planning/bridge';
import { formatMoneyRu, type BudgetVerdict } from '@core/kernel/money';
import { describeDeadlineRu, type Deadline, DEADLINE_KIND_LABEL_RU, resolveDeadline } from '@core/kernel/time';
import { TASK_STATUS_LABEL_RU, type TaskStatus } from '@core/progress/state';
import type { ProgressCounters } from '@core/progress/counters';
import { VALIDITY_REASON_RU, type CalculationKey } from '@core/kernel/reproducibility';
import { Icon } from './icon';

type Tone = 'ok' | 'warn' | 'risk' | 'unknown' | 'demo' | 'neutral';

/** Значок статуса: подпись обязательна, глиф — вторая, нецветовая опора. */
export function Badge({
  tone,
  glyph,
  children,
}: {
  tone: Tone;
  glyph: string;
  children: ReactNode;
}) {
  return (
    <span className={`badge badge--${tone}`}>
      <span className="badge__glyph" aria-hidden="true">
        {glyph}
      </span>
      {children}
    </span>
  );
}

const ELIGIBILITY_TONE: Record<EligibilityStatus, { tone: Tone; glyph: string }> = {
  conditions_met: { tone: 'ok', glyph: '✓' },
  gaps_identified: { tone: 'warn', glyph: '△' },
  blocked: { tone: 'risk', glyph: '✕' },
  undetermined: { tone: 'unknown', glyph: '?' },
};

export function EligibilityBadge({ status }: { status: EligibilityStatus }) {
  const v = ELIGIBILITY_TONE[status];
  return (
    <Badge tone={v.tone} glyph={v.glyph}>
      {ELIGIBILITY_LABEL_RU[status]}
    </Badge>
  );
}

const QUALITY_LABEL: Record<DataQuality, { text: string; tone: Tone; glyph: string }> = {
  verified: { text: 'Проверено источником', tone: 'ok', glyph: '✓' },
  self_reported: { text: 'С ваших слов', tone: 'neutral', glyph: '•' },
  stale: { text: 'Данные устарели', tone: 'warn', glyph: '⌛' },
  conflict: { text: 'Источники расходятся', tone: 'risk', glyph: '≠' },
  demo: { text: 'Условия ориентировочные — проверьте у вуза', tone: 'demo', glyph: '≈' },
};

export function DataQualityBadge({ quality }: { quality: DataQuality }) {
  const v = QUALITY_LABEL[quality];
  return (
    <Badge tone={v.tone} glyph={v.glyph}>
      {v.text}
    </Badge>
  );
}

const BUCKET_TONE: Record<ProgramBucket, { tone: Tone; glyph: string }> = {
  recommended: { tone: 'ok', glyph: '★' },
  needs_verification: { tone: 'warn', glyph: '?' },
  not_suitable: { tone: 'risk', glyph: '—' },
};

export function BucketBadge({ bucket }: { bucket: ProgramBucket }) {
  const v = BUCKET_TONE[bucket];
  return (
    <Badge tone={v.tone} glyph={v.glyph}>
      {BUCKET_LABEL_RU[bucket]}
    </Badge>
  );
}

const FEASIBILITY_TONE: Record<FeasibilityStatus, { tone: Tone; glyph: string }> = {
  feasible_under_assumptions: { tone: 'ok', glyph: '✓' },
  infeasible_under_assumptions: { tone: 'risk', glyph: '✕' },
  undetermined: { tone: 'unknown', glyph: '?' },
  search_incomplete: { tone: 'unknown', glyph: '…' },
};

export function FeasibilityBadge({ status }: { status: FeasibilityStatus }) {
  const v = FEASIBILITY_TONE[status];
  return (
    <Badge tone={v.tone} glyph={v.glyph}>
      {FEASIBILITY_LABEL_RU[status]}
    </Badge>
  );
}

const TASK_STATUS_TONE: Record<TaskStatus, { tone: Tone; glyph: string }> = {
  todo: { tone: 'neutral', glyph: '○' },
  in_progress: { tone: 'warn', glyph: '◐' },
  awaiting_result: { tone: 'unknown', glyph: '⌛' },
  done: { tone: 'ok', glyph: '✓' },
  skipped: { tone: 'neutral', glyph: '↷' },
  obsolete: { tone: 'neutral', glyph: '✕' },
};

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const v = TASK_STATUS_TONE[status];
  return (
    <Badge tone={v.tone} glyph={v.glyph}>
      {TASK_STATUS_LABEL_RU[status]}
    </Badge>
  );
}

/** MODEL-04: вердикт по деньгам словами, с явной причиной неопределённости. */
export function BudgetBadge({ verdict }: { verdict: BudgetVerdict }) {
  switch (verdict.kind) {
    case 'compatible_in_known_range':
      return (
        <Badge tone="ok" glyph="₸">
          Укладывается в указанный бюджет
        </Badge>
      );
    case 'known_gap':
      return (
        <Badge tone="risk" glyph="₸">
          Не хватает {formatMoneyRu(verdict.shortfall)}
        </Badge>
      );
    case 'needs_clarification':
      return (
        <Badge tone="unknown" glyph="₸">
          {BUDGET_REASON_RU[verdict.reason]}
        </Badge>
      );
  }
}

const BUDGET_REASON_RU: Record<
  Extract<BudgetVerdict, { kind: 'needs_clarification' }>['reason'],
  string
> = {
  range_crosses_budget: 'Диапазон стоимости пересекает границу бюджета',
  unknown_mandatory_category: 'Не вся обязательная стоимость известна',
  no_fx_rate: 'Нет пригодного курса для сравнения валют',
  scope_mismatch: 'Бюджет задан только на обучение, а расходы шире',
  period_mismatch: 'Периоды бюджета и стоимости не сопоставимы',
};

/**
 * UX-05 / BR-07: у отсечки видны вид, дата и характер определённости.
 * Неполная дата не превращается в «23:59» — так и сказано.
 */
export function DeadlineLine({ deadline }: { deadline: Deadline }) {
  const resolved = resolveDeadline(deadline);
  const uncertain = resolved.kind !== 'certain';

  return (
    <p className="task__meta">
      <span>
        <strong>{DEADLINE_KIND_LABEL_RU[deadline.kind]}</strong>
        {deadline.hard ? ' · внешняя отсечка' : ' · личная дата'}
      </span>
      <span>{describeDeadlineRu(deadline)}</span>
      {uncertain ? (
        <Badge tone="warn" glyph="!">
          Обратный отсчёт не показываем: момент не определён источником
        </Badge>
      ) : null}
    </p>
  );
}

/** TASK-05: числа раздельно и без общего процента готовности. */
export function Counters({ counters }: { counters: ProgressCounters }) {
  const a = counters.actions;
  const c = counters.conditions;

  return (
    <div className="stack-tight">
      <ul className="counters">
        <Counter num={a.done} label="действий выполнено" />
        <Counter num={a.remaining} label="осталось" />
        <Counter num={c.met} label="условий подтверждено" />
        <Counter num={c.unknown + c.conflict} label="условий неизвестно" />
      </ul>
      <p className="small muted">
        {counters.actionsRatio.kind === 'undefined'
          ? counters.actionsRatio.message
          : `Действия: ${counters.actionsRatio.done} из ${counters.actionsRatio.total}.`}{' '}
        {counters.conditionsRatio.kind === 'undefined'
          ? counters.conditionsRatio.message
          : `Условия: ${counters.conditionsRatio.done} из ${counters.conditionsRatio.total}.`}{' '}
        {counters.disclaimer}
      </p>
    </div>
  );
}

function Counter({ num, label }: { num: number; label: string }) {
  return (
    <li className="counters__item">
      <span className="counters__num">{num}</span>
      <span className="counters__label">{label}</span>
    </li>
  );
}

export function Notice({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'warn' | 'risk';
  title: string;
  children: ReactNode;
}) {
  return (
    <section className={`notice notice--${tone}`} aria-label={title}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}

/**
 * ENG-05 / ST-10 — «чем воспроизводится этот расчёт и до какого момента он годен».
 *
 * Показывается не для красоты: по этим полям расчёт повторяется на тех же
 * данных, а по сроку годности видно, что вывод нельзя применять вечно —
 * даже когда ревизии не менялись, время идёт (AC-22).
 */
export function CalculationStamp({ keyInfo }: { keyInfo: CalculationKey }) {
  return (
    <details className="stamp">
      <summary><Icon name="chevron" size={13} /> Детали расчёта и актуальность данных</summary>
      <div className="stamp__details">
      <span>
        Расчёт: <code>{keyInfo.inputHash}</code>
      </span>
      <span>
        Ядро {keyInfo.engineVersion}, политики {keyInfo.policyVersion}
      </span>
      <span>Ревизия профиля: {keyInfo.profileRevision}</span>
      <span>Посчитан: {keyInfo.calculatedAt.replace('T', ' ').slice(0, 16)} UTC</span>
      <span>
        Годен до {keyInfo.validUntil.replace('T', ' ').slice(0, 16)} UTC —{' '}
        {VALIDITY_REASON_RU(keyInfo.validityReason)}
      </span>
      {keyInfo.unknownBoundaries.map((w) => (
        <span key={w}>⚠ {w}</span>
      ))}
      </div>
    </details>
  );
}
