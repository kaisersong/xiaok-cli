import { randomUUID } from 'node:crypto';
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rm,
} from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { canonicalSha256, canonicalize } from './canonical.mjs';
import { digestTree } from './tree-digest.mjs';
import {
  D9_ARTIFACT_DIGEST_ALGORITHM,
  D9_ARTIFACT_KEYS,
} from './constants.mjs';

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

function preflightPlanError(code = 'KIMI_D9_PREFLIGHT_PLAN_INVALID') {
  return new Error(code);
}

function artifactError() {
  return new Error('KIMI_D9_ARTIFACT_ATTESTATION_FAILED');
}

function immutableArtifactAttestationError(
  code = 'KIMI_D9_ARTIFACT_ATTESTATION_INVALID',
) {
  return new Error(code);
}

function isPlainObject(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, expected) {
  if (!isPlainObject(value)) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length === expected.length
    && keys.every(key => typeof key === 'string' && expected.includes(key));
}

function isSha256(value) {
  return typeof value === 'string' && SHA256_PATTERN.test(value);
}

function normalizedIdentity(stat, realpath) {
  return {
    realpath,
    device: stat.dev,
    inode: stat.ino,
    size: stat.size,
    mode: stat.mode & 0o7777,
    fileType: stat.isDirectory() ? 'directory' : 'file',
  };
}

function samePhysicalIdentity(left, right) {
  return left.realpath === right.realpath
    && left.device === right.device
    && left.inode === right.inode
    && left.size === right.size
    && left.mode === right.mode
    && left.fileType === right.fileType;
}

export async function capturePhysicalIdentity(path) {
  const absolute = resolve(path);
  const stat = await lstat(absolute);
  if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) {
    throw artifactError();
  }
  return normalizedIdentity(stat, await realpath(absolute));
}

async function createImmutableJson(path, value, alreadyExistsCode) {
  const absolute = resolve(path);
  const canonicalBytes = canonicalize(value);
  const hash = canonicalSha256(value);
  await mkdir(dirname(absolute), { recursive: true, mode: 0o700 });
  const temporary = `${absolute}.create-${randomUUID()}`;
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(canonicalBytes, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await chmod(temporary, 0o400);
    try {
      await link(temporary, absolute);
    } catch (error) {
      if (error?.code === 'EEXIST') {
        throw new Error(alreadyExistsCode);
      }
      throw error;
    }
  } finally {
    await handle?.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
  }
  return {
    canonicalBytes,
    hash,
    physicalIdentity: await capturePhysicalIdentity(absolute),
  };
}

export async function createImmutablePreflightPlan(planPath, plan) {
  return createImmutableJson(
    planPath,
    plan,
    'KIMI_D9_PREFLIGHT_PLAN_ALREADY_EXISTS',
  );
}

export async function verifyImmutablePreflightPlan({
  planPath,
  expectedHash,
  expectedPhysicalIdentity,
}) {
  try {
    const absolute = resolve(planPath);
    const identity = await capturePhysicalIdentity(absolute);
    if ((identity.mode & 0o222) !== 0) {
      throw preflightPlanError();
    }
    if (
      expectedPhysicalIdentity
      && !samePhysicalIdentity(identity, expectedPhysicalIdentity)
    ) {
      throw preflightPlanError();
    }
    const bytes = await readFile(absolute, 'utf8');
    const parsed = JSON.parse(bytes);
    if (canonicalize(parsed) !== bytes || canonicalSha256(parsed) !== expectedHash) {
      throw preflightPlanError();
    }
    return parsed;
  } catch (error) {
    if (error?.message === 'KIMI_D9_PREFLIGHT_PLAN_INVALID') throw error;
    throw preflightPlanError();
  }
}

function validPhysicalIdentity(identity) {
  return hasExactKeys(identity, [
    'realpath',
    'device',
    'inode',
    'size',
    'mode',
    'fileType',
  ])
    && typeof identity.realpath === 'string'
    && identity.realpath.length > 0
    && Number.isSafeInteger(identity.device)
    && identity.device >= 0
    && Number.isSafeInteger(identity.inode)
    && identity.inode >= 0
    && Number.isSafeInteger(identity.size)
    && identity.size >= 0
    && Number.isSafeInteger(identity.mode)
    && identity.mode >= 0
    && identity.mode <= 0o7777
    && ['file', 'directory'].includes(identity.fileType);
}

export function validatePreflightArtifactAttestation(attestation) {
  if (
    !hasExactKeys(attestation, [
      'schemaVersion',
      'preflightPlanHash',
      'artifactDigestAlgorithm',
      'artifacts',
      'constructionCompletionCounters',
    ])
    || attestation.schemaVersion !== 1
    || !isSha256(attestation.preflightPlanHash)
    || attestation.artifactDigestAlgorithm !== D9_ARTIFACT_DIGEST_ALGORITHM
    || !hasExactKeys(attestation.artifacts, D9_ARTIFACT_KEYS)
    || !hasExactKeys(
      attestation.constructionCompletionCounters,
      D9_ARTIFACT_KEYS,
    )
  ) {
    throw immutableArtifactAttestationError();
  }
  for (const artifactKey of D9_ARTIFACT_KEYS) {
    const artifact = attestation.artifacts[artifactKey];
    if (
      !hasExactKeys(artifact, [
        'artifactPath',
        'physicalIdentity',
        'digest',
      ])
      || typeof artifact.artifactPath !== 'string'
      || artifact.artifactPath.length === 0
      || !validPhysicalIdentity(artifact.physicalIdentity)
      || !isSha256(artifact.digest)
      || attestation.constructionCompletionCounters[artifactKey] !== 1
    ) {
      throw immutableArtifactAttestationError();
    }
  }
  return attestation;
}

