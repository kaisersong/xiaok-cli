import { spawnSync } from 'child_process';
export const grepTool = {
    permission: 'safe',
    definition: {
        name: 'grep',
        description: '在文件中搜索正则表达式，返回匹配行（含文件名和行号）',
        inputSchema: {
            type: 'object',
            properties: {
                pattern: { type: 'string', description: '正则表达式' },
                path: { type: 'string', description: '搜索目录或文件（可选，默认当前目录）' },
                glob: { type: 'string', description: '文件过滤 glob（可选，如 *.ts）' },
            },
            required: ['pattern'],
        },
    },
    async execute(input) {
        const { pattern, path: searchPath = process.cwd(), glob: fileGlob } = input;
        // 优先使用 rg（ripgrep），回退到 grep
        const hasRg = spawnSync('rg', ['--version'], { stdio: 'ignore' }).status === 0;
        const cmd = hasRg ? 'rg' : 'grep';
        const args = hasRg
            ? ['-n', '--color=never', ...(fileGlob ? ['-g', fileGlob] : []), pattern, searchPath]
            : ['-rn', pattern, ...(fileGlob ? ['--include', fileGlob] : []), searchPath];
        const result = spawnSync(cmd, args, { encoding: 'utf-8', maxBuffer: 1024 * 1024 });
        const output = (result.stdout ?? '').trim();
        if (!output)
            return '（无匹配结果）';
        return output;
    },
};
