import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileTaskSnapshotStore, recoverTaskSnapshotSync } from '../../../src/runtime/task-host/snapshot-store.js';
import type { TaskSnapshot } from '../../../src/runtime/task-host/types.js';

describe('FileTaskSnapshotStore', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-task-host-snapshot-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('saves and recovers one active task snapshot', async () => {
    const store = new FileTaskSnapshotStore(rootDir);
    await store.save(createSnapshot('task_1', 'running'));

    expect(await store.getActiveTask()).toEqual({ taskId: 'task_1' });
    expect(await store.recoverTask('task_1')).toMatchObject({
      taskId: 'task_1',
      status: 'running',
      prompt: '生成 A 客户方案 PPT',
    });

    const reloaded = new FileTaskSnapshotStore(rootDir);
    expect(await reloaded.getActiveTask()).toEqual({ taskId: 'task_1' });
    expect(await reloaded.recoverTask('task_1')).toMatchObject({
      taskId: 'task_1',
      status: 'running',
    });
  });

  it('clears active task when a completed snapshot is saved but keeps failed snapshots recoverable', async () => {
    const store = new FileTaskSnapshotStore(rootDir);
    await store.save(createSnapshot('task_1', 'running'));
    await store.save(createSnapshot('task_1', 'completed'));

    expect(await store.getActiveTask()).toBeNull();
    expect(await store.recoverTask('task_1')).toMatchObject({
      taskId: 'task_1',
      status: 'completed',
    });

    await store.save({
      ...createSnapshot('task_2', 'failed'),
      salvage: {
        summary: ['已识别客户诉求'],
        reason: 'missing_material',
      },
    });

    expect(await store.getActiveTask()).toBeNull();
    expect(await store.recoverTask('task_2')).toMatchObject({
      taskId: 'task_2',
      status: 'failed',
      salvage: {
        summary: ['已识别客户诉求'],
        reason: 'missing_material',
      },
    });
  });

  it('keeps all active task ids when concurrent task snapshots are saved', async () => {
    const store = new FileTaskSnapshotStore(rootDir);

    await Promise.all([
      store.save(createSnapshot('task_1', 'running')),
      store.save(createSnapshot('task_2', 'running')),
    ]);

    expect(await store.getActiveTasks()).toEqual(
      expect.arrayContaining([{ taskId: 'task_1' }, { taskId: 'task_2' }]),
    );
  });

  it('round-trips an artifact workspace execution scope without interpreting it', async () => {
    const store = new FileTaskSnapshotStore(rootDir);
    const scoped = {
      ...createSnapshot('task_workspace', 'running'),
      executionScope: {
        kind: 'artifact_workspace_generation' as const,
        generationRequestId: 'generation-1',
        leaseId: 'lease-1',
      },
    };

    await store.save(scoped);

    expect(await new FileTaskSnapshotStore(rootDir).recoverTask('task_workspace')).toMatchObject({
      executionScope: scoped.executionScope,
    });
  });

  it('appends non-terminal mutations to a journal and replays them after restart', async () => {
    const store = new FileTaskSnapshotStore(rootDir);
    const initial = createSnapshot('task_journal', 'running');
    await store.save(initial);
    const withEvents = {
      ...initial,
      events: [
        { type: 'task_started' as const, taskId: 'task_journal' },
        { type: 'assistant_delta' as const, eventId: 'event-1', delta: 'hello' },
      ],
      updatedAt: 3,
    };

    await store.save(withEvents);

    const checkpointPath = join(rootDir, 'snapshots', 'task_journal.json');
    const journalPath = join(rootDir, 'snapshots', 'task_journal.journal.jsonl');
    const checkpoint = JSON.parse(readFileSync(checkpointPath, 'utf8'));
    expect(checkpoint.events).toEqual([]);
    expect(existsSync(journalPath)).toBe(true);
    expect(statSync(journalPath).size).toBeLessThan(Buffer.byteLength(JSON.stringify(withEvents, null, 2)));
    await expect(new FileTaskSnapshotStore(rootDir).recoverTask('task_journal')).resolves.toEqual(withEvents);
  });

  it('materializes a complete legacy-readable snapshot on terminal transition', async () => {
    const store = new FileTaskSnapshotStore(rootDir);
    const initial = createSnapshot('task_terminal', 'running');
    await store.save(initial);
    await store.save({
      ...initial,
      status: 'completed',
      events: [
        { type: 'assistant_delta', eventId: 'event-1', delta: 'done' },
        { type: 'task_terminal', status: 'completed' },
      ],
      updatedAt: 4,
    });

    const checkpointPath = join(rootDir, 'snapshots', 'task_terminal.json');
    const journalPath = join(rootDir, 'snapshots', 'task_terminal.journal.jsonl');
    const legacyView = JSON.parse(readFileSync(checkpointPath, 'utf8'));
    expect(legacyView).toMatchObject({ status: 'completed' });
    expect(legacyView.events).toHaveLength(2);
    expect(existsSync(journalPath)).toBe(false);
    await expect(new FileTaskSnapshotStore(rootDir).recoverTask('task_terminal')).resolves.toEqual({
      ...initial,
      status: 'completed',
      events: [
        { type: 'assistant_delta', eventId: 'event-1', delta: 'done' },
        { type: 'task_terminal', status: 'completed' },
      ],
      updatedAt: 4,
    });
  });

  it('ignores an uncommitted journal tail but fails closed for middle corruption', async () => {
    const store = new FileTaskSnapshotStore(rootDir);
    const initial = createSnapshot('task_tail', 'running');
    await store.save(initial);
    await store.save({
      ...initial,
      events: [{ type: 'task_started', taskId: 'task_tail' }],
      updatedAt: 3,
    });
    const journalPath = join(rootDir, 'snapshots', 'task_tail.journal.jsonl');
    appendFileSync(journalPath, '{"version":1', 'utf8');

    await expect(new FileTaskSnapshotStore(rootDir).recoverTask('task_tail')).resolves.toMatchObject({
      events: [{ type: 'task_started', taskId: 'task_tail' }],
    });

    writeFileSync(journalPath, '{bad}\n{"version":1', 'utf8');
    await expect(new FileTaskSnapshotStore(rootDir).recoverTask('task_tail')).rejects.toThrow('invalid task journal record');
  });

  it('truncates an ignored crash tail before the writer appends the next committed frame', async () => {
    const initial = createSnapshot('task_tail_resume', 'running');
    const first = {
      ...initial,
      events: [{ type: 'assistant_delta' as const, eventId: 'event-1', delta: 'one' }],
      updatedAt: 3,
    };
    const store = new FileTaskSnapshotStore(rootDir);
    await store.save(initial);
    await store.save(first);
    appendFileSync(join(rootDir, 'snapshots', 'task_tail_resume.journal.jsonl'), '{"version":1', 'utf8');

    const resumed = new FileTaskSnapshotStore(rootDir);
    expect((await resumed.recoverTask('task_tail_resume'))?.events).toHaveLength(1);
    const second = {
      ...first,
      events: [...first.events, { type: 'assistant_delta' as const, eventId: 'event-2', delta: 'two' }],
      updatedAt: 4,
    };
    await resumed.save(second, first);

    await expect(new FileTaskSnapshotStore(rootDir).recoverTask('task_tail_resume')).resolves.toEqual(second);
  });

  it('rejects a non-prefix snapshot mutation before writing the journal', async () => {
    const store = new FileTaskSnapshotStore(rootDir);
    const initial = {
      ...createSnapshot('task_prefix', 'running'),
      events: [{ type: 'task_started' as const, taskId: 'task_prefix' }],
    };
    await store.save(initial);

    await expect(store.save({
      ...initial,
      events: [{ type: 'error', message: 'replacement' }],
    })).rejects.toThrow('task events are not append-only');
  });

  it('fails closed for a checksum mismatch and a committed sequence gap', async () => {
    const initial = createSnapshot('task_integrity', 'running');
    const store = new FileTaskSnapshotStore(rootDir);
    await store.save(initial);
    await store.save({
      ...initial,
      events: [{ type: 'assistant_delta', eventId: 'event-1', delta: 'one' }],
      updatedAt: 3,
    });
    await store.save({
      ...initial,
      events: [
        { type: 'assistant_delta', eventId: 'event-1', delta: 'one' },
        { type: 'assistant_delta', eventId: 'event-2', delta: 'two' },
      ],
      updatedAt: 4,
    });
    const journalPath = join(rootDir, 'snapshots', 'task_integrity.journal.jsonl');
    const records = readFileSync(journalPath, 'utf8').trimEnd().split('\n');

    writeFileSync(journalPath, `${records[0].replace('one', 'tampered')}\n`, 'utf8');
    expect(() => recoverTaskSnapshotSync(rootDir, 'task_integrity')).toThrow('invalid task journal record');

    writeFileSync(journalPath, `${records[1]}\n`, 'utf8');
    await expect(new FileTaskSnapshotStore(rootDir).recoverTask('task_integrity')).rejects.toThrow('sequence gap');
  });

  it('serializes concurrent saves for the same task without losing event suffixes', async () => {
    const initial = createSnapshot('task_concurrent', 'running');
    const store = new FileTaskSnapshotStore(rootDir);
    await store.save(initial);
    const first = {
      ...initial,
      events: [{ type: 'assistant_delta' as const, eventId: 'event-1', delta: 'one' }],
      updatedAt: 3,
    };
    const second = {
      ...initial,
      events: [
        ...first.events,
        { type: 'assistant_delta' as const, eventId: 'event-2', delta: 'two' },
      ],
      updatedAt: 4,
    };

    await Promise.all([store.save(first), store.save(second)]);

    await expect(new FileTaskSnapshotStore(rootDir).recoverTask('task_concurrent')).resolves.toEqual(second);
  });

  it('ignores journal records already folded into a terminal checkpoint after cleanup interruption', async () => {
    const initial = createSnapshot('task_folded', 'running');
    const store = new FileTaskSnapshotStore(rootDir);
    await store.save(initial);
    const running = {
      ...initial,
      events: [{ type: 'assistant_delta' as const, eventId: 'event-1', delta: 'done' }],
      updatedAt: 3,
    };
    await store.save(running);
    const journalPath = join(rootDir, 'snapshots', 'task_folded.journal.jsonl');
    const staleJournal = readFileSync(journalPath, 'utf8');
    const terminal = {
      ...running,
      status: 'completed' as const,
      events: [...running.events, { type: 'task_terminal' as const, status: 'completed' as const }],
      updatedAt: 4,
    };
    await store.save(terminal);
    writeFileSync(journalPath, staleJournal, 'utf8');

    await expect(new FileTaskSnapshotStore(rootDir).recoverTask('task_folded')).resolves.toEqual(terminal);
  });

  it('uses geometrically spaced interim checkpoints to bound long running-task replay', async () => {
    const initial = createSnapshot('task_long_running', 'running');
    const store = new FileTaskSnapshotStore(rootDir);
    await store.save(initial);
    let snapshot = initial;
    for (let index = 0; index < 600; index += 1) {
      snapshot = {
        ...snapshot,
        events: [...snapshot.events, { type: 'assistant_delta', eventId: `event-${index}`, delta: 'x' }],
        updatedAt: index + 3,
      };
      await store.save(snapshot);
    }

    const checkpoint = JSON.parse(readFileSync(join(rootDir, 'snapshots', 'task_long_running.json'), 'utf8'));
    const journal = readFileSync(join(rootDir, 'snapshots', 'task_long_running.journal.jsonl'), 'utf8').trimEnd().split('\n');
    expect(checkpoint.events).toHaveLength(512);
    expect(journal).toHaveLength(88);
    await expect(new FileTaskSnapshotStore(rootDir).recoverTask('task_long_running')).resolves.toEqual(snapshot);
  });

  it('upgrades a legacy checkpoint before journaling and fails closed after an old writer removes the seal', async () => {
    const initial = createSnapshot('task_legacy_upgrade', 'running');
    const snapshotDir = join(rootDir, 'snapshots');
    mkdirSync(snapshotDir, { recursive: true });
    const checkpointPath = join(snapshotDir, 'task_legacy_upgrade.json');
    writeFileSync(checkpointPath, JSON.stringify(initial, null, 2), 'utf8');
    const next = {
      ...initial,
      events: [{ type: 'assistant_delta' as const, eventId: 'event-1', delta: 'one' }],
      updatedAt: 3,
    };

    await new FileTaskSnapshotStore(rootDir).save(next);
    expect(JSON.parse(readFileSync(checkpointPath, 'utf8')).__xiaokJournal).toMatchObject({ version: 1 });

    // Simulate an unsupported downgrade: a legacy binary rewrites the sealed
    // checkpoint but leaves the new journal in place.
    writeFileSync(checkpointPath, JSON.stringify(next, null, 2), 'utf8');
    await expect(new FileTaskSnapshotStore(rootDir).recoverTask('task_legacy_upgrade'))
      .rejects.toThrow('unsealed checkpoint has a task journal');
  });
});

function createSnapshot(taskId: string, status: TaskSnapshot['status']): TaskSnapshot {
  return {
    taskId,
    sessionId: 'sess_1',
    status,
    prompt: '生成 A 客户方案 PPT',
    materials: [],
    events: [],
    createdAt: 1,
    updatedAt: 2,
  };
}
