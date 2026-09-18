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

import { cookies } from 'next/headers';

import { demoOwnerId, visitorOwnerId } from '@core/demo/profile';

export const SESSION_COOKIE = 'trk_sid';
export const MODE_COOKIE = 'trk_mode';

export type SessionMode = 'own' | 'demo';

export interface VisitorContext {
  readonly sessionId: string;
  readonly mode: SessionMode;
  /** Владелец данных: под ним читается и пишется состояние. */
  readonly ownerId: string;
}

/** Идентификатор из cookie не попадает никуда как есть. */
export function sanitizeSessionId(raw: string | undefined): string {
  const cleaned = (raw ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  return cleaned.length >= 8 ? cleaned : 'guest';
}

export async function visitorContext(): Promise<VisitorContext> {
  const jar = await cookies();
  const sessionId = sanitizeSessionId(jar.get(SESSION_COOKIE)?.value);
  const mode: SessionMode = jar.get(MODE_COOKIE)?.value === 'demo' ? 'demo' : 'own';

  return {
    sessionId,
    mode,
    ownerId: mode === 'demo' ? demoOwnerId(sessionId) : visitorOwnerId(sessionId),
  };
}

/** Новый идентификатор посетителя. Используется middleware при первом заходе. */
export function newSessionId(): string {
  return globalThis.crypto.randomUUID().replace(/-/g, '');
}
