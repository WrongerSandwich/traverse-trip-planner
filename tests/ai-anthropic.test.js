import { describe, it, expect, beforeEach, vi } from 'vitest';

// vi.hoisted shares state with the hoisted vi.mock factory below.
const { mockCreate, mockStream } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockStream: vi.fn(),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    constructor() { this.messages = { create: mockCreate, stream: mockStream }; }
  },
}));

const { chat } = await import('../src/lib/server/ai/anthropic.js');

beforeEach(() => {
  mockCreate.mockReset();
  mockStream.mockReset();
});

describe('Anthropic adapter — single turn', () => {
  it('returns text and normalized usage on end_turn', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'hello' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 3 },
    });

    const { text, usage } = await chat({
      model: 'claude-test',
      system: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 100,
    });

    expect(text).toBe('hello');
    expect(usage).toEqual({ input: 10, output: 3, total: 13, turns: 1 });
  });

  it('treats max_tokens stop as a normal return', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'truncated' }],
      stop_reason: 'max_tokens',
      usage: { input_tokens: 5, output_tokens: 100 },
    });
    const { text, usage } = await chat({
      model: 'claude-test', system: 's', messages: [{ role: 'user', content: 'go' }], maxTokens: 100,
    });
    expect(text).toBe('truncated');
    expect(usage.turns).toBe(1);
  });

  it('omits tools key when no tools are passed', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    await chat({
      model: 'm', system: 's', messages: [{ role: 'user', content: 'x' }], maxTokens: 10,
    });
    expect(mockCreate.mock.calls[0][0]).not.toHaveProperty('tools');
  });
});

describe('Anthropic adapter — native (server-side) tool loop', () => {
  it('responds with empty content tool_result and continues', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'tool_use', id: 'tu_1', name: 'web_search', input: { query: 'x' } }],
      stop_reason: 'tool_use',
      usage: { input_tokens: 50, output_tokens: 5 },
    });
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'final' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 80, output_tokens: 10 },
    });

    const onToolCall = vi.fn();
    const activities = [];

    const { text, usage } = await chat({
      model: 'claude-test',
      system: 's',
      messages: [{ role: 'user', content: 'search' }],
      maxTokens: 200,
      tools: [{ kind: 'anthropic-native', spec: { type: 'web_search_20250305', name: 'web_search' } }],
      onToolCall,
      onActivity: (a) => activities.push(a),
    });

    expect(text).toBe('final');
    expect(usage).toEqual({ input: 130, output: 15, total: 145, turns: 2 });
    expect(onToolCall).not.toHaveBeenCalled(); // native tool runs server-side
    expect(activities).toEqual([{ type: 'tool_call', name: 'web_search', input: { query: 'x' } }]);

    // Verify the tool_result sent on the second turn was empty content.
    const secondCallMessages = mockCreate.mock.calls[1][0].messages;
    const lastMsg = secondCallMessages[secondCallMessages.length - 1];
    expect(lastMsg.role).toBe('user');
    expect(lastMsg.content[0]).toEqual({ type: 'tool_result', tool_use_id: 'tu_1', content: '' });
  });

  it('passes the native tool spec through unchanged in the tools array', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const spec = { type: 'web_search_20250305', name: 'web_search' };
    await chat({
      model: 'm', system: 's', messages: [{ role: 'user', content: 'x' }], maxTokens: 10,
      tools: [{ kind: 'anthropic-native', spec }],
    });
    expect(mockCreate.mock.calls[0][0].tools).toEqual([spec]);
  });
});

