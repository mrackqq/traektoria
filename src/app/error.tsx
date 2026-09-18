'use client';

/**
 * UX-08 — состояние ошибки.
 *
 * Ошибка расчёта не должна выглядеть как отказ в поступлении и не должна
 * терять контекст: показываем, что именно не удалось, и оставляем доступное
 * действие. AI-04 в тех же терминах: отказ подсистемы не превращает расчёт
 * в ошибку бизнеса.
 */

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="stack">
      <div className="notice notice--risk" role="alert">
        <h1>Не удалось показать расчёт</h1>
        <p>
          Это сбой приложения, а не вывод о ваших шансах. Данные профиля и прогресс
          не изменились — незавершённый расчёт ничего не записывает.
        </p>
        {error.digest ? (
          <p className="small">
            Код для обращения в поддержку: <code>{error.digest}</code>
          </p>
        ) : null}
      </div>

      <div className="actions">
        <button type="button" className="btn" onClick={() => reset()}>
          Повторить расчёт
        </button>
        <a className="btn btn--secondary" href="/profile">
          Открыть профиль
        </a>
      </div>
    </div>
  );
}
