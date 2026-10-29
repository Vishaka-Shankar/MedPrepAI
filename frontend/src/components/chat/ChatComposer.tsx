import { FormEvent, KeyboardEvent, useLayoutEffect, useRef } from 'react';
import { SUBJECT_OPTIONS, SubjectFilter } from '../../api/chatTypes';
import { Button } from '../ui/Button';
import { Pill } from '../ui/Pill';
import styles from './ChatComposer.module.css';

export const MAX_QUESTION_LENGTH = 2000; // same limit as chat_messages.question in the backend
const MAX_INPUT_HEIGHT = 160; // px; longer questions scroll inside the box

/** The subject filter as pills: All / Biology / Chemistry / Physics. */
export function SubjectPills({ value, onChange }: { value: SubjectFilter; onChange: (s: SubjectFilter) => void }) {
  return (
    <div className={styles.pills} role="group" aria-label="Subject">
      {SUBJECT_OPTIONS.map((o) => (
        <Pill
          key={o.value}
          variant={value === o.value ? 'active' : 'default'}
          pressed={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </Pill>
      ))}
    </div>
  );
}

interface Props {
  draft: string;
  disabled: boolean;
  onDraftChange: (text: string) => void;
  onSend: () => void;
}

/** The input bar at the bottom: question box and Send button. */
export function ChatComposer({ draft, disabled, onDraftChange, onSend }: Props) {
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Grow the box with the text (Shift+Enter lines), up to MAX_INPUT_HEIGHT
  useLayoutEffect(() => {
    const box = inputRef.current;
    if (!box) return;
    box.style.height = 'auto';
    box.style.height = `${Math.min(box.scrollHeight, MAX_INPUT_HEIGHT)}px`;
  }, [draft]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSend();
  }

  // Enter sends; Shift+Enter makes a new line. (isComposing: don't send while typing with an IME)
  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      onSend();
    }
  }

  return (
    <form className={styles.composer} onSubmit={handleSubmit}>
      <label htmlFor="chat-question" className={styles.label}>
        Your question
      </label>
      <div className={styles.row}>
        <textarea
          id="chat-question"
          ref={inputRef}
          className={styles.input}
          rows={1}
          value={draft}
          maxLength={MAX_QUESTION_LENGTH}
          placeholder="Ask about any Biology, Chemistry or Physics topic"
          aria-describedby="composer-hint"
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <Button type="submit" disabled={disabled || !draft.trim()}>
          Send
        </Button>
      </div>
      <span id="composer-hint" className="sr-only">
        Press Enter to send, Shift+Enter for a new line.
      </span>
    </form>
  );
}
