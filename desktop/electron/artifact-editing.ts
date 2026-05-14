/**
 * Artifact Live Editing — Main Process Module
 *
 * Handles:
 * - File backup before Agent modifications
 * - IPC notification to renderer when artifact files change
 * - Session management (file path → session hash)
 */

import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  unlinkSync,
  rmSync,
  watch,
  type FSWatcher,
} from 'node:fs';

// --- Session Management ---

export function sessionHash(filePath: string): string {
  return createHash('sha256').update(filePath).digest('hex').slice(0, 16);
}

// --- File Backup ---

const MAX_BACKUPS = 5;

function backupDir(sessionId: string, baseDir?: string): string {
  const root = baseDir ?? join(homedir(), '.xiaok');
  return join(root, 'artifact-backups', sessionId);
}

export function backupArtifact(filePath: string, sessionId: string, baseDir?: string): string | null {
  if (!existsSync(filePath)) return null;

  const dir = backupDir(sessionId, baseDir);
  mkdirSync(dir, { recursive: true });

  const timestamp = Date.now();
  const backupPath = join(dir, `${timestamp}.html`);
  copyFileSync(filePath, backupPath);

  // FIFO eviction
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.html'))
    .sort();
  while (files.length > MAX_BACKUPS) {
    const oldest = files.shift()!;
    unlinkSync(join(dir, oldest));
  }

  return backupPath;
}

export function revertArtifact(filePath: string, sessionId: string, baseDir?: string): boolean {
  const dir = backupDir(sessionId, baseDir);
  if (!existsSync(dir)) return false;

  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.html'))
    .sort();
  if (files.length === 0) return false;

  const latest = files[files.length - 1];
  const backupContent = readFileSync(join(dir, latest), 'utf8');
  writeFileSync(filePath, backupContent, 'utf8');
  // Remove the used backup
  unlinkSync(join(dir, latest));
  return true;
}

export function cleanupBackups(sessionId: string, baseDir?: string): void {
  const dir = backupDir(sessionId, baseDir);
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- File Watcher (fallback for external modifications) ---

const watchers = new Map<string, FSWatcher>();

export function watchArtifactFile(
  filePath: string,
  onChange: () => void,
): () => void {
  if (watchers.has(filePath)) return () => unwatchArtifactFile(filePath);

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const watcher = watch(filePath, () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(onChange, 500);
  });

  watchers.set(filePath, watcher);
  return () => unwatchArtifactFile(filePath);
}

export function unwatchArtifactFile(filePath: string): void {
  const watcher = watchers.get(filePath);
  if (watcher) {
    watcher.close();
    watchers.delete(filePath);
  }
}

// --- Session State Persistence ---

export interface ArtifactSession {
  filePath: string;
  sessionId: string;
  state: 'preview' | 'annotating' | 'submitted' | 'timeout_idle' | 'reviewing' | 'done';
  createdAt: number;
}

function sessionsDir(baseDir?: string): string {
  const root = baseDir ?? join(homedir(), '.xiaok');
  return join(root, 'artifact-sessions');
}

export function saveSession(session: ArtifactSession, baseDir?: string): void {
  const dir = sessionsDir(baseDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${session.sessionId}.json`),
    JSON.stringify(session, null, 2),
  );
}

export function loadSession(sessionId: string, baseDir?: string): ArtifactSession | null {
  const path = join(sessionsDir(baseDir), `${sessionId}.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

export function deleteSession(sessionId: string, baseDir?: string): void {
  const path = join(sessionsDir(baseDir), `${sessionId}.json`);
  if (existsSync(path)) unlinkSync(path);
}
