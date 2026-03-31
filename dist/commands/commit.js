import { execFile } from 'child_process';
import { promisify } from 'util';
const execFileAsync = promisify(execFile);
async function isGitRepo(cwd) {
    try {
        await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd });
        return true;
    }
    catch {
        return false;
    }
}
async function getStagedFiles(cwd) {
    const { stdout } = await execFileAsync('git', ['diff', '--cached', '--name-only'], { cwd });
    return stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
}
function inferCommitMessage(files) {
    if (files.every((file) => file.endsWith('.md') || file.startsWith('docs/'))) {
        return 'docs: update documentation';
    }
    if (files.every((file) => file.startsWith('tests/'))) {
        return 'test: update coverage';
    }
    if (files.some((file) => file.startsWith('src/'))) {
        return 'feat: update workflow';
    }
    return 'chore: update staged files';
}
export async function runCommitCommand(cwd, message) {
    if (!(await isGitRepo(cwd))) {
        return '当前目录不是 Git 仓库，无法执行 /commit。';
    }
    const stagedFiles = await getStagedFiles(cwd);
    if (stagedFiles.length === 0) {
        return '没有已暂存的改动。请先执行 git add，再运行 /commit。';
    }
    const commitMessage = message?.trim() || inferCommitMessage(stagedFiles);
    await execFileAsync('git', ['commit', '-m', commitMessage], { cwd });
    return `已创建提交：${commitMessage}`;
}
