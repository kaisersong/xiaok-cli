import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));
export function getBuiltinSkillRoots() {
    const cwdRoot = join(process.cwd(), 'data', 'skills');
    if (existsSync(cwdRoot)) {
        return [cwdRoot];
    }
    return [join(__dirname, '../../../data/skills')];
}
