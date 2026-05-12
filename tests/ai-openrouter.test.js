import { describe, it, expect, beforeEach, vi } from 'vitest';

// Block settings.json on disk from sneaking a real OPENROUTER_API_KEY into
// resolveEnv() — the adapter now consults the settings overlay before
// process.env, so a real file would mask `delete process.env.OPENROUTER_API_KEY`.
vi.mock('node:fs', () => ({
  readFileSync: () => { throw new Error('ENOENT'); },
  writeFileSync: () => {},
}));

import { chat } from '../src/lib/server/ai/openrouter.js';

function jsonResponse(body, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = 'sk-or-test';
  global.fetch = vi.fn();
});

describe('OpenRouter adapter — single turn', () => {
  it('returns text and normalized usage on a stop', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({
      choices: [{ message: { role: 'assistant', content: 'hi there' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 12, completion_tokens: 4 },
    }));

    const { text, usage } = await chat({
      model: 'anthropic/claude-3.5-sonnet',
      system: 'be terse',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 100,
    });

    expect(text).toBe('hi there');
    expect(usage).toEqual({ input: 12, output: 4, total: 16, turns: 1 });
  });

  it('sends HTTP-Referer and X-Title headers', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({
      choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 2 },
    }));

    await chat({
      model: 'anthropic/claude-3.5-sonnet',
      system: 's',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 100,
    });

    const headers = fetch.mock.calls[0][1].headers;
    expect(headers['HTTP-Referer']).toBeTruthy();
    expect(headers['X-Title']).toBe('Traverse');
  });

  it('sends requests to the OpenRouter endpoint', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({
      choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 2 },
    }));

    await chat({
      model: 'meta-llama/llama-3.1-70b-instruct',
      system: 's',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 100,
    });

    expect(fetch.mock.calls[0][0]).toContain('openrouter.ai');
  });

  it('treats finish_reason "length" as a normal return', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({
      choices: [{ message: { role: 'assistant', content: 'truncated' }, finish_reason: 'length' }],
      usage: { prompt_tokens: 5, completion_tokens: 100 },
    }));
    const { text } = await chat({
      model: 'anthropic/claude-3.5-sonnet', system: 's',
      messages: [{ role: 'user', content: 'go' }], maxTokens: 100,
    });
    expect(text).toBe('truncated');
  });

  it('throws a clear error when OPENROUTER_API_KEY is missing', async () => {
    delete process.env.OPENROUTER_API_KEY;
    await expect(chat({
      model: 'anthropic/claude-3.5-sonnet', system: 's',
      messages: [{ role: 'user', content: 'hi' }], maxTokens: 10,
    })).rejects.toThrow(/OPENROUTER_API_KEY not set/);
  });

  it('rejects anthropic-native tools with a redirect message', async () => {
    await expect(chat({
      model: 'anthropic/claude-3.5-sonnet', system: 's',
      messages: [{ role: 'user', content: 'hi' }], maxTokens: 10,
      tools: [{ kind: 'anthropic-native', spec: { type: 'web_search_20250305', name: 'web_search' } }],
    })).rejects.toThrow(/anthropic-native tool|tavily/);
  });

  it('throws a sanitized AdapterError on non-retriable HTTP failures', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({ error: { message: 'invalid key' } }, false, 401));
    let thrown;
    try {
      await chat({
        model: 'anthropic/claude-3.5-sonnet', system: 's',
        messages: [{ role: 'user', content: 'hi' }], maxTokens: 10,
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeDefined();
    expect(thrown.name).toBe('AdapterError');
    expect(thrown.provider).toBe('openrouter');
    expect(thrown.status).toBe(401);
    expect(thrown.message).toMatch(/openrouter/);
    expect(thrown.message).not.toContain('invalid key');
    expect(thrown.cause).toContain('invalid key');
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
        model: 'anthropic/claude-3.5-sonnet', system: 's',
        messages: [{ role: 'user', content: 'hi' }], maxTokens: 10,
      });

      await vi.runAllTimersAsync();
      const { text } = await promise;
      expect(text).toBe('recovered');
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('OpenRouter adapter — AbortSignal', () => {
  it('passes signal to fetch', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({
      choices: [{ message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }));
    const controller = new AbortController();
    await chat({
      model: 'anthropic/claude-3.5-sonnet', system: 's',
      messages: [{ role: 'user', content: 'go' }],
      maxTokens: 10, signal: controller.signal,
    });
    expect(fetch.mock.calls[0][1].signal).toBe(controller.signal);
  });

  it('throws immediately if signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));
    await expect(chat({
      model: 'anthropic/claude-3.5-sonnet', system: 's',
      messages: [{ role: 'user', content: 'go' }],
      maxTokens: 10, signal: controller.signal,
    })).rejects.toThrow(/cancelled/);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('OpenRouter adapter — streaming', () => {
  function streamingResponse(chunks) {
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        for (const c of chunks) controller.enqueue(encoder.encode(c));
        controller.close();
      },
    });
    return { ok: true, status: 200, body, text: async () => '', json: async () => ({}) };
  }

  it('parses SSE chunks and emits text via onText', async () => {
    fetch.mockResolvedValueOnce(streamingResponse([
      'data: {"choices":[{"delta":{"content":"Hello "}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"world"}}]}\n\n',
      'data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":5,"completion_tokens":2}}\n\n',
      'data: [DONE]\n\n',
    ]));

    const chunks = [];
    const { text, usage } = await chat({
      model: 'anthropic/claude-3.5-sonnet', system: 's',
      messages: [{ role: 'user', content: 'go' }], maxTokens: 100,
      onText: (c) => chunks.push(c),
    });

    expect(chunks).toEqual(['Hello ', 'world']);
    expect(text).toBe('Hello world');
    expect(usage.input).toBe(5);
    expect(usage.output).toBe(2);
    expect(usage.turns).toBe(1);

    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.stream).toBe(true);
    expect(body.stream_options.include_usage).toBe(true);
  });

  it('falls back to non-streaming path when tools are present', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({
      choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }));
    const onText = vi.fn();
    await chat({
      model: 'anthropic/claude-3.5-sonnet', system: 's',
      messages: [{ role: 'user', content: 'x' }], maxTokens: 10,
      tools: [{ kind: 'normalized', name: 'web_search', description: 'd', inputSchema: { type: 'object' } }],
      onText,
    });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.stream).toBeUndefined();
    expect(onText).not.toHaveBeenCalled();
  });
});

