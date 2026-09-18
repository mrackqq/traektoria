/**
 * Показ объяснений модели.
 *
 * Блоки собраны из уже существующих классов дизайн-системы (`card`, `notice`,
 * `badge`, `task`), поэтому AI не выглядит приклеенным сбоку и не требует
 * собственной вёрстки.
 *
 * Правило показа одно: текст модели — это ОБЪЯСНЕНИЕ, а не источник фактов.
 * Рядом с ним всегда видно, чем он получен, и что решения принимают правила
 * сервиса. Когда модель недоступна, на том же месте остаются объяснения по
 * правилам, а режим прямо назван.
 */

import type { AdviceResult } from '@/server/ai/advisor';
import { hasContent } from '@/server/ai/advisor';

import { Badge } from './ui';

/** Пометка режима: без неё пользователь не отличит текст модели от правил. */
export function AiModeBadge({ advice }: { advice: AdviceResult }) {
  if (advice.mode === 'rules') {
    return (
      <Badge tone="neutral" glyph="§">
        Объяснения по правилам сервиса
      </Badge>
    );
  }
  return (
    <Badge tone="demo" glyph="AI">
      Пояснение модели{advice.cached ? ', из кеша' : ''}
    </Badge>
  );
}

function Fallback({ advice }: { advice: AdviceResult }) {
  if (advice.mode !== 'rules' || !advice.fallbackReason) return null;
  return (
    <p className="small muted">
      {advice.fallbackReason} Расчёт, сроки и вердикты от этого не меняются — они считаются
      правилами и показаны выше.
    </p>
  );
}

function Warnings({ advice }: { advice: AdviceResult }) {
  if (advice.warnings.length === 0) return null;
  return (
    <ul className="small stack-tight">
      {advice.warnings.map((w, i) => (
        <li key={i} className="muted">
          {w}
        </li>
      ))}
    </ul>
  );
}

/** Общая обёртка: заголовок, режим, дисклеймер. */
function AiCard({
  title,
  advice,
  children,
}: {
  title: string;
  advice: AdviceResult;
  children: React.ReactNode;
}) {
  return (
    <section className="card stack-tight" aria-labelledby={`ai-${slug(title)}`}>
      <p className="card__eyebrow">Пояснение</p>
      <h2 id={`ai-${slug(title)}`}>{title}</h2>
      <ul className="badge-row">
        <li>
          <AiModeBadge advice={advice} />
        </li>
      </ul>
      {children}
      <Warnings advice={advice} />
      <Fallback advice={advice} />
    </section>
  );
}

/**
 * Факты из расчёта под текстом модели.
 *
 * Значения подставляет сервер по типизированной ссылке: числовые условия,
 * сроки и стоимость не приходят свободным текстом.
 */
function FactList({ advice, refs }: { advice: AdviceResult; refs: readonly string[] }) {
  const items = refs
    .map((id) => advice.factValues[id])
    .filter((f): f is { label: string; value: string } => !!f);
  if (items.length === 0) return null;

  return (
    <p className="task__meta">
      {items.map((f) => (
        <span key={f.label + f.value}>
          {f.label}: <strong>{f.value}</strong>
        </span>
      ))}
    </p>
  );
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-zа-я0-9]+/gi, '-').slice(0, 40);
}

/* ------------------------------------------------------------------ */
/* Диагностика профиля                                                 */
/* ------------------------------------------------------------------ */

/**
 * Дополнение к диагностике, а не её замена.
 *
 * Обязательная сводка считается правилами и живёт в `DiagnosisBlock`. Здесь —
 * только связное объяснение от модели. Когда модели нет, компонент не
 * исчезает молча: режим и причина остаются на экране, чтобы отсутствие текста
 * было объяснено, а не выглядело сбоем.
 */
