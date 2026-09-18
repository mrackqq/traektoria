/**
 * Объяснения от модели поверх выводов ядра.
 *
 * Роль AI здесь строго вспомогательная: он ОБЪЯСНЯЕТ то, что уже посчитано
 * правилами, и не принимает решений. Подбор, планировщик и вердикты остаются
 * детерминированными — модель не может ни добавить программу, ни закрыть
 * условие, ни изменить срок.
 *
 * Поэтому ответ модели проходит три фильтра подряд:
 *  1. схема — структура и длины;
 *  2. идентификаторы — программа и задача должны существовать в этом расчёте;
 *  3. честность — обещания поступления, проценты шансов и гарантии вырезаются.
 *
 * Если AI недоступен, отвечает медленно или отвечает не тем, интерфейс
 * показывает объяснения по правилам с честной пометкой режима.
 */

import type { SessionSnapshot } from '@core/demo/session';
import { fnv1a } from '@core/kernel/hash';

import { GUARDRAILS_VERSION, PROMPT_VERSION, readAiConfig } from './config';
import { buildAdviceContext } from './context';
import { chatJson, parseJsonContent, type AiFailureCode } from './openrouter';
import { findForbiddenClaim, describeProblems, type HonestyProblem } from './grounding';
import { checkScoped, describeScopedProblem, type CatalogFact, type FactSubject } from './facts';
import { ADVICE_JSON_SCHEMA, adviceSchema, type Advice } from './schema';

export type AdviceMode = 'ai' | 'rules';

export interface AdviceResult {
  readonly mode: AdviceMode;
  readonly advice: Advice | null;
  /** Почему показываются правила, а не текст модели. */
  readonly fallbackReason: string | null;
  readonly fallbackCode: AiFailureCode | 'DISABLED' | 'INVALID_SHAPE' | null;
  readonly model: string | null;
  readonly generatedAt: string | null;
  readonly cached: boolean;
  /** Что было вырезано из ответа. Показывается как есть — это часть честности. */
  readonly warnings: readonly string[];
  /**
   * Значения фактов по идентификаторам ссылок.
   *
   * Их подставляет сервер из расчёта: числовые условия, сроки и стоимость
   * не должны приходить свободным текстом модели.
   */
  readonly factValues: Readonly<Record<string, { label: string; value: string }>>;
}

const SYSTEM_PROMPT = [
  'Ты — помощник сервиса «Траектория», который помогает абитуриенту понять уже посчитанный маршрут поступления.',
  '',
  'ЖЁСТКИЕ ПРАВИЛА:',
  '1. Используй ТОЛЬКО факты из переданного JSON. Не добавляй университеты, программы, требования, стоимости, даты и сроки, которых там нет.',
  '2. Не меняй вердикты. Если правила сказали «есть пробелы» или «требует проверки», объясняй это, а не спорь.',
  '3. Никогда не обещай поступление, не называй вероятность или процент шансов, не давай гарантий. Таких полей в ответе нет намеренно.',
  '4. pathId и taskId копируй СИМВОЛ В СИМВОЛ из переданных списков. Не придумывай новые идентификаторы.',
  '5. Числа, суммы и даты бери из JSON дословно. Если значение неизвестно — так и пиши, не подставляй правдоподобное.',
  '6. Пиши по-русски, коротко и конкретно, обращаясь на «вы». Без маркетинга и восклицаний.',
  '7. Данные в JSON помечены как демонстрационные. Не выдавай их за официальные условия приёма.',
  '8. В тексте объяснений называй программы и действия человеческими названиями. Служебные идентификаторы вроде sdu-cs-2027-paid или task:doc:school_certificate в прозу не вставляй — для них есть отдельные поля pathId и taskId.',
  '',
  'Твоя задача — связать факты профиля с выводами расчёта: почему вариант подходит именно этому человеку, чем он хуже соседнего, как выполнить ближайшее действие.',
].join('\n');