describe('OpenRouter adapter — tool loop', () => {
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
      model: 'anthropic/claude-3.5-sonnet',
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
      model: 'anthropic/claude-3.5-sonnet',
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

describe('OpenRouter adapter — image content blocks', () => {
  it('translates normalized image blocks to image_url data URIs', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({
      choices: [{ message: { role: 'assistant', content: 'parsed' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 500, completion_tokens: 20 },
    }));

    await chat({
      model: 'anthropic/claude-3.5-sonnet', system: 's', maxTokens: 200,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Parse these.' },
          { type: 'image', mediaType: 'image/png', data: 'xyz789' },
        ],
      }],
    });

    const body = JSON.parse(fetch.mock.calls[0][1].body);
    const imageBlock = body.messages.find(m => m.role === 'user').content[1];
    expect(imageBlock).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,xyz789' },
    });
  });

  it('passes plain string content through unchanged', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({
      choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 2 },
    }));

    await chat({
      model: 'openai/gpt-4o', system: 's', maxTokens: 50,
      messages: [{ role: 'user', content: 'just text' }],
    });

    const body = JSON.parse(fetch.mock.calls[0][1].body);
    const userMsg = body.messages.find(m => m.role === 'user');
    expect(userMsg.content).toBe('just text');
  });
});
