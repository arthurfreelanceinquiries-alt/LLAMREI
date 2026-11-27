import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export type SecretKeyName =
  | 'GEMINI_API_KEY'
  | 'OPENCODE_API_KEY'
  | 'OPENROUTER_API_KEY'
  | 'GROQ_API_KEY'
  | 'COMPOSIO_API_KEY'
  | 'NOTION_TOKEN'
  | 'FINNHUB_API_KEY'
  | 'WA_GATEWAY_WEBHOOK_URL'
  | 'WA_GATEWAY_TOKEN'
  | 'TELEGRAM_BOT_TOKEN';

const SERVICE_NAME = 'app.llamrei.dashboard';

function vaultFilePath(): string {
  const dir = process.env.LLAMREI_VAULT_DIR ?? path.resolve(process.cwd(), 'data');
  return path.join(dir, '.secrets.vault.json');
}

function hasSecretTool(): boolean {
  if (process.env.LLAMREI_DISABLE_LIBSECRET === '1') return false;
  try {
    execFileSync('which', ['secret-tool'], { stdio: 'ignore' });
    return Boolean(process.env.DBUS_SESSION_BUS_ADDRESS);
  } catch {
    return false;
  }
}

function deriveVaultKey(): Buffer {
  const seed = `${os.hostname()}:${os.userInfo().username}:${SERVICE_NAME}`;
  return crypto.scryptSync(seed, 'llamrei-local-vault-salt-v1', 32);
}

function readEncryptedVault(): Record<string, string> {
  const file = vaultFilePath();
  if (!fs.existsSync(file)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { iv: string; tag: string; data: string };
    const decipher = crypto.createDecipheriv('aes-256-gcm', deriveVaultKey(), Buffer.from(raw.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(raw.tag, 'hex'));
    const dec = Buffer.concat([decipher.update(Buffer.from(raw.data, 'hex')), decipher.final()]);
    return JSON.parse(dec.toString('utf8')) as Record<string, string>;
  } catch {
    return {};
  }
}

function writeEncryptedVault(map: Record<string, string>): void {
  const file = vaultFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveVaultKey(), iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(map), 'utf8'), cipher.final()]);
  const payload = {
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
    data: enc.toString('hex'),
  };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), { mode: 0o600 });
}

export function getSecret(key: SecretKeyName): string | null {
  if (process.env[key]) return process.env[key] ?? null;

  if (hasSecretTool()) {
    try {
      const out = execFileSync('secret-tool', ['lookup', 'service', SERVICE_NAME, 'key', key], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (out) return out;
    } catch {
      // Fallback to encrypted local vault
    }
  }

  const vault = readEncryptedVault();
  return vault[key] ?? null;
}

export function setSecret(key: SecretKeyName, value: string): { backend: 'libsecret' | 'aes256_vault' } {
  const clean = value.trim();
  if (hasSecretTool()) {
    try {
      execFileSync(
        'secret-tool',
        ['store', `--label=Llamrei ${key}`, 'service', SERVICE_NAME, 'key', key],
        { input: clean, encoding: 'utf8', stdio: ['pipe', 'ignore', 'ignore'] },
      );
      return { backend: 'libsecret' };
    } catch {
      // Fallback below
    }
  }

  const vault = readEncryptedVault();
  if (!clean) {
    delete vault[key];
  } else {
    vault[key] = clean;
  }
  writeEncryptedVault(vault);
  return { backend: 'aes256_vault' };
}

export function getSecretStatus(): Record<SecretKeyName, { configured: boolean; masked: string | null }> {
  const keys: SecretKeyName[] = [
    'GEMINI_API_KEY',
    'OPENCODE_API_KEY',
    'OPENROUTER_API_KEY',
    'GROQ_API_KEY',
    'COMPOSIO_API_KEY',
    'NOTION_TOKEN',
    'FINNHUB_API_KEY',
    'WA_GATEWAY_WEBHOOK_URL',
    'WA_GATEWAY_TOKEN',
    'TELEGRAM_BOT_TOKEN',
  ];
  const result = {} as Record<SecretKeyName, { configured: boolean; masked: string | null }>;
  for (const k of keys) {
    const val = getSecret(k);
    result[k] = {
      configured: Boolean(val),
      masked: val ? `${val.slice(0, 4)}••••${val.slice(-4)}` : null,
    };
  }
  return result;
}
