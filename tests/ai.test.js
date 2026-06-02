import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Block settings.json on disk from leaking real API keys into resolveEnv().
// The Anthropic adapter constructs its SDK client lazily inside chat(), so if a
// real ANTHROPIC_API_KEY is present in process.env or settings.json the
// constructor still succeeds — but we'd rather not depend on that. Keep tests
// deterministic regardless of the host environment.
vi.mock('node:fs', () => ({
  readFileSync: () => { throw new Error('ENOENT'); },
  writeFileSync: () => {},
  // workflow-stats.js (imported transitively via ai.js) auto-creates a
  // `.cache/` dir on load and runs a one-shot legacy-file migration; mock
  // the calls so the test stays hermetic and doesn't touch the real FS.
  existsSync: () => false,
  mkdirSync: () => {},
  renameSync: () => {},
}));

// vi.hoisted shares state with the vi.mock factory below; the same factory
// fires for both `import * as anthropic from './ai/anthropic.js'` in ai.js and
// for any direct test access.
const { mockAnthropicChat, mockOpenAIChat, mockOpenRouterChat } = vi.hoisted(() => ({
  mockAnthropicChat: vi.fn(),
  mockOpenAIChat: vi.fn(),
  mockOpenRouterChat: vi.fn(),
}));

vi.mock('../src/lib/server/ai/anthropic.js', () => ({
  chat: mockAnthropicChat,
}));
vi.mock('../src/lib/server/ai/openai.js', () => ({
  chat: mockOpenAIChat,
}));
vi.mock('../src/lib/server/ai/openrouter.js', () => ({
  chat: mockOpenRouterChat,
}));

// Pull chat() after the mocks are installed. ai.js wires up adapters at module
// load using `import * as` for each adapter, which the factories above replace.
const { chat } = await import('../src/lib/server/ai.js');

beforeEach(() => {
  mockAnthropicChat.mockReset();
  mockOpenAIChat.mockReset();
  mockOpenRouterChat.mockReset();
});

describe('chat() dispatch — provider lookup', () => {
  it('throws when provider is not a key in PROVIDERS', async () => {
    await expect(chat({
      provider: 'not-a-real-provider',
      model: 'm',
      system: 's',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 10,
    })).rejects.toThrow(/No AI adapter registered for provider "not-a-real-provider"/);
  });

  it('dispatches to the correct adapter by provider name', async () => {
    mockOpenAIChat.mockResolvedValueOnce({ text: 'from openai', usage: { input: 1, output: 1, total: 2, turns: 1 } });
    await chat({
      provider: 'openai',
      model: 'gpt-test',
      system: 's',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 10,
    });
    expect(mockOpenAIChat).toHaveBeenCalledTimes(1);
    expect(mockAnthropicChat).not.toHaveBeenCalled();
    expect(mockOpenRouterChat).not.toHaveBeenCalled();
  });
});

describe('chat() dispatch — image guard', () => {
  it('throws when content contains an image block and the provider is image-incapable', async () => {
    // Re-import PROVIDERS + ai.js with a stubbed providers.js that injects an
    // image-incapable provider. vi.resetModules() clears the module cache so
    // the new mock factory is honored on re-import.
    vi.resetModules();

    vi.doMock('../src/lib/server/providers.js', () => ({
      PROVIDERS: {
        // Keep an adapter-backed key so ai.js's startup invariant is satisfied
        // — we map the synthetic provider onto an existing adapter module.
        anthropic: { envKey: 'ANTHROPIC_API_KEY', supportsImages: false },
        openai: { envKey: 'OPENAI_API_KEY', supportsImages: true },
        openrouter: { envKey: 'OPENROUTER_API_KEY', supportsImages: true },
      },
    }));
    // Re-mock the adapters under the freshly reset module registry so the new
    // ai.js import wires through them rather than reaching the real modules.
    vi.doMock('../src/lib/server/ai/anthropic.js', () => ({ chat: mockAnthropicChat }));
    vi.doMock('../src/lib/server/ai/openai.js', () => ({ chat: mockOpenAIChat }));
    vi.doMock('../src/lib/server/ai/openrouter.js', () => ({ chat: mockOpenRouterChat }));

    const { chat: chatWithStub } = await import('../src/lib/server/ai.js');

    await expect(chatWithStub({
      provider: 'anthropic',
      model: 'm',
      system: 's',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'parse this' },
          { type: 'image', mediaType: 'image/jpeg', data: 'aGVsbG8=' },
        ],
      }],
      maxTokens: 10,
    })).rejects.toThrow(/Configured provider "anthropic" does not support image input/);

    // Guard fires at dispatch time, before the adapter is invoked.
    expect(mockAnthropicChat).not.toHaveBeenCalled();

    vi.doUnmock('../src/lib/server/providers.js');
    vi.resetModules();
  });

  it('does not throw on image content when the provider supports images', async () => {
    mockAnthropicChat.mockResolvedValueOnce({ text: 'ok', usage: { input: 1, output: 1, total: 2, turns: 1 } });
    await expect(chat({
      provider: 'anthropic',
      model: 'm',
      system: 's',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'parse this' },
          { type: 'image', mediaType: 'image/jpeg', data: 'aGVsbG8=' },
        ],
      }],
      maxTokens: 10,
    })).resolves.toBeDefined();
  });

  it('does not throw on text-only content regardless of supportsImages flag', async () => {
    mockAnthropicChat.mockResolvedValueOnce({ text: 'ok', usage: { input: 1, output: 1, total: 2, turns: 1 } });
    await chat({
      provider: 'anthropic',
      model: 'm',
      system: 's',
      messages: [{ role: 'user', content: 'just a string' }],
      maxTokens: 10,
    });
    expect(mockAnthropicChat).toHaveBeenCalledTimes(1);
  });
});