describe('Anthropic adapter — normalized (client-side) tool loop', () => {
  it('translates normalized tool to input_schema, calls onToolCall, JSON-stringifies result', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'tool_use', id: 'tu_2', name: 'web_search', input: { query: 'q' } }],
      stop_reason: 'tool_use',
      usage: { input_tokens: 30, output_tokens: 3 },
    });
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'answer' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 60, output_tokens: 8 },
    });

    const onToolCall = vi.fn().mockResolvedValue([{ title: 'r', url: 'u', snippet: 's' }]);

    const { text } = await chat({
      model: 'claude-test',
      system: 's',
      messages: [{ role: 'user', content: 'do' }],
      maxTokens: 200,
      tools: [{
        kind: 'normalized',
        name: 'web_search',
        description: 'desc',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
      }],
      onToolCall,
    });

    expect(text).toBe('answer');
    expect(onToolCall).toHaveBeenCalledWith({ name: 'web_search', input: { query: 'q' } });

    // Tool definition should be in Anthropic's input_schema shape on the API call.
    const tools = mockCreate.mock.calls[0][0].tools;
    expect(tools).toEqual([{ name: 'web_search', description: 'desc', input_schema: { type: 'object', properties: { query: { type: 'string' } } } }]);

    // Tool result content should be JSON-stringified.
    const secondCallMessages = mockCreate.mock.calls[1][0].messages;
    const lastMsg = secondCallMessages[secondCallMessages.length - 1];
    expect(lastMsg.content[0].content).toContain('r');
    expect(JSON.parse(lastMsg.content[0].content)).toEqual([{ title: 'r', url: 'u', snippet: 's' }]);
  });

  it('returns an is_error tool_result when the tool throws', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'tool_use', id: 'tu_3', name: 'web_search', input: {} }],
      stop_reason: 'tool_use',
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'recovered' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    await chat({
      model: 'm', system: 's', messages: [{ role: 'user', content: 'x' }], maxTokens: 10,
      tools: [{ kind: 'normalized', name: 'web_search', description: 'd', inputSchema: { type: 'object' } }],
      onToolCall: async () => { throw new Error('boom'); },
    });

    const secondCallMessages = mockCreate.mock.calls[1][0].messages;
    const tr = secondCallMessages[secondCallMessages.length - 1].content[0];
    expect(tr.is_error).toBe(true);
    expect(tr.content).toContain('boom');
  });

  it('returns an unknown-tool error when the model invents a tool name', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'tool_use', id: 'tu_4', name: 'unknown', input: {} }],
      stop_reason: 'tool_use',
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'fine' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    await chat({
      model: 'm', system: 's', messages: [{ role: 'user', content: 'x' }], maxTokens: 10,
      tools: [{ kind: 'normalized', name: 'web_search', description: 'd', inputSchema: { type: 'object' } }],
    });

    const secondCallMessages = mockCreate.mock.calls[1][0].messages;
    const tr = secondCallMessages[secondCallMessages.length - 1].content[0];
    expect(tr.is_error).toBe(true);
    expect(tr.content).toContain('unknown');
  });
});

