import { describe, expect, it } from 'vitest';
import {
  buildBoundedAssistantSnapshot,
  type AssistantActivityRecord,
} from '../../electron/assistant-snapshot-collector.js';

function record(overrides: Partial<AssistantActivityRecord> & Pick<AssistantActivityRecord, 'id'>): AssistantActivityRecord {
  return {
    id: overrides.id,
    scope: overrides.scope ?? 'tasks',
    updatedAt: overrides.updatedAt ?? 1_000,
    summary: overrides.summary ?? `summary-${overrides.id}`,
    reference: overrides.reference ?? { kind: 'task', id: overrides.id },
    priority: overrides.priority ?? 0,
  };
}

describe('assistant snapshot collector', () => {
  it('deduplicates by scope and id and sorts deterministically', () => {
    const snapshot = buildBoundedAssistantSnapshot({
      from: 0,
      to: 5_000,
      timeZone: 'Asia/Shanghai',
      records: [
        record({ id: 'b', updatedAt: 2_000, priority: 1 }),
        record({ id: 'a', updatedAt: 3_000, priority: 1 }),
        record({ id: 'b', updatedAt: 4_000, priority: 2, summary: 'latest-b' }),
      ],
    });

    expect(snapshot.items).toEqual([
      expect.objectContaining({ id: 'b', summary: 'latest-b', updatedAt: 4_000 }),
      expect.objectContaining({ id: 'a', updatedAt: 3_000 }),
    ]);
    expect(snapshot.dropped).toEqual({ duplicate: 1, perScopeLimit: 0, totalBytes: 0, outsideWindow: 0 });
  });

  it('applies the per-scope limit after deterministic priority ordering', () => {
    const records = Array.from({ length: 105 }, (_, index) => record({
      id: `task-${String(index).padStart(3, '0')}`,
      updatedAt: 10_000 - index,
      priority: index === 104 ? 100 : 0,
    }));

    const snapshot = buildBoundedAssistantSnapshot({
      from: 0,
      to: 20_000,
      timeZone: 'UTC',
      records,
    });

    expect(snapshot.items).toHaveLength(100);
    expect(snapshot.items[0].id).toBe('task-104');
    expect(snapshot.dropped.perScopeLimit).toBe(5);
  });

  it('never exceeds the serialized byte budget and reports dropped records', () => {
    const snapshot = buildBoundedAssistantSnapshot({
      from: 0,
      to: 10_000,
      timeZone: 'UTC',
      records: Array.from({ length: 10 }, (_, index) => record({
        id: `large-${index}`,
        updatedAt: 9_000 - index,
        summary: 'x'.repeat(1_000),
      })),
      limits: { maxItemsPerScope: 100, maxSerializedBytes: 2_500, maxSummaryChars: 2_000 },
    });

    expect(Buffer.byteLength(JSON.stringify(snapshot), 'utf8')).toBeLessThanOrEqual(2_500);
    expect(snapshot.dropped.totalBytes).toBeGreaterThan(0);
  });

  it('excludes records outside the frozen activity window', () => {
    const snapshot = buildBoundedAssistantSnapshot({
      from: 1_000,
      to: 2_000,
      timeZone: 'UTC',
      records: [
        record({ id: 'old', updatedAt: 999 }),
        record({ id: 'inside', updatedAt: 1_500 }),
        record({ id: 'future', updatedAt: 2_001 }),
      ],
    });

    expect(snapshot.items.map(item => item.id)).toEqual(['inside']);
    expect(snapshot.dropped.outsideWindow).toBe(2);
  });
});
