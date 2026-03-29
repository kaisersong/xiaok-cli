import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { getDevAppIdentity, formatIdentityContext } from '../../src/auth/identity.js';

describe('identity', () => {
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

  it('returns null when devApp not configured', async () => {
    expect(await getDevAppIdentity()).toBeNull();
  });

  it('returns devApp when configured', async () => {
    writeFileSync(join(testDir, 'config.json'), JSON.stringify({
      schemaVersion: 1, defaultModel: 'claude', models: {}, defaultMode: 'interactive',
      contextBudget: 4000, devApp: { appKey: 'key123', appSecret: 'secret456' },
    }));
    const identity = await getDevAppIdentity();
    expect(identity?.appKey).toBe('key123');
  });

  it('formatIdentityContext returns empty string for null', () => {
    expect(formatIdentityContext(null)).toBe('');
  });

  it('formatIdentityContext includes appKey', () => {
    expect(formatIdentityContext({ appKey: 'key123', appSecret: 'sec' })).toContain('key123');
  });
});
