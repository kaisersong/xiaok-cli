import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { registerTraceCommands, runTraceExportCommand } from '../../src/commands/trace-export.js';
import type { TraceBundleV1 } from '../../src/runtime/trace/schema.js';
import type { TaskSnapshot } from '../../src/runtime/task-host/types.js';

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

  it('builds a session trace from persisted desktop task snapshots', async () => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-trace-export-session-'));
    const dataRoot = join(root, 'desktop-data');
    const snapshotDir = join(dataRoot, 'tasks', 'snapshots');
    mkdirSync(snapshotDir, { recursive: true });
    const artifactPath = join(root, 'report.md');
    writeFileSync(artifactPath, 'deliverable');
    const snapshot: TaskSnapshot = {
      taskId: 'task-1',
      sessionId: 'sess-1',
      status: 'completed',
      prompt: 'write a report',
      materials: [],
      events: [
        { type: 'task_started', taskId: 'task-1' },
        { type: 'canvas_tool_call', toolName: 'Write', input: { file_path: artifactPath }, toolUseId: 'tool-1', eventId: 'event-1', ts: 1 },
        { type: 'canvas_tool_result', toolName: 'Write', toolUseId: 'tool-1', ok: true, response: 'ok', eventId: 'event-2', ts: 2 },
        { type: 'artifact_recorded', artifactId: 'artifact-1', kind: 'text', label: 'Report', filePath: artifactPath, previewAvailable: true, turnId: 'turn-1' },
        { type: 'result', result: { summary: 'done', artifacts: [{ artifactId: 'artifact-1', kind: 'text', title: 'Report', createdAt: '2026-05-18T00:00:00.000Z', previewAvailable: true, filePath: artifactPath }] } },
      ],
      createdAt: 1,
      updatedAt: 2,
    };
    writeFileSync(join(snapshotDir, 'task-1.json'), JSON.stringify(snapshot, null, 2), 'utf8');
    const outputPath = join(root, 'session-trace.json');

    await expect(runTraceExportCommand({ sessionId: 'sess-1', dataRoot, outputPath })).resolves.toEqual(outputPath);

    const exported = JSON.parse(readFileSync(outputPath, 'utf8')) as TraceBundleV1;
    expect(exported.scope).toMatchObject({ kind: 'session', sessionId: 'sess-1' });
    expect(exported.tasks).toEqual([expect.objectContaining({ id: 'task-1', status: 'done' })]);
    expect(exported.toolCalls).toEqual([expect.objectContaining({ id: 'tool-1', name: 'Write', ok: true })]);
    expect(exported.artifacts).toEqual([expect.objectContaining({ id: 'artifact-1', existsAtExport: true })]);
  });

  it('builds a project trace from a KSwarm full-detail snapshot', async () => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-trace-export-project-'));
    const detailPath = join(root, 'project-detail.json');
    writeFileSync(detailPath, JSON.stringify({
      project: { id: 'proj-1', name: '技术大会演讲报告', status: 'active' },
      tasks: [{ id: 'item-6', title: '结构评审', status: 'blocked', blockedReason: '结构评审缺少证据' }],
      agents: [{ id: 'agent-1', name: 'Worker', status: 'idle' }],
      dispatchPlan: { blocked: [{ taskId: 'item-6', reason: 'missing_review_evidence' }] },
      projectHealth: { status: 'blocked', primaryBlockedTaskId: 'item-6', message: '结构评审缺少证据' },
    }), 'utf8');
    const outputPath = join(root, 'project-trace.json');

    await expect(runTraceExportCommand({ projectId: 'proj-1', projectDetailPath: detailPath, outputPath })).resolves.toEqual(outputPath);

    const exported = JSON.parse(readFileSync(outputPath, 'utf8')) as TraceBundleV1;
    expect(exported.scope).toMatchObject({ kind: 'project', projectId: 'proj-1' });
    expect(exported.summary).toMatchObject({ projectStatus: 'active', projectHealth: 'blocked' });
    expect(exported.events.map((event) => event.type)).toContain('kswarm.project_health');
  });
});
