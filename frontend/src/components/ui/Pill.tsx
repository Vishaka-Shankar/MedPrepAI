import { ReactNode } from 'react';
import styles from './Pill.module.css';

export type PillVariant = 'default' | 'active' | 'outline';

interface Props {
  children: ReactNode;
  variant?: PillVariant;
  /** If given, the pill is a toggle <button> (aria-pressed shows whether it is selected). */
  onClick?: () => void;
  pressed?: boolean;
}

/**
 * A fully rounded label.
 *  - default: white with a grey border (e.g. "Past paper (2024)")
 *  - active:  navy filled (the selected filter)
 *  - outline: teal border and text (e.g. "Grounded in 2 sources")
 */
export function Pill({ children, variant = 'default', onClick, pressed }: Props) {
  const className = `${styles.pill} ${styles[variant]}`;
  if (onClick) {
    return (
      <button type="button" className={className} aria-pressed={pressed} onClick={onClick}>
        {children}
      </button>
    );
  }
  return <span className={className}>{children}</span>;
}
