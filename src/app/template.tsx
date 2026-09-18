import type { ReactNode } from 'react';

/** Next remounts this presentation wrapper on route navigation, not on form updates. */
export default function PageTemplate({ children }: { children: ReactNode }) {
  return <div className="page-transition">{children}</div>;
}
