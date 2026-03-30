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