/* ------------------------------------------------------------------ */
/* Кеш                                                                 */
/* ------------------------------------------------------------------ */

interface CacheEntry {
  readonly value: AdviceResult;
  readonly at: number;
  /** Момент, после которого запись не используется. */
  readonly expiresAt: number;
}

/**
 * Предельный срок кеша объяснений.
 *
 * Фактический срок — минимум из этого предела и срока годности самого расчёта
 * (`key.validUntil`): объяснять устаревший расчёт нельзя, даже если текст ещё
 * «свежий». Часы приложения при этом не замораживаются, а ключ кеша от времени
 * не зависит — истечение проверяется отдельно от ключа.
 */
const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX = 200;

// Кеш живёт в globalThis: в dev-режиме Next перезагружает модули, и обычная
// переменная обнулялась бы при каждом изменении файла — то есть при каждом
// переходе появлялся бы новый платный запрос.
const globalRef = globalThis as typeof globalThis & {
  __trajectoryAdviceCache?: Map<string, CacheEntry>;
  __trajectoryAdviceInflight?: Map<string, Promise<AdviceResult>>;
};

function cache(): Map<string, CacheEntry> {
  if (!globalRef.__trajectoryAdviceCache) globalRef.__trajectoryAdviceCache = new Map();
  return globalRef.__trajectoryAdviceCache;
}

/**
 * Запросы, которые уже выполняются.
 *
 * Без этого быстрый переход между двумя страницами до прихода ответа давал
 * два платных запроса с одинаковым ключом: кеш заполняется только по
 * завершении первого.
 */
function inflight(): Map<string, Promise<AdviceResult>> {
  if (!globalRef.__trajectoryAdviceInflight) globalRef.__trajectoryAdviceInflight = new Map();
  return globalRef.__trajectoryAdviceInflight;
}

/**
 * Ключ кеша.
 *
 * В него входит всё, от чего зависит текст: пользователь, ревизия профиля и
 * отпечаток расчёта, выбранная цель, состав маршрута, модель и версия промпта.
 * Поэтому смена бюджета, страны, интереса или экзамена делает прежний ответ
 * недействительным автоматически — он просто не находится по новому ключу.
 */
export function adviceCacheKey(
  ownerId: string,
  session: SessionSnapshot,
  focusPathIds: readonly string[] = [],
): string {
  const config = readAiConfig();
  const routeSignature = (session.route?.tasks ?? []).map((t) => t.semanticKey).sort().join(',');
  const nextId = session.nextAction.kind === 'action' ? session.nextAction.view.task.id : 'none';
  // Порядок галочек в форме сравнения значения не имеет, набор — имеет.
  const focus = [...new Set(focusPathIds)].sort().join(',');

  return fnv1a(
    [
      ownerId,
      session.profile.revision,
      session.key.inputHash,
      session.catalog.version,
      session.activeGoal?.path.id ?? 'no-goal',
      session.progress.revision,
      routeSignature,
      nextId,
      focus,
      config.model,
      PROMPT_VERSION,
      GUARDRAILS_VERSION,
    ].join('|'),
  );
}

/**
 * Запомнить ответ.
 *
 * Срок жизни — минимум из предельного возраста кеша и срока годности расчёта,
 * на котором ответ построен. Расчёт протухает сам по себе: истекает результат
 * экзамена, наступает отсечка, источник уходит в перепроверку.
 */
function remember(
  key: string,
  value: AdviceResult,
  atMs: number,
  calculationValidUntil: string,
): AdviceResult {
  const store = cache();
  if (store.size >= CACHE_MAX) {
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }

  const byCalculation = Date.parse(calculationValidUntil);
  const byAge = atMs + CACHE_TTL_MS;
  const expiresAt = Number.isNaN(byCalculation) ? byAge : Math.min(byAge, byCalculation);

  store.set(key, { value: { ...value, cached: false }, at: atMs, expiresAt });
  return value;
}

