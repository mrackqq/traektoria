'use client';

/**
 * Переход по шагам анкеты через сохранение.
 *
 * Верхние вкладки — это навигация по анкете, и обещание под формой звучит как
 * «ответы сохраняются при каждом переходе». Раньше вкладки были обычными
 * ссылками: они меняли `?step=…` мимо формы, и набранное на текущем шаге
 * молча пропадало. Кнопки «Назад» и «Сохранить и продолжить» при этом
 * сохраняли — поведение зависело от того, чем пользователь перешёл.
 *
 * Вкладки стоят в шапке, а форма — отдельный узел ниже, поэтому связь между
 * ними идёт через контекст: форма шага регистрирует здесь «сохрани и уйди»,
 * вкладка вызывает его вместо собственного перехода. Ничего не найдено
 * (страница «Проверка», где формы нет) — вкладка работает обычной ссылкой.
 *
 * Черновик при этом остаётся черновиком: сохраняется шаг анкеты, а не профиль.
 */

import Link from 'next/link';
import {
  createContext,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export interface StepNav {
  /** Идёт сохранение: повторные переходы игнорируются. */
  readonly pending: boolean;
  /** Есть ли на странице форма шага, которая умеет сохранять. */
  hasForm(): boolean;
  /** Сохранить текущий шаг и уйти по адресу. */
  navigate(href: string): void;
  /** Форма шага объявляет себя (и снимает объявление при размонтировании). */
  register(handler: ((href: string) => void) | null): void;
  setPending(value: boolean): void;
}

const Ctx = createContext<StepNav | null>(null);

export function useStepNav(): StepNav | null {
  return useContext(Ctx);
}

export function StepNavProvider({ children }: { children: ReactNode }) {
  const handler = useRef<((href: string) => void) | null>(null);
  const [pending, setPending] = useState(false);

  const value = useMemo<StepNav>(
    () => ({
      pending,
      hasForm: () => handler.current !== null,
      navigate: (href) => handler.current?.(href),
      register: (h) => {
        handler.current = h;
      },
      setPending,
    }),
    [pending],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function StepTabs({
  steps,
  currentId,
  isReview,
}: {
  readonly steps: readonly { readonly id: string; readonly title: string }[];
  readonly currentId: string;
  readonly isReview: boolean;
}) {
  return (
    <ol className="questionnaire-steps" aria-label="Шаги анкеты">
      {steps.map((s, i) => (
        <li key={s.id}>
          <StepTab
            href={`/profile/edit?step=${s.id}`}
            current={!isReview && s.id === currentId}
            glyph={String(i + 1)}
            label={s.title}
          />
        </li>
      ))}
      <li>
        <StepTab href="/profile/edit?step=review" current={isReview} glyph="✓" label="Проверка" />
      </li>
    </ol>
  );
}

function StepTab({
  href,
  current,
  glyph,
  label,
}: {
  href: string;
  current: boolean;
  glyph: string;
  label: string;
}) {
  const nav = useStepNav();

  return (
    <Link
      className={`badge ${current ? 'badge--ok' : 'badge--neutral'}`}
      href={href}
      {...(current ? { 'aria-current': 'step' as const } : {})}
      {...(nav?.pending ? { 'aria-disabled': true } : {})}
      onClick={(e) => {
        // Формы нет — уходить нечему, обычная ссылка.
        if (!nav || !nav.hasForm()) return;
        e.preventDefault();
        // Второе нажатие во время сохранения ничего не даёт: переход
        // произойдёт сам, когда сервер ответит.
        if (nav.pending) return;
        nav.navigate(href);
      }}
    >
      <span className="badge__glyph" aria-hidden="true">
        {glyph}
      </span>
      {label}
    </Link>
  );
}
