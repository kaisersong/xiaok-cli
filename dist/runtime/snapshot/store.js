import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
export function getCheckpointRoot(projectRoot) {
    return join(projectRoot, '.xiaok', 'checkpoints');
}
export function getCheckpointDir(projectRoot, sessionId) {
    return join(getCheckpointRoot(projectRoot), sanitizePathPart(sessionId));
}
export function appendCheckpoint(projectRoot, checkpoint) {
    const root = getCheckpointRoot(projectRoot);
    mkdirSync(root, { recursive: true });
    appendFileSync(join(root, 'index.jsonl'), `${JSON.stringify(checkpoint)}\n`, 'utf8');
}
export function listCheckpoints(projectRoot) {
    const indexPath = join(getCheckpointRoot(projectRoot), 'index.jsonl');
    if (!existsSync(indexPath)) {
        return [];
    }
    return readFileSync(indexPath, 'utf8')
        .split('\n')
        .filter(Boolean)
        .flatMap((line) => {
        try {
            return [JSON.parse(line)];
        }
        catch {
            return [];
        }
    });
}
function sanitizePathPart(value) {
    return value.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'unknown';
}
