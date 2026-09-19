/**
 * Часы прикладного слоя.
 *
 * Важна не только подстановка момента, но и поведение при мусоре в
 * переменной окружения: непарсящееся значение обязано откатываться к
 * реальному времени, а не превращать весь расчёт в `Invalid Date`.
 */

import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { appClock, appNow, appToday } from './clock.ts';

const savedClock = process.env.TRAJECTORY_CLOCK;
const savedTz = process.env.TRAJECTORY_TZ;

afterEach(() => {
  if (savedClock === undefined) delete process.env.TRAJECTORY_CLOCK;
  else process.env.TRAJECTORY_CLOCK = savedClock;
  if (savedTz === undefined) delete process.env.TRAJECTORY_TZ;
  else process.env.TRAJECTORY_TZ = savedTz;
});

test('Заданный момент подставляется целиком', () => {
  process.env.TRAJECTORY_CLOCK = '2027-05-01T12:34:56.000Z';

  assert.equal(appNow(), '2027-05-01T12:34:56.000Z');
  assert.equal(appToday(), '2027-05-01');
});

test('Момент нормализуется к ISO независимо от формы записи', () => {
  process.env.TRAJECTORY_CLOCK = '2027-05-01';
  assert.equal(appNow(), '2027-05-01T00:00:00.000Z', 'дата без времени читается как полночь UTC');
});

test('Непарсящееся значение откатывается к реальному времени', () => {
  process.env.TRAJECTORY_CLOCK = 'вчера вечером';

  const now = appNow();
  assert.ok(!now.includes('Invalid'), 'мусор в настройке не должен давать Invalid Date');
  assert.ok(
    Math.abs(Date.parse(now) - Date.now()) < 5_000,
    'при непригодной настройке берутся настоящие часы',
  );
});

test('Пустая строка не считается заданным моментом', () => {
  process.env.TRAJECTORY_CLOCK = '';
  assert.ok(Math.abs(Date.parse(appNow()) - Date.now()) < 5_000);
});

test('Без настройки используются настоящие часы', () => {
  delete process.env.TRAJECTORY_CLOCK;
  assert.ok(Math.abs(Date.parse(appNow()) - Date.now()) < 5_000);
});

test('Часовой пояс по умолчанию — Алматы, но переопределяется', () => {
  delete process.env.TRAJECTORY_TZ;
  assert.equal(appClock().timezone, 'Asia/Almaty');

  process.env.TRAJECTORY_TZ = 'Europe/Istanbul';
  assert.equal(appClock().timezone, 'Europe/Istanbul');
});

test('Настройка читается заново на каждом обращении', () => {
  process.env.TRAJECTORY_CLOCK = '2027-01-01T00:00:00.000Z';
  assert.equal(appToday(), '2027-01-01');

  process.env.TRAJECTORY_CLOCK = '2028-02-03T00:00:00.000Z';
  assert.equal(appToday(), '2028-02-03', 'момент не должен кешироваться между вызовами');
});
