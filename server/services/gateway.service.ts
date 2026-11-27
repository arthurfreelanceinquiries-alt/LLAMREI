import { getSecret } from './secret.service.ts';
import { pushPhoneNotification, sendToPhone } from './nectarlink.service.ts';

export type OutboundChannel = 'wa_gateway' | 'nectarlink_bridge' | 'wa_me_manual' | 'telegram' | 'email';

export function buildWaMeUrl(phoneE164: string, messageBody: string): string {
  const digits = phoneE164.replace(/[^\d]/g, '');
  return `https://wa.me/${digits}?text=${encodeURIComponent(messageBody)}`;
}

export interface DispatchResult {
  deliveredAuto: boolean;
  finalStatus: 'sent_auto' | 'reminded_fallback' | 'failed';
  channelUsed: OutboundChannel;
  waMeUrl?: string;
  detail: Record<string, unknown>;
}

/**
 * Dispatches an ALREADY-APPROVED scheduled message through the configured official/authorized
 * channel. An uncertain upstream result has no automatic or manual resend prompt.
 */
export async function dispatchApprovedMessage(params: {
  recipientName: string;
  recipientAddress: string;
  channel: OutboundChannel;
  messageBody: string;
  attemptId: string;
}): Promise<DispatchResult> {
  const waMeUrl = buildWaMeUrl(params.recipientAddress, params.messageBody);

  // 1. Telegram Bot API (Official)
  if (params.channel === 'telegram') {
    const botToken = getSecret('TELEGRAM_BOT_TOKEN');
    if (botToken) {
      const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: params.recipientAddress, text: params.messageBody }),
        signal: AbortSignal.timeout(5000),
        redirect: 'error',
      });
      const json = await res.json().catch(() => null) as { ok?: boolean; result?: { message_id?: number } } | null;
      if (res.ok && json?.ok === true && Number.isSafeInteger(json.result?.message_id)) {
        return {
          deliveredAuto: true,
          finalStatus: 'sent_auto',
          channelUsed: 'telegram',
          detail: { outcome: 'sent', providerMessageId: json.result?.message_id },
        };
      }
      const outcome = res.status >= 400 && res.status < 500 && json?.ok === false ? 'rejected' : 'unknown';
      return {
        deliveredAuto: false,
        finalStatus: 'failed',
        channelUsed: 'telegram',
        detail: { outcome, reason: 'telegram_unconfirmed', httpStatus: res.status },
      };
    }
  }

  // 2. Approved WA Gateway Webhook
  if (params.channel === 'wa_gateway') {
    const webhookUrl = getSecret('WA_GATEWAY_WEBHOOK_URL');
    const webhookToken = getSecret('WA_GATEWAY_TOKEN');
    if (webhookUrl) {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': params.attemptId,
          ...(webhookToken ? { Authorization: `Bearer ${webhookToken}` } : {}),
        },
        body: JSON.stringify({
          to: params.recipientAddress,
          recipientName: params.recipientName,
          message: params.messageBody,
        }),
        signal: AbortSignal.timeout(5000),
        redirect: 'error',
      });
      const json = await res.json().catch(() => null) as { delivered?: boolean } | null;
      const confirmed = res.ok && json?.delivered === true;
      return {
        deliveredAuto: confirmed,
        finalStatus: confirmed ? 'sent_auto' : 'failed',
        channelUsed: 'wa_gateway',
        detail: { outcome: confirmed ? 'sent' : 'unknown', httpStatus: res.status },
      };
    }
  }

  // 3. NectarLink Phone Handoff (pushes wa.me link & notification directly to Arthur's Android phone)
  if (params.channel === 'nectarlink_bridge' || params.channel === 'wa_gateway') {
    const handoff = await sendToPhone({ url: waMeUrl, text: params.messageBody });
    const notification = await pushPhoneNotification({
      title: `💬 Kirim Chat Terjadwal → ${params.recipientName}`,
      body: params.messageBody,
    });
    if (handoff.status === 'accepted' || notification.status === 'accepted') {
      return {
        deliveredAuto: false,
        finalStatus: 'reminded_fallback',
        channelUsed: 'nectarlink_bridge',
        waMeUrl,
        detail: { handoff: handoff.status, notification: notification.status },
      };
    }
  }

  return {
    deliveredAuto: false,
    finalStatus: 'reminded_fallback',
    channelUsed: 'wa_me_manual',
    waMeUrl,
    detail: { note: 'Pengingat aktif di Dashboard dengan tombol 1-klik wa.me' },
  };
}
