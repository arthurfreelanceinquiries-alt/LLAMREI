import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { ProviderCircuitBreaker } from '../ai/provider-health.ts';
import { getModelLatency, recordProviderAttempt } from '../ai/provider-metrics.ts';
import { closeDb, getDb, initDatabase } from '../db/connection.ts';
import {
  fetchLiveOllamaModels, invokeAiWithFallback, type ProviderAttempt, type UnifiedMessage,
} from '../services/ai-provider.service.ts';

const prompt: UnifiedMessage[] = [{ role: 'user', content: 'Synthetic fixture' }];
const localTags = 'http://127.0.0.1:11434/api/tags';
const localChat = 'http://127.0.0.1:11434/v1/chat/completions';
const localModel = 'qwen2.5:7b';
const sseHeaders = { 'Content-Type': 'text/event-stream' };
const encoder = new TextEncoder();
const data = (value: unknown) => `data: ${JSON.stringify(value)}\r\n\r\n`;
const frame = (delta: object, finish_reason: string | null = null) => data({ choices: [{ delta, finish_reason }] });
const done = 'data: [DONE]\n\n';
const hostedModel = { name: 'private-alias:latest', model: 'private-alias:latest', remote_host: 'https://ollama.invalid', remote_model: 'fixture' };

function setup(t: TestContext) {
  initDatabase(':memory:');
  t.after(closeDb);
}

function listLocalModels() {
  return Response.json({ models: [{ model: localModel }, hostedModel] });
}

test('SSE adapter streams UTF-8 before completion and reconstructs tools from bounded fragments', async (t) => {
  setup(t);
  let release!: () => void;
  let finished = false;
  let yielded!: () => void;
  const firstDelta = new Promise<void>((resolve) => { yielded = resolve; });
  const fetchImpl: typeof fetch = async (url, init) => {
    if (String(url) === localTags) return listLocalModels();
    assert.equal(String(url), localChat);
    const payload = JSON.parse(String(init?.body));
    assert.equal(payload.stream, true);
    assert.equal(payload.max_tokens, 2048);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of encoder.encode(frame({ content: 'Halo 🌿' }))) controller.enqueue(Uint8Array.of(byte));
        release = () => {
          controller.enqueue(encoder.encode(frame({ tool_calls: [{ index: 0, id: 'fixture-call', function: { name: 'find', arguments: '{"title":' } }] })));
          controller.enqueue(encoder.encode(frame({ tool_calls: [{ index: 0, function: { arguments: '"Contoh"}' } }] }, 'tool_calls')));
          controller.enqueue(encoder.encode(data({ choices: [], usage: { prompt_tokens: 20, completion_tokens: 5 } }) + done));
          controller.close();
        };
      },
    });
    return new Response(body, { headers: sseHeaders });
  };
  const invocation = invokeAiWithFallback(prompt, [], {
    providerOverride: 'ollama', fetchImpl,
    onDelta: (text) => {
      assert.equal(text, 'Halo 🌿');
      yielded();
    },
  }).finally(() => { finished = true; });
  await Promise.race([firstDelta, invocation.then(() => assert.fail('Adapter finished before a text delta arrived'))]);
  assert.equal(finished, false);
  release();
  const result = await invocation;
  assert.equal(result?.text, 'Halo 🌿');
  assert.deepEqual(result?.toolCalls, [{ id: 'fixture-call', name: 'find', args: { title: 'Contoh' } }]);
  assert.equal(result?.promptTokens, 20);
  const [metrics] = getModelLatency();
  assert.equal(metrics.streamedSamples, 1);
  assert.equal(metrics.attempts, 1);
  assert.ok(typeof metrics.firstTokenP95Ms === 'number');
});

test('a truncated stream and invalid tool arguments each fail before returning any tool call', async (t) => {
  setup(t);
  const fragment = { tool_calls: [{ index: 0, id: 'id', function: { name: 'find', arguments: '[]' } }] };
  for (const body of [frame(fragment), frame(fragment, 'tool_calls') + done]) {
    const attempts: ProviderAttempt[] = [];
    const result = await invokeAiWithFallback(prompt, [], {
      providerOverride: 'ollama', onDelta: () => undefined, onAttempt: (attempt) => attempts.push(attempt),
      fetchImpl: async (url) => String(url) === localTags ? listLocalModels() : new Response(body, { headers: sseHeaders }),
    });
    assert.equal(result, null);
    assert.equal(attempts.at(-1)?.code, 'invalid_response');
  }
  assert.equal(getModelLatency()[0].successes, 0);
});

test('an aborted stream stops the turn and does not count as a circuit breaker failure or latency success', async (t) => {
  setup(t);
  const controller = new AbortController();
  const fetchImpl: typeof fetch = async (url, init) => {
    if (String(url) === localTags) return listLocalModels();
    assert.ok(init?.signal);
    return new Response(frame({ content: 'Fixture' }, 'stop') + done, { headers: sseHeaders });
  };
  await assert.rejects(invokeAiWithFallback(prompt, [], {
    providerOverride: 'ollama', fetchImpl, signal: controller.signal, onDelta: () => controller.abort(),
  }), { name: 'AbortError' });
  const result = await invokeAiWithFallback(prompt, [], { providerOverride: 'ollama', fetchImpl, onDelta: () => undefined });
  assert.equal(result?.text, 'Fixture');
  assert.equal(getModelLatency()[0].attempts, 2);
  assert.equal(getModelLatency()[0].streamedSamples, 1);
});

