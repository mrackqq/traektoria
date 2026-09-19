/**
 * Снимки глазами нового посетителя: профиль пуст, ответов нет.
 * Это первое, что видит человек, и именно здесь решается, поймёт ли он
 * продукт. Не проверка — сбор материала для разбора.
 */

import path from 'node:path';

import { expect, test } from '@playwright/test';

const OUT = path.join(process.cwd(), 'design-shots', 'new-user');

const SCREENS: [string, string][] = [
  ['/', '01-obzor'],
  ['/profile/edit', '02-anketa'],
  ['/profile', '03-diagnostika'],
  ['/programs', '04-programmy'],
  ['/goals', '05-cel'],
  ['/route', '06-plan'],
  ['/compare', '07-sravnenie'],
  ['/scenarios', '08-scenarii'],
];

for (const [width, tag] of [
  [1440, 'desktop'],
  [390, 'mobile'],
] as [number, string][]) {
  test(`пустой профиль ${tag}`, async ({ page, context }) => {
    test.setTimeout(120_000);
    await context.clearCookies();
    await page.setViewportSize({ width, height: tag === 'mobile' ? 844 : 900 });

    for (const [url, name] of SCREENS) {
      await page.goto(url);
      await expect(page.locator('main')).toBeVisible();
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(OUT, `${tag}-${name}.png`), fullPage: true });
    }
  });
}
