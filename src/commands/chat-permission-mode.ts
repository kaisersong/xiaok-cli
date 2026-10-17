import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PermissionMode } from '../ai/permissions/manager.js';
import { getConfigDir } from '../utils/config.js';
import { writeFileAtomicallySync } from '../utils/atomic-file.js';

export function isPermissionMode(value: unknown): value is PermissionMode {
  return value === 'default' || value === 'auto' || value === 'plan' || value === 'yolo';
}

function preferencePath(): string {
  return join(getConfigDir(), 'cli-permission-mode.json');
}

export function loadLastPermissionMode(): PermissionMode | null {
  try {
    const state = JSON.parse(readFileSync(preferencePath(), 'utf8'));
    return state?.version === 1 && isPermissionMode(state.mode) ? state.mode : null;
  } catch {
    return null;
  }
}

/** Save at the user action, not shutdown: an older process must not overwrite a later choice. */
export function saveLastPermissionMode(mode: PermissionMode): void {
  if (!isPermissionMode(mode)) throw new Error('invalid_permission_mode');
  writeFileAtomicallySync(preferencePath(), JSON.stringify({ version: 1, mode }) + '\n');
}

export function resolveInitialPermissionMode(
  options: { auto?: boolean; yolo?: boolean; interactive: boolean },
  saved: PermissionMode | null,
): PermissionMode {
  if (options.yolo) return 'yolo';
  if (options.auto || !options.interactive) return 'auto';
  return saved ?? 'default';
}
