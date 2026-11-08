import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const key = 'XIAOK_WORKFLOW_TEST_KSWARM_NODE_EXECUTABLE';

/** Test-only executable data probe. This does not grant a runtime capability.
 * @param {string | undefined} [explicit] */
export function probeOwnedNodeExecutable(explicit) {
  const selected = explicit ?? process.env[key] ?? process.execPath;
  if (typeof selected !== 'string' || !selected || !isAbsolute(selected) || /\.cmd$/i.test(selected)) {
    throw Error('owned_kswarm_node_executable_required');
  }
  const executable = realpathSync(selected);
  if (/\.cmd$/i.test(executable)) throw Error('owned_kswarm_node_executable_required');
  const result = spawnSync(executable, ['--version'], {
    encoding: 'utf8', shell: false, timeout: 2000, maxBuffer: 32 * 1024,
  });
  if (result.error !== undefined) throw result.error;
  const text = typeof result.stdout === 'string' ? result.stdout.trim() : '';
  if (result.status !== 0 || result.signal !== null || !/^v\d+\.\d+\.\d+$/.test(text)
    || !Number.isSafeInteger(result.pid) || result.pid <= 0) {
    throw Error('owned_kswarm_node_probe_unconfirmed', { cause: result });
  }
  const fact = Object.freeze({ executable, nodeVersion: text.slice(1), probePid: result.pid });
  console.info(JSON.stringify({ fixture: 'owned-kswarm-node-preflight', clientNodeVersion: process.versions.node, ...fact }));
  return fact;
}

/** The original sibling owns its floor policy; no copied semver gate.
 * @param {string | undefined} explicit
 * @param {string} repositoryRoot */
export async function createOwnedKSwarmNodeRuntime(explicit, repositoryRoot) {
  const fact = probeOwnedNodeExecutable(explicit);
  const guard = await import(pathToFileURL(resolve(repositoryRoot, '..', 'kswarm', 'src/core/runtime-guard.js')).href);
  guard.assertNodeRuntime(fact.nodeVersion);
  return Object.freeze({
    ...fact,
    /** Logs preflight data and the original owned child, not a Native receipt.
     * @param {import('node:child_process').ChildProcess} child */
    recordChild(child) {
      console.info(JSON.stringify({ fixture: 'owned-kswarm-node-child', clientNodeVersion: process.versions.node,
        preflightNodeVersion: fact.nodeVersion, nodeExecutable: fact.executable, probePid: fact.probePid,
        childPid: child.pid, requiredFloor: guard.NODE_VERSION_FLOOR }));
    },
  });
}
