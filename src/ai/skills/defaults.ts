import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function getBuiltinSkillRoots(): string[] {
  const cwdRoot = join(process.cwd(), 'data', 'skills');
  const candidates = [
    cwdRoot,
    ...((process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
      ? [join((process as NodeJS.Process & { resourcesPath: string }).resourcesPath, 'skills')]
      : []),
    join(__dirname, '../../../data/skills'),
    join(__dirname, '../../../../data/skills'),
  ].filter((candidate, index, all) => existsSync(candidate) && all.indexOf(candidate) === index);

  if (candidates.length > 0) {
    return candidates;
  }

  return [join(__dirname, '../../../data/skills')];
}

/** Packaged/source-owned skill roots; never consult the process working directory. */
export function getBundledSkillRoots(): string[] {
  return [
    ...((process as NodeJS.Process & {resourcesPath?:string}).resourcesPath
      ? [join((process as NodeJS.Process & {resourcesPath:string}).resourcesPath,'skills')] : []),
    join(__dirname,'../../../data/skills'),join(__dirname,'../../../../data/skills'),
  ].filter((candidate,index,all)=>existsSync(candidate)&&all.indexOf(candidate)===index);
}
