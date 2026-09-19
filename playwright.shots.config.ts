/**
 * Съёмка экранов для дизайн-разбора.
 *
 * Отдельный конфиг, потому что это инструмент, а не проверка: спеки
 * ничего не утверждают, только сохраняют картинки в `design-shots/`.
 * В общем прогоне и в CI они лишь тратили бы время.
 *
 * Запуск: npm run shots
 */

import base from './playwright.config';

export default { ...base, testDir: './e2e-shots', testIgnore: [], retries: 0 };
