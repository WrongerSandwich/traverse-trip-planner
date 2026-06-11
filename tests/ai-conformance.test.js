// Cross-cutting conformance suite for the supportsImages contract.
//
// `providers.js` advertises a `supportsImages` flag per adapter. The contract
// (introduced in #60) is: if `supportsImages: true`, the adapter MUST translate
// normalized `{type:'image', mediaType, data}` content blocks to the provider's
// wire format. Each adapter has its own unit test that exercises image
// translation, but nothing prevents a future adapter from declaring
// `supportsImages: true` and shipping without the translation step.
//
// This suite is data-driven from `PROVIDERS` so a new adapter automatically
// gets included. Failing to implement translation produces a clear test
// failure with the provider's name. Per-adapter unit tests still cover wire
// format edge cases, streaming, tool loops, and error paths — this file just
// pins down the cross-cutting contract.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PROVIDERS, MAX_CUMULATIVE_OUTPUT_TOKENS } from '../src/lib/server/providers.js';
import { TraverseError } from '../src/lib/server/errors.js';

// Block any settings.json overlay from leaking real API keys into resolveEnv().
vi.mock('node:fs', () => ({
  readFileSync: () => { throw new Error('ENOENT'); },
  writeFileSync: () => {},
}));

// Anthropic adapter: mock the SDK class so `client.messages.create` is a spy
// that records the payload synchronously. Hoisted so the factory below resolves.
const { mockAnthropicCreate } = vi.hoisted(() => ({
  mockAnthropicCreate: vi.fn(),
}));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    constructor() { this.messages = { create: mockAnthropicCreate, stream: vi.fn() }; }
  },
}));

// Build an OpenAI-compatible fetch mock for a bounded tool loop: first turn is
// a tool call, second turn is a normal stop. Shared by the openai + openrouter
// harnesses (identical wire format).
function openAiCompatBoundedLoopFetch() {
  const jsonOf = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => '' });
  return vi.fn()
    .mockResolvedValueOnce(jsonOf({
      choices: [{
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'web_search', arguments: '{"query":"x"}' } }],
        },
        finish_reason: 'tool_calls',
      }],
      usage: { prompt_tokens: 10, completion_tokens: 500 },
    }))
    .mockResolvedValueOnce(jsonOf({
      choices: [{ message: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 20, completion_tokens: 50 },
    }));
}

