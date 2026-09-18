'use client';

/**
 * UX-01 — навигация: «Обзор», «Программы», «Цели», «Маршрут», «Сценарии»,
 * «Профиль». Ровно эти шесть разделов: сравнение живёт внутри «Программ»
 * (PR-03), а не седьмым пунктом — UX-01 задаёт состав навигации.
 * Текущий раздел помечен `aria-current`, а не только цветом (UX-09).
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, type IconName } from './icon';
import { switchModeAction } from '../_actions/questionnaire';

const SECTIONS: { href: string; label: string; icon: IconName }[] = [
  { href: '/', label: 'Обзор', icon: 'overview' },
  { href: '/programs', label: 'Программы', icon: 'programs' },
  { href: '/goals', label: 'Цели', icon: 'goals' },
  { href: '/route', label: 'Маршрут', icon: 'route' },
  { href: '/scenarios', label: 'Сценарии', icon: 'scenarios' },
  { href: '/profile', label: 'Профиль', icon: 'profile' },
];

function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname.startsWith(href) || (href === '/programs' && pathname === '/compare');
}

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="nav" aria-label="Основные разделы">
      <p className="nav__caption">Ваше поступление</p>
      <ul className="nav__list">
        {SECTIONS.map((s) => {
          const active = isActive(pathname, s.href);
          return (
            <li key={s.href}>
              <Link className="nav__link" href={s.href} {...(active ? { 'aria-current': 'page' as const } : {})}>
                <Icon name={s.icon} /><span>{s.label}</span><span className="nav__indicator" aria-hidden="true" />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Подпись пространства данных.
 *
 * Раньше здесь был вписанный в вёрстку «Демо-режим», и собственный профиль
 * посетителя выглядел демонстрационным. Это два разных утверждения:
 *  • каталог всегда синтетический — об этом говорит подвал;
 *  • профиль бывает свой или демонстрационный — об этом говорит эта подпись.
 */
export function WorkspaceBar({ mode }: { mode: 'own' | 'demo' }) {
  const pathname = usePathname();
  const section = SECTIONS.find((s) => isActive(pathname, s.href));
  const demo = mode === 'demo';

  return (
    <div className="workspace-bar">
      <div className="workspace-bar__breadcrumb">
        <span>{demo ? 'Демонстрационный профиль' : 'Личное пространство'}</span>
        <Icon name="chevron" size={14} />
        <span>{section?.label ?? 'Страница'}</span>
      </div>
      <div className="workspace-bar__tools">
        {demo ? (
          <form action={switchModeAction}>
            <input type="hidden" name="mode" value="own" />
            <button type="submit" className="demo-pill" title="Вернуться к своему профилю">
              <span aria-hidden="true" />Демо-профиль · выйти
            </button>
          </form>
        ) : null}
        <Link className="profile-shortcut" href="/profile" aria-label="Открыть профиль">
          <Icon name="profile" size={18} />
        </Link>
      </div>
    </div>
  );
}

const JOURNEY = [
  { href: '/profile/edit', label: 'Расскажите о себе', detail: 'Анкета и результаты' },
  { href: '/programs', label: 'Найдите программу', detail: 'Подбор и сравнение' },
  { href: '/goals', label: 'Изучите цель', detail: 'Условия поступления' },
  { href: '/route', label: 'Двигайтесь по плану', detail: 'Задачи и сроки' },
];

/**
 * Этапы пути с ФАКТИЧЕСКИМ прогрессом.
 *
 * Кейс требует, чтобы пользователь всегда понимал, где находится, что уже
 * сделал и что будет дальше. Раньше полоса этапов была декоративной: она
 * подсвечивала только текущую страницу и ничего не говорила о сделанном.
 */
export interface JourneyProgress {
  /** Анкета заполнена настолько, что подбор имеет смысл. */
  readonly profileDone: boolean;
  /** Подбор построен: по применённой анкете есть что смотреть и сравнивать. */
  readonly optionsFound: boolean;
  /** Цель выбрана пользователем и сохранена. */
  readonly goalChosen: boolean;
  /** По маршруту есть хотя бы одно закрытое действие. */
  readonly progressStarted: boolean;
}

export function Journey({ progress }: { progress: JourneyProgress }) {
  const pathname = usePathname();
  const done = [
    progress.profileDone,
    progress.optionsFound,
    progress.goalChosen,
    progress.progressStarted,
  ];

  return (
    <nav className="journey" aria-label="Этапы пути поступления">
      <ol>
        {JOURNEY.map((step, i) => {
          const active = i === 0 ? pathname.startsWith('/profile') : isActive(pathname, step.href);
          const complete = done[i] === true;
          // Следующий незакрытый этап — тот, до которого всё сделано.
          const isNext = !complete && done.slice(0, i).every(Boolean);

          return (
            <li key={step.href} data-state={complete ? 'done' : isNext ? 'next' : 'todo'}>
              <Link
                href={step.href}
                {...(active ? { 'aria-current': 'step' as const } : {})}
              >
                <span className="journey__number" aria-hidden="true">
                  {complete ? '✓' : `0${i + 1}`}
                </span>
                <span>
                  <strong>{step.label}</strong>
                  <small>
                    {complete ? 'готово' : isNext ? 'сейчас: ' + step.detail : step.detail}
                  </small>
                </span>
                <Icon name="chevron" size={14} />
                <span className="visually-hidden">
                  {complete ? ' — этап пройден' : isNext ? ' — следующий этап' : ' — ещё не начат'}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
