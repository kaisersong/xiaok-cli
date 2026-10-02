import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { normalizeMcpRuntimeToolResult } from '../../../src/ai/mcp/runtime/client.js';
import { createComputerUseTool } from '../../../src/ai/tools/computer-use.js';
import { CuaConnectionManager } from '../../../src/platform/mcp/cua-connection-manager.js';
import { createWindowsCuaBackend, isWindowsCuaReplaySafeCall } from '../../../src/platform/computer-use/windows-cua-backend.js';
import { WINDOWS_CUA_ABI_PROFILE } from '../../../src/platform/computer-use/windows-cua-profile.js';

const raw = JSON.parse(readFileSync(join(process.cwd(), 'tests/fixtures/cua-windows-0.31.0/capture.json'), 'utf8'));
const target = { pid: raw.structuredContent.pid, window_id: raw.structuredContent.window_id };
describe('Windows wrapper through generation-bound production backend', () => {
  it('captures real PNG evidence, resolves the host token and consumes it after a mutation', async () => {
    const call = vi.fn(async (name: string, _input: Record<string, unknown>) => name === 'get_window_state' ? normalizeMcpRuntimeToolResult(raw) : normalizeMcpRuntimeToolResult({ content: [{ type: 'text', text: 'ok' }] }));
    const connection = { callToolResult: call, dispose: vi.fn() };
    const manager = new CuaConnectionManager(async () => connection, { initialConnection: connection });
    const tool = createComputerUseTool(createWindowsCuaBackend(manager), WINDOWS_CUA_ABI_PROFILE);
    const emit = vi.fn(); const context = { modelSupportsImageInput: true, emitToolImage: emit } as never;
    const capture = JSON.parse(await tool.execute({ action: 'capture', ...target }, context));
    expect(emit).toHaveBeenCalledOnce();
    const token = capture.result.structuredContent.elements[6].element_token;
    expect(JSON.parse(await tool.execute({ action: 'click', ...target, element_token: token }, context)).ok).toBe(true);
    expect(call.mock.calls[1][1]).toMatchObject({ ...target, element_token: 's00000001:6', delivery_mode: 'background' });
    expect(JSON.parse(await tool.execute({ action: 'click', ...target, element_token: token }, context))).toMatchObject({ code: 'COMPUTER_USE_REOBSERVE_REQUIRED', waitForUserAction: false });
    expect(call).toHaveBeenCalledTimes(2);
    await manager.dispose();
  });
  it.each(['background_unavailable', 'background_occluded'])('allows one explicit foreground retry only after native %s and a fresh observation', async (code) => {
    const call = vi.fn(async (name: string, args: Record<string, unknown>) => name === 'get_window_state' ? normalizeMcpRuntimeToolResult(raw)
      : args.delivery_mode === 'background' ? normalizeMcpRuntimeToolResult({ isError: true, content: [{ type: 'text', text: 'background route unavailable' }], structuredContent: { code, escalation: { recommended: 'foreground' } } })
      : normalizeMcpRuntimeToolResult({ content: [{ type: 'text', text: 'delivered' }] }));
    const connection = { callToolResult: call, dispose: vi.fn() };
    const manager = new CuaConnectionManager(async () => connection, { initialConnection: connection });
    const tool = createComputerUseTool(createWindowsCuaBackend(manager), WINDOWS_CUA_ABI_PROFILE);
    const context = { modelSupportsImageInput: true, emitToolImage: vi.fn() } as never;
    await tool.execute({ action: 'capture', ...target }, context);
    expect(await tool.execute({ action: 'key', ...target, key: 'home', delivery_mode: 'foreground' }, context)).toContain('foreground');
    expect(call).toHaveBeenCalledTimes(1);
    expect(JSON.parse(await tool.execute({ action: 'key', ...target, key: 'home' }, context))).toMatchObject({ code: 'COMPUTER_USE_BACKGROUND_UNAVAILABLE', waitForUserAction: false });
    expect(JSON.parse(await tool.execute({ action: 'key', ...target, key: 'home', delivery_mode: 'foreground' }, context))).toMatchObject({ code: 'COMPUTER_USE_REOBSERVE_REQUIRED' });
    await tool.execute({ action: 'capture', ...target }, context);
    expect(JSON.parse(await tool.execute({ action: 'key', ...target, key: 'home', delivery_mode: 'foreground' }, context)).ok).toBe(true);
    expect(call).toHaveBeenLastCalledWith('press_key', expect.objectContaining({ delivery_mode: 'foreground' }));
    await tool.execute({ action: 'capture', ...target }, context);
    expect(await tool.execute({ action: 'key', ...target, key: 'home', delivery_mode: 'foreground' }, context)).toContain('foreground');
    expect(call).toHaveBeenCalledTimes(5);
    await manager.dispose();
  });
  it.each([
    ['foreground-unavailable.json', 'COMPUTER_USE_FOREGROUND_UNAVAILABLE'],
    [null, 'COMPUTER_USE_WINDOWS_TARGET_PERMISSION_DENIED'],
  ])('reports target-local focus/permission failures without reconnecting or granting escalation (%s)', async (fixture, code) => {
    const failure = fixture ? JSON.parse(readFileSync(join(process.cwd(), 'tests/fixtures/cua-windows-0.31.0', fixture), 'utf8'))
      : { isError: true, content: [{ type: 'text', text: 'Windows UIPI blocked input' }], structuredContent: { code: 'background_uipi_blocked', escalation: { recommended: 'foreground' } } };
    const call = vi.fn(async (name: string) => normalizeMcpRuntimeToolResult(name === 'get_window_state' ? raw : failure));
    const connection = { callToolResult: call, dispose: vi.fn() }; const factory = vi.fn(async () => connection);
    const manager = new CuaConnectionManager(factory, { initialConnection: connection });
    const tool = createComputerUseTool(createWindowsCuaBackend(manager), WINDOWS_CUA_ABI_PROFILE);
    const context = { modelSupportsImageInput: true, emitToolImage: vi.fn() } as never;
    await tool.execute({ action: 'capture', ...target }, context);
    expect(JSON.parse(await tool.execute({ action: 'click', ...target, x: 20, y: 20 }, context))).toMatchObject({ code, waitForUserAction: true, retryable: false });
    expect(factory).not.toHaveBeenCalled();
    await tool.execute({ action: 'capture', ...target }, context);
    expect(await tool.execute({ action: 'click', ...target, x: 20, y: 20, delivery_mode: 'foreground' }, context)).toContain('foreground');
    expect(call).toHaveBeenCalledTimes(3); await manager.dispose();
  });

  it('invalidates the previous target when a newer capture throws', async () => {
    const call = vi.fn().mockResolvedValueOnce(normalizeMcpRuntimeToolResult(raw)).mockRejectedValueOnce(new Error('capture failed'));
    const connection = { callToolResult: call, dispose: vi.fn() };
    const manager = new CuaConnectionManager(async () => connection, { initialConnection: connection });
    const backend = createWindowsCuaBackend(manager);
    await backend.callToolResult('get_window_state', target);
    await expect(backend.callToolResult('get_window_state', target)).rejects.toThrow('capture failed');
    expect(() => backend.prepareActionInput!('type', { ...target, text: 'unsafe stale target' })).toThrow('REOBSERVE_REQUIRED');
    await manager.dispose();
  });
  it('never sends a prepared mutation after a concurrent capture changed the native coordinate frame', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let captures = 0;
    const call = vi.fn(async (name: string) => {
      if (name === 'get_window_state') { if (++captures === 2) await gate; return normalizeMcpRuntimeToolResult(raw); }
      return normalizeMcpRuntimeToolResult({ content: [{ type: 'text', text: 'ok' }] });
    });
    const connection = { callToolResult: call, dispose: vi.fn() };
    const manager = new CuaConnectionManager(async () => connection, { initialConnection: connection });
    const backend = createWindowsCuaBackend(manager);
    await backend.callToolResult('get_window_state', target);
    const mutation = backend.acquireInvocation!()!.backend;
    const prepared = mutation.prepareActionInput!('click', { ...target, x: 20, y: 20 });
    const capturing = backend.callToolResult('get_window_state', target);
    await vi.waitFor(() => expect(captures).toBe(2));
    const queued = mutation.callToolResult('click', prepared);
    const rejected = expect(queued).rejects.toThrow('REOBSERVE_REQUIRED');
    release(); await capturing; await rejected;
    expect(call.mock.calls.every(([name]) => name === 'get_window_state')).toBe(true);
    await manager.dispose();
  });

  it('rejects unknown observation parameters in the profile-specific replay guard', () => {
    expect(isWindowsCuaReplaySafeCall('get_window_state', { ...target, max_image_dimension: 1200, include_accessibility_tree: true })).toBe(true);
    expect(isWindowsCuaReplaySafeCall('get_window_state', { ...target, screenshot_out_file: 'x' })).toBe(false);
    expect(isWindowsCuaReplaySafeCall('get_window_state', { ...target, unknown_future_field: true })).toBe(false);
    expect(isWindowsCuaReplaySafeCall('click', target)).toBe(false);
  });
});
