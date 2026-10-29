import { useCallback, useEffect, useRef, useState } from 'react';
import { chatApi, USE_MOCK } from '../api/chat';
import { ChatMessage, SubjectFilter, SubjectId } from '../api/chatTypes';
import { getErrorMessage, httpStatus, isTimeout } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { ChatComposer, SubjectPills } from '../components/chat/ChatComposer';
import {
  ChatMessageView,
  ErrorBubble,
  OpenCitation,
  OpenCitationHandler,
  QuestionBubble,
  TypingIndicator,
} from '../components/chat/ChatMessageView';
import { CitationPanel } from '../components/chat/CitationPanel';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import styles from './ChatPage.module.css';

export const EXAMPLE_QUESTIONS = [
  'What is the function of the loop of Henle?',
  'What is a limiting reactant?',
  'Why does taking more readings reduce uncertainty?',
];

export const SERVICE_DOWN = "Sorry, I can't reach the answer service right now. Please try again in a moment.";
export const TIMED_OUT = 'Sorry, that took too long to answer. Please try again.';

/** A 503 body like { code: 'AI_NOT_CONFIGURED', message: '...' } -> its message; anything else -> null. */
function codedServiceSentence(err: unknown): string | null {
  const data = (err as { response?: { data?: unknown } } | null)?.response?.data;
  if (typeof data !== 'object' || data === null) return null;
  const { code, message } = data as { code?: unknown; message?: unknown };
  return typeof code === 'string' && typeof message === 'string' && message.trim() ? message : null;
}
const SESSION_EXPIRED = 'Your session has expired. Please log in again.';

type HistoryState = 'loading' | 'ready' | 'error';
interface Question {
  question: string;
  subjectId: SubjectId | null;
}

/** True if the user asked the system to reduce animations (then we scroll without animating). */
function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

export function ChatPage() {
  const { logout } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [historyState, setHistoryState] = useState<HistoryState>('loading');
  const [historyError, setHistoryError] = useState('');
  const [filter, setFilter] = useState<SubjectFilter>('all');
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<Question | null>(null);
  const [failed, setFailed] = useState<(Question & { message: string }) | null>(null);
  const [openCitation, setOpenCitation] = useState<OpenCitation | null>(null);
  const citationTrigger = useRef<HTMLElement | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  /**
   * Turns a failed request into the message the user sees.
   * 401 = the login expired: log out with a notice and the route guard opens the login page.
   */
  const explainError = useCallback(
    (err: unknown): string | null => {
      const status = httpStatus(err);
      if (status === 401) {
        logout(SESSION_EXPIRED);
        return null;
      }
      if (isTimeout(err)) return TIMED_OUT;
      // The backend's chat 503s name the reason (Q&A service down, AI key missing): show that sentence
      if (status === 503) {
        const sentence = codedServiceSentence(err);
        if (sentence) return sentence;
      }
      if (status === null || status === 404 || status >= 500) return SERVICE_DOWN;
      return getErrorMessage(err); // e.g. a validation message from the backend
    },
    [logout],
  );

  const loadHistory = useCallback(async () => {
    setHistoryState('loading');
    try {
      setMessages(await chatApi.history());
      setHistoryState('ready');
    } catch (err) {
      setHistoryError(explainError(err) ?? '');
      setHistoryState('error');
    }
  }, [explainError]);

  // Load the user's previous questions when the page opens
  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  // Keep the newest message in view (`?.`: the test browser has no scrollIntoView)
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }, [messages, pending, failed]);

  async function ask({ question, subjectId }: Question) {
    const text = question.trim();
    if (!text || pending) return;
    setFailed(null);
    setDraft('');
    setPending({ question: text, subjectId });
    try {
      const answered = await chatApi.ask(text, subjectId);
      setMessages((previous) => [...previous, answered]);
    } catch (err) {
      const message = explainError(err);
      if (message) {
        setFailed({ question: text, subjectId, message });
        setDraft(text); // the question stays in the box, ready to edit or resend
      }
    } finally {
      setPending(null);
    }
  }

  const askWithFilter = (question: string) => void ask({ question, subjectId: filter === 'all' ? null : filter });

  const openPanel: OpenCitationHandler = (open, trigger) => {
    citationTrigger.current = trigger;
    setOpenCitation(open);
  };

  const closePanel = useCallback(() => {
    setOpenCitation(null);
    citationTrigger.current?.focus(); // back to the mark or row that opened it
  }, []);

  const showEmptyState = historyState === 'ready' && messages.length === 0 && !pending && !failed;

  return (
    <section className={styles.chat} aria-labelledby="chat-title">
      <header className={styles.header}>
        <div>
          <h1 id="chat-title" className={styles.title}>
            Ask the syllabus
          </h1>
          <p className={styles.subtitle}>
            Answers come only from your MDCAT material.
            {USE_MOCK && <span className={styles.devTag}>Dev: mock API</span>}
          </p>
        </div>
        <SubjectPills value={filter} onChange={setFilter} />
      </header>

      <div className={styles.log} role="log" aria-label="Conversation">
        {historyState === 'loading' && (
          <p className={styles.muted} role="status">
            Loading your previous questions...
          </p>
        )}

        {historyState === 'error' && (
          <div className={styles.historyError} role="alert">
            <span>{historyError}</span>
            <Button variant="outline" onClick={() => void loadHistory()}>
              Try again
            </Button>
          </div>
        )}

        {showEmptyState && (
          <EmptyState title="Ask your first question" description="Every answer shows the book and page it came from. Try one of these:">
            <ul className={styles.examples} aria-label="Example questions">
              {EXAMPLE_QUESTIONS.map((q) => (
                <li key={q}>
                  <button type="button" className={styles.example} onClick={() => askWithFilter(q)}>
                    {q}
                  </button>
                </li>
              ))}
            </ul>
          </EmptyState>
        )}

        {messages.map((m) => (
          <ChatMessageView key={m.id} message={m} onOpenCitation={openPanel} />
        ))}

        {pending && (
          <div className={styles.exchange}>
            <QuestionBubble text={pending.question} subjectId={pending.subjectId} />
            <TypingIndicator />
          </div>
        )}

        {failed && (
          <div className={styles.exchange}>
            <QuestionBubble text={failed.question} subjectId={failed.subjectId} />
            <ErrorBubble message={failed.message} onRetry={() => void ask(failed)} />
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Pinned to the bottom of the screen while the conversation scrolls under it */}
      <div className={styles.footer}>
        <ChatComposer draft={draft} disabled={pending !== null} onDraftChange={setDraft} onSend={() => askWithFilter(draft)} />
      </div>

      <CitationPanel open={openCitation} onClose={closePanel} />
    </section>
  );
}
