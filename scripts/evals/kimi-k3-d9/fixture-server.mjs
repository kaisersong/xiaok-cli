const ATTESTATION_FIELDS = Object.freeze([
  'toolName',
  'canonicalArgs',
  'cwd',
  'nonce',
  'environmentDigest',
  'assignmentDigest',
]);

function fail(code) {
  throw new Error(code);
}

function exactAttestationMatches(expected, actual) {
  if (
    expected === null
    || actual === null
    || typeof expected !== 'object'
    || typeof actual !== 'object'
    || Object.keys(expected).length !== ATTESTATION_FIELDS.length
    || Object.keys(actual).length !== ATTESTATION_FIELDS.length
  ) {
    return false;
  }
  return ATTESTATION_FIELDS.every((field) =>
    typeof expected[field] === 'string' && actual[field] === expected[field]);
}

export function createFixtureGate(expectedAttestation) {
  if (!exactAttestationMatches(expectedAttestation, expectedAttestation)) {
    fail('KIMI_D9_FIXTURE_EXPECTATION_INVALID');
  }
  let accepted = false;
  const counters = {
    childSpawn: 0,
    network: 0,
    filesystemWrite: 0,
    externalIpc: 0,
    acceptedInvocation: 0,
  };
  return Object.freeze({
    invoke(actualAttestation) {
      if (!exactAttestationMatches(expectedAttestation, actualAttestation)) {
        fail('KIMI_D9_FIXTURE_ATTESTATION_MISMATCH');
      }
      if (accepted) {
        fail('KIMI_D9_FIXTURE_REPLAY');
      }
      const args = JSON.parse(actualAttestation.canonicalArgs);
      if (
        Object.keys(args).length !== 1
        || !Number.isSafeInteger(args.value)
      ) {
        fail('KIMI_D9_FIXTURE_ARGS_INVALID');
      }
      accepted = true;
      counters.acceptedInvocation = 1;
      return Object.freeze({ transformed: args.value * 3 });
    },
    counters() {
      return Object.freeze({ ...counters });
    },
  });
}

const ATTESTATION_SCHEMA = {
  nonce: z.string().regex(/^[0-9a-f]{64}$/u),
  environmentDigest: z.string().regex(/^[0-9a-f]{64}$/u),
  assignmentDigest: z.string().regex(/^[0-9a-f]{64}$/u),
};

export function createDeterministicMcpServer({ expectedInvocations }) {
  if (!Array.isArray(expectedInvocations)) {
    fail('KIMI_D9_FIXTURE_EXPECTATION_INVALID');
  }
  let invocationIndex = 0;
  let aggregateAccepted = 0;
  const server = new McpServer({
    name: 'd9_fixture',
    version: '1.0.0',
  });

  function invoke(toolName, args, deterministicArgs, result) {
    const expected = expectedInvocations[invocationIndex];
    if (!expected) {
      fail('KIMI_D9_FIXTURE_REPLAY');
    }
    const gate = createFixtureGate(expected);
    const actual = {
      toolName,
      canonicalArgs: canonicalJsonV1(deterministicArgs),
      cwd: process.cwd(),
      nonce: args.nonce,
      environmentDigest: args.environmentDigest,
      assignmentDigest: args.assignmentDigest,
    };
    gate.invoke(actual);
    aggregateAccepted += 1;
    invocationIndex += 1;
    return {
      content: [{
        type: 'text',
        text: canonicalJsonV1(result),
      }],
    };
  }

  server.registerTool('d9_fixture_echo', {
    description: 'Deterministically multiply the provided integer by three.',
    inputSchema: {
      value: z.number().int().safe(),
      ...ATTESTATION_SCHEMA,
    },
  }, async (args) => invoke(
    'd9_fixture_echo',
    args,
    { value: args.value },
    { transformed: args.value * 3 },
  ));

  server.registerTool('d9_fixture_accumulate', {
    description: 'Deterministically add two provided safe integers.',
    inputSchema: {
      left: z.number().int().safe(),
      right: z.number().int().safe(),
      ...ATTESTATION_SCHEMA,
    },
  }, async (args) => invoke(
    'd9_fixture_accumulate',
    args,
    { left: args.left, right: args.right },
    { total: args.left + args.right },
  ));

  return Object.freeze({
    server,
    counters: () => Object.freeze({
      childSpawn: 0,
      network: 0,
      filesystemWrite: 0,
      externalIpc: 0,
      acceptedInvocation: aggregateAccepted,
    }),
  });
}

export async function runStdioFixtureServerFromEnvironment() {
  let expectedInvocations;
  try {
    expectedInvocations = JSON.parse(process.env.KIMI_D9_EXPECTED_INVOCATIONS ?? '');
  } catch {
    fail('KIMI_D9_FIXTURE_EXPECTATION_INVALID');
  }
  const { server } = createDeterministicMcpServer({ expectedInvocations });
  await server.connect(new StdioServerTransport());
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  runStdioFixtureServerFromEnvironment().catch(() => {
    process.stderr.write('KIMI_D9_FIXTURE_SERVER_FAILED\n');
    process.exitCode = 1;
  });
}
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { canonicalJsonV1 } from '../../../dist/ai/runtime/canonical-json.js';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as z from 'zod/v4';
