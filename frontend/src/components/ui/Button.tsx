import { ButtonHTMLAttributes } from 'react';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'outline' | 'danger';

/** Class names for a button look, also usable on a <Link> that should look like a button. */
export function buttonClass(variant: ButtonVariant = 'primary', block = false): string {
  return [styles.button, styles[variant], block ? styles.block : ''].filter(Boolean).join(' ');
}

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Full width of its container */
  block?: boolean;
}

/** A real <button>: teal "primary", teal-bordered "outline", or red "danger" (destructive actions). Defaults to type="button". */
export function Button({ variant = 'primary', block = false, className, type = 'button', ...rest }: Props) {
  return <button type={type} className={[buttonClass(variant, block), className].filter(Boolean).join(' ')} {...rest} />;
}
