import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  loadLastPermissionMode, saveLastPermissionMode, resolveInitialPermissionMode,
} from '../../src/commands/chat-permission-mode.js';

const roots: string[] = [];
function isolatedConfig() {
  const root = mkdtempSync(join(tmpdir(), 'xiaok-mode-state-')); roots.push(root);
  vi.stubEnv('XIAOK_CONFIG_DIR', root); return root;
}
afterEach(() => { vi.unstubAllEnvs(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3 }); });

describe('CLI last permission mode', () => {
  it.each(['default', 'auto', 'plan', 'yolo'] as const)('persists %s without touching model config or permission rules', mode => {
    const root = isolatedConfig();
    writeFileSync(join(root, 'config.json'), '{"syntheticModel":"unchanged"}');
    writeFileSync(join(root, 'settings.json'), '{"permissions":{"deny":["write(*)"]}}');
    saveLastPermissionMode(mode);
    expect(loadLastPermissionMode()).toBe(mode);
    expect(readFileSync(join(root, 'config.json'), 'utf8')).toBe('{"syntheticModel":"unchanged"}');
    expect(readFileSync(join(root, 'settings.json'), 'utf8')).toContain('write(*)');
    if (process.platform !== 'win32') expect(statSync(join(root, 'cli-permission-mode.json')).mode & 0o777).toBe(0o600);
  });
  it.each(['null', '[]', '{', '{"version":1,"mode":"YOLO"}', '{"version":2,"mode":"yolo"}'])('ignores malformed or unsupported state %s', text => {
    const root = isolatedConfig(); writeFileSync(join(root, 'cli-permission-mode.json'), text);
    expect(loadLastPermissionMode()).toBeNull();
    expect(resolveInitialPermissionMode({ interactive: true }, loadLastPermissionMode())).toBe('default');
  });
  it('isolates config directories and rejects unrecognized runtime values', () => {
    isolatedConfig(); expect(loadLastPermissionMode()).toBeNull(); saveLastPermissionMode('yolo');
    isolatedConfig(); expect(loadLastPermissionMode()).toBeNull();
    expect(() => saveLastPermissionMode('invalid' as any)).toThrow('invalid_permission_mode');
  });
  it('reports write failure without claiming the choice was saved', () => {
    const root = isolatedConfig(); writeFileSync(join(root, 'blocker'), 'synthetic');
    vi.stubEnv('XIAOK_CONFIG_DIR', join(root, 'blocker'));
    expect(() => saveLastPermissionMode('yolo')).toThrow();
  });
  it('gives explicit flags priority and keeps non-TTY default auto without saving or inheriting YOLO', () => {
    expect(resolveInitialPermissionMode({ interactive: true }, 'plan')).toBe('plan');
    expect(resolveInitialPermissionMode({ interactive: true, auto: true }, 'yolo')).toBe('auto');
    expect(resolveInitialPermissionMode({ interactive: true, yolo: true }, 'plan')).toBe('yolo');
    expect(resolveInitialPermissionMode({ interactive: false }, 'yolo')).toBe('auto');
    expect(resolveInitialPermissionMode({ interactive: false }, 'plan')).toBe('auto');
    expect(resolveInitialPermissionMode({ interactive: false, yolo: true }, 'plan')).toBe('yolo');
  });
});
