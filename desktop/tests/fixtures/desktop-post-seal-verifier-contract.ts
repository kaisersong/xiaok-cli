import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { expect } from 'vitest';
import type { TaskSnapshot } from '../../../src/runtime/task-host/types.js';

export const taskHostDirectory = fileURLToPath(new URL('../../../src/runtime/task-host/', import.meta.url));
export interface DeliveryFactsFixture {
  version: 1; requestId: string; taskId: string; prompt: string; eventCount: number;
  eventFacts: Array<{ index: number; event: object }>;
  result?: { summary: string; artifacts: object[] };
}
export interface VerifierContract {
  buildDeliveryFactsV1(snapshot: TaskSnapshot, requestId: string): DeliveryFactsFixture;
  DeliveryVerifier: new () => { verify(snapshot: TaskSnapshot, options: {
    signal: AbortSignal; deadline: number; trackPending(raw: Promise<unknown>): void;
  }): Promise<unknown> };
}
export async function compileVerifierEntry(file: 'delivery-verifier-worker.ts' | 'delivery-verifier.ts') {
  const source = join(taskHostDirectory, file);
  expect(existsSync(source), `missing production fixed entry ${file}; downstream protocol assertions not yet executed`).toBe(true);
  const root = mkdtempSync(join(tmpdir(), 'xiaok-post-seal-compiled-'));
  const output = join(root, file.replace('.ts', '.mjs'));
  const result = await build({ entryPoints: [source], outfile: output, bundle: true, platform: 'node', format: 'esm', metafile: true });
  return { root, output, metafile: result.metafile! };
}
export async function loadVerifierContract() {
  const compiled = await compileVerifierEntry('delivery-verifier.ts');
  const worker = join(taskHostDirectory, 'delivery-verifier-worker.ts');
  expect(existsSync(worker), 'missing owned worker next to compiled verifier').toBe(true);
  await build({ entryPoints: [worker], outfile: join(compiled.root, 'delivery-verifier-worker.js'), bundle: true, platform: 'node', format: 'esm' });
  return { ...compiled, api: await import(/* @vite-ignore */ pathToFileURL(compiled.output).href) as VerifierContract };
}
export function snapshotFixture(patch: Partial<TaskSnapshot> = {}): TaskSnapshot {
  return { taskId: 'task-fixture', sessionId: 'session-fixture', status: 'running', prompt: 'Hello', materials: [], events: [],
    createdAt: 1, updatedAt: 2, ...patch };
}
export async function loadActualLegacyCollectors() {
  const sourcePath = join(taskHostDirectory, 'task-runtime-host.ts');
  const source = readFileSync(sourcePath, 'utf8');
  const root = mkdtempSync(join(tmpdir(), 'xiaok-post-seal-legacy-')); const output = join(root, 'actual.cjs');
  await build({ entryPoints: [sourcePath], outfile: output, bundle: true, platform: 'node', format: 'cjs', plugins: [{
    name: 'test-export-unmodified-production-functions', setup(context) {
      context.onLoad({ filter: /task-runtime-host\.ts$/ }, input => input.path === sourcePath ? {
        contents: source + '\nexport { buildCompletionEvidenceContext, evidenceForExpectation };', loader: 'ts', resolveDir: taskHostDirectory,
      } : undefined);
    },
  }] });
  return { root, actual: createRequire(import.meta.url)(output) as {
    buildCompletionEvidenceContext(id: string, snapshot: TaskSnapshot): { expectation?: unknown; evidence: unknown[] };
    evidenceForExpectation(expectation: unknown, evidence: unknown[]): unknown[];
  } };
}
