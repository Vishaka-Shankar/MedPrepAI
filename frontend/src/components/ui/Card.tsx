import { HTMLAttributes } from 'react';
import styles from './Card.module.css';

interface Props extends HTMLAttributes<HTMLElement> {
  /** "section" when the card has its own heading, otherwise a plain "div" */
  as?: 'div' | 'section';
  /** The navy "Next up" style used for the main call to action */
  tone?: 'default' | 'primary';
}

/** White surface with 14px corners and a thin border. */
export function Card({ as: Tag = 'div', tone = 'default', className, ...rest }: Props) {
  return <Tag className={[styles.card, styles[tone], className].filter(Boolean).join(' ')} {...rest} />;
}
