import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

async function loadLegacyReplacement(): Promise<any> {
  return import(pathToFileURL(join(
    process.cwd(),
    'scripts/evals/kimi-k3-live-arm.mjs',
  )).href);
}

describe('Kimi K3 legacy live-arm replacement', () => {
  it('fails closed on the old product-root/print path and delegates only to the D9 runner', async () => {
    const source = await readFile(
      join(process.cwd(), 'scripts/evals/kimi-k3-live-arm.mjs'),
      'utf8',
    );
    expect(source).toContain("from './kimi-k3-d9/cli-driver.mjs'");
    expect(source).not.toContain("resolve(productRoot, 'dist', 'index.js')");
    expect(source).not.toContain("['chat', '--auto', '--print'");
    expect(source).not.toContain('process.execPath');
    expect(source).not.toContain('ai/adapters');
    expect(source).not.toContain('provider-conversation-authorization');

    const { parseD9LiveArmArgs } = await loadLegacyReplacement();
    expect(() => parseD9LiveArmArgs([
      '--product-root',
      '/tmp/old-product-root',
    ])).toThrow('KIMI_D9_LEGACY_PRODUCT_ROOT_FORBIDDEN');
    expect(() => parseD9LiveArmArgs([
      '--closure-manifest',
      '/tmp/closure.json',
      '--closure-manifest-hash',
      '11'.repeat(32),
    ])).toThrow('KIMI_D9_LIVE_ARM_ARGUMENT_INVALID');
  });
});
