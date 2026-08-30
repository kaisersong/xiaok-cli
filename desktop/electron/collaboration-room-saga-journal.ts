/**
 * Room project creation saga journal (design §11.2, §16.3).
 *
 * Desktop main is the user-facing saga owner for createProjectFromRoom:
 *
 *   prepared -> project_observed -> room_event_observed -> completed
 *
 * The journal persists operationId + clientRequestKey + roomId +
 * expectedRoomRevision + sourceMessageIds durably before the first KSwarm
 * call; clientRequestKey has a UNIQUE constraint so two concurrent sagas
 * for the same key cannot both proceed. Recovery after a Desktop restart
 * retries the SAME clientRequestKey (KSwarm returns the same project) and
 * only completes once the broker snapshot has observed the KSwarm outbox
 * event. Main never writes room messages itself.
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

export type RoomProjectSagaState =
  | 'prepared'
  | 'project_observed'
  | 'room_event_observed'
  | 'completed';

export interface RoomProjectSagaOperation {
  operationId: string;
  state: RoomProjectSagaState;
  clientRequestKey: string;
  roomId: string;
  expectedRoomRevision: number;
  sourceMessageIds: string[];
  projectId?: string;
  projectionEventId?: string;
  outcome?: string;
}

interface SagaRow {
  operation_id: string;
  state: string;
  client_request_key: string;
  room_id: string;
  expected_room_revision: number;
  source_message_ids_json: string;
  project_id: string | null;
  projection_event_id: string | null;
  outcome: string | null;
}

function toSQLValue(value: unknown): SQLInputValue {
  return (value === undefined ? null : value) as SQLInputValue;
}

function mapRow(row: SagaRow): RoomProjectSagaOperation {
  return {
    operationId: row.operation_id,
    state: row.state as RoomProjectSagaState,
    clientRequestKey: row.client_request_key,
    roomId: row.room_id,
    expectedRoomRevision: row.expected_room_revision,
    sourceMessageIds: JSON.parse(row.source_message_ids_json) as string[],
    ...(row.project_id ? { projectId: row.project_id } : {}),
    ...(row.projection_event_id ? { projectionEventId: row.projection_event_id } : {}),
    ...(row.outcome ? { outcome: row.outcome } : {}),
  };
}

export function createRoomProjectSagaJournal({ dbPath }: { dbPath: string }) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS room_project_saga (
      operation_id TEXT PRIMARY KEY,
      state TEXT NOT NULL,
      client_request_key TEXT NOT NULL UNIQUE,
      room_id TEXT NOT NULL,
      expected_room_revision INTEGER NOT NULL,
      source_message_ids_json TEXT NOT NULL,
      project_id TEXT,
      projection_event_id TEXT,
      outcome TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  function prepare(input: {
    operationId: string;
    clientRequestKey: string;
    roomId: string;
    expectedRoomRevision: number;
    sourceMessageIds: string[];
  }): { ok: true; operation: RoomProjectSagaOperation } | { ok: false; code: string } {
    try {
      db.prepare(`
        INSERT INTO room_project_saga
          (operation_id, state, client_request_key, room_id, expected_room_revision, source_message_ids_json)
        VALUES (?, 'prepared', ?, ?, ?, ?)
      `).run(
        input.operationId,
        input.clientRequestKey,
        input.roomId,
        input.expectedRoomRevision,
        JSON.stringify(input.sourceMessageIds)
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('UNIQUE') && message.includes('client_request_key')) {
        return { ok: false, code: 'room_project_operation_duplicate' };
      }
      throw error;
    }
    const operation = get(input.operationId);
    return { ok: true, operation: operation! };
  }

  function get(operationId: string): RoomProjectSagaOperation | null {
    const row = db
      .prepare('SELECT * FROM room_project_saga WHERE operation_id = ?')
      .get(operationId) as unknown as SagaRow | undefined;
    return row ? mapRow(row) : null;
  }

  function transition(
    operationId: string,
    patch: { state?: RoomProjectSagaState; projectId?: string; projectionEventId?: string; outcome?: string }
  ): { ok: true; operation: RoomProjectSagaOperation } | { ok: false; code: string } {
    const current = get(operationId);
    if (!current) return { ok: false, code: 'room_project_operation_not_found' };
    db.prepare(`
      UPDATE room_project_saga
      SET state = ?, project_id = COALESCE(?, project_id),
          projection_event_id = COALESCE(?, projection_event_id),
          outcome = COALESCE(?, outcome),
          updated_at = CURRENT_TIMESTAMP
      WHERE operation_id = ?
    `).run(
      patch.state ?? current.state,
      toSQLValue(patch.projectId ?? null),
      toSQLValue(patch.projectionEventId ?? null),
      toSQLValue(patch.outcome ?? null),
      operationId
    );
    return { ok: true, operation: get(operationId)! };
  }

  function markProjectObserved(operationId: string, projectId: string) {
    return transition(operationId, { state: 'project_observed', projectId });
  }

  function markRoomEventObserved(operationId: string, projectionEventId: string) {
    return transition(operationId, { state: 'room_event_observed', projectionEventId });
  }

  function complete(operationId: string, options: { outcome?: string } = {}) {
    return transition(operationId, { state: 'completed', outcome: options.outcome });
  }

  function listUnfinished(): RoomProjectSagaOperation[] {
    const rows = db
      .prepare("SELECT * FROM room_project_saga WHERE state != 'completed' ORDER BY created_at")
      .all() as unknown as SagaRow[];
    return rows.map(mapRow);
  }

  return { prepare, get, markProjectObserved, markRoomEventObserved, complete, listUnfinished };
}
