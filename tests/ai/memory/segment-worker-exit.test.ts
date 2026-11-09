import { expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Use the emitted production module in a real process. No reset/terminate hook:
// teardown in the in-process segmentation tests masks an idle referenced port.
const moduleUrl = new URL('../../../src/ai/memory/segment.js', import.meta.url).href;

for (const scenario of ['prewarm-immediate', 'prewarm-ready', 'concurrent-cuts'] as const) {
  it(`${scenario} exits naturally without dropping awaited segmentation`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'xiaok-segment-exit-'));
    const entry = join(directory, 'probe.mjs');
    await writeFile(entry, `
      import {prewarmSegmentation, segmentationRuntimeInfo, segmentQueryAsync} from ${JSON.stringify(moduleUrl)};
      prewarmSegmentation();
      if (${JSON.stringify(scenario)} === 'prewarm-ready') {
        while (!segmentationRuntimeInfo().workerReady) {
          if (segmentationRuntimeInfo().failureReason) throw Error('native worker failed');
          await new Promise(resolve => setTimeout(resolve, 20));
        }
      }
      if (${JSON.stringify(scenario)} === 'concurrent-cuts') {
        const values = await Promise.all(Array.from({length: 12}, () => segmentQueryAsync('南京市长江大桥')));
        if (values.some(value => value !== '南京市 长江大桥')) throw Error(JSON.stringify(values));
      }
      if (!segmentationRuntimeInfo().workerEntry) throw Error('native worker missing');
      console.log('SEGMENT_EXIT_OK');
    `);
    const child = spawn(process.execPath, [entry], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', errors = '', timedOut = false;
    child.stdout.on('data', data => { output += String(data); });
    child.stderr.on('data', data => { errors += String(data); });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 15_000);
    try {
      const result = await new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code, signal) => resolve({ code, signal }));
      });
      expect(timedOut, `pid=${child.pid}\n${output}\n${errors}`).toBe(false);
      expect(result, errors).toEqual({ code: 0, signal: null });
      expect(output).toContain('SEGMENT_EXIT_OK');
    } finally {
      clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await new Promise<void>(resolve => child.once('close', () => resolve()));
      }
      await rm(directory, { recursive: true, force: true, maxRetries: 3 });
    }
  }, 20_000);
}
