import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));
export function getBuiltinSkillRoots() {
    const cwdRoot = join(process.cwd(), 'data', 'skills');
    const candidates = [
        cwdRoot,
        join(__dirname, '../../../data/skills'),
        join(__dirname, '../../../../data/skills'),
    ].filter((candidate, index, all) => existsSync(candidate) && all.indexOf(candidate) === index);
    if (candidates.length > 0) {
        return candidates;
    }
    return [join(__dirname, '../../../data/skills')];
}
