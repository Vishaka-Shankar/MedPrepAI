import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError, AxiosHeaders } from 'axios';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authApi } from '../api/auth';
import { chatApi } from '../api/chat';
import { ChatMessage } from '../api/chatTypes';
import { tokenStorage } from '../api/client';
import { App } from '../App';
import { AuthProvider } from '../auth/AuthContext';
import { EXAMPLE_QUESTIONS, SERVICE_DOWN, TIMED_OUT } from './ChatPage';

// No real network: the auth and chat APIs are replaced by mocks
vi.mock('../api/auth', () => ({ authApi: { login: vi.fn(), register: vi.fn(), me: vi.fn() } }));
vi.mock('../api/chat', () => ({ USE_MOCK: false, chatApi: { history: vi.fn(), ask: vi.fn() } }));
const auth = vi.mocked(authApi);
const chat = vi.mocked(chatApi);

const ayesha = { id: '1', name: 'Ayesha', email: 'ayesha@example.com', role: 'student' as const };
const OUT_OF_SCOPE = "I couldn't find this in the syllabus material. Try rephrasing, or pick a subject.";

function answered(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'm1',
    question: 'What is osmosis?',
    subjectId: null,
    answer: 'Osmosis is the movement of water across a semi-permeable membrane [1], listed in the syllabus [2].',
    refused: false,
    citations: [
      { source: 'STBB_Biology_XI.pdf', page: 87, snippet: 'Water moves across the membrane from higher to lower water potential.' },
      { source: 'PMDC_MDCAT_Curriculum_2025_Final.pdf', page: 12, snippet: 'Transport across the cell membrane.' },
    ],
    createdAt: '2026-10-28T10:00:00.000Z',
    ...overrides,
  };
}

const outOfScope = () =>
  answered({ id: 'm2', question: 'Who won the cricket world cup?', answer: OUT_OF_SCOPE, refused: true, citations: [] });

/** The same errors axios throws: no response, a timeout, or an HTTP status. */
const networkError = () => new AxiosError('Network Error', AxiosError.ERR_NETWORK);
const timeoutError = () => new AxiosError('timeout of 60000ms exceeded', AxiosError.ECONNABORTED);
function httpError(status: number) {
  const headers = new AxiosHeaders();
  return new AxiosError('Request failed', String(status), { headers }, null, {
    status,
    statusText: 'error',
    data: { message: 'error' },
    headers: {},
    config: { headers },
  });
}

