import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Message, UsageStats } from '../../types.js';
import { getConfigDir } from '../../utils/config.js';
import type { CompactionRecord } from './session.js';

const SESSION_SCHEMA_VERSION = 1;

export interface PersistedSessionSnapshot {
  sessionId: string;
  cwd: string;
  model?: string;
  createdAt: number;
  updatedAt: number;
  forkedFromSessionId?: string;
  lineage: string[];
  messages: Message[];
  usage: UsageStats;
  compactions: CompactionRecord[];
  promptSnapshotId?: string;
  memoryRefs: string[];
  approvalRefs: string[];
  backgroundJobRefs: string[];
}

interface PersistedSessionDocument extends PersistedSessionSnapshot {
  schemaVersion: typeof SESSION_SCHEMA_VERSION;
}

export interface SessionListEntry {
  sessionId: string;
  cwd: string;
  updatedAt: number;
  preview: string;
}

export class FileSessionStore {
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
    const forked: PersistedSessionSnapshot = {
      ...source,
      sessionId: this.createSessionId(),
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
    };
    await this.save(forked);
    return forked;
  }

  private getFilePath(sessionId: string): string {
    return join(this.rootDir, `${sessionId}.json`);
  }
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
