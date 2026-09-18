/**
 * Выдача анонимного идентификатора посетителя.
 *
 * Серверный компонент умеет cookie читать, но не записывать, поэтому первый
 * заход обслуживает middleware. Идентификатор ставится и в запрос (чтобы эта
 * же страница уже видела свою сессию), и в ответ браузеру.
 *
 * Это не учётная запись: ни имени, ни почты, ни пароля. Только случайная
 * строка, разделяющая данные двух посетителей.
 */

import { NextResponse, type NextRequest } from 'next/server';

const SESSION_COOKIE = 'trk_sid';
const YEAR_SECONDS = 60 * 60 * 24 * 365;

export function middleware(request: NextRequest) {
  const existing = request.cookies.get(SESSION_COOKIE)?.value;
  if (existing && existing.length >= 8) return NextResponse.next();

  const sessionId = crypto.randomUUID().replace(/-/g, '');
  // Запрос правим до создания ответа: страница этого же перехода уже увидит
  // свою сессию и не создаст второй пустой профиль.
  request.cookies.set(SESSION_COOKIE, sessionId);

  const response = NextResponse.next({ request });
  response.cookies.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: YEAR_SECONDS,
    secure: process.env.NODE_ENV === 'production',
  });
  return response;
}

export const config = {
  // Статика и картинки сессии не требуют.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
