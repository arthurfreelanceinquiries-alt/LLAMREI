import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { closeDb, getDb, initDatabase } from '../db/connection.ts';
import { createMemory, deleteMemory, updateMemory } from '../memory/store.ts';
import { handleLlamreiPrompt } from '../services/llamrei-agent.service.ts';

const input = { kind: 'preference', title: 'Agenda Comet', body: 'Comet dimulai pada jam 09.15 di ruang Koral.', usableByAssistant: true };
const local = { providerOverride: 'local' as const };
const tags = 'http://127.0.0.1:11434/api/tags';
const chat = 'http://127.0.0.1:11434/v1/chat/completions';
const localCatalog = () => Response.json({ models: [{ model: 'qwen2.5:7b' }] });
const completion = (content: string) => Response.json({ choices: [{ message: { content } }] });

test('opted-in memory is recalled with provenance in another session after restart', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'llamrei-recall-fixture-'));
  const path = join(root, 'vault.sqlite');
  t.after(() => { closeDb(); rmSync(root, { recursive: true, force: true }); });
  initDatabase(path);
  const entry = createMemory(input);
  createMemory({ ...input, body: 'This private note cannot be retrieved.', usableByAssistant: false });
  const first = await handleLlamreiPrompt({ prompt: 'Kapan Agenda Comet?', useMemory: true, aiOptions: local });
  assert.match(first.assistantMessage.content, /ruang Koral/);
  assert.ok(!first.assistantMessage.content.includes('This private note'));
  closeDb();

  initDatabase(path);
  getDb().prepare("INSERT INTO chat_sessions (id, title) VALUES ('sess_fixture_recall', 'Synthetic session')").run();
  const second = await handleLlamreiPrompt({ prompt: 'Agenda Comet?', sessionId: 'sess_fixture_recall', useMemory: true, aiOptions: local });
  assert.match(second.assistantMessage.content, /ruang Koral/);
  assert.deepEqual(JSON.parse(second.assistantMessage.source_refs_json!), [{ id: 'S1', label: 'Memori · Agenda Comet', memoryId: entry.id }]);
  const disabled = await handleLlamreiPrompt({ prompt: 'Agenda Comet?', sessionId: 'sess_fixture_recall', aiOptions: local });
  assert.ok(!disabled.assistantMessage.content.includes('Koral'));
});

test('memory and its derived history stay local under cloud consent and edited text replaces old observations', async (t) => {
  initDatabase(':memory:');
  t.after(closeDb);
  const entry = createMemory(input);
  const previousKey = process.env.OPENCODE_API_KEY;
  process.env.OPENCODE_API_KEY = 'qa-fixture-only';
  t.after(() => { if (previousKey === undefined) delete process.env.OPENCODE_API_KEY; else process.env.OPENCODE_API_KEY = previousKey; });
  getDb().prepare("INSERT INTO app_settings (key,value_json) VALUES ('ai_allow_cloud_chat_context','true')").run();
  let allowCloudFixture = false;
  let edited = false;
  const requests: string[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    const target = String(url);
    requests.push(target);
    if (target === tags) return localCatalog();
    if (target === chat) {
      const payload = String(init?.body);
      assert.ok(payload.includes(edited ? 'ruang Nila' : 'ruang Koral'));
      if (edited) assert.ok(!payload.includes('ruang Koral'));
      return completion(edited ? 'Lokasi baru ruang Nila.' : 'Lokasi awal ruang Koral.');
    }
    assert.ok(allowCloudFixture, 'A private memory turn must not contact a cloud endpoint');
    if (target.endsWith('/models')) return Response.json({ data: [{ id: 'big-pickle', type: 'chat', cost: { text: { input: { price: 0 }, output: { price: 0 } } } }] });
    assert.equal(target, 'https://opencode.ai/zen/v1/chat/completions');
    const cloudPayload = String(init?.body);
    assert.ok(!cloudPayload.includes('ruang Koral') && !cloudPayload.includes('ruang Nila'));
    return completion('Cloud fixture without memory.');
  };
  const aiOptions = { providerOverride: 'opencode_zen' as const, fetchImpl };
  const privateTurn = await handleLlamreiPrompt({ prompt: 'Agenda Comet?', useMemory: true, aiOptions });
  assert.equal(privateTurn.providerUsed, 'ollama');
  assert.deepEqual(requests, [tags, chat]);
  updateMemory(entry.id, { ...input, body: 'Comet pindah ke ruang Nila.', revision: entry.revision });
  edited = true;
  const newer = await handleLlamreiPrompt({ prompt: 'Lokasi Comet terbaru?', useMemory: true, aiOptions });
  assert.match(newer.assistantMessage.content, /ruang Nila/);
  allowCloudFixture = true;
  const cloud = await handleLlamreiPrompt({ prompt: 'Cek sambungan fixture', aiOptions });
  assert.equal(cloud.providerUsed, 'opencode_zen');
});

test('revoking a referenced memory during generation cancels persistence of the reply', async (t) => {
  initDatabase(':memory:');
  t.after(closeDb);
  const item = createMemory(input);
  const prompt = 'Agenda Comet saat ini?';
  const fetchImpl: typeof fetch = async (url) => {
    if (String(url) === tags) return localCatalog();
    assert.equal(String(url), chat);
    deleteMemory(item.id, item.revision);
    return completion('Old answer interrupted by deletion.');
  };
  await assert.rejects(handleLlamreiPrompt({ prompt, useMemory: true, aiOptions: { providerOverride: 'ollama', fetchImpl } }), { status: 409 });
  assert.equal(getDb().prepare('SELECT 1 FROM chat_messages WHERE content = ?').get(prompt), undefined);
});
