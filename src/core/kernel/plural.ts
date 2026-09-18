/**
 * NFR-08 / AI-02 / REV-26 — числа в русском тексте.
 *
 * Ревью ТЗ отдельно отметило: требование «подставлять числа серверным
 * шаблоном» подталкивает к наивной конкатенации, а в русском у числа три
 * формы существительного и падежное согласование. «Осталась 1 задача»,
 * «2 задачи», «5 задач» — три разные строки, и выбирает их правило, а не
 * автор текста.
 *
 * Правило то же, что в ICU PluralRules для русского: категории one/few/many.
 */

export type PluralForms = readonly [one: string, few: string, many: string];

export function pluralCategoryRu(n: number): 'one' | 'few' | 'many' {
  const abs = Math.abs(Math.trunc(n));
  const mod10 = abs % 10;
  const mod100 = abs % 100;

  if (mod10 === 1 && mod100 !== 11) return 'one';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'few';
  return 'many';
}

/** Форма слова без самого числа: `pluralRu(5, ['год', 'года', 'лет']) === 'лет'`. */
export function pluralRu(n: number, forms: PluralForms): string {
  const category = pluralCategoryRu(n);
  return category === 'one' ? forms[0] : category === 'few' ? forms[1] : forms[2];
}

/** Число вместе с согласованным словом: `countRu(5, [...]) === '5 лет'`. */
export function countRu(n: number, forms: PluralForms): string {
  return `${formatNumberRu(n)} ${pluralRu(n, forms)}`;
}

/** NFR-08: разряды разделяются неразрывным пробелом, дробь — запятой. */
export function formatNumberRu(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const [int, frac] = Math.abs(n).toFixed(Number.isInteger(n) ? 0 : 2).split('.');
  const grouped = (int ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const sign = n < 0 ? '−' : '';
  return frac ? `${sign}${grouped},${frac}` : `${sign}${grouped}`;
}

/* Частые наборы форм, чтобы они не расползались по коду опечатками. */
export const FORMS_YEAR: PluralForms = ['год', 'года', 'лет'];
export const FORMS_DAY: PluralForms = ['день', 'дня', 'дней'];
export const FORMS_HOUR: PluralForms = ['час', 'часа', 'часов'];
export const FORMS_TASK: PluralForms = ['задача', 'задачи', 'задач'];
export const FORMS_ACTION: PluralForms = ['действие', 'действия', 'действий'];
export const FORMS_PROGRAM: PluralForms = ['программа', 'программы', 'программ'];
export const FORMS_CONDITION: PluralForms = ['условие', 'условия', 'условий'];