describe('Anthropic adapter — error wrapping', () => {
  it('wraps SDK errors as AdapterError with status and cause', async () => {
    const sdkErr = Object.assign(new Error('rate limit exceeded'), { status: 429 });
    mockCreate.mockRejectedValueOnce(sdkErr);

    let thrown;
    try {
      await chat({
        model: 'claude-test', system: 's',
        messages: [{ role: 'user', content: 'hi' }], maxTokens: 10,
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown.name).toBe('AdapterError');
    expect(thrown.provider).toBe('anthropic');
    expect(thrown.model).toBe('claude-test');
    expect(thrown.status).toBe(429);
    expect(thrown.message).toMatch(/Rate limited/);
    expect(thrown.cause).toBe(sdkErr);
  });
});

describe('Anthropic adapter — AbortSignal', () => {
  it('passes signal through to the SDK call', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const controller = new AbortController();
    await chat({
      model: 'm', system: 's', messages: [{ role: 'user', content: 'x' }],
      maxTokens: 10, signal: controller.signal,
    });
    // SDK call gets the signal in its options arg (second positional).
    expect(mockCreate.mock.calls[0][1]).toEqual({ signal: controller.signal });
  });

  it('throws immediately if the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('user cancelled'));
    await expect(chat({
      model: 'm', system: 's', messages: [{ role: 'user', content: 'x' }],
      maxTokens: 10, signal: controller.signal,
    })).rejects.toThrow(/user cancelled/);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('aborts mid-loop between turns', async () => {
    const controller = new AbortController();
    // Turn 1: tool call
    mockCreate.mockImplementationOnce(() => {
      controller.abort(new Error('cancelled'));
      return Promise.resolve({
        content: [{ type: 'tool_use', id: 't', name: 'web_search', input: {} }],
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 1 },
      });
    });
    await expect(chat({
      model: 'm', system: 's', messages: [{ role: 'user', content: 'x' }],
      maxTokens: 10, signal: controller.signal,
      tools: [{ kind: 'normalized', name: 'web_search', description: 'd', inputSchema: { type: 'object' } }],
      onToolCall: async () => ({}),
    })).rejects.toThrow(/cancelled/);
    expect(mockCreate).toHaveBeenCalledTimes(1); // didn't loop again
  });
});

describe('Anthropic adapter — streaming', () => {
  it('uses messages.stream() and emits text chunks via onText', async () => {
    const fakeStream = {
      on(event, cb) {
        if (event === 'text') { cb('Hello '); cb('world'); }
        return this;
      },
      async finalMessage() {
        return {
          content: [{ type: 'text', text: 'Hello world' }],
          usage: { input_tokens: 12, output_tokens: 4 },
        };
      },
    };
    mockStream.mockReturnValue(fakeStream);

    const chunks = [];
    const { text, usage } = await chat({
      model: 'claude-test', system: 's',
      messages: [{ role: 'user', content: 'hi' }], maxTokens: 100,
      onText: (c) => chunks.push(c),
    });

    expect(chunks).toEqual(['Hello ', 'world']);
    expect(text).toBe('Hello world');
    expect(usage).toEqual({ input: 12, output: 4, total: 16, turns: 1 });
    expect(mockCreate).not.toHaveBeenCalled(); // streaming bypasses .create
    expect(mockStream).toHaveBeenCalledTimes(1);
  });

  it('falls back to non-streaming path when tools are present', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'no stream' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    await chat({
      model: 'm', system: 's',
      messages: [{ role: 'user', content: 'x' }], maxTokens: 10,
      tools: [{ kind: 'normalized', name: 'web_search', description: 'd', inputSchema: { type: 'object' } }],
      onText: vi.fn(),
    });
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockStream).not.toHaveBeenCalled();
  });
});

describe('Anthropic adapter — usage accumulation', () => {
  it('sums input/output across multiple turns', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'tool_use', id: 't1', name: 'web_search', input: {} }],
      stop_reason: 'tool_use',
      usage: { input_tokens: 100, output_tokens: 20 },
    });
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'tool_use', id: 't2', name: 'web_search', input: {} }],
      stop_reason: 'tool_use',
      usage: { input_tokens: 200, output_tokens: 30 },
    });
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'done' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 300, output_tokens: 50 },
    });

    const { usage } = await chat({
      model: 'm', system: 's', messages: [{ role: 'user', content: 'x' }], maxTokens: 100,
      tools: [{ kind: 'normalized', name: 'web_search', description: 'd', inputSchema: { type: 'object' } }],
      onToolCall: async () => ({ ok: true }),
    });

    expect(usage).toEqual({ input: 600, output: 100, total: 700, turns: 3 });
  });
});

describe('Anthropic adapter — image content blocks', () => {
  it('translates normalized image blocks to Anthropic source format', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'two receipts' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 500, output_tokens: 20 },
    });

    await chat({
      model: 'claude-test', system: 's', maxTokens: 200,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Parse these.' },
          { type: 'image', mediaType: 'image/jpeg', data: 'abc123' },
        ],
      }],
    });

    const sentMessages = mockCreate.mock.calls[0][0].messages;
    const imageBlock = sentMessages[0].content[1];
    expect(imageBlock).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: 'abc123' },
    });
  });

  it('passes plain string content through unchanged', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 5, output_tokens: 2 },
    });

    await chat({
      model: 'm', system: 's', maxTokens: 50,
      messages: [{ role: 'user', content: 'just text' }],
    });

    const sentMessages = mockCreate.mock.calls[0][0].messages;
    expect(sentMessages[0].content).toBe('just text');
  });
});