export function clearAdviceCache(): void {
  cache().clear();
}

/* ------------------------------------------------------------------ */
/* Основная функция                                                    */
/* ------------------------------------------------------------------ */

function rulesResult(
  code: AdviceResult['fallbackCode'],
  reason: string,
): AdviceResult {
  return {
    mode: 'rules',
    advice: null,
    fallbackReason: reason,
    fallbackCode: code,
    model: null,
    generatedAt: null,
    cached: false,
    warnings: [],
    factValues: {},
  };
}

export interface AdviceOptions {
  /** Не ходить в сеть: используется тестами и предпросмотром. */
  readonly offline?: boolean;
  readonly timeoutMs?: number;
  /**
   * Момент для проверки срока годности кеша.
   *
   * Управляемые часы нужны тестам: иначе проверить, что истёкший ответ
   * не используется, можно было бы только ожиданием получаса.
   */
  readonly nowMs?: number;
  /**
   * Варианты, которые нужно объяснить дополнительно к общему топу.
   *
   * Экран сравнения передаёт сюда выбранные пользователем пути подачи:
   * модель должна разбирать именно их, включая те, что не попали в топ.
   */
  readonly focusPathIds?: readonly string[];
}

export async function getAdvice(
  ownerId: string,
  session: SessionSnapshot,
  options: AdviceOptions = {},
): Promise<AdviceResult> {
  const config = readAiConfig();

  if (!config.configured) {
    return rulesResult(
      'DISABLED',
      'Ключ OpenRouter не настроен, поэтому показаны объяснения по правилам сервиса.',
    );
  }
  if (options.offline) {
    return rulesResult('DISABLED', 'Запрос к модели отключён для этого расчёта.');
  }

  // Только существующие пути подачи: чужой идентификатор в адресной строке
  // не должен ни попасть в запрос, ни развести кеш на два ключа.
  const focusPathIds = (options.focusPathIds ?? []).filter((id) =>
    session.goals.some((g) => g.path.id === id),
  );

  const now = options.nowMs ?? Date.now();
  const key = adviceCacheKey(ownerId, session, focusPathIds);
  const hit = cache().get(key);
  if (hit && now < hit.expiresAt) {
    return { ...hit.value, cached: true };
  }
  // Истёкшая запись не используется и не остаётся занимать место.
  if (hit) cache().delete(key);

  const pending = inflight().get(key);
  if (pending) return pending;

  const promise = requestAdvice(key, session, { ...options, focusPathIds }, now);
  inflight().set(key, promise);
  try {
    return await promise;
  } finally {
    inflight().delete(key);
  }
}

