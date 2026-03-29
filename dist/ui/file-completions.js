import { promises as fs } from 'fs';
import path from 'path';
import fg from 'fast-glob';
export class FileCompleter {
    cwd;
    cache = null;
    constructor(cwd) {
        this.cwd = cwd;
    }
    async scan() {
        if (this.cache)
            return this.cache;
        try {
            const files = await fg('**/*', {
                cwd: this.cwd,
                ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/.xiaok/**'],
                onlyFiles: true,
                suppressErrors: true,
            });
            this.cache = files.slice(0, 10_000).sort();
            return this.cache;
        }
        catch {
            return [];
        }
    }
    async getCompletions(partial) {
        const files = await this.scan();
        const lower = partial.toLowerCase();
        const matches = files
            .filter((f) => f.toLowerCase().startsWith(lower) || f.toLowerCase().includes('/' + lower))
            .slice(0, 15);
        return matches.map((f) => ({
            cmd: '@' + f,
            desc: path.extname(f).slice(1) || 'file',
        }));
    }
    invalidate() {
        this.cache = null;
    }
}
export async function resolveFileReferences(text, cwd) {
    const re = /@([\w.\/\\-]+[\w.])/g;
    const refs = [];
    let m;
    while ((m = re.exec(text)) !== null) {
        refs.push({ token: m[0], filePath: m[1] });
    }
    if (refs.length === 0)
        return text;
    let result = text;
    for (const ref of refs) {
        const resolved = path.resolve(cwd, ref.filePath);
        try {
            await fs.access(resolved);
            const content = await fs.readFile(resolved, 'utf-8');
            result = result.replace(ref.token, `\n\`\`\`${path.basename(resolved)}\n${content}\n\`\`\`\n`);
        }
        catch {
            // File doesn't exist, leave as-is
        }
    }
    return result;
}
