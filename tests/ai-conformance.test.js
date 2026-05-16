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
import { PROVIDERS } from '../src/lib/server/providers.js';

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
  },
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
