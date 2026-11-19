import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getBaileysStatus,
  listBaileysThreads,
  getBaileysThread,
  sendBaileysMessage,
} from '../services/whatsapp-baileys.service.ts';

test('Baileys WhatsApp Service: Status check & initial state', () => {
  const status = getBaileysStatus();
  assert.ok(status, 'Status object should exist');
  assert.ok(['disconnected', 'connecting', 'awaiting_qr', 'connected'].includes(status.status));
  assert.equal(typeof status.activeChatsCount, 'number');
});

test('Baileys WhatsApp Service: Focused 1-Chat reply dispatch & caching', async () => {
  const targetJid = '628123456789@s.whatsapp.net';
  const testMessage = 'Halo, ini pesan uji coba dari Focused 1-Chat Llamrei!';

  // Validation: empty text should be rejected
  const emptyRes = await sendBaileysMessage(targetJid, '   ');
  assert.equal(emptyRes.ok, false);
  assert.ok(emptyRes.error);

  // Send valid message
  const sendRes = await sendBaileysMessage(targetJid, testMessage);
  assert.equal(sendRes.ok, true);
  assert.ok(sendRes.messageId);

  // Thread should now be cached
  const thread = getBaileysThread(targetJid);
  assert.ok(thread, 'Thread should be cached after sending');
  assert.equal(thread.chatJid, targetJid);
  assert.equal(thread.lastMessage, testMessage);
  assert.ok(thread.messages.length >= 1);

  const lastMsg = thread.messages[thread.messages.length - 1];
  assert.equal(lastMsg.text, testMessage);
  assert.equal(lastMsg.isFromMe, true);
  assert.equal(lastMsg.senderName, 'Arthur (You)');

  // listBaileysThreads should contain this thread
  const allThreads = listBaileysThreads();
  assert.ok(allThreads.some((t) => t.chatJid === targetJid));
});
