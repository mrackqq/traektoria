/**
 * Настройки AI-слоя.
 *
 * Ключ читается ТОЛЬКО из серверного окружения. Префикса `NEXT_PUBLIC_` здесь
 * нет и быть не может: всё, что помечено им, попадает в браузерный бандл.
 *
 * Сам ключ никогда не возвращается наружу и не печатается: функции этого
 * модуля отдают только признак «настроен / не настроен» и длину, по которой
 * видно, что переменная не пустая.
 */

export const PROMPT_VERSION = 'v4';

/**
 * Версия политики проверки достоверности.
 *
 * Входит в ключ кеша: изменение правил проверки обязано обесценить прежние
 * ответы, иначе на экране останется текст, прошедший старую политику.
 */
export const GUARDRAILS_VERSION = 'g3';

export const DEFAULT_MODEL = 'google/gemini-2.5-flash';

export interface AiConfig {
  readonly configured: boolean;
  readonly model: string;
  readonly timeoutMs: number;
  readonly baseUrl: string;
  readonly maxTokens: number;
}

export function readAiConfig(): AiConfig {
  const key = (process.env.OPENROUTER_API_KEY ?? '').trim();
  const model = (process.env.OPENROUTER_MODEL ?? '').trim() || DEFAULT_MODEL;
  const timeout = Number(process.env.OPENROUTER_TIMEOUT_MS ?? '');

  return {
    configured: key.length > 0,
    model,
    // Структурированный ответ на полном контексте занимает около 12 секунд,
    // поэтому запас нужен. Страницу это не задерживает: блок с пояснением
    // грузится отдельно, расчёт по правилам виден сразу.
    timeoutMs: Number.isFinite(timeout) && timeout >= 1000 ? timeout : 25_000,
    baseUrl: (process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1').replace(/\/$/, ''),
    maxTokens: 2400,
  };
}

/**
 * Ключ для запроса. Возвращается только внутри серверного модуля и никогда
 * не попадает в результат, лог или ответ страницы.
 */
export function readApiKey(): string | null {
  const key = (process.env.OPENROUTER_API_KEY ?? '').trim();
  return key.length > 0 ? key : null;
}

/** Безопасное описание состояния настройки — его можно показывать. */
export function describeAiConfig(): { configured: boolean; model: string; timeoutMs: number } {
  const config = readAiConfig();
  return { configured: config.configured, model: config.model, timeoutMs: config.timeoutMs };
}
