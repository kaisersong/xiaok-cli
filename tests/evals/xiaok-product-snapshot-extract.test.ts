import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

async function loadModule(): Promise<any> {
  return import(pathToFileURL(join(
    process.cwd(),
    'scripts/evals/_desktop-runtime/snapshot-extract.mjs',
  )).href);
}

function sampleSnapshot(): any {
  return {
    status: 'completed',
    events: [
      { type: 'assistant_text', text: 'hello', eventId: 'e1' },
      {
        type: 'artifact_recorded',
        artifactId: 'a1',
        kind: 'text',
        label: '报告',
        filePath: '/tmp/session/workspace/report.md',
        previewAvailable: false,
        turnId: 't1',
        creator: 'agent',
      },
      {
        type: 'artifact_recorded',
        artifactId: 'a2',
        kind: 'html',
        label: '空路径产物',
        filePath: '',
        previewAvailable: false,
        turnId: 't1',
      },
      {
        type: 'canvas_tool_call',
        toolName: 'write',
        input: { file_path: '/tmp/x.md' },
        toolUseId: 'u1',
        eventId: 'e2',
      },
      {
        type: 'canvas_tool_result',
        toolName: 'write',
        toolUseId: 'u1',
        ok: true,
        response: '{"success":true}',
        eventId: 'e3',
      },
      {
        type: 'canvas_tool_result',
        toolName: 'create_project',
        toolUseId: 'u2',
        ok: true,
        response: '{"error":"KSwarm service unavailable: down"}',
        eventId: 'e4',
      },
    ],
    // NOTE: no `result` field on purpose — events are the normative source (H2).
  };
}

describe('xiaok-product snapshot extraction', () => {
  it('extracts artifact filePaths from artifact_recorded events (events are normative)', async () => {
    const { extractSessionSignals } = await loadModule();
    const signals = extractSessionSignals(sampleSnapshot());
    expect(signals.status).toBe('completed');
    expect(signals.artifacts).toHaveLength(1);
    expect(signals.artifacts[0].filePath).toBe('/tmp/session/workspace/report.md');
    expect(signals.artifacts[0].kind).toBe('text');
  });

  it('treats empty-string filePath as missing', async () => {
    const { extractSessionSignals } = await loadModule();
    const signals = extractSessionSignals(sampleSnapshot());
    expect(signals.artifacts.some((a: any) => a.artifactId === 'a2')).toBe(false);
  });

  it('extracts tool invocations with toolName from canvas_tool_call/result', async () => {
    const { extractSessionSignals } = await loadModule();
    const signals = extractSessionSignals(sampleSnapshot());
    const names = signals.toolInvocations.map((t: any) => t.toolName);
    expect(names).toContain('write');
    expect(names).toContain('create_project');
    const call = signals.toolInvocations.find((t: any) => t.type === 'call');
    expect(call.toolName).toBe('write');
    const result = signals.toolInvocations.find(
      (t: any) => t.type === 'result' && t.toolName === 'create_project',
    );
    expect(typeof result.response).toBe('string');
  });

  it('does not require snapshot.result to exist', async () => {
    const { extractSessionSignals } = await loadModule();
    const snapshot = sampleSnapshot();
    expect('result' in snapshot).toBe(false);
    expect(() => extractSessionSignals(snapshot)).not.toThrow();
  });

  it('fails closed on malformed snapshots', async () => {
    const { extractSessionSignals } = await loadModule();
    expect(() => extractSessionSignals(null)).toThrow(/SNAPSHOT/i);
    expect(() => extractSessionSignals({ status: 'completed' })).toThrow(/SNAPSHOT/i);
  });
});
