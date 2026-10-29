/**
 * DEV-ONLY fake chat API, so the Chat page can be built and shown without the
 * rag-service (which needs a lot of RAM). Enabled by VITE_USE_MOCK=true or `npm run dev:mock`.
 * Never used in a production build (see chat.ts).
 *
 * Try these in mock mode:
 *   - any science question          -> a fake answer with 2 citations
 *   - "who won the cricket match?"  -> the out-of-scope answer (off-syllabus words)
 *   - "test error"                  -> "service not available" error
 *   - "test timeout"                -> "took too long" error
 *   - "test expired"                -> session expired: you are sent to the login page
 */
import { AxiosError, AxiosHeaders } from 'axios';
import { ChatApi, ChatMessage, Citation, SubjectId } from './chatTypes';

const OUT_OF_SCOPE = "I couldn't find this in the syllabus material. Try rephrasing, or pick a subject.";

// Snippets in the style of the real ingested books, so the UI looks realistic
const SOURCES: Record<SubjectId, Citation[]> = {
  biology: [
    {
      source: 'STBB_Biology_XII.pdf',
      page: 20,
      snippet:
        'Selective reabsorption: glucose present in the filtrate is absent in the urine of a healthy person; useful molecules are taken back into the blood from the renal tubules.',
    },
    {
      source: 'PMDC_MDCAT_Curriculum_2025_Final.pdf',
      page: 7,
      snippet: 'Homeostasis: describe the structure of the nephron and the role of the loop of Henle in osmoregulation.',
    },
  ],
  chemistry: [
    {
      source: 'STBB_Chemistry_XI.pdf',
      page: 20,
      snippet:
        'Since the number of moles of CO2 produced by O2 is less, O2 is the limiting reactant. The limiting reactant is consumed first and decides the amount of product.',
    },
    {
      source: 'PMDC_MDCAT_Curriculum_2025_Final.pdf',
      page: 9,
      snippet: 'Stoichiometry: identify the limiting reactant and calculate the theoretical and percentage yield.',
    },
  ],
  physics: [
    {
      source: 'STBB_Physics_XI.pdf',
      page: 27,
      snippet:
        'The larger the number of readings, the smaller the uncertainty, and the more accurate the data becomes.',
    },
    {
      source: 'PMDC_MDCAT_Curriculum_2025_Final.pdf',
      page: 16,
      snippet: 'Measurements: distinguish between precision and accuracy; estimate the uncertainty in a result.',
    },
  ],
};

const OFF_SYLLABUS_WORDS = ['cricket', 'football', 'weather', 'movie', 'song', 'capital of'];

// Kept in sessionStorage, so a page reload keeps the mock conversation (closing the tab clears it)
const STORAGE_KEY = 'medprep_mock_chat_history';

function loadHistory(): ChatMessage[] {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '[]') as ChatMessage[];
  } catch {
    return []; // storage blocked or corrupt: start empty
  }
}

function saveHistory(messages: ChatMessage[]) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
  } catch {
    // storage blocked: the conversation just won't survive a reload
  }
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Pick a subject from keywords when the user chose "All". */
function guessSubject(question: string): SubjectId {
  const q = question.toLowerCase();
  if (/(reactant|mole|bond|acid|atom|chemical)/.test(q)) return 'chemistry';
  if (/(force|velocity|reading|uncertainty|energy|current|motion)/.test(q)) return 'physics';
  return 'biology';
}

/** The same error axios throws when the server answers with this status. */
function httpError(status: number, message: string) {
  const headers = new AxiosHeaders();
  return new AxiosError(message, String(status), { headers }, null, {
    status,
    statusText: message,
    data: { message },
    headers: {},
    config: { headers },
  });
}

export const mockChatApi: ChatApi = {
  async history() {
    await wait(400);
    return loadHistory();
  },

  async ask(question, subjectId) {
    await wait(1200); // long enough to see the typing indicator
    const q = question.toLowerCase();
    if (q.includes('test error')) throw new AxiosError('Network Error', AxiosError.ERR_NETWORK);
    if (q.includes('test timeout')) throw new AxiosError('timeout of 60000ms exceeded', AxiosError.ECONNABORTED);
    if (q.includes('test expired')) throw httpError(401, 'Unauthorized');

    const refused = OFF_SYLLABUS_WORDS.some((word) => q.includes(word));
    const topic = subjectId ?? guessSubject(question);
    const message: ChatMessage = {
      id: `mock-${Date.now()}`,
      question,
      subjectId,
      refused,
      answer: refused
        ? OUT_OF_SCOPE
        : `(Mock answer about ${topic}.) According to your syllabus material, the key idea is in the first ` +
          'source [1], and the MDCAT syllabus lists it as a learning outcome [2].',
      citations: refused ? [] : SOURCES[topic],
      createdAt: new Date().toISOString(),
    };
    saveHistory([...loadHistory(), message]);
    return message;
  },
};
