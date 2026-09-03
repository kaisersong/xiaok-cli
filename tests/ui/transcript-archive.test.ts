import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  analyzeTranscriptEvents,
  analyzeTranscriptFileStreaming,
  archiveTranscript,
  FileTranscriptLogger,
  loadTranscriptEvents,
  type TranscriptArchivePhase,
  type TranscriptEvent,
} from '../../src/ui/transcript.js';
import { sealTranscriptWriter } from '../../src/ui/transcript-storage.js';

describe('safe transcript gzip archive', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'xiaok-transcript-archive-'));
  });

  afterEach(() => {
    chmodTreeWritable(dir);
    rmSync(dir, { recursive: true, force: true });
  });

  function rawPath(sessionId: string): string {
    return join(dir, `${sessionId}.jsonl`);
  }

  function writeEvents(sessionId: string, events: TranscriptEvent[], trailingNewline = true): void {
    writeFileSync(
      rawPath(sessionId),
      events.map((event) => JSON.stringify(event)).join('\n') + (trailingNewline ? '\n' : ''),
      { encoding: 'utf8', mode: 0o600 },
    );
  }

  const firstEvents: TranscriptEvent[] = [
    { type: 'input_key', key: 'a', timestamp: 1 },
    { type: 'output', stream: 'stdout', raw: '> /\n', normalized: '> /\n', timestamp: 2 },
  ];

  it('archives through the production API and transparently reads gzip', async () => {
    writeEvents('sess_gzip', firstEvents);

    const result = await archiveTranscript('sess_gzip', { rootDir: dir, olderThanDays: 0 });

    expect(result.status).toBe('archived');
    expect(result.sourceBytes).toBeGreaterThan(result.compressedBytes);
    expect(result.bytesFreed).toBe(result.sourceBytes - result.compressedBytes);
    expect(existsSync(rawPath('sess_gzip'))).toBe(false);
    expect(loadTranscriptEvents('sess_gzip', dir)).toEqual(firstEvents);
    await expect(analyzeTranscriptFileStreaming('sess_gzip', dir)).resolves.toEqual(
      analyzeTranscriptEvents(firstEvents),
    );
  });

  it('preserves source boundaries for a complete no-newline segment and resumed raw tail', async () => {
    writeEvents('sess_boundary', [firstEvents[0]], false);
    await archiveTranscript('sess_boundary', { rootDir: dir, olderThanDays: 0 });

    const logger = await FileTranscriptLogger.open('sess_boundary', dir);
    logger.record(firstEvents[1]);
    logger.close();

    expect(loadTranscriptEvents('sess_boundary', dir)).toEqual(firstEvents);
  });

  it('rejects recent raw files by default without deleting them', async () => {
    writeEvents('sess_recent', firstEvents);

    await expect(archiveTranscript('sess_recent', { rootDir: dir }))
      .rejects.toMatchObject({ code: 'transcript_too_recent' });
    expect(existsSync(rawPath('sess_recent'))).toBe(true);
  });

  it('rejects an active production writer even when olderThanDays is zero', async () => {
    const logger = await FileTranscriptLogger.open('sess_active', dir);
    logger.record(firstEvents[0]);

    await expect(archiveTranscript('sess_active', { rootDir: dir, olderThanDays: 0 }))
      .rejects.toMatchObject({ code: 'transcript_busy' });

    logger.close();
    await expect(archiveTranscript('sess_active', { rootDir: dir, olderThanDays: 0 }))
      .resolves.toMatchObject({ status: 'archived' });
  });

  it('serializes two production archivers for the same session', async () => {
    writeEvents('sess_archive_busy', firstEvents);
    let releaseFirst!: () => void;
    const release = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let firstReached!: () => void;
    const reached = new Promise<void>((resolve) => { firstReached = resolve; });
    const first = archiveTranscript('sess_archive_busy', {
      rootDir: dir,
      olderThanDays: 0,
      onPhase: async (phase) => {
        if (phase !== 'afterSegmentPublished') return;
        firstReached();
        await release;
      },
    });
    await reached;

    await expect(archiveTranscript('sess_archive_busy', { rootDir: dir, olderThanDays: 0 }))
      .rejects.toMatchObject({ code: 'transcript_busy' });
    releaseFirst();
    await expect(first).resolves.toMatchObject({ status: 'archived' });
  });

  it('reopens an archived session as a new raw tail and archives it again without duplication', async () => {
    writeEvents('sess_resume', firstEvents);
    await archiveTranscript('sess_resume', { rootDir: dir, olderThanDays: 0 });

    const resumed = await FileTranscriptLogger.open('sess_resume', dir);
    const tail: TranscriptEvent = { type: 'input_submit', value: '继续', timestamp: 3 };
    resumed.record(tail);
    resumed.close();

    expect(loadTranscriptEvents('sess_resume', dir)).toEqual([...firstEvents, tail]);
    await archiveTranscript('sess_resume', { rootDir: dir, olderThanDays: 0 });
    expect(loadTranscriptEvents('sess_resume', dir)).toEqual([...firstEvents, tail]);
  });

  it('refuses incomplete tails and middle corruption while preserving raw', async () => {
    writeFileSync(rawPath('sess_incomplete'), `${JSON.stringify(firstEvents[0])}\n{"type":"output"`, 'utf8');
    await expect(archiveTranscript('sess_incomplete', { rootDir: dir, olderThanDays: 0 }))
      .rejects.toMatchObject({ code: 'transcript_incomplete_tail' });
    expect(existsSync(rawPath('sess_incomplete'))).toBe(true);

    writeFileSync(rawPath('sess_corrupt'), `{bad}\n${JSON.stringify(firstEvents[0])}\n`, 'utf8');
    await expect(archiveTranscript('sess_corrupt', { rootDir: dir, olderThanDays: 0 }))
      .rejects.toMatchObject({ code: 'transcript_invalid_json' });
    expect(existsSync(rawPath('sess_corrupt'))).toBe(true);
  });

  it('recovers an uncommitted pending transaction through archiveTranscript', async () => {
    writeEvents('sess_pending', firstEvents);
    await expect(archiveTranscript('sess_pending', {
      rootDir: dir,
      olderThanDays: 0,
      onPhase: crashAt('afterRawRenamed'),
    })).rejects.toThrow('simulated crash');

    expect(existsSync(rawPath('sess_pending'))).toBe(false);
    expect(loadTranscriptEvents('sess_pending', dir)).toEqual(firstEvents);

    await expect(archiveTranscript('sess_pending', { rootDir: dir, olderThanDays: 0 }))
      .resolves.toMatchObject({ status: 'archived' });
    expect(loadTranscriptEvents('sess_pending', dir)).toEqual(firstEvents);
  });

  it('commits an already verified orphan directly instead of replaying segment publication', async () => {
    writeEvents('sess_pending_direct', firstEvents);
    await expect(archiveTranscript('sess_pending_direct', {
      rootDir: dir,
      olderThanDays: 0,
      onPhase: crashAt('afterRawRenamed'),
    })).rejects.toThrow('simulated crash');
    let republished = false;

    await expect(archiveTranscript('sess_pending_direct', {
      rootDir: dir,
      olderThanDays: 0,
      onPhase: (phase) => {
        if (phase === 'afterSegmentPublished') republished = true;
      },
    })).resolves.toMatchObject({ status: 'archived' });

    expect(republished).toBe(false);
    expect(loadTranscriptEvents('sess_pending_direct', dir)).toEqual(firstEvents);
  });

  it('rechecks an uncommitted pending before recovery commit and preserves retained-fd appends', async () => {
    writeEvents('sess_pending_recovery_append', firstEvents);
    const path = rawPath('sess_pending_recovery_append');
    const fd = openSync(path, 'a');
    const appended: TranscriptEvent = { type: 'input_submit', value: 'recovery append', timestamp: 5 };
    try {
      await expect(archiveTranscript('sess_pending_recovery_append', {
        rootDir: dir,
        olderThanDays: 0,
        onPhase: crashAt('afterRawRenamed'),
      })).rejects.toThrow('simulated crash');
      let mutated = false;

      await expect(archiveTranscript('sess_pending_recovery_append', {
        rootDir: dir,
        olderThanDays: 0,
        onPhase: (phase) => {
          if (phase !== 'afterPendingVerified' || mutated) return;
          mutated = true;
          writeSync(fd, `${JSON.stringify(appended)}\n`);
        },
      })).resolves.toMatchObject({ status: 'archived' });
    } finally {
      closeSync(fd);
    }

    expect(loadTranscriptEvents('sess_pending_recovery_append', dir)).toEqual([...firstEvents, appended]);
  });

  it('discards a corrupt orphan segment before retrying an uncommitted pending transaction', async () => {
    writeEvents('sess_pending_bad_orphan', firstEvents);
    await expect(archiveTranscript('sess_pending_bad_orphan', {
      rootDir: dir,
      olderThanDays: 0,
      onPhase: crashAt('afterRawRenamed'),
    })).rejects.toThrow('simulated crash');

    const archiveDir = join(dir, 'sess_pending_bad_orphan.archive');
    const segment = readdirSync(archiveDir).find((name) => name.endsWith('.jsonl.gz'))!;
    const segmentPath = join(archiveDir, segment);
    makeWritable(segmentPath);
    const bytes = Buffer.from(readFileSync(segmentPath));
    bytes[Math.floor(bytes.length / 2)] ^= 0xff;
    writeFileSync(segmentPath, bytes);

    await expect(archiveTranscript('sess_pending_bad_orphan', { rootDir: dir, olderThanDays: 0 }))
      .resolves.toMatchObject({ status: 'archived' });
    expect(loadTranscriptEvents('sess_pending_bad_orphan', dir)).toEqual(firstEvents);
  });

  it('recognizes a committed manifest after crashing before pending cleanup', async () => {
    writeEvents('sess_committed', firstEvents);
    await expect(archiveTranscript('sess_committed', {
      rootDir: dir,
      olderThanDays: 0,
      onPhase: crashAt('afterManifestCommitted'),
    })).rejects.toThrow('simulated crash');

    expect(loadTranscriptEvents('sess_committed', dir)).toEqual(firstEvents);
    await expect(archiveTranscript('sess_committed', { rootDir: dir, olderThanDays: 0 }))
      .resolves.toMatchObject({ status: 'already_archived' });
    expect(readdirSync(dir).filter((name) => name.startsWith('sess_committed.pending-'))).toEqual([]);
  });

  it('keeps committed pending when its manifest segment is corrupt', async () => {
    writeEvents('sess_committed_corrupt', firstEvents);
    await expect(archiveTranscript('sess_committed_corrupt', {
      rootDir: dir,
      olderThanDays: 0,
      onPhase: crashAt('afterManifestCommitted'),
    })).rejects.toThrow('simulated crash');

    const archiveDir = join(dir, 'sess_committed_corrupt.archive');
    const segment = readdirSync(archiveDir).find((name) => name.endsWith('.jsonl.gz'))!;
    makeWritable(join(archiveDir, segment));
    const bytes = Buffer.from(readFileSync(join(archiveDir, segment)));
    bytes[Math.floor(bytes.length / 2)] ^= 0xff;
    writeFileSync(join(archiveDir, segment), bytes);
    const pending = readdirSync(dir).find((name) => name.startsWith('sess_committed_corrupt.pending-'))!;

    await expect(FileTranscriptLogger.open('sess_committed_corrupt', dir))
      .rejects.toMatchObject({ code: 'transcript_segment_corrupt' });
    expect(existsSync(join(dir, pending))).toBe(true);
  });

  it('revalidates the source plan when archive commits between manifest and tail resolution', async () => {
    writeEvents('sess_snapshot_race', [firstEvents[0]]);
    await archiveTranscript('sess_snapshot_race', { rootDir: dir, olderThanDays: 0 });
    const logger = await FileTranscriptLogger.open('sess_snapshot_race', dir);
    logger.record(firstEvents[1]);
    logger.close();
    let injected = false;

    const analysis = await analyzeTranscriptFileStreaming('sess_snapshot_race', dir, {
      onPhase: async (phase) => {
        if (phase !== 'afterManifestResolved' || injected) return;
        injected = true;
        await archiveTranscript('sess_snapshot_race', { rootDir: dir, olderThanDays: 0 });
      },
    });

    expect(injected).toBe(true);
    expect(analysis).toEqual(analyzeTranscriptEvents(firstEvents));
  });

  it('rejects a pending tail whose sequence is not latest plus one', async () => {
    writeEvents('sess_bad_pending_sequence', firstEvents);
    await archiveTranscript('sess_bad_pending_sequence', { rootDir: dir, olderThanDays: 0 });
    const archiveDir = join(dir, 'sess_bad_pending_sequence.archive');
    const segment = readdirSync(archiveDir).find((name) => name.endsWith('.jsonl.gz'))!;
    const sha = segment.split('-').at(-1)!.replace('.jsonl.gz', '');
    writeFileSync(
      join(dir, `sess_bad_pending_sequence.pending-000003-${sha}.jsonl`),
      firstEvents.map((event) => JSON.stringify(event)).join('\n') + '\n',
      'utf8',
    );

    expect(() => loadTranscriptEvents('sess_bad_pending_sequence', dir))
      .toThrow('transcript_ambiguous_state');
    await expect(analyzeTranscriptFileStreaming('sess_bad_pending_sequence', dir))
      .rejects.toMatchObject({ code: 'transcript_ambiguous_state' });
  });

  it('fails closed when a later manifest generation does not preserve the prior prefix', async () => {
    writeEvents('sess_manifest_prefix', [firstEvents[0]]);
    await archiveTranscript('sess_manifest_prefix', { rootDir: dir, olderThanDays: 0 });
    const logger = await FileTranscriptLogger.open('sess_manifest_prefix', dir);
    logger.record(firstEvents[1]);
    logger.close();
    await archiveTranscript('sess_manifest_prefix', { rootDir: dir, olderThanDays: 0 });

    const archiveDir = join(dir, 'sess_manifest_prefix.archive');
    const manifests = readdirSync(archiveDir).filter((name) => name.startsWith('manifest-')).sort();
    const firstManifestPath = join(archiveDir, manifests[0]);
    const firstManifest = JSON.parse(readFileSync(firstManifestPath, 'utf8'));
    firstManifest.segments[0].archivedAt = 'tampered-but-schema-valid';
    writeFileSync(firstManifestPath, `${JSON.stringify(firstManifest)}\n`);

    expect(() => loadTranscriptEvents('sess_manifest_prefix', dir))
      .toThrow('transcript_manifest_conflict');
  });

  it.each<TranscriptArchivePhase>(['afterSegmentPublished', 'afterPendingVerified'])(
    'detects retained-fd appends at %s and never loses the appended event',
    async (phase) => {
      writeEvents(`sess_mutate_${phase}`, firstEvents);
      const path = rawPath(`sess_mutate_${phase}`);
      const fd = openSync(path, 'a');
      const appended: TranscriptEvent = { type: 'input_submit', value: phase, timestamp: 4 };
      let mutated = false;
      try {
        const result = await archiveTranscript(`sess_mutate_${phase}`, {
          rootDir: dir,
          olderThanDays: 0,
          onPhase: async (current) => {
            if (current !== phase || mutated) return;
            mutated = true;
            writeSync(fd, `${JSON.stringify(appended)}\n`);
          },
        });
        expect(result.status).toBe('archived');
      } finally {
        closeSync(fd);
      }

      expect(loadTranscriptEvents(`sess_mutate_${phase}`, dir)).toEqual([...firstEvents, appended]);
    },
  );

  it('fails closed when a production gzip segment is corrupted', async () => {
    writeEvents('sess_bad_gzip', firstEvents);
    await archiveTranscript('sess_bad_gzip', { rootDir: dir, olderThanDays: 0 });
    const archiveDir = join(dir, 'sess_bad_gzip.archive');
    const segment = readdirSync(archiveDir).find((name) => name.endsWith('.jsonl.gz'))!;
    makeWritable(join(archiveDir, segment));
    const bytes = Buffer.from(readFileSync(join(archiveDir, segment)));
    bytes[Math.floor(bytes.length / 2)] ^= 0xff;
    writeFileSync(join(archiveDir, segment), bytes);

    await expect(analyzeTranscriptFileStreaming('sess_bad_gzip', dir)).rejects.toThrow();
    expect(() => loadTranscriptEvents('sess_bad_gzip', dir)).toThrow();
  });

  it('fails closed for manifest traversal and missing referenced segments', async () => {
    writeEvents('sess_bad_manifest', firstEvents);
    await archiveTranscript('sess_bad_manifest', { rootDir: dir, olderThanDays: 0 });
    const archiveDir = join(dir, 'sess_bad_manifest.archive');
    const manifestPath = join(archiveDir, readdirSync(archiveDir).find((name) => name.startsWith('manifest-'))!);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.segments[0].fileName = '../escape.jsonl.gz';
    writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
    await expect(analyzeTranscriptFileStreaming('sess_bad_manifest', dir))
      .rejects.toMatchObject({ code: 'transcript_manifest_invalid' });

    writeEvents('sess_missing_segment', firstEvents);
    await archiveTranscript('sess_missing_segment', { rootDir: dir, olderThanDays: 0 });
    const missingDir = join(dir, 'sess_missing_segment.archive');
    const segment = readdirSync(missingDir).find((name) => name.endsWith('.jsonl.gz'))!;
    renameForMissing(join(missingDir, segment));
    await expect(analyzeTranscriptFileStreaming('sess_missing_segment', dir))
      .rejects.toMatchObject({ code: 'transcript_segment_missing' });
  });

  it('rejects traversal-like session ids in writer, reader, and archive sibling paths', async () => {
    await expect(FileTranscriptLogger.open('../escape', dir)).rejects.toMatchObject({
      code: 'invalid_transcript_session_id',
    });
    expect(() => loadTranscriptEvents('../escape', dir)).toThrow('invalid transcript session id');
    await expect(archiveTranscript('../escape', { rootDir: dir, olderThanDays: 0 }))
      .rejects.toMatchObject({ code: 'invalid_transcript_session_id' });
  });

  it('marks closed raw transcripts read-only and restores owner-write on resume', async () => {
    if (process.platform === 'win32') return;
    const logger = await FileTranscriptLogger.open('sess_mode', dir);
    logger.record(firstEvents[0]);
    logger.close();
    expect(statSync(rawPath('sess_mode')).mode & 0o200).toBe(0);

    const resumed = await FileTranscriptLogger.open('sess_mode', dir);
    expect(statSync(rawPath('sess_mode')).mode & 0o200).toBe(0o200);
    resumed.close();
  });

  it('keeps the writer claim when sealing fails so another owner cannot enter', async () => {
    const logger = await FileTranscriptLogger.open('sess_seal_failure', dir);
    logger.record(firstEvents[0]);
    const path = rawPath('sess_seal_failure');
    const backup = `${path}.backup`;
    renameSync(path, backup);
    mkdirSync(path);

    expect(() => logger.close()).toThrow();
    await expect(archiveTranscript('sess_seal_failure', { rootDir: dir, olderThanDays: 0 }))
      .rejects.toMatchObject({ code: 'transcript_busy' });

    rmSync(path, { recursive: true, force: true });
    renameSync(backup, path);
    logger.close();
    await expect(archiveTranscript('sess_seal_failure', { rootDir: dir, olderThanDays: 0 }))
      .resolves.toMatchObject({ status: 'archived' });
  });

  it('maps Windows-style writer seal sharing failures to typed busy', () => {
    writeEvents('sess_seal_busy', firstEvents);
    const busy = Object.assign(new Error('sharing violation'), { code: 'EPERM' });

    expect(() => sealTranscriptWriter('sess_seal_busy', dir, {
      open: () => { throw busy; },
    })).toThrow(expect.objectContaining({ code: 'transcript_busy' }));
  });

  it('refuses to create a 129th immutable segment', async () => {
    const sessionId = 'sess_segment_limit';
    for (let index = 0; index < 128; index += 1) {
      const logger = await FileTranscriptLogger.open(sessionId, dir);
      logger.record({ type: 'input_key', key: String(index), timestamp: index });
      logger.close();
      await archiveTranscript(sessionId, { rootDir: dir, olderThanDays: 0 });
    }
    const logger = await FileTranscriptLogger.open(sessionId, dir);
    logger.record({ type: 'input_key', key: 'overflow', timestamp: 129 });
    logger.close();

    await expect(archiveTranscript(sessionId, { rootDir: dir, olderThanDays: 0 }))
      .rejects.toMatchObject({ code: 'transcript_segment_limit' });
    expect(existsSync(rawPath(sessionId))).toBe(true);
  }, 60_000);
});

function crashAt(target: TranscriptArchivePhase) {
  return async (phase: TranscriptArchivePhase): Promise<void> => {
    if (phase === target) throw new Error('simulated crash');
  };
}

function chmodTreeWritable(root: string): void {
  if (!existsSync(root)) return;
  try { chmodSync(root, 0o700); } catch {}
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) chmodTreeWritable(path);
    else {
      try { chmodSync(path, 0o600); } catch {}
    }
  }
}

function renameForMissing(path: string): void {
  // Rename keeps the fixture recoverable while exercising a genuinely missing manifest target.
  renameSync(path, `${path}.missing`);
}

function makeWritable(path: string): void {
  try { chmodSync(path, 0o600); } catch {}
}
