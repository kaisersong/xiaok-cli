import {expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import type {RootUsageOwner} from './root-usage-ownership.js';
import type {DesktopAgentExecutionContext} from '../../electron/desktop-multi-agent-service.js';
export function expectExactSourceOperationFrame(stack: unknown, source: URL, operation: string): void {
  expect(typeof stack).toBe('string');
  const text = readFileSync(source, 'utf8'), first = text.indexOf(operation);
  expect(first).toBeGreaterThanOrEqual(0);
  expect(text.indexOf(operation, first + operation.length)).toBe(-1);
  const line = text.slice(0, first).split('\n').length;
  const path = fileURLToPath(source).replaceAll('\\', '/');
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  expect((stack as string).replaceAll('\\', '/')).toMatch(new RegExp(`${escaped}:${line}:\\d+\\)?(?=\\r?\\n|$)`));
}

export function assertFinalRootUsageJournal(final:NonNullable<Awaited<ReturnType<import('../../../src/runtime/task-host/snapshot-store.js').FileTaskSnapshotStore['recoverTask']>>>){expect(final.events.filter(entry => entry.type === 'usage_recorded')).toHaveLength(1);expect(final.events.some(entry => JSON.stringify(entry).includes('LATE_TEXT_MUST_NOT_APPEAR'))).toBe(false);}

export function assertDurableRootUsage(owner:RootUsageOwner,context:DesktopAgentExecutionContext){
  const usage = owner.store!.readEvents(context.groupId, 0, 1000).filter(entry => entry.kind === 'usage'); expect(usage).toHaveLength(1);
  expect(owner.store!.getAgent(context.groupId, context.agentId)?.usage).toEqual({ inputTokens: 17, outputTokens: 19 });
  const operationId = 'usage:' + createHash('sha256').update(`${context.agentId}:${context.turnId}:${String(usage[0].payload.usageId)}`).digest('hex');
  expect(owner.store!.getOperation(context.groupId, operationId)).toMatchObject({ command: 'usage', applyState: 'applied' });
  expect((owner.store as any).db.prepare("SELECT COUNT(*) AS count FROM operations WHERE group_id=? AND json_extract(data_json,'$.command')='usage'").get(context.groupId)).toEqual({ count: 1 });
}

export function assertOriginalRootAbort(error:unknown,context:DesktopAgentExecutionContext,hostSignal:AbortSignal):DOMException {
  expect(error).toBeInstanceOf(DOMException);
  const originalAbort = error as DOMException;
  expect(originalAbort.name).toBe('AbortError'); expect(originalAbort.message).toBe('user_cancelled'); expect(originalAbort.code).toBe(20);
  expectExactSourceOperationFrame(originalAbort.stack, new URL('../../electron/desktop-services.ts', import.meta.url), "const interrupted = new DOMException(reason instanceof Error ? reason.message : 'multi-agent turn aborted', 'AbortError');");
  expect(Object.hasOwn(originalAbort, 'cause')).toBe(true); expect(Object.getOwnPropertyDescriptor(originalAbort,'cause')?.value).toBe(context.signal.reason); expect(Object.hasOwn(originalAbort, 'errors')).toBe(false);
  expect(context.signal.aborted).toBe(true); expect(hostSignal.aborted).toBe(true);
  expect(originalAbort).not.toBe(context.signal.reason); expect(originalAbort).not.toBe(hostSignal.reason);
  return originalAbort;
}
