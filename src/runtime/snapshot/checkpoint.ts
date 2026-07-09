import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { promisify } from 'node:util';
import { appendCheckpoint, getCheckpointDir } from './store.js';

const execFileAsync = promisify(execFile);
const DEFAULT_MAX_FILES = 5000;
const MAX_FILE_SIZE_BYTES = 10_000_000;

export interface Checkpoint {
  id: string;
  sessionId: string;
  stageId: string;
  boundary: 'stage-start' | 'stage-end';
  method: 'git-stash' | 'file-copy';
  ref: string;
  files: Record<string, string>;
  capturedAt: string;
  warnings?: string[];
}

export interface CheckpointDiff {
  path: string;
  status: 'added' | 'deleted' | 'modified';
}

export interface CaptureCheckpointOptions {
  maxFiles?: number;
}

export async function captureCheckpoint(
  projectRoot: string,
  sessionId: string,
  stageId: string,
  boundary: Checkpoint['boundary'],
  options: CaptureCheckpointOptions = {},
): Promise<Checkpoint> {
  const id = createCheckpointId(sessionId, stageId, boundary);

  if (await isGitRepo(projectRoot)) {
    try {
      const { stdout } = await execFileAsync('git', ['stash', 'create'], { cwd: projectRoot });
      const stashHash = stdout.trim();
      if (stashHash) {
        const checkpoint: Checkpoint = {
          id,
          sessionId,
          stageId,
          boundary,
          method: 'git-stash',
          ref: stashHash,
          files: await hashGitTracked(projectRoot),
          capturedAt: new Date().toISOString(),
        };
        appendCheckpoint(projectRoot, checkpoint);
        return checkpoint;
      }
    } catch {
      // Fall back to file-copy below.
    }
  }

  const checkpoint = captureFileCopy(projectRoot, id, sessionId, stageId, boundary, options);
  appendCheckpoint(projectRoot, checkpoint);
  return checkpoint;
}

export async function revertToCheckpoint(
  projectRoot: string,
  checkpoint: Checkpoint,
): Promise<{ success: boolean; safetySnapshot?: Checkpoint; error?: string }> {
  const safetySnapshot = await captureCheckpoint(
    projectRoot,
    checkpoint.sessionId,
    checkpoint.stageId,
    'stage-start',
  );

  try {
    if (checkpoint.method === 'git-stash') {
      await execFileAsync('git', ['checkout', '--', '.'], { cwd: projectRoot });
      await execFileAsync('git', ['stash', 'apply', checkpoint.ref], { cwd: projectRoot });
    } else {
      for (const relPath of Object.keys(checkpoint.files)) {
        const src = joinPath(checkpoint.ref, relPath);
        if (!existsSync(src)) {
          continue;
        }
        const dest = joinPath(projectRoot, relPath);
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(src, dest);
      }
    }
    return { success: true, safetySnapshot };
  } catch (error) {
    return {
      success: false,
      safetySnapshot,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function diffCheckpoints(
  from: Checkpoint,
  to: Checkpoint,
): Promise<readonly CheckpointDiff[]> {
  const result: CheckpointDiff[] = [];
  const allPaths = new Set([...Object.keys(from.files), ...Object.keys(to.files)]);

  for (const path of allPaths) {
    const fromHash = from.files[path];
    const toHash = to.files[path];
    if (!fromHash && toHash) {
      result.push({ path, status: 'added' });
    } else if (fromHash && !toHash) {
      result.push({ path, status: 'deleted' });
    } else if (fromHash !== toHash) {
      result.push({ path, status: 'modified' });
    }
  }

  return result;
}

async function isGitRepo(dir: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['rev-parse', '--git-dir'], { cwd: dir });
    return true;
  } catch {
    return false;
  }
}

async function hashGitTracked(root: string): Promise<Record<string, string>> {
  const { stdout } = await execFileAsync('git', ['ls-files', '-z'], { cwd: root, encoding: 'buffer' });
  const files: Record<string, string> = {};
  for (const file of stdout.toString('utf8').split('\0').filter(Boolean)) {
    try {
      const content = readFileSync(join(root, file));
      files[toPortablePath(file)] = hashContent(content);
    } catch {
      continue;
    }
  }
  return files;
}

function captureFileCopy(
  projectRoot: string,
  id: string,
  sessionId: string,
  stageId: string,
  boundary: Checkpoint['boundary'],
  options: CaptureCheckpointOptions,
): Checkpoint {
  const backupDir = join(getCheckpointDir(projectRoot, sessionId), id);
  mkdirSync(backupDir, { recursive: true });

  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const files: Record<string, string> = {};
  const warnings: string[] = [];
  let copiedFiles = 0;
  let stopped = false;

  const walk = (dir: string): void => {
    if (stopped) return;
    for (const entry of readdirSync(dir).sort()) {
      if (entry === 'node_modules' || entry === '.git' || entry === '.xiaok') {
        continue;
      }
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!stat.isFile()) {
        continue;
      }
      if (copiedFiles >= maxFiles) {
        warnings.push(`file-copy checkpoint reached maxFiles=${maxFiles}; remaining files were skipped`);
        stopped = true;
        return;
      }
      if (stat.size > MAX_FILE_SIZE_BYTES) {
        warnings.push(`${toPortablePath(relative(projectRoot, fullPath))} skipped: file larger than 10MB`);
        continue;
      }

      const relPath = toPortablePath(relative(projectRoot, fullPath));
      const content = readFileSync(fullPath);
      files[relPath] = hashContent(content);
      const dest = joinPath(backupDir, relPath);
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(fullPath, dest);
      copiedFiles += 1;
    }
  };

  walk(projectRoot);

  return {
    id,
    sessionId,
    stageId,
    boundary,
    method: 'file-copy',
    ref: backupDir,
    files,
    capturedAt: new Date().toISOString(),
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

function createCheckpointId(sessionId: string, stageId: string, boundary: Checkpoint['boundary']): string {
  const random = Math.random().toString(36).slice(2, 6);
  return `${sessionId}-${stageId}-${boundary}-${Date.now()}-${random}`;
}

function hashContent(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

function toPortablePath(path: string): string {
  return path.split(sep).join('/');
}

function joinPath(root: string, portablePath: string): string {
  return join(root, ...portablePath.split('/'));
}
