/**
 * Транспорт до OpenRouter.
 *
 * Здесь только сеть: собрать запрос, дождаться ответа, вернуть текст или
 * типизированную ошибку. Ни знания о предметной области, ни разбора ответа
 * здесь нет — это позволяет тестировать оба слоя отдельно.
 *
 * Правила, которые здесь держатся жёстко:
 *  • ключ не попадает ни в возвращаемое значение, ни в текст ошибки, ни в лог.
 *    Логируется код статуса и короткая причина, заголовки — никогда;
 *  • у запроса есть таймаут. Без него зависший провайдер держал бы рендер
 *    страницы до таймаута платформы;
 *  • ошибка сети — нормальный исход, а не исключение: вызывающий код обязан
 *    показать правила вместо текста модели.
 */

import { readAiConfig, readApiKey } from './config';

export type AiFailureCode =
  | 'NO_API_KEY'
  | 'TIMEOUT'
  | 'HTTP_ERROR'
  | 'RATE_LIMITED'
  | 'NETWORK_ERROR'
  | 'EMPTY_RESPONSE'
  | 'BAD_JSON';

export interface AiFailure {
  readonly ok: false;
  readonly code: AiFailureCode;
  /** Короткое человеческое описание. Ключей и заголовков здесь нет. */
  readonly message: string;
}

export interface AiSuccess {
  readonly ok: true;
  readonly content: string;
  readonly model: string;
  readonly durationMs: number;
}

export type AiResult = AiSuccess | AiFailure;

export interface ChatMessage {
  readonly role: 'system' | 'user';
  readonly content: string;
}

export interface ChatRequest {
  readonly messages: readonly ChatMessage[];
  readonly jsonSchema?: unknown;
  readonly temperature?: number;
  readonly maxTokens?: number;
  /** Переопределение таймаута для тестов. */
  readonly timeoutMs?: number;
}

const FAILURE_TEXT: Record<AiFailureCode, string> = {
  NO_API_KEY: 'Ключ OpenRouter не настроен в окружении',
  TIMEOUT: 'Модель не ответила за отведённое время',
  HTTP_ERROR: 'OpenRouter вернул ошибку',
  RATE_LIMITED: 'Превышен лимит запросов к модели',
  NETWORK_ERROR: 'Не удалось связаться с OpenRouter',
  EMPTY_RESPONSE: 'Модель вернула пустой ответ',
  BAD_JSON: 'Модель вернула не тот формат, который запрошен',
};

function fail(code: AiFailureCode, detail?: string): AiFailure {
  return { ok: false, code, message: detail ? `${FAILURE_TEXT[code]}: ${detail}` : FAILURE_TEXT[code] };
}

/**
 * Поддерживает ли модель структурированный вывод.
 *
 * Проверяется у самого OpenRouter, а не предполагается: список параметров
 * модели меняется, и запрос со `strict` схемой к модели без поддержки
 * возвращает ошибку вместо ответа. Результат кешируется на процесс —
 * это бесплатный справочный вызов, но делать его на каждый рендер незачем.
 */
const capabilityCache = new Map<string, { supports: boolean; at: number }>();
const CAPABILITY_TTL_MS = 60 * 60 * 1000;

export async function supportsStructuredOutput(model: string): Promise<boolean> {
  const cached = capabilityCache.get(model);
  if (cached && Date.now() - cached.at < CAPABILITY_TTL_MS) return cached.supports;

  const config = readAiConfig();
  const key = readApiKey();
  if (!key) return false;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(config.timeoutMs, 8000));
    const response = await fetch(`${config.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timer);
    if (!response.ok) return false;

    const body = (await response.json()) as {
      data?: { id?: string; supported_parameters?: string[] }[];
    };
    const entry = body.data?.find((m) => m.id === model);
    const params = entry?.supported_parameters ?? [];
    const supports = params.includes('structured_outputs') || params.includes('response_format');

    capabilityCache.set(model, { supports, at: Date.now() });
    return supports;
  } catch {
    // Справочный вызов не обязан удаваться: без него просто используем
    // менее строгий режим, а не отказываемся от AI целиком.
    return false;
  }
}

export async function chatJson(request: ChatRequest): Promise<AiResult> {
  const config = readAiConfig();
  const key = readApiKey();
  if (!key) return fail('NO_API_KEY');

  const strict = request.jsonSchema ? await supportsStructuredOutput(config.model) : false;

  const body: Record<string, unknown> = {
    model: config.model,
    messages: request.messages,
    temperature: request.temperature ?? 0.2,
    max_tokens: request.maxTokens ?? config.maxTokens,
    response_format: request.jsonSchema
      ? strict
        ? { type: 'json_schema', json_schema: request.jsonSchema }
        : { type: 'json_object' }
      : undefined,
    // Провайдер обязан поддерживать запрошенные параметры, иначе запрос
    // уйдёт туда, где `response_format` молча игнорируется.
    ...(strict ? { provider: { require_parameters: true } } : {}),
  };

  const controller = new AbortController();
  const timeoutMs = request.timeoutMs ?? config.timeoutMs;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        // Атрибуция OpenRouter. Секретов здесь нет.
        'X-Title': 'Traektoria Admission Journey',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: 'no-store',
    });

    if (response.status === 429) return fail('RATE_LIMITED');
    if (!response.ok) {
      // В текст ошибки попадает только статус: тело ответа может содержать
      // эхо запроса, а туда лучше не заглядывать без нужды.
      return fail('HTTP_ERROR', `статус ${response.status}`);
    }

    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
      error?: { message?: string };
    };

    if (payload.error) return fail('HTTP_ERROR', 'провайдер сообщил об ошибке');

    const content = payload.choices?.[0]?.message?.content ?? '';
    if (content.trim().length === 0) return fail('EMPTY_RESPONSE');

    return { ok: true, content, model: config.model, durationMs: Date.now() - startedAt };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return fail('TIMEOUT', `${timeoutMs} мс`);
    }
    return fail('NETWORK_ERROR');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Разбор JSON из ответа модели.
 *
 * Даже со схемой ответ иногда приходит обёрнутым в ```json — это дешевле
 * простить, чем терять корректный по сути результат.
 */
export function parseJsonContent(content: string): { ok: true; value: unknown } | AiFailure {
  const trimmed = content.trim();
  const unfenced = trimmed.startsWith('```')
    ? trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim()
    : trimmed;

  try {
    return { ok: true, value: JSON.parse(unfenced) };
  } catch {
    return fail('BAD_JSON');
  }
}
