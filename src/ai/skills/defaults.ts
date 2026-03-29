import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function getBuiltinSkillRoots(): string[] {
  return [join(__dirname, '../../../data/skills')];
}
