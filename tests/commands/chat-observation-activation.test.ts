import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';

describe('actual CLI observation activation boundary', () => {
  it.skipIf(process.platform !== 'darwin' || process.arch !== 'arm64' || !existsSync(join(homedir(), '.cache/xiaok/sol-pi/deepseek-recipe-0.1.1/environment.json')))('executes an explicitly delegated child at the real CLI entry with shared sticky closure', () => {
    const result = spawnSync(process.execPath, [resolve('tests/support/sol-pi-cli-product-smoke.mjs'), '--delegated-child'], { encoding: 'utf8', timeout: 70000 });
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout.trim());
    expect(report.status, report.diagnostic).toBe(0);
    expect(report.fetchCalls).toBe(4);
    expect(report.tools).toContain('subagent');
    expect(report.models).toEqual(Array(4).fill('deepseek-flash'));
    expect(report.reply).toBe('PRODUCT_ENTRY_DONE');
    expect(report.configModel).toBe('old-alias');
    expect(report.protectedSnapshots).toBe(2);
    expect(report.sharedClosure[0].closure).toEqual(report.sharedClosure[1].closure);
    expect(report.sharedClosure[0].closure.observations).toHaveLength(1);
    expect(report.authorityClean).toBe(true);
  }, 75000);

  it.skipIf(process.platform !== 'darwin' || process.arch !== 'arm64' || !existsSync(join(homedir(), '.cache/xiaok/sol-pi/deepseek-recipe-0.1.1/environment.json')))('uses the actual CLI startup, isolated native registry, durable closure and temporary model selection', () => {
    const result = spawnSync(process.execPath, [resolve('tests/support/sol-pi-cli-product-smoke.mjs'), '--delete-after'], { encoding: 'utf8', timeout: 70000 });
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout.trim());
    expect(report.status, report.diagnostic).toBe(0);
    expect(report.fetchCalls).toBe(2);
    expect(report.tools).toEqual(['read', 'write', 'edit', 'bash', 'grep', 'glob', 'observation_read']);
    expect(report.models).toEqual(['deepseek-flash', 'deepseek-flash']);
    expect(report.bodySeenInSecond).toBe(true);
    expect(report.protectedOwnershipAtSecondFetch?.state).toBe('owned');
    expect(report.protectedOwnershipAtSecondFetch?.ownerInstanceId).toEqual(expect.any(String));
    expect(report.reply).toBe('PRODUCT_ENTRY_DONE');
    expect(report.configModel).toBe('old-alias');
    expect(report.protectedSnapshots).toBe(1);
    expect(report.deletion, report.deletion?.diagnostic).toEqual({ status: 0, snapshotGone: true, journalCommitted: true, pins: [], privateReconciliation: true, bodyRetained: true });
  }, 75000);
  it.skipIf(process.platform !== 'darwin' || process.arch !== 'arm64' || !existsSync(join(homedir(), '.cache/xiaok/sol-pi/deepseek-recipe-0.1.1/environment.json')))('closes protected stores before a failed single-shot process exits', () => {
    const result = spawnSync(process.execPath, [resolve('tests/support/sol-pi-cli-product-smoke.mjs'), '--fail-provider'], { encoding: 'utf8', timeout: 70000 });
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout.trim());
    expect(report.status).toBe(1);
    expect(report.authorityClean).toBe(true);
    expect(report.protectedSnapshots).toBe(1);
  }, 75000);
  it.skipIf(process.platform !== 'darwin' || process.arch !== 'arm64' || !existsSync(join(homedir(), '.cache/xiaok/sol-pi/deepseek-recipe-0.1.1/environment.json')))('rejects attaching an external channel to the ordinary protected session before channel selection', () => {
    const result = spawnSync(process.execPath, [resolve('tests/support/sol-pi-cli-product-smoke.mjs'), '--interactive-boundary'], { encoding: 'utf8', timeout: 45000 });
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout.trim());
    expect(report.status, report.diagnostic).toBe(0);
    expect(report.channelBoundary).toBe(true);
    expect(report.fetchCalls).toBe(0);
    expect(report.authorityClean).toBe(true);
  }, 50000);
  it('rejects explicit archive activation with inherited session before config or network startup', () => {
    const result = spawnSync(process.execPath, ['--import', 'tsx', resolve('src/index.ts'), 'chat', '--observation-policy', 'does-not-exist.json', '--resume', 'old-session', '--print', 'test'], { encoding: 'utf8', timeout: 15000 });
    expect(result.status).toBe(2);
    expect(result.stderr + result.stdout).toContain('SOL_PI_FRESH_SESSION_REQUIRED');
    expect(result.stderr + result.stdout).not.toContain('crash-');
  });
});
