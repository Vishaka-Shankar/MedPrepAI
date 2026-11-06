import { useCallback, useEffect, useState } from 'react';
import { QUIZ_IS_SAMPLE, useQuizData } from '../hooks/useQuizData';
import { QuizData } from '../types/quiz';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { ProgressSegments } from '../components/ui/ProgressSegments';
import styles from './QuizPage.module.css';

const LETTERS = ['A', 'B', 'C', 'D'];

export function formatTime(seconds: number): string {
  const s = Math.max(0, seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** What an option shows after answering. The words matter: colour is never the only signal. */
function optionState(index: number, chosen: number | undefined, correct: number) {
  if (chosen === undefined) return { tone: '', note: '' };
  if (index === correct) return { tone: styles.correct, note: index === chosen ? 'Correct answer (your answer)' : 'Correct answer' };
  if (index === chosen) return { tone: styles.incorrect, note: 'Your answer (incorrect)' };
  return { tone: '', note: '' };
}

/** Quiz page: loads its data through useQuizData (mock today, API later). */
export function QuizPage() {
  const { data, loading, error, reload } = useQuizData();
  if (loading) return <p className={styles.status}>Loading the quiz...</p>;
  if (error || !data) {
    return (
      <Card className={styles.result}>
        <EmptyState title="Couldn't load the quiz" description={error ?? undefined}>
          <Button onClick={reload}>Try again</Button>
        </EmptyState>
      </Card>
    );
  }
  return <QuizRunner quiz={data} />;
}

function QuizRunner({ quiz }: { quiz: QuizData }) {
  const { questions } = quiz;
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [secondsLeft, setSecondsLeft] = useState(quiz.timeRemainingSeconds);
  const [finished, setFinished] = useState(false);
  // Questions skipped with "Skip" (and not answered since). They stay open: you can come back to them.
  const [skipped, setSkipped] = useState<Record<string, true>>({});
  // The furthest question reached: the navigator lets you jump to any question up to here
  const [furthest, setFurthest] = useState(0);

  const question = questions[index];
  const answeredCount = Object.keys(answers).length;
  const correctCount = questions.filter((q) => answers[q.id] === q.answerKey).length;
  const skippedCount = questions.filter((q) => skipped[q.id] && answers[q.id] === undefined).length;
  const chosen = answers[question.id];
  const answered = chosen !== undefined;
  const isLast = index === questions.length - 1;

  // Display-only countdown
  useEffect(() => {
    if (finished) return;
    const timer = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [finished]);

  const choose = useCallback(
    (option: number) => setAnswers((previous) => (question.id in previous ? previous : { ...previous, [question.id]: option })),
    [question.id],
  );

  const goTo = useCallback((i: number) => {
    setIndex(i);
    setFurthest((f) => Math.max(f, i));
  }, []);

  const goNext = useCallback(() => {
    if (!answered) return;
    if (isLast) setFinished(true);
    else goTo(index + 1);
  }, [answered, isLast, goTo, index]);

  /** Skip: leave this question unanswered (no attempt is recorded) and go on; the last one opens the results. */
  const skip = useCallback(() => {
    if (answered) return;
    setSkipped((previous) => ({ ...previous, [question.id]: true }));
    if (isLast) setFinished(true);
    else goTo(index + 1);
  }, [answered, isLast, goTo, index, question.id]);

  // Keyboard: A-D choose an answer, S skips, Enter goes to the next question
  useEffect(() => {
    if (finished) return;
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const letter = LETTERS.indexOf(e.key.toUpperCase());
      if (letter >= 0 && letter < question.options.length && !answered) {
        e.preventDefault();
        choose(letter);
        return;
      }
      if (e.key.toUpperCase() === 'S' && !answered) {
        e.preventDefault();
        skip();
        return;
      }
      // On a focused button or link, Enter already "clicks" it; handling it here too would skip a question
      const onControl = (e.target as HTMLElement | null)?.closest('button, a, input, textarea, select');
      if (e.key === 'Enter' && answered && !onControl) {
        e.preventDefault();
        goNext();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [finished, answered, question.options.length, choose, goNext, skip]);

  if (finished) {
    const firstOpen = questions.findIndex((q) => answers[q.id] === undefined);
    const open = questions.length - answeredCount; // skipped and never answered
    return (
      <Card as="section" className={styles.result} aria-label="Quiz result">
        <EmptyState
          title={`You scored ${correctCount} of ${questions.length}`}
          description={`${open > 0 ? `${open} skipped. ` : ''}Your real results will update your dashboard.`}
        >
          {open > 0 && (
            <Button
              onClick={() => {
                setFinished(false);
                setIndex(firstOpen);
              }}
            >
              Answer skipped questions
            </Button>
          )}
          <Button
            variant={open > 0 ? 'outline' : 'primary'}
            onClick={() => {
              setAnswers({});
              setSkipped({});
              setIndex(0);
              setFurthest(0);
              setSecondsLeft(quiz.timeRemainingSeconds);
              setFinished(false);
            }}
          >
            Try again
          </Button>
        </EmptyState>
      </Card>
    );
  }

  return (
    <section className={styles.quiz} aria-labelledby="quiz-question">
      <header className={styles.bar}>
        <div className={styles.barText}>
          <p className={styles.context}>
            {quiz.topic} · {quiz.origin}
            {QUIZ_IS_SAMPLE && <span className={styles.sample}>Sample data</span>}
          </p>
          <p className={styles.counter}>
            Question {index + 1} of {questions.length}
          </p>
        </div>
        <span className={styles.timer} role="timer" aria-label={`Time left ${formatTime(secondsLeft)}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="13" r="8" />
            <path d="M12 9v4l2 2" />
            <path d="M9 2h6" />
          </svg>
          {formatTime(secondsLeft)}
        </span>
        <div className={styles.progress}>
          <ProgressSegments total={questions.length} current={index + 1} label="Quiz progress" />
        </div>
      </header>

      <div className={styles.columns}>
        <div className={styles.main}>
          <h1 id="quiz-question" className={styles.stem}>
            {question.stem}
          </h1>

          <ul className={styles.options} aria-label="Answer options">
            {question.options.map((option, i) => {
              const { tone, note } = optionState(i, chosen, question.answerKey);
              return (
                <li key={option}>
                  <button
                    type="button"
                    className={`${styles.option} ${tone}`}
                    disabled={answered}
                    aria-pressed={chosen === i}
                    onClick={() => choose(i)}
                  >
                    <span className={styles.letter}>{LETTERS[i]}</span>
                    <span className={styles.optionText}>{option}</span>
                    {note && <span className={styles.note}>{note}</span>}
                  </button>
                </li>
              );
            })}
          </ul>

          {answered && (
            <Card as="section" className={styles.why} aria-labelledby="why-title">
              <div className={styles.whyMain}>
                <h2 id="why-title" className={styles.whyTitle}>
                  Why {LETTERS[question.answerKey]} is correct
                </h2>
                <p className={styles.whyText}>{question.explanation}</p>
                <span className={styles.source}>{question.source}</span>
              </div>
              <div className={styles.video}>
                <p className={styles.videoLabel}>Watch to revise</p>
                <a className={styles.videoTitle} href={question.video.url} target="_blank" rel="noreferrer">
                  {question.video.title}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
                <p className={styles.videoMeta}>
                  {question.video.channel} · {question.video.duration}
                </p>
              </div>
            </Card>
          )}

          <div className={styles.footer}>
            <Button variant="outline" disabled={index === 0} onClick={() => setIndex((i) => i - 1)}>
              Previous
            </Button>
            <div className={styles.footerRight}>
              <Button variant="outline" disabled={answered} onClick={skip}>
                Skip
              </Button>
              <Button disabled={!answered} onClick={goNext}>
                {isLast ? 'See results' : 'Next question'}
              </Button>
            </div>
          </div>
          <p className={styles.keyboardHint}>Keyboard: press A to D to answer, S to skip, Enter for the next question.</p>
        </div>

        <Card as="section" className={styles.navigator} aria-labelledby="navigator-title">
          <div className={styles.navigatorHead}>
            <h2 id="navigator-title" className={styles.navigatorTitle}>
              Progress
            </h2>
            <span className={styles.navigatorScore}>
              {correctCount} of {answeredCount} correct
              {skippedCount > 0 && ` · ${skippedCount} skipped`}
            </span>
          </div>
          <ol className={styles.steps}>
            {questions.map((q, i) => {
              const given = answers[q.id];
              const state =
                given === undefined ? (skipped[q.id] ? 'skipped' : 'todo') : given === q.answerKey ? 'right' : 'wrong';
              const words = { right: 'correct', wrong: 'incorrect', skipped: 'skipped', todo: 'not answered' }[state];
              return (
                <li key={q.id}>
                  <button
                    type="button"
                    className={`${styles.step} ${styles[state]} ${i === index ? styles.current : ''}`}
                    aria-label={`Question ${i + 1}, ${words}`}
                    aria-current={i === index ? 'step' : undefined}
                    disabled={i > furthest}
                    onClick={() => goTo(i)}
                  >
                    {i + 1}
                  </button>
                </li>
              );
            })}
          </ol>
          <ul className={styles.key} aria-label="Key">
            <li>
              <span className={`${styles.swatch} ${styles.right}`} aria-hidden="true" />
              Correct
            </li>
            <li>
              <span className={`${styles.swatch} ${styles.wrong}`} aria-hidden="true" />
              Incorrect
            </li>
            <li>
              <span className={`${styles.swatch} ${styles.skipped}`} aria-hidden="true" />
              Skipped
            </li>
            <li>
              <span className={`${styles.swatch} ${styles.todo}`} aria-hidden="true" />
              Not answered
            </li>
          </ul>
        </Card>
      </div>
    </section>
  );
}
