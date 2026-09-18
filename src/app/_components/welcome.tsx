import Link from 'next/link';
import { Icon } from './icon';

export function Welcome() {
  return (
    <section className="hero" aria-labelledby="welcome-heading">
      <div className="hero__copy">
        <span className="hero__label"><Icon name="spark" size={15} /> ВАШ ПУТЬ, ВАШ ТЕМП</span>
        <h2 id="welcome-heading">Большая цель.<br />Понятные шаги.</h2>
        <p>От выбора программы до подачи документов. Расскажите о себе — и узнайте, что уже готово и что нужно сделать дальше.</p>
        <div className="actions">
          <Link href="/profile/edit" className="btn">Настроить мой профиль <Icon name="arrow" size={16} /></Link>
          <Link href="/programs" className="btn btn--ghost">Смотреть программы <Icon name="chevron" size={13} /></Link>
        </div>
      </div>
      <div className="hero__art" aria-hidden="true">
        <svg viewBox="0 0 360 230" fill="none" focusable="false">
          <circle cx="219" cy="118" r="92" stroke="#dce6c9" strokeWidth="1" /><circle cx="219" cy="118" r="64" stroke="#dce6c9" strokeWidth="1" />
          <path d="M57 185h46c35 0 38-57 73-57h27c39 0 36-66 75-66h29" stroke="#7d9a64" strokeWidth="2.5" strokeDasharray="5 6" />
          <g transform="translate(25 143) rotate(-5)"><rect width="135" height="56" rx="12" fill="white" stroke="#d7e2c7" /><rect x="12" y="12" width="32" height="32" rx="9" fill="#eef4e6" /><path d="m21 29 5 5 10-12" stroke="#507343" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><text x="54" y="25" fill="#46613d" fontSize="10" fontFamily="Segoe UI, sans-serif" fontWeight="600">Ваш профиль</text><text x="54" y="40" fill="#8a977c" fontSize="8" fontFamily="Segoe UI, sans-serif">Точка старта</text></g>
          <g transform="translate(128 91) rotate(3)"><rect width="147" height="56" rx="12" fill="white" stroke="#d7e2c7" /><rect x="12" y="12" width="32" height="32" rx="9" fill="#eef4e6" /><path d="m18 26 10-5 10 5-10 5-10-5Zm4 3v6c4 2 8 2 12 0v-6" stroke="#507343" strokeWidth="1.5" strokeLinejoin="round" /><text x="54" y="25" fill="#46613d" fontSize="10" fontFamily="Segoe UI, sans-serif" fontWeight="600">Ваша программа</text><text x="54" y="40" fill="#8a977c" fontSize="8" fontFamily="Segoe UI, sans-serif">Осознанный выбор</text></g>
          <g transform="translate(236 23) rotate(-6)"><rect width="105" height="56" rx="12" fill="#315d43" /><circle cx="28" cy="28" r="15" stroke="#a7c987" strokeWidth="1.5" /><circle cx="28" cy="28" r="8" stroke="#a7c987" strokeWidth="1.5" /><circle cx="28" cy="28" r="2" fill="#d4eba7" /><text x="52" y="26" fill="#e6f1d9" fontSize="10" fontFamily="Segoe UI, sans-serif" fontWeight="600">Ваша цель</text><text x="52" y="39" fill="#b4cca4" fontSize="8" fontFamily="Segoe UI, sans-serif">Всё ближе</text></g>
          <path d="m74 55 3 8 8 3-8 3-3 8-3-8-8-3 8-3 3-8Z" fill="#a1b987" /><path d="m319 161 2 5 5 2-5 2-2 5-2-5-5-2 5-2 2-5Z" fill="#a1b987" /><circle cx="172" cy="40" r="3" fill="#c0d0a6" /><circle cx="269" cy="196" r="4" fill="#c0d0a6" />
        </svg>
      </div>
    </section>
  );
}
