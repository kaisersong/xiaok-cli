/**
 * HostNodeRuntimeIdentity (design v58 §4.4; R54-01, R54-03, R55-01, R56-02).
 *
 * The report renderer deliberately ships no Node artifact: it runs on the app's
 * own Electron Node. That is only sound if a pinned generation can prove the
 * interpreter did not change underneath it, so activation freezes an identity and
 * every spawn re-checks it.
 *
 * What the identity must cover, learned the hard way during review:
 *  - `process.execPath` resolved through realpath, plus its content hash;
 *  - on macOS the **dereferenced** interpreter input set inside
 *    `Electron Framework.framework/Versions/A/`: the main Mach-O, the V8 context
 *    snapshot, `icudtl.dat` and the bundled dylibs. The framework's top-level
 *    entry is a 35-byte symlink, so a no-follow tree hash would only cover the
 *    link text; and the snapshot/ICU files are plain data that dyld does not
 *    validate, so replacing them changes behaviour without changing any version.
 *  - the node/modules/v8 version triple and the app version.
 *
 * This is an explicit under-approximation: it covers interpreter inputs, not the
 * child's full image. Auxiliary frameworks and resources are out of scope because
 * a legitimate app update always touches the set above, and same-uid tampering
 * with arbitrary files is outside this design's (non-sandbox) boundary.
 */

import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, join, sep } from 'node:path';

export const HOST_NODE_IDENTITY_SCHEMA = 'xiaok-host-node-identity-v1';
/** Full re-hash cadence for the fast metadata gate (design R55-03). */
export const HOST_IDENTITY_REHASH_INTERVAL_MS = 300_000;

export interface SupportedHostNodeRange {
  readonly minNodeMajor: number;
  readonly maxNodeMajorExclusive: number;
  readonly moduleAbis: readonly string[];
}

/** Frozen for Electron 39, whose bundled Node is 22.22.1 with module ABI 140. */
export const SUPPORTED_HOST_NODE_RANGE: SupportedHostNodeRange = Object.freeze({
  minNodeMajor: 22,
  maxNodeMajorExclusive: 25,
  moduleAbis: Object.freeze(['140']),
});

export interface HostInterpreterInput {
  readonly path: string;
  readonly sha256: string;
  readonly size: number;
  readonly mtimeMs: number;
  readonly ino: number;
}

export interface HostNodeRuntimeIdentity {
  readonly schema: typeof HOST_NODE_IDENTITY_SCHEMA;
  readonly platform: string;
  readonly appBundleRoot: string;
  readonly execPathRealpath: string;
  readonly nodeVersion: string;
  readonly moduleAbi: string;
  readonly v8Version: string;
  readonly appVersion: string;
  readonly inputs: readonly HostInterpreterInput[];
  readonly digest: string;
}

export class HostRuntimeBlockedError extends Error {
  readonly code = 'blocked_external';

  constructor(detail: string) {
    super(`blocked_external: ${detail}`);
    this.name = 'HostRuntimeBlockedError';
  }
}

export class HostRuntimeIdentityDriftError extends Error {
  readonly code = 'host_runtime_identity_drift';

  constructor(readonly field: string) {
    super(`host_runtime_identity_drift: ${field}`);
    this.name = 'HostRuntimeIdentityDriftError';
  }
}

export interface ResolveIdentityInput {
  readonly execPath: string;
  readonly platform: string;
  readonly nodeVersion: string;
  readonly moduleAbi: string;
  readonly v8Version: string;
  readonly appVersion: string;
}

/**
 * macOS: `<app>.app/Contents/MacOS/<exe>` → the app bundle root.
 * Windows/Linux: the directory containing the executable.
 */
export function deriveAppBundleRoot(execPathRealpath: string, platform: string): string {
  if (platform !== 'darwin') return dirname(execPathRealpath);
  const parts = execPathRealpath.split(sep);
  const macOsIndex = parts.lastIndexOf('MacOS');
  if (macOsIndex >= 2 && parts[macOsIndex - 1] === 'Contents' && parts[macOsIndex - 2].endsWith('.app')) {
    return parts.slice(0, macOsIndex - 1).join(sep);
  }
  throw new HostRuntimeBlockedError(`cannot derive an app bundle root from ${execPathRealpath}`);
}

function hashRegularFile(path: string, bundleRoot: string): HostInterpreterInput {
  const resolved = realpathSync(path);
  if (!resolved.startsWith(bundleRoot + sep) && resolved !== bundleRoot) {
    throw new HostRuntimeBlockedError(`interpreter input escapes the app bundle: ${resolved}`);
  }
  const st = lstatSync(resolved);
  if (!st.isFile()) throw new HostRuntimeBlockedError(`interpreter input is not a regular file: ${resolved}`);
  if (st.nlink !== 1) throw new HostRuntimeBlockedError(`interpreter input is a hardlink: ${resolved}`);
  return {
    path: resolved,
    sha256: createHash('sha256').update(readFileSync(resolved)).digest('hex'),
    size: st.size,
    mtimeMs: st.mtimeMs,
    ino: st.ino,
  };
}

