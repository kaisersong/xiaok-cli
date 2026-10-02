import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { normalizeMcpRuntimeToolResult } from '../../../src/ai/mcp/runtime/client.js';
import { createWindowsCuaDependency, verifyWindowsCuaReadiness } from '../../electron/windows-cua-runtime.js';

const fixtures = join(process.cwd(), '..', 'tests', 'fixtures', 'cua-windows-0.31.0');
const catalog = JSON.parse(readFileSync(join(fixtures, 'catalog.json'), 'utf8'));
const capture = JSON.parse(readFileSync(join(fixtures, 'capture.json'), 'utf8'));
const target = { pid: capture.structuredContent.pid, window_id: capture.structuredContent.window_id };
describe('Windows CUA activation contract', () => {
  it('uses native direct MCP and one frozen private release', () => {
    expect(createWindowsCuaDependency('C:\\Users\\test\\AppData\\Local', 'C:\\Xiaok Data\\private\\cua-driver.exe')).toMatchObject({
      kind: 'native_cli', supportedPlatforms: ['win32'], exactVersion: '0.31.0',
      binaryCandidates: ['C:\\Xiaok Data\\private\\cua-driver.exe', 'C:\\Users\\test\\AppData\\Local\\Programs\\Cua\\cua-driver\\bin\\cua-driver.exe', 'cua-driver.exe'],
      mcp: { args: ['mcp', '--direct'], requiresUserActivation: true },
      install: { kind: 'official_release_archive' },
    });
  });
  it('rejects wrong initialized identity or incompatible catalog before calling a tool', async () => {
    const call = vi.fn();
    await expect(verifyWindowsCuaReadiness({ identity: { name: 'cua-driver', version: '0.30.0' }, schemas: catalog, callToolResult: call })).rejects.toThrow('IDENTITY');
    await expect(verifyWindowsCuaReadiness({ identity: { name: 'cua-driver', version: '0.31.0' }, schemas: [], callToolResult: call })).rejects.toThrow('ABI');
    expect(call).not.toHaveBeenCalled();
  });
  it('keeps an empty desktop connected without capturing arbitrary windows', async () => {
    const call = vi.fn(async () => normalizeMcpRuntimeToolResult({ content: [], structuredContent: { windows: [] } }));
    expect(await verifyWindowsCuaReadiness({ identity: { name: 'cua-driver', version: '0.31.0' }, schemas: catalog, callToolResult: call })).toEqual({ observed: false });
    expect(call).toHaveBeenCalledExactlyOnceWith('list_windows', { on_screen_only: true });
  });
  it('validates a PNG only for the main-owned target and rejects wrong identity', async () => {
    const call = vi.fn(async (name: string) => normalizeMcpRuntimeToolResult(name === 'list_windows' ? { content: [], structuredContent: { windows: [target] } } : capture));
    expect(await verifyWindowsCuaReadiness({ identity: { name: 'cua-driver', version: '0.31.0' }, schemas: catalog, callToolResult: call, target })).toEqual({ observed: true });
    expect(call).toHaveBeenLastCalledWith('get_window_state', { ...target, include_screenshot: true });
    await expect(verifyWindowsCuaReadiness({ identity: { name: 'cua-driver', version: '0.31.0' }, schemas: catalog, callToolResult: call, target: { ...target, pid: target.pid + 1 } })).resolves.toEqual({ observed: false });
  });
});
