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
}

const AUTH_DIR = path.resolve(process.cwd(), 'data', 'wa_baileys_auth');

let sock: WASocket | null = null;
let connectionStatus: 'disconnected' | 'connecting' | 'awaiting_qr' | 'connected' = 'disconnected';
let currentQrDataUrl: string | null = null;
let connectedUserJid: string | null = null;
let connectedUserName: string | null = null;

// In-memory chat storage for real focused 1-chat replies (populated strictly from live Baileys events or user actions)
const chatThreads = new Map<string, BaileysChatThread>();
const groupMetaCache = new Map<string, string>();

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
  };
}

export function listBaileysThreads(): BaileysChatThread[] {
  return Array.from(chatThreads.values()).sort(
    (a, b) => (b.messages[b.messages.length - 1]?.id ?? '').localeCompare(a.messages[a.messages.length - 1]?.id ?? ''),
  );
}

export function getBaileysThread(chatJid: string): BaileysChatThread | null {
  return chatThreads.get(chatJid) ?? null;
}

export async function sendBaileysMessage(chatJid: string, text: string): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  if (!text.trim()) return { ok: false, error: 'Pesan tidak boleh kosong' };

  let targetJid = chatJid.trim();
  if (!targetJid.includes('@')) {
    let digits = targetJid.replace(/[^0-9]/g, '');
    if (digits.startsWith('08')) digits = '62' + digits.slice(1);
    targetJid = `${digits}@s.whatsapp.net`;
  }

  const timestamp = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' });
  const msgId = `msg_out_${Date.now()}`;

  // If Baileys is live and connected, dispatch through socket
  if (sock && connectionStatus === 'connected') {
    try {
      await sock.sendMessage(targetJid, { text: text.trim() });
    } catch (err) {
      console.error('[baileys] send message error:', err);
    }
  }

  // Update in-memory thread
  let thread = chatThreads.get(targetJid);
  if (!thread) {
    thread = {
      chatJid: targetJid,
      name: targetJid.replace('@s.whatsapp.net', ''),
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

  // Broadcast to frontend SSE
  sseBus.emit('wa:message', { chatJid: targetJid, message: newMsg });

  return { ok: true, messageId: msgId };
}

// Zero-Token-Burn Rule-based Triage (Pure Regex/Code, Zero AI Ban Risk)
function ruleBasedUrgencyTriage(text: string, senderName: string): { isMention: boolean; urgency: 'high' | 'medium' | 'low'; intent: string } {
  const lower = text.toLowerCase();
  const isMention = lower.includes('arthur') || lower.includes('@arthur') || lower.includes('art');

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
    lower.includes('rapat');

  const urgency: 'high' | 'medium' | 'low' = isHigh ? 'high' : isMedium ? 'medium' : 'low';

  let intent = 'info';
  if (lower.includes('?') || lower.includes('apakah') || lower.includes('gimana') || lower.includes('kapan')) {
    intent = 'question';
  } else if (lower.includes('tolong') || lower.includes('kirim') || lower.includes('kerjakan')) {
    intent = 'task_request';
  } else if (lower.includes('deadline') || lower.includes('paling lambat')) {
    intent = 'deadline';
  } else if (lower.includes('rapat') || lower.includes('zoom') || lower.includes('meet')) {
    intent = 'meeting_invite';
  }

  return { isMention, urgency, intent };
}

export async function initBaileysClient(): Promise<void> {
  if (sock) return;

  fs.mkdirSync(AUTH_DIR, { recursive: true });
  connectionStatus = 'connecting';

  try {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    sock = makeWASocket({
      auth: state,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      browser: ['Llamrei Co-Commander', 'Linux', '2.0.0'],
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        connectionStatus = 'awaiting_qr';
        try {
          currentQrDataUrl = await QRCode.toDataURL(qr, {
            margin: 1,
            width: 240,
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

        if (statusCode === DisconnectReason.loggedOut) {
          connectionStatus = 'disconnected';
          connectedUserJid = null;
          connectedUserName = null;
          // Clear credentials on logout
          fs.rmSync(AUTH_DIR, { recursive: true, force: true });
          sock = null;
        } else if (shouldReconnect) {
          connectionStatus = 'connecting';
          sock = null;
          setTimeout(() => void initBaileysClient(), 3000);
        } else {
          connectionStatus = 'disconnected';
          sock = null;
        }
        sseBus.emit('wa:status', getBaileysStatus());
      } else if (connection === 'open') {
        connectionStatus = 'connected';
        currentQrDataUrl = null;
        connectedUserJid = sock?.user?.id ? sock.user.id.split(':')[0] + '@s.whatsapp.net' : null;
        connectedUserName = sock?.user?.name ?? 'Arthur Reezan';
        console.log(`[baileys] WhatsApp connected as ${connectedUserName} (${connectedUserJid})`);
        sseBus.emit('wa:status', getBaileysStatus());
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
        const senderName = msg.pushName || (isGroup && msg.key.participant ? `+${msg.key.participant.replace(/[^0-9]/g, '')}` : chatJid.replace(/[^0-9]/g, ''));
        const timestamp = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' });

        // Update in-memory thread
        let thread = chatThreads.get(chatJid);
        if (!thread) {
          thread = {
            chatJid,
            name: isGroup ? `${groupName} (${senderName})` : senderName,
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
            sseBus.emit('wa:tag_mention', { id, text, urgency: triage.urgency, topic, hasProposal: proposal.hasProposal });
            if (proposal.hasProposal === 1) {
              sseBus.emit('wa:proposal_new', { id, proposedTitle: proposal.proposedTitle, startAt: proposal.proposedStart });
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
  if (sock) {
    sock.end(undefined);
    sock = null;
    connectionStatus = 'disconnected';
    currentQrDataUrl = null;
    sseBus.emit('wa:status', getBaileysStatus());
  }
}
