/**
 * UX-04 — карта зависимостей.
 *
 * Карта служит ОБЪЯСНЕНИЮ связей: ни одно действие не требует её использования,
 * те же данные полностью доступны в текстовом списке рядом. Поэтому SVG
 * помечен как изображение с текстовым описанием, а не как интерактивный виджет.
 *
 * Раскладка детерминированная: слой — длина цепочки зависимостей, порядок
 * внутри слоя — порядок задач в маршруте. Одинаковый вход даёт одинаковую
 * картинку (ENG-05 распространяется и на показ).
 */

import type { TaskView } from '@core/progress/next-action';

const NODE_W = 150;
const NODE_H = 54;
const GAP_X = 44;
const GAP_Y = 18;
const PAD = 12;

interface Placed {
  readonly view: TaskView;
  readonly layer: number;
  readonly row: number;
}

function layerOf(id: string, byId: Map<string, TaskView>, memo: Map<string, number>): number {
  const cached = memo.get(id);
  if (cached !== undefined) return cached;
  const view = byId.get(id);
  if (!view) return 0;
  memo.set(id, 0); // защита от цикла: цикл ловится в ядре (detectCycle), здесь не зависаем
  const deps = view.task.dependsOn.filter((d) => byId.has(d));
  const value = deps.length === 0 ? 0 : 1 + Math.max(...deps.map((d) => layerOf(d, byId, memo)));
  memo.set(id, value);
  return value;
}

export function RouteMap({ views, nextTaskId }: { views: readonly TaskView[]; nextTaskId?: string }) {
  if (views.length === 0) return null;

  const byId = new Map(views.map((v) => [v.task.id, v]));
  const memo = new Map<string, number>();
  const rows = new Map<number, number>();

  const placed: Placed[] = views.map((view) => {
    const layer = layerOf(view.task.id, byId, memo);
    const row = rows.get(layer) ?? 0;
    rows.set(layer, row + 1);
    return { view, layer, row };
  });

  const layers = Math.max(...placed.map((p) => p.layer)) + 1;
  const maxRows = Math.max(...[...rows.values()]);
  const width = PAD * 2 + layers * NODE_W + (layers - 1) * GAP_X;
  const height = PAD * 2 + maxRows * NODE_H + (maxRows - 1) * GAP_Y;

  const pos = (p: Placed) => ({
    x: PAD + p.layer * (NODE_W + GAP_X),
    y: PAD + p.row * (NODE_H + GAP_Y),
  });
  const posById = new Map(placed.map((p) => [p.view.task.id, pos(p)]));

  return (
    <figure className="route-map" style={{ margin: 0 }}>
      <div className="route-map__canvas">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        role="img"
        aria-label={`Карта зависимостей маршрута: ${views.length} действий, ${layers} этапов. Те же сведения перечислены в списке действий ниже.`}
        style={{ maxWidth: '100%', height: 'auto' }}
      >
        <defs>
          <marker
            id="arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--c-border-strong)" />
          </marker>
        </defs>

        {placed.flatMap((p) =>
          p.view.task.dependsOn
            .filter((d) => posById.has(d))
            .map((d) => {
              const from = posById.get(d)!;
              const to = posById.get(p.view.task.id)!;
              const x1 = from.x + NODE_W;
              const y1 = from.y + NODE_H / 2;
              const x2 = to.x;
              const y2 = to.y + NODE_H / 2;
              const mid = (x1 + x2) / 2;
              return (
                <path
                  key={`${d}->${p.view.task.id}`}
                  d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`}
                  fill="none"
                  stroke="var(--c-border-strong)"
                  strokeWidth="1.5"
                  markerEnd="url(#arrow)"
                />
              );
            }),
        )}

        {placed.map((p) => {
          const { x, y } = pos(p);
          const isNext = p.view.task.id === nextTaskId;
          const done = p.view.state.status === 'done';
          return (
            <g key={p.view.task.id}>
              <rect
                x={x}
                y={y}
                width={NODE_W}
                height={NODE_H}
                rx="8"
                fill="var(--c-surface)"
                stroke={isNext ? 'var(--c-accent)' : 'var(--c-border)'}
                strokeWidth={isNext ? 2.5 : 1}
                strokeDasharray={p.view.flags.blocked ? '5 4' : undefined}
              />
              {/* Статус дублируется формой и подписью, не только цветом (UX-09). */}
              <text x={x + 10} y={y + 20} fontSize="11" fill="var(--c-text-muted)">
                {done ? '✓ выполнено' : p.view.flags.blocked ? '⋯ ждёт' : isNext ? '▸ следующий' : '○ к выполнению'}
              </text>
              <text x={x + 10} y={y + 38} fontSize="12.5" fill="var(--c-text)" fontWeight="600">
                {truncate(p.view.task.template.title, 21)}
              </text>
            </g>
          );
        })}
      </svg>
      </div>
      <figcaption className="small muted" style={{ marginTop: 'var(--s-2)' }}>
        Стрелка ведёт от действия к тому, что от него зависит. Пунктирная рамка — действие
        ждёт завершения другого. Карта только объясняет связи; всё то же есть в списке.
      </figcaption>
    </figure>
  );
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
