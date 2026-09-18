/**
 * Часы прикладного слоя.
 *
 * В продукте используются РЕАЛЬНЫЕ часы: иначе даты, просрочки и срок годности
 * расчёта не двигаются, и пользователь видит вчерашний мир. Фиксированный
 * `DEMO_CLOCK` остаётся в ядре для воспроизводимых тестов.
 *
 * `TRAJECTORY_CLOCK` позволяет прогнать сценарий на заданный момент — это
 * нужно тестам и записи демонстрации, и это явная настройка, а не умолчание.
 */

import type { PlanningClock } from '@core/kernel/time';

export function appClock(): PlanningClock {
  const override = process.env.TRAJECTORY_CLOCK;
  const now = override && !Number.isNaN(Date.parse(override))
    ? new Date(Date.parse(override)).toISOString()
    : new Date().toISOString();

  return { now, timezone: process.env.TRAJECTORY_TZ ?? 'Asia/Almaty' };
}

export function appNow(): string {
  return appClock().now;
}

/** Сегодняшняя календарная дата по часам приложения. */
export function appToday(): string {
  return appClock().now.slice(0, 10);
}
