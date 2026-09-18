/**
 * Подключение компонентов к страницам.
 *
 * Наличие компонента в проекте не означает, что пользователь его увидит:
 * `NextSteps` был написан и нигде не использован, `ChangesBlock` стоял только
 * в одной ветке обзора, а предупреждение о цели не доходило до маршрута.
 * Такие разрывы не ловятся тестами чистых функций.
 *
 * Проверка читает исходники страниц и убеждается, что блок действительно
 * подключён в нужном месте. Это не замена браузерной проверке рендера —
 * это защита от «компонент есть, но он не вызван».
 *
 * Запуск: npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');

function source(relative: string): string {
  return readFileSync(path.join(ROOT, relative), 'utf8');
}

function countOf(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

test('Обзор: стартовый экран показывается до заполнения анкеты', () => {
  const page = source('src/app/page.tsx');

  assert.ok(page.includes('StartScreen'), 'компонент подключён');
  assert.match(
    page,
    /if \(!s\.profileStarted\)[\s\S]{0,600}<StartScreen/,
    'стартовый экран стоит в ветке незаполненной анкеты',
  );
});

test('Обзор: «Что изменилось» есть и с целью, и без неё', () => {
  const page = source('src/app/page.tsx');

  assert.equal(
    countOf(page, '<ChangesBlock'),
    2,
    'блок подключён в обеих ветках: с активной целью и без подходящих целей',
  );

  // Обе ветки передают текущую ревизию — иначе показывалась бы устаревшая сводка.
  assert.equal(
    countOf(page, 'profileRevision={s.profile.revision}'),
    2,
    'в обоих местах сводка сверяется с текущей ревизией профиля',
  );
});

test('Обзор без целей: честная причина и действия сохранены', () => {
  const page = source('src/app/page.tsx');
  const branch = page.slice(page.indexOf('if (!goal)'), page.indexOf('const nearest'));

  assert.ok(branch.includes('shortfallReason'), 'показана причина отсутствия вариантов');
  assert.ok(branch.includes('/profile/edit'), 'предложено изменить анкету');
  assert.ok(branch.includes('/programs'), 'предложено посмотреть причины исключения');
  assert.ok(branch.includes('<ChangesBlock'), 'результат пересчёта виден именно здесь');
});

test('Маршрут: предупреждение о цели стоит перед планом', () => {
  const page = source('src/app/route/page.tsx');

  assert.ok(page.includes('s.activeGoalIssue'), 'предупреждение подключено');

  const warningAt = page.indexOf('s.activeGoalIssue');
  const planAt = page.indexOf('aria-labelledby="feasibility"');
  assert.ok(warningAt > 0 && planAt > 0, 'оба блока присутствуют');
  assert.ok(warningAt < planAt, 'предупреждение выводится раньше плана выполнимости');

  assert.ok(page.includes('/profile/edit'), 'есть действие «Изменить анкету»');
  assert.ok(page.includes('Выбрать другую программу'), 'есть действие выбора другой программы');
  assert.ok(
    page.includes('admissionYear'),
    'для несовпадения года называется год кампании',
  );
});

test('После применения анкеты есть рабочий следующий переход', () => {
  const commit = source('src/app/_components/commit-draft.tsx');

  assert.ok(commit.includes('NextSteps'), 'переходы подключены');
  assert.match(
    commit,
    /state\.ok \?[\s\S]{0,900}<NextSteps \/>/,
    'переходы показываются именно после успешного применения',
  );

  // Одно заметное действие, остальное — обычные ссылки.
  const successBlock = commit.slice(commit.indexOf('state.ok ?'), commit.indexOf('<NextSteps />'));
  assert.equal(countOf(successBlock, 'className="btn"'), 1, 'ровно одна главная кнопка');
});

test('NextSteps ведёт по этапам пути', () => {
  const start = source('src/app/_components/start-screen.tsx');

  for (const href of ['/profile', '/programs', '/compare', '/goals', '/route']) {
    assert.ok(start.includes(`href: '${href}'`), `есть переход на ${href}`);
  }
});

test('Диагностика по правилам подключена к профилю', () => {
  const profile = source('src/app/profile/page.tsx');
  assert.ok(profile.includes('<DiagnosisBlock'), 'блок диагностики подключён');
});

test('Факты расчёта подставляются под текстом модели', () => {
  const insight = source('src/app/_components/ai-insight.tsx');

  assert.ok(insight.includes('function FactList'), 'компонент фактов существует');
  assert.ok(countOf(insight, '<FactList') >= 3, 'факты показаны у программ, задач и шага');
  assert.ok(
    insight.includes('смысловую верность сервис'),
    'ограничение проверки названо прямо, без обещания полной верификации',
  );
});

test('Анкета: переход по шагам не теряет введённое', () => {
  const step = source('src/app/_components/questionnaire-step.tsx');

  // Ровно тот баг, из-за которого анкету приходилось заполнять заново:
  // ссылка «Пропустить шаг» уводила дальше, не отправив форму.
  const actions = step.slice(step.indexOf('form-actions'), step.indexOf('<StepMessage'));
  assert.ok(
    !/Пропустить шаг/.test(actions),
    'кнопки, уводящей со страницы без сохранения, в блоке действий нет',
  );
  assert.ok(!/<a\s/.test(actions), 'в блоке действий нет ссылок — только кнопки отправки');
  assert.equal(
    countOf(actions, 'type="submit"'),
    2,
    'и «Назад», и «Сохранить и продолжить» отправляют форму',
  );

  // После успешного сохранения пользователь уходит на следующий шаг сам.
  assert.ok(step.includes('useRouter'), 'переход выполняется после сохранения');
  assert.ok(
    /goAfterSave\.current/.test(step),
    'цель перехода запоминается на момент нажатия кнопки',
  );
  assert.match(
    step,
    /state\.errors\.length === 0\) router\.push/,
    'при ошибках в полях остаёмся на шаге, а не уходим дальше',
  );
});

test('Анкета: верхние вкладки шагов идут через сохранение', () => {
  const page = source('src/app/profile/edit/page.tsx');
  const step = source('src/app/_components/questionnaire-step.tsx');
  const nav = source('src/app/_components/step-nav.tsx');

  // Вкладки были обычными ссылками: переход по ним менял `?step=…` мимо формы,
  // и введённое на текущем шаге пропадало.
  assert.ok(page.includes('<StepTabs'), 'вкладки рисует компонент с сохранением');
  assert.ok(
    !/<Link[\s\S]{0,200}\?step=\$\{s\.id\}/.test(page),
    'ссылок-вкладок, уводящих мимо формы, на странице больше нет',
  );
  assert.ok(page.includes('<StepNavProvider>'), 'шапка и форма связаны общим контекстом');

  // Вкладка не переходит сама: она просит форму сохранить и уйти.
  assert.match(nav, /e\.preventDefault\(\)/, 'переход по ссылке перехватывается');
  assert.match(nav, /if \(nav\.pending\) return/, 'во время сохранения повторное нажатие не срабатывает');
  assert.match(
    nav,
    /if \(!nav \|\| !nav\.hasForm\(\)\) return/,
    'на странице проверки, где формы нет, вкладка остаётся обычной ссылкой',
  );

  // Форма шага объявляет себя и сохраняет по запросу вкладки.
  assert.ok(step.includes('useStepNav'), 'форма подключена к навигации по шагам');
  assert.match(
    step,
    /goAfterSave\.current = href;[\s\S]{0,120}requestSubmit\(\)/,
    'сначала запоминается цель перехода, затем отправляется форма',
  );
  assert.match(step, /nav\?\.setPending\(pending\)/, 'вкладки знают о том, что идёт сохранение');
  assert.match(
    step,
    /if \(!state\.ok\) return;/,
    'конфликт ревизий оставляет пользователя на шаге',
  );
});

test('«Что изменилось»: первое заполнение не выглядит правкой', () => {
  const block = source('src/app/_components/changes.tsx');

  // «не заполнено → 2027» читалось как дефект профиля, а не как ответ.
  assert.match(block, /c\.firstTime/, 'первое заполнение отделено от правки');
  assert.match(block, /Заполнено впервые/, 'у первого заполнения свой заголовок');
  assert.match(
    block,
    /Изменено[\s\S]{0,400}было «\{c\.before\}», стало «\{c\.after\}»/,
    'правка существующего ответа показывается как было/стало',
  );
  assert.ok(
    !/\{c\.before\}[\s\S]{0,40}→/.test(block),
    'стрелки «не заполнено → значение» для первого ответа больше нет',
  );

  // Ограничения, которые снимать нельзя.
  assert.match(
    block,
    /summary\.profileRevisionAfter !== profileRevision/,
    'сводка показывается только для текущей ревизии',
  );
  assert.ok(block.includes('Рекомендации') && block.includes('План'), 'блоки пересчёта на месте');
});

test('Шапка не предлагает заполнить анкету тому, кто её уже заполнил', () => {
  const layout = source('src/app/layout.tsx');

  assert.ok(layout.includes('isProfileStarted'), 'состояние анкеты читается');
  assert.match(
    layout,
    /started \? \([\s\S]{0,400}Ответы сохранены/,
    'заполнившему показывается другое сообщение',
  );
  assert.match(
    layout,
    /\) : \([\s\S]{0,400}Первый раз здесь\?/,
    'приглашение к анкете осталось только для новичка',
  );
});

test('Каталог: университеты настоящие, условия помечены ориентировочными', () => {
  const seed = source('src/core/catalog/seed.ts');

  for (const name of ['Nazarbayev University', 'Astana IT University', 'Satbayev University',
                      'Казахстанско-Британский технический университет']) {
    assert.ok(seed.includes(name), `в каталоге есть ${name}`);
  }

  // Ссылки ведут на настоящие приёмные комиссии, а не на example-домен.
  assert.ok(!seed.includes('traektoria.invalid'), 'выдуманного домена источников больше нет');
  assert.ok(seed.includes('https://nu.edu.kz/admissions'), 'источник ведёт на страницу приёма');

  // Сами значения условий остаются ориентировочными и помечены.
  assert.ok(seed.includes('ОРИЕНТИРОВОЧНЫЕ'), 'в заголовке файла сказано, что значения ориентировочные');
});

test('UX: ближайшее действие на обзоре показано перед карточками и подробностями', () => {
  const page = source('src/app/page.tsx');
  assert.ok(page.indexOf('<NextStep outcome={s.nextAction}') < page.indexOf('className="dashboard"'));
  assert.ok(page.includes('/route#task-${t.id}'), 'кнопка ведёт к конкретному действию');
});

test('UX: карта связей необязательна, а текущий шаг имеет прямую ссылку', () => {
  const page = source('src/app/route/page.tsx');
  assert.ok(page.includes('<details className="card disclosure">'));
  assert.ok(page.includes('id={`task-${t.id}`}'));
  assert.ok(page.indexOf('route-next-heading') < page.indexOf('aria-labelledby="feasibility"'));
});

test('UX: анкета не показывает технические ревизии на первом плане', () => {
  const commit = source('src/app/_components/commit-draft.tsx');
  assert.ok(commit.includes('expectedProfileRevision') && commit.includes('expectedDraftRevision'), 'контроль конкурентных изменений сохранён');
  assert.ok(!commit.includes('Текущая ревизия профиля'));
  const nav = source('src/app/_components/nav.tsx');
  assert.ok(nav.includes("pathname.startsWith('/profile/edit')"), 'в анкете нет второго степпера');
});

test('UX: статус сохранения сбрасывается при переходе на другой шаг анкеты', () => {
  const page = source('src/app/profile/edit/page.tsx');
  assert.match(page, /<QuestionnaireStep\s+key=\{step\.id\}/, 'у каждого шага своё состояние формы');
});
