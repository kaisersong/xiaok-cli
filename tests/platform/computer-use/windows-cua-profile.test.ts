import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { translateCuaAction, verifyBackendAbi } from '../../../src/platform/computer-use/cua-action-contract.js';
import { WINDOWS_CUA_ABI_PROFILE } from '../../../src/platform/computer-use/windows-cua-profile.js';

const catalog = JSON.parse(readFileSync(join(process.cwd(), 'tests/fixtures/cua-windows-0.31.0/catalog.json'), 'utf8'));
const operations = catalog.map((t: any) => ({ name: t.name, required: t.inputSchema.required, properties: t.inputSchema.properties }));
describe('Windows 0.31.0 profile from interactive desktop catalog', () => {
  it('verifies the actual Windows catalog and preserves the macOS default', () => {
    expect(verifyBackendAbi(operations, WINDOWS_CUA_ABI_PROFILE)).toEqual({ ok: true });
    expect(translateCuaAction('capture', { pid: 1, window_id: 2 }, WINDOWS_CUA_ABI_PROFILE)).toEqual({ operation: 'get_window_state', input: { pid: 1, window_id: 2, include_screenshot: true } });
    expect(translateCuaAction('click', { pid: 1, window_id: 2, element_token: 's00000001:5' }, WINDOWS_CUA_ABI_PROFILE).input).toEqual({ pid: 1, window_id: 2, element_token: 's00000001:5', delivery_mode: 'background', scope: 'window' });
    expect(translateCuaAction('click', { element_index: 5, snapshot_id: 's00000001', window_id: 2 }).input).toHaveProperty('element_index', 5);
  });
  it('rejects schema type and enum drift before connection activation', () => {
    for (const mutate of [(p: any) => { p.window_id.type = 'string'; }, (p: any) => { p.delivery_mode.enum = ['foreground']; }]) {
      const changed = structuredClone(operations);
      mutate(changed.find((t: any) => t.name === 'click').properties);
      expect(verifyBackendAbi(changed, WINDOWS_CUA_ABI_PROFILE).ok).toBe(false);
    }
  });
  it('never forwards old index/snapshot or desktop-target fields and rejects invalid addresses', () => {
    const output = translateCuaAction('click', { pid: 1, window_id: 2, element_index: 5, snapshot_id: 's00000001', target: { kind: 'desktop', display_id: 'primary' }, scope: 'desktop', x: 5, y: 6 }, WINDOWS_CUA_ABI_PROFILE).input;
    expect(output).not.toHaveProperty('element_index'); expect(output).not.toHaveProperty('snapshot_id'); expect(output).not.toHaveProperty('target');
    expect(output.scope).toBe('window');
    for (const pid of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) expect(() => translateCuaAction('capture', { pid, window_id: 2 }, WINDOWS_CUA_ABI_PROFILE)).toThrow();
  });
});
