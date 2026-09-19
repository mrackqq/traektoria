/**
 * Первый экран нового посетителя.
 *
 * Пока анкета не заполнена, персональной цели и готового маршрута быть не
 * может: раньше новичок с пустым профилем сразу видел активную программу и
 * подготовку к ЕНТ — результат, к которому он не имел отношения.
 *
 * Здесь два действия и ничего больше: собрать свой маршрут или посмотреть
 * демонстрационный профиль. Это разные пространства данных, и переключение
 * идёт через серверное действие, а не подменой содержимого.
 */

import Link from 'next/link';

import { switchModeAction } from '../_actions/questionnaire';
import { Icon } from './icon';

export interface StartScreenProps {
  readonly mode: 'own' | 'demo';
  /** Фраза охвата каталога, посчитанная из самого каталога. */
  readonly scope: string;
  /** Короткие имена вузов — человек ищет глазами свой. */
  readonly universities: readonly string[];
}

export function StartScreen({ mode, scope, universities }: StartScreenProps) {
  return (
    <section className="start-panel" aria-labelledby="start-heading">
      <div className="start-panel__copy">
      <p className="card__eyebrow"><Icon name="spark" size={16} /> Ваш первый шаг</p>
      <h2 id="start-heading">Начните с анкеты</h2>
      <p className="lede">
        Ваши интересы, оценки и бюджет — основа подбора программ и плана подготовки.
      </p>
      {/*
        Цена названа числом намеренно. «Короткая анкета» — обещание, которое
        продукт не держит: разделов пять, а вопросов про экзамены много.
        Нарушенное на втором экране обещание стоит дороже, чем его отсутствие.
        Счёт совпадает с тем, что человек увидит в самой анкете: пять шагов
        с вопросами и шестой — проверка перед применением.
      */}
      <p className="start-panel__cost">
        <Icon name="check" size={16} /> Пять разделов вопросов и проверка в конце.
        Отвечать всё сразу не нужно — ответы сохраняются на каждом шаге.
      </p>
      <div className="actions">
        <Link className="btn" href="/profile/edit">
          Создать мой маршрут <Icon name="arrow" size={16} />
        </Link>

        {mode === 'demo' ? (
          <form action={switchModeAction}>
            <input type="hidden" name="mode" value="own" />
            <button type="submit" className="btn btn--secondary">
              Вернуться к своему профилю
            </button>
          </form>
        ) : (
          <form action={switchModeAction}>
            <input type="hidden" name="mode" value="demo" />
            <button type="submit" className="btn btn--secondary">
              Посмотреть демо
            </button>
          </form>
        )}
      </div>
      <p className="start-panel__note"><Icon name="shield" size={16} /> Без загрузки документов. Можно отвечать «не знаю».</p>
      <p className="small muted start-panel__demo-note">
        Хотите сначала посмотреть результат? Демо откроет отдельный пример,
        не меняя ваши ответы.
      </p>
      </div>
      <div className="start-preview" aria-label="Что вы получите после анкеты">
        <p className="card__eyebrow">На выходе — не просто список вузов</p>
        <ol>
          <li><span className="start-preview__icon"><Icon name="programs" size={22} /></span><div><h3>Программы под ваши условия</h3><p>С причинами выбора и тем, что нужно уточнить.</p></div><span className="start-preview__number">01</span></li>
          <li><span className="start-preview__icon"><Icon name="goals" size={22} /></span><div><h3>Понятный выбор</h3><p>Сравните варианты по бюджету, языку и срокам.</p></div><span className="start-preview__number">02</span></li>
          <li><span className="start-preview__icon"><Icon name="route" size={22} /></span><div><h3>План к выбранной программе</h3><p>Экзамены, документы и один ближайший шаг.</p></div><span className="start-preview__number">03</span></li>
        </ol>
        <div className="start-preview__foot"><Icon name="check" size={17} /> Вы меняете ответы — подбор меняется вместе с ними.</div>
      </div>
      {/*
        Охват назван до анкеты, а не после.
        Человек соглашается отвечать на пять разделов, ещё не увидев ни одной
        программы. Раньше решение «стоит ли оно того» он принимал вслепую:
        сервис мог охватывать шесть вузов или шестьсот, узнать это было
        неоткуда. Список вузов отвечает на это за секунду — и честно, включая
        случай «моего вуза здесь нет».
      */}
      <div className="start-scope">
        <p className="card__eyebrow">Что уже в подборе</p>
        <p className="start-scope__count">{scope}</p>
        <ul className="start-scope__list">
          {universities.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
        <p className="small muted">
          Другие вузы пока не разобраны. Условия и сроки взяты из официальных
          документов, стоимость и пороговые баллы помечены как непроверенные.
        </p>
      </div>
    </section>
  );
}

/** Куда идти дальше после применения анкеты. */
export function NextSteps() {
  const steps = [
    { href: '/profile', label: 'Диагностика', detail: 'что мы поняли о вас' },
    { href: '/programs', label: 'Рекомендации', detail: 'программы с объяснением' },
    { href: '/compare', label: 'Сравнение', detail: 'два варианта рядом' },
    { href: '/goals', label: 'Выбор цели', detail: 'закрепить программу' },
    { href: '/route', label: 'Маршрут', detail: 'план и ближайший шаг' },
  ];

  return (
    <nav className="next-stages" aria-label="Следующие шаги">
      <p className="card__eyebrow">Что дальше</p>
      <ol className="stack-tight small">
        {steps.map((s, i) => (
          <li key={s.href}>
            <span className="next-stages__number" aria-hidden="true">{i + 1}</span>
            <Link href={s.href}>{s.label}<span>{s.detail}</span></Link>
          </li>
        ))}
      </ol>
    </nav>
  );
}
