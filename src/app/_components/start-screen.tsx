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

export function StartScreen({ mode }: { mode: 'own' | 'demo' }) {
  return (
    <section className="card stack" aria-labelledby="start-heading">
      <p className="card__eyebrow">С чего начать</p>
      <h2 id="start-heading">Пока мы ничего о вас не знаем</h2>
      <p className="lede">
        Рекомендации и план строятся по вашим ответам. Без анкеты показывать
        персональную цель нечестно — поэтому здесь пусто, а не чужой пример.
      </p>

      <ul className="stack-tight small">
        <li>Короткая анкета: класс, оценки, предметы, экзамены, страны, бюджет и сроки.</li>
        <li>Диагностика: сильные стороны, ограничения и с чего начинать.</li>
        <li>Программы с объяснением «почему подходит» и сравнение вариантов.</li>
        <li>План к выбранной цели: экзамены, документы, сроки и ближайший шаг.</li>
      </ul>

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

      <p className="small muted">
        Демо — отдельный профиль с синтетическими ответами. Ваши собственные ответы он
        не трогает, и вернуться к ним можно в любой момент.
      </p>
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
    <nav className="card stack-tight" aria-label="Следующие шаги">
      <p className="card__eyebrow">Что дальше</p>
      <ol className="stack-tight small">
        {steps.map((s, i) => (
          <li key={s.href}>
            <Link href={s.href}>
              {i + 1}. {s.label}
            </Link>{' '}
            <span className="muted">— {s.detail}</span>
          </li>
        ))}
      </ol>
    </nav>
  );
}