export async function createImmutableArtifactAttestation(
  attestationPath,
  attestation,
) {
  try {
    validatePreflightArtifactAttestation(attestation);
    for (const artifactKey of D9_ARTIFACT_KEYS) {
      const declared = attestation.artifacts[artifactKey];
      const before = await capturePhysicalIdentity(declared.artifactPath);
      if (!samePhysicalIdentity(before, declared.physicalIdentity)) {
        throw immutableArtifactAttestationError();
      }
      const digest = (await digestTree(declared.artifactPath)).digest;
      const after = await capturePhysicalIdentity(declared.artifactPath);
      if (
        digest !== declared.digest
        || !samePhysicalIdentity(before, after)
        || !samePhysicalIdentity(after, declared.physicalIdentity)
      ) {
        throw immutableArtifactAttestationError();
      }
    }
    return createImmutableJson(
      attestationPath,
      attestation,
      'KIMI_D9_ARTIFACT_ATTESTATION_ALREADY_EXISTS',
    );
  } catch (error) {
    if (error?.message === 'KIMI_D9_ARTIFACT_ATTESTATION_ALREADY_EXISTS') {
      throw error;
    }
    throw immutableArtifactAttestationError();
  }
}

export async function verifyImmutableArtifactAttestation({
  attestationPath,
  expectedHash,
  expectedPhysicalIdentity,
  expectedPreflightPlanHash,
  expectedArtifactDigests,
}) {
  try {
    if (
      !isSha256(expectedHash)
      || !isSha256(expectedPreflightPlanHash)
      || !hasExactKeys(expectedArtifactDigests, D9_ARTIFACT_KEYS)
    ) {
      throw immutableArtifactAttestationError();
    }
    const identity = await capturePhysicalIdentity(attestationPath);
    if (
      (identity.mode & 0o222) !== 0
      || !samePhysicalIdentity(identity, expectedPhysicalIdentity)
    ) {
      throw immutableArtifactAttestationError();
    }
    const bytes = await readFile(resolve(attestationPath), 'utf8');
    const parsed = JSON.parse(bytes);
    validatePreflightArtifactAttestation(parsed);
    if (
      canonicalize(parsed) !== bytes
      || canonicalSha256(parsed) !== expectedHash
      || parsed.preflightPlanHash !== expectedPreflightPlanHash
      || D9_ARTIFACT_KEYS.some(key => (
        !isSha256(expectedArtifactDigests[key])
        || parsed.artifacts[key].digest !== expectedArtifactDigests[key]
      ))
    ) {
      throw immutableArtifactAttestationError();
    }
    return parsed;
  } catch (error) {
    if (error?.message === 'KIMI_D9_ARTIFACT_ATTESTATION_INVALID') throw error;
    throw immutableArtifactAttestationError();
  }
}

export function createSideEffectCounters() {
  const counts = {
    networkRequest: 0,
    fixtureMcpInvocation: 0,
    evidenceWrite: 0,
  };
  return Object.freeze({
    increment(kind) {
      if (!Object.hasOwn(counts, kind)) {
        throw new Error('KIMI_D9_UNKNOWN_SIDE_EFFECT_COUNTER');
      }
      counts[kind] += 1;
    },
    snapshot() {
      return { ...counts };
    },
  });
}

function assertNoSideEffects(counters) {
  const snapshot = counters.snapshot();
  if (
    snapshot.networkRequest !== 0
    || snapshot.fixtureMcpInvocation !== 0
    || snapshot.evidenceWrite !== 0
  ) {
    throw artifactError();
  }
}

export async function verifyArtifactAttestation({
  artifactPath,
  expectedDigest,
  expectedPhysicalIdentity,
  counters,
}) {
  try {
    assertNoSideEffects(counters);
    const physicalIdentity = await capturePhysicalIdentity(artifactPath);
    if (!samePhysicalIdentity(physicalIdentity, expectedPhysicalIdentity)) {
      throw artifactError();
    }
    const digest = (await digestTree(artifactPath)).digest;
    if (digest !== expectedDigest) {
      throw artifactError();
    }
    const finalPhysicalIdentity = await capturePhysicalIdentity(artifactPath);
    if (
      !samePhysicalIdentity(finalPhysicalIdentity, physicalIdentity)
      || !samePhysicalIdentity(finalPhysicalIdentity, expectedPhysicalIdentity)
    ) {
      throw artifactError();
    }
    assertNoSideEffects(counters);
    return { digest, physicalIdentity: finalPhysicalIdentity };
  } catch (error) {
    if (error?.message === 'KIMI_D9_ARTIFACT_ATTESTATION_FAILED') throw error;
    throw artifactError();
  }
}
