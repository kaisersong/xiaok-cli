import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createKbStoreSqlite } from '../../electron/kb-store-sqlite.js';
import type { KbStore } from '../../electron/kb-store.js';
import { createMeetingService } from '../../electron/meeting-service.js';

describe('MeetingService permissions', () => {
  let rootDir: string;
  let store: KbStore;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-meeting-permissions-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
    store = createKbStoreSqlite(join(rootDir, 'knowledge.db'));
  });

  afterEach(() => {
    store.close();
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('rejects agent attempts to persist user-owned meeting recordings', async () => {
    const collection = store.createCollection({ name: 'Meetings', embeddingModelId: 'm', embeddingDim: 384 });
    const service = createMeetingService({
      store,
      transcriber: { transcribeFile: async () => ({ text: '', segments: [] }) },
      summaryService: { summarizeMeeting: async () => ({ ok: true as const, summary: { title: 'x', attendees: [], decisions: [], actionItems: [] } }) },
    });

    const result = await service.processRecording({
      requestSource: 'agent',
      collectionId: collection.id,
      title: 'Private Meeting',
      audioFilePath: join(rootDir, 'missing.wav'),
      summaryProvider: 'local-only',
    });

    expect(result).toEqual({ ok: false, error: 'agent_meeting_write_forbidden' });
    expect(store.listSources(collection.id)).toEqual([]);
  });
});
