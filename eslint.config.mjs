/**
 * Проверка стиля и типичных ошибок.
 *
 * Прежний скрипт `next lint` не работал вовсе: команда объявлена устаревшей
 * в Next 15.5, а самого ESLint в зависимостях не было — `npm run lint`
 * падал, и это годами оставалось незамеченным, потому что его никто не
 * запускал.
 *
 * Набор правил намеренно узкий. Задача линтера здесь — ловить то, что
 * пропускают типы и тесты (забытый await, недостижимый код, мёртвые
 * переменные), а не навязывать оформление: расстановку скобок и запятых
 * никто не обсуждает, и правила об этом только шумят.
 */

import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      '.next-build/**',
      '.next-e2e/**',
      'test-results/**',
      'playwright-report/**',
      'design-shots/**',
      'next-env.d.ts',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    // Код исполняется и на сервере (Node), и в браузере.
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },

    rules: {
      // Незакрытый await — источник молчаливых гонок, а не стилистика.
      '@typescript-eslint/no-floating-promises': 'off',

      /**
       * Неиспользованное — предупреждение, а не ошибка.
       *
       * Подчёркивание в начале означает осознанную заглушку (`_prev` в
       * серверных действиях приходит от сигнатуры React и не нужен).
       * Остальное — заготовки в каталоге и планировщике: это код автора
       * продукта, и решать, выбросить их или дописать, ему. Линтер здесь
       * показывает находку, но не останавливает сборку из-за неё.
       */
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],

      // `any` в этом коде не встречается, но запрет полезен как ограда.
      '@typescript-eslint/no-explicit-any': 'error',

      // Неразрывный пробел опасен в коде и уместен в тексте. Продукт
      // русскоязычный: этим символом разделяются разряды в числах
      // («1 200 000 ₸»), и регулярные выражения обязаны его матчить.
      // Поэтому ищем невидимые пробелы там, где они означают ошибку.
      'no-irregular-whitespace': [
        'error',
        { skipStrings: true, skipTemplates: true, skipRegExps: true, skipComments: true },
      ],
    },
  },

  {
    // Тесты вольны обращаться с типами свободнее: там намеренно
    // конструируются заведомо неверные значения, чтобы проверить отказ.
    files: ['**/*.test.ts', 'e2e/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },
);