/** The exact interpreter input set, per platform. */
export function interpreterInputPaths(execPathRealpath: string, appBundleRoot: string, platform: string): string[] {
  const paths = [execPathRealpath];
  if (platform === 'darwin') {
    const versionsA = join(
      appBundleRoot, 'Contents', 'Frameworks', 'Electron Framework.framework', 'Versions', 'A',
    );
    // Deliberately dereferenced: the framework's top-level entry is a symlink.
    paths.push(join(versionsA, 'Electron Framework'));
    const resources = join(versionsA, 'Resources');
    if (existsSync(resources)) {
      for (const name of readdirSync(resources).sort()) {
        if (name === 'icudtl.dat' || (name.startsWith('v8_context_snapshot') && name.endsWith('.bin'))) {
          paths.push(join(resources, name));
        }
      }
    }
    const libraries = join(versionsA, 'Libraries');
    if (existsSync(libraries)) {
      for (const name of readdirSync(libraries).sort()) {
        // Only dylibs: a manifest such as vk_swiftshader_icd.json is not an
        // interpreter input and must not silently join the digest.
        if (name.endsWith('.dylib')) paths.push(join(libraries, name));
      }
    }
    return paths;
  }
  // Windows/Linux: the same class of external inputs sits next to the exe.
  const dir = dirname(execPathRealpath);
  for (const name of readdirSync(dir).sort()) {
    if (name === 'icudtl.dat'
      || (name.startsWith('v8_context_snapshot') && name.endsWith('.bin'))
      || name.endsWith('.dll')
      || name.endsWith('.so')) {
      paths.push(join(dir, name));
    }
  }
  return paths;
}

export function resolveHostNodeIdentity(input: ResolveIdentityInput): HostNodeRuntimeIdentity {
  const execPathRealpath = realpathSync(input.execPath);
  const appBundleRoot = deriveAppBundleRoot(execPathRealpath, input.platform);
  const paths = interpreterInputPaths(execPathRealpath, appBundleRoot, input.platform);
  const inputs = paths.map((p) => hashRegularFile(p, appBundleRoot));

  const hash = createHash('sha256');
  hash.update(`${HOST_NODE_IDENTITY_SCHEMA}\n${input.platform}\n${input.nodeVersion}\n${input.moduleAbi}\n`);
  hash.update(`${input.v8Version}\n${input.appVersion}\n${inputs.length}\n`);
  for (const entry of inputs) {
    hash.update(`${basename(entry.path)}\u0000${entry.size}\u0000${entry.sha256}\n`);
  }

  return {
    schema: HOST_NODE_IDENTITY_SCHEMA,
    platform: input.platform,
    appBundleRoot,
    execPathRealpath,
    nodeVersion: input.nodeVersion,
    moduleAbi: input.moduleAbi,
    v8Version: input.v8Version,
    appVersion: input.appVersion,
    inputs,
    digest: hash.digest('hex'),
  };
}

export function assertSupportedHostNode(
  identity: Pick<HostNodeRuntimeIdentity, 'nodeVersion' | 'moduleAbi'>,
  range: SupportedHostNodeRange = SUPPORTED_HOST_NODE_RANGE,
): void {
  const major = Number(identity.nodeVersion.replace(/^v/, '').split('.')[0]);
  if (!Number.isInteger(major) || major < range.minNodeMajor || major >= range.maxNodeMajorExclusive) {
    throw new HostRuntimeBlockedError(
      `node ${identity.nodeVersion} is outside the supported range `
      + `>=${range.minNodeMajor} <${range.maxNodeMajorExclusive}`,
    );
  }
  if (!range.moduleAbis.includes(identity.moduleAbi)) {
    throw new HostRuntimeBlockedError(`module ABI ${identity.moduleAbi} is not supported`);
  }
}

export type SpawnGateResult =
  | { kind: 'reuse' }
  | { kind: 'drift'; field: string };

/**
 * Fast pre-spawn gate. Metadata comparison covers **every** input, and a full
 * re-hash is forced on the first check, on any metadata difference, and whenever
 * the rehash interval has elapsed — so the 300s window can never hide a change
 * that also moved size/mtime/inode.
 */
export function checkHostIdentityBeforeSpawn(
  frozen: HostNodeRuntimeIdentity,
  now: number,
  lastFullHashAt: number,
  live: Pick<ResolveIdentityInput, 'execPath' | 'platform' | 'nodeVersion' | 'moduleAbi' | 'v8Version' | 'appVersion'>,
): SpawnGateResult {
  if (live.nodeVersion !== frozen.nodeVersion) return { kind: 'drift', field: 'nodeVersion' };
  if (live.moduleAbi !== frozen.moduleAbi) return { kind: 'drift', field: 'moduleAbi' };
  if (live.v8Version !== frozen.v8Version) return { kind: 'drift', field: 'v8Version' };
  if (live.appVersion !== frozen.appVersion) return { kind: 'drift', field: 'appVersion' };

  let realpath: string;
  try {
    realpath = realpathSync(live.execPath);
  } catch {
    return { kind: 'drift', field: 'execPathRealpath' };
  }
  if (realpath !== frozen.execPathRealpath) return { kind: 'drift', field: 'execPathRealpath' };

  const needsFullHash = now - lastFullHashAt >= HOST_IDENTITY_REHASH_INTERVAL_MS;
  for (const entry of frozen.inputs) {
    const st = existsSync(entry.path) ? statSync(entry.path) : null;
    if (!st) return { kind: 'drift', field: `missing:${basename(entry.path)}` };
    if (st.size !== entry.size || st.mtimeMs !== entry.mtimeMs || st.ino !== entry.ino) {
      return { kind: 'drift', field: `metadata:${basename(entry.path)}` };
    }
    if (needsFullHash) {
      const sha = createHash('sha256').update(readFileSync(entry.path)).digest('hex');
      if (sha !== entry.sha256) return { kind: 'drift', field: `content:${basename(entry.path)}` };
    }
  }
  return { kind: 'reuse' };
}
