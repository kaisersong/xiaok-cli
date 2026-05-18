import { describe, expect, it } from 'vitest';
import { validateHarnessManifest } from '../../src/quality/harness-manifest.js';

function validManifest() {
  return {
    schemaVersion: 1,
    changeId: '2026-05-18-ahe-lite-harness-optimization',
    title: 'AHE-lite MVP',
    components: ['trace', 'diagnoser', 'desktop-contract'],
    motivation: 'Make harness behavior observable and diagnosable.',
    expectedImpact: {
      reliability: 'positive',
      latency: 'neutral',
      tokenUsage: 'neutral',
      uxRisk: 'medium',
    },
    tests: ['npm run test:sandbox:run -- .test-dist/tests/runtime/trace/trace-bundle.test.js'],
    rollback: 'Disable trace export and hide diagnoser entry points.',
    reviews: {
      internal: 'docs/superpowers/specs/internal.md',
      qodercli: 'docs/superpowers/specs/qoder.md',
    },
  };
}

describe('harness manifest validation', () => {
  it('accepts a complete harness change manifest', () => {
    expect(validateHarnessManifest(validManifest())).toEqual({ ok: true });
  });

  it('rejects missing tests, rollback, and reviews', () => {
    const manifest = validManifest() as Record<string, unknown>;
    delete manifest.tests;
    delete manifest.rollback;
    delete manifest.reviews;

    expect(validateHarnessManifest(manifest)).toEqual({
      ok: false,
      errors: ['tests', 'rollback', 'reviews.internal', 'reviews.qodercli'],
    });
  });

  it('rejects unknown components and incomplete impact fields', () => {
    const manifest = validManifest();
    manifest.components = ['trace', 'unknown-component'];
    delete (manifest.expectedImpact as Record<string, unknown>).uxRisk;

    expect(validateHarnessManifest(manifest)).toEqual({
      ok: false,
      errors: ['components[1]:unknown-component', 'expectedImpact.uxRisk'],
    });
  });
});
