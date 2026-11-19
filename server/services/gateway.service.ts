import { getSecret } from './secret.service.ts';
import { pushPhoneNotification, sendToPhone } from './nectarlink.service.ts';

export type OutboundChannel = 'wa_gateway' | 'nectarlink_bridge' | 'wa_me_manual' | 'telegram' | 'email';

export function buildWaMeUrl(phoneE164: string, messageBody: string): string {
  const digits = phoneE164.replace(/[^\d]/g, '');
  return `https://wa.me/${digits}?text=${encodeURIComponent(messageBody)}`;
}

export interface DispatchResult {
  deliveredAuto: boolean;
  finalStatus: 'sent_auto' | 'reminded_fallback';
  channelUsed: OutboundChannel;
  waMeUrl: string;
  detail: Record<string, unknown>;
}

/**
 * Dispatches an ALREADY-APPROVED scheduled message through the configured official/authorized
 * channel, always producing a valid `wa.me` fallback URL if automatic delivery isn't active.
 */
export async function dispatchApprovedMessage(params: {
  recipientName: string;
  recipientAddress: string;
  channel: OutboundChannel;
  messageBody: string;
}): Promise<DispatchResult> {
  const waMeUrl = buildWaMeUrl(params.recipientAddress, params.messageBody);

  // 1. Telegram Bot API (Official)
  if (params.channel === 'telegram') {
    const botToken = getSecret('TELEGRAM_BOT_TOKEN');
    if (botToken) {
      try {
        const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: params.recipientAddress, text: params.messageBody }),
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          const json = (await res.json()) as Record<string, unknown>;
          return {
            deliveredAuto: true,
            finalStatus: 'sent_auto',
            channelUsed: 'telegram',
            waMeUrl,
            detail: json,
          };
        }
      } catch {
        // Fall through to fallback
      }
    }
  }

  // 2. Approved WA Gateway Webhook
  if (params.channel === 'wa_gateway') {
    const webhookUrl = getSecret('WA_GATEWAY_WEBHOOK_URL');
    const webhookToken = getSecret('WA_GATEWAY_TOKEN');
    if (webhookUrl) {
      try {
        const res = await fetch(webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(webhookToken ? { Authorization: `Bearer ${webhookToken}` } : {}),
          },
          body: JSON.stringify({
            to: params.recipientAddress,
            recipientName: params.recipientName,
            message: params.messageBody,
          }),
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          return {
            deliveredAuto: true,
            finalStatus: 'sent_auto',
            channelUsed: 'wa_gateway',
            waMeUrl,
            detail: { httpStatus: res.status, gateway: webhookUrl },
          };
        }
      } catch {
        // Fall through to NectarLink / wa.me fallback
      }
    }
  }

  // 3. NectarLink Phone Handoff (pushes wa.me link & notification directly to Arthur's Android phone)
  if (params.channel === 'nectarlink_bridge' || params.channel === 'wa_gateway') {
    const handoff = await sendToPhone({ url: waMeUrl, text: params.messageBody });
    await pushPhoneNotification({
      title: `💬 Kirim Chat Terjadwal → ${params.recipientName}`,
      body: params.messageBody,
    });
    if (handoff.via === 'nectarlink_api') {
      return {
        deliveredAuto: false,
        finalStatus: 'reminded_fallback',
        channelUsed: 'nectarlink_bridge',
        waMeUrl,
        detail: { note: 'Link wa.me & notifikasi dikirim ke HP via NectarLink untuk 1-tap kirim' },
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
