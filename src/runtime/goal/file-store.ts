import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeFileAtomicallySync, type AtomicWriteFile } from '../../utils/atomic-file.js';
import type { GoalCommitInput, GoalDocument, GoalStore } from './types.js';

const GOAL_DOCUMENT_SCHEMA_VERSION = 1;

interface StoredGoalDocument extends GoalDocument {
  schemaVersion: typeof GOAL_DOCUMENT_SCHEMA_VERSION;
}

export class GoalTamperDetectedError extends Error {
  constructor(sessionId: string) {
    super(`Goal document tamper detected for session ${sessionId}`);
    this.name = 'GoalTamperDetectedError';
  }
}

export class FileGoalStore implements GoalStore {
  private readonly digests = new Map<string, string>();
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly rootDir: string,
    private readonly atomicWrite: AtomicWriteFile = writeFileAtomicallySync,
  ) {}

  async load(sessionId: string): Promise<GoalDocument | null> {
    const raw = this.readRaw(sessionId);
    if (raw === null) return null;
    if (!this.digests.has(sessionId)) {
      this.digests.set(sessionId, digest(raw));
    }
    return parseDocument(raw);
  }

  async commit(input: GoalCommitInput): Promise<void> {
    let release!: () => void;
    const previous = this.queue;
    this.queue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      await this.commitLocked(input);
    } finally {
      release();
    }
  }

  private async commitLocked(input: GoalCommitInput): Promise<void> {
    mkdirSync(this.rootDir, { recursive: true });
    const raw = this.readRaw(input.sessionId);
    const cachedDigest = this.digests.get(input.sessionId);
    if (cachedDigest !== undefined && raw !== null && digest(raw) !== cachedDigest) {
      throw new GoalTamperDetectedError(input.sessionId);
    }
    const current = raw === null ? null : parseDocument(raw);
    const revision = current?.state.revision ?? null;
    if (revision !== input.expectedRevision) {
      throw new Error(`stale goal revision: expected ${input.expectedRevision}, found ${revision}`);
    }
    const document: StoredGoalDocument = {
      schemaVersion: GOAL_DOCUMENT_SCHEMA_VERSION,
      state: structuredClone(input.next),
      events: [...(current?.events ?? []), ...structuredClone(input.events)],
      turns: [...(current?.turns ?? []), ...structuredClone(input.turns)],
      evidence: [...(current?.evidence ?? []), ...structuredClone(input.evidence)],
    };
    const nextRaw = JSON.stringify(document, null, 2);
    this.atomicWrite(this.filePath(input.sessionId), nextRaw);
    this.digests.set(input.sessionId, digest(nextRaw));
  }

  private readRaw(sessionId: string): string | null {
    const filePath = this.filePath(sessionId);
    return existsSync(filePath) ? readFileSync(filePath, 'utf8') : null;
  }

  private filePath(sessionId: string): string {
    return join(this.rootDir, `${sessionId}.goal.json`);
  }
}

function parseDocument(raw: string): GoalDocument {
  const parsed = JSON.parse(raw) as StoredGoalDocument;
  if (parsed.schemaVersion !== GOAL_DOCUMENT_SCHEMA_VERSION) {
    throw new Error(`Unsupported Goal document schema: ${String(parsed.schemaVersion)}`);
  }
  return {
    state: structuredClone(parsed.state),
    events: structuredClone(parsed.events ?? []),
    turns: structuredClone(parsed.turns ?? []),
    evidence: structuredClone(parsed.evidence ?? []),
  };
}

function digest(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}
