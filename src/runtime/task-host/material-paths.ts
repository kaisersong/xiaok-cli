import { posix, win32 } from 'node:path';
/** Platform path semantics, not a native custody or handle-identity proof. */
export function isMaterialPathInside(child: string, parent: string, platform: 'win32' | 'posix' = process.platform === 'win32' ? 'win32' : 'posix'): boolean {
  const api = platform === 'win32' ? win32 : posix;
  const rel = api.relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${api.sep}`) && !api.isAbsolute(rel));
}
export function validateMaterialTaskId(value: string): void {
  if (typeof value !== 'string' || !value || value === '.' || value === '..'
    || /[\\/:\0]/.test(value) || /[. ]$/.test(value)
    || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)) throw Error('material_task_path');
}
