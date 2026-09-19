/**
 * Кто сейчас на сайте.
 *
 * Раньше все посетители работали под одним `demo-user`: чужая анкета и чужой
 * прогресс были общими, и два человека в одном демо мешали друг другу.
 * Теперь у каждого браузера свой анонимный идентификатор в cookie, и он
 * разделяет два РАЗНЫХ пространства:
 *
 *  • собственный профиль посетителя — пустой до заполнения анкеты;
 *  • демонстрационный профиль — копия синтетического примера, своя у каждого,
 *    так что «посмотреть демо» никому ничего не ломает.
 *
 * Полноценные аккаунты для этого не нужны: cookie достаточно, чтобы данные
 * не смешивались и переживали обновление страницы.
 */

import { cache } from 'react';

import { cookies } from 'next/headers';

import { demoOwnerId, visitorOwnerId } from '@core/demo/profile';

import { newSessionId, sanitizeSessionId } from './session-id';

export { newSessionId, sanitizeSessionId };

export const SESSION_COOKIE = 'trk_sid';
export const MODE_COOKIE = 'trk_mode';

export type SessionMode = 'own' | 'demo';

export interface VisitorContext {
  readonly sessionId: string;
  readonly mode: SessionMode;
  /** Владелец данных: под ним читается и пишется состояние. */
  readonly ownerId: string;
}

/**
 * Кто сейчас на сайте — один ответ на весь запрос.
 *
 * `cache` нужен именно из-за запасной ветки: когда cookie нет, мы выдаём
 * одноразовый идентификатор, и без памяти на запрос макет и страница
 * оказались бы разными владельцами внутри одного рендера.
 *
 * Такой посетитель изолирован и ничего ни у кого не видит, но и его
 * собственные данные не переживут запрос: вернуться к ним не по чему —
 * cookie, которая связывала бы его с состоянием, до сервера не дошла.
 * В штатной работе сюда не попадают: cookie выдаёт middleware на первом
 * же запросе и подставляет её в тот же рендер.
 */
export const visitorContext = cache(async (): Promise<VisitorContext> => {
  const jar = await cookies();
  const sessionId = sanitizeSessionId(jar.get(SESSION_COOKIE)?.value) ?? newSessionId();
  const mode: SessionMode = jar.get(MODE_COOKIE)?.value === 'demo' ? 'demo' : 'own';

  return {
    sessionId,
    mode,
    ownerId: mode === 'demo' ? demoOwnerId(sessionId) : visitorOwnerId(sessionId),
  };
});

