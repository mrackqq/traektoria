/**
 * Охват каталога: сколько вузов и программ и по каким странам.
 *
 * Человек соглашается отвечать на пять разделов вопросов ДО того, как увидит
 * хоть одну программу. Решение «стоит ли оно того» он принимает вслепую, и
 * ответить ему нечем: главный экран обещает «куда поступать», а чем именно
 * располагает сервис — узнаётся только после анкеты.
 *
 * Поэтому охват считается ЗДЕСЬ, из самого каталога, а не пишется руками в
 * вёрстке. Число вузов в тексте и число вузов в подборе — это одно число, и
 * разойтись они не могут: добавится седьмой вуз или вторая страна — текст на
 * главной изменится сам.
 */

import type { University, Program } from './types.ts';

export interface CatalogSummary {
  /** Сколько университетов в каталоге. */
  readonly universities: number;
  /** Сколько программ бакалавриата. */
  readonly programs: number;
  /** Коды стран, отсортированные для воспроизводимости. */
  readonly countries: readonly string[];
  /** Короткие имена вузов в порядке каталога — чтобы человек узнал свой. */
  readonly shortNames: readonly string[];
}

const COUNTRY_NAMES: Record<string, string> = {
  KZ: 'Казахстана',
  TR: 'Турции',
  RU: 'России',
  UZ: 'Узбекистана',
};

export function summarizeCatalog(
  universities: readonly University[],
  programs: readonly Program[],
): CatalogSummary {
  return {
    universities: universities.length,
    programs: programs.length,
    countries: [...new Set(universities.map((u) => u.country))].sort(),
    shortNames: universities.map((u) => u.shortName),
  };
}

/** Русское склонение: «6 университетов», «1 университет», «22 университета». */
function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  const mod10 = n % 10;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

/**
 * Фраза охвата для первого экрана.
 *
 * Одна страна называется по имени: «университетов Казахстана» полезнее, чем
 * «университетов из 1 страны». Несколько — перечисляются, потому что
 * подходит ли сервис, человек решает именно по этому списку.
 */
export function describeCatalog(scope: CatalogSummary): string {
  const unis = `${scope.universities} ${plural(
    scope.universities,
    'университет',
    'университета',
    'университетов',
  )}`;
  const progs = `${scope.programs} ${plural(
    scope.programs,
    'программа',
    'программы',
    'программ',
  )} бакалавриата`;

  const named = scope.countries.map((c) => COUNTRY_NAMES[c] ?? c);
  const where =
    named.length === 1
      ? ` ${named[0]}`
      : named.length > 1
        ? ` ${named.slice(0, -1).join(', ')} и ${named[named.length - 1]}`
        : '';

  return `${unis}${where}, ${progs}`;
}
