import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, readFileSync, chmodSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// 模拟 chmod 失败（只读文件系统、文件属于别人等）：此时必须中止写入，不能把 Key 写进 644 文件。
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    chmodSync: vi.fn(() => { throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' }); }),
  };
});

import { saveConfig, getConfigPath, ConfigPermissionError } from '../../src/utils/config.js';
import { DEFAULT_CONFIG } from '../../src/types.js';

describe.skipIf(process.platform === 'win32')('saveConfig when permissions cannot be tightened', () => {
  let testDir: string;
  beforeEach(() => {
    testDir = join(tmpdir(), `xiaok-perm-fail-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    process.env.XIAOK_CONFIG_DIR = testDir;
  });
  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    delete process.env.XIAOK_CONFIG_DIR;
  });

  it('aborts before writing the new key into an existing world-readable file', async () => {
    const original = JSON.stringify({ marker: 'old' });
    const { chmodSync: realChmod } = await vi.importActual<typeof import('fs')>('fs');
    writeFileSync(getConfigPath(), original);
    realChmod(getConfigPath(), 0o644);
    const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    config.providers = { anthropic: { apiKey: 'sk-secret-should-not-leak' } };

    await expect(saveConfig(config)).rejects.toBeInstanceOf(ConfigPermissionError);
    expect(readFileSync(getConfigPath(), 'utf8')).toBe(original);
  });
});
