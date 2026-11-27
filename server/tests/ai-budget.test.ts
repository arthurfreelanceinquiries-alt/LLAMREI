import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { closeDb, getDb, initDatabase } from '../db/connection.ts';
import {
  getAiBudgetSummary,
  invokeAiWithFallback,
  parseOpenCodeCatalogJson,
  type UnifiedMessage,
} from '../services/ai-provider.service.ts';

const messages: UnifiedMessage[] = [{ role: 'user', content: 'Fixture prompt' }];
const opencodeCatalog = 'https://opencode.ai/zen/v1/models';
const openrouterCatalog = 'https://openrouter.ai/api/v1/models';
const openrouterModel = 'example/fixture:free';

function setup(t: TestContext): void {
  initDatabase(':memory:');
  for (const key of ['OPENCODE_API_KEY', 'OPENROUTER_API_KEY', 'GROQ_API_KEY', 'GEMINI_API_KEY']) {
    const previous = process.env[key];
    process.env[key] = 'fixture-key';
    t.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
  }
  t.after(() => closeDb());
}

function setting(key: string, value: unknown): void {
  getDb().prepare(`INSERT INTO app_settings (key, value_json) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`).run(key, JSON.stringify(value));
}

function completion(cost?: number): Response {
  return Response.json({
    choices: [{ message: { content: 'Fixture response' } }],
    usage: { prompt_tokens: 19, completion_tokens: 5, ...(cost === undefined ? {} : { cost }) },
  });
}

test('free-only runs OpenCode only when current catalog verifies the exact model and all meters', async (t) => {
  setup(t);
  const selected = 'fixture-free';
  const paidCache = { text: { input: { price: 0 }, output: { price: 0 }, cache: { price: 1 } } };
  assert.deepEqual(parseOpenCodeCatalogJson({
    data: [{ id: selected, type: 'chat', cost: paidCache }, { id: 'big-pickle', type: 'chat' }],
  }), []);

  for (const cost of [undefined, paidCache, { text: { input: { price: 0 }, output: { price: 0 } } }]) {
    const requests: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      requests.push(url);
      if (url === opencodeCatalog) {
        assert.equal(init?.body, undefined);
        return Response.json({ data: [{ id: selected, type: 'chat', cost }] });
      }
      return completion();
    };
    const result = await invokeAiWithFallback(messages, [], {
      providerOverride: 'opencode_zen',
      modelOverride: selected,
      fetchImpl,
    });
    if (!cost || cost === paidCache) {
      assert.equal(result, null);
      assert.deepEqual(requests, [opencodeCatalog]);
    } else {
      assert.equal(result?.isFreeTier, true);
      assert.deepEqual(requests, [opencodeCatalog, 'https://opencode.ai/zen/v1/chat/completions']);
    }
  }
  assert.equal(getAiBudgetSummary().callsCount, 1);
});

test('free-only rejects priced or unverified OpenRouter models before dispatch', async (t) => {
  setup(t);
  const requests: string[] = [];
  const pricing = [
    { prompt: '0', completion: '0.001' },
    { prompt: '???', completion: '0' },
    { prompt: '0', completion: '0', overrides: [{ prompt: '0.002' }] },
    { prompt: '0', completion: '0', internal_reasoning: '0.003' },
  ];
  for (const item of pricing) {
    const result = await invokeAiWithFallback(messages, [], {
      providerOverride: 'openrouter',
      modelOverride: openrouterModel,
      fetchImpl: async (input) => {
        requests.push(String(input));
        return Response.json({ data: [{ id: openrouterModel, pricing: item }] });
      },
    });
    assert.equal(result, null);
  }
  assert.deepEqual(requests, pricing.map(() => openrouterCatalog));
  assert.equal(getAiBudgetSummary().callsCount, 0);
});

test('OpenRouter uses zero routing ceilings, records actual cost separately and blocks a billing mismatch', async (t) => {
  setup(t);
  setting('ai_monthly_budget_usd', 0.03);
  getDb().prepare(`INSERT INTO ai_usage_ledger
      (id, provider, model, feature, prompt_tokens, completion_tokens, estimated_cost_usd)
    VALUES ('legacy', 'gemini', 'fixture', 'agent', 1, 1, 0.01)`).run();

  let cost = 0;
  const requests: Array<{ url: string; body?: string }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, body: init?.body as string | undefined });
    if (url === openrouterCatalog) {
      return Response.json({ data: [{ id: openrouterModel, pricing: { prompt: '0', completion: '0.0', request: '0' } }] });
    }
    return completion(cost);
  };

  const options = { providerOverride: 'openrouter' as const, modelOverride: openrouterModel, fetchImpl };
  assert.equal((await invokeAiWithFallback(messages, [], options))?.actualCostUsd, 0);
  const posted = JSON.parse(requests[1].body!);
  assert.deepEqual(posted.provider, {
    allow_fallbacks: false,
    max_price: { prompt: '0', completion: '0', request: '0', image: '0', audio: '0' },
  });

  cost = 0.04;
  assert.equal(await invokeAiWithFallback(messages, [], options), null);
  assert.equal(await invokeAiWithFallback(messages, [], options), null);
  assert.equal(requests.length, 4, 'a reported charge disables further requests for that route');
  assert.deepEqual(getAiBudgetSummary(), {
    monthlySpentUsd: 0.05,
    monthlyCapUsd: 0.03,
    remainingUsd: 0,
    blocked: true,
    callsCount: 3,
    actualSpentUsd: 0.04,
    estimatedSpentUsd: 0.01,
  });
});

test('verified billing consent cannot enable unknown prices and loopback Ollama remains usable at zero cap', async (t) => {
  setup(t);
  setting('paid_billing_verified', true);
  setting('ai_monthly_budget_usd', 0);

  const requests: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    requests.push(String(input));
    assert.equal(init?.redirect, 'error');
    return completion();
  };
  for (const providerOverride of ['groq', 'gemini', 'opencode_cli'] as const) {
    const result = await invokeAiWithFallback(messages, [], { providerOverride, fetchImpl });
    assert.equal(result, null);
  }
  setting('ollama_base_url', 'https://external.example/v1');
  assert.equal(await invokeAiWithFallback(messages, [], { providerOverride: 'ollama', fetchImpl }), null);
  assert.deepEqual(requests, []);
  setting('ollama_base_url', 'http://127.0.0.1:11434/v1');
  const local = await invokeAiWithFallback(messages, [], { providerOverride: 'ollama', fetchImpl });
  assert.equal(local?.isFreeTier, true);
  assert.deepEqual(requests, ['http://127.0.0.1:11434/v1/chat/completions']);
  assert.equal(getAiBudgetSummary().monthlySpentUsd, 0);
});
