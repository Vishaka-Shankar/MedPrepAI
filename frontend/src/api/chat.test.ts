import { afterEach, describe, expect, it, vi } from 'vitest';
import { ASK_TIMEOUT_MS, realChatApi } from './chat';
import { api } from './client';

// Checks the real HTTP requests the Chat page sends to the backend
describe('real chat API client', () => {
  afterEach(() => vi.restoreAllMocks());

  it('posts the question and the selected subject as subjectId to /chat/ask', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: { id: 'x' } });
    await realChatApi.ask('What is a limiting reactant?', 'chemistry');
    expect(post).toHaveBeenCalledWith(
      '/chat/ask',
      { question: 'What is a limiting reactant?', subjectId: 'chemistry' },
      { timeout: ASK_TIMEOUT_MS },
    );
  });

  it('sends subjectId null for all subjects', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: { id: 'x' } });
    await realChatApi.ask('What is osmosis?', null);
    expect(post.mock.calls[0][1]).toEqual({ question: 'What is osmosis?', subjectId: null });
  });

  it('loads the history from /chat/history', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ data: [] });
    await expect(realChatApi.history()).resolves.toEqual([]);
    expect(get).toHaveBeenCalledWith('/chat/history');
  });
});
