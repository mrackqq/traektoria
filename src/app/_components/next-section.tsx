import Link from 'next/link';
import { Icon } from './icon';

/** Presentation-only guidance between the existing product stages. */
export function NextSection({ title, description, href, label }: {
  title: string;
  description: string;
  href: string;
  label: string;
}) {
  return (
    <section className="next-section" aria-label={title}>
      <span className="next-section__icon" aria-hidden="true"><Icon name="arrow" size={22} /></span>
      <div><p className="card__eyebrow">Дальше</p><h2>{title}</h2><p>{description}</p></div>
      <Link className="btn" href={href}>{label}<Icon name="arrow" size={17} /></Link>
    </section>
  );
}
