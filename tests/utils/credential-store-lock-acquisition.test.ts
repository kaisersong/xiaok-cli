import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CredentialStore } from '../../src/utils/credential-store.js';

const hooks = vi.hoisted(() => ({ beforeOwnerWrite: undefined as (() => void) | undefined }));
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, writeFileSync(...args: Parameters<typeof actual.writeFileSync>) {
    if (typeof args[0] === 'string' && args[0].endsWith(`${process.platform === 'win32' ? '\\' : '/'}owner.json`) && hooks.beforeOwnerWrite) {
      const run = hooks.beforeOwnerWrite;
      hooks.beforeOwnerWrite = undefined;
      run();
    }
    return actual.writeFileSync(...args);
  } };
});

const roots: string[] = [];
afterEach(() => {
  hooks.beforeOwnerWrite = undefined;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'xiaok-credential-lock-acquisition-'));
  roots.push(root);
  const keychain = { get: vi.fn((_id: string): string | null => null), put: vi.fn((_id: string, _value: string) => {}) };
  const store = new CredentialStore(root, keychain), id = randomUUID();
  store.put(id, 'existing-file-value');
  const file = join(root, 'credentials', 'store.json');
  return { root, keychain, store, id, file };
}

it('rejects replacement of the acquired lock before owner publication and preserves the existing vault', () => {
  const { root, store, file } = fixture(), before = readFileSync(file, 'utf8');
  const lock = join(root, 'credentials', '.lock');
  hooks.beforeOwnerWrite = () => {
    renameSync(lock, join(root, 'original-acquired-lock'));
    mkdirSync(lock, { mode: 0o700 });
  };
  expect(() => store.put(randomUUID(), 'must-not-commit')).toThrow('credential_config_changed');
  expect(readFileSync(file, 'utf8')).toBe(before);
  expect(existsSync(join(lock, 'owner.json'))).toBe(true);
  expect(existsSync(join(root, 'original-acquired-lock'))).toBe(true);
});

it.skipIf(process.platform === 'win32')('rejects a symlink substituted before owner publication without entering the vault mutation', () => {
  const { root, store, file } = fixture(), before = readFileSync(file, 'utf8');
  const lock = join(root, 'credentials', '.lock'), other = join(root, 'foreign-lock');
  mkdirSync(other, { mode: 0o700 });
  hooks.beforeOwnerWrite = () => {
    renameSync(lock, join(root, 'original-acquired-lock'));
    symlinkSync(other, lock, 'dir');
  };
  expect(() => store.put(randomUUID(), 'must-not-commit')).toThrow('credential_config_changed');
  expect(readFileSync(file, 'utf8')).toBe(before);
  expect(existsSync(join(other, 'owner.json'))).toBe(true);
});

it('keeps file credentials readable while an uncached legacy reference remains unavailable', () => {
  const { store, keychain, id, file } = fixture(), before = readFileSync(file, 'utf8');
  keychain.get.mockImplementation(() => { throw Error('keychain-locked'); });
  expect(store.get(id)).toBe('existing-file-value');
  expect(keychain.get).not.toHaveBeenCalled();
  expect(() => store.get(randomUUID())).toThrow('credential_store_unavailable');
  expect(readFileSync(file, 'utf8')).toBe(before);
  expect(store.get(id)).toBe('existing-file-value');
  expect(keychain.get).toHaveBeenCalledTimes(1);
});
