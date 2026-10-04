import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { MACOS_CUA_ABI_PROFILE, verifyBackendAbi } from '../../../src/platform/computer-use/cua-action-contract.js';
import { createMacosCuaConnection, selectMacosCuaAbiProfile } from '../../../src/platform/computer-use/macos-cua-connection.js';
import { createComputerUseTool } from '../../../src/ai/tools/computer-use.js';
import { CuaConnectionManager } from '../../../src/platform/mcp/cua-connection-manager.js';

const catalog = JSON.parse(readFileSync(new URL('../../fixtures/cua-macos-0.33.1/catalog.json', import.meta.url), 'utf8'));
const result = { text: 'ok', summary: 'ok', images: [], isError: false };
function fixture(ops = catalog) {
  const raw = { callToolResult: vi.fn(async (_name: string, _input: Record<string, unknown>, _options?: { signal?: AbortSignal }) => result), dispose: vi.fn() };
  return { raw, connection: createMacosCuaConnection(ops, raw) };
}

describe('macOS native connection compatibility', () => {
  it('reproduces the 16 legacy failures but selects the frozen live 0.33.1 profile', () => {
    const old = verifyBackendAbi(catalog);
    expect(old.ok).toBe(false);
    if (!old.ok) expect(old.problems).toHaveLength(16);
    expect(selectMacosCuaAbiProfile(catalog).id).toBe('macos-0.33.1');
  });
  it('keeps the legacy complete catalog supported', () => {
    const legacy = structuredClone(catalog);
    for (const op of legacy) if (op.properties.element_token) Object.assign(op.properties, {
      element_index: { type: 'integer' }, snapshot_id: { type: 'string' },
    });
    expect(selectMacosCuaAbiProfile(legacy)).toBe(MACOS_CUA_ABI_PROFILE);
  });
  it.each(['missing', 'type', 'required', 'partial'])('refuses %s ABI drift', drift => {
    const broken = structuredClone(catalog);
    const click = broken.find((op: { name: string }) => op.name === 'click');
    if (drift === 'missing') delete click.properties.element_token;
    if (drift === 'type') click.properties.element_token.type = 'integer';
    if (drift === 'required') click.required.push('unknown_authority');
    if (drift === 'partial') click.properties.element_index = { type: 'integer' };
    expect(() => selectMacosCuaAbiProfile(broken)).toThrow(/ABI/);
  });
  it.each(['click', 'double_click', 'right_click', 'scroll', 'type_text', 'press_key', 'set_value'])('translates legacy target for %s before native dispatch', async operation => {
    const { raw, connection } = fixture();
    await connection.callToolResult(operation, { pid: 12, window_id: 34, snapshot_id: 's00000001', element_index: '2',
      direction: 'down', text: 'hello', key: 'Enter', value: 'hello', action: 'grant', permission_mode: 'unrestricted' });
    expect(raw.callToolResult).toHaveBeenCalledWith(operation, expect.objectContaining({ element_token: 's00000001:2' }), undefined);
    const payload = raw.callToolResult.mock.calls[0][1];
    for (const field of ['snapshot_id', 'element_index', 'action', 'permission_mode']) expect(payload).not.toHaveProperty(field);
  });
  it.each([
    { element_index: 2, window_id: 34 },
    { element_index: -1, snapshot_id: 's00000001', window_id: 34 },
    { element_index: 2, snapshot_id: 'foreign', window_id: 34 },
    { element_index: 2, snapshot_id: 's00000001' },
    { element_index: 2, snapshot_id: 's00000001', window_id: 34, element_token: 's00000001:2' },
    { element_token: 's00000001:2', x: 1, y: 2 },
  ])('rejects invalid/ambiguous addressing before dispatch: %j', async input => {
    const { raw, connection } = fixture();
    await expect(connection.callToolResult('click', input)).rejects.toThrow();
    expect(raw.callToolResult).not.toHaveBeenCalled();
  });
  it('uses the real public wrapper and preserves middle-click and capture aliases', async () => {
    const { raw, connection } = fixture();
    const manager = new CuaConnectionManager(async () => connection, { initialConnection: connection });
    const tool = createComputerUseTool({ callToolResult: (name, input, options) => manager.callToolResult(name, input, options) });
    expect(JSON.parse(await tool.execute({ action: 'middle_click', pid: 12, window_id: '34', element_index: '2', snapshot_id: 's00000001' }) as string).ok).toBe(true);
    expect(raw.callToolResult).toHaveBeenLastCalledWith('click', { pid: 12, window_id: 34, element_token: 's00000001:2', button: 'middle' }, undefined);
    await tool.execute({ action: 'screenshot', pid: 12, window_id: '34', include_screenshot: false });
    expect(raw.callToolResult).toHaveBeenLastCalledWith('get_window_state', { pid: 12, window_id: 34, include_screenshot: true }, undefined);
    await manager.dispose();
    expect(raw.dispose).toHaveBeenCalledOnce();
  });
  it('admits only the internal session revival operation beyond wrapper actions', async () => {
    const { raw, connection } = fixture();
    await connection.callToolResult('start_session', { session: 'owned' });
    expect(raw.callToolResult).toHaveBeenLastCalledWith('start_session', { session: 'owned' }, undefined);
    await expect(connection.callToolResult('start_session', { grant: 'existing-profile' })).rejects.toThrow();
    await expect(connection.callToolResult('execute_javascript', {})).rejects.toThrow();
  });
});
