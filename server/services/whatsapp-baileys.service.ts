import path from 'node:path';
import fs from 'node:fs';
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  type WASocket,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import { getDb } from '../db/connection.ts';
import { sseBus } from '../lib/sse.ts';
import { detectTopicCategory, extractEventProposal } from './wa-export.service.ts';

export interface BaileysChatMessage {
  id: string;
  chatJid: string;
  senderName: string;
  text: string;
  timestamp: string;
  isFromMe: boolean;
}

export interface BaileysChatThread {
  chatJid: string;
  name: string;
  lastMessage: string;
  lastTimestamp: string;
  unreadCount: number;
  messages: BaileysChatMessage[];
}

export interface BaileysStatus {
  status: 'disconnected' | 'connecting' | 'awaiting_qr' | 'connected';
  qrDataUrl: string | null;
  userJid: string | null;
  userName: string | null;
  activeChatsCount: number;
  isAutoReconnecting?: boolean;
}

const AUTH_DIR = path.resolve(process.cwd(), 'data', 'wa_baileys_auth');

let sock: WASocket | null = null;
let connectionStatus: 'disconnected' | 'connecting' | 'awaiting_qr' | 'connected' = 'disconnected';
let currentQrDataUrl: string | null = null;
let connectedUserJid: string | null = null;
let connectedUserName: string | null = null;
let reconnectAttempts = 0;
let reconnectTimer: NodeJS.Timeout | null = null;
let heartbeatInterval: NodeJS.Timeout | null = null;

// Primary in-memory chat cache (hydrated from SQLite on startup)
const chatThreads = new Map<string, BaileysChatThread>();
const groupMetaCache = new Map<string, string>();

/**
 * Hydrate threads and recent messages from persistent SQLite storage
 */
function loadThreadsFromDb(): void {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM wa_chat_threads ORDER BY updated_at DESC').all() as Array<{
      chat_jid: string;
      name: string;
      last_message: string;
      last_timestamp: string;
      unread_count: number;
      is_group: number;
    }>;

    for (const r of rows) {
      const msgRows = db
        .prepare('SELECT * FROM wa_chat_messages WHERE chat_jid = ? ORDER BY created_at ASC LIMIT 100')
        .all(r.chat_jid) as Array<{
        id: string;
        chat_jid: string;
        sender_name: string;
        text: string;
        timestamp: string;
        is_from_me: number;
      }>;

      chatThreads.set(r.chat_jid, {
        chatJid: r.chat_jid,
        name: r.name,
        lastMessage: r.last_message,
        lastTimestamp: r.last_timestamp,
        unreadCount: r.unread_count,
        messages: msgRows.map((m) => ({
          id: m.id,
          chatJid: m.chat_jid,
          senderName: m.sender_name,
          text: m.text,
          timestamp: m.timestamp,
          isFromMe: Boolean(m.is_from_me),
        })),
      });

      if (r.is_group) {
        groupMetaCache.set(r.chat_jid, r.name);
      }
    }
    console.log(`[baileys] Hydrated ${chatThreads.size} chat threads from persistent SQLite storage`);
  } catch {
    // Database might not be initialized yet during isolated tests
  }
}

/**
 * Persist thread record into SQLite
 */
function persistThreadToDb(thread: BaileysChatThread, isGroup: boolean): void {
  try {
    const db = getDb();
    db.prepare(
      `INSERT INTO wa_chat_threads (chat_jid, name, last_message, last_timestamp, unread_count, is_group, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(chat_jid) DO UPDATE SET
         name = excluded.name,
         last_message = excluded.last_message,
         last_timestamp = excluded.last_timestamp,
         unread_count = excluded.unread_count,
         updated_at = datetime('now')`,
    ).run(thread.chatJid, thread.name, thread.lastMessage, thread.lastTimestamp, thread.unreadCount, isGroup ? 1 : 0);
  } catch {
    // Fail silently in memory-only test mode
  }
}

/**
 * Persist single message record into SQLite
 */
