import { describe, it, expect, beforeEach, vi } from 'vitest';
import { chat } from '../src/lib/server/ai/openai.js';

function jsonResponse(body, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

beforeEach(() => {
  process.env.OPENAI_API_KEY = 'sk-test';
  global.fetch = vi.fn();
});

describe('OpenAI adapter — single turn', () => {
  it('returns text and normalized usage on a stop', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({
      choices: [{ message: { role: 'assistant', content: 'hi there' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 12, completion_tokens: 4 },
    }));

    const { text, usage } = await chat({
      model: 'gpt-4o-mini',
      system: 'be terse',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 100,
    });

    expect(text).toBe('hi there');
    expect(usage).toEqual({ input: 12, output: 4, total: 16, turns: 1 });
  });

  it('treats finish_reason "length" as a normal return', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({
      choices: [{ message: { role: 'assistant', content: 'truncated' }, finish_reason: 'length' }],
      usage: { prompt_tokens: 5, completion_tokens: 100 },
    }));
    const { text } = await chat({
      model: 'gpt-x', system: 's', messages: [{ role: 'user', content: 'go' }], maxTokens: 100,
    });
    expect(text).toBe('truncated');
  });

  it('throws a clear error when OPENAI_API_KEY is missing', async () => {
    delete process.env.OPENAI_API_KEY;
    await expect(chat({
      model: 'gpt', system: 's', messages: [{ role: 'user', content: 'hi' }], maxTokens: 10,
    })).rejects.toThrow(/OPENAI_API_KEY not set/);
  });

  it('rejects anthropic-native tools with a redirect message', async () => {
    await expect(chat({
      model: 'gpt', system: 's', messages: [{ role: 'user', content: 'hi' }], maxTokens: 10,
      tools: [{ kind: 'anthropic-native', spec: { type: 'web_search_20250305', name: 'web_search' } }],
    })).rejects.toThrow(/anthropic-native tool|tavily/);
  });

  it('surfaces non-retriable API errors with the response body', async () => {
    // Use 400 (non-retriable) so the test doesn't actually retry.
    fetch.mockResolvedValueOnce(jsonResponse({ error: { message: 'bad request' } }, false, 400));
    await expect(chat({
      model: 'gpt', system: 's', messages: [{ role: 'user', content: 'hi' }], maxTokens: 10,
    })).rejects.toThrow(/OpenAI API 400/);
  });

  it('retries on 429 and succeeds when the next attempt clears', async () => {
    vi.useFakeTimers();
    try {
      fetch.mockResolvedValueOnce(jsonResponse({ error: { message: 'rate limited' } }, false, 429));
      fetch.mockResolvedValueOnce(jsonResponse({
        choices: [{ message: { role: 'assistant', content: 'recovered' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 2 },
      }));

      const promise = chat({
        model: 'gpt', system: 's', messages: [{ role: 'user', content: 'hi' }], maxTokens: 10,
      });

      // Drain backoff so the second fetch fires.
      await vi.runAllTimersAsync();
      const { text } = await promise;
      expect(text).toBe('recovered');
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('OpenAI adapter — tool loop', () => {
  it('calls onToolCall and feeds results back as role:tool', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({
      choices: [{
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'web_search', arguments: '{"query":"hello"}' } }],
        },
        finish_reason: 'tool_calls',
      }],
      usage: { prompt_tokens: 50, completion_tokens: 5 },
    }));
    fetch.mockResolvedValueOnce(jsonResponse({
      choices: [{ message: { role: 'assistant', content: 'final answer' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 80, completion_tokens: 12 },
    }));

    const onToolCall = vi.fn().mockResolvedValue([{ title: 'r1', url: 'u', snippet: 's' }]);
    const activities = [];

    const { text, usage } = await chat({
      model: 'gpt-4o',
      system: 's',
      messages: [{ role: 'user', content: 'do search' }],
      maxTokens: 200,
      tools: [{ kind: 'normalized', name: 'web_search', description: 'search', inputSchema: { type: 'object' } }],
      onToolCall,
      onActivity: (a) => activities.push(a),
    });

    expect(text).toBe('final answer');
    expect(onToolCall).toHaveBeenCalledOnce();
    expect(onToolCall.mock.calls[0][0]).toEqual({ name: 'web_search', input: { query: 'hello' } });
    expect(activities).toEqual([{ type: 'tool_call', name: 'web_search', input: { query: 'hello' } }]);
    expect(usage).toEqual({ input: 130, output: 17, total: 147, turns: 2 });

    // Second fetch call should include the tool result message
    const secondCall = JSON.parse(fetch.mock.calls[1][1].body);
    const toolMsg = secondCall.messages.find(m => m.role === 'tool');
    expect(toolMsg).toBeDefined();
    expect(toolMsg.tool_call_id).toBe('call_1');
    expect(toolMsg.content).toContain('r1');
  });

  it('handles tool errors with an error tool_result', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({
      choices: [{
        message: { role: 'assistant', content: null,
          tool_calls: [{ id: 'c1', type: 'function', function: { name: 'web_search', arguments: '{"query":"x"}' } }] },
        finish_reason: 'tool_calls',
      }],
      usage: { prompt_tokens: 10, completion_tokens: 2 },
    }));
    fetch.mockResolvedValueOnce(jsonResponse({
      choices: [{ message: { role: 'assistant', content: 'recovered' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 20, completion_tokens: 5 },
    }));

    const { text } = await chat({
      model: 'gpt-4o',
      system: 's',
      messages: [{ role: 'user', content: 'try' }],
      maxTokens: 200,
      tools: [{ kind: 'normalized', name: 'web_search', description: 's', inputSchema: { type: 'object' } }],
      onToolCall: async () => { throw new Error('search down'); },
    });
    expect(text).toBe('recovered');

    const secondCall = JSON.parse(fetch.mock.calls[1][1].body);
    const toolMsg = secondCall.messages.find(m => m.role === 'tool');
    expect(toolMsg.content).toContain('search down');
  });
});
