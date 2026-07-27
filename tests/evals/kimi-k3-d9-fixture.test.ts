import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';

async function loadFixtureModule(): Promise<any> {
  return import(pathToFileURL(join(
    process.cwd(),
    'scripts/evals/kimi-k3-d9/fixture-server.mjs',
  )).href);
}

describe('Kimi K3 D9 deterministic fixture gate', () => {
  const expected = {
    toolName: 'd9_deterministic_transform',
    canonicalArgs: '{"value":7}',
    cwd: '/private/tmp/d9-arm/workspace',
    nonce: '11'.repeat(32),
    environmentDigest: '22'.repeat(32),
    assignmentDigest: '33'.repeat(32),
  };

  it('rejects every identity mismatch before downstream side effects', async () => {
    const { createFixtureGate } = await loadFixtureModule();
    for (const field of Object.keys(expected)) {
      const gate = createFixtureGate(expected);
      const actual = { ...expected, [field]: `${expected[field as keyof typeof expected]}-bad` };
      expect(() => gate.invoke(actual)).toThrow('KIMI_D9_FIXTURE_ATTESTATION_MISMATCH');
      expect(gate.counters()).toEqual({
        childSpawn: 0,
        network: 0,
        filesystemWrite: 0,
        externalIpc: 0,
        acceptedInvocation: 0,
      });
    }
  });

  it('allows one exact invocation and returns only deterministic data', async () => {
    const { createFixtureGate } = await loadFixtureModule();
    const gate = createFixtureGate(expected);

    expect(gate.invoke(expected)).toEqual({ transformed: 21 });
    expect(gate.counters()).toEqual({
      childSpawn: 0,
      network: 0,
      filesystemWrite: 0,
      externalIpc: 0,
      acceptedInvocation: 1,
    });
    expect(() => gate.invoke(expected)).toThrow('KIMI_D9_FIXTURE_REPLAY');
  });

  it('exposes exactly two deterministic MCP tools over the real protocol', async () => {
    const { createDeterministicMcpServer } = await loadFixtureModule();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const { server, counters } = createDeterministicMcpServer({
      expectedInvocations: [{
        ...expected,
        toolName: 'd9_fixture_echo',
        cwd: process.cwd(),
      }],
    });
    const client = new Client({ name: 'd9-test-client', version: '1.0.0' });
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const listed = await client.listTools();
      expect(listed.tools.map(tool => tool.name).sort()).toEqual([
        'd9_fixture_accumulate',
        'd9_fixture_echo',
      ]);
      const result = await client.callTool({
        name: 'd9_fixture_echo',
        arguments: {
          value: 7,
          nonce: expected.nonce,
          environmentDigest: expected.environmentDigest,
          assignmentDigest: expected.assignmentDigest,
        },
      });
      expect(result.content).toEqual([{ type: 'text', text: '{"transformed":21}' }]);
      expect(counters()).toMatchObject({ acceptedInvocation: 1 });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
