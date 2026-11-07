import { ReactNode, useState } from 'react';
import { ChatMessage, Citation, SUBJECT_OPTIONS, SubjectId } from '../../api/chatTypes';
import { Button } from '../ui/Button';
import styles from './ChatMessageView.module.css';

/** A citation the user asked to see, with its number in the answer ([1], [2], ...). */
export interface OpenCitation {
  citation: Citation;
  number: number;
}
/** Opens the citation panel; `trigger` gets focus back when the panel closes. */
export type OpenCitationHandler = (open: OpenCitation, trigger: HTMLElement) => void;

/**
 * A short, readable name for a source file, as students know the books:
 * "STBB_Biology_IX.pdf" -> "Biology IX", "PMDC_MDCAT_Curriculum_2025_Final.pdf" -> "MDCAT syllabus".
 */
export function sourceLabel(file: string): string {
  const name = file.replace(/\.pdf$/i, '');
  const book = name.match(/^STBB_([A-Za-z]+)_(IX|X|XI|XII)$/);
  if (book) return `${book[1]} ${book[2]}`;
  if (/curriculum|syllabus/i.test(name)) return 'MDCAT syllabus';
  const paper = name.match(/MDCAT_(\d{4})_Paper/i);
  if (paper) return `MDCAT ${paper[1]} past paper`;
  return name.replace(/_/g, ' ');
}

/** "Biology XI, page 87": used in labels for screen readers. */
function describeCitation(c: Citation): string {
  return c.page === null ? sourceLabel(c.source) : `${sourceLabel(c.source)}, page ${c.page}`;
}

/** The user's question: navy bubble on the right, with the subject it was asked under above it. */
export function QuestionBubble({ text, subjectId }: { text: string; subjectId: SubjectId | null }) {
  const label = SUBJECT_OPTIONS.find((o) => o.value === subjectId)?.label;
  return (
    <div className={styles.questionWrap}>
      {label && <span className={styles.subjectTag}>{label}</span>}
      <div className={styles.question}>
        <span className="sr-only">You asked: </span>
        {text}
      </div>
    </div>
  );
}

/** The answer and its sources as plain text, for "Copy answer". */
export function answerAsText(message: ChatMessage): string {
  if (message.citations.length === 0) return message.answer;
  const sources = message.citations.map((c, i) => `[${i + 1}] ${describeCitation(c)}`);
  return `${message.answer}\n\nSources:\n${sources.join('\n')}`;
}

/** Copies the answer with its sources; says "Copied" for two seconds. */
function CopyButton({ message }: { message: ChatMessage }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(answerAsText(message));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard blocked (e.g. not https): nothing to do, the text can still be selected by hand
    }
  }
  return (
    <button type="button" className={styles.action} onClick={() => void copy()}>
      {copied ? 'Copied' : 'Copy answer'}
    </button>
  );
}

/**
 * The answer text with each [n] turned into a highlighted, clickable mark.
 * A number with no matching citation stays plain text.
 */
export function AnswerText({ text, citations, onOpen }: { text: string; citations: Citation[]; onOpen: OpenCitationHandler }) {
  const parts: ReactNode[] = text.split(/(\[\d+\])/).map((part, i) => {
    const match = part.match(/^\[(\d+)\]$/);
    const number = match ? Number(match[1]) : 0;
    const citation = citations[number - 1];
    if (!citation) return part;
    return (
      <button
        key={i}
        type="button"
        className={styles.mark}
        aria-label={`Source ${number}: ${describeCitation(citation)}`}
        onClick={(e) => onOpen({ citation, number }, e.currentTarget)}
      >
        [{number}]
      </button>
    );
  });
  return <p className={styles.answerText}>{parts}</p>;
}

/** The sources under an answer: "[n] Source · page X" with the snippet underneath. */
export function CitationList({ citations, onOpen }: { citations: Citation[]; onOpen: OpenCitationHandler }) {
  if (citations.length === 0) return null;
  return (
    <ol className={styles.citations} aria-label="Sources">
      {citations.map((citation, i) => (
        <li key={`${citation.source}-${citation.page}-${i}`}>
          <button
            type="button"
            className={styles.citationRow}
            onClick={(e) => onOpen({ citation, number: i + 1 }, e.currentTarget)}
          >
            <span className={styles.citationTitle}>
              <strong>
                [{i + 1}] {sourceLabel(citation.source)}
              </strong>
              {citation.page !== null && ` · page ${citation.page}`}
            </span>
            <span className={styles.snippet}>“{citation.snippet}”</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

/**
 * One question with its answer: a grounded answer card, or the dashed out-of-scope bubble.
 * `active`: this answer's sources are the ones shown in the page's Sources panel (wide screens).
 */
export function ChatMessageView({
  message,
  onOpenCitation,
  active = false,
}: {
  message: ChatMessage;
  onOpenCitation: OpenCitationHandler;
  active?: boolean;
}) {
  const count = message.citations.length;
  return (
    <div className={styles.exchange}>
      <QuestionBubble text={message.question} subjectId={message.subjectId} />
      {message.refused ? (
        // Out of scope is not an answer: dashed, muted, no "Grounded" line and no sources
        <p className={styles.outOfScope} role="note">
          {message.answer}
        </p>
      ) : (
        <article className={active ? `${styles.answer} ${styles.answerActive}` : styles.answer} aria-label="Answer">
          {count > 0 && (
            <p className={styles.grounded}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                <path d="m9 12 2 2 4-4" />
              </svg>
              Grounded in {count} source{count === 1 ? '' : 's'}
            </p>
          )}
          <AnswerText text={message.answer} citations={message.citations} onOpen={onOpenCitation} />
          {/* On wide screens the page's Sources panel replaces this list (see the CSS) */}
          <div className={styles.inlineSources}>
            <CitationList citations={message.citations} onOpen={onOpenCitation} />
          </div>
          <div className={styles.actions}>
            <CopyButton message={message} />
          </div>
        </article>
      )}
    </div>
  );
}

/** Three animated dots while an answer is on its way (still dots if the user prefers reduced motion). */
export function TypingIndicator() {
  return (
    <div className={styles.typing} role="status">
      <span className="sr-only">Searching the syllabus...</span>
      <span className={styles.dot} aria-hidden="true" />
      <span className={styles.dot} aria-hidden="true" />
      <span className={styles.dot} aria-hidden="true" />
    </div>
  );
}

/** A failed question: a friendly message and a Retry button, shown where the answer would be. */
export function ErrorBubble({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className={styles.errorBubble} role="alert">
      <p className={styles.errorText}>{message}</p>
      <Button variant="outline" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