export function AiProfileSummary({ advice }: { advice: AdviceResult }) {
  const a = advice.advice;
  const s = a?.profileSummary;
  const empty = !a || !hasContent(a) || (!s?.headline && !s?.focus && (s?.strengths.length ?? 0) === 0);

  if (empty) {
    return (
      <section className="card stack-tight" aria-labelledby="ai-fallback">
        <p className="card__eyebrow">Пояснение</p>
        <h2 id="ai-fallback">Связного объяснения сейчас нет</h2>
        <ul className="badge-row">
          <li>
            <AiModeBadge advice={advice} />
          </li>
        </ul>
        <p className="small muted">
          {advice.fallbackReason ??
            'Модель не вернула пригодного текста. Диагностика выше посчитана правилами ' +
              'и от этого не меняется.'}
        </p>
        <Warnings advice={advice} />
      </section>
    );
  }

  return (
    <AiCard title="Как это читается" advice={advice}>
      {s!.headline ? <p className="lede">{s!.headline}</p> : null}

      {s!.strengths.length > 0 ? (
        <div className="stack-tight">
          <h3>Сильные стороны</h3>
          <ul className="stack-tight small">
            {s!.strengths.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {s!.limits.length > 0 ? (
        <div className="stack-tight">
          <h3>Ограничения</h3>
          <ul className="stack-tight small">
            {s!.limits.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {s!.focus ? (
        <p className="task__outcome">
          <strong>На чём сосредоточиться:</strong> {s!.focus}
        </p>
      ) : null}
    </AiCard>
  );
}

/* ------------------------------------------------------------------ */
/* Почему подходит — по программам                                     */
/* ------------------------------------------------------------------ */

export function AiProgramNotes({
  advice,
  titles,
}: {
  advice: AdviceResult;
  /** Подписи программ по идентификатору пути подачи. */
  titles: ReadonlyMap<string, string>;
}) {
  const items = advice.advice?.programExplanations ?? [];
  if (items.length === 0) return null;

  return (
    <AiCard title="Почему эти варианты подходят вам" advice={advice}>
      <ul className="tasks">
        {items.map((item) => (
          <li key={item.pathId} className="task">
            <h3 className="task__title">{titles.get(item.pathId) ?? item.pathId}</h3>
            <p className="task__outcome">{item.why}</p>
            <p className="small muted">
              <strong>Чем придётся заплатить:</strong> {item.tradeoff}
            </p>
            <FactList advice={advice} refs={item.factRefs} />
          </li>
        ))}
      </ul>
      <p className="small muted">
        Значения фактов подставлены из расчёта. Текст объяснения проверен на ссылки
        на эти факты и на запрещённые обещания — но его смысловую верность сервис
        не гарантирует: решения принимают правила, а не модель.
      </p>
    </AiCard>
  );
}

/** Объяснение для одной программы — для страницы конкретного пути подачи. */
export function AiSingleProgramNote({
  advice,
  pathId,
}: {
  advice: AdviceResult;
  pathId: string;
}) {
  const item = advice.advice?.programExplanations.find((x) => x.pathId === pathId);
  if (!item) return null;

  return (
    <AiCard title="Что это значит для вас" advice={advice}>
      <p className="task__outcome">{item.why}</p>
      <p className="small muted">
        <strong>Чем придётся заплатить:</strong> {item.tradeoff}
      </p>
      <FactList advice={advice} refs={item.factRefs} />
    </AiCard>
  );
}

/* ------------------------------------------------------------------ */
/* Компромиссы при сравнении                                           */
/* ------------------------------------------------------------------ */

export function AiComparison({ advice }: { advice: AdviceResult }) {
  const c = advice.advice?.comparison;
  if (!c || (!c.summary && c.tradeoffs.length === 0)) return null;

  return (
    <AiCard title="Компромиссы между вариантами" advice={advice}>
      {c.summary ? <p>{c.summary}</p> : null}
      {c.tradeoffs.length > 0 ? (
        <ul className="stack-tight small">
          {c.tradeoffs.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      ) : null}
      <p className="small muted">
        Выбор остаётся за вами: сервис не ранжирует вузы и не предсказывает поступление.
        Текст проверен на ссылки на факты расчёта, но смысловую верность сервис
        не гарантирует.
      </p>
    </AiCard>
  );
}

/* ------------------------------------------------------------------ */
/* Ближайшее действие                                                  */
/* ------------------------------------------------------------------ */

export function AiNextAction({ advice }: { advice: AdviceResult }) {
  const n = advice.advice?.nextAction;
  if (!n || !n.what) return null;

  return (
    <AiCard title="Разбор ближайшего шага" advice={advice}>
      <p className="task__outcome">
        <strong>Что сделать:</strong> {n.what}
      </p>
      <p>{n.why}</p>
      <p className="small">
        <strong>С чего начать сегодня:</strong> {n.firstStep}
      </p>
      <FactList advice={advice} refs={n.factRefs} />
    </AiCard>
  );
}

/* ------------------------------------------------------------------ */
/* Подсказки к задачам маршрута                                        */
/* ------------------------------------------------------------------ */

export function AiTaskGuidance({
  advice,
  titles,
}: {
  advice: AdviceResult;
  titles: ReadonlyMap<string, string>;
}) {
  const items = advice.advice?.taskGuidance ?? [];
  if (items.length === 0) return null;

  return (
    <AiCard title="Как выполнить действия маршрута" advice={advice}>
      <ul className="tasks">
        {items.map((item) => (
          <li key={item.taskId} className="task">
            <h3 className="task__title">{titles.get(item.taskId) ?? item.taskId}</h3>
            <p className="task__outcome">{item.howTo}</p>
            <p className="small muted">
              <strong>На что обратить внимание:</strong> {item.watchOut}
            </p>
            <FactList advice={advice} refs={item.factRefs} />
          </li>
        ))}
      </ul>
      <p className="small muted">
        Сроки, зависимости и критерий готовности у каждого действия — из расчёта выше;
        подсказка их не меняет. Текст проверен на ссылки на факты расчёта и на
        запрещённые обещания, но смысловую верность сервис не гарантирует.
      </p>
    </AiCard>
  );
}

/* ------------------------------------------------------------------ */
/* Состояние ожидания                                                  */
/* ------------------------------------------------------------------ */

/** Заглушка на время запроса: страница уже отрисована и полностью рабочая. */
export function AiPending({ title = 'Готовим пояснение' }: { title?: string }) {
  return (
    <section className="card stack-tight" aria-live="polite" aria-busy="true">
      <p className="card__eyebrow">Пояснение</p>
      <h2>{title}</h2>
      <p className="small muted">
        Расчёт, сроки и вердикты уже показаны выше — они считаются правилами и не ждут
        модель. Пояснение появится здесь, когда будет готово.
      </p>
    </section>
  );
}
