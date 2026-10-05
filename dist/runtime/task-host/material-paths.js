import { posix, win32 } from 'node:path';
/** Platform path semantics, not a native custody or handle-identity proof. */
export function isMaterialPathInside(child, parent, platform = process.platform === 'win32' ? 'win32' : 'posix') {
    const api = platform === 'win32' ? win32 : posix;
    const rel = api.relative(parent, child);
    return rel === '' || (rel !== '..' && !rel.startsWith(`..${api.sep}`) && !api.isAbsolute(rel));
}
export function validateMaterialTaskId(value) {
    if (typeof value !== 'string' || !value || value === '.' || value === '..'
        || /[\\/:\0]/.test(value) || /[. ]$/.test(value)
        || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value))
        throw Error('material_task_path');
}
