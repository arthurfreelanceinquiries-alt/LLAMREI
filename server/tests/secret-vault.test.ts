import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { promisify } from 'node:util';
import { getSecret, getSecretStatus, setSecret } from '../services/secret.service.ts';

const execute = promisify(execFile);
const VAULT_FILE = '.secrets.vault.json';
const KEY_FILE = '.secrets.vault.key';
const LEGACY_KEY = 'fixture-legacy-value';

function setupVault(t: TestContext): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llamrei-vault-test-'));
  const names = ['LLAMREI_VAULT_DIR', 'LLAMREI_DISABLE_LIBSECRET', 'GEMINI_API_KEY', 'GROQ_API_KEY', 'NOTION_TOKEN'];
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  for (const name of names) delete process.env[name];
  process.env.LLAMREI_VAULT_DIR = dir;
  process.env.LLAMREI_DISABLE_LIBSECRET = '1';
  t.after(() => {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

function seedLegacyVault(dir: string): Buffer {
  const key = crypto.scryptSync(
    `${os.hostname()}:${os.userInfo().username}:app.llamrei.dashboard`,
    'llamrei-local-vault-salt-v1',
    32,
  );
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([
    cipher.update(JSON.stringify({ GEMINI_API_KEY: LEGACY_KEY }), 'utf8'),
    cipher.final(),
  ]);
  const bytes = Buffer.from(JSON.stringify({
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
    data: data.toString('hex'),
  }));
  fs.writeFileSync(path.join(dir, VAULT_FILE), bytes, { mode: 0o600 });
  return bytes;
}

test('fallback vault migrates the legacy ciphertext and restores with its key', (t) => {
  const dir = setupVault(t);
  const original = seedLegacyVault(dir);
  assert.equal(getSecret('GEMINI_API_KEY'), LEGACY_KEY);

  const ciphertext = path.join(dir, VAULT_FILE);
  const key = path.join(dir, KEY_FILE);
  assert.equal(JSON.parse(fs.readFileSync(ciphertext, 'utf8')).version, 2);
  assert.notDeepEqual(fs.readFileSync(ciphertext), original);
  assert.equal(fs.statSync(key).size, 32);
  if (process.getuid) {
    assert.equal(fs.statSync(key).mode & 0o777, 0o600);
    assert.equal(fs.statSync(ciphertext).mode & 0o777, 0o600);
  }

  const restore = fs.mkdtempSync(path.join(dir, 'restore-'));
  fs.copyFileSync(ciphertext, path.join(restore, VAULT_FILE));
  fs.copyFileSync(key, path.join(restore, KEY_FILE));
  process.env.LLAMREI_VAULT_DIR = restore;
  assert.equal(getSecret('GEMINI_API_KEY'), LEGACY_KEY);
  assert.deepEqual(getSecretStatus().GEMINI_API_KEY, { configured: true, masked: '••••••••' });
  process.env.GEMINI_API_KEY = 'fixture-override';
  assert.equal(getSecret('GEMINI_API_KEY'), 'fixture-override');
  delete process.env.GEMINI_API_KEY;

  setSecret('GEMINI_API_KEY', '');
  assert.equal(getSecret('GEMINI_API_KEY'), null);
  process.env.LLAMREI_VAULT_DIR = dir;
  assert.equal(getSecret('GEMINI_API_KEY'), LEGACY_KEY);
});

test('a missing or invalid vault key never replaces the authenticated ciphertext', (t) => {
  const dir = setupVault(t);
  setSecret('GEMINI_API_KEY', 'fixture-current');
  const key = path.join(dir, KEY_FILE);
  const file = path.join(dir, VAULT_FILE);
  const keyBackup = fs.readFileSync(key);
  const cipherBackup = fs.readFileSync(file);
  fs.unlinkSync(key);

  assert.equal(getSecret('GEMINI_API_KEY'), null);
  assert.throws(() => setSecret('GROQ_API_KEY', 'fixture-new'), /vault key is missing or invalid/);
  assert.deepEqual(fs.readFileSync(file), cipherBackup);
  assert.equal(fs.existsSync(key), false);
  fs.writeFileSync(key, keyBackup, { mode: 0o600 });
  assert.equal(getSecret('GEMINI_API_KEY'), 'fixture-current');

  fs.writeFileSync(file, '{"version":2}', { mode: 0o600 });
  assert.equal(getSecret('GEMINI_API_KEY'), null);
  assert.throws(() => setSecret('GROQ_API_KEY', 'fixture-new'), /vault payload is invalid/);
  assert.equal(fs.readFileSync(file, 'utf8'), '{"version":2}');
});

test('fallback vault serializes migration and simultaneous writes across processes', async (t) => {
  const dir = setupVault(t);
  seedLegacyVault(dir);
  const service = new URL('../services/secret.service.ts', import.meta.url).href;
  const child = `
    import { setSecret } from ${JSON.stringify(service)};
    setSecret(process.argv[1], process.argv[2]);
  `;
  const options = { env: { LLAMREI_VAULT_DIR: dir, LLAMREI_DISABLE_LIBSECRET: '1' } };
  await Promise.all([
    execute(process.execPath, ['--input-type=module', '-e', child, 'GROQ_API_KEY', 'fixture-groq'], options),
    execute(process.execPath, ['--input-type=module', '-e', child, 'NOTION_TOKEN', 'fixture-notion'], options),
  ]);

  assert.equal(getSecret('GEMINI_API_KEY'), LEGACY_KEY);
  assert.equal(getSecret('GROQ_API_KEY'), 'fixture-groq');
  assert.equal(getSecret('NOTION_TOKEN'), 'fixture-notion');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, VAULT_FILE), 'utf8')).version, 2);
});
