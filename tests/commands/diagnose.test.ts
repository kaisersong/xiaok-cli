import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { registerDiagnoseCommands, runDiagnoseTraceCommand } from '../../src/commands/diagnose.js';
import type { TraceBundleV1 } from '../../src/runtime/trace/schema.js';

function writeBlockedTrace(root: string): string {
  const bundle: TraceBundleV1 = {
    schemaVersion: 1,
    bundleId: 'trace_cmd_diag',
    createdAt: '2026-05-18T00:00:00.000Z',
    source: { app: 'kswarm' },
    scope: { kind: 'project', projectId: 'proj-1' },
    environment: {},
    turns: [],
    events: [],
    toolCalls: [],
    approvals: [],
    tasks: [{ id: 'item-6', title: '评审', status: 'blocked', blockedReason: 'missing_review_evidence' }],
    agents: [{ id: 'agent-1', status: 'idle' }],
    artifacts: [],
    memoryRefs: [],
    skillEvidence: [],
    recovery: [],
    crashes: [],
    redactions: [],
    attachments: [],
    summary: { projectStatus: 'active' },
  };
  const filePath = join(root, 'trace.json');
  writeFileSync(filePath, JSON.stringify(bundle), 'utf8');
  return filePath;
}

describe('diagnose command', () => {
  it('registers the top-level diagnose command', () => {
    const program = new Command();
    registerDiagnoseCommands(program);

    expect(program.commands.map((command) => command.name())).toContain('diagnose');
  });

  it('diagnoses trace bundles as json and markdown', async () => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-diagnose-command-'));
    mkdirSync(root, { recursive: true });
    const tracePath = writeBlockedTrace(root);

    const json = await runDiagnoseTraceCommand({ tracePath, format: 'json' });
    expect(JSON.parse(json)).toMatchObject({
      health: 'blocked',
      primaryFinding: { category: 'blocked_task' },
    });

    const markdown = await runDiagnoseTraceCommand({ tracePath, format: 'markdown' });
    expect(markdown).toContain('## 主要问题');
    expect(markdown).toContain('item-6');
  });
});
