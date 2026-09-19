/**
 * Охват каталога — обещание на первом экране. Если оно разойдётся с
 * содержимым каталога, человек потратит время на анкету зря.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { summarizeCatalog, describeCatalog } from './summary.ts';
import { SEED_UNIVERSITIES, SEED_PROGRAMS } from './seed.ts';
import type { University, Program } from './types.ts';

function uni(id: string, country: string): University {
  return {
    id,
    name: `Вуз ${id}`,
    shortName: id.toUpperCase(),
    country,
    city: 'Город',
    website: 'https://example.kz',
    isDemo: false,
  };
}

test('CAT-01: охват считается по каталогу, а не вписан в текст', () => {
  const scope = summarizeCatalog(SEED_UNIVERSITIES, SEED_PROGRAMS);

  assert.equal(
    scope.universities,
    SEED_UNIVERSITIES.length,
    'на экране обещано ровно столько вузов, сколько их в подборе',
  );
  assert.equal(
    scope.programs,
    SEED_PROGRAMS.length,
    'на экране обещано ровно столько программ, сколько их в подборе',
  );
  assert.ok(scope.universities > 0, 'пустым каталог быть не должен');
});

test('CAT-01: страны берутся из вузов и не дублируются', () => {
  const scope = summarizeCatalog([uni('a', 'KZ'), uni('b', 'KZ'), uni('c', 'TR')], []);

  assert.deepEqual(scope.countries, ['KZ', 'TR'], 'страна названа один раз');
});

test('CAT-01: одна страна называется по имени, а не числом', () => {
  const phrase = describeCatalog(summarizeCatalog([uni('a', 'KZ'), uni('b', 'KZ')], []));

  assert.ok(
    phrase.includes('Казахстана'),
    'человеку важно, в какой стране вузы, а не сколько стран в базе',
  );
  assert.ok(!phrase.includes('1 стран'), 'про «одну страну» не пишем');
});

test('CAT-01: несколько стран перечисляются — по ним решают, подходит ли сервис', () => {
  const phrase = describeCatalog(summarizeCatalog([uni('a', 'KZ'), uni('b', 'TR')], []));

  assert.ok(phrase.includes('Казахстана и Турции'), `страны перечислены: ${phrase}`);
});

test('CAT-01: числительные согласованы — «1 университет», «2 университета», «6 университетов»', () => {
  const at = (n: number) =>
    describeCatalog(summarizeCatalog(Array.from({ length: n }, (_, i) => uni(`u${i}`, 'KZ')), []));

  assert.ok(at(1).startsWith('1 университет '), at(1));
  assert.ok(at(2).startsWith('2 университета'), at(2));
  assert.ok(at(6).startsWith('6 университетов'), at(6));
  // Классическая ловушка русского счёта: 11–14 всегда «университетов».
  assert.ok(at(11).startsWith('11 университетов'), at(11));
  assert.ok(at(21).startsWith('21 университет '), at(21));
});

test('CAT-01: фраза охвата собирается по настоящему каталогу без «undefined»', () => {
  const phrase = describeCatalog(summarizeCatalog(SEED_UNIVERSITIES, SEED_PROGRAMS));

  assert.ok(!phrase.includes('undefined'), `фраза целая: ${phrase}`);
  assert.ok(phrase.includes('бакалавриата'), 'названа ступень обучения');
});

test('CAT-01: короткие имена вузов идут в порядке каталога — человек ищет свой', () => {
  const programs: readonly Program[] = [];
  const scope = summarizeCatalog(SEED_UNIVERSITIES, programs);

  assert.deepEqual(
    scope.shortNames,
    SEED_UNIVERSITIES.map((u) => u.shortName),
    'порядок не переставлен: подбор и список на главной согласованы',
  );
});
