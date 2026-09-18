/**
 * Запрещённые утверждения в тексте модели.
 *
 * Здесь остались ТОЛЬКО те проверки, которые честно решаются лексикой:
 * обещания зачисления, гарантии и оценки вероятности. Проверка фактов
 * лексикой не решается и живёт отдельно, в `facts.ts`, где у каждого факта
 * есть субъект, показатель и значение.
 *
 * Прежняя версия собирала общий набор чисел из всего контекста и считала
 * это привязкой к фактам. Это было неверно: год 2027 есть у любой кампании,
 * 4.6 — средний балл профиля, а не порог IELTS, а стоимость одной программы
 * ничего не говорит о другой. Такую проверку нельзя чинить ещё одним
 * регулярным выражением, поэтому она заменена структурной.
 */

/** Числительные словами: без них «девяносто процентов» проходило фильтр. */
const NUMBER_WORDS = [
  'ноль', 'один', 'одна', 'два', 'две', 'три', 'четыре', 'пять', 'шесть',
  'семь', 'восемь', 'девять', 'десять', 'одиннадцать', 'двенадцать',
  'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать',
  'восемнадцать', 'девятнадцать', 'двадцать', 'тридцать', 'сорок',
  'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто',
  'сто', 'двести', 'триста', 'половина', 'треть', 'четверть',
];

const NUMBER_WORD_RE = new RegExp(`(^|[^а-яё])(${NUMBER_WORDS.join('|')})[а-яё]*`, 'i');

/** Утверждения, которых в продукте быть не должно ни в каком виде. */
const FORBIDDEN_CLAIMS: readonly { readonly code: string; readonly re: RegExp }[] = [
  { code: 'PERCENT_DIGITS', re: /\d\s*%/ },
  { code: 'PERCENT_WORD', re: /процент|проц\./i },
  { code: 'PROBABILITY', re: /вероятн/i },
  { code: 'CHANCE', re: /шанс/i },
  { code: 'GUARANTEE', re: /гарант/i },
  { code: 'ADMISSION_PROMISE', re: /(обязательно|точно|наверняка|непременно)\s+(поступ|пройд|зачисл)/i },
  { code: 'ADMISSION_PROMISE', re: /(вы|вас)\s+(поступите|зачислят|примут|возьмут)/i },
  { code: 'ADMISSION_PROMISE', re: /(обеспеч|гарантир)\w*\s+(вам\s+)?(поступлени|зачислени|место)/i },
  { code: 'ENROLMENT_ODDS', re: /(зачислени[ея]|поступлени[ея])\s+составля/i },
  { code: 'CERTAINTY', re: /со\s*100\s*%|стопроцентн/i },
];

export interface HonestyProblem {
  readonly code: string;
  readonly detail: string;
}

/**
 * Запрещённое утверждение в тексте.
 *
 * «Процент» и «вероятность» отвергаются вместе с числительными словами: связка
 * «девяносто процентов» ловится и по слову «процент», и по числительному.
 */
export function findForbiddenClaim(text: string): HonestyProblem | null {
  for (const { code, re } of FORBIDDEN_CLAIMS) {
    if (re.test(text)) return { code, detail: `запрещённое утверждение (${code})` };
  }
  if (NUMBER_WORD_RE.test(text) && /(процент|вероятн|шанс|из\s+десяти|из\s+ста)/i.test(text)) {
    return { code: 'PERCENT_WORD', detail: 'оценка вероятности числом словами' };
  }
  return null;
}

/** Человеческое объяснение того, что именно было убрано. */
export function describeProblems(problems: readonly HonestyProblem[]): string[] {
  const byCode = new Map<string, number>();
  for (const p of problems) byCode.set(p.code, (byCode.get(p.code) ?? 0) + 1);

  const out: string[] = [];
  for (const [code, count] of byCode) {
    const suffix = count > 1 ? ` (${count} фрагмента)` : '';
    switch (code) {
      case 'PERCENT_DIGITS':
      case 'PERCENT_WORD':
      case 'PROBABILITY':
      case 'CHANCE':
      case 'ENROLMENT_ODDS':
        out.push(
          `Убрана оценка вероятности поступления${suffix}: сервис не считает и не показывает шансы.`,
        );
        break;
      case 'GUARANTEE':
      case 'ADMISSION_PROMISE':
      case 'CERTAINTY':
        out.push(`Убрано обещание зачисления${suffix}: гарантий поступления сервис не даёт.`);
        break;
      default:
        out.push(`Убран сомнительный фрагмент${suffix}.`);
    }
  }
  return [...new Set(out)];
}
