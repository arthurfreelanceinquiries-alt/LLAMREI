import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { closeDb, getDb, initDatabase } from '../db/connection.ts';
import { configureMemoryIndex, indexMemoryEntries, indexPendingMemory, memoryIndexStatus } from '../memory/embeddings.ts';
import { retrieveAssistantMemory, searchMemory } from '../memory/search.ts';
import { createMemory, deleteMemory, getMemory, purgeExpiredMemory, updateMemory } from '../memory/store.ts';
import { createOrUpdateWorkspaceDoc, deleteWorkspaceDoc } from '../services/phase3-docs-io.service.ts';

const sample = { kind: 'preference', title: 'Café pagi', body: 'Jadwalkan café pada jam 08.30.', tags: ['rutinitas'] };
const search = (q: string) => searchMemory(q, { limit: 20 });
const ollamaTags = 'http://127.0.0.1:11434/api/tags';
const ollamaEmbed = 'http://127.0.0.1:11434/api/embed';
const model = 'nomic-embed-text:latest';

function setup(t: TestContext) {
  initDatabase(':memory:');
  t.after(closeDb);
}

test('FTS indexes language, tags and current revisions and only recalls opted-in notes', async (t) => {
  setup(t);
  const hidden = createMemory(sample);
  const shared = createMemory({ ...sample, title: 'Pilihan café', usableByAssistant: true });
  assert.equal((await search('cafe')).items.length, 2);
  assert.equal((await search('rutinitas')).items.length, 2);
  assert.deepEqual((await retrieveAssistantMemory('Apa jadwal café saya?', {})).map(({ id }) => id), [shared.id]);
  assert.deepEqual((await search('" OR * < > ?  ')).items, []);
  const updated = updateMemory(hidden.id, { ...sample, title: 'Teh pir', body: 'Berganti ke teh.', tags: [], revision: 1 });
  assert.equal(updated.revision, 2);
  assert.throws(() => updateMemory(hidden.id, { ...sample, revision: 1 }), { status: 409 });
  assert.throws(() => deleteMemory(hidden.id, 1), { status: 409 });
  deleteMemory(hidden.id, updated.revision);
  assert.deepEqual((await search('pir')).items, []);
  assert.equal(getDb().prepare(`SELECT count(*) AS n FROM memory_search WHERE memory_search MATCH 'pir'`).get()?.n, 0);
});

test('document provenance and expiration remove text from the vault and its FTS index', async (t) => {
  setup(t);
  const doc = createOrUpdateWorkspaceDoc({ title: 'Dokumen arsip uji', contentMd: 'Penanda delta-zeta dalam sumber.' });
  const captured = createMemory({ kind: 'semantic', sourceDocumentId: doc.id, usableByAssistant: true });
  assert.equal(captured.source.kind, 'document');
  if (captured.source.kind !== 'document') assert.fail('Expected document provenance');
  assert.equal(captured.source.id, doc.id);
  assert.equal(captured.body, 'Penanda delta-zeta dalam sumber.');
  assert.equal((await search('zeta')).items[0].id, captured.id);
  deleteWorkspaceDoc(doc.id);
  assert.equal(getMemory(captured.id), null);
  assert.deepEqual((await search('zeta')).items, []);

  const deadline = new Date(Date.now() + 10_000);
  const expiring = createMemory({ ...sample, title: 'Sementara azimut', expiresAt: deadline.toISOString() });
  assert.equal(purgeExpiredMemory(deadline), 1);
  assert.equal(getMemory(expiring.id), null);
  assert.deepEqual((await search('azimut')).items, []);
  assert.throws(() => createMemory({ ...sample, expiresAt: new Date(0).toISOString() }), { status: 400 });
});

test('hybrid retrieval uses compatible loopback embeddings, falls back to FTS, and removes vectors on opt-out', async (t) => {
  setup(t);
  const targeted = createMemory({ ...sample, title: 'Pembukaan hari', body: 'Jalan pagi tanpa akses ke layar. private@example.test', usableByAssistant: true });
  createMemory({ ...sample, title: 'Nota lain', body: 'Nota toko untuk pembayaran.', usableByAssistant: true });
  let modelAvailable = true;
  let embeddings = 0;
  const fetchImpl: typeof fetch = async (url, init) => {
    assert.equal(init?.redirect, 'error');
    if (String(url) === ollamaTags) return Response.json({ models: modelAvailable ? [{ model }] : [{ model, remote_host: 'https://example.invalid' }] });
    assert.equal(String(url), ollamaEmbed);
    const payload = JSON.parse(String(init?.body));
    assert.equal(payload.model, model);
    assert.ok(!String(init?.body).includes('private@example.test'));
    embeddings++;
    const vectors = payload.input.map((text: string) => text.includes('Nota lain') ? [0, 1] : [1, 0]);
    return Response.json({ embeddings: vectors });
  };
  assert.equal((await searchMemory('Morning exercise', { limit: 6, fetchImpl })).mode, 'keyword');
  assert.equal(embeddings, 0);
  configureMemoryIndex({ enabled: true, model });
  assert.equal((await indexPendingMemory({ fetchImpl })).built, 2);
  const results = await searchMemory('Morning exercise', { limit: 6, fetchImpl });
  assert.equal(results.mode, 'hybrid');
  assert.deepEqual(results.items.map(({ id }) => id), [targeted.id]);
  modelAvailable = false;
  const fallback = await searchMemory('pembukaan', { limit: 6, fetchImpl });
  assert.equal(fallback.mode, 'keyword');
  assert.equal(fallback.items[0].id, targeted.id);
  assert.equal(embeddings, 2);
  assert.equal(configureMemoryIndex({ enabled: false, model }).indexed, 0);
  assert.equal(getDb().prepare('SELECT count(*) n FROM memory_embeddings').get()?.n, 0);
});

test('an embedding finished after an edit cannot attach to a newer note revision', async (t) => {
  setup(t);
  configureMemoryIndex({ enabled: true, model });
  const old = createMemory(sample);
  const fetchImpl: typeof fetch = async (url) => {
    if (String(url) === ollamaTags) return Response.json({ models: [{ model }] });
    updateMemory(old.id, { ...sample, body: 'Versi berikutnya', revision: old.revision });
    return Response.json({ embeddings: [[2, 1]] });
  };
  assert.equal(await indexMemoryEntries([old], { fetchImpl }), 0);
  assert.equal(memoryIndexStatus().indexed, 0);
});