/** A promise resolved by hand, to look at the page while a request is still running. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function openChat() {
  tokenStorage.set('saved-token');
  auth.me.mockResolvedValue(ayesha);
  return render(
    <MemoryRouter initialEntries={['/chat']}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

const questionBox = () => screen.getByLabelText('Your question');
const sendButton = () => screen.getByRole('button', { name: 'Send' });

describe('Chat page', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
  });

  describe('header', () => {
    it('shows the title and subtitle, with no "Sample data" label', async () => {
      chat.history.mockResolvedValue([]);
      openChat();
      expect(await screen.findByRole('heading', { name: 'Ask the syllabus' })).toBeInTheDocument();
      expect(screen.getByText('Answers come only from your MDCAT material.')).toBeInTheDocument();
      expect(screen.queryByText(/sample data/i)).not.toBeInTheDocument();
      expect(within(screen.getByRole('group', { name: 'Subject' })).getByRole('button', { name: 'All' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });
  });

  describe('subject filter', () => {
    it('sends the selected subject as subjectId', async () => {
      chat.history.mockResolvedValue([]);
      chat.ask.mockResolvedValue(answered({ subjectId: 'chemistry' }));
      openChat();

      await userEvent.click(within(await screen.findByRole('group', { name: 'Subject' })).getByRole('button', { name: 'Chemistry' }));
      await userEvent.type(questionBox(), 'What is a limiting reactant?{Enter}');
      expect(chat.ask).toHaveBeenCalledWith('What is a limiting reactant?', 'chemistry');
    });

    it('sends subjectId null when "All" is selected', async () => {
      chat.history.mockResolvedValue([]);
      chat.ask.mockResolvedValue(answered());
      openChat();

      await userEvent.type(await screen.findByLabelText('Your question'), 'What is osmosis?{Enter}');
      expect(chat.ask).toHaveBeenCalledWith('What is osmosis?', null);
    });
  });

  describe('citations', () => {
    it('opens the citation panel from a [n] mark, with source, page and full snippet', async () => {
      chat.history.mockResolvedValue([answered()]);
      openChat();

      const answer = await screen.findByRole('article', { name: 'Answer' });
      expect(within(answer).getByText('Grounded in 2 sources')).toBeInTheDocument();
      const mark = within(answer).getByRole('button', { name: 'Source 1: Biology XI, page 87' });
      expect(mark).toHaveTextContent('[1]');

      await userEvent.click(mark);
      const panel = screen.getByRole('dialog', { name: 'Biology XI' });
      expect(panel).toHaveTextContent('Source [1]');
      expect(panel).toHaveTextContent('Page 87');
      expect(panel).toHaveTextContent('Water moves across the membrane from higher to lower water potential.');
      expect(within(panel).getByRole('button', { name: 'Close source' })).toHaveFocus();

      // Escape closes it and focus goes back to the mark
      await userEvent.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(mark).toHaveFocus();
    });

    it('opens the same panel from a citation row', async () => {
      chat.history.mockResolvedValue([answered()]);
      openChat();

      const sources = await screen.findByRole('list', { name: 'Sources' });
      const rows = within(sources).getAllByRole('button');
      expect(rows[1]).toHaveTextContent('[2] MDCAT syllabus · page 12');

      await userEvent.click(rows[1]);
      expect(screen.getByRole('dialog', { name: 'MDCAT syllabus' })).toHaveTextContent('Transport across the cell membrane.');
      await userEvent.click(screen.getByRole('button', { name: 'Close source' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('leaves a number without a matching citation as plain text', async () => {
      chat.history.mockResolvedValue([answered({ answer: 'See [1] and [9].', citations: answered().citations.slice(0, 1) })]);
      openChat();

      const answer = await screen.findByRole('article', { name: 'Answer' });
      expect(within(answer).getAllByRole('button', { name: /^Source \d/ })).toHaveLength(1);
      expect(answer).toHaveTextContent('[9]');
    });
  });

  describe('out of scope', () => {
    it('shows the API text in a dashed note, with no "Grounded" pill and no citations', async () => {
      chat.history.mockResolvedValue([outOfScope()]);
      openChat();

      const note = await screen.findByRole('note');
      expect(note).toHaveTextContent(OUT_OF_SCOPE);
      expect(note.tagName).toBe('P'); // a plain note...
      expect(screen.queryByRole('article', { name: 'Answer' })).not.toBeInTheDocument(); // ...not an answer card
      expect(screen.queryByText(/Grounded in/)).not.toBeInTheDocument();
      expect(screen.queryByRole('list', { name: 'Sources' })).not.toBeInTheDocument();
    });
  });

  describe('sending', () => {
    it('shows the typing indicator, disables Send while loading, then shows the answer', async () => {
      chat.history.mockResolvedValue([]);
      const reply = deferred<ChatMessage>();
      chat.ask.mockReturnValue(reply.promise);
      openChat();

      await screen.findByLabelText('Your question');
      expect(sendButton()).toBeDisabled(); // empty
      await userEvent.type(questionBox(), 'What is osmosis?');
      expect(sendButton()).toBeEnabled();
      await userEvent.keyboard('{Enter}');

      expect(screen.getByRole('status')).toHaveTextContent('Searching the syllabus...');
      expect(screen.getByText('What is osmosis?')).toBeInTheDocument();
      await userEvent.type(questionBox(), 'next question');
      expect(sendButton()).toBeDisabled(); // loading

      reply.resolve(answered());
      expect(await screen.findByRole('article', { name: 'Answer' })).toBeInTheDocument();
      expect(screen.queryByText('Searching the syllabus...')).not.toBeInTheDocument();
    });

    it('makes a new line with Shift+Enter instead of sending', async () => {
      chat.history.mockResolvedValue([]);
      openChat();

      await userEvent.type(await screen.findByLabelText('Your question'), 'line one{Shift>}{Enter}{/Shift}line two');
      expect(questionBox()).toHaveValue('line one\nline two');
      expect(chat.ask).not.toHaveBeenCalled();
    });

    it('sends an example question when clicked', async () => {
      chat.history.mockResolvedValue([]);
      chat.ask.mockResolvedValue(answered({ question: EXAMPLE_QUESTIONS[0] }));
      openChat();

      await userEvent.click(await screen.findByRole('button', { name: EXAMPLE_QUESTIONS[0] }));
      expect(chat.ask).toHaveBeenCalledWith(EXAMPLE_QUESTIONS[0], null);
    });
  });

  describe('errors', () => {
    it('shows a friendly error bubble with Retry and keeps the question in the input box', async () => {
      chat.history.mockResolvedValue([]);
      chat.ask.mockRejectedValueOnce(networkError()).mockResolvedValueOnce(answered());
      openChat();

      await userEvent.click(within(await screen.findByRole('group', { name: 'Subject' })).getByRole('button', { name: 'Biology' }));
      await userEvent.type(questionBox(), 'What is osmosis?{Enter}');

      const error = await screen.findByRole('alert');
      expect(error).toHaveTextContent(SERVICE_DOWN);
      expect(questionBox()).toHaveValue('What is osmosis?'); // the question stays in the input

      await userEvent.click(within(error).getByRole('button', { name: 'Retry' }));
      expect(chat.ask).toHaveBeenLastCalledWith('What is osmosis?', 'biology'); // same question and subject
      expect(await screen.findByRole('article', { name: 'Answer' })).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('explains a timeout', async () => {
      chat.history.mockResolvedValue([]);
      chat.ask.mockRejectedValue(timeoutError());
      openChat();

      await userEvent.type(await screen.findByLabelText('Your question'), 'What is osmosis?{Enter}');
      expect(await screen.findByRole('alert')).toHaveTextContent(TIMED_OUT);
      expect(questionBox()).toHaveValue('What is osmosis?');
    });

    it('sends the user to the login page with a notice when the session has expired', async () => {
      chat.history.mockResolvedValue([]);
      chat.ask.mockRejectedValue(httpError(401));
      openChat();

      await userEvent.type(await screen.findByLabelText('Your question'), 'What is osmosis?{Enter}');
      expect(await screen.findByRole('heading', { name: /log in/i })).toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent('Your session has expired. Please log in again.');
      expect(tokenStorage.get()).toBeNull();
    });

    it("shows the backend's reason for a coded 503 (e.g. the AI key is missing)", async () => {
      const sentence = 'The AI tutor is not set up yet: GROQ_API_KEY is empty in the .env file. Please ask the administrator to add it.';
      const notConfigured = httpError(503);
      (notConfigured.response as { data: unknown }).data = { statusCode: 503, code: 'AI_NOT_CONFIGURED', message: sentence };
      chat.history.mockResolvedValue([]);
      chat.ask.mockRejectedValueOnce(notConfigured);
      openChat();

      await userEvent.type(await screen.findByLabelText('Your question'), 'What is osmosis?{Enter}');
      expect(await screen.findByRole('alert')).toHaveTextContent(sentence);
    });

    it('shows "Try again" when the history cannot be loaded', async () => {
      chat.history.mockRejectedValueOnce(httpError(503)).mockResolvedValueOnce([]);
      openChat();

      expect(await screen.findByRole('alert')).toHaveTextContent(SERVICE_DOWN);
      await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
      await waitFor(() => expect(screen.getByRole('list', { name: 'Example questions' })).toBeInTheDocument());
    });
  });

  describe('scrolling', () => {
    const originalScroll = Element.prototype.scrollIntoView;
    afterEach(() => {
      Element.prototype.scrollIntoView = originalScroll;
      vi.unstubAllGlobals();
    });

    it('scrolls to the newest message without animation when the user prefers reduced motion', async () => {
      const scroll = vi.fn();
      Element.prototype.scrollIntoView = scroll;
      vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query }));
      chat.history.mockResolvedValue([answered()]);
      openChat();

      await screen.findByRole('article', { name: 'Answer' });
      expect(scroll).toHaveBeenLastCalledWith({ block: 'end', behavior: 'auto' });
    });
  });
});
