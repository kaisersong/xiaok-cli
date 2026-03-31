import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('yzj platform wiring', () => {
  it('wires platform runtime context and shared registry assembly into yzj sessions', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'commands', 'yzj.ts'), 'utf8');

    expect(source).toContain('createPlatformRuntimeContext');
    expect(source).toContain('createPlatformRegistryFactory');
    expect(source).toContain('pluginCommands: skillState.platform.pluginRuntime.commandDeclarations');
    expect(source).toContain('lspDiagnostics: skillState.platform.lspManager.getSummary()');
    expect(source).toContain('notifyBackgroundJob');
    expect(source).toContain('disposeSessionSkillCatalog');
    expect(source).toContain('platform.health.summary()');
    expect(source).toContain('new FileSessionBindingStore');
    expect(source).toContain('new FileChannelSessionStore');
    expect(source).toContain('new FileTaskStore');
    expect(source).toContain('new FileReplyTargetStore');
    expect(source).toContain('new FileYZJInboundDedupeStore');
    expect(source).toContain('formatBackgroundJobStatus');
    expect(source).toContain('formatSessionRuntimeSnapshot');
    expect(source).toContain('new FileCapabilityHealthStore');
  });
});
