import { useEffect, useRef } from 'react';
import { OpenCitation, sourceLabel } from './ChatMessageView';
import styles from './CitationPanel.module.css';

interface Props {
  open: OpenCitation | null;
  onClose: () => void;
}

/**
 * Shows one source in full: a side panel on desktop, a bottom sheet on phones (see the CSS).
 * Keyboard: focus moves to Close when it opens, Escape closes it.
 * (The page gives focus back to the mark or row that opened it.)
 */
export function CitationPanel({ open, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  const { citation, number } = open;

  return (
    <>
      {/* Phones: tap outside the sheet to close it (hidden on desktop) */}
      <div className={styles.backdrop} onClick={onClose} aria-hidden="true" />
      <aside className={styles.panel} role="dialog" aria-modal="false" aria-labelledby="citation-panel-title">
        <div className={styles.head}>
          <p className={styles.eyebrow}>Source [{number}]</p>
          <button ref={closeRef} type="button" className={styles.close} onClick={onClose} aria-label="Close source">
            ×
          </button>
        </div>
        <h2 id="citation-panel-title" className={styles.title}>
          {sourceLabel(citation.source)}
        </h2>
        <p className={styles.meta}>
          {citation.page !== null ? `Page ${citation.page}` : 'Page not known'}
          <span className={styles.file}>{citation.source}</span>
        </p>
        <blockquote className={styles.snippet}>“{citation.snippet}”</blockquote>
      </aside>
    </>
  );
}
