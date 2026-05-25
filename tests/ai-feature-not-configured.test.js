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

import { chat } from '../src/lib/server/ai.js';
import { TraverseError } from '../src/lib/server/errors.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockAdapterChat.mockResolvedValue({ text: 'ok', usage: { input: 1, output: 1 } });
});

describe('chat() — feature_not_configured guard', () => {
  it('throws TraverseError(feature_not_configured) when provider is undefined', async () => {
    await expect(
      chat({
        provider: undefined,
        model: 'claude-test',
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 10,
      })
    ).rejects.toBeInstanceOf(TraverseError);

    expect(mockAdapterChat).not.toHaveBeenCalled();
  });

  it('throws with code=feature_not_configured when provider is undefined', async () => {
    try {
      await chat({
        provider: undefined,
        model: 'claude-test',
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 10,
      });
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(TraverseError);
      expect(err.code).toBe('feature_not_configured');
    }
  });

  it('throws with code=feature_not_configured when provider is null', async () => {
    await expect(
      chat({
        provider: null,
        model: 'claude-test',
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 10,
      })
    ).rejects.toMatchObject({ code: 'feature_not_configured' });

    expect(mockAdapterChat).not.toHaveBeenCalled();
  });

  it('throws with code=feature_not_configured when provider is an empty string', async () => {
    await expect(
      chat({
        provider: '',
        model: 'claude-test',
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 10,
      })
    ).rejects.toMatchObject({ code: 'feature_not_configured' });

    expect(mockAdapterChat).not.toHaveBeenCalled();
  });

  it('throws TraverseError(feature_not_configured) when model is undefined', async () => {
    await expect(
      chat({
        provider: 'anthropic',
        model: undefined,
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 10,
      })
    ).rejects.toBeInstanceOf(TraverseError);

    expect(mockAdapterChat).not.toHaveBeenCalled();
  });

  it('throws with code=feature_not_configured when model is undefined', async () => {
    try {
      await chat({
        provider: 'anthropic',
        model: undefined,
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 10,
      });
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(TraverseError);
      expect(err.code).toBe('feature_not_configured');
    }
  });

  it('throws with code=feature_not_configured when model is null', async () => {
    await expect(
      chat({
        provider: 'anthropic',
        model: null,
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 10,
      })
    ).rejects.toMatchObject({ code: 'feature_not_configured' });

    expect(mockAdapterChat).not.toHaveBeenCalled();
  });

  it('throws with code=feature_not_configured when model is an empty string', async () => {
    await expect(
      chat({
        provider: 'anthropic',
        model: '',
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 10,
      })
    ).rejects.toMatchObject({ code: 'feature_not_configured' });

    expect(mockAdapterChat).not.toHaveBeenCalled();
  });

  it('does not throw for a valid provider and model', async () => {
    await chat({
      provider: 'anthropic',
      model: 'claude-test',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 10,
    });
    expect(mockAdapterChat).toHaveBeenCalled();
  });
});
