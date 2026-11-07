import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { MOCK_QUIZ } from '../mocks/quiz';
import { formatTime, QuizPage } from './QuizPage';

const { questions } = MOCK_QUIZ;
const first = questions[0];
const wrongIndex = first.answerKey === 0 ? 1 : 0;
const LETTERS = ['A', 'B', 'C', 'D'];

/** Option text as a regex ("3 Na+ out" contains "+", which must be escaped). */
const exactly = (text: string) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const options = () => within(screen.getByRole('list', { name: 'Answer options' }));

async function openQuiz() {
  render(<QuizPage />);
  await screen.findByRole('heading', { name: first.stem }); // data arrives through useQuizData
}

describe('Quiz page (mock data)', () => {
  it('shows the topic, origin, Sample data label, timer, progress and question', async () => {
    await openQuiz();
    expect(screen.getByText(/^Biology · Cell transport · Past paper \(2024\)/)).toBeInTheDocument();
    expect(screen.getByText('Sample data')).toBeInTheDocument();
    expect(screen.getByRole('timer', { name: 'Time left 12:40' })).toHaveTextContent('12:40');
    expect(screen.getByText(`Question 1 of ${questions.length}`)).toBeInTheDocument();
    expect(questions).toHaveLength(10);
    expect(screen.getByRole('progressbar', { name: 'Quiz progress' })).toHaveAttribute('aria-valuetext', '1 of 10');
    expect(screen.getByRole('button', { name: 'Next question' })).toBeDisabled(); // answer first
  });

  it('after a wrong answer: "Your answer (incorrect)", "Correct answer", and the explanation card', async () => {
    await openQuiz();
    await userEvent.click(options().getByRole('button', { name: exactly(first.options[wrongIndex]) }));

    expect(options().getByRole('button', { name: /Your answer \(incorrect\)/ })).toHaveTextContent(first.options[wrongIndex]);
    expect(options().getByRole('button', { name: /Correct answer/ })).toHaveTextContent(first.options[first.answerKey]);
    // Locked after answering
    expect(options().getAllByRole('button').every((b) => (b as HTMLButtonElement).disabled)).toBe(true);

    const why = screen.getByRole('region', { name: `Why ${LETTERS[first.answerKey]} is correct` });
    expect(why).toHaveTextContent(first.explanation);
    expect(why).toHaveTextContent(first.source);
    expect(why).toHaveTextContent('Watch to revise');
    expect(within(why).getByRole('link', { name: new RegExp(first.video.title) })).toHaveAttribute('href', first.video.url);
    expect(why).toHaveTextContent(`${first.video.channel} · ${first.video.duration}`);
  });

  it('keyboard: a letter key answers and Enter goes to the next question', async () => {
    await openQuiz();
    await userEvent.keyboard(LETTERS[first.answerKey].toLowerCase()); // lower case works too
    expect(options().getByRole('button', { name: /Correct answer \(your answer\)/ })).toBeInTheDocument();

    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('heading', { name: questions[1].stem })).toBeInTheDocument();
    expect(screen.getByText('Question 2 of 10')).toBeInTheDocument();

    // Enter does nothing before the question is answered
    await userEvent.keyboard('{Enter}');
    expect(screen.getByText('Question 2 of 10')).toBeInTheDocument();
  });

  it('Previous goes back and keeps the earlier answer', async () => {
    await openQuiz();
    await userEvent.keyboard(LETTERS[wrongIndex]);
    await userEvent.click(screen.getByRole('button', { name: 'Next question' }));
    await userEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(screen.getByText('Question 1 of 10')).toBeInTheDocument();
    expect(options().getByRole('button', { name: /Your answer \(incorrect\)/ })).toBeInTheDocument();
  });

  it('goes through all 10 questions and shows the score', async () => {
    await openQuiz();
    for (const q of questions) {
      await userEvent.click(options().getByRole('button', { name: exactly(q.options[q.answerKey]) }));
      const next = screen.queryByRole('button', { name: 'Next question' }) ?? screen.getByRole('button', { name: 'See results' });
      await userEvent.click(next);
    }
    expect(screen.getByRole('heading', { name: 'You scored 10 of 10' })).toBeInTheDocument();
  });

  it('the navigator shows right and wrong answers and jumps back to an answered question', async () => {
    await openQuiz();
    await userEvent.keyboard(LETTERS[wrongIndex]);
    await userEvent.click(screen.getByRole('button', { name: 'Next question' }));

    const nav = within(screen.getByRole('region', { name: 'Progress' }));
    expect(nav.getByText('0 of 1 correct')).toBeInTheDocument();
    expect(nav.getByRole('button', { name: 'Question 2, not answered' })).toHaveAttribute('aria-current', 'step');
    expect(nav.getByRole('button', { name: 'Question 3, not answered' })).toBeDisabled(); // not reached yet

    await userEvent.click(nav.getByRole('button', { name: 'Question 1, incorrect' }));
    expect(screen.getByText('Question 1 of 10')).toBeInTheDocument();
  });

  it('Skip leaves a question unanswered, moves on, and the student can come back to it', async () => {
    await openQuiz();
    await userEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(screen.getByText('Question 2 of 10')).toBeInTheDocument();

    const nav = within(screen.getByRole('region', { name: 'Progress' }));
    expect(nav.getByText('0 of 0 correct · 1 skipped')).toBeInTheDocument();

    await userEvent.keyboard('s'); // S skips too
    expect(screen.getByText('Question 3 of 10')).toBeInTheDocument();
    expect(nav.getByText('0 of 0 correct · 2 skipped')).toBeInTheDocument();

    // Back to question 1: not answered yet, so it can still be answered (and is no longer "skipped")
    await userEvent.click(nav.getByRole('button', { name: 'Question 1, skipped' }));
    expect(screen.getByRole('heading', { name: first.stem })).toBeInTheDocument();
    await userEvent.keyboard(LETTERS[first.answerKey]);
    expect(nav.getByRole('button', { name: 'Question 1, correct' })).toBeInTheDocument();
    expect(nav.getByText('1 of 1 correct · 1 skipped')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Skip' })).toBeDisabled(); // nothing to skip once answered
  });

  it('skipped questions show on the results, with a way back to answer them', async () => {
    await openQuiz();
    for (const q of questions.slice(0, -1)) {
      if (q === questions[2]) {
        await userEvent.click(screen.getByRole('button', { name: 'Skip' }));
        continue;
      }
      await userEvent.click(options().getByRole('button', { name: exactly(q.options[q.answerKey]) }));
      await userEvent.click(screen.getByRole('button', { name: 'Next question' }));
    }
    await userEvent.click(screen.getByRole('button', { name: 'Skip' })); // the last question: opens the results

    const result = screen.getByRole('region', { name: 'Quiz result' });
    expect(within(result).getByRole('heading', { name: 'You scored 8 of 10' })).toBeInTheDocument();
    expect(result).toHaveTextContent('2 skipped.');

    await userEvent.click(within(result).getByRole('button', { name: 'Answer skipped questions' }));
    expect(screen.getByRole('heading', { name: questions[2].stem })).toBeInTheDocument();
  });

  it('formats the timer as minutes:seconds', () => {
    expect(formatTime(760)).toBe('12:40');
    expect(formatTime(65)).toBe('1:05');
    expect(formatTime(-3)).toBe('0:00');
  });
});
