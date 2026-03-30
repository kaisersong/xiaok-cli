import { execFile } from 'child_process';
import { promisify } from 'util';
const execFileAsync = promisify(execFile);
export async function getCurrentBranch(cwd) {
    try {
        const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
        return stdout.trim();
    }
    catch {
        return '';
    }
}
export async function isGitDirty(cwd) {
    try {
        const { stdout } = await execFileAsync('git', ['status', '--short'], { cwd });
        return stdout.trim().length > 0;
    }
    catch {
        return false;
    }
}
export async function getRecentCommitSubjects(cwd, limit = 3) {
    try {
        const { stdout } = await execFileAsync('git', ['log', `-${limit}`, '--pretty=format:%s'], { cwd });
        return stdout
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean);
    }
    catch {
        return [];
    }
}
