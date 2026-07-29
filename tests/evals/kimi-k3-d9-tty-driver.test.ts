import { createHash } from 'node:crypto';
import {
  appendFile,
  mkdtemp,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

const roots: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(roots.splice(0).map(root =>
    rm(root, { recursive: true, force: true, maxRetries: 3 })));
});

async function loadTtyDriver(): Promise<any> {
  return import(pathToFileURL(join(
    process.cwd(),
    'scripts/evals/kimi-k3-d9/tty-driver.mjs',
  )).href);
}

function resultDigest(value: string): string {
  return createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex');
}

function resultFrame(result: string, previousResult: string | null): string {
  return `D9_RESULT_B64:${Buffer.from(JSON.stringify({
    result,
    previousResult,
  }), 'utf8').toString('base64url')}`;
}

describe('Kimi K3 D9 TTY observation', () => {
  it('waits for input_read_attach and exact capability-health MCP readiness', async () => {
    const { ReadinessGate } = await loadTtyDriver();
    const workspace = '/private/tmp/d9/workspace';
    const gate = new ReadinessGate({
      workspace,
      serverName: 'd9_fixture',
      expectedToolCount: 2,
    });
    gate.observeTranscript({ type: 'input_read_attach' });
    expect(gate.ready).toBe(false);
    gate.observeCapabilityHealth({
      schemaVersion: 1,
      entries: [{
        cwd: workspace,
        snapshot: {
          capabilities: [{
            kind: 'mcp',
            name: 'd9_fixture',
            status: 'connected',
            detail: '2 tools',
          }],
        },
      }],
    });
    expect(gate.ready).toBe(true);

    const degraded = new ReadinessGate({
      workspace,
      serverName: 'd9_fixture',
      expectedToolCount: 2,
    });
    expect(() => degraded.observeCapabilityHealth({
      schemaVersion: 1,
      entries: [{
        cwd: workspace,
        snapshot: {
          capabilities: [{
            kind: 'mcp',
            name: 'd9_fixture',
            status: 'degraded',
            detail: 'startup failed',
          }],
        },
      }],
    })).toThrow('KIMI_D9_MCP_READINESS_FAILED');
  });

  it('tails fragmented UTF-8 JSONL without duplicating or retaining unbounded partial rows', async () => {
    const { JsonlTailReader } = await loadTtyDriver();
    const root = await mkdtemp(join(tmpdir(), 'kimi-d9-jsonl-'));
    roots.push(root);
    const path = join(root, 'transcript.jsonl');
    const first = Buffer.from(`${JSON.stringify({
      type: 'output',
      normalized: '你好 D9_MARKER',
    })}\n`, 'utf8');
    await writeFile(path, first.subarray(0, first.length - 3));
    const reader = new JsonlTailReader(path, { maxPartialBytes: 1_024 });
    expect(await reader.readAvailable()).toEqual([]);
    await appendFile(path, first.subarray(first.length - 3));
    expect(await reader.readAvailable()).toEqual([{
      type: 'output',
      normalized: '你好 D9_MARKER',
    }]);
    expect(await reader.readAvailable()).toEqual([]);

    await appendFile(path, Buffer.alloc(1_025, 0x61));
    await expect(reader.readAvailable())
      .rejects.toThrow('KIMI_D9_JSONL_PARTIAL_LIMIT');
  });

  it('uses a pre-registered assistant marker and never spinner/tool activity as TTFV', async () => {
    const { TurnObservation } = await loadTtyDriver();
    const turn = new TurnObservation({
      marker: 'D9_ASSISTANT_7',
      validator: {
        kind: 'result-digest-v1',
        resultDigest: resultDigest('13'),
        previousResultDigest: resultDigest('8'),
      },
      submittedAtMs: 100,
    });
    turn.observe({ type: 'output', text: '⠋ Thinking', observedAtMs: 105 });
    turn.observe({ type: 'tool_started', observedAtMs: 109 });
    expect(turn.snapshot().ttfvMs).toBeNull();
    turn.observe({
      type: 'output',
      text: `D9_ASSISTANT_7 ${resultFrame('13', '8')} result`,
      observedAtMs: 125,
    });
    // Product transcript can become ready before the async trace bundle is visible.
    turn.observe({ type: 'input_read_attach', observedAtMs: 154 });
    turn.observe({ type: 'turn_completed', observedAtMs: 155 });

    expect(turn.snapshot()).toMatchObject({
      ttfvMs: 25,
      totalLatencyMs: 54,
      terminal: true,
      terminalStatus: 'completed',
      semanticPassed: true,
      continuityPassed: true,
    });

    const wrong = new TurnObservation({
      marker: 'D9_ASSISTANT_WRONG',
      validator: {
        kind: 'result-digest-v1',
        resultDigest: resultDigest('21'),
        previousResultDigest: resultDigest('13'),
      },
      submittedAtMs: 200,
    });
    wrong.observe({
      type: 'output',
      text: `D9_ASSISTANT_WRONG ${resultFrame('WRONG', 'ALSO_WRONG')}`,
      observedAtMs: 210,
    });
    wrong.observe({ type: 'input_read_attach', observedAtMs: 220 });
    wrong.observe({ type: 'turn_completed', observedAtMs: 221 });
    expect(wrong.snapshot()).toMatchObject({
      terminal: true,
      semanticPassed: false,
      continuityPassed: false,
    });
  });

  it('enforces an external monotonic timeout without waiting for a hung terminator', async () => {
    vi.useFakeTimers();
    const { withExternalTimeout } = await loadTtyDriver();
    const terminate = vi.fn(() => new Promise(() => {}));
    const work = new Promise(() => {});
    let rejection: unknown;
    void withExternalTimeout(work, {
      timeoutMs: 1_000,
      terminate,
    }).catch((error: unknown) => {
      rejection = error;
    });
    await vi.advanceTimersByTimeAsync(1_001);
    await Promise.resolve();
    expect(String(rejection)).toContain('KIMI_D9_PRODUCT_TIMEOUT');
    expect(terminate).toHaveBeenCalledTimes(1);
  });
});
