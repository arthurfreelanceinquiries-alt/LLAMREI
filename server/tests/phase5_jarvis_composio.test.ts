import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeDb, getDb, initDatabase } from '../db/connection.ts';
import {
  getAiBudgetSummary,
  invokeAiWithFallback,
  parseOpenCodeCatalogJson,
  parseOpenCodeCliJsonLines,
} from '../services/ai-provider.service.ts';
import {
  executeComposioTool,
  getComposioState,
  initiateToolkitConnection,
  isReadOnlyComposioTool,
  listToolkitTools,
  setEnabledComposioToolkits,
  syncComposioConnections,
} from '../services/composio.service.ts';
import { approveAuditAction, handleLlamreiPrompt, undoAuditAction } from '../services/llamrei-agent.service.ts';
import { getSecretStatus, setSecret } from '../services/secret.service.ts';

function setupIsolatedEnv() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llamrei-p5-'));
  process.env.LLAMREI_DISABLE_LIBSECRET = '1';
  process.env.LLAMREI_DISABLE_CLI_AI = '1';
  process.env.LLAMREI_VAULT_DIR = tmpDir;
  initDatabase(':memory:');
  return () => {
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  };
}

function allowCloudChat() {
  getDb().prepare("INSERT INTO app_settings (key, value_json) VALUES ('ai_allow_cloud_chat_context', 'true')").run();
}

function mockOpenCodeCatalog() {
  return Response.json({
    data: [{ id: 'big-pickle', type: 'chat', limit: { context: 4096 }, cost: { text: { input: { price: 0 }, output: { price: 0 } } } }],
  });
}

test('OpenCode catalog & CLI JSON parser filter free models accurately', () => {
  const parsed = parseOpenCodeCatalogJson({
    data: [
      {
        id: 'big-pickle',
        name: 'Big Pickle',
        type: 'chat',
        description: 'Free reasoning',
        capabilities: { tools: { supported: true } },
        cost: { text: { input: { price: 0 }, output: { price: 0 } } },
      },
      {
        id: 'claude-opus-5',
        name: 'Claude Opus 5',
        type: 'chat',
        capabilities: { tools: { supported: true } },
        cost: { text: { input: { price: 5 }, output: { price: 25 } } },
      },
      {
        id: 'gpt-transcribe',
        name: 'Transcribe',
        type: 'transcription',
        cost: { audio: { input: { price: 0.004 } } },
      },
    ],
  });
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, 'big-pickle');
  assert.equal(parsed[0].isFree, true);
  assert.equal(parsed[0].supportsTools, true);

  const cliOut = parseOpenCodeCliJsonLines(
    '{"type":"step_start"}\n{"type":"text","part":{"type":"text","text":"Halo dari OpenCode CLI!"}}\n{"type":"step_finish"}',
  );
  assert.equal(cliOut, 'Halo dari OpenCode CLI!');
});

test('Multi-Provider AI auto-fallback switches from rate-limited OpenCode Zen to local Ollama and logs $0 cost', async () => {
  const cleanup = setupIsolatedEnv();
  try {
    setSecret('OPENCODE_API_KEY', 'oc_test_key_1234');
    setSecret('GROQ_API_KEY', 'gsk_test_key_5678');

    const status = getSecretStatus();
    assert.equal(status.OPENCODE_API_KEY.configured, true);
    assert.equal(status.GROQ_API_KEY.configured, true);

    const calledUrls: string[] = [];
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      calledUrls.push(url);
      if (url === 'https://opencode.ai/zen/v1/models') return mockOpenCodeCatalog();
      if (url.includes('opencode.ai')) {
        return new Response('Rate limited', { status: 429 });
      }
      if (url.startsWith('http://127.0.0.1:11434/')) {
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: 'Balasan dari Ollama lokal.' } }],
            usage: { prompt_tokens: 120, completion_tokens: 45 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('Not found', { status: 404 });
    };

    const res = await invokeAiWithFallback(
      [{ role: 'user', content: 'Tes fallback model gratis' }],
      [],
      { fetchImpl: mockFetch },
    );

    assert.ok(res);
    assert.equal(res.providerUsed, 'ollama');
    assert.equal(res.isFreeTier, true);
    assert.ok(res.text.includes('Ollama lokal'));
    assert.ok(calledUrls.some((u) => u.includes('opencode.ai')));
    assert.ok(calledUrls.some((u) => u.startsWith('http://127.0.0.1:11434/')));
    assert.ok(!calledUrls.some((u) => u.includes('api.groq.com')));
    assert.equal(res.attempts[0].provider, 'opencode_zen');
    assert.equal(res.attempts[0].ok, false);
    const ollamaAttempt = res.attempts.find((a) => a.provider === 'ollama');
    assert.equal(ollamaAttempt?.ok, true);

    const budget = getAiBudgetSummary();
    assert.equal(budget.callsCount, 1);
    assert.equal(budget.monthlySpentUsd, 0);
  } finally {
    cleanup();
  }
});

