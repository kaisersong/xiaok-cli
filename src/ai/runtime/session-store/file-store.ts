import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { Message } from '../../../types.js';
import { getConfigDir } from '../../../utils/config.js';
import type {
  PersistedSessionSnapshot,
  SessionListEntry,
  SessionStore,
} from './store.js';
import {
  assertKimiK3DurableResumeSupported,
  toDurableSessionSnapshot,
} from './store.js';
import {
  cloneSessionIntentLedger,
  rekeySessionIntentLedger,
} from '../../../runtime/intent-delegation/types.js';
import { cloneSessionSkillEvalState } from '../../../runtime/intent-delegation/skill-eval.js';
import { cloneSessionSkillExecutionState } from '../../skills/execution-state.js';
import {
  writeFileAtomicallySync,
  type AtomicWriteFile,
} from '../../../utils/atomic-file.js';

const SESSION_SCHEMA_VERSION = 1;
interface PersistedSessionDocument extends PersistedSessionSnapshot {
  schemaVersion: typeof SESSION_SCHEMA_VERSION;
}

export class FileSessionStore implements SessionStore {
  constructor(
    private readonly rootDir = join(getConfigDir(), 'sessions'),
    private readonly atomicWrite: AtomicWriteFile = writeFileAtomicallySync,
  ) {}

  createSessionId(): string {
    return `sess_${randomUUID()}`;
  }

  async save(snapshot: PersistedSessionSnapshot): Promise<void> {
    this.ensureRoot();
    const durableSnapshot = toDurableSessionSnapshot(snapshot);
    const document: PersistedSessionDocument = {
      schemaVersion: SESSION_SCHEMA_VERSION,
      ...durableSnapshot,
    };
    this.atomicWrite(
      this.getFilePath(snapshot.sessionId),
      JSON.stringify(document, null, 2),
    );
    this.atomicWrite(
      join(this.rootDir, 'last_session'),
      snapshot.sessionId,
    );
  }

  async loadLast(): Promise<PersistedSessionSnapshot | null> {
    const lastFile = join(this.rootDir, 'last_session');
    if (existsSync(lastFile)) {
      try {
        const sessionId = readFileSync(lastFile, 'utf8').trim();
        if (sessionId) {
          const snapshot = this.readSnapshot(sessionId);
          if (snapshot) {
            return snapshot;
          }
        }
      } catch {}
    }
    return this.readSnapshots()
      .sort(compareSnapshots)
      .at(0) ?? null;
  }

  async load(sessionId: string): Promise<PersistedSessionSnapshot | null> {
    return this.readSnapshot(sessionId);
  }

  async list(): Promise<SessionListEntry[]> {
    if (!existsSync(this.rootDir)) {
      return [];
    }

    const snapshots = this.readSnapshots();

    return snapshots
      .sort(compareSnapshots)
      .map((snapshot) => ({
        sessionId: snapshot.sessionId,
        cwd: snapshot.cwd,
        updatedAt: snapshot.updatedAt,
        preview: getPreview(snapshot.messages),
      }));
  }

  async fork(sessionId: string): Promise<PersistedSessionSnapshot> {
    const source = await this.load(sessionId);
    if (!source) {
      throw new Error(`session not found: ${sessionId}`);
    }
    assertKimiK3DurableResumeSupported(source);

    const now = Date.now();
    const sourceLineage = source.lineage ?? [source.sessionId];
    const lineage = sourceLineage.at(-1) === source.sessionId
      ? [...sourceLineage]
      : [...sourceLineage, source.sessionId];
    const nextSessionId = this.createSessionId();
    const forked: PersistedSessionSnapshot = {
      ...source,
      sessionId: nextSessionId,
      createdAt: now,
      updatedAt: now,
      forkedFromSessionId: source.sessionId,
      lineage,
      messages: structuredClone(source.messages),
      usage: { ...source.usage },
      compactions: (source.compactions ?? []).map((compaction) => ({
        ...compaction,
      })),
      memoryRefs: [...(source.memoryRefs ?? [])],
      approvalRefs: [...(source.approvalRefs ?? [])],
      backgroundJobRefs: [...(source.backgroundJobRefs ?? [])],
      intentDelegation: source.intentDelegation
        ? rekeySessionIntentLedger(source.intentDelegation, nextSessionId)
        : undefined,
      skillEval: source.skillEval
        ? cloneSessionSkillEvalState(source.skillEval)
        : undefined,
      skillExecution: source.skillExecution
        ? cloneSessionSkillExecutionState(source.skillExecution)
        : undefined,
    };
    await this.save(forked);
    return forked;
  }

  private readSnapshot(sessionId: string): PersistedSessionSnapshot | null {
    const filePath = this.getFilePath(sessionId);
    if (!existsSync(filePath)) {
      return null;
    }

    const parsed = JSON.parse(
      readFileSync(filePath, 'utf8'),
    ) as Partial<PersistedSessionDocument>;
    if (parsed.schemaVersion !== SESSION_SCHEMA_VERSION) {
      return null;
    }

    const {
      schemaVersion: _schemaVersion,
      ...snapshot
    } = parsed as PersistedSessionDocument;
    return {
      ...snapshot,
      lineage: snapshot.lineage
        ?? [snapshot.sessionId ?? sessionId].filter(Boolean),
      compactions: snapshot.compactions ?? [],
      memoryRefs: snapshot.memoryRefs ?? [],
      approvalRefs: snapshot.approvalRefs ?? [],
      backgroundJobRefs: snapshot.backgroundJobRefs ?? [],
      intentDelegation: snapshot.intentDelegation
        ? cloneSessionIntentLedger(snapshot.intentDelegation)
        : undefined,
      skillEval: snapshot.skillEval
        ? cloneSessionSkillEvalState(snapshot.skillEval)
        : undefined,
      skillExecution: snapshot.skillExecution
        ? cloneSessionSkillExecutionState(snapshot.skillExecution)
        : undefined,
    } as PersistedSessionSnapshot;
  }

  private getFilePath(sessionId: string): string {
    return join(this.rootDir, `${sessionId}.json`);
  }

  private ensureRoot(): void {
    mkdirSync(this.rootDir, { recursive: true });
  }

  private readSnapshots(): PersistedSessionSnapshot[] {
    if (!existsSync(this.rootDir)) {
      return [];
    }
    return readdirSync(this.rootDir)
      .filter((entry) => entry.endsWith('.json'))
      .map((entry) => {
        const sessionId = entry.slice(0, -'.json'.length);
        try {
          return this.readSnapshot(sessionId);
        } catch {
          return null;
        }
      })
      .filter(
        (snapshot): snapshot is PersistedSessionSnapshot => snapshot !== null,
      );
  }
}

export function createFileSessionStore(rootDir?: string): FileSessionStore {
  return new FileSessionStore(rootDir);
}

function getPreview(messages: Message[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const block = message.content.find((entry) => entry.type === 'text');
    if (block?.type === 'text') {
      return block.text.slice(0, 120);
    }
  }
  return '';
}

function compareSnapshots(
  left: PersistedSessionSnapshot,
  right: PersistedSessionSnapshot,
): number {
  return right.updatedAt - left.updatedAt
    || left.sessionId.localeCompare(right.sessionId);
}
