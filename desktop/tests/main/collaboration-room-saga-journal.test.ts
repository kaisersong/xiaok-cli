/**
 * Room project creation saga journal (design §11.2, §16.3).
 *
 * RED until Phase 3 implementation lands.
 *
 * Contract under test — electron/collaboration-room-saga-journal.ts:
 *   createRoomProjectSagaJournal({ dbPath })
 *     -> { prepare, markProjectObserved, markRoomEventObserved, complete,
 *          listUnfinished, get }
 *
 * Journal states: prepared -> project_observed -> room_event_observed -> completed
 *
 * Invariants:
 *   - prepare persists operationId + clientRequestKey + roomId +
 *     expectedRoomRevision + sourceMessageIds durably; clientRequestKey is
 *     unique — a concurrent second saga for the same key is rejected.
 *   - after a Desktop restart, unfinished operations are recoverable and
 *     reconcile by the documented algorithm: prepared + project missing ->
 *     retry the SAME clientRequestKey; project exists -> advance to
 *     project_observed; room event observed -> completed.
 *   - a suppressed (archived room) outcome completes the operation instead
 *     of retrying forever.
 *   - the journal never writes room messages itself (main is not the
 *     project event publisher).
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createRoomProjectSagaJournal,
} from '../../electron/collaboration-room-saga-journal.js';

function createJournalPath() {
  return join(mkdtempSync(join(tmpdir(), 'xiaok-room-saga-')), 'saga.db');
}

function createJournal(dbPath = createJournalPath()) {
  return { journal: createRoomProjectSagaJournal({ dbPath }), dbPath };
}

describe('room project saga journal', () => {
  it('persists a prepared operation with the full frozen context', () => {
    const { journal } = createJournal();

    const op = journal.prepare({
      operationId: 'op-1',
      clientRequestKey: 'room-create:op-1',
      roomId: 'room-1',
      expectedRoomRevision: 7,
      sourceMessageIds: ['msg-1', 'msg-2'],
    });

    expect(op.ok).toBe(true);
    const stored = journal.get('op-1');
    expect(stored).toMatchObject({
      state: 'prepared',
      clientRequestKey: 'room-create:op-1',
      roomId: 'room-1',
      expectedRoomRevision: 7,
      sourceMessageIds: ['msg-1', 'msg-2'],
    });
  });

  it('rejects a second saga for the same clientRequestKey', () => {
    const { journal } = createJournal();

    journal.prepare({
      operationId: 'op-1',
      clientRequestKey: 'room-create:same-key',
      roomId: 'room-1',
      expectedRoomRevision: 1,
      sourceMessageIds: [],
    });

    const duplicate = journal.prepare({
      operationId: 'op-2',
      clientRequestKey: 'room-create:same-key',
      roomId: 'room-1',
      expectedRoomRevision: 2,
      sourceMessageIds: [],
    });

    expect(duplicate.ok).toBe(false);
    expect(duplicate.code).toBe('room_project_operation_duplicate');
  });

  it('advances through the state machine and lists unfinished operations', () => {
    const { journal } = createJournal();
    journal.prepare({
      operationId: 'op-1',
      clientRequestKey: 'room-create:op-1',
      roomId: 'room-1',
      expectedRoomRevision: 1,
      sourceMessageIds: [],
    });

    expect(journal.markProjectObserved('op-1', 'proj-1').ok).toBe(true);
    expect(journal.get('op-1')).toMatchObject({ state: 'project_observed', projectId: 'proj-1' });

    expect(journal.markRoomEventObserved('op-1', 'pev-1').ok).toBe(true);
    expect(journal.get('op-1')).toMatchObject({ state: 'room_event_observed', projectionEventId: 'pev-1' });

    expect(journal.complete('op-1').ok).toBe(true);
    expect(journal.get('op-1')).toMatchObject({ state: 'completed' });
    expect(journal.listUnfinished().filter((op) => op.operationId === 'op-1')).toHaveLength(0);
  });

  it('recovers unfinished operations across a restart', () => {
    const { journal: first, dbPath } = createJournal();
    first.prepare({
      operationId: 'op-retry',
      clientRequestKey: 'room-create:op-retry',
      roomId: 'room-1',
      expectedRoomRevision: 1,
      sourceMessageIds: [],
    });
    first.prepare({
      operationId: 'op-observed',
      clientRequestKey: 'room-create:op-observed',
      roomId: 'room-1',
      expectedRoomRevision: 1,
      sourceMessageIds: [],
    });
    first.markProjectObserved('op-observed', 'proj-existing');

    // Desktop restarts: a fresh journal over the same file
    const second = createRoomProjectSagaJournal({ dbPath });
    const unfinished = second.listUnfinished();

    const ids = unfinished.map((op) => op.operationId).sort();
    expect(ids).toEqual(['op-observed', 'op-retry']);

    // the reconciler contract: prepared ops retry the same clientRequestKey
    const retryOp = unfinished.find((op) => op.operationId === 'op-retry');
    expect(retryOp?.clientRequestKey).toBe('room-create:op-retry');
    // observed ops wait for the room event instead of re-creating
    const observedOp = unfinished.find((op) => op.operationId === 'op-observed');
    expect(observedOp?.state).toBe('project_observed');
    expect(observedOp?.projectId).toBe('proj-existing');
  });

  it('completes a suppressed operation instead of retrying forever', () => {
    const { journal } = createJournal();
    journal.prepare({
      operationId: 'op-suppressed',
      clientRequestKey: 'room-create:op-suppressed',
      roomId: 'room-1',
      expectedRoomRevision: 1,
      sourceMessageIds: [],
    });
    journal.markProjectObserved('op-suppressed', 'proj-9');

    // the room slid into archiving; the broker reports a stable terminal state
    const result = journal.complete('op-suppressed', { outcome: 'suppressed_room_archived' });
    expect(result.ok).toBe(true);

    const stored = journal.get('op-suppressed');
    expect(stored).toMatchObject({ state: 'completed', outcome: 'suppressed_room_archived' });
    expect(journal.listUnfinished()).toHaveLength(0);
  });
});
