import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(__dirname, '../../electron/main.ts'), 'utf8');

describe('default assistant main lifecycle contract', () => {
  it('bootstraps the main-owned assistant and injects its runtime into the single scheduler owner', () => {
    expect(source).toContain('new AssistantService');
    expect(source).toContain('assistantService.bootstrap()');
    expect(source).toContain('createAssistantRuntime');
    expect(source).toContain('assistantRuntime,');
    expect(source).toContain('registerSemanticDesktopIpc');
  });

  it('keeps the semantic KSwarm credential and proposal model inside main', () => {
    expect(source).toContain('createKSwarmTeamService');
    expect(source).toContain('createKSwarmSemanticService');
    expect(source).toContain('createProjectCapabilityNeedsProposalPort');
  });

  it('reuses the existing DesktopServices knowledge store instead of opening a second database owner', () => {
    const servicesSource = readFileSync(join(__dirname, '../../electron/desktop-services.ts'), 'utf8');
    expect(servicesSource).toContain('getKnowledgeBaseStore()');
    expect(source).toContain('services.getKnowledgeBaseStore()');
  });
});