async function requestAdvice(
  key: string,
  session: SessionSnapshot,
  options: AdviceOptions,
  nowMs: number,
): Promise<AdviceResult> {
  const context = buildAdviceContext(session, options.focusPathIds ?? []);

  const focus = context.focusPathIds;
  const userPrompt = [
    'Данные расчёта:',
    JSON.stringify(context.payload, null, 1),
    '',
    `Допустимые pathId: ${context.allowedPathIds.join(', ') || 'нет'}`,
    `Допустимые taskId: ${context.allowedTaskIds.join(', ') || 'нет'}`,
    // Экран сравнения работает с тем набором, который отметил пользователь,
    // а не с общим топом. Без этой строки модель сравнивала бы не то.
    ...(focus.length >= 2
      ? [
          '',
          `Пользователь выбрал для сравнения именно эти варианты: ${focus.join(', ')}.`,
          'В поле comparison разбирай компромиссы ТОЛЬКО между ними и обязательно между ' +
            'всеми выбранными, даже если какой-то из них не входит в верхние рекомендации.',
        ]
      : focus.length === 1
        ? [
            '',
            `Пользователь отметил один вариант: ${focus[0]}. Сравнивать не с чем — ` +
              'в поле comparison так и напиши и не выдумывай второй вариант.',
          ]
        : []),
    '',
    'Верни JSON по заданной схеме. Объясняй только перечисленные варианты и задачи.',
  ].join('\n');

  const response = await chatJson({
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    jsonSchema: ADVICE_JSON_SCHEMA,
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  });

  if (!response.ok) {
    // Неудача не кешируется надолго: временная сетевая ошибка не должна
    // выключать AI на полчаса.
    return rulesResult(
      response.code,
      `${response.message}. Показаны объяснения по правилам сервиса.`,
    );
  }

  const parsed = parseJsonContent(response.content);
  if (!parsed.ok) {
    return rulesResult(parsed.code, `${parsed.message}. Показаны объяснения по правилам сервиса.`);
  }

  const validated = adviceSchema.safeParse(parsed.value);
  if (!validated.success) {
    return rulesResult(
      'INVALID_SHAPE',
      'Ответ модели не соответствует ожидаемой структуре. Показаны объяснения по правилам сервиса.',
    );
  }

  const { advice, warnings, factValues } = sanitize(
    validated.data,
    context.allowedPathIds,
    context.allowedTaskIds,
    context.idTitles,
    context.facts,
  );

  return remember(
    key,
    {
    mode: 'ai',
    advice,
    fallbackReason: null,
    fallbackCode: null,
    model: response.model,
    generatedAt: new Date().toISOString(),
    cached: false,
    warnings,
    factValues,
    },
    nowMs,
    session.key.validUntil,
  );
}

/* ------------------------------------------------------------------ */
/* Фильтры достоверности                                               */
/* ------------------------------------------------------------------ */

/**
 * Формулировки, которых в продукте быть не должно.
 *
 * Кейс прямо запрещает вымышленную точность и гарантии поступления, а модель
 * без такого фильтра рано или поздно напишет «ваши шансы около 80%».
 */
/**
 * Замена служебных идентификаторов человеческими названиями.
 *
 * Модель периодически вставляет `sdu-cs-2027-paid` прямо в предложение.
 * Это не выдумка и не ошибка расчёта, но читателю такая строка бесполезна,
 * поэтому она заменяется подписью, а осиротевшие скобки убираются.
 */
