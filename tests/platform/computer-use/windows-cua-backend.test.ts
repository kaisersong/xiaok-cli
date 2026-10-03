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

  it('refuses background mouse selection in an observed Edit before input, then allows one explicit foreground drag after reobserving', async () => {
    const call = vi.fn(async (name: string) => normalizeMcpRuntimeToolResult(name === 'get_window_state' ? raw : { content: [{ type: 'text', text: 'delivered' }] }));
    const connection = { callToolResult: call, dispose: vi.fn() }; const factory = vi.fn(async () => connection);
    const manager = new CuaConnectionManager(factory, { initialConnection: connection });
    const tool = createComputerUseTool(createWindowsCuaBackend(manager), WINDOWS_CUA_ABI_PROFILE);
    const context = { modelSupportsImageInput: true, emitToolImage: vi.fn() } as never;
    const input = { action: 'drag', ...target, x: 10, y: 65, to_x: 175, to_y: 65 };
    await tool.execute({ action: 'capture', ...target }, context);
    expect(await tool.execute({ ...input, delivery_mode: 'foreground' }, context)).toContain('foreground');
    expect(JSON.parse(await tool.execute(input, context))).toMatchObject({ code: 'COMPUTER_USE_BACKGROUND_UNAVAILABLE', waitForUserAction: false, retryable: true });
    expect(call).toHaveBeenCalledTimes(1); // The host refusal sends no native input.
    expect(JSON.parse(await tool.execute({ ...input, delivery_mode: 'foreground' }, context))).toMatchObject({ code: 'COMPUTER_USE_REOBSERVE_REQUIRED' });
    await tool.execute({ action: 'capture', ...target }, context);
    expect(JSON.parse(await tool.execute({ ...input, delivery_mode: 'foreground' }, context)).ok).toBe(true);
    expect(call).toHaveBeenLastCalledWith('drag', expect.objectContaining({ from_x: 10, from_y: 65, delivery_mode: 'foreground' }));
    await tool.execute({ action: 'capture', ...target }, context);
    expect(await tool.execute({ ...input, delivery_mode: 'foreground' }, context)).toContain('foreground');
    expect(call).toHaveBeenCalledTimes(4); expect(factory).not.toHaveBeenCalled(); await manager.dispose();
  });
  it('does not let a mutated returned frame change the host text-drag admission region', async () => {
    const fixture = JSON.parse(JSON.stringify(raw));
    const call = vi.fn(async (name: string) => normalizeMcpRuntimeToolResult(name === 'get_window_state' ? fixture : { content: [{ type: 'text', text: 'delivered' }] }));
    const connection = { callToolResult: call, dispose: vi.fn() };
    const manager = new CuaConnectionManager(async () => connection, { initialConnection: connection });
    const backend = createWindowsCuaBackend(manager);
    const observed = await backend.callToolResult('get_window_state', target);
    (observed.structuredContent as typeof raw.structuredContent).elements[5].screenshot_frame.y = 200;
    const tool = createComputerUseTool(backend, WINDOWS_CUA_ABI_PROFILE);
    expect(JSON.parse(await tool.execute({ action: 'drag', ...target, x: 10, y: 65, to_x: 175, to_y: 65 },
      { modelSupportsImageInput: true, emitToolImage: vi.fn() } as never))).toMatchObject({ code: 'COMPUTER_USE_BACKGROUND_UNAVAILABLE' });
    expect(call).toHaveBeenCalledTimes(1); await manager.dispose();
  });
  it('keeps background drag outside an Edit and never grants foreground merely because native drag succeeded', async () => {
    const call = vi.fn(async (name: string) => normalizeMcpRuntimeToolResult(name === 'get_window_state' ? raw : { content: [{ type: 'text', text: 'delivered' }] }));
    const connection = { callToolResult: call, dispose: vi.fn() };
    const manager = new CuaConnectionManager(async () => connection, { initialConnection: connection });
    const tool = createComputerUseTool(createWindowsCuaBackend(manager), WINDOWS_CUA_ABI_PROFILE);
    const context = { modelSupportsImageInput: true, emitToolImage: vi.fn() } as never;
    const input = { action: 'drag', ...target, x: 10, y: 100, to_x: 175, to_y: 100 };
    await tool.execute({ action: 'capture', ...target }, context);
    expect(JSON.parse(await tool.execute(input, context)).ok).toBe(true);
    expect(call).toHaveBeenLastCalledWith('drag', expect.objectContaining({ delivery_mode: 'background' }));
    await tool.execute({ action: 'capture', ...target }, context);
    expect(await tool.execute({ ...input, delivery_mode: 'foreground' }, context)).toContain('foreground');
    expect(call).toHaveBeenCalledTimes(3); await manager.dispose();
  });

  it.each([
    ['middle_click', false, undefined], ['middle_click', true, 'right'],
    ['click', false, 'middle'], ['click', true, 'middle'],
  ])('refuses background middle before native input for %s, element=%s, button=%s', async (action, element, button) => {
    const call = vi.fn(async (name: string) => normalizeMcpRuntimeToolResult(name === 'get_window_state' ? raw : { content: [{ type: 'text', text: 'delivered' }] }));
    const connection = { callToolResult: call, dispose: vi.fn() }; const factory = vi.fn(async () => connection);
    const manager = new CuaConnectionManager(factory, { initialConnection: connection });
    const tool = createComputerUseTool(createWindowsCuaBackend(manager), WINDOWS_CUA_ABI_PROFILE);
    const context = { modelSupportsImageInput: true, emitToolImage: vi.fn() } as never;
    const capture = async () => JSON.parse(await tool.execute({ action: 'capture', ...target }, context));
    const observed = await capture();
    const input = { action, ...target, ...(button ? { button } : {}),
      ...(element ? { element_token: observed.result.structuredContent.elements[6].element_token } : { x: 20, y: 20 }) };
    expect(JSON.parse(await tool.execute(input, context))).toMatchObject({ code: 'COMPUTER_USE_BACKGROUND_UNAVAILABLE', retryable: true });
    expect(call).toHaveBeenCalledTimes(1);
    expect(JSON.parse(await tool.execute({ ...input, delivery_mode: 'foreground' }, context))).toMatchObject({ code: 'COMPUTER_USE_REOBSERVE_REQUIRED' });
    await capture();
    for (const button of ['left', 'right']) {
      expect(await tool.execute({ action: 'click', ...target, button, x: 20, y: 20, delivery_mode: 'foreground' }, context)).toContain('foreground');
    }
    expect(JSON.parse(await tool.execute({ ...input, delivery_mode: 'foreground' }, context)).ok).toBe(true);
    expect(call).toHaveBeenLastCalledWith('click', expect.objectContaining({ button: 'middle', delivery_mode: 'foreground' }));
    await capture();
    expect(await tool.execute({ ...input, delivery_mode: 'foreground' }, context)).toContain('foreground');
    expect(call).toHaveBeenCalledTimes(4); expect(factory).not.toHaveBeenCalled(); await manager.dispose();
  });
  it.each(['left', 'right'])('keeps background %s click on an observed web native route', async button => {
    const fixture = JSON.parse(JSON.stringify(raw)); fixture.structuredContent.elements[6].in_web_content = true;
    const frame = fixture.structuredContent.elements[6].screenshot_frame;
    const call = vi.fn(async (name: string) => normalizeMcpRuntimeToolResult(name === 'get_window_state' ? fixture : { content: [{ type: 'text', text: 'delivered' }] }));
    const connection = { callToolResult: call, dispose: vi.fn() };
    const manager = new CuaConnectionManager(async () => connection, { initialConnection: connection });
    const tool = createComputerUseTool(createWindowsCuaBackend(manager), WINDOWS_CUA_ABI_PROFILE);
    const context = { modelSupportsImageInput: true, emitToolImage: vi.fn() } as never;
    await tool.execute({ action: 'capture', ...target }, context);
    expect(JSON.parse(await tool.execute({ action: 'click', ...target, button, x: frame.x + 1, y: frame.y + 1 }, context)).ok).toBe(true);
    expect(call).toHaveBeenLastCalledWith('click', expect.objectContaining({ button, delivery_mode: 'background' }));
    await manager.dispose();
  });

  it.each([
    ['double_click', undefined, undefined, false], ['right_click', undefined, undefined, true],
    ['click', 'left', 2, false], ['click', 'right', 1, true],
  ])('refuses non-web background gesture %s/button=%s/count=%s/element=%s before input', async (action, button, count, element) => {
    const call = vi.fn(async (name: string) => normalizeMcpRuntimeToolResult(name === 'get_window_state' ? raw : { content: [{ type: 'text', text: 'delivered' }] }));
    const connection = { callToolResult: call, dispose: vi.fn() };
    const manager = new CuaConnectionManager(async () => connection, { initialConnection: connection });
    const tool = createComputerUseTool(createWindowsCuaBackend(manager), WINDOWS_CUA_ABI_PROFILE);
    const context = { modelSupportsImageInput: true, emitToolImage: vi.fn() } as never;
    const capture = async () => JSON.parse(await tool.execute({ action: 'capture', ...target }, context));
    const observed = await capture();
    const input = { action, ...target, ...(button ? { button, count } : {}),
      ...(element ? { element_token: observed.result.structuredContent.elements[6].element_token } : { x: 20, y: 20 }) };
    expect(JSON.parse(await tool.execute(input, context))).toMatchObject({ code: 'COMPUTER_USE_BACKGROUND_UNAVAILABLE' });
    expect(call).toHaveBeenCalledTimes(1);
    await capture();
    if (action === 'click' && count === 2) {
      expect(await tool.execute({ ...input, count: 1, delivery_mode: 'foreground' }, context)).toContain('foreground');
    }
    expect(JSON.parse(await tool.execute({ ...input, delivery_mode: 'foreground' }, context)).ok).toBe(true);
    expect(call).toHaveBeenLastCalledWith(action, expect.objectContaining({ delivery_mode: 'foreground' }));
    await manager.dispose();
  });
  it('retains web gestures only for the observed web token or its own pixel region', async () => {
    const fixture = JSON.parse(JSON.stringify(raw)); fixture.structuredContent.elements[6].in_web_content = true;
    const call = vi.fn(async (name: string) => normalizeMcpRuntimeToolResult(name === 'get_window_state' ? fixture : { content: [{ type: 'text', text: 'delivered' }] }));
    const connection = { callToolResult: call, dispose: vi.fn() };
    const manager = new CuaConnectionManager(async () => connection, { initialConnection: connection });
    const backend = createWindowsCuaBackend(manager);
    const tool = createComputerUseTool(backend, WINDOWS_CUA_ABI_PROFILE);
    const context = { modelSupportsImageInput: true, emitToolImage: vi.fn() } as never;
    const capture = async () => JSON.parse(await tool.execute({ action: 'capture', ...target }, context));
    let observed = await capture();
    expect(JSON.parse(await tool.execute({ action: 'double_click', ...target, element_token: observed.result.structuredContent.elements[6].element_token }, context)).ok).toBe(true);
    observed = await capture();
    const frame = observed.result.structuredContent.elements[6].screenshot_frame;
    expect(JSON.parse(await tool.execute({ action: 'right_click', ...target, x: frame.x + 1, y: frame.y + 1 }, context)).ok).toBe(true);
    const result = await backend.callToolResult('get_window_state', target);
    (result.structuredContent as typeof raw.structuredContent).elements[5].in_web_content = true;
    expect(JSON.parse(await tool.execute({ action: 'click', button: 'right', ...target, x: 10, y: 65 }, context))).toMatchObject({ code: 'COMPUTER_USE_BACKGROUND_UNAVAILABLE' });
    expect(call).toHaveBeenCalledTimes(5); await manager.dispose();
  });

  it('opens one authorized HTTP URL without a shell and invalidates old observations', async () => {
    const call = vi.fn(async (name: string) => normalizeMcpRuntimeToolResult(name === 'get_window_state' ? raw : { content: [{ type: 'text', text: 'launched' }] }));
    const connection = { callToolResult: call, dispose: vi.fn() };
    const manager = new CuaConnectionManager(async () => connection, { initialConnection: connection });
    const tool = createComputerUseTool(createWindowsCuaBackend(manager), WINDOWS_CUA_ABI_PROFILE);
    const context = { modelSupportsImageInput: true, emitToolImage: vi.fn() } as never;
    const observed = JSON.parse(await tool.execute({ action: 'capture', ...target }, context));
    expect(JSON.parse(await tool.execute({ action: 'open_url', url: 'https://github.com/kaisersong/xiaok-cli?a=1&b=2' }, context)).ok).toBe(true);
    expect(call).toHaveBeenLastCalledWith('launch_app', { urls: ['https://github.com/kaisersong/xiaok-cli?a=1&b=2'] });
    expect(JSON.parse(await tool.execute({ action: 'click', ...target, element_token: observed.result.structuredContent.elements[6].element_token }, context))).toMatchObject({ code: 'COMPUTER_USE_REOBSERVE_REQUIRED' });
    await manager.dispose();
  });
  it.each(['file:///C:/test.exe', 'javascript:alert(1)', 'data:text/html,test', 'ms-settings:privacy', 'https://user:pass@example.com/', 'https://example.com/\n', 'not a URL'])('rejects unsafe URL %s before native launch', async url => {
    const call = vi.fn(); const connection = { callToolResult: call, dispose: vi.fn() };
    const manager = new CuaConnectionManager(async () => connection, { initialConnection: connection });
    const tool = createComputerUseTool(createWindowsCuaBackend(manager), WINDOWS_CUA_ABI_PROFILE);
    expect(await tool.execute({ action: 'open_url', url }, { modelSupportsImageInput: true, emitToolImage: vi.fn() } as never)).toContain('Error:');
    expect(call).not.toHaveBeenCalled(); await manager.dispose();
  });
  it('rejects launch escape fields at both public and native host entrances', async () => {
    const call = vi.fn(); const connection = { callToolResult: call, dispose: vi.fn() };
    const manager = new CuaConnectionManager(async () => connection, { initialConnection: connection });
    const backend = createWindowsCuaBackend(manager);
    const tool = createComputerUseTool(backend, WINDOWS_CUA_ABI_PROFILE);
    for (const extras of [{ path: 'cmd.exe' }, { additional_arguments: ['/c', 'calc'] }, { capture_after: true }]) {
      expect(await tool.execute({ action: 'open_url', url: 'https://example.com/', ...extras }, { modelSupportsImageInput: true, emitToolImage: vi.fn() } as never)).toContain('Error:');
    }
    await expect(backend.callToolResult('launch_app', { urls: ['https://example.com/'], path: 'cmd.exe' })).rejects.toThrow('invalid_computer_use_input');
    await expect(backend.callToolResult('launch_app', { urls: ['file:///C:/test.exe'] })).rejects.toThrow('invalid_computer_use_input');
    expect(call).not.toHaveBeenCalled(); await manager.dispose();
  });
  it('serializes URL launch behind active window calls and rejects prepared mutations after launch', async () => {
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let captures = 0;
    const call = vi.fn(async (name: string) => {
      if (name === 'get_window_state') { if (++captures === 2) await gate; return normalizeMcpRuntimeToolResult(raw); }
      return normalizeMcpRuntimeToolResult({ content: [{ type: 'text', text: 'launched' }] });
    });
    const connection = { callToolResult: call, dispose: vi.fn() };
    const manager = new CuaConnectionManager(async () => connection, { initialConnection: connection });
    const backend = createWindowsCuaBackend(manager);
    await backend.callToolResult('get_window_state', target);
    const lease = backend.acquireInvocation!()!.backend;
    const prepared = lease.prepareActionInput!('click', { ...target, x: 20, y: 20 });
    const capture = backend.callToolResult('get_window_state', target); await vi.waitFor(() => expect(captures).toBe(2));
    const launch = backend.callToolResult('launch_app', { urls: ['https://example.com/'] });
    const mutation = lease.callToolResult('click', prepared); const rejected = expect(mutation).rejects.toThrow('REOBSERVE_REQUIRED');
    expect(call.mock.calls.map(([name]) => name)).toEqual(['get_window_state', 'get_window_state']);
    release(); await capture; await launch; await rejected;
    expect(call.mock.calls.map(([name]) => name)).toEqual(['get_window_state', 'get_window_state', 'launch_app']);
    expect(isWindowsCuaReplaySafeCall('launch_app', { urls: ['https://example.com/'] })).toBe(false);
    await manager.dispose();
  });

  it('never replays a URL launch when the owned transport was interrupted', async () => {
    const initial = { callToolResult: vi.fn().mockRejectedValue(new Error('Transport closed')), dispose: vi.fn() };
    const replacement = { callToolResult: vi.fn(), dispose: vi.fn() };
    const factory = vi.fn(async () => replacement);
    const manager = new CuaConnectionManager(factory, { initialConnection: initial, isReplaySafeCall: isWindowsCuaReplaySafeCall });
    const tool = createComputerUseTool(createWindowsCuaBackend(manager), WINDOWS_CUA_ABI_PROFILE);
    expect(JSON.parse(await tool.execute({ action: 'open_url', url: 'https://example.com/' },
      { modelSupportsImageInput: true, emitToolImage: vi.fn() } as never))).toMatchObject({ code: 'COMPUTER_USE_RECONNECTED_REOBSERVE_REQUIRED' });
    expect(initial.callToolResult).toHaveBeenCalledTimes(1); expect(factory).toHaveBeenCalledOnce();
    expect(replacement.callToolResult).not.toHaveBeenCalled(); await manager.dispose();
  });
  it('never dispatches an aborted queued URL launch', async () => {
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const call = vi.fn(async (name: string) => { await gate; return normalizeMcpRuntimeToolResult(raw); });
    const connection = { callToolResult: call, dispose: vi.fn() };
    const manager = new CuaConnectionManager(async () => connection, { initialConnection: connection });
    const backend = createWindowsCuaBackend(manager);
    const capture = backend.callToolResult('get_window_state', target); await vi.waitFor(() => expect(call).toHaveBeenCalledOnce());
    const controller = new AbortController();
    const launch = backend.callToolResult('launch_app', { urls: ['https://example.com/'] }, { signal: controller.signal });
    const rejection = expect(launch).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort(); release(); await capture; await rejection;
    expect(call.mock.calls.map(([name]) => name)).toEqual(['get_window_state']); await manager.dispose();
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
