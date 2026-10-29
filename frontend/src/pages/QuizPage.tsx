import { useCallback, useEffect, useState } from 'react';
import { QUIZ_IS_SAMPLE, useQuizData } from '../hooks/useQuizData';
import { QuizData } from '../types/quiz';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Pill } from '../components/ui/Pill';
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

  const question = questions[index];
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

  const goNext = useCallback(() => {
    if (!answered) return;
    if (isLast) setFinished(true);
    else setIndex((i) => i + 1);
  }, [answered, isLast]);

  // Keyboard: A-D choose an answer, Enter goes to the next question
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
      // On a focused button or link, Enter already "clicks" it; handling it here too would skip a question
      const onControl = (e.target as HTMLElement | null)?.closest('button, a, input, textarea, select');
      if (e.key === 'Enter' && answered && !onControl) {
        e.preventDefault();
        goNext();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [finished, answered, question.options.length, choose, goNext]);

  if (finished) {
    const score = questions.filter((q) => answers[q.id] === q.answerKey).length;
    return (
      <Card as="section" className={styles.result} aria-label="Quiz result">
        <EmptyState title={`You scored ${score} of ${questions.length}`} description="Your real results will update your dashboard.">
          <Button
            onClick={() => {
              setAnswers({});
              setIndex(0);
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
      <div className={styles.topRow}>
        <div className={styles.tags}>
          <Pill>{quiz.topic}</Pill>
          <Pill>{quiz.origin}</Pill>
          {QUIZ_IS_SAMPLE && <span className={styles.sample}>Sample data</span>}
        </div>
        <span role="timer" aria-label={`Time left ${formatTime(secondsLeft)}`}>
          <Pill>Timer {formatTime(secondsLeft)}</Pill>
        </span>
      </div>

      <ProgressSegments total={questions.length} current={index + 1} label="Quiz progress" />

      <div>
        <p className={styles.counter}>
          Question {index + 1} of {questions.length}
        </p>
        <h1 id="quiz-question" className={styles.stem}>
          {question.stem}
        </h1>
      </div>

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
                <span>
                  {option}
                  {note && <span className={styles.note}> · {note}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {answered && (
        <Card as="section" className={styles.why} aria-labelledby="why-title">
          <div className={styles.whyMain}>
            <h2 id="why-title" className={styles.whyTitle}>
              Why
            </h2>
            <p className={styles.whyText}>{question.explanation}</p>
            <Pill>{question.source}</Pill>
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
        <Button disabled={!answered} onClick={goNext}>
          {isLast ? 'See results' : 'Next question'}
        </Button>
      </div>
      <p className={styles.keyboardHint}>Keyboard: press A to D to answer, Enter for the next question.</p>
    </section>
  );
}
