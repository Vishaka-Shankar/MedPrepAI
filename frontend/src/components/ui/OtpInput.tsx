import { ClipboardEvent, KeyboardEvent, useRef } from 'react';
import styles from './OtpInput.module.css';

/** An empty code: one '' per box. */
export const emptyCode = (length = 6): string[] => Array.from({ length }, () => '');

/**
 * Writes the digits found in `text` into the boxes, starting at box `start` (anything else is ignored).
 * Returns the new boxes and which box should get the focus next.
 */
export function fillDigits(boxes: string[], start: number, text: string): { boxes: string[]; focus: number } {
  const digits = text.replace(/\D/g, '').slice(0, boxes.length - start).split('');
  const next = [...boxes];
  digits.forEach((d, i) => (next[start + i] = d));
  return { boxes: next, focus: Math.min(start + digits.length, boxes.length - 1) };
}

interface Props {
  /** One string per box: a single digit, or '' when empty. */
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
  /** Marks every box as invalid (red border) for screen readers and sighted users. */
  invalid?: boolean;
}

/**
 * Six one-digit boxes for an emailed code.
 * Typing moves to the next box, Backspace on an empty box goes back, and pasting
 * "123456" (or "123 456") fills all the boxes at once.
 */
export function OtpInput({ value, onChange, disabled = false, invalid = false }: Props) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const focusBox = (i: number) => refs.current[i]?.focus();

  function handleChange(i: number, typed: string) {
    // The box's old digit is selected on focus, so the new character replaces it.
    // If the browser still sends "old+new", keep only the new part.
    const old = value[i];
    const text = old && typed.startsWith(old) ? typed.slice(old.length) : typed;
    if (!text.replace(/\D/g, '')) {
      if (typed === '') onChange(value.map((d, j) => (j === i ? '' : d)));
      return; // ignore letters and symbols
    }
    // Usually one digit; the phone's "one-time code" autofill can drop all six into the first box
    const { boxes, focus } = fillDigits(value, i, text);
    onChange(boxes);
    focusBox(focus);
  }

  function handleKeyDown(i: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (value[i]) {
        onChange(value.map((d, j) => (j === i ? '' : d))); // clear this box, stay here
      } else if (i > 0) {
        onChange(value.map((d, j) => (j === i - 1 ? '' : d))); // empty box: clear the one before and go back
        focusBox(i - 1);
      }
    } else if (e.key === 'ArrowLeft' && i > 0) {
      e.preventDefault();
      focusBox(i - 1);
    } else if (e.key === 'ArrowRight' && i < value.length - 1) {
      e.preventDefault();
      focusBox(i + 1);
    }
  }

  function handlePaste(i: number, e: ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    const text = e.clipboardData.getData('text');
    const digitCount = text.replace(/\D/g, '').length;
    // A whole code always starts at the first box, wherever the cursor was
    const { boxes, focus } = fillDigits(value, digitCount >= value.length ? 0 : i, text);
    onChange(boxes);
    focusBox(focus);
  }

  return (
    <div className={styles.row} role="group" aria-label="Verification code">
      {value.map((digit, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          className={styles.box}
          value={digit}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={(e) => handlePaste(i, e)}
          onFocus={(e) => e.target.select()}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          aria-label={`Digit ${i + 1} of ${value.length}`}
          aria-invalid={invalid || undefined}
          disabled={disabled}
          autoFocus={i === 0}
        />
      ))}
    </div>
  );
}
