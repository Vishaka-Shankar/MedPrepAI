import { HTMLAttributes } from 'react';
import styles from './Card.module.css';

interface Props extends HTMLAttributes<HTMLElement> {
  /** "section" when the card has its own heading, otherwise a plain "div" */
  as?: 'div' | 'section';
  /** The teal "Next up" style used for the main call to action */
  tone?: 'default' | 'primary';
}

/** White surface with 16px corners and a soft shadow. */
export function Card({ as: Tag = 'div', tone = 'default', className, ...rest }: Props) {
  return <Tag className={[styles.card, styles[tone], className].filter(Boolean).join(' ')} {...rest} />;
}
