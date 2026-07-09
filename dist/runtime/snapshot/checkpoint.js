import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { promisify } from 'node:util';
import { appendCheckpoint, getCheckpointDir } from './store.js';
const execFileAsync = promisify(execFile);
const DEFAULT_MAX_FILES = 5000;
const MAX_FILE_SIZE_BYTES = 10_000_000;
export async function captureCheckpoint(projectRoot, sessionId, stageId, boundary, options = {}) {
    const id = createCheckpointId(sessionId, stageId, boundary);
    if (await isGitRepo(projectRoot)) {
        try {
            const { stdout } = await execFileAsync('git', ['stash', 'create'], { cwd: projectRoot });
            const stashHash = stdout.trim();
            if (stashHash) {
                const checkpoint = {
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
        }
        catch {
            // Fall back to file-copy below.
        }
    }
    const checkpoint = captureFileCopy(projectRoot, id, sessionId, stageId, boundary, options);
    appendCheckpoint(projectRoot, checkpoint);
    return checkpoint;
}
export async function revertToCheckpoint(projectRoot, checkpoint) {
    const safetySnapshot = await captureCheckpoint(projectRoot, checkpoint.sessionId, checkpoint.stageId, 'stage-start');
    try {
        if (checkpoint.method === 'git-stash') {
            await execFileAsync('git', ['checkout', '--', '.'], { cwd: projectRoot });
            await execFileAsync('git', ['stash', 'apply', checkpoint.ref], { cwd: projectRoot });
        }
        else {
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
    }
    catch (error) {
        return {
            success: false,
            safetySnapshot,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}
export async function diffCheckpoints(from, to) {
    const result = [];
    const allPaths = new Set([...Object.keys(from.files), ...Object.keys(to.files)]);
    for (const path of allPaths) {
        const fromHash = from.files[path];
        const toHash = to.files[path];
        if (!fromHash && toHash) {
            result.push({ path, status: 'added' });
        }
        else if (fromHash && !toHash) {
            result.push({ path, status: 'deleted' });
        }
        else if (fromHash !== toHash) {
            result.push({ path, status: 'modified' });
        }
    }
    return result;
}
async function isGitRepo(dir) {
    try {
        await execFileAsync('git', ['rev-parse', '--git-dir'], { cwd: dir });
        return true;
    }
    catch {
        return false;
    }
}
async function hashGitTracked(root) {
    const { stdout } = await execFileAsync('git', ['ls-files', '-z'], { cwd: root, encoding: 'buffer' });
    const files = {};
    for (const file of stdout.toString('utf8').split('\0').filter(Boolean)) {
        try {
            const content = readFileSync(join(root, file));
            files[toPortablePath(file)] = hashContent(content);
        }
        catch {
            continue;
        }
    }
    return files;
}
function captureFileCopy(projectRoot, id, sessionId, stageId, boundary, options) {
    const backupDir = join(getCheckpointDir(projectRoot, sessionId), id);
    mkdirSync(backupDir, { recursive: true });
    const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
    const files = {};
    const warnings = [];
    let copiedFiles = 0;
    let stopped = false;
    const walk = (dir) => {
        if (stopped)
            return;
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
function createCheckpointId(sessionId, stageId, boundary) {
    const random = Math.random().toString(36).slice(2, 6);
    return `${sessionId}-${stageId}-${boundary}-${Date.now()}-${random}`;
}
function hashContent(content) {
    return createHash('sha256').update(content).digest('hex').slice(0, 16);
}
function toPortablePath(path) {
    return path.split(sep).join('/');
}
function joinPath(root, portablePath) {
    return join(root, ...portablePath.split('/'));
}
