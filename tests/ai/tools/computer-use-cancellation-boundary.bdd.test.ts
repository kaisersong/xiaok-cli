import { describe, expect, it, vi } from 'vitest';
import { createComputerUseTool } from '../../../src/ai/tools/computer-use.js';
import { ToolRegistry } from '../../../src/ai/tools/index.js';
import type { McpInvocationOptions, McpRuntimeToolResult } from '../../../src/ai/mcp/runtime/client.js';
import { mcpTestContext } from '../../support/mcp-cancellation-context.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
const success: McpRuntimeToolResult = { text: 'observed', summary: 'observed', images: [], isError: false };
const recoverable: McpRuntimeToolResult = { text: 'cua-driver daemon not reachable on cua-driver.sock',
  summary: 'cua-driver daemon not reachable on cua-driver.sock', images: [], isError: true };
const windows: McpRuntimeToolResult = { ...success,
  structuredContent: { windows: [{ app_name: 'Fixture', pid: 42, window_id: 7, is_on_screen: true }] } };

describe('MCP R1 CUA actual outer continuation cancellation boundary', () => {
  it.each((['action', 'capture-after'] as const).flatMap(stage =>
    (['success', 'recoverable'] as const).flatMap(ending =>
      (['direct', 'registry'] as const).map(route => ({ stage, ending, route })))))(
    '$route $stage $ending: helper resolved before cancel cannot notify recovery or consume the first retry', async ({ stage, ending, route }) => {
      const entered = deferred<void>(); const held = deferred<McpRuntimeToolResult>();
      const controller = new AbortController(); const reason = new Error('outer continuation caller cancellation');
      const target = stage === 'action' ? 0 : 1; const result = ending === 'success' ? success : recoverable;
      const onRecoverableError = vi.fn(); let calls = 0;
      // Return the original backend Promise directly. An async mock would add
      // another Promise adoption turn and move cancellation inside the helper.
      const callToolResult = vi.fn((_name: string, _input: Record<string, unknown>, _options?: McpInvocationOptions) => {
        if (calls++ === target) { entered.resolve(); return held.promise; }
        return Promise.resolve(calls <= target ? success : recoverable);
      });
      const tool = createComputerUseTool({ callToolResult, onRecoverableError });
      const registry = route === 'registry' ? new ToolRegistry({ autoMode: true }, [tool]) : undefined;
      const input = stage === 'action' ? { action: 'list_windows' }
        : { action: 'click', pid: 42, window_id: '7', x: 1, y: 2, capture_after: true };
      const pending = registry ? registry.executeTool(tool.definition.name, input, mcpTestContext(controller.signal))
        : tool.execute(input, mcpTestContext(controller.signal));
      const outcome = pending.then(value => ({ value }), error => ({ error }));
      try {
        await Promise.race([entered.promise, outcome.then(result => {
          throw new Error(`CUA backend boundary not reached: ${JSON.stringify(result)}`);
        })]);
        held.resolve(result);
        // helper resumes first, checks the still-live signal and resolves;
        // this cancel runs before execute's outer await continuation.
        queueMicrotask(() => controller.abort(reason));
        expect.soft(await outcome).toEqual({ error: reason });
        expect.soft(onRecoverableError).not.toHaveBeenCalled();
        expect(callToolResult).toHaveBeenCalledTimes(target + 1);
        for (const call of callToolResult.mock.calls) {
          expect(call[2]?.signal?.aborted).toBe(true);
          expect(call[2]?.signal?.reason).toBe(reason);
        }

        // Probe the real tool's private Set through its public next-turn result;
        // do not read or substitute a test-owned recovery-state implementation.
        const fresh = JSON.parse(await tool.execute({ action: 'list_windows' }, mcpTestContext(new AbortController().signal)));
        expect.soft(fresh).toMatchObject({ code: 'COMPUTER_USE_MCP_CONNECT_TIMEOUT', retryable: true,
          userAction: { type: 'reconnect_computer_use' } });
        expect.soft(fresh).not.toHaveProperty('repeated');
        expect.soft(onRecoverableError).toHaveBeenCalledOnce();
      } finally { held.resolve(result); await outcome; registry?.dispose(); }
    });

  it.each((['capture', 'screenshot', 'capture-after'] as const).flatMap(stage =>
    (['success', 'recoverable'] as const).map(ending => ({ stage, ending }))))(
    '$stage lookup $ending retains the existing checked build-input boundary and starts no next observation', async ({ stage, ending }) => {
      const entered = deferred<void>(); const held = deferred<McpRuntimeToolResult>();
      const controller = new AbortController(); const reason = new Error('lookup continuation caller cancellation');
      const onRecoverableError = vi.fn();
      const callToolResult = vi.fn((name: string, _input: Record<string, unknown>, _options?: McpInvocationOptions) => {
        if (name === 'list_windows') { entered.resolve(); return held.promise; }
        return Promise.resolve(success);
      });
      const tool = createComputerUseTool({ callToolResult, onRecoverableError });
      const input = stage === 'capture-after' ? { action: 'click', app: 'Fixture', x: 1, y: 2, capture_after: true }
        : { action: stage, app: 'Fixture' };
      const outcome = tool.execute(input, mcpTestContext(controller.signal)).then(value => ({ value }), error => ({ error }));
      await entered.promise; held.resolve(ending === 'success' ? windows : recoverable);
      queueMicrotask(() => controller.abort(reason));
      expect(await outcome).toEqual({ error: reason }); expect(onRecoverableError).not.toHaveBeenCalled();
      expect(callToolResult.mock.calls.map(call => call[0])).toEqual(stage === 'capture-after' ? ['click', 'list_windows'] : ['list_windows']);
    });

  it.each((['action', 'capture-after'] as const).flatMap(stage =>
    (['success', 'recoverable'] as const).map(ending => ({ stage, ending }))))(
    'without a signal $stage $ending keeps ordinary success, recovery notification and repeated-error suppression', async ({ stage, ending }) => {
      const onRecoverableError = vi.fn();
      const callToolResult = vi.fn((name: string) => Promise.resolve(
        stage === 'capture-after' && name === 'click' ? success : ending === 'success' ? success : recoverable));
      const tool = createComputerUseTool({ callToolResult, onRecoverableError });
      const input = stage === 'action' ? { action: 'list_windows' }
        : { action: 'click', pid: 42, window_id: '7', x: 1, y: 2, capture_after: true };
      const first = JSON.parse(await tool.execute(input)); const second = JSON.parse(await tool.execute(input));
      if (ending === 'success') {
        expect(first).toMatchObject({ ok: true }); expect(second).toMatchObject({ ok: true });
        if (stage === 'capture-after') expect(first.captureAfter).toMatchObject({ text: 'observed' });
        expect(onRecoverableError).not.toHaveBeenCalled();
      } else {
        expect(first).toMatchObject({ ok: false, retryable: true, userAction: { type: 'reconnect_computer_use' } });
        expect(first).not.toHaveProperty('repeated');
        expect(second).toMatchObject({ ok: false, retryable: false, repeated: true });
        expect(second).not.toHaveProperty('userAction'); expect(onRecoverableError).toHaveBeenCalledTimes(2);
      }
    });
});
