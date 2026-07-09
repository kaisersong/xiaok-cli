import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createKbStoreSqlite } from '../../electron/kb-store-sqlite.js';
import type { KbStore } from '../../electron/kb-store.js';
import { createLocalMeetingTranscriber } from '../../electron/meeting-local-transcriber.js';
import { createMeetingService } from '../../electron/meeting-service.js';
import { createLocalMeetingSummaryService } from '../../electron/meeting-summary-service.js';

const runRealTranscription = process.env.XIAOK_MEETING_REAL_TRANSCRIBE === '1' && process.platform === 'darwin';

describe.skipIf(!runRealTranscription)('Meeting assistant real local transcription e2e', () => {
  let rootDir: string;
  let store: KbStore;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-meeting-real-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
    store = createKbStoreSqlite(join(rootDir, 'knowledge.db'));
  });

  afterEach(() => {
    store.close();
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('transcribes generated speech with local Whisper and writes meeting minutes to the knowledge base', async () => {
    const collection = store.createCollection({ name: 'Meetings', embeddingModelId: 'm', embeddingDim: 384 });
    const aiffPath = join(rootDir, 'speech.aiff');
    const wavPath = join(rootDir, 'speech.wav');

    execFileSync('say', ['-o', aiffPath, 'Alice will ship the demo. Bob will write notes.']);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', aiffPath, '-ar', '16000', '-ac', '1', wavPath]);
    expect(existsSync(wavPath)).toBe(true);

    const service = createMeetingService({
      store,
      transcriber: createLocalMeetingTranscriber({
        model: process.env.XIAOK_MEETING_WHISPER_MODEL ?? 'base',
        timeoutMs: 30 * 60 * 1000,
      }),
      summaryService: createLocalMeetingSummaryService(),
      now: () => 4_000,
    });

    const result = await service.processRecording({
      requestSource: 'user',
      collectionId: collection.id,
      title: 'Real Local Sync',
      audioFilePath: wavPath,
      summaryProvider: 'local-only',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const sourceContent = store.getSourceWithContent(result.source.id)?.text ?? '';
    expect(sourceContent).toContain('## 会议纪要');
    expect(sourceContent).toMatch(/Alice|demo|ship/i);
    expect(result.chunks.some(chunk => chunk.metadata.kind === 'summary')).toBe(true);
    expect(result.meeting.status).toBe('saved');
  });
});