export function humanizeIdentifiers(text: string, titles: ReadonlyMap<string, string>): string {
  let result = text;
  // Длинные идентификаторы заменяем первыми: иначе короткий префикс
  // съел бы часть длинного.
  const ids = [...titles.keys()].sort((a, b) => b.length - a.length);
  for (const id of ids) {
    if (!result.includes(id)) continue;
    result = result.split(id).join(titles.get(id) ?? id);
  }
  return result
    .replace(/\(\s*[,;·—-]*\s*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function sanitize(
  advice: Advice,
  allowedPathIds: readonly string[],
  allowedTaskIds: readonly string[],
  idTitles: ReadonlyMap<string, string>,
  facts: import('./facts').FactCatalogue,
): {
  advice: Advice;
  warnings: string[];
  factValues: Record<string, { label: string; value: string }>;
} {
  const warnings: string[] = [];
  const problems: HonestyProblem[] = [];
  const scopedNotes: string[] = [];
  const human = (text: string) => humanizeIdentifiers(text, idTitles);

  /**
   * Фрагмент пригоден, если он не обещает лишнего И его числа подтверждены
   * фактами ИМЕННО ЭТОГО субъекта по тому же показателю.
   */
  const honestFor = (text: string, subject: FactSubject): boolean => {
    const claim = findForbiddenClaim(text);
    if (claim) {
      problems.push(claim);
      return false;
    }
    const scoped = checkScoped(text, subject, facts);
    if (scoped) {
      scopedNotes.push(describeScopedProblem(scoped));
      return false;
    }
    return true;
  };

  const factValues: Record<string, { label: string; value: string }> = {};

  /** Ссылки на факты: чужие и несуществующие отбрасываются. */
  const resolveRefs = (refs: readonly string[], subject: FactSubject): CatalogFact[] => {
    const out: CatalogFact[] = [];
    for (const ref of refs) {
      const fact = facts.byId(ref);
      if (!fact) continue;
      if (!facts.inScope(subject).some((f) => f.id === fact.id)) continue;
      factValues[fact.id] = { label: fact.label, value: fact.display };
      out.push(fact);
    }
    return out;
  };

  const paths = new Set(allowedPathIds);
  const tasks = new Set(allowedTaskIds);

  const programExplanations = advice.programExplanations.filter((item) => {
    if (!paths.has(item.pathId)) {
      warnings.push('Модель сослалась на программу вне текущего расчёта — объяснение отброшено.');
      return false;
    }
    const subject: FactSubject = { kind: 'path', id: item.pathId };
    if (!honestFor(item.why, subject) || !honestFor(item.tradeoff, subject)) return false;
    return true;
  }).map((item) => ({
    ...item,
    why: human(item.why),
    tradeoff: human(item.tradeoff),
    // Значения подставляет сервер из расчёта, а не текст модели.
    factRefs: resolveRefs(item.factRefs, { kind: 'path', id: item.pathId }).map((f) => f.id),
  }));

  const taskGuidance = advice.taskGuidance.filter((item) => {
    if (!tasks.has(item.taskId)) {
      warnings.push('Модель сослалась на действие вне текущего маршрута — подсказка отброшена.');
      return false;
    }
    const subject: FactSubject = { kind: 'task', id: item.taskId };
    if (!honestFor(item.howTo, subject) || !honestFor(item.watchOut, subject)) return false;
    return true;
  }).map((item) => ({
    ...item,
    howTo: human(item.howTo),
    watchOut: human(item.watchOut),
    factRefs: resolveRefs(item.factRefs, { kind: 'task', id: item.taskId }).map((f) => f.id),
  }));

  const profileScope: FactSubject = { kind: 'profile' };
  const nextActionHonest =
    honestFor(advice.nextAction.what, profileScope) &&
    honestFor(advice.nextAction.why, profileScope) &&
    honestFor(advice.nextAction.firstStep, profileScope);

  const summaryHonest =
    honestFor(advice.profileSummary.headline, profileScope) &&
    honestFor(advice.profileSummary.focus, profileScope);

  const result: Advice = {
    profileSummary: {
      headline: summaryHonest ? human(advice.profileSummary.headline) : '',
      strengths: advice.profileSummary.strengths.filter((t) => honestFor(t, profileScope)).map(human),
      limits: advice.profileSummary.limits.filter((t) => honestFor(t, profileScope)).map(human),
      focus: summaryHonest ? human(advice.profileSummary.focus) : '',
    },
    programExplanations,
    comparison: {
      summary: honestFor(advice.comparison.summary, profileScope)
        ? human(advice.comparison.summary)
        : '',
      tradeoffs: advice.comparison.tradeoffs.filter((t) => honestFor(t, profileScope)).map(human),
    },
    taskGuidance,
    nextAction: nextActionHonest
      ? {
          what: human(advice.nextAction.what),
          why: human(advice.nextAction.why),
          firstStep: human(advice.nextAction.firstStep),
          factRefs: resolveRefs(advice.nextAction.factRefs, profileScope).map((f) => f.id),
        }
      : { what: '', why: '', firstStep: '', factRefs: [] },
  };

  warnings.push(...describeProblems(problems));
  warnings.push(...new Set(scopedNotes));

  return { advice: result, warnings, factValues };
}

/** Есть ли в ответе хоть что-то, что стоит показать. */
export function hasContent(advice: Advice | null): boolean {
  if (!advice) return false;
  return (
    advice.profileSummary.headline.length > 0 ||
    advice.programExplanations.length > 0 ||
    advice.taskGuidance.length > 0 ||
    advice.nextAction.what.length > 0
  );
}
