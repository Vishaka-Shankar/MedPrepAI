import { InputHTMLAttributes, useId } from 'react';
import styles from './TextField.module.css';

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  /** Help text under the input, read out with it by screen readers. */
  hint?: string;
  /** This field's error. It marks the input invalid and is read out with it. */
  error?: string;
}

/**
 * A labelled input. The hint and the error are tied to the input with aria-describedby,
 * so a screen reader says "Current password, invalid, Your password is incorrect".
 */
export function TextField({ label, hint, error, className, ...input }: Props) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : '', error ? errorId : ''].filter(Boolean).join(' ') || undefined;

  return (
    <div className={[styles.field, className].filter(Boolean).join(' ')}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <input
        id={id}
        className={styles.input}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...input}
      />
      {hint && (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
