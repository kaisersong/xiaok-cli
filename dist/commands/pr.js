import { execFile } from 'child_process';
import { promisify } from 'util';
import { getCurrentBranch, getRecentCommitSubjects } from '../utils/git.js';
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
async function readGitOutput(cwd, args) {
    try {
        const { stdout } = await execFileAsync('git', args, { cwd });
        return stdout.trim();
    }
    catch {
        return '';
    }
}
function buildPrBody(commits, diffStat) {
    const lines = ['## Summary'];
    if (commits.length > 0) {
        for (const subject of commits.slice(0, 3)) {
            lines.push(`- ${subject}`);
        }
    }
    else {
        lines.push('- Update branch changes');
    }
    lines.push('', '## Diffstat', diffStat || 'No diffstat available');
    return lines.join('\n');
}
export async function runPrCommand(cwd) {
    if (!(await isGitRepo(cwd))) {
        return '当前目录不是 Git 仓库，无法执行 /pr。';
    }
    const branch = await getCurrentBranch(cwd);
    if (!branch) {
        return '无法识别当前分支，无法执行 /pr。';
    }
    if (branch === 'main' || branch === 'master') {
        return '当前位于主分支，请切换到功能分支后再执行 /pr。';
    }
    const commits = await getRecentCommitSubjects(cwd, 5);
    const title = commits[0] || `chore: update ${branch}`;
    const diffStat = await readGitOutput(cwd, ['diff', '--stat']);
    const body = buildPrBody(commits, diffStat);
    try {
        const { stdout } = await execFileAsync('gh', ['pr', 'create', '--title', title, '--body', body], { cwd });
        const url = stdout.trim();
        return url ? `已创建 PR：${url}` : `已创建 PR：${title}`;
    }
    catch {
        return ['PR 预览', '', `Title: ${title}`, '', body, '', '未检测到 gh，未自动创建 PR。'].join('\n');
    }
}
export function registerPrCommands(program) {
    program
        .command('pr')
        .description('生成 PR 标题和正文，并在可用时调用 gh 创建 PR')
        .action(async () => {
        const result = await runPrCommand(process.cwd());
        console.log(result);
    });
}
