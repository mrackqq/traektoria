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

import { newSessionId, sanitizeSessionId } from '@/server/session-id';

const SESSION_COOKIE = 'trk_sid';
const YEAR_SECONDS = 60 * 60 * 24 * 365;

export function middleware(request: NextRequest) {
  // Годность проверяется тем же правилом, по которому идентификатор потом
  // читается. Раньше здесь стояла только проверка длины: значение вроде
  // «!!!!!!!!!» её проходило, новая cookie не выдавалась, а на чтении
  // очищалось до пустой строки — и посетитель оставался без сессии.
  if (sanitizeSessionId(request.cookies.get(SESSION_COOKIE)?.value)) {
    return NextResponse.next();
  }

  const sessionId = newSessionId();
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
