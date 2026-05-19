import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAdapterChat = vi.hoisted(() => vi.fn());

vi.mock('../src/lib/server/ai/anthropic.js', () => ({
  chat: mockAdapterChat,
}));
vi.mock('../src/lib/server/ai/openai.js', () => ({
  chat: mockAdapterChat,
}));
vi.mock('../src/lib/server/ai/openrouter.js', () => ({
  chat: mockAdapterChat,
}));

vi.mock('../src/lib/server/workflow-stats.js', () => ({
  recordInvocation: vi.fn(),
}));

import { chat, MAX_TOKENS_CEILING } from '../src/lib/server/ai.js';
import { TraverseError } from '../src/lib/server/errors.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockAdapterChat.mockResolvedValue({ text: 'ok', usage: { input: 1, output: 1 } });
});

describe('chat() — maxTokens ceiling', () => {
  it('throws TraverseError(max_tokens_exceeded) when maxTokens exceeds the ceiling', async () => {
    await expect(
      chat({
        provider: 'anthropic',
        model: 'claude-test',
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: MAX_TOKENS_CEILING + 1,
      })
    ).rejects.toBeInstanceOf(TraverseError);

    expect(mockAdapterChat).not.toHaveBeenCalled();
  });

  it('throws with code=max_tokens_exceeded', async () => {
    try {
      await chat({
        provider: 'anthropic',
        model: 'claude-test',
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 200_000,
      });
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(TraverseError);
      expect(err.code).toBe('max_tokens_exceeded');
    }
  });

  it('allows requests at exactly the ceiling', async () => {
    await chat({
      provider: 'anthropic',
      model: 'claude-test',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: MAX_TOKENS_CEILING,
    });
    expect(mockAdapterChat).toHaveBeenCalled();
  });

  it('allows requests well under the ceiling', async () => {
    await chat({
      provider: 'anthropic',
      model: 'claude-test',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 8000,
    });
    expect(mockAdapterChat).toHaveBeenCalled();
  });

  it('allows requests with no maxTokens (provider applies its own default)', async () => {
    await chat({
      provider: 'anthropic',
      model: 'claude-test',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(mockAdapterChat).toHaveBeenCalled();
  });
});
