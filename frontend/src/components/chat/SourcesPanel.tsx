import { ChatMessage } from '../../api/chatTypes';
import { OpenCitationHandler, sourceLabel } from './ChatMessageView';
import styles from './SourcesPanel.module.css';

interface Props {
  /** The answer whose sources are shown, or null when there is no cited answer yet. */
  message: ChatMessage | null;
  /** The [n] the student last clicked in that answer: highlighted here. */
  highlighted: number | null;
  onOpen: OpenCitationHandler;
}

/**
 * Wide screens only (1100px and up, see the CSS): the sources of one answer, next to the conversation.
 * Clicking a [n] mark in an answer selects that answer and highlights the source here;
 * clicking a source opens the citation panel with the file name and the full snippet.
 */
export function SourcesPanel({ message, highlighted, onOpen }: Props) {
  return (
    <aside className={styles.panel} aria-label="Sources of the selected answer">
      <h2 className={styles.title}>Sources</h2>
      {!message ? (
        <p className={styles.empty}>The book and page of every answer will show here.</p>
      ) : (
        <>
          <p className={styles.forQuestion}>
            For: <span>{message.question}</span>
          </p>
          <ol className={styles.list}>
            {message.citations.map((citation, i) => {
              const number = i + 1;
              return (
                <li key={`${citation.source}-${citation.page}-${i}`}>
                  <button
                    type="button"
                    className={number === highlighted ? `${styles.source} ${styles.highlighted}` : styles.source}
                    aria-current={number === highlighted ? 'true' : undefined}
                    onClick={(e) => onOpen({ citation, number }, e.currentTarget)}
                  >
                    <span className={styles.head}>
                      <span className={styles.number}>{number}</span>
                      <span className={styles.book}>{sourceLabel(citation.source)}</span>
                      {citation.page !== null && <span className={styles.page}>page {citation.page}</span>}
                    </span>
                    <span className={styles.snippet}>“{citation.snippet}”</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </aside>
  );
}
