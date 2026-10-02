import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeMcpRuntimeToolResult } from '../../../src/ai/mcp/runtime/client.js';
import { WindowsCuaObservationStore } from '../../../src/platform/computer-use/windows-cua-observation.js';

const raw = JSON.parse(readFileSync(join(process.cwd(), 'tests/fixtures/cua-windows-0.31.0/capture.json'), 'utf8'));
const target = { pid: raw.structuredContent.pid, window_id: raw.structuredContent.window_id };
describe('Windows observed targets and generation-bound tokens', () => {
  it('projects real tokens into host-owned identities and resolves indices against that exact observation', () => {
    const store = new WindowsCuaObservationStore();
    const observed = store.record(target, normalizeMcpRuntimeToolResult(raw));
    const value = observed.structuredContent as any;
    expect(value.snapshot_id).toMatch(/^w[0-9a-f]{32}:s00000001$/);
    expect(value.elements[5].element_token).not.toBe('s00000001:5');
    expect(store.prepare('type', { ...target, element_index: 5, snapshot_id: value.snapshot_id, text: 'hello' })).toMatchObject({ ...target, element_token: 's00000001:5', text: 'hello' });
    expect(store.prepare('click', { ...target, element_token: value.elements[6].element_token }).element_token).toBe('s00000001:6');
    expect(store.prepare('click', { ...target, element_token: value.elements[6].element_token })).not.toHaveProperty('capture_id');
    expect(store.prepare('click', { ...target, x: 100, y: 100 }).capture_id).toBe(raw.structuredContent.capture_id);
  });
  it('rejects stale generations even when a restarted driver reuses raw snapshot IDs', () => {
    const store = new WindowsCuaObservationStore();
    const first = store.record(target, normalizeMcpRuntimeToolResult(raw)).structuredContent as any;
    store.reset(); store.record(target, normalizeMcpRuntimeToolResult(raw));
    expect(() => store.prepare('click', { ...target, element_token: first.elements[6].element_token })).toThrow('REOBSERVE_REQUIRED');
    expect(() => store.prepare('click', { ...target, element_index: 6, snapshot_id: first.snapshot_id })).toThrow('REOBSERVE_REQUIRED');
  });
  it('rejects wrong targets, malformed observations and coordinates outside the actual PNG', () => {
    const store = new WindowsCuaObservationStore();
    expect(() => store.record({ ...target, pid: target.pid + 1 }, normalizeMcpRuntimeToolResult(raw))).toThrow('TARGET_MISMATCH');
    store.record(target, normalizeMcpRuntimeToolResult(raw));
    expect(() => store.prepare('click', { ...target, x: 99999, y: 20 })).toThrow();
    expect(() => store.prepare('click', { ...target, pid: target.pid + 1, x: 20, y: 20 })).toThrow('REOBSERVE_REQUIRED');
    const changed = structuredClone(raw); changed.structuredContent.elements[5].element_token = 'sffffffff:5';
    expect(() => store.record(target, normalizeMcpRuntimeToolResult(changed))).toThrow();
  });
  it('rejects conflicting token/index and mixed pixel/element targeting', () => {
    const store = new WindowsCuaObservationStore();
    const observed = store.record(target, normalizeMcpRuntimeToolResult(raw)).structuredContent as any;
    expect(() => store.prepare('click', { ...target, element_index: 5, snapshot_id: observed.snapshot_id, element_token: observed.elements[6].element_token })).toThrow();
    expect(() => store.prepare('click', { ...target, element_token: observed.elements[6].element_token, x: 100, y: 100 })).toThrow();
  });
  it('consumes observations after mutations so old tokens cannot drive another action', () => {
    const store = new WindowsCuaObservationStore(); store.record(target, normalizeMcpRuntimeToolResult(raw));
    store.consume(target);
    expect(() => store.prepare('type', { ...target, text: 'hello' })).toThrow('REOBSERVE_REQUIRED');
  });
});
