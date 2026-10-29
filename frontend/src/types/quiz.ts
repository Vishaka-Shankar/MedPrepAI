/** Data the Quiz page needs. Today it comes from src/mocks/quiz.ts; later from the quiz API (M5). */

export interface QuizQuestion {
  id: string;
  stem: string;
  options: string[]; // A, B, C, D
  answerKey: number; // index of the correct option (0-based, like questions.answerKey in the ERD)
  explanation: string;
  source: string; // where the explanation comes from, e.g. "Biology XI · page 87"
  video: { title: string; channel: string; duration: string; url: string };
}

export interface QuizData {
  topic: string; // e.g. "Biology · Cell transport"
  origin: string; // e.g. "Past paper (2024)"
  timeRemainingSeconds: number;
  questions: QuizQuestion[];
}
