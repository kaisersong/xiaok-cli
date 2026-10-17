import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getConfigDir } from '../utils/config.js';
import { writeFileAtomicallySync } from '../utils/atomic-file.js';
export function isPermissionMode(value) {
    return value === 'default' || value === 'auto' || value === 'plan' || value === 'yolo';
}
function preferencePath() {
    return join(getConfigDir(), 'cli-permission-mode.json');
}
export function loadLastPermissionMode() {
    try {
        const state = JSON.parse(readFileSync(preferencePath(), 'utf8'));
        return state?.version === 1 && isPermissionMode(state.mode) ? state.mode : null;
    }
    catch {
        return null;
    }
}
/** Save at the user action, not shutdown: an older process must not overwrite a later choice. */
export function saveLastPermissionMode(mode) {
    if (!isPermissionMode(mode))
        throw new Error('invalid_permission_mode');
    writeFileAtomicallySync(preferencePath(), JSON.stringify({ version: 1, mode }) + '\n');
}
export function resolveInitialPermissionMode(options, saved) {
    if (options.yolo)
        return 'yolo';
    if (options.auto || !options.interactive)
        return 'auto';
    return saved ?? 'default';
}
