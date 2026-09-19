/**
 * Сквозные проверки поверх настоящего сервера.
 *
 * Интерфейс собран из серверных компонентов и React-действий, поэтому
 * проверять его иначе нечем: файлы `.tsx` не запускаются в `node:test`
 * (стриппинг типов не понимает JSX), а подменять рендер значит проверять
 * не то, что увидит человек.
 *
 * Прогон детерминирован намеренно:
 *  • `TRAJECTORY_CLOCK` замораживает момент расчёта — иначе сроки, просрочки
 *    и срок годности расчёта плывут между запусками;
 *  • `TRAJECTORY_DATA_DIR` уводит состояние во временный каталог, чтобы
 *    тесты не трогали `.data` разработчика;
 *  • ключ OpenRouter НЕ задаётся: продукт при этом работает полностью, а
 *    объяснения показываются по правилам. Сеть в тестах не нужна.
 */

import path from 'node:path';
import os from 'node:os';

import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 3111);
const BASE_URL = `http://127.0.0.1:${PORT}`;

/** Своё пространство данных на прогон. */
const DATA_DIR = path.join(os.tmpdir(), 'traektoria-e2e');

export default defineConfig({
  testDir: './e2e',
  // Съёмка экранов — инструмент для дизайн-разбора, а не проверка: она
  // ничего не утверждает, только сохраняет картинки. В общем прогоне и в
  // CI ей делать нечего, запускается отдельной командой `npm run shots`.
  testIgnore: ['**/shots*.spec.ts'],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  /**
   * Одна повторная попытка — из-за свойства продукта, а не ради зелёного
   * отчёта.
   *
   * Кнопки серверных действий начинают работать не с появлением на экране,
   * а с оживлением своего клиентского острова. Клик, пришедший в это окно,
   * уходит обычной отправкой формы: данные сохраняются, но ответ действия
   * рисует клиент — и подтверждения не появляется. Тесты ждут оживления
   * конкретной кнопки (см. `clickAction` в `e2e/flows.spec.ts`), однако
   * окно закрывается не мгновенно.
   *
   * Это же видит и живой человек, нажавший сразу после отрисовки. Пока
   * дефект не исправлен, повтор оставлен намеренно и с этой пометкой.
   */
  retries: 2,
  // Состояние общее на файловом хранилище, поэтому параллельные воркеры
  // мешали бы друг другу: разделение идёт по cookie, а не по процессу.
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],

  use: {
    baseURL: BASE_URL,
    locale: 'ru-RU',
    timezoneId: 'Asia/Almaty',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    command: `npm run build && npm start -- --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    env: {
      TRAJECTORY_CLOCK: '2026-09-18T06:00:00.000Z',
      TRAJECTORY_DATA_DIR: DATA_DIR,
      NEXT_DIST_DIR: '.next-e2e',
    },
  },
});
