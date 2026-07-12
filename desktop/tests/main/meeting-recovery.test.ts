import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createKbStoreSqlite } from '../../electron/kb-store-sqlite.js';
import type { KbStore } from '../../electron/kb-store.js';
import { createMeetingService } from '../../electron/meeting-service.js';

describe('MeetingService recovery', () => {
  let rootDir: string;
  let store: KbStore;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-meeting-recovery-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
    store = createKbStoreSqlite(join(rootDir, 'knowledge.db'));
  });

  afterEach(() => {
    store.close();
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('marks active recordings as interrupted on startup', async () => {
    const audioFilePath = join(rootDir, 'interrupted.wav');
    writeFileSync(audioFilePath, 'partial wav');
    store.createMeeting({ id: 'meeting-recording', status: 'recording', title: 'Interrupted', audioFilePath, startedAt: 10 });
    const service = createMeetingService({ store });

    const result = await service.recoverMeetings();

    expect(result).toContainEqual({ meetingId: 'meeting-recording', from: 'recording', to: 'interrupted' });
    expect(store.getMeeting('meeting-recording')?.status).toBe('interrupted');
  });

  it('does not replay summarization after restart', async () => {
    store.createMeeting({ id: 'meeting-summary', status: 'summarizing', title: 'Summary', startedAt: 10 });
    const service = createMeetingService({ store });

    const result = await service.recoverMeetings();

    expect(result).toContainEqual({ meetingId: 'meeting-summary', from: 'summarizing', to: 'transcribed' });
    expect(store.getMeeting('meeting-summary')?.status).toBe('transcribed');
  });

  it('marks in-flight transcription as interrupted on startup while keeping the audio for retry', async () => {
    const audioFilePath = join(rootDir, 'transcribing.wav');
    writeFileSync(audioFilePath, 'complete wav');
    store.createMeeting({ id: 'meeting-transcribing', status: 'transcribing', title: 'Transcribing', audioFilePath, startedAt: 10 });
    const service = createMeetingService({ store });

    const result = await service.recoverMeetings();

    expect(result).toContainEqual({ meetingId: 'meeting-transcribing', from: 'transcribing', to: 'interrupted' });
    expect(store.getMeeting('meeting-transcribing')).toMatchObject({
      status: 'interrupted',
      audioFilePath,
      failureReason: 'transcription_interrupted',
    });
  });
});
