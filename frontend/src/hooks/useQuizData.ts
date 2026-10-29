import { loadMockQuiz } from '../mocks/quiz';
import { QuizData } from '../types/quiz';
import { AsyncData, useAsyncData } from './useAsyncData';

/**
 * The Quiz page's data. TODAY: mock data (src/mocks/quiz.ts).
 * LATER (M5): replace `loadMockQuiz` with an API call that returns Promise<QuizData>;
 * the page itself does not change.
 */
export function useQuizData(): AsyncData<QuizData> {
  return useAsyncData(loadMockQuiz);
}

/** True while the page shows mock data (drives the "Sample data" label). */
export const QUIZ_IS_SAMPLE = true;
