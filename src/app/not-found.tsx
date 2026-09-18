/**
 * UX-08 — «такой страницы нет».
 *
 * Отдельный случай от ошибки: здесь ничего не сломалось, просто адрес
 * не соответствует ни одной кампании или разделу.
 */

import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="stack">
      <h1>Страница не найдена</h1>
      <p className="lede">
        Возможно, кампания приёма больше не публикуется или ссылка устарела. Это не
        значит, что путь подачи закрыт — проверьте список программ.
      </p>
      <div className="actions">
        <Link className="btn" href="/programs">
          К списку программ
        </Link>
        <Link className="btn btn--secondary" href="/">
          На обзор
        </Link>
      </div>
    </div>
  );
}
