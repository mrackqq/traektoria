/**
 * MODEL-01 / API-04 / REV-10 — детерминированные хэши.
 *
 * Используется в двух местах, где важна ровно повторяемость, а не стойкость:
 *  • ключ воспроизводимости расчёта (ENG-05) и скоуп каталога (REV-03);
 *  • сверка payload при повторе идемпотентной команды (API-04).
 *
 * REV-10: сравнивать нужно КАНОНИЗОВАННЫЙ payload, иначе порядок ключей
 * в JSON меняет хэш и повтор той же команды выглядит как новая.
 */

/** Небольшой стабильный хэш. Криптостойкость здесь не требуется. */
export function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * Канонизация значения: ключи объектов сортируются, порядок массивов
 * сохраняется (он значим), `undefined` в объектах опускается, bigint
 * сериализуется с суффиксом, чтобы не смешаться с number.
 */
export function canonicalJson(value: unknown): string {
  // Стек текущей ветки обхода: циклическая ссылка иначе уходит в бесконечную
  // рекурсию и роняет процесс через RangeError переполнения стека — далеко от
  // места настоящей ошибки и без единого указания, что именно зациклено.
  return canonicalize(value, new Set<object>());
}

function canonicalize(value: unknown, seen: Set<object>): string {
  if (value === null) return 'null';
  if (typeof value === 'bigint') return `${value.toString()}n`;
  if (typeof value === 'number') {
    // Хэширование должно быть тотальным: невалидное число обязано дойти
    // до валидатора команды и получить осмысленный отказ, а не уронить
    // обработчик исключением из вспомогательной функции.
    if (!Number.isFinite(value)) return `#${String(value)}`;
    return Object.is(value, -0) ? '0' : String(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return JSON.stringify(value);

  if (typeof value === 'object') {
    if (seen.has(value)) {
      throw new TypeError('canonicalJson: значение содержит циклическую ссылку');
    }
    seen.add(value);
    try {
      if (Array.isArray(value)) {
        return `[${value.map((item) => canonicalize(item, seen)).join(',')}]`;
      }
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${entries
        .map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v, seen)}`)
        .join(',')}}`;
    } finally {
      // Соседние ветки могут законно ссылаться на один и тот же объект:
      // это общая ссылка, а не цикл.
      seen.delete(value);
    }
  }

  // function / symbol / undefined на верхнем уровне — программная ошибка.
  throw new Error(`canonicalJson: неподдерживаемый тип ${typeof value}`);
}

/** Хэш канонизованного payload команды. */
export function payloadHash(value: unknown): string {
  return fnv1a(canonicalJson(value));
}
