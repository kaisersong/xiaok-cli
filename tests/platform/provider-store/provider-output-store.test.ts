import {
  existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  InvalidProviderOutputError,
  ProviderOutputStore,
  DELIVERED_MANIFEST,
} from '../../../src/platform/provider-store/provider-output-store.js';

/**
 * Design v58 §4.4 / R41-01 / R42-01 / R43-01. The committed identity is anchored
 * on an open handle, so swapping the pathname after validation must fail even when
 * the replacement is itself a stable regular file.
 */
describe('ProviderOutputStore promotion', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function scratch() {
    const dir = mkdtempSync(join(tmpdir(), 'output-store-'));
    dirs.push(dir);
    const configDir = join(dir, 'config');
    const workDir = join(dir, 'work');
    mkdirSync(configDir, { recursive: true });
    mkdirSync(workDir, { recursive: true });
    return { configDir, workDir, store: new ProviderOutputStore(configDir) };
  }

  const base = {
    providerName: 'kai-slide-creator',
    sourceDigest: 'sha256-aaa',
    runtimeContractDigest: 'sha256-rt',
  };

  it('promotes a scratch artifact and returns an absolute durable path', () => {
    const { workDir, store } = scratch();
    writeFileSync(join(workDir, 'output.html'), '<html>deck</html>');

    const delivered = store.promote({ ...base, invocationWorkDir: workDir, backendOutputPath: 'output.html' });

    expect(delivered.absolutePath.startsWith('/')).toBe(true);
    expect(readFileSync(delivered.absolutePath, 'utf8')).toBe('<html>deck</html>');
    expect(delivered.size).toBe('<html>deck</html>'.length);
    // The scratch file is gone: it was renamed, not copied twice.
    expect(existsSync(join(workDir, 'output.html'))).toBe(false);
  });

  it('records a DELIVERED manifest with both file identities', () => {
    const { workDir, store } = scratch();
    writeFileSync(join(workDir, 'output.html'), 'x');

    const delivered = store.promote({ ...base, invocationWorkDir: workDir, backendOutputPath: 'output.html' });
    const manifest = JSON.parse(
      readFileSync(join(delivered.absolutePath, '..', DELIVERED_MANIFEST), 'utf8'),
    );

    expect(manifest).toMatchObject({
      provider: 'kai-slide-creator',
      sourceDigest: 'sha256-aaa',
      streamSize: 1,
      size: 1,
    });
    expect(manifest.sourceFileIdentity.ino).toBeGreaterThan(0);
    expect(manifest.streamSha256).toBe(delivered.sha256);
  });

  it('survives maintenance and app restart: the returned path stays readable', () => {
    const { configDir, workDir, store } = scratch();
    writeFileSync(join(workDir, 'output.html'), 'durable');
    const delivered = store.promote({ ...base, invocationWorkDir: workDir, backendOutputPath: 'output.html' });

    // Simulate a later process wiping every scratch workdir.
    rmSync(workDir, { recursive: true, force: true });
    const reopened = new ProviderOutputStore(configDir);
    void reopened;

    expect(readFileSync(delivered.absolutePath, 'utf8')).toBe('durable');
  });

  it('rejects a candidate outside the invocation workdir', () => {
    const { workDir, store } = scratch();
    const outside = join(workDir, '..', 'elsewhere.html');
    writeFileSync(outside, 'nope');

    expect(() => store.promote({
      ...base, invocationWorkDir: workDir, backendOutputPath: '../elsewhere.html',
    })).toThrow(/escapes the invocation workdir/);
  });

  it('rejects a symlink candidate', () => {
    const { workDir, store } = scratch();
    writeFileSync(join(workDir, 'real.html'), 'real');
    symlinkSync('real.html', join(workDir, 'output.html'));

    expect(() => store.promote({
      ...base, invocationWorkDir: workDir, backendOutputPath: 'output.html',
    })).toThrow(/symlink/);
  });

  it('rejects a directory and a missing candidate', () => {
    const { workDir, store } = scratch();
    mkdirSync(join(workDir, 'as-dir'));

    expect(() => store.promote({
      ...base, invocationWorkDir: workDir, backendOutputPath: 'as-dir',
    })).toThrow(/directory/);
    expect(() => store.promote({
      ...base, invocationWorkDir: workDir, backendOutputPath: 'ghost.html',
    })).toThrow(/does not exist/);
  });

  it('rejects an oversized candidate before streaming it', () => {
    const { workDir, store } = scratch();
    writeFileSync(join(workDir, 'output.html'), Buffer.alloc(4096));

    expect(() => store.promote({
      ...base, invocationWorkDir: workDir, backendOutputPath: 'output.html', maxBytes: 1024,
    })).toThrow(/exceeds 1024 bytes/);
  });

  it('fails closed when the pathname is swapped for another stable file after validation', () => {
    const { workDir, store } = scratch();
    const candidate = join(workDir, 'output.html');
    writeFileSync(candidate, 'validated-A');

    expect(() => store.promote({
      ...base,
      invocationWorkDir: workDir,
      backendOutputPath: 'output.html',
      onBeforeRename: () => {
        // B is a perfectly ordinary regular file — only its inode differs.
        rmSync(candidate);
        writeFileSync(candidate, 'substituted-B');
      },
    })).toThrow(/A→B swap|does not exist/);
  });

  it('fails closed when the candidate is modified mid-stream', () => {
    const { workDir, store } = scratch();
    const candidate = join(workDir, 'output.html');
    writeFileSync(candidate, Buffer.alloc(200 * 1024, 0x41));
    let staging: string | null = null;

    expect(() => store.promote({
      ...base,
      invocationWorkDir: workDir,
      backendOutputPath: 'output.html',
      onMidStream: () => {
        // Append to the same inode while the single stream is still running.
        const dir = join(workDir, '..', 'config', 'provider-outputs-v1', base.providerName);
        staging = readdirSync(dir).find((n) => n.startsWith('.staging-')) ?? null;
        writeFileSync(join(dir, staging!, 'intake'), Buffer.alloc(300 * 1024, 0x42));
      },
    })).toThrow(/changed while it was being read|disagrees with the validated size/);
  });

  it('leaves no staging directory behind after a rejection', () => {
    const { configDir, workDir, store } = scratch();
    writeFileSync(join(workDir, 'output.html'), 'x');

    expect(() => store.promote({
      ...base,
      invocationWorkDir: workDir,
      backendOutputPath: 'output.html',
      onBeforeRename: () => { rmSync(join(workDir, 'output.html')); },
    })).toThrow();

    const providerDir = join(configDir, 'provider-outputs-v1', base.providerName);
    const leftovers = existsSync(providerDir)
      ? readdirSync(providerDir).filter((n) => n.startsWith('.staging-'))
      : [];
    expect(leftovers).toEqual([]);
  });

  it('promotes two consecutive renders to distinct durable outputs', () => {
    const { workDir, store } = scratch();

    writeFileSync(join(workDir, 'output.html'), 'deck-1');
    const first = store.promote({ ...base, invocationWorkDir: workDir, backendOutputPath: 'output.html' });
    writeFileSync(join(workDir, 'output.html'), 'deck-2');
    const second = store.promote({ ...base, invocationWorkDir: workDir, backendOutputPath: 'output.html' });

    expect(first.absolutePath).not.toBe(second.absolutePath);
    expect(readFileSync(first.absolutePath, 'utf8')).toBe('deck-1');
    expect(readFileSync(second.absolutePath, 'utf8')).toBe('deck-2');
  });
});