function persistMessageToDb(msg: BaileysChatMessage): void {
  try {
    const db = getDb();
    db.prepare(
      `INSERT OR REPLACE INTO wa_chat_messages (id, chat_jid, sender_name, text, timestamp, is_from_me, created_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
    ).run(msg.id, msg.chatJid, msg.senderName, msg.text, msg.timestamp, msg.isFromMe ? 1 : 0);
  } catch {
    // Fail silently in memory-only test mode
  }
}

// Initial hydration from DB
loadThreadsFromDb();

async function resolveGroupSubject(groupJid: string): Promise<string> {
  if (groupMetaCache.has(groupJid)) return groupMetaCache.get(groupJid)!;
  if (sock) {
    try {
      const meta = await sock.groupMetadata(groupJid);
      if (meta?.subject) {
        groupMetaCache.set(groupJid, meta.subject);
        return meta.subject;
      }
    } catch {
      // fallback
    }
  }
  return 'Grup WhatsApp';
}

export function getBaileysStatus(): BaileysStatus {
  return {
    status: connectionStatus,
    qrDataUrl: currentQrDataUrl,
    userJid: connectedUserJid,
    userName: connectedUserName,
    activeChatsCount: chatThreads.size,
    isAutoReconnecting: reconnectAttempts > 0,
  };
}

export function listBaileysThreads(): BaileysChatThread[] {
  return Array.from(chatThreads.values()).sort((a, b) => {
    const timeA = b.messages[b.messages.length - 1]?.id ?? b.lastTimestamp ?? '';
    const timeB = a.messages[a.messages.length - 1]?.id ?? a.lastTimestamp ?? '';
    return timeA.localeCompare(timeB);
  });
}

export function getBaileysThread(chatJid: string): BaileysChatThread | null {
  return chatThreads.get(chatJid) ?? null;
}

export async function sendBaileysMessage(
  chatJid: string,
  text: string,
): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  if (!text.trim()) return { ok: false, error: 'Pesan tidak boleh kosong' };

  let targetJid = chatJid.trim();
  if (!targetJid.includes('@')) {
    let digits = targetJid.replace(/[^0-9]/g, '');
    if (digits.startsWith('08')) digits = '62' + digits.slice(1);
    targetJid = `${digits}@s.whatsapp.net`;
  }

  const timestamp = new Date().toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Jakarta',
  });
  const msgId = `msg_out_${Date.now()}`;

  // If Baileys is live and connected, dispatch through socket
  if (sock && connectionStatus === 'connected') {
    try {
      await sock.sendMessage(targetJid, { text: text.trim() });
    } catch (err) {
      console.error('[baileys] send message error:', err);
    }
  }

  // Update in-memory and persistent storage
  let thread = chatThreads.get(targetJid);
  const isGroup = targetJid.endsWith('@g.us');
  if (!thread) {
    const threadName = isGroup ? await resolveGroupSubject(targetJid) : targetJid.replace('@s.whatsapp.net', '');
    thread = {
      chatJid: targetJid,
      name: threadName,
      lastMessage: text.trim(),
      lastTimestamp: timestamp,
      unreadCount: 0,
      messages: [],
    };
    chatThreads.set(targetJid, thread);
  }

  const newMsg: BaileysChatMessage = {
    id: msgId,
    chatJid: targetJid,
    senderName: 'Arthur (You)',
    text: text.trim(),
    timestamp,
    isFromMe: true,
  };

  thread.messages.push(newMsg);
  thread.lastMessage = text.trim();
  thread.lastTimestamp = timestamp;

  // Persist to SQLite
  persistThreadToDb(thread, isGroup);
  persistMessageToDb(newMsg);

  // Broadcast to frontend SSE
  sseBus.emit('wa:message', { chatJid: targetJid, message: newMsg });

  return { ok: true, messageId: msgId };
}

// Zero-Token-Burn Rule-based Triage (Pure Regex/Code, Zero AI Ban Risk)
function ruleBasedUrgencyTriage(
  text: string,
  senderName: string,
): { isMention: boolean; urgency: 'high' | 'medium' | 'low'; intent: string } {
  const lower = text.toLowerCase();
  const isMention =
    lower.includes('arthur') ||
    lower.includes('@arthur') ||
    lower.includes('art') ||
    lower.includes('reezan') ||
    lower.includes('312023002');

  const isHigh =
    lower.includes('urgent') ||
    lower.includes('darurat') ||
    lower.includes('segera') ||
    lower.includes('deadline') ||
    lower.includes('bimbingan') ||
    lower.includes('sidang') ||
    lower.includes('revisi');

  const isMedium =
    lower.includes('tolong') ||
    lower.includes('cek') ||
    lower.includes('kuesioner') ||
    lower.includes('mra') ||
    lower.includes('cpi') ||
    lower.includes('meeting') ||
    lower.includes('rapat') ||
    lower.includes('kuliah') ||
    lower.includes('tugas');

  const urgency: 'high' | 'medium' | 'low' = isHigh ? 'high' : isMedium ? 'medium' : 'low';

  let intent = 'info';
  if (lower.includes('?') || lower.includes('apakah') || lower.includes('gimana') || lower.includes('kapan')) {
    intent = 'question';
  } else if (lower.includes('tolong') || lower.includes('kirim') || lower.includes('kerjakan')) {
    intent = 'task_request';
  } else if (lower.includes('deadline') || lower.includes('paling lambat') || lower.includes('tenggat')) {
    intent = 'deadline';
  } else if (lower.includes('rapat') || lower.includes('zoom') || lower.includes('meet') || lower.includes('evaluasi')) {
    intent = 'meeting_invite';
  }

  return { isMention, urgency, intent };
}

/**
 * Hydrate participating groups on socket open
 */
export async function syncBaileysGroups(): Promise<number> {
  if (!sock || connectionStatus !== 'connected') return 0;
  try {
    const participating = await sock.groupFetchAllParticipating();
    let count = 0;
    const nowTime = new Date().toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Jakarta',
    });

    for (const [jid, meta] of Object.entries(participating)) {
      if (meta?.subject) {
        groupMetaCache.set(jid, meta.subject);
        let thread = chatThreads.get(jid);
        if (!thread) {
          thread = {
            chatJid: jid,
            name: meta.subject,
            lastMessage: `Grup ${meta.subject} (${meta.participants?.length ?? 0} anggota)`,
            lastTimestamp: nowTime,
            unreadCount: 0,
            messages: [],
          };
          chatThreads.set(jid, thread);
        } else {
          thread.name = meta.subject;
        }
        persistThreadToDb(thread, true);
        count++;
      }
    }
    console.log(`[baileys] Successfully synchronized ${count} participating groups`);
    sseBus.emit('wa:status', getBaileysStatus());
    return count;
  } catch (err) {
    console.warn('[baileys] group sync warning:', err);
    return 0;
  }
}

/**
 * Automatically connect Baileys if saved credentials exist on startup
 */
export function autoConnectBaileysIfCredsExist(): void {
  const credsFile = path.resolve(AUTH_DIR, 'creds.json');
  if (fs.existsSync(credsFile)) {
    console.log('[baileys] Saved credentials found. Auto-connecting to WhatsApp background socket...');
    void initBaileysClient();
  }
}

export async function initBaileysClient(): Promise<void> {
  if (sock) return;

  fs.mkdirSync(AUTH_DIR, { recursive: true });
  connectionStatus = 'connecting';
  sseBus.emit('wa:status', getBaileysStatus());

  try {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    sock = makeWASocket({
      auth: state,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      browser: ['Llamrei Co-Commander', 'Linux', '3.0.0'],
      connectTimeoutMs: 30000,
      keepAliveIntervalMs: 25000,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        connectionStatus = 'awaiting_qr';
        try {
          currentQrDataUrl = await QRCode.toDataURL(qr, {
            margin: 1,
            width: 260,
            color: { dark: '#00D992', light: '#050507' },
          });
        } catch {
          currentQrDataUrl = null;
        }
        sseBus.emit('wa:status', getBaileysStatus());
      }

      if (connection === 'close') {
        currentQrDataUrl = null;
        const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } })?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        console.log(`[baileys] Connection closed, statusCode: ${statusCode}, shouldReconnect: ${shouldReconnect}`);

        if (statusCode === DisconnectReason.loggedOut) {
          connectionStatus = 'disconnected';
          connectedUserJid = null;
          connectedUserName = null;
          reconnectAttempts = 0;
          if (reconnectTimer) clearTimeout(reconnectTimer);
          // Clear credentials on explicit logout
          fs.rmSync(AUTH_DIR, { recursive: true, force: true });
          sock = null;
        } else if (shouldReconnect) {
          connectionStatus = 'connecting';
          sock = null;
          // Exponential backoff reconnect: 2s -> 3s -> 4.5s -> 6.7s -> max 25s
          const delay = Math.min(25000, Math.round(2000 * Math.pow(1.35, reconnectAttempts)));
          reconnectAttempts++;
          console.log(`[baileys] Auto-reconnecting in ${Math.round(delay / 1000)}s (attempt #${reconnectAttempts})...`);
          if (reconnectTimer) clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(() => {
            void initBaileysClient();
          }, delay);
        } else {
          connectionStatus = 'disconnected';
          sock = null;
        }
        sseBus.emit('wa:status', getBaileysStatus());
      } else if (connection === 'open') {
        connectionStatus = 'connected';
        currentQrDataUrl = null;
        reconnectAttempts = 0;
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }

        connectedUserJid = sock?.user?.id ? sock.user.id.split(':')[0] + '@s.whatsapp.net' : null;
        connectedUserName = sock?.user?.name ?? 'Arthur Reezan';
        console.log(`[baileys] WhatsApp connected as ${connectedUserName} (${connectedUserJid})`);
        sseBus.emit('wa:status', getBaileysStatus());

        // Hydrate groups and active participating chats immediately
        setTimeout(() => {
          void syncBaileysGroups();
        }, 1500);

        // Keep-alive presence heartbeat
        if (!heartbeatInterval) {
          heartbeatInterval = setInterval(() => {
            if (connectionStatus === 'connected' && sock) {
              sock.sendPresenceUpdate('available').catch(() => {
                // Ignore transient network errors
              });
            }
          }, 45000);
        }
      }
    });

    sock.ev.on('messages.upsert', async (m) => {
      if (!m.messages || m.messages.length === 0) return;

      for (const msg of m.messages) {
        if (!msg.message || msg.key.fromMe) continue;

        const chatJid = msg.key.remoteJid;
        if (!chatJid) continue;

        const text =
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          msg.message.imageMessage?.caption ||
          '';

        if (!text.trim()) continue;

        const isGroup = chatJid.endsWith('@g.us');
        const groupName = isGroup ? await resolveGroupSubject(chatJid) : 'Personal Chat';
        const senderName =
          msg.pushName ||
          (isGroup && msg.key.participant
            ? `+${msg.key.participant.replace(/[^0-9]/g, '')}`
            : chatJid.replace(/[^0-9]/g, ''));
        const timestamp = new Date().toLocaleTimeString('id-ID', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'Asia/Jakarta',
        });

        // Update in-memory thread
        let thread = chatThreads.get(chatJid);
        if (!thread) {
          thread = {
            chatJid,
            name: isGroup ? groupName : senderName,
            lastMessage: text,
            lastTimestamp: timestamp,
            unreadCount: 0,
            messages: [],
          };
          chatThreads.set(chatJid, thread);
        }

        const newMsg: BaileysChatMessage = {
          id: msg.key.id || `msg_${Date.now()}`,
          chatJid,
          senderName,
          text,
          timestamp,
          isFromMe: false,
        };

        thread.messages.push(newMsg);
        thread.lastMessage = text;
        thread.lastTimestamp = timestamp;
        thread.unreadCount++;

        // Persist to SQLite
        persistThreadToDb(thread, isGroup);
        persistMessageToDb(newMsg);

        // Broadcast to Focused 1-Chat UI
        sseBus.emit('wa:message', { chatJid, message: newMsg });

        // Rule-based Topic & Event Proposal Analysis (Zero Token Burn)
        const triage = ruleBasedUrgencyTriage(text, senderName);
        const topic = detectTopicCategory(text, groupName);
        const proposal = extractEventProposal(text, topic, groupName, senderName);

        // Save to wa_tag_mentions if it's a mention, urgent keyword, event proposal, or active academic/org topic
        if (triage.isMention || triage.urgency === 'high' || proposal.hasProposal === 1 || topic !== 'umum') {
          try {
            const db = getDb();
            const id = `wa_live_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
            db.prepare(
              `INSERT OR IGNORE INTO wa_tag_mentions
               (id, group_name, sender_display, message_timestamp, quoted_message, matched_alias, ai_intent, ai_urgency, replied_status, content_hash, topic_category, has_event_proposal, proposed_event_title, proposed_event_start, proposed_event_end, proposed_event_location, proposal_status)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unreplied', ?, ?, ?, ?, ?, ?, ?, ?)`,
            ).run(
              id,
              groupName,
              senderName,
              new Date().toISOString(),
              text.slice(0, 300),
              triage.isMention ? '@Arthur' : proposal.hasProposal ? 'Event Proposal' : 'Topic Keyword',
              proposal.hasProposal ? 'meeting_invite' : triage.intent,
              proposal.hasProposal ? 'high' : triage.urgency,
              `hash_${Date.now()}_${msg.key.id}`,
              topic,
              proposal.hasProposal,
              proposal.proposedTitle,
              proposal.proposedStart,
              proposal.proposedEnd,
              proposal.proposedLocation,
              proposal.proposalStatus,
            );
            sseBus.emit('wa:tag_mention', {
              id,
              text,
              urgency: triage.urgency,
              topic,
              hasProposal: proposal.hasProposal,
            });
            if (proposal.hasProposal === 1) {
              sseBus.emit('wa:proposal_new', {
                id,
                proposedTitle: proposal.proposedTitle,
                startAt: proposal.proposedStart,
              });
            }
          } catch (err) {
            console.error('[baileys] error saving live tag mention:', err);
          }
        }
      }
    });
  } catch (err) {
    console.error('[baileys] init failed:', err);
    connectionStatus = 'disconnected';
    sock = null;
  }
}

export function disconnectBaileys(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  if (sock) {
    sock.end(undefined);
    sock = null;
    connectionStatus = 'disconnected';
    currentQrDataUrl = null;
    reconnectAttempts = 0;
    sseBus.emit('wa:status', getBaileysStatus());
  }
}
