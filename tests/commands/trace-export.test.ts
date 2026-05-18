import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { registerTraceCommands, runTraceExportCommand } from '../../src/commands/trace-export.js';
import type { TraceBundleV1 } from '../../src/runtime/trace/schema.js';

function writeTrace(root: string): string {
  const bundle: TraceBundleV1 = {
    schemaVersion: 1,
    bundleId: 'trace_cmd_export',
    createdAt: '2026-05-18T00:00:00.000Z',
    source: { app: 'xiaok-cli' },
    scope: { kind: 'session', sessionId: 'sess-1' },
    environment: {},
    turns: [],
    events: [],
    toolCalls: [],
    approvals: [],
    tasks: [],
    agents: [],
    artifacts: [],
    memoryRefs: [],
    skillEvidence: [],
    recovery: [],
    crashes: [],
    redactions: [],
    attachments: [],
    summary: {},
  };
  const filePath = join(root, 'trace.json');
  writeFileSync(filePath, JSON.stringify(bundle), 'utf8');
  return filePath;
}

describe('trace export command', () => {
  it('registers trace export as a nested command', () => {
    const program = new Command();
    registerTraceCommands(program);

    const trace = program.commands.find((command) => command.name() === 'trace');
    expect(trace?.commands.map((command) => command.name())).toContain('export');
  });

  it('copies a valid trace bundle and refuses overwrite without force', async () => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-trace-export-command-'));
    mkdirSync(root, { recursive: true });
    const inputPath = writeTrace(root);
    const outputPath = join(root, 'out.json');

    await expect(runTraceExportCommand({ inputPath, outputPath })).resolves.toEqual(outputPath);
    expect(existsSync(outputPath)).toBe(true);
    expect(JSON.parse(readFileSync(outputPath, 'utf8'))).toMatchObject({ bundleId: 'trace_cmd_export' });

    await expect(runTraceExportCommand({ inputPath, outputPath })).rejects.toThrow(/already exists/);
    await expect(runTraceExportCommand({ inputPath, outputPath, force: true })).resolves.toEqual(outputPath);
  });
});
