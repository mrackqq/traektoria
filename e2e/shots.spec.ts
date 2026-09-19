/**
 * Снимки экранов для дизайн-разбора. Не проверка — сбор материала.
 * Запуск: npx playwright test e2e/shots.spec.ts
 */

import path from 'node:path';

import { expect, test } from '@playwright/test';

const OUT = path.join(process.cwd(), 'design-shots');

const SCREENS: [string, string][] = [
  ['/', 'obzor'],
  ['/profile', 'profil'],
  ['/programs', 'programmy'],
  ['/programs/sdu-cs-2027-paid', 'programma-karta'],
  ['/goals', 'cel'],
  ['/route', 'marshrut'],
  ['/compare', 'sravnenie-pusto'],
  ['/scenarios', 'scenarii'],
  ['/profile/edit', 'anketa-shag1'],
  ['/profile/edit?step=exams', 'anketa-ekzameny'],
  ['/profile/edit?step=review', 'anketa-obzor'],
];

for (const [width, tag] of [
  [1440, 'desktop'],
  [390, 'mobile'],
] as [number, string][]) {
  test.describe(`${tag} ${width}`, () => {
    test.use({ viewport: { width, height: tag === 'mobile' ? 844 : 900 } });

    test(`снимки ${tag}`, async ({ page, context }) => {
      test.setTimeout(180_000);
      await context.addCookies([
        { name: 'trk_sid', value: `shots${tag}12345`, domain: '127.0.0.1', path: '/' },
        { name: 'trk_mode', value: 'demo', domain: '127.0.0.1', path: '/' },
      ]);

      for (const [url, name] of SCREENS) {
        await page.goto(url);
        await expect(page.locator('main')).toBeVisible();
        await page.waitForTimeout(700);
        await page.screenshot({
          path: path.join(OUT, `${tag}-${name}.png`),
          fullPage: true,
        });
      }

      // Стартовый экран — только для своего профиля.
      await context.clearCookies();
      await page.goto('/');
      await expect(page.locator('main')).toBeVisible();
      await page.waitForTimeout(700);
      await page.screenshot({ path: path.join(OUT, `${tag}-start.png`), fullPage: true });
    });
  });
}
