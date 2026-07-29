import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

async function loadScannerModule(): Promise<any> {
  return import(pathToFileURL(join(
    process.cwd(),
    'scripts/evals/kimi-k3-d9/scanner.mjs',
  )).href);
}

describe('Kimi K3 D9 exact-byte scanner', () => {
  it('proves positive control 1 then zero after exact deletion', async () => {
    const { runPositiveControlScan } = await loadScannerModule();
    const root = await mkdtemp(join(tmpdir(), 'kimi-d9-scan-'));
    try {
      await writeFile(join(root, 'safe.txt'), 'bounded evidence');
      const result = await runPositiveControlScan({
        root,
        canary: Buffer.from('independent-leak-canary'),
        probeRelativePath: 'scanner/probe.bin',
      });

      expect(result.positiveControlMatches).toBe(1);
      expect(result.finalMatches).toBe(0);
      expect(result.probeExistsAfter).toBe(false);
      expect(JSON.stringify(result)).not.toContain('independent-leak-canary');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails closed on symlink objects without reading their target', async () => {
    const { scanExactBytes } = await loadScannerModule();
    const root = await mkdtemp(join(tmpdir(), 'kimi-d9-scan-link-'));
    const outside = await mkdtemp(join(tmpdir(), 'kimi-d9-outside-'));
    try {
      await mkdir(join(root, 'nested'));
      await writeFile(join(outside, 'secret'), 'canary');
      await symlink(join(outside, 'secret'), join(root, 'nested', 'escape'));
      await expect(scanExactBytes(root, [Buffer.from('canary')]))
        .rejects.toThrow('KIMI_D9_SCANNER_SYMLINK');
      expect(await readFile(join(outside, 'secret'), 'utf8')).toBe('canary');
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});
