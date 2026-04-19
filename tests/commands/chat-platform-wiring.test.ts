import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('chat platform wiring', () => {
  it('wires plugins, teams, background runners, worktrees, MCP, and sandbox into chat runtime assembly', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'commands', 'chat.ts'), 'utf8');

    expect(source).toContain('createPlatformRuntimeContext');
    expect(source).toContain('createPlatformRegistryFactory');
    expect(source).toContain('notifyBackgroundJob');
    expect(source).toContain('platform.lspManager.getSummary()');
    expect(source).toContain('platform.dispose()');
    expect(source).toContain('buildCapabilityHealthNotice(platform.health)');
    expect(source).toContain('loadSettings(cwd)');
    expect(source).toContain('mergeRules(persistedPermissionSettings)');
    expect(source).toContain('extractSandboxAllowedPaths');
    expect(source).toContain('const persistedSandboxAllowedPaths = extractSandboxAllowedPaths(persistedPermissionRules.allowRules);');
    expect(source).toContain('platform.sandboxPolicy.expandAllowedPaths(persistedSandboxAllowedPaths);');
    expect(source).toContain('platform.sandboxPolicy.expandAllowedPaths(expandSandboxTargets(choice.rule, deniedPath));');
  });
});
