import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

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
const VAULT_AAD = Buffer.from(`${SERVICE_NAME}:vault:2`);
const SECRET_KEYS: readonly SecretKeyName[] = [
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

function vaultDirectory(): string {
  return process.env.LLAMREI_VAULT_DIR ?? path.resolve(process.cwd(), 'data');
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

function deriveLegacyVaultKey(): Buffer {
  const seed = `${os.hostname()}:${os.userInfo().username}:${SERVICE_NAME}`;
  return crypto.scryptSync(seed, 'llamrei-local-vault-salt-v1', 32);
}

function checkVaultDirectory(dir: string): void {
  const stat = fs.statSync(dir);
  if (!stat.isDirectory() || (process.getuid && (stat.uid !== process.getuid() || (stat.mode & 0o022) !== 0))) {
    throw new Error('Secret vault directory must be controlled by the current user');
  }
}

function readRegularFile(file: string, privateMode: boolean): Buffer | null {
  let fd: number;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || (process.getuid && (stat.uid !== process.getuid() || (privateMode && (stat.mode & 0o077) !== 0)))) {
      throw new Error('Secret vault file permissions are unsafe');
    }
    return fs.readFileSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function writePrivateFile(file: string, bytes: string | Buffer): void {
  const dir = path.dirname(file);
  const tmp = path.join(dir, `.secrets.${crypto.randomUUID()}.tmp`);
  const fd = fs.openSync(tmp, 'wx', 0o600);
  try {
    try {
      fs.writeFileSync(fd, bytes);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, file);
    if (process.platform !== 'win32') {
      const dirFd = fs.openSync(dir, 'r');
      try {
        fs.fsyncSync(dirFd);
      } finally {
        fs.closeSync(dirFd);
      }
    }
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

function withVaultWriteLock<T>(dir: string, run: () => T): T {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  checkVaultDirectory(dir);
  const file = path.join(dir, '.secrets.lock.sqlite');
  const fd = fs.openSync(file, fs.constants.O_CREAT | fs.constants.O_RDWR | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
  fs.closeSync(fd);
  // SQLite's OS file locks serialize migration and writes, including across processes.
  // This database carries no vault data. Its transaction only holds the write lock.
  const lock = new DatabaseSync(file, { timeout: 5000 });
  try {
    lock.exec('BEGIN IMMEDIATE');
    const result = run();
    lock.exec('COMMIT');
    return result;
  } finally {
    lock.close();
  }
}

function readVaultKey(dir: string, create = false): Buffer {
  const file = path.join(dir, '.secrets.vault.key');
  const storedKey = readRegularFile(file, true);
  if (storedKey?.length === 32) return storedKey;
  if (!storedKey && create) {
    const key = crypto.randomBytes(32);
    writePrivateFile(file, key);
    return key;
  }
  throw new Error('Secret vault key is missing or invalid');
}

function readVaultState(dir: string): { values: Record<string, string>; legacy: boolean } {
  const file = path.join(dir, '.secrets.vault.json');
  const bytes = readRegularFile(file, true);
  if (!bytes) return { values: {}, legacy: false };
  const raw = JSON.parse(bytes.toString('utf8')) as { version?: unknown; iv?: unknown; tag?: unknown; data?: unknown };
  if (
    !raw || (raw.version !== undefined && raw.version !== 2) ||
    typeof raw.iv !== 'string' || !/^[\da-f]{24}$/i.test(raw.iv) ||
    typeof raw.tag !== 'string' || !/^[\da-f]{32}$/i.test(raw.tag) ||
    typeof raw.data !== 'string' || !/^(?:[\da-f]{2})+$/i.test(raw.data)
  ) {
    throw new Error('Secret vault payload is invalid');
  }
  const legacy = raw.version === undefined;
  const key = legacy ? deriveLegacyVaultKey() : readVaultKey(dir);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(raw.iv, 'hex'));
  if (!legacy) decipher.setAAD(VAULT_AAD);
  decipher.setAuthTag(Buffer.from(raw.tag, 'hex'));
  const decoded = Buffer.concat([decipher.update(Buffer.from(raw.data, 'hex')), decipher.final()]);
  const values: unknown = JSON.parse(decoded.toString('utf8'));
  if (!values || typeof values !== 'object' || Array.isArray(values) || Object.values(values).some((value) => typeof value !== 'string')) {
    throw new Error('Secret vault entries are invalid');
  }
  return { values: values as Record<string, string>, legacy };
}

function writeEncryptedVault(dir: string, map: Record<string, string>): void {
  const key = readVaultKey(dir, true);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(VAULT_AAD);
  const enc = Buffer.concat([cipher.update(JSON.stringify(map), 'utf8'), cipher.final()]);
  const payload = {
    version: 2,
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
    data: enc.toString('hex'),
  };
  writePrivateFile(path.join(dir, '.secrets.vault.json'), JSON.stringify(payload));
}

function readVaultSecret(key: SecretKeyName): string | null {
  const dir = vaultDirectory();
  if (!fs.existsSync(dir)) return null;
  checkVaultDirectory(dir);
  const state = readVaultState(dir);
  if (!state.legacy) return state.values[key] ?? null;
  return withVaultWriteLock(dir, () => {
    const current = readVaultState(dir);
    if (current.legacy) writeEncryptedVault(dir, current.values);
    return current.values[key] ?? null;
  });
}

export function getSecret(key: SecretKeyName): string | null {
  if (!SECRET_KEYS.includes(key)) return null;
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

  try {
    return readVaultSecret(key);
  } catch {
    return null;
  }
}

export function setSecret(key: SecretKeyName, value: string): { backend: 'libsecret' | 'aes256_vault' } {
  if (!SECRET_KEYS.includes(key)) throw new Error('Unknown secret key');
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

  const dir = vaultDirectory();
  withVaultWriteLock(dir, () => {
    const { values } = readVaultState(dir);
    if (clean) values[key] = clean;
    else delete values[key];
    writeEncryptedVault(dir, values);
  });
  return { backend: 'aes256_vault' };
}

export function getSecretStatus(): Record<SecretKeyName, { configured: boolean; masked: string | null }> {
  const result = {} as Record<SecretKeyName, { configured: boolean; masked: string | null }>;
  for (const k of SECRET_KEYS) {
    const val = getSecret(k);
    result[k] = {
      configured: Boolean(val),
      masked: val ? '••••••••' : null,
    };
  }
  return result;
}
