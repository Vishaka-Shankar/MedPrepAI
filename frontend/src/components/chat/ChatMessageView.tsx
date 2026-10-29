import { ReactNode } from 'react';
import { ChatMessage, Citation, SUBJECT_OPTIONS, SubjectId } from '../../api/chatTypes';
import { Button } from '../ui/Button';
import { Pill } from '../ui/Pill';
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
 * "STBB_Biology_XI.pdf" -> "Biology XI", "PMDC_MDCAT_Curriculum_2025_Final.pdf" -> "MDCAT syllabus".
 */
export function sourceLabel(file: string): string {
  const name = file.replace(/\.pdf$/i, '');
  const book = name.match(/^STBB_([A-Za-z]+)_(XI|XII)$/);
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

/** The user's question: navy bubble on the right. */
export function QuestionBubble({ text, subjectId }: { text: string; subjectId: SubjectId | null }) {
  const label = SUBJECT_OPTIONS.find((o) => o.value === subjectId)?.label;
  return (
    <div className={styles.question}>
      <span className="sr-only">You asked: </span>
      {text}
      {label && <span className={styles.subjectTag}>{label}</span>}
    </div>
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

/** One question with its answer: a grounded answer card, or the dashed out-of-scope bubble. */
export function ChatMessageView({ message, onOpenCitation }: { message: ChatMessage; onOpenCitation: OpenCitationHandler }) {
  const count = message.citations.length;
  return (
    <div className={styles.exchange}>
      <QuestionBubble text={message.question} subjectId={message.subjectId} />
      {message.refused ? (
        // Out of scope is not an answer: dashed, muted, no "Grounded" pill and no sources
        <p className={styles.outOfScope} role="note">
          {message.answer}
        </p>
      ) : (
        <article className={styles.answer} aria-label="Answer">
          {count > 0 && (
            <div className={styles.badge}>
              <Pill variant="outline">
                Grounded in {count} source{count === 1 ? '' : 's'}
              </Pill>
            </div>
          )}
          <AnswerText text={message.answer} citations={message.citations} onOpen={onOpenCitation} />
          <CitationList citations={message.citations} onOpen={onOpenCitation} />
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