describe('chat() dispatch — adapter-import invariant', () => {
  // ai.js builds `adapters` at module load by mapping every PROVIDERS key to an
  // imported adapter module. If a provider is declared without a matching
  // adapter import in ai.js, the lookup throws at startup. Verify that error
  // shape by mocking providers.js to introduce an unmapped key, then
  // re-importing ai.js.
  it('throws at module load when a PROVIDERS key has no adapter module', async () => {
    vi.resetModules();

    vi.doMock('../src/lib/server/providers.js', () => ({
      PROVIDERS: {
        anthropic: { envKey: 'ANTHROPIC_API_KEY', supportsImages: true },
        openai: { envKey: 'OPENAI_API_KEY', supportsImages: true },
        openrouter: { envKey: 'OPENROUTER_API_KEY', supportsImages: true },
        // Synthetic provider with no matching `import * as <name>` in ai.js.
        ghost: { envKey: 'GHOST_API_KEY', supportsImages: true },
      },
    }));

    await expect(import('../src/lib/server/ai.js')).rejects.toThrow(
      /No adapter module imported for provider "ghost"/,
    );

    vi.doUnmock('../src/lib/server/providers.js');
    vi.resetModules();
  });
});

describe('chat() dispatch — logging', () => {
  let logSpy;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('logs the [ai] <label> <provider>/<model> ... line on success', async () => {
    mockAnthropicChat.mockResolvedValueOnce({
      text: 'hi',
      usage: { input: 100, output: 25, total: 125, turns: 2 },
    });
    await chat({
      provider: 'anthropic',
      model: 'claude-test',
      system: 's',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 10,
      label: 'receipts',
    });
    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = logSpy.mock.calls[0][0];
    // Format the smoke probe + PM2 log greppers depend on.
    expect(line).toMatch(/^\[ai\] receipts anthropic\/claude-test —/);
    expect(line).toMatch(/100 in/);
    expect(line).toMatch(/25 out/);
    expect(line).toMatch(/2 turns/);
    expect(line).toMatch(/\d+ms\)$/);
  });

  it('omits the label prefix when no label is passed', async () => {
    mockAnthropicChat.mockResolvedValueOnce({
      text: 'hi',
      usage: { input: 1, output: 1, total: 2, turns: 1 },
    });
    await chat({
      provider: 'anthropic',
      model: 'claude-test',
      system: 's',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 10,
    });
    const line = logSpy.mock.calls[0][0];
    // No leading "<label> " between "[ai]" and the provider/model.
    expect(line).toMatch(/^\[ai\] anthropic\/claude-test —/);
    // Single-turn renders the singular "1 turn" (not "1 turns").
    expect(line).toMatch(/1 turn,/);
  });

  it('defaults usage input/output to zero when the adapter omits usage', async () => {
    mockAnthropicChat.mockResolvedValueOnce({ text: 'hi', usage: undefined });
    await chat({
      provider: 'anthropic',
      model: 'm',
      system: 's',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 10,
    });
    const line = logSpy.mock.calls[0][0];
    expect(line).toMatch(/0 in/);
    expect(line).toMatch(/0 out/);
    // Falls through to the default turn count when usage is missing.
    expect(line).toMatch(/\d+ms\)$/);
  });

  it('logs a [ai] turn N: line when the adapter emits a type:turn event', async () => {
    // Simulate an adapter that emits a turn event via the onActivity callback.
    mockAnthropicChat.mockImplementationOnce(async ({ onActivity }) => {
      onActivity?.({ type: 'turn', turn: 3, elapsed_ms: 14823, input: 12450, output: 187, tool_used: 'web_search' });
      return { text: 'done', usage: { input: 12450, output: 187, total: 12637, turns: 3 } };
    });
    await chat({
      provider: 'anthropic',
      model: 'claude-test',
      system: 's',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 10,
      label: 'deepen',
    });
    // First console.log call is the turn line; second is the summary line.
    const turnLine = logSpy.mock.calls[0][0];
    expect(turnLine).toMatch(/^\[ai\] deepen turn 3:/);
    expect(turnLine).toMatch(/14823ms/);
    expect(turnLine).toMatch(/12450 in/);
    expect(turnLine).toMatch(/187 out/);
    expect(turnLine).toMatch(/tool=web_search/);
  });

  it('logs no-tool when tool_used is null on a turn event', async () => {
    mockAnthropicChat.mockImplementationOnce(async ({ onActivity }) => {
      onActivity?.({ type: 'turn', turn: 7, elapsed_ms: 5102, input: 14102, output: 1178, tool_used: null });
      return { text: 'done', usage: { input: 14102, output: 1178, total: 15280, turns: 7 } };
    });
    await chat({
      provider: 'anthropic',
      model: 'claude-test',
      system: 's',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 10,
      label: 'deepen',
    });
    const turnLine = logSpy.mock.calls[0][0];
    expect(turnLine).toMatch(/^\[ai\] deepen turn 7:/);
    expect(turnLine).toMatch(/no-tool/);
  });

  it('passes turn events through to the caller onActivity after logging', async () => {
    const callerActivity = vi.fn();
    const turnEvent = { type: 'turn', turn: 1, elapsed_ms: 100, input: 50, output: 10, tool_used: null };
    mockAnthropicChat.mockImplementationOnce(async ({ onActivity }) => {
      onActivity?.(turnEvent);
      return { text: 'x', usage: { input: 50, output: 10, total: 60, turns: 1 } };
    });
    await chat({
      provider: 'anthropic',
      model: 'm',
      system: 's',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 10,
      onActivity: callerActivity,
    });
    expect(callerActivity).toHaveBeenCalledWith(turnEvent);
  });

  it('omits label prefix in turn log line when no label is provided', async () => {
    mockAnthropicChat.mockImplementationOnce(async ({ onActivity }) => {
      onActivity?.({ type: 'turn', turn: 1, elapsed_ms: 200, input: 10, output: 5, tool_used: null });
      return { text: 'x', usage: { input: 10, output: 5, total: 15, turns: 1 } };
    });
    await chat({
      provider: 'anthropic',
      model: 'm',
      system: 's',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 10,
    });
    const turnLine = logSpy.mock.calls[0][0];
    expect(turnLine).toMatch(/^\[ai\] turn 1:/);
  });
});

