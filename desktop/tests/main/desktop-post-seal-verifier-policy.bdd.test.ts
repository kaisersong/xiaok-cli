// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadVerifierContract, snapshotFixture } from '../fixtures/desktop-post-seal-verifier-contract.js';

describe('R4 verifier internal policy preserves existing host switches and plan priority', () => {
  const roots: string[] = [];
  afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3 }); });
  it.each([true, false, undefined])('artifactEvidence=%s gates only owner artifact IO, not Worker plan facts', async enabled => {
    const compiled = await loadVerifierContract(); roots.push(compiled.root);
    const file = join(compiled.root, 'saved.pdf'); writeFileSync(file, '%PDF-1.7');
    const snapshot = snapshotFixture({ prompt: '生成 PDF 文件', events: [
      { type: 'artifact_recorded', artifactId: 'saved', kind: 'pdf', label: 'Saved PDF', filePath: pathToFileURL(file).href, previewAvailable: false, turnId: 'turn' },
    ] });
    const raw: Promise<unknown>[] = [];
    const options = { signal: new AbortController().signal, deadline: performance.now() + 5000,
      artifactEvidence: enabled, trackPending: (promise: Promise<unknown>) => raw.push(promise) };
    const result = await new compiled.api.DeliveryVerifier().verify(snapshot, options);
    expect(result).toMatchObject({ planComplete: true, emptyDelivery: false });
    if (enabled === false) { expect(result).toHaveProperty('guard', undefined); expect(raw).toHaveLength(1); }
    else { expect(result).toHaveProperty('guard', expect.objectContaining({ ok: true })); expect(raw.length).toBeGreaterThan(1); }
    await Promise.allSettled(raw);
  });

  it.each([true, false, undefined])('incomplete plan with artifactEvidence=%s starts no artifact IO after the real Worker', async enabled => {
    const compiled = await loadVerifierContract(); roots.push(compiled.root);
    const file = join(compiled.root, 'saved.pdf'); writeFileSync(file, '%PDF-1.7');
    const snapshot = snapshotFixture({ prompt: '生成一份报告和一份演示文稿', events: [
      { type: 'artifact_recorded', artifactId: 'saved', kind: 'pdf', label: 'Saved PDF', filePath: pathToFileURL(file).href, previewAvailable: false, turnId: 'turn' },
      { type: 'progress_plan_reported', steps: [{ id: 'report', label: 'Report', status: 'completed' }, { id: 'slides', label: 'Slides', status: 'planned' }] },
    ] });
    const raw: Promise<unknown>[] = [];
    const options = { signal: new AbortController().signal, deadline: performance.now() + 5000,
      artifactEvidence: enabled, trackPending: (promise: Promise<unknown>) => raw.push(promise) };
    expect(await new compiled.api.DeliveryVerifier().verify(snapshot, options)).toMatchObject({ planComplete: false, guard: undefined });
    expect(raw).toHaveLength(1); await Promise.allSettled(raw);
  });
});
