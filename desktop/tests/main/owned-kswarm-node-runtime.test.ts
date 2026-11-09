// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { probeOwnedNodeExecutable } from '../support/owned-kswarm-node-runtime.mjs';

const canonical = vi.hoisted(() => ({ link: '', target: '' }));
vi.mock('node:fs', async original => {
  const actual = await original<typeof import('node:fs')>();
  return { ...actual, realpathSync(...args: Parameters<typeof actual.realpathSync>) {
    if (args[0] === canonical.link) return canonical.target;
    return actual.realpathSync(...args);
  } };
});

const key = 'XIAOK_WORKFLOW_TEST_KSWARM_NODE_EXECUTABLE';
const original = process.env[key];
afterEach(() => {
  canonical.link = '';
  canonical.target = '';
  if (original === undefined) delete process.env[key];
  else process.env[key] = original;
});

it('keeps the default executable and actual version of the unchanged client', () => {
  delete process.env[key];
  const fact = probeOwnedNodeExecutable();
  expect(fact.executable).toBe(realpathSync(process.execPath));
  expect(fact.nodeVersion).toBe(process.versions.node);
  expect(fact.probePid).toBeGreaterThan(0);
});

it('gives an explicit absolute executable precedence over the test-only environment', () => {
  process.env[key] = join(tmpdir(), 'missing-ks-node', 'node');
  const fact = probeOwnedNodeExecutable(process.execPath);
  expect(fact.executable).toBe(realpathSync(process.execPath));
  expect(fact.nodeVersion).toBe(process.versions.node);
});

it('uses the separately prepared real Node through the test-only environment', () => {
  const selected = original ?? process.execPath;
  process.env[key] = selected;
  const fact = probeOwnedNodeExecutable();
  expect(fact.executable).toBe(realpathSync(selected));
  expect(fact.nodeVersion).toMatch(/^\d+\.\d+\.\d+$/);
  console.info(JSON.stringify({ fixture: 'split-client-ks-node', clientNodeVersion: process.versions.node,
    clientExecutable: process.execPath, childExecutable: fact.executable, preflightNodeVersion: fact.nodeVersion }));
});

it.each(['', 'node', join(tmpdir(), 'node.cmd')])('rejects a non-absolute or cmd shim executable before spawning: %s', executable => {
  expect(() => probeOwnedNodeExecutable(executable)).toThrow('owned_kswarm_node_executable_required');
});

it('preserves the real missing-executable filesystem error', () => {
  let failure: unknown;
  try { probeOwnedNodeExecutable(join(tmpdir(), 'missing-ks-node', 'node')); }
  catch (error) { failure = error; }
  expect(failure).toMatchObject({ code: 'ENOENT' });
});

it('rejects a canonical cmd target before the Node probe can spawn it', () => {
  // Only this realpath result is faulted; positive probes still execute Node.
  canonical.link = join(tmpdir(), 'owned-node-link');
  canonical.target = join(tmpdir(), 'node.cmd');
  expect(() => probeOwnedNodeExecutable(canonical.link)).toThrow('owned_kswarm_node_executable_required');
});
