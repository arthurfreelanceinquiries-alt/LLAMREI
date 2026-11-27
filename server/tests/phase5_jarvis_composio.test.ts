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
  getComposioState,
  initiateToolkitConnection,
  isReadOnlyComposioTool,
  listToolkitTools,
  syncComposioConnections,
} from '../services/composio.service.ts';
import { approveAuditAction, handleLlamreiPrompt } from '../services/llamrei-agent.service.ts';
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

test('Multi-Provider AI auto-fallback switches from rate-limited OpenCode Zen to Groq and logs $0 cost', async () => {
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
      if (url.includes('opencode.ai')) {
        return new Response('Rate limited', { status: 429 });
      }
      if (url.includes('api.groq.com')) {
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: 'Halo Arthur, ini balasan gratis dari Groq fallback!' } }],
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
    assert.equal(res.providerUsed, 'groq');
    assert.equal(res.isFreeTier, true);
    assert.ok(res.text.includes('Groq fallback'));
    assert.ok(calledUrls.some((u) => u.includes('opencode.ai')));
    assert.ok(calledUrls.some((u) => u.includes('api.groq.com')));
    assert.equal(res.attempts[0].provider, 'opencode_zen');
    assert.equal(res.attempts[0].ok, false);
    const groqAttempt = res.attempts.find((a) => a.provider === 'groq');
    assert.equal(groqAttempt?.ok, true);

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
    const db = getDb();
    db.prepare(
      `INSERT INTO chat_messages (id, session_id, role, content, model_used)
       VALUES ('cmsg_prev_1', 'sess_main', 'user', 'Ingat fokus utama saya minggu ini adalah Bab 4 MRA.', 'user')`,
    ).run();

    let callCount = 0;
    const capturedPayloads: Array<{ messages: Array<{ role: string; content: string | null }> }> = [];

    const mockFetch: typeof fetch = async (_url, init) => {
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

test('Composio 150+ Apps OAuth connection, read/write gate, Approval Card & execution logging', async () => {
  const cleanup = setupIsolatedEnv();
  try {
    setSecret('COMPOSIO_API_KEY', 'ak_composio_test_1234');
    setSecret('OPENCODE_API_KEY', 'oc_test_key_comp');

    assert.equal(isReadOnlyComposioTool('GMAIL_FETCH_EMAILS'), true);
    assert.equal(isReadOnlyComposioTool('GITHUB_LIST_ISSUES'), true);
    assert.equal(isReadOnlyComposioTool('GMAIL_SEND_EMAIL'), false);
    assert.equal(isReadOnlyComposioTool('GOOGLECALENDAR_CREATE_EVENT'), false);

    let executedWriteCount = 0;

    const mockFetch: typeof fetch = async (input, init) => {
      const url = String(input);
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
      if (url.includes('/tools/execute/GMAIL_SEND_EMAIL')) {
        executedWriteCount++;
        return new Response(JSON.stringify({ successful: true, data: { messageId: 'gm_999' } }), { status: 200 });
      }
      if (url.includes('opencode.ai/inference')) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: 'Draf email ke Dr. Fredella siap dikirim, silakan approve terlebih dahulu.',
                  tool_calls: [
                    {
                      id: 'call_comp_send',
                      type: 'function',
                      function: {
                        name: 'composio__GMAIL_SEND_EMAIL',
                        arguments: '{"recipient_email":"fredella@ukrida.ac.id","subject":"Draf Bab 4","body":"Terlampir draf Bab 4."}',
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
    assert.equal(tools[0].slug, 'GMAIL_SEND_EMAIL');
    assert.equal(tools[0].readOnly, false);

    // Mutating Composio call must stop at Approval Card BEFORE executing
    const promptRes = await handleLlamreiPrompt({
      prompt: 'Kirim email ke Dr. Fredella soal draf Bab 4',
      aiOptions: { providerOverride: 'opencode_zen', fetchImpl: mockFetch },
    });
    assert.equal(executedWriteCount, 0, 'Write Composio action must NOT execute before user approval');
    assert.ok(promptRes.assistantMessage.approval_card_json);

    const card = JSON.parse(promptRes.assistantMessage.approval_card_json!) as { auditId: string; toolName: string };
    assert.equal(card.toolName, 'composio_execute_tool');

    // Approve now -> actually executes Composio endpoint and logs execution
    const approved = await approveAuditAction(card.auditId, undefined, mockFetch);
    assert.equal(approved?.status, 'approved_executed');
    assert.equal(executedWriteCount, 1);

    const compState = getComposioState();
    assert.equal(compState.recentLogs.length, 1);
    assert.equal(compState.recentLogs[0].tool_slug, 'GMAIL_SEND_EMAIL');
    assert.equal(compState.recentLogs[0].status, 'success');
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
