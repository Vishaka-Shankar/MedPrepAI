/**
 * Shapes of the chat API, shared by the real client (chat.ts) and the dev mock (mockChat.ts).
 *
 * Contract the NestJS backend implements:
 *   GET  /chat/history                       -> ChatMessage[]  (oldest first)
 *   POST /chat/ask { question, subjectId }   -> ChatMessage    (the new question with its answer)
 *        subjectId: "biology" | "chemistry" | "physics", or null for all subjects
 */

export type SubjectId = 'biology' | 'chemistry' | 'physics';
/** The filter in the page header: one subject, or all of them. */
export type SubjectFilter = SubjectId | 'all';

export const SUBJECT_OPTIONS: { value: SubjectFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'biology', label: 'Biology' },
  { value: 'chemistry', label: 'Chemistry' },
  { value: 'physics', label: 'Physics' },
];

/** One source an answer was grounded in. Answer text refers to it as [1], [2], ... in list order. */
export interface Citation {
  source: string; // file name, e.g. "STBB_Biology_XI.pdf"
  page: number | null;
  snippet: string;
}

/** One question and its answer (ERD: CHAT_MESSAGE + its CITATIONs). */
export interface ChatMessage {
  id: string;
  question: string;
  subjectId: SubjectId | null;
  answer: string;
  /** true = out of scope: nothing relevant in the syllabus; `answer` explains, there are no citations */
  refused: boolean;
  citations: Citation[];
  createdAt: string; // ISO date
}

export interface ChatApi {
  history(): Promise<ChatMessage[]>;
  ask(question: string, subjectId: SubjectId | null): Promise<ChatMessage>;
}