// Each per-provider harness is a small adapter-of-an-adapter: it sets up the
// right mock (SDK class or fetch), invokes the chat() function, then returns
// the captured request body. The conformance assertions consume only that
// captured body, so the suite stays agnostic about the underlying transport.
const harnesses = {
  anthropic: {
    envKey: 'ANTHROPIC_API_KEY',
    envValue: 'sk-ant-test',
    modulePath: '../src/lib/server/ai/anthropic.js',
    model: 'claude-test',
    beforeEach() {
      mockAnthropicCreate.mockReset();
      mockAnthropicCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1 },
      });
    },
    capturedRequest() {
      expect(mockAnthropicCreate).toHaveBeenCalledTimes(1);
      return mockAnthropicCreate.mock.calls[0][0];
    },
    assertImageBlock(req) {
      const content = req.messages[0].content;
      const imageBlock = content[1];
      expect(imageBlock.type, `${this.modulePath} image block type`).toBe('image');
      expect(imageBlock.source?.type, `${this.modulePath} source.type`).toBe('base64');
      expect(imageBlock.source?.media_type, `${this.modulePath} source.media_type`).toBe('image/jpeg');
      expect(imageBlock.source?.data, `${this.modulePath} source.data`).toBe('aGVsbG8=');
    },
    // Set up a loop that never naturally terminates: every turn is a tool_use
    // emitting `perTurnOutput` output tokens, so the cumulative ceiling is the
    // only thing that can stop it.
    setupRunawayLoop(perTurnOutput) {
      mockAnthropicCreate.mockReset();
      mockAnthropicCreate.mockResolvedValue({
        content: [{ type: 'tool_use', id: 'tu_loop', name: 'web_search', input: { query: 'x' } }],
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: perTurnOutput },
      });
    },
    setupBoundedLoop() {
      mockAnthropicCreate.mockReset();
      mockAnthropicCreate.mockResolvedValueOnce({
        content: [{ type: 'tool_use', id: 'tu_1', name: 'web_search', input: { query: 'x' } }],
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 500 },
      });
      mockAnthropicCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'done' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 20, output_tokens: 50 },
      });
    },
  },
  openai: {
    envKey: 'OPENAI_API_KEY',
    envValue: 'sk-openai-test',
    modulePath: '../src/lib/server/ai/openai.js',
    model: 'gpt-test',
    beforeEach() {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
        text: async () => '',
      });
    },
    capturedRequest() {
      expect(fetch).toHaveBeenCalledTimes(1);
      return JSON.parse(fetch.mock.calls[0][1].body);
    },
    assertImageBlock(req) {
      const userMsg = req.messages.find(m => m.role === 'user');
      const imageBlock = userMsg.content[1];
      expect(imageBlock.type, 'openai image block type').toBe('image_url');
      expect(typeof imageBlock.image_url?.url, 'openai image_url.url type').toBe('string');
      expect(imageBlock.image_url.url.startsWith('data:image/jpeg;base64,'),
        `openai image_url.url should be a data URI, got ${imageBlock.image_url.url}`).toBe(true);
      expect(imageBlock.image_url.url.endsWith('aGVsbG8=')).toBe(true);
    },
    setupRunawayLoop(perTurnOutput) {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [{ id: 'call_loop', type: 'function', function: { name: 'web_search', arguments: '{"query":"x"}' } }],
            },
            finish_reason: 'tool_calls',
          }],
          usage: { prompt_tokens: 10, completion_tokens: perTurnOutput },
        }),
        text: async () => '',
      });
    },
    setupBoundedLoop() {
      global.fetch = openAiCompatBoundedLoopFetch();
    },
  },
  openrouter: {
    envKey: 'OPENROUTER_API_KEY',
    envValue: 'sk-or-test',
    modulePath: '../src/lib/server/ai/openrouter.js',
    model: 'anthropic/claude-3.5-sonnet',
    beforeEach() {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
        text: async () => '',
      });
    },
    capturedRequest() {
      expect(fetch).toHaveBeenCalledTimes(1);
      return JSON.parse(fetch.mock.calls[0][1].body);
    },
    assertImageBlock(req) {
      const userMsg = req.messages.find(m => m.role === 'user');
      const imageBlock = userMsg.content[1];
      expect(imageBlock.type, 'openrouter image block type').toBe('image_url');
      expect(typeof imageBlock.image_url?.url, 'openrouter image_url.url type').toBe('string');
      expect(imageBlock.image_url.url.startsWith('data:image/jpeg;base64,'),
        `openrouter image_url.url should be a data URI, got ${imageBlock.image_url.url}`).toBe(true);
      expect(imageBlock.image_url.url.endsWith('aGVsbG8=')).toBe(true);
    },
    setupRunawayLoop(perTurnOutput) {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [{ id: 'call_loop', type: 'function', function: { name: 'web_search', arguments: '{"query":"x"}' } }],
            },
            finish_reason: 'tool_calls',
          }],
          usage: { prompt_tokens: 10, completion_tokens: perTurnOutput },
        }),
        text: async () => '',
      });
    },
    setupBoundedLoop() {
      global.fetch = openAiCompatBoundedLoopFetch();
    },
  },
};

// A normalized tool both wire formats accept (openai-compat rejects
// anthropic-native tools; anthropic accepts normalized). Used to keep the
// runaway loop turning until the cumulative ceiling aborts it.
const LOOP_TOOL = {
  kind: 'normalized',
  name: 'web_search',
  description: 'search the web',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
};

// Tripwire: every entry in PROVIDERS must have a corresponding harness here. If
// a future contributor adds a provider to providers.js but forgets to extend
// this suite, fail loudly so the omission can't slip through code review.
describe('conformance harness coverage', () => {
  it('has a harness entry for every provider in PROVIDERS', () => {
    const providerNames = Object.keys(PROVIDERS);
    const harnessNames = Object.keys(harnesses);
    for (const name of providerNames) {
      expect(harnessNames, `harness missing for provider "${name}" — add an entry to harnesses{} in this file`).toContain(name);
    }
  });
});

// Drive the conformance suite straight from PROVIDERS so a new adapter
// automatically gets included. The describe.each pattern groups each
// provider's assertions under its own block in the test output.
const providerEntries = Object.entries(PROVIDERS).filter(([name]) => harnesses[name]);

