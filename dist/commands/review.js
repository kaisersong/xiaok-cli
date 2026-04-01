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
async function readGitOutput(cwd, args) {
    try {
        const { stdout } = await execFileAsync('git', args, { cwd });
        return stdout.trim();
    }
    catch {
        return '';
    }
}
export async function runReviewCommand(cwd) {
    if (!(await isGitRepo(cwd))) {
        return '当前目录不是 Git 仓库，无法执行 /review。';
    }
    const status = await readGitOutput(cwd, ['status', '--short']);
    if (!status) {
        return '当前没有待评审改动。';
    }
    const staged = await readGitOutput(cwd, ['diff', '--cached', '--stat']);
    const unstaged = await readGitOutput(cwd, ['diff', '--stat']);
    return [
        '当前改动概览',
        '',
        '状态：',
        status,
        '',
        '暂存改动：',
        staged || '无',
        '',
        '未暂存改动：',
        unstaged || '无',
    ].join('\n');
}
export function registerReviewCommands(program) {
    program
        .command('review')
        .description('汇总当前工作区改动，生成本地评审概览')
        .action(async () => {
        const result = await runReviewCommand(process.cwd());
        console.log(result);
    });
}
