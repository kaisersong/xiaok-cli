// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { DELIVERY_INPUT_LIMIT, DELIVERY_OUTPUT_LIMIT, encodeDeliveryFrame, validateDeliveryResponse, type DeliveryFactsV1, type DeliveryResponseV1 } from '../../../src/runtime/task-host/delivery-facts.js';
import { taskHostDirectory } from '../fixtures/desktop-post-seal-verifier-contract.js';
import { bounded } from '../fixtures/desktop-post-seal-harness.js';

// Instrument only the native Worker's root response serialization. This counts
// an actual production encoder call; it neither budgets nor derives any facts.
const banner = `
import { workerData as encodingProbeData } from 'node:worker_threads';
const encodingProbeCount = new Int32Array(encodingProbeData.rootEncodings);
const encodingProbeStringify = JSON.stringify;
JSON.stringify = function(value, ...args) {
  if (value && typeof value === 'object' && value.version === 1 && value.result?.kind === 'facts') {
    Atomics.add(encodingProbeCount, 0, 1);
  }
  return encodingProbeStringify.call(JSON, value, ...args);
};
`;
let root: string; let output: string;
beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'xiaok-post-seal-worker-encoding-'));
  output = join(root, 'delivery-verifier-worker.mjs');
  await build({ entryPoints: [join(taskHostDirectory, 'delivery-verifier-worker.ts')], outfile: output,
    bundle: true, platform: 'node', format: 'esm', banner: { js: banner } });
});
afterAll(() => { if (root) rmSync(root, { recursive: true, force: true, maxRetries: 3 }); });

describe('R4 actual fixed Worker checks total output before root JSON encoding', () => {
  it.each([65535, 65536, 65537])('fixed response exactly %i encoded bytes includes newline, UTF-8, JSON escapes and lone surrogates', size => {
    const request: DeliveryFactsV1 = { version: 1, requestId: randomUUID(), taskId: 'task-output-boundary', prompt: 'Explain',
      eventCount: 1, eventFacts: [{ index: 0, event: { type: 'result', result: { summary: 'answer' } } }] };
    const evidence = { ownerKind: 'task' as const, ownerId: request.taskId, kind: 'answer' as const,
      summary: '\0"\\中\uD800'.repeat(1000), metadata: { responseId: `${request.taskId}:result:0` } };
    const response: DeliveryResponseV1 = { version: 1, requestId: request.requestId,
      result: { kind: 'facts', planComplete: true, emptyDelivery: false,
        guard: { kind: 'evaluate', expectation: { ownerKind: 'task', ownerId: request.taskId,
          expectedKinds: ['answer'], source: 'legacy_classifier', confidence: 'inferred' }, evidence: [evidence] } } };
    const baseline = Buffer.byteLength(JSON.stringify(response) + '\n');
    evidence.summary += 'x'.repeat(size - baseline);
    expect(Buffer.byteLength(JSON.stringify(response) + '\n')).toBe(size);
    validateDeliveryResponse(response, request);
    const stringify = vi.spyOn(JSON, 'stringify');
    try {
      if (size <= DELIVERY_OUTPUT_LIMIT) expect(Buffer.byteLength(encodeDeliveryFrame(response, DELIVERY_OUTPUT_LIMIT))).toBe(size);
      else expect(() => encodeDeliveryFrame(response, DELIVERY_OUTPUT_LIMIT)).toThrow('validation_limit');
      expect(stringify.mock.calls.filter(args => args[0] === response)).toHaveLength(size <= DELIVERY_OUTPUT_LIMIT ? 1 : 0);
    } finally { stringify.mockRestore(); }
  });

  it.each([
    { name: 'ordinary 2 KiB canvas path', path: 'x'.repeat(2 * 1024), overLimit: false },
    { name: 'legal 30 KiB canvas path repeated by the real collector', path: 'x'.repeat(30 * 1024), overLimit: true },
    { name: 'legal escaped path whose three derived fields expand during JSON encoding', path: '\0'.repeat(10 * 1024), overLimit: true },
  ])('$name', async ({ path, overLimit }) => {
    const request: DeliveryFactsV1 = { version: 1, requestId: randomUUID(), taskId: 'task-encoding-boundary', prompt: '生成文件',
      eventCount: 1, eventFacts: [{ index: 0, event: { type: 'canvas_file_changed', filePath: path } }] };
    const frame = encodeDeliveryFrame(request, DELIVERY_INPUT_LIMIT);
    expect(Buffer.byteLength(frame)).toBeLessThanOrEqual(DELIVERY_INPUT_LIMIT);
    const counts = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
    const worker = new Worker(output, { workerData: { rootEncodings: counts }, stdout: true, stderr: true });
    const messages: unknown[] = []; const errors: Error[] = []; let stdioBytes = 0; let exited = false;
    worker.on('message', value => messages.push(value)); worker.on('error', error => errors.push(error));
    worker.stdout!.on('data', chunk => { stdioBytes += chunk.length; });
    worker.stderr!.on('data', chunk => { stdioBytes += chunk.length; });
    const exit = new Promise<number>(resolve => worker.once('exit', code => { exited = true; resolve(code); }));
    try {
      worker.postMessage(frame);
      expect(await bounded(exit)).toBe(0);
      expect(errors).toEqual([]); expect(stdioBytes).toBe(0); expect(messages).toHaveLength(1);
      expect(Buffer.byteLength(String(messages[0]))).toBeLessThanOrEqual(DELIVERY_OUTPUT_LIMIT);
      expect(JSON.parse(String(messages[0]))).toMatchObject({ version: 1, requestId: request.requestId,
        result: overLimit ? { kind: 'error', code: 'validation_limit' } : { kind: 'facts' } });
      expect(Atomics.load(new Int32Array(counts), 0), 'an over-budget derived root must never reach JSON.stringify').toBe(overLimit ? 0 : 1);
    } finally {
      if (!exited) await worker.terminate();
      await exit;
    }
  });
});
