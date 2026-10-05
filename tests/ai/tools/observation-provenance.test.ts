import { describe, expect, it } from 'vitest';
import { ToolRegistry } from '../../../src/ai/tools/index.js';
import { createNativeObservationProvenance, readFinalizedObservationProvenance } from '../../../src/runtime/sol-pi/observation-provenance.js';
import { mcpTestContext } from '../../support/mcp-cancellation-context.js';
import type { Tool } from '../../../src/types.js';
const tool: Tool = { permission: 'safe', definition: { name: 'native_test', description: 'native', inputSchema: { type: 'object', properties: {} } }, execute: async () => 'native' };
describe('actual registry records host result provenance', () => {
  async function run(contextText: string, getterThrows = false) {
    const port = createNativeObservationProvenance({ hostInvocationId: 'one', ownerGeneration: 0, nativePreview: 'native' });
    const registry = new ToolRegistry({ autoMode: true, hooksRunner: { runPreHooks: async () => ({ ok: true, additionalContext: contextText }), runPostHooks: async () => ['keep policy'], runHooks: async () => ({ ok: true }) } }, [tool]);
    try {
      const result = await registry.executeTool('native_test', {}, { ...mcpTestContext(new AbortController().signal), projectObservationResult: async value => value,
        observationProvenance: () => { if (getterThrows) throw Error('provenance-only-failure'); return port; } });
      return { result, receipt: port.finalizeHistory(result) };
    } finally { registry.dispose(); }
  }
  it('uses actual hook and warning append points and keeps separate provenance', async () => {
    const { result, receipt } = await run('policy'); expect(result).toBe('native\npolicy\nWarning: keep policy');
    expect(readFinalizedObservationProvenance(receipt)?.segments).toEqual({ before: '', native: 'native', after: '\npolicy\nWarning: keep policy' });
  });
  it('suffix-only registry cap invalidates provenance without rewriting tool outcome', async () => {
    const { result, receipt } = await run('p'.repeat(300000)); expect(result.startsWith('native')).toBe(true); expect(result).not.toMatch(/^Error:/); expect(receipt).toBeUndefined();
  });
  it('getter errors do not replace a successful native outcome or replay the tool', async () => {
    const { result, receipt } = await run('policy', true); expect(result).toBe('native\npolicy\nWarning: keep policy'); expect(receipt).toBeUndefined();
  });
});
