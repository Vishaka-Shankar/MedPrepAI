import { FormEvent, KeyboardEvent, ReactNode, useEffect, useId, useRef } from 'react';
import { Button } from './Button';
import styles from './ConfirmDialog.module.css';

interface Props {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  /** Shown on the confirm button while the action runs, e.g. "Deleting..." */
  busyLabel: string;
  busy: boolean;
  /** The server's answer if the action failed; the dialog stays open so the user can retry. */
  error?: string;
  /** Extra fields, e.g. a password input. */
  children?: ReactNode;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/**
 * A modal "are you sure?" box for destructive actions (red confirm button).
 * Keyboard basics: focus moves into the dialog (first input, else Cancel), Tab stays inside it,
 * Escape cancels, and focus goes back to the button that opened it when it closes.
 */
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  busyLabel,
  busy,
  error,
  children,
  confirmDisabled = false,
  onConfirm,
  onCancel,
}: Props) {
  const titleId = useId();
  const descriptionId = useId();
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const box = boxRef.current;
    (box?.querySelector<HTMLElement>('input') ?? box?.querySelector<HTMLElement>('[data-cancel]'))?.focus();
    return () => opener?.focus(); // back to "Delete account" (or the row's Delete button)
  }, []);

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape' && !busy) {
      e.stopPropagation();
      onCancel();
      return;
    }
    if (e.key !== 'Tab' || !boxRef.current) return;
    // Keep Tab inside the dialog
    const items = [...boxRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!busy && !confirmDisabled) onConfirm();
  }

  return (
    <div className={styles.backdrop}>
      <div
        ref={boxRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onKeyDown={handleKeyDown}
      >
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
        <div id={descriptionId} className={styles.description}>
          {description}
        </div>
        {/* A form, so Enter in the password box confirms */}
        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          {children}
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <div className={styles.actions}>
            <Button variant="outline" onClick={onCancel} disabled={busy} data-cancel>
              Cancel
            </Button>
            <Button type="submit" variant="danger" disabled={busy || confirmDisabled}>
              {busy ? busyLabel : confirmLabel}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
