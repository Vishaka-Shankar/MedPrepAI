import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppEnv } from '../config/env';
import { RAG_DOWN, RAG_TIMED_OUT, RagClient, RagUnavailableError } from './rag-client';

const client = () => new RagClient({ get: () => 'http://localhost:8000' } as unknown as ConfigService<AppEnv, true>);
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('RagClient', () => {
  let fetchMock: jest.SpyInstance;
  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch');
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('posts the question to /answer and returns the answer', async () => {
    const answer = { status: 'ok', answer: 'F = ma [1].', citations: [{ n: 1, chunkId: 'a'.repeat(24), source: 's.pdf', page: 74, snippet: 'x' }] };
    fetchMock.mockResolvedValue(json(200, answer));
    await expect(client().answer({ question: 'Newton?', subjectId: 'b'.repeat(24) })).resolves.toEqual(answer);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:8000/answer');
    expect(JSON.parse(init.body as string)).toEqual({ question: 'Newton?', subjectId: 'b'.repeat(24) });
    expect(init.signal).toBeDefined(); // has a timeout
  });

  it('passes on an error answer (e.g. AI key missing) for the service to handle', async () => {
    const answer = { status: 'error', code: 'LLM_NOT_CONFIGURED', answer: 'GROQ_API_KEY is empty', citations: [] };
    fetchMock.mockResolvedValue(json(200, answer));
    await expect(client().answer({ question: 'q' })).resolves.toEqual(answer);
  });

  it('service not running -> RagUnavailableError with a clear message', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(client().answer({ question: 'q' })).rejects.toThrow(new RagUnavailableError(RAG_DOWN));
  });

  it('timeout -> its own message', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }));
    await expect(client().answer({ question: 'q' })).rejects.toThrow(RAG_TIMED_OUT);
  });

  it("a 503 from the rag-service keeps its sentence (e.g. not enough memory)", async () => {
    fetchMock.mockResolvedValue(json(503, { detail: 'The server does not have enough free memory.' }));
    await expect(client().answer({ question: 'q' })).rejects.toThrow('The server does not have enough free memory.');
  });

  it('an answer in an unexpected shape is treated as the service being down', async () => {
    fetchMock.mockResolvedValue(json(200, { hello: 'world' }));
    await expect(client().answer({ question: 'q' })).rejects.toThrow(RAG_DOWN);
  });
});
