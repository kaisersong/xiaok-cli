import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, statSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { saveCredentials, loadCredentials, clearCredentials } from '../../src/auth/token-store.js';
import type { Credentials } from '../../src/types.js';

const MOCK_CREDS: Credentials = {
  schemaVersion: 1,
  accessToken: 'tok_abc',
  refreshToken: 'rtok_abc',
  enterpriseId: 'ent_123',
  userId: 'usr_456',
  expiresAt: '2099-01-01T00:00:00Z',
};

describe('token-store', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `xiaok-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    process.env.XIAOK_CONFIG_DIR = testDir;
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    delete process.env.XIAOK_CONFIG_DIR;
  });

  it('returns null when no credentials file exists', async () => {
    expect(await loadCredentials()).toBeNull();
  });

  it('saves and loads credentials', async () => {
    await saveCredentials(MOCK_CREDS);
    const loaded = await loadCredentials();
    expect(loaded?.accessToken).toBe('tok_abc');
    expect(loaded?.enterpriseId).toBe('ent_123');
  });

  it('sets file mode 0600 on Unix', async () => {
    if (process.platform === 'win32') return;
    await saveCredentials(MOCK_CREDS);
    const stat = statSync(join(testDir, 'credentials.json'));
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it('clearCredentials removes the file', async () => {
    await saveCredentials(MOCK_CREDS);
    await clearCredentials();
    expect(await loadCredentials()).toBeNull();
  });
});
