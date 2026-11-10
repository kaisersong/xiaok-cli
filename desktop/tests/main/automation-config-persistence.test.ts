// @vitest-environment node
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, expect, it } from 'vitest';
import * as configModule from '../../../src/utils/config.js';
import { DEFAULT_CONFIG } from '../../../src/types.js';
let root: string, previous: string | undefined;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'automation-config-owned-')); previous = process.env['XIAOK_CONFIG_DIR']; process.env['XIAOK_CONFIG_DIR'] = root; });
afterEach(() => { if (previous === undefined) delete process.env['XIAOK_CONFIG_DIR']; else process.env['XIAOK_CONFIG_DIR'] = previous; rmSync(root, { recursive: true, force: true }); });
function update(): (enabled: unknown, source?: 'user' | 'agent' | 'scheduler') => void {
  const method = (configModule as unknown as Record<string, unknown>)['updateGlobalBackgroundAutoRun']; expect(typeof method).toBe('function'); return method as ReturnType<typeof update>;
}
it('updates only the flag in a fresh normalized real owned config with the original async ABI', async () => {
  await configModule.saveConfig({ ...structuredClone(DEFAULT_CONFIG), automations: { globalBackgroundAutoRunEnabled: true }, unrelatedOwnedMarker: 'retained' } as typeof DEFAULT_CONFIG);
  const before = await configModule.loadConfig(); expect(update()(false, 'user')).toBeUndefined(); const after = await configModule.loadConfig();
  expect(after).toEqual({ ...before, automations: { ...before.automations, globalBackgroundAutoRunEnabled: false } });
  expect(JSON.parse(readFileSync(join(root, 'config.json'), 'utf8')).unrelatedOwnedMarker).toBe('retained');
});
it.each([undefined, 'agent', 'scheduler'])('rejects %s before touching the actual config directory', source => {
  expect(() => update()(false, source as 'agent' | 'scheduler' | undefined)).toThrow('automation_config_request_source_forbidden'); expect(existsSync(join(root, 'config.json'))).toBe(false);
});
it.each([undefined, null, 1, 'false', {}])('rejects invalid scalar %s without writing', value => {
  expect(() => update()(value, 'user')).toThrow('automation_config_input_invalid'); expect(existsSync(join(root, 'config.json'))).toBe(false);
});
it('preserves malformed credential config instead of resetting it during a public toggle',()=>{const file=join(root,'config.json');writeFileSync(file,'{bad');expect(()=>update()(false,'user')).toThrow('credential_config_corrupt');expect(readFileSync(file,'utf8')).toBe('{bad');expect(existsSync(file+'.bak')).toBe(false);});

it('performs two real semantic edits in order with a fresh config each time', async () => {
  update()(false, 'user'); expect((await configModule.loadConfig()).automations?.globalBackgroundAutoRunEnabled).toBe(false);
  update()(true, 'user'); expect((await configModule.loadConfig()).automations?.globalBackgroundAutoRunEnabled).toBe(true);
});
it('rejects a stale whole-config writer instead of undoing a newer semantic edit',async()=>{await configModule.saveConfig(structuredClone(DEFAULT_CONFIG));const old=await configModule.loadConfig();update()(false,'user');await expect(configModule.saveConfig(old)).rejects.toThrow('credential_config_changed');expect((await configModule.loadConfig()).automations?.globalBackgroundAutoRunEnabled).toBe(false);});

it('keeps filesystem failure a rejection in the original async save export', async () => {
  mkdirSync(join(root, 'config.json')); let returned: unknown; expect(() => { returned = configModule.saveConfig(structuredClone(DEFAULT_CONFIG)); }).not.toThrow(); expect(returned).toBeInstanceOf(Promise); await expect(returned).rejects.toThrow();
});