test('Jarvis/Llamrei agent passes conversation memory and runs multi-step ReAct read-only tool loop', async () => {
  const cleanup = setupIsolatedEnv();
  try {
    setSecret('OPENCODE_API_KEY', 'oc_test_key_react');
    allowCloudChat();
    const db = getDb();
    db.prepare(
      `INSERT INTO chat_messages (id, session_id, role, content, model_used)
       VALUES ('cmsg_prev_1', 'sess_main', 'user', 'Ingat fokus utama saya minggu ini adalah Bab 4 MRA.', 'user')`,
    ).run();

    let callCount = 0;
    const capturedPayloads: Array<{ messages: Array<{ role: string; content: string | null }> }> = [];

    const mockFetch: typeof fetch = async (url, init) => {
      if (String(url) === 'https://opencode.ai/zen/v1/models') return mockOpenCodeCatalog();
      callCount++;
      const parsed = JSON.parse(String(init?.body ?? '{}')) as {
        messages: Array<{ role: string; content: string | null }>;
      };
      capturedPayloads.push(parsed);

      if (callCount === 1) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: '',
                  tool_calls: [
                    {
                      id: 'call_tasks_1',
                      type: 'function',
                      function: { name: 'list_clickup_tasks', arguments: '{"priority":"urgent"}' },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: 'Berdasarkan data ClickUp Anda, tugas urgent aktif adalah Bab 4 Interpretasi 2-Stage MRA.',
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const out = await handleLlamreiPrompt({
      prompt: 'Cek tugas urgent saya sekarang',
      aiOptions: { providerOverride: 'opencode_zen', fetchImpl: mockFetch },
    });

    assert.equal(callCount, 2, 'Should perform 2 ReAct steps: read tool call + final synthesis');
    assert.equal(out.providerUsed, 'opencode_zen');
    assert.ok(out.assistantMessage.model_used?.includes('opencode_zen/big-pickle'));
    assert.ok(out.assistantMessage.content.includes('Bab 4'));

    // Verify prior conversation memory was sent in Step 1
    assert.ok(
      capturedPayloads[0].messages.some((m) => (m.content ?? '').includes('Bab 4 MRA')),
      'Prior conversation history should be forwarded to the model',
    );
    // Verify tool execution result was fed back in Step 2
    assert.ok(
      capturedPayloads[1].messages.some((m) => m.role === 'tool' && (m.content ?? '').includes('2-Stage MRA')),
      'Read-only tool output should be appended into Step 2 context',
    );
  } finally {
    cleanup();
  }
});

test('Private prompts, stored history, attachments and tool observations stay loopback-only by default', async () => {
  const cleanup = setupIsolatedEnv();
  try {
    setSecret('OPENCODE_API_KEY', 'oc_test_privacy');
    getDb().prepare("UPDATE app_settings SET value_json = 'true' WHERE key = 'paid_billing_verified'").run();
    getDb().prepare(
      "INSERT INTO chat_messages (id, session_id, role, content) VALUES ('fixture_private', 'sess_main', 'user', ?)",
    ).run('Sensitive prior note. Email private@example.test');
    let calls = 0;
    const fetchImpl: typeof fetch = async (url, init) => {
      calls++;
      assert.equal(String(url), 'http://127.0.0.1:11434/v1/chat/completions');
      assert.equal(init?.redirect, 'error');
      const body = String(init?.body);
      assert.ok(body.includes('Sensitive prior note'));
      assert.ok(body.includes('Private fixture attachment'));
      assert.ok(!body.includes('private@example.test'));
      if (calls === 1) {
        return Response.json({ choices: [{ message: {
          content: '',
          tool_calls: [{ id: 'local-read', type: 'function', function: { name: 'list_clickup_tasks', arguments: '{}' } }],
        } }] });
      }
      assert.ok(body.includes('"role":"tool"'));
      return Response.json({ choices: [{ message: { content: 'Local fixture reply' } }] });
    };

    const result = await handleLlamreiPrompt({
      prompt: 'Read my fixture task',
      contextAttachment: { title: 'Private fixture attachment' },
      aiOptions: { fetchImpl },
    });
    assert.equal(calls, 2);
    assert.equal(result.providerUsed, 'ollama');
    assert.equal(result.assistantMessage.content, 'Local fixture reply');

    getDb().prepare("UPDATE app_settings SET value_json = ? WHERE key = 'ollama_base_url'").run(JSON.stringify('https://endpoint.example.test/v1'));
    const refused = await handleLlamreiPrompt({
      prompt: 'Check remote local-model fallback',
      aiOptions: { fetchImpl, providerOverride: 'ollama' },
    });
    assert.equal(refused.providerUsed, 'local');
    assert.equal(calls, 2);
  } finally {
    cleanup();
  }
});

test('Composio mock discovery, approval binding, execution outcomes and default-deny gates', async () => {
  const cleanup = setupIsolatedEnv();
  try {
    setSecret('COMPOSIO_API_KEY', 'ak_composio_test_1234');
    setSecret('OPENCODE_API_KEY', 'oc_test_key_comp');
    allowCloudChat();

    assert.equal(isReadOnlyComposioTool('GMAIL_FETCH_EMAILS'), true);
    assert.equal(isReadOnlyComposioTool('GITHUB_LIST_ISSUES'), true);
    assert.equal(isReadOnlyComposioTool('GMAIL_SEND_EMAIL'), false);
    assert.equal(isReadOnlyComposioTool('GOOGLECALENDAR_CREATE_EVENT'), false);

    let executedWriteCount = 0;
    let executedReadCount = 0;
    let successful = true;
    let mockToolName = 'GMAIL_SEND_EMAIL';
    let mockArguments = {
      recipient_email: 'recipient@example.test',
      subject: 'Fixture subject',
      body: 'Fixture body',
    } as Record<string, unknown>;

    const mockFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url === 'https://opencode.ai/zen/v1/models') return mockOpenCodeCatalog();
      if (url.includes('/auth_configs?toolkit_slug=gmail')) {
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      }
      if (url.endsWith('/auth_configs') && init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'ac_gmail_managed_1' }), { status: 201 });
      }
      if (url.includes('/connected_accounts/link')) {
        return new Response(
          JSON.stringify({
            redirect_url: 'https://connect.composio.dev/link/ln_test_gmail',
            connected_account_id: 'ca_gmail_123',
          }),
          { status: 200 },
        );
      }
      if (url.includes('/connected_accounts?user_ids=')) {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: 'ca_gmail_123',
                status: 'ACTIVE',
                toolkit: { slug: 'gmail', name: 'Gmail' },
                auth_config: { id: 'ac_gmail_managed_1' },
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.includes('/tools?toolkit_slug=gmail')) {
        return new Response(
          JSON.stringify({
            items: [
              {
                slug: 'GMAIL_FETCH_EMAILS',
                input_parameters: {
                  type: 'object',
                  properties: { count: { type: 'integer', minimum: 1, maximum: 5 } },
                  required: ['count'],
                },
              },
              {
                slug: 'GMAIL_SEND_EMAIL',
                name: 'Send Email',
                description: 'Send email via Gmail',
                input_parameters: {
                  type: 'object',
                  properties: { recipient_email: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' } },
                  required: ['recipient_email', 'subject', 'body'],
                },
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.includes('/tools/execute/GMAIL_FETCH_EMAILS')) {
        executedReadCount++;
        assert.equal(JSON.parse(String(init?.body)).connected_account_id, 'ca_gmail_123');
        return Response.json({ successful: true, data: { emails: [] } });
      }
      if (url.includes('/tools/execute/GMAIL_SEND_EMAIL')) {
        executedWriteCount++;
        assert.equal(JSON.parse(String(init?.body)).connected_account_id, 'ca_gmail_123');
        return Response.json({ successful, data: { messageId: 'gm_fixture' } });
      }
      if (url === 'https://opencode.ai/zen/v1/chat/completions') {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: 'Draf email fixture siap ditinjau.',
                  tool_calls: [
                    {
                      id: 'call_comp_send',
                      type: 'function',
                      function: {
                        name: `composio__${mockToolName}`,
                        arguments: JSON.stringify(mockArguments),
                      },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response('{}', { status: 404 });
    };

    const connRes = await initiateToolkitConnection('gmail', 'http://localhost:5173', mockFetch);
    assert.equal(connRes.ok, true);
    assert.equal(connRes.redirectUrl, 'https://connect.composio.dev/link/ln_test_gmail');

    const syncRes = await syncComposioConnections(mockFetch);
    assert.equal(syncRes.ok, true);
    assert.equal(syncRes.syncedCount, 1);

    const tools = await listToolkitTools('gmail', 10, mockFetch);
    assert.equal(tools[1].slug, 'GMAIL_SEND_EMAIL');
    assert.equal(tools[1].readOnly, false);

    const readTool = 'GMAIL_FETCH_EMAILS';
    assert.equal((await executeComposioTool('GMAIL_SEND_EMAIL', mockArguments, mockFetch)).ok, false);
    assert.equal((await executeComposioTool('GMAIL_SEARCH_UNKNOWN', {}, mockFetch)).ok, false);
    assert.equal((await executeComposioTool('GITHUB_LIST_ISSUES', {}, mockFetch)).ok, false);
    assert.equal((await executeComposioTool(readTool, { count: '2' }, mockFetch)).ok, false);
    assert.equal((await executeComposioTool(readTool, { count: 2, accountId: 'ca_injected' }, mockFetch)).ok, false);
    setEnabledComposioToolkits([]);
    assert.equal((await executeComposioTool(readTool, { count: 2 }, mockFetch)).ok, false);
    setEnabledComposioToolkits(['gmail']);
    assert.equal(executedReadCount, 0);
    assert.equal((await executeComposioTool(readTool, { count: 2 }, mockFetch)).ok, true);
    assert.equal(executedReadCount, 1);

    mockToolName = 'GMAIL_SEND_UNDISCOVERED';
    const denied = await handleLlamreiPrompt({
      prompt: 'Simulasikan alat yang tidak dikenal',
      aiOptions: { providerOverride: 'opencode_zen', fetchImpl: mockFetch },
    });
    assert.equal(denied.assistantMessage.approval_card_json, null);
    mockToolName = 'GMAIL_SEND_EMAIL';

    // Mutating Composio call must stop at Approval Card BEFORE executing
    const promptRes = await handleLlamreiPrompt({
      prompt: 'Siapkan email fixture',
      aiOptions: { providerOverride: 'opencode_zen', fetchImpl: mockFetch },
    });
    assert.equal(executedWriteCount, 0, 'Write Composio action must NOT execute before user approval');
    assert.ok(promptRes.assistantMessage.approval_card_json);

    const card = JSON.parse(promptRes.assistantMessage.approval_card_json!) as { auditId: string; toolName: string };
    assert.equal(card.toolName, 'composio_execute_tool');

    // Approve now -> actually executes Composio endpoint and logs execution
    assert.equal(await approveAuditAction(card.auditId, { arguments: {} }, mockFetch), null);
    const [approved, duplicate] = await Promise.all([
      approveAuditAction(card.auditId, undefined, mockFetch),
      approveAuditAction(card.auditId, undefined, mockFetch),
    ]);
    assert.equal(approved?.status, 'approved_executed');
    assert.equal(duplicate, null);
    assert.equal(undoAuditAction(card.auditId), null);
    assert.equal(executedWriteCount, 1);

    const compState = getComposioState();
    assert.equal(compState.recentLogs.length, 2);
    const writeLog = compState.recentLogs.find((log) => log.tool_slug === 'GMAIL_SEND_EMAIL');
    assert.equal(writeLog?.status, 'success');
    assert.equal(writeLog?.arguments_json, '{}');

    const newApproval = async () => {
      const result = await handleLlamreiPrompt({
        prompt: 'Siapkan email fixture berikutnya',
        aiOptions: { providerOverride: 'opencode_zen', fetchImpl: mockFetch },
      });
      return (JSON.parse(result.assistantMessage.approval_card_json!) as { auditId: string }).auditId;
    };
    successful = false;
    const rejected = await newApproval();
    assert.equal((await approveAuditAction(rejected, undefined, mockFetch))?.status, 'failed');
    assert.equal(executedWriteCount, 2);
    assert.equal(await approveAuditAction(rejected, undefined, mockFetch), null);

    const changed = await newApproval();
    getDb().prepare("UPDATE composio_connections SET connected_account_id = 'ca_replaced'").run();
    assert.equal((await approveAuditAction(changed, undefined, mockFetch))?.status, 'failed');
    assert.equal(executedWriteCount, 2);

    const expired = await newApproval();
    getDb().prepare("UPDATE agent_audit_logs SET created_at = datetime('now', '-16 minutes') WHERE id = ?").run(expired);
    assert.equal((await approveAuditAction(expired, undefined, mockFetch))?.status, 'failed');
    assert.equal(executedWriteCount, 2);

    mockArguments = { ...mockArguments, body: 17 };
    const invalid = await newApproval();
    assert.equal((await approveAuditAction(invalid, undefined, mockFetch))?.status, 'failed');
    assert.equal(executedWriteCount, 2);
  } finally {
    cleanup();
  }
});

test('Baileys wa_tag_mentions live insert accepts all 17 columns cleanly without parameter shift', () => {
  const cleanup = setupIsolatedEnv();
  try {
    const db = getDb();
    const id = 'wa_live_test_1';
    db.prepare(
      `INSERT OR IGNORE INTO wa_tag_mentions
       (id, group_name, sender_display, message_timestamp, quoted_message, matched_alias, ai_intent, ai_urgency, replied_status, content_hash, topic_category, has_event_proposal, proposed_event_title, proposed_event_start, proposed_event_end, proposed_event_location, proposal_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unreplied', ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      'BEM FEB UKRIDA',
      'Raka',
      new Date().toISOString(),
      '@Arthur besok rapat jam 16:00',
      '@Arthur',
      'meeting_invite',
      'high',
      'hash_live_test_1',
      'rapat_organisasi',
      1,
      'Rapat Evaluasi (BEM FEB UKRIDA)',
      new Date().toISOString(),
      new Date().toISOString(),
      'RUANG BEM',
      'pending',
    );
    const row = db.prepare('SELECT id, ai_intent, ai_urgency, proposal_status FROM wa_tag_mentions WHERE id = ?').get(id) as {
      id: string;
      ai_intent: string;
      ai_urgency: string;
      proposal_status: string;
    };
    assert.equal(row.id, id);
    assert.equal(row.ai_intent, 'meeting_invite');
    assert.equal(row.ai_urgency, 'high');
    assert.equal(row.proposal_status, 'pending');
  } finally {
    cleanup();
  }
});

test('local alarm approval is one-time and undo removes both the alarm and the calendar event', async () => {
  const cleanup = setupIsolatedEnv();
  try {
    const prompt = await handleLlamreiPrompt({
      prompt: 'Pasang alarm Fixture Ascension jam 16.00',
      aiOptions: { providerOverride: 'local' },
    });
    const card = JSON.parse(prompt.assistantMessage.approval_card_json!) as { auditId: string };
    assert.equal(await approveAuditAction(card.auditId, { title: 'Edited title' }), null);
    const approved = await approveAuditAction(card.auditId);
    assert.equal(approved?.status, 'approved_executed');
    assert.equal(await approveAuditAction(card.auditId), null);
    const { eventId } = JSON.parse(approved!.undo_payload_json!) as { eventId: string };
    assert.ok(getDb().prepare('SELECT id FROM calendar_events WHERE id = ?').get(eventId));
    assert.ok(getDb().prepare('SELECT id FROM task_alarms_reminders WHERE calendar_event_id = ?').get(eventId));
    assert.equal(undoAuditAction(card.auditId)?.status, 'undone');
    assert.equal(getDb().prepare('SELECT id FROM calendar_events WHERE id = ?').get(eventId), undefined);
    assert.equal(getDb().prepare('SELECT id FROM task_alarms_reminders WHERE calendar_event_id = ?').get(eventId), undefined);
  } finally {
    cleanup();
  }
});