describe.each(providerEntries)(
  'conformance: %s adapter',
  (providerName, meta) => {
    const harness = harnesses[providerName];

    beforeEach(() => {
      process.env[harness.envKey] = harness.envValue;
      harness.beforeEach();
    });

    // Cross-cutting cost-control contract (#495): the per-call maxTokens ceiling
    // doesn't bound a multi-turn tool loop, so each adapter must abort with a
    // typed `max_tokens_exceeded` failure once the cumulative *output* tokens
    // across turns exceed MAX_CUMULATIVE_OUTPUT_TOKENS — and the partial usage
    // must be attached so chat() can record the real multi-turn cost.
    it('aborts the tool loop with a typed max_tokens_exceeded failure once cumulative output exceeds the ceiling', async () => {
      const { chat } = await import(harness.modulePath);
      // Two turns of (ceiling/2 + 1) output tokens overshoot the ceiling, so the
      // loop must abort on the second turn — well before MAX_TOOL_TURNS.
      const perTurnOutput = Math.floor(MAX_CUMULATIVE_OUTPUT_TOKENS / 2) + 1;
      harness.setupRunawayLoop(perTurnOutput);

      let thrown;
      try {
        await chat({
          model: harness.model,
          system: 's',
          maxTokens: 8000,
          messages: [{ role: 'user', content: 'search forever' }],
          tools: [LOOP_TOOL],
          onToolCall: async () => ({ ok: true }),
        });
      } catch (err) {
        thrown = err;
      }

      expect(thrown, `${providerName} should abort the runaway loop`).toBeInstanceOf(TraverseError);
      expect(thrown.code, `${providerName} abort code`).toBe('max_tokens_exceeded');
      // Partial usage rides along so workflow stats record the real cost.
      expect(thrown.usage?.output, `${providerName} should attach cumulative output usage`).toBeGreaterThan(MAX_CUMULATIVE_OUTPUT_TOKENS);
    });

    it('does not abort a legitimate multi-turn loop that stays under the ceiling', async () => {
      const { chat } = await import(harness.modulePath);
      // Each turn emits a modest output; a couple of turns stays well under the
      // ceiling, then the loop terminates normally.
      harness.setupBoundedLoop();

      const { text, usage } = await chat({
        model: harness.model,
        system: 's',
        maxTokens: 8000,
        messages: [{ role: 'user', content: 'search a bit' }],
        tools: [LOOP_TOOL],
        onToolCall: async () => ({ ok: true }),
      });

      expect(usage.output, `${providerName} bounded loop output`).toBeLessThanOrEqual(MAX_CUMULATIVE_OUTPUT_TOKENS);
      expect(typeof text, `${providerName} bounded loop returns text`).toBe('string');
    });

    if (meta.supportsImages) {
      it('translates {type:"image"} content blocks to the provider wire format', async () => {
        const { chat } = await import(harness.modulePath);

        await chat({
          model: harness.model,
          system: 's',
          maxTokens: 100,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: 'Parse this.' },
              { type: 'image', mediaType: 'image/jpeg', data: 'aGVsbG8=' },
            ],
          }],
        });

        const captured = harness.capturedRequest();
        harness.assertImageBlock(captured);
      });

      it('passes plain string content through unchanged', async () => {
        const { chat } = await import(harness.modulePath);

        await chat({
          model: harness.model,
          system: 's',
          maxTokens: 50,
          messages: [{ role: 'user', content: 'plain text' }],
        });

        const captured = harness.capturedRequest();
        const userMsg = providerName === 'anthropic'
          ? captured.messages[0]
          : captured.messages.find(m => m.role === 'user');
        expect(userMsg.content, `${providerName} should pass strings through unchanged`).toBe('plain text');
      });
    } else {
      // Tripwire for the future: if a provider is added with
      // supportsImages:false, calling chat() with an image block should be
      // refused at the dispatch layer (see tests/ai.test.js). The per-adapter
      // contract here is that the adapter is never reached with image content.
      // We exercise it directly to make sure if someone bypasses the dispatch
      // wrapper, the adapter behavior on image input is at least surfaced —
      // the assertion is intentionally loose because each adapter may choose
      // its own failure mode (throw, pass-through, etc.) for that case.
      it('rejects image-bearing input (supportsImages: false tripwire)', async () => {
        const { chat: dispatchChat } = await import('../src/lib/server/ai.js');
        await expect(dispatchChat({
          provider: providerName,
          model: harness.model,
          system: 's',
          maxTokens: 100,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: 'parse' },
              { type: 'image', mediaType: 'image/jpeg', data: 'aGVsbG8=' },
            ],
          }],
        })).rejects.toThrow(/does not support image input/);
      });
    }
  },
);
