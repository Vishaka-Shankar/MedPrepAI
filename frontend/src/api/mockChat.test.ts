import { AxiosError } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SubjectId } from './chatTypes';
import { mockChatApi } from './mockChat';

// The mock waits ~1 s to look real; fake timers skip the wait
describe('mock chat API (dev mock mode)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
  });
  afterEach(() => vi.useRealTimers());

  async function ask(question: string, subjectId: SubjectId | null = null) {
    const result = mockChatApi.ask(question, subjectId);
    await vi.runAllTimersAsync();
    return result;
  }

  it('answers with [n] marks and matching citations, and remembers it in the history', async () => {
    const reply = await ask('What is a limiting reactant?');
    expect(reply.refused).toBe(false);
    expect(reply.answer).toContain('[1]');
    expect(reply.citations[0].source).toMatch(/Chemistry/); // guessed from "reactant"

    const historyPromise = mockChatApi.history();
    await vi.runAllTimersAsync();
    expect((await historyPromise).map((m) => m.id)).toContain(reply.id);
  });

  it('uses the chosen subject', async () => {
    const reply = await ask('Explain it', 'physics');
    expect(reply.subjectId).toBe('physics');
    expect(reply.citations[0].source).toMatch(/Physics/);
  });

  it('returns an out-of-scope answer with no citations for off-syllabus questions', async () => {
    const reply = await ask('Who won the cricket match?');
    expect(reply).toMatchObject({ refused: true, citations: [] });
    expect(reply.answer).toMatch(/couldn't find this in the syllabus material/);
  });

  it('can simulate the service being down', async () => {
    const result = mockChatApi.ask('test error', null);
    const assertion = expect(result).rejects.toBeInstanceOf(AxiosError);
    await vi.runAllTimersAsync();
    await assertion;
  });
});
