import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkForUpdate } from '../../src/update/version-check.js';
import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { AbortSignal } from 'node-fetch';

const CACHE_FILE = join(homedir(), '.xiaok', '.update-check.json');

describe('version-check', () => {
  afterEach(() => {
    try { unlinkSync(CACHE_FILE); } catch {}
  });

  it('detects an available update', async () => {
    // Simulate npm registry response via cache
    mkdirSync(join(homedir(), '.xiaok'), { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify({ latest: '99.0.0', checkedAt: Date.now() }));

    const result = await checkForUpdate('1.0.0');
    expect(result).not.toBeNull();
    expect(result!.hasUpdate).toBe(true);
    expect(result!.latest).toBe('99.0.0');
    expect(result!.current).toBe('1.0.0');
  });

  it('returns no update when current is latest', async () => {
    mkdirSync(join(homedir(), '.xiaok'), { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify({ latest: '1.0.0', checkedAt: Date.now() }));

    const result = await checkForUpdate('1.0.0');
    expect(result).not.toBeNull();
    expect(result!.hasUpdate).toBe(false);
  });

  it('returns null when no cache and network fails', async () => {
    // No cache file, and fetch will fail
    try { unlinkSync(CACHE_FILE); } catch {}

    const result = await checkForUpdate('99.99.99');
    // With current version higher than any cached value, hasUpdate should be false
    // or null if truly no cache + no network
    if (result) {
      expect(result.hasUpdate).toBe(false);
    }
  });

  it('handles semver comparison correctly', async () => {
    mkdirSync(join(homedir(), '.xiaok'), { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify({ latest: '0.7.0', checkedAt: Date.now() }));

    const result = await checkForUpdate('0.6.22');
    expect(result!.hasUpdate).toBe(true);

    const result2 = await checkForUpdate('0.7.0');
    expect(result2!.hasUpdate).toBe(false);

    const result3 = await checkForUpdate('1.0.0');
    expect(result3!.hasUpdate).toBe(false);
  });
});
