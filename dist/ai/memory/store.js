import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getConfigDir } from '../../utils/config.js';
export class FileMemoryStore {
    rootDir;
    constructor(rootDir = join(getConfigDir(), 'memory')) {
        this.rootDir = rootDir;
    }
    async save(record) {
        await mkdir(this.rootDir, { recursive: true });
        await writeFile(join(this.rootDir, `${record.id}.json`), JSON.stringify(record, null, 2) + '\n', 'utf8');
    }
    async listRelevant(input) {
        if (!existsSync(this.rootDir)) {
            return [];
        }
        const files = (await readdir(this.rootDir)).filter((entry) => entry.endsWith('.json'));
        const records = await Promise.all(files.map(async (entry) => JSON.parse(await readFile(join(this.rootDir, entry), 'utf8'))));
        return records
            .filter((record) => record.scope === 'global' || record.cwd === input.cwd)
            .sort((left, right) => {
            const leftMatches = Number(left.title.includes(input.query)
                || left.summary.includes(input.query)
                || left.tags.some((tag) => tag.includes(input.query)));
            const rightMatches = Number(right.title.includes(input.query)
                || right.summary.includes(input.query)
                || right.tags.some((tag) => tag.includes(input.query)));
            return rightMatches - leftMatches || right.updatedAt - left.updatedAt;
        });
    }
}
