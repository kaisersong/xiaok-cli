import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Checkpoint } from './checkpoint.js';

export function getCheckpointRoot(projectRoot: string): string {
  return join(projectRoot, '.xiaok', 'checkpoints');
}

export function getCheckpointDir(projectRoot: string, sessionId: string): string {
  return join(getCheckpointRoot(projectRoot), sanitizePathPart(sessionId));
}

export function appendCheckpoint(projectRoot: string, checkpoint: Checkpoint): void {
  const root = getCheckpointRoot(projectRoot);
  mkdirSync(root, { recursive: true });
  appendFileSync(join(root, 'index.jsonl'), `${JSON.stringify(checkpoint)}\n`, 'utf8');
}

export function listCheckpoints(projectRoot: string): Checkpoint[] {
  const indexPath = join(getCheckpointRoot(projectRoot), 'index.jsonl');
  if (!existsSync(indexPath)) {
    return [];
  }

  return readFileSync(indexPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as Checkpoint];
      } catch {
        return [];
      }
    });
}

function sanitizePathPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'unknown';
}
