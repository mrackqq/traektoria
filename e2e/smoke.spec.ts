/**
 * Базовая проходимость: страницы открываются, навигация работает,
 * мусор в адресной строке не роняет сервер.
 */

import { expect, test } from '@playwright/test';

const PAGES = [
  ['/', 'Обзор'],
  ['/profile', 'Мои ответы'],
  ['/programs', 'Программы'],
  ['/goals', 'Моя цель'],
  ['/route', 'Мой план'],
  ['/compare', 'Сравнение'],
  ['/scenarios', 'Что, если…'],
  ['/profile/edit', 'Анкета'],
] as const;

test.describe('Проходимость', () => {
  for (const [url, name] of PAGES) {
    test(`${name} (${url}) открывается без ошибки`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));

      const response = await page.goto(url);

      expect(response?.status(), `${url} ответил ${response?.status()}`).toBe(200);
      await expect(page.locator('main')).toBeVisible();
      expect(errors, `ошибки в консоли на ${url}: ${errors.join('; ')}`).toEqual([]);
    });
  }
});

test.describe('Границы ввода', () => {
  test('Несуществующая программа не роняет сервер', async ({ page }) => {
    const response = await page.goto('/programs/no-such-program-xyz');

    expect(response!.status(), 'ошибка данных не должна давать 500').toBeLessThan(500);
    await expect(page.getByRole('heading', { name: 'Страница не найдена' })).toBeVisible();
  });

  test('Мусор в параметрах страниц не роняет сервер', async ({ page }) => {
    const urls = [
      '/profile/edit?step=<script>alert(1)</script>',
      '/scenarios?case=нет-такого-сценария',
      '/compare?ids=<script>alert(1)</script>',
      '/compare?ids=a,b,c,d,e,f,g',
    ];

    for (const url of urls) {
      const response = await page.goto(url);
      expect(response!.status(), `${url} ответил ${response?.status()}`).toBeLessThan(500);
      await expect(page.locator('main')).toBeVisible();
    }
  });

  test('Разметка страницы не содержит внедрённого скрипта из параметров', async ({ page }) => {
    await page.goto('/compare?ids=<script>alert(1)</script>');

    const html = await page.content();
    expect(html).not.toContain('<script>alert(1)</script>');
  });
});

test.describe('Сессия', () => {
  test('Первый заход выдаёт cookie сессии с защитными флагами', async ({ page, context }) => {
    await page.goto('/');

    const cookie = (await context.cookies()).find((c) => c.name === 'trk_sid');

    expect(cookie, 'анонимная сессия обязана появиться на первом же запросе').toBeTruthy();
    expect(cookie!.httpOnly, 'cookie сессии не должна читаться из JS').toBe(true);
    expect(cookie!.sameSite).toBe('Lax');
    expect(cookie!.value.length).toBeGreaterThanOrEqual(8);
  });

  test('Два браузера получают разные сессии', async ({ browser }) => {
    const a = await browser.newContext();
    const b = await browser.newContext();

    await a.newPage().then((p) => p.goto('/'));
    await b.newPage().then((p) => p.goto('/'));

    const idOf = async (ctx: typeof a) =>
      (await ctx.cookies()).find((c) => c.name === 'trk_sid')?.value;

    expect(await idOf(a)).not.toBe(await idOf(b));

    await a.close();
    await b.close();
  });
});

test.describe('Навигация', () => {
  test('Основные разделы доступны из шапки', async ({ page }) => {
    await page.goto('/');

    const nav = page.getByRole('navigation', { name: 'Основные разделы' });
    await expect(nav).toBeVisible();

    for (const name of ['Обзор', 'Программы', 'Моя цель', 'Мой план']) {
      await expect(nav.getByRole('link', { name })).toBeVisible();
    }
  });

  test('Ссылка «Перейти к содержимому» переводит фокус на основное', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');

    const skip = page.getByRole('link', { name: 'Перейти к содержимому' });
    await expect(skip).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(page.locator('#main')).toBeFocused();
  });
});
