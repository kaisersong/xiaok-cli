import { describe, expect, it } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileYZJInboundDedupeStore, YZJInboundDedupeStore } from '../../src/channels/yzj-dedupe-store.js';

describe('yzj inbound dedupe store', () => {
  it('dedupes repeated message ids in memory', () => {
    const store = new YZJInboundDedupeStore();

    expect(store.markSeen('msg_1')).toBe(true);
    expect(store.markSeen('msg_1')).toBe(false);
  });

  it('persists seen message ids across store instances', () => {
    const root = join(tmpdir(), `xiaok-yzj-dedupe-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    const filePath = join(root, 'dedupe.json');

    try {
      const first = new FileYZJInboundDedupeStore(filePath, 5 * 60_000);
      expect(first.markSeen('msg_1')).toBe(true);

      const second = new FileYZJInboundDedupeStore(filePath, 5 * 60_000);
      expect(second.markSeen('msg_1')).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