test('router skips known unsupported tools, honors context limits and prefers a healthy zero-cost route', async (t) => {
  setup(t);
  const previous = process.env.OPENCODE_API_KEY;
  process.env.OPENCODE_API_KEY = 'fixture-key';
  t.after(() => { if (previous === undefined) delete process.env.OPENCODE_API_KEY; else process.env.OPENCODE_API_KEY = previous; });
  let limit = 2;
  let supportsTools = false;
  const fetchImpl: typeof fetch = async (url) => {
    if (String(url) === 'https://opencode.ai/zen/v1/models') {
      return Response.json({ data: [{
        id: 'big-pickle', type: 'chat', limit: { context: limit }, capabilities: { tools: { supported: supportsTools } },
        cost: { text: { input: { price: 0 }, output: { price: 0 } } },
      }] });
    }
    if (String(url) === localTags) return listLocalModels();
    if (String(url) === localChat) return Response.json({ choices: [{ message: { content: 'Local fixture' } }] });
    assert.fail(`Unexpected provider dispatch for ${url}`);
  };
  const tools = [{ name: 'fixture_tool', description: 'Fixture', parameters: { type: 'object' } }];
  const unsupported = await invokeAiWithFallback(prompt, tools, { providerOverride: 'auto', fetchImpl });
  assert.equal(unsupported?.attempts.find(({ provider }) => provider === 'opencode_zen')?.code, 'unsupported_tool');
  assert.equal(unsupported?.providerUsed, 'ollama');
  supportsTools = true;
  const exceeded = await invokeAiWithFallback(prompt, tools, { providerOverride: 'auto', fetchImpl });
  assert.equal(exceeded?.attempts.find(({ provider }) => provider === 'opencode_zen')?.code, 'context_limit');
  assert.equal(exceeded?.providerUsed, 'ollama');

  limit = 32_000;
  const requests: string[] = [];
  const rateLimited: typeof fetch = async (url, init) => {
    requests.push(String(url));
    if (String(url).endsWith('opencode.ai/zen/v1/chat/completions')) return new Response('Provider private diagnostic', { status: 429 });
    return fetchImpl(url, init);
  };
  const first = await invokeAiWithFallback(prompt, tools, { providerOverride: 'auto', fetchImpl: rateLimited });
  const second = await invokeAiWithFallback(prompt, tools, { providerOverride: 'auto', fetchImpl: rateLimited });
  assert.equal(first?.attempts.find(({ provider }) => provider === 'opencode_zen')?.code, 'rate_limited');
  assert.equal(second?.attempts.find(({ provider }) => provider === 'opencode_zen')?.code, 'circuit_open');
  assert.equal(requests.filter((url) => url.endsWith('opencode.ai/zen/v1/chat/completions')).length, 1);
  assert.ok(!JSON.stringify(first?.attempts).includes('Provider private diagnostic'));
});

test('only installed local Ollama models receive conversation data, including when cloud consent is enabled', async (t) => {
  setup(t);
  const requests: string[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    requests.push(String(url));
    assert.equal(init?.redirect, 'error');
    assert.equal(init?.body, undefined);
    return listLocalModels();
  };
  assert.deepEqual(await fetchLiveOllamaModels('http://outside.invalid/v1', true, fetchImpl), { models: [], online: false });
  assert.deepEqual(requests, []);
  getDb().prepare("INSERT INTO app_settings (key, value_json) VALUES ('ai_allow_cloud_chat_context', 'true')").run();
  for (const modelOverride of [hostedModel.name, 'uninstalled:latest', 'example:cloud']) {
    assert.equal(await invokeAiWithFallback(prompt, [], { providerOverride: 'ollama', modelOverride, fetchImpl, containsPrivateContext: true }), null);
  }
  assert.deepEqual(requests, [localTags, localTags]);
});

test('breaker allows exactly one half-open probe and latency percentiles use successful text samples', (t) => {
  setup(t);
  let now = 0;
  const circuit = new ProviderCircuitBreaker(() => now);
  circuit.finish('model', circuit.claim('model')!, 'rate_limited', 45_000);
  now = 44_999;
  assert.equal(circuit.claim('model'), null);
  now++;
  const probe = circuit.claim('model');
  assert.deepEqual(probe, { probe: true });
  assert.equal(circuit.claim('model'), null);
  circuit.finish('model', probe!, 'success');
  assert.deepEqual(circuit.claim('model'), { probe: false });

  for (const tokenMs of [1, 20, 40, 200]) recordProviderAttempt('ollama', 'small:latest', 'success', 500, tokenMs);
  recordProviderAttempt('ollama', 'small:latest', 'timeout', 600, 400);
  recordProviderAttempt('ollama', 'small:latest', 'success', 500, null);
  assert.deepEqual(getModelLatency(), [{
    provider: 'ollama', model: 'small:latest', successes: 5, attempts: 6, streamedSamples: 4, firstTokenP50Ms: 20, firstTokenP95Ms: 200,
  }]);
});
