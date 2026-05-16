// Verifies that `chat()` in src/lib/server/ai.js wires through to
// `recordInvocation()` on every successful call. The recording is
// best-effort — failures here must never affect the call return value.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRecord } = vi.hoisted(() => ({ mockRecord: vi.fn() }));

vi.mock('$lib/server/workflow-stats.js', () => ({
  recordInvocation: mockRecord,
}));

// Replace adapters with a stub that returns a known usage shape. The exact
// provider isn't important — any registered name works because chat() looks
// up by name.
const { mockAdapterChat } = vi.hoisted(() => ({ mockAdapterChat: vi.fn() }));

vi.mock('$lib/server/ai/anthropic.js', () => ({ chat: mockAdapterChat }));
vi.mock('$lib/server/ai/openai.js', () => ({ chat: mockAdapterChat }));
vi.mock('$lib/server/ai/openrouter.js', () => ({ chat: mockAdapterChat }));

const { chat } = await import('../src/lib/server/ai.js');

beforeEach(() => {
  mockRecord.mockReset();
  mockAdapterChat.mockReset();
});

describe('chat() telemetry hook', () => {
  it('calls recordInvocation with label + start/end + token counts', async () => {
    mockAdapterChat.mockResolvedValueOnce({
      text: 'ok',
      usage: { input: 100, output: 50, total: 150, turns: 1 },
    });
    const before = Date.now();
    await chat({
      provider: 'anthropic',
      model: 'm',
      system: 's',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 10,
      label: 'seed',
    });
    const after = Date.now();

    expect(mockRecord).toHaveBeenCalledTimes(1);
    const arg = mockRecord.mock.calls[0][0];
    expect(arg.label).toBe('seed');
    expect(arg.tokensIn).toBe(100);
    expect(arg.tokensOut).toBe(50);
    expect(arg.startMs).toBeGreaterThanOrEqual(before);
    expect(arg.endMs).toBeLessThanOrEqual(after);
    expect(arg.endMs).toBeGreaterThanOrEqual(arg.startMs);
  });

  it('skips recording when no label is provided', async () => {
    mockAdapterChat.mockResolvedValueOnce({
      text: 'ok',
      usage: { input: 1, output: 1, total: 2, turns: 1 },
    });
    await chat({
      provider: 'anthropic',
      model: 'm',
      system: 's',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 10,
    });
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it('does not break the call when recordInvocation throws', async () => {
    mockRecord.mockImplementation(() => {
      throw new Error('synthetic failure');
    });
    mockAdapterChat.mockResolvedValueOnce({
      text: 'ok',
      usage: { input: 5, output: 5, total: 10, turns: 1 },
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const r = await chat({
        provider: 'anthropic',
        model: 'm',
        system: 's',
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 10,
        label: 'seed',
      });
      expect(r.text).toBe('ok');
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
