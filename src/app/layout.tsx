/**
 * Оболочка приложения.
 *
 * UX-09: первый интерактивный элемент — переход к содержимому; язык документа
 * объявлен; структура landmark-ов (header / nav / main / footer) явная.
 * DATA-08: пометка демонстрационного контура видна на каждом экране, включая
 * экспорт и печать, и не прячется в подвал одной страницы.
 */

import type { Metadata, Viewport } from 'next';

import './globals.css';
import Link from 'next/link';
import { Journey, Nav, WorkspaceBar } from './_components/nav';
import { visitorContext } from '@/server/session-context';
import { appNow } from '@/server/clock';
import { getStore } from '@/server/file-store';
import { headProfile } from '@/server/ports';
import { defaultProfileFor } from '@/server/questionnaire-service';
import { isProfileStarted } from '@core/demo/profile';
import { Icon } from './_components/icon';

export const metadata: Metadata = {
  title: 'ТРАЕКТОРИЯ — маршрут поступления',
  description:
    'Персональный маршрут поступления: известные формальные условия, мост к цели ' +
    'и стресс-тест графика. Без прогнозов вероятности поступления.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Режим читается здесь: подпись в шапке должна показывать фактическое
  // пространство данных, а не быть вписанной в вёрстку.
  const { mode, ownerId } = await visitorContext();

  // Подсказка в шапке должна отражать фактическое состояние анкеты.
  // Раньше «Первый раз здесь? Заполните анкету» висело всегда — и после
  // заполнения выглядело так, будто ответы не сохранились.
  const state = await getStore().read(ownerId);
  const profile = headProfile(state) ?? defaultProfileFor(ownerId, appNow());
  const started = isProfileStarted(profile);

  // Прогресс по этапам считается из сохранённого состояния, а не из адреса
  // страницы: полоса этапов должна показывать сделанное, а не текущий раздел.
  const anyProgress = Object.values(state.progress).some((p) =>
    p.tasks.some((t) => t.status === 'done' || t.status === 'skipped'),
  );
  const journey = {
    profileDone: started,
    // Подбор считается автоматически, как только анкета заполнена.
    optionsFound: started,
    goalChosen: state.activeGoalId !== null,
    progressStarted: anyProgress,
  };

  return (
    <html lang="ru">
      <body>
        <a className="skip-link" href="#main">
          Перейти к содержимому
        </a>

        <div className="shell">
          <header className="masthead">
            <div className="masthead__inner">
              <Link className="wordmark" href="/">
                <span className="wordmark__mark" aria-hidden="true"><Icon name="route" size={23} /></span>
                <span>траектория<span className="wordmark__sub">Маршрут поступления</span></span>
              </Link>
            </div>
            <Nav />
            <div className="sidebar-guide">
              <span className="sidebar-guide__icon"><Icon name="spark" /></span>
              {started ? (
                <>
                  <h2>Анкета заполнена</h2>
                  <p>Профиль сохранён, ревизия {profile.revision}. Ответы можно дополнить в любой момент.</p>
                  <Link href="/profile">Открыть профиль <Icon name="arrow" size={17} /></Link>
                </>
              ) : (
                <>
                  <h2>Первый раз здесь?</h2>
                  <p>Начните с анкеты. Ваши ответы — основа подбора и плана.</p>
                  <Link href="/profile/edit">Заполнить анкету <Icon name="arrow" size={17} /></Link>
                </>
              )}
            </div>
            <div className="sidebar-note"><Icon name="shield" size={17} /><span>Без паспортных данных<br />и сканов документов</span></div>
          </header>

          <div className="workspace">
            <WorkspaceBar mode={mode} />
            <main className="main" id="main" tabIndex={-1}>
              <Journey progress={journey} />
              {children}
            </main>

          <footer className="footer">
            <div className="footer__inner">
              <span className="footer__brand">траектория<span aria-hidden="true">↗</span></span>
              <p>Университеты, программы и ссылки на приёмные комиссии — настоящие. Пороговые баллы, стоимость и сроки — ориентировочные: подтверждайте их на сайте вуза. Сервис проверяет условия и график, а не прогнозирует поступление.</p>
            </div>
          </footer>
          </div>
        </div>
      </body>
    </html>
  );
}