describe('chat() dispatch — pass-through', () => {
  it('returns the adapter result unchanged (text + usage)', async () => {
    const adapterResult = {
      text: 'verbatim',
      usage: { input: 42, output: 7, total: 49, turns: 3 },
    };
    mockOpenAIChat.mockResolvedValueOnce(adapterResult);

    const result = await chat({
      provider: 'openai',
      model: 'gpt-test',
      system: 's',
      messages: [{ role: 'user', content: 'go' }],
      maxTokens: 10,
    });

    expect(result.text).toBe('verbatim');
    expect(result.usage).toEqual(adapterResult.usage);
  });

  it('forwards every chat option through to the adapter (minus provider)', async () => {
    mockOpenAIChat.mockResolvedValueOnce({ text: '', usage: { input: 1, output: 1, total: 2, turns: 1 } });
    const onText = vi.fn();
    const onToolCall = vi.fn();
    const onActivity = vi.fn();
    const signal = new AbortController().signal;
    const tools = [{ kind: 'normalized', name: 'web_search', description: 'd', inputSchema: { type: 'object' } }];

    await chat({
      provider: 'openai',
      model: 'gpt-test',
      system: 'be terse',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 250,
      tools,
      onToolCall,
      onActivity,
      signal,
      onText,
      label: 'unit',
    });

    expect(mockOpenAIChat).toHaveBeenCalledTimes(1);
    const args = mockOpenAIChat.mock.calls[0][0];
    expect(args.model).toBe('gpt-test');
    expect(args.system).toBe('be terse');
    expect(args.messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(args.maxTokens).toBe(250);
    expect(args.tools).toBe(tools);
    expect(args.onToolCall).toBe(onToolCall);
    // onActivity is wrapped by the dispatcher to intercept 'turn' events for
    // logging; verify it passes non-turn events through to the caller.
    expect(args.onActivity).toBeTypeOf('function');
    expect(args.onActivity).not.toBe(onActivity); // wrapped, not the raw ref
    const otherEvent = { type: 'tool_call', name: 'x', input: {} };
    args.onActivity(otherEvent);
    expect(onActivity).toHaveBeenCalledWith(otherEvent);
    expect(args.signal).toBe(signal);
    expect(args.onText).toBe(onText);
    // provider and label are dispatch-layer concerns and are not forwarded.
    expect(args).not.toHaveProperty('provider');
    expect(args).not.toHaveProperty('label');
  });
});
