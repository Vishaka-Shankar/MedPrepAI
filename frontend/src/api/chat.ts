import { api } from './client';
import { ChatApi, ChatMessage, SubjectId } from './chatTypes';
import { mockChatApi } from './mockChat';

/** How long to wait for an answer (retrieval + LLM can be slow) before showing the timeout error. */
export const ASK_TIMEOUT_MS = 60000;

/** The real API: the NestJS backend (which calls the rag-service). */
export const realChatApi: ChatApi = {
  history: () => api.get<ChatMessage[]>('/chat/history').then((r) => r.data),
  ask: (question: string, subjectId: SubjectId | null) =>
    api.post<ChatMessage>('/chat/ask', { question, subjectId }, { timeout: ASK_TIMEOUT_MS }).then((r) => r.data),
};

/**
 * Dev-only mock mode (`npm run dev:mock`): fake answers without the backend chat or rag-service.
 * import.meta.env.DEV is false in `npm run build`, so a production build can never use the mock.
 */
export const USE_MOCK =
  import.meta.env.DEV && (import.meta.env.VITE_USE_MOCK === 'true' || import.meta.env.MODE === 'mock');

export const chatApi: ChatApi = USE_MOCK ? mockChatApi : realChatApi;
