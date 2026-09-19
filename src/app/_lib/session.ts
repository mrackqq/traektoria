/**
 * Доступ страниц к расчёту.
 *
 * Снимок собирается из сохранённого состояния конкретного посетителя поверх
 * синтетического каталога. Чтение ничего не записывает: состояние меняется
 * только командами из `_actions`.
 *
 * Здесь же находится точка подключения AI: объяснения запрашиваются ПОСЛЕ
 * того, как снимок посчитан, и никогда — вместо него. Если модель недоступна,
 * страница всё равно получает полный расчёт по правилам.
 */

import { cache } from 'react';

import type { SessionSnapshot } from '@core/demo/session';

import { getAdvice, type AdviceResult } from '@/server/ai/advisor';
import { loadSessionView, type SessionView } from '@/server/progress-service';
import { visitorContext, type VisitorContext } from '@/server/session-context';

export interface PageSession extends SessionView {
  readonly context: VisitorContext;
}

/**
 * Снимок расчёта — один на запрос.
 *
 * За снимком стоит вся тяжёлая работа: сборка каталога, подбор программ,
 * планирование маршрута. Без памяти на запрос каждый обратившийся
 * (страница, её метаданные, вложенный компонент) считал бы всё заново —
 * одни и те же данные, тот же результат, кратные затраты.
 */
export const getPageSession = cache(async (): Promise<PageSession> => {
  const context = await visitorContext();
  const view = await loadSessionView(context.ownerId);
  return { ...view, context };
});

/** Короткий доступ к снимку для страниц, которым не нужен остальной контекст. */
export async function getSession(): Promise<SessionSnapshot> {
  return (await getPageSession()).snapshot;
}

/**
 * Объяснения модели для уже посчитанного снимка.
 *
 * Вызывается из отдельного компонента под `Suspense`, поэтому ожидание сети
 * не задерживает основную страницу: расчёт по правилам виден сразу.
 */
export async function getAdviceFor(
  session: PageSession,
  options: { readonly focusPathIds?: readonly string[] } = {},
): Promise<AdviceResult> {
  return getAdvice(session.context.ownerId, session.snapshot, {
    ...(options.focusPathIds ? { focusPathIds: options.focusPathIds } : {}),
  });
}

export type { SessionSnapshot, AdviceResult };
