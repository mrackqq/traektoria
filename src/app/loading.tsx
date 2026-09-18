/**
 * UX-08 — состояние загрузки.
 *
 * Пустой экран во время расчёта недопустим: пользователь должен понимать,
 * что происходит и что делать. Сообщение объявляется как live-region, чтобы
 * экранный диктор его прочитал (UX-09).
 */

export default function Loading() {
  return (
    <div className="stack" role="status" aria-live="polite">
      <p className="card__eyebrow">Собираем всё вместе</p>
      <h1>Готовим ваш маршрут</h1>
      <p className="lede">
        Проверяем программы, условия и сроки по вашим данным. Это может занять немного времени.
      </p>
      <div className="loading-grid" aria-hidden="true"><div className="skeleton skeleton--wide" /><div className="skeleton" /><div className="skeleton" /></div>
    </div>
  );
}
