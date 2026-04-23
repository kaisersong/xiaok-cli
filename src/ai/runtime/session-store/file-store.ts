import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Message } from '../../../types.js';
import { getConfigDir } from '../../../utils/config.js';
import type { SessionListEntry, SessionStore, PersistedSessionSnapshot } from './store.js';
import { cloneSessionIntentLedger, rekeySessionIntentLedger } from '../../../runtime/intent-delegation/types.js';
import { cloneSessionSkillEvalState } from '../../../runtime/intent-delegation/skill-eval.js';

const SESSION_SCHEMA_VERSION = 1;

interface PersistedSessionDocument extends PersistedSessionSnapshot {
  schemaVersion: typeof SESSION_SCHEMA_VERSION;
}

export class FileSessionStore implements SessionStore {
  constructor(private readonly rootDir = join(getConfigDir(), 'sessions')) {}

  createSessionId(): string {
    return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  async save(snapshot: PersistedSessionSnapshot): Promise<void> {
    mkdirSync(this.rootDir, { recursive: true });
    const document: PersistedSessionDocument = {
      schemaVersion: SESSION_SCHEMA_VERSION,
      ...snapshot,
    };
    writeFileSync(this.getFilePath(snapshot.sessionId), JSON.stringify(document, null, 2), 'utf-8');
    writeFileSync(join(this.rootDir, 'last_session'), snapshot.sessionId, 'utf-8');
  }

  async loadLast(): Promise<PersistedSessionSnapshot | null> {
    const lastFile = join(this.rootDir, 'last_session');
    if (!existsSync(lastFile)) return null;
    const sessionId = readFileSync(lastFile, 'utf-8').trim();
    return this.load(sessionId);
  }

  async load(sessionId: string): Promise<PersistedSessionSnapshot | null> {
    const filePath = this.getFilePath(sessionId);
    if (!existsSync(filePath)) {
      return null;
    }

    const raw = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<PersistedSessionDocument>;
    if (parsed.schemaVersion !== SESSION_SCHEMA_VERSION) {
      return null;
    }

    const {
      schemaVersion: _schemaVersion,
      ...snapshot
    } = parsed as PersistedSessionDocument;

    return {
      ...snapshot,
      lineage: snapshot.lineage ?? [snapshot.sessionId ?? sessionId].filter(Boolean),
      compactions: snapshot.compactions ?? [],
      memoryRefs: snapshot.memoryRefs ?? [],
      approvalRefs: snapshot.approvalRefs ?? [],
      backgroundJobRefs: snapshot.backgroundJobRefs ?? [],
      intentDelegation: snapshot.intentDelegation ? cloneSessionIntentLedger(snapshot.intentDelegation) : undefined,
      skillEval: snapshot.skillEval ? cloneSessionSkillEvalState(snapshot.skillEval) : undefined,
    } as PersistedSessionSnapshot;
  }

  async list(): Promise<SessionListEntry[]> {
    if (!existsSync(this.rootDir)) {
      return [];
    }

    const snapshots = readdirSync(this.rootDir)
      .filter((entry) => entry.endsWith('.json'))
      .map((entry) => this.load(entry.slice(0, -'.json'.length)));

    const loaded = (await Promise.all(snapshots)).filter((snapshot): snapshot is PersistedSessionSnapshot => Boolean(snapshot));

    return loaded
      .sort((left, right) => right.updatedAt - left.updatedAt)
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
      messages: cloneMessages(source.messages),
      usage: { ...source.usage },
      compactions: (source.compactions ?? []).map((compaction) => ({ ...compaction })),
      memoryRefs: [...(source.memoryRefs ?? [])],
      approvalRefs: [...(source.approvalRefs ?? [])],
      backgroundJobRefs: [...(source.backgroundJobRefs ?? [])],
      intentDelegation: source.intentDelegation ? rekeySessionIntentLedger(source.intentDelegation, nextSessionId) : undefined,
      skillEval: source.skillEval ? cloneSessionSkillEvalState(source.skillEval) : undefined,
    };
    await this.save(forked);
    return forked;
  }

  private getFilePath(sessionId: string): string {
    return join(this.rootDir, `${sessionId}.json`);
  }
}

export function createFileSessionStore(rootDir?: string): FileSessionStore {
  return new FileSessionStore(rootDir);
}

function cloneMessages(messages: Message[]): Message[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content.map((block) => ({ ...block })),
  }));
}

function getPreview(messages: Message[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const block = message.content.find((entry) => entry.type === 'text');
    if (block?.type === 'text') {
      return block.text;
    }
  }

  return '';
}
