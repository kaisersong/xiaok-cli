import { domainToASCII } from 'node:url';
import {
  CANONICAL_HELPER_ATTESTATION,
  canonicalSha256,
  canonicalize,
} from './canonical.mjs';
import {
  D9_ARTIFACT_DIGEST_ALGORITHM,
  D9_ARTIFACT_KEYS,
  D9_BOOTSTRAP_ALGORITHM,
  D9_BOOTSTRAP_ITERATIONS,
  D9_BOOTSTRAP_MASTER_SEED,
  D9_DESIGN_SHA256,
  D9_EXPECTED_ELIGIBILITY,
  D9_PER_METRIC_SESSION_REDUCTION,
  D9_PERFORMANCE_REGRESSION_BUDGET,
  D9_PERFORMANCE_REGRESSION_BUDGET_SOURCE,
  D9_PERFORMANCE_REGRESSION_BUDGET_SOURCE_COMMIT,
  D9_PERFORMANCE_REGRESSION_BUDGET_SOURCE_HASH_OBJECT,
  D9_PERFORMANCE_REGRESSION_BUDGET_SOURCE_INTRODUCED_AT,
  D9_PERFORMANCE_REGRESSION_BUDGET_SOURCE_SHA256,
  D9_RANDOMIZATION_ALGORITHM,
  D9_RANDOMIZATION_MASTER_SEED,
  D9_RUN_START_CONFIG_KEYS,
  D9_SAMPLES_PER_CELL,
  D9_SAMPLES_PER_STRATUM,
  D9_STAGE,
  D9_STRATA,
  D9_STRATA_PER_SURFACE,
  D9_TREATMENT_POINTER,
} from './constants.mjs';
import { createCellAssignment } from './assignment.mjs';
import { validatePreflightArtifactAttestation } from './preflight.mjs';

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const RUN_START_KEYS = Object.freeze([
  'modelId',
  'profileId',
  'wireModel',
  'reasoningEffort',
  'contextLimit',
  'preservedThinking',
  'promptCacheKey',
  'temperature',
  'topP',
  'maxOutputTokens',
  'stop',
  'responseFormat',
  'streamingMode',
  'toolChoice',
  'parallelToolMode',
  'apiVersionHeaders',
  'sdkTransportMode',
  'productTimeoutMs',
  'retryPolicy',
  'backoffPolicy',
  'proxyIdentity',
  'noProxyIdentity',
  'endpoint',
  'systemPromptDigest',
  'toolCatalogDigest',
  'skillCatalogDigest',
  'fixtureMcpRegistrationDigest',
]);
const MANIFEST_REQUIRED_INPUT_KEYS = Object.freeze([
  'preflightPlan',
  'preflightPlanHash',
  'preflightArtifactAttestation',
  'preflightArtifactAttestationHash',
  'eligibility',
  'artifactDigests',
  'nonSecretQueryKeyAllowlist',
  'nonSecretHeaderNameAllowlist',
  'runStartRequestInputs',
  'fixtures',
  'assignments',
  'withdrawnFixtureDigests',
]);
const MANIFEST_OPTIONAL_CONSTANT_KEYS = Object.freeze([
  'randomizationSeed',
  'bootstrapSeed',
  'samplesPerStratum',
]);

function manifestError(code) {
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

function isNullableFinite(value) {
  return value === null
    || (typeof value === 'number' && Number.isFinite(value));
}

function isNullableString(value) {
  return value === null || typeof value === 'string';
}

function deepFreeze(value) {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function canonicalClone(value) {
  return JSON.parse(canonicalize(value));
}

function compareKeyValue(left, right, keyName) {
  const keyOrder = Buffer.compare(
    Buffer.from(left[keyName], 'utf8'),
    Buffer.from(right[keyName], 'utf8'),
  );
  if (keyOrder !== 0) return keyOrder;
  return Buffer.compare(
    Buffer.from(left.value, 'utf8'),
    Buffer.from(right.value, 'utf8'),
  );
}

function rejectRunStart() {
  throw manifestError('KIMI_D9_RUN_START_INPUT_REJECTED');
}

function validateNonSecretAllowlist(values, { lowercase }) {
  if (
    !Array.isArray(values)
    || values.some(value => (
      typeof value !== 'string'
      || value.length === 0
      || (lowercase && value !== value.toLowerCase())
      || /(?:^|[-_])(authorization|cookie|token|secret|api[-_]?key|signature|password)(?:$|[-_])/iu
        .test(value)
    ))
    || new Set(values).size !== values.length
  ) {
    rejectRunStart();
  }
}

export function sanitizeRunStartRequestInputsV1(input, {
  allowedQueryKeys,
  allowedHeaderNames,
}) {
  try {
    canonicalize(input);
  } catch {
    rejectRunStart();
  }
  if (
    !hasExactKeys(input, RUN_START_KEYS)
  ) {
    rejectRunStart();
  }
  validateNonSecretAllowlist(allowedQueryKeys, { lowercase: false });
  validateNonSecretAllowlist(allowedHeaderNames, { lowercase: true });
  for (const key of ['modelId', 'profileId', 'wireModel', 'reasoningEffort']) {
    if (typeof input[key] !== 'string' || input[key].length === 0) rejectRunStart();
  }
  if (
    !Number.isSafeInteger(input.contextLimit)
    || input.contextLimit <= 0
    || typeof input.preservedThinking !== 'boolean'
    || input.promptCacheKey !== false
    || !isNullableFinite(input.temperature)
    || !isNullableFinite(input.topP)
    || (
      input.maxOutputTokens !== null
      && (!Number.isSafeInteger(input.maxOutputTokens) || input.maxOutputTokens <= 0)
    )
    || !(
      input.stop === null
      || typeof input.stop === 'string'
      || (
        Array.isArray(input.stop)
        && input.stop.every(value => typeof value === 'string')
      )
    )
    || !isNullableString(input.responseFormat)
    || typeof input.streamingMode !== 'string'
    || typeof input.toolChoice !== 'string'
    || typeof input.parallelToolMode !== 'boolean'
    || typeof input.sdkTransportMode !== 'string'
    || !Number.isSafeInteger(input.productTimeoutMs)
    || input.productTimeoutMs <= 0
    || typeof input.retryPolicy !== 'string'
    || typeof input.backoffPolicy !== 'string'
    || !isNullableString(input.proxyIdentity)
    || !isNullableString(input.noProxyIdentity)
  ) {
    rejectRunStart();
  }
  for (const key of [
    'systemPromptDigest',
    'toolCatalogDigest',
    'skillCatalogDigest',
    'fixtureMcpRegistrationDigest',
  ]) {
    if (!isSha256(input[key])) rejectRunStart();
  }

  if (!Array.isArray(input.apiVersionHeaders)) rejectRunStart();
  const allowedHeaderSet = new Set(allowedHeaderNames);
  for (const header of input.apiVersionHeaders) {
    if (
      !hasExactKeys(header, ['name', 'value'])
      || typeof header.name !== 'string'
      || header.name !== header.name.toLowerCase()
      || !allowedHeaderSet.has(header.name)
      || typeof header.value !== 'string'
    ) {
      rejectRunStart();
    }
  }

  const endpoint = input.endpoint;
  if (
    !hasExactKeys(endpoint, [
      'scheme',
      'host',
      'effectivePort',
      'pathname',
      'query',
    ])
    || typeof endpoint.scheme !== 'string'
    || endpoint.scheme !== 'https'
    || typeof endpoint.host !== 'string'
    || endpoint.host !== endpoint.host.toLowerCase()
    || domainToASCII(endpoint.host) !== endpoint.host
    || endpoint.host.length === 0
    || endpoint.host.includes('@')
    || !Number.isSafeInteger(endpoint.effectivePort)
    || endpoint.effectivePort <= 0
    || endpoint.effectivePort > 65_535
    || typeof endpoint.pathname !== 'string'
    || !endpoint.pathname.startsWith('/')
    || endpoint.pathname.includes('?')
    || endpoint.pathname.includes('#')
    || !Array.isArray(endpoint.query)
  ) {
    rejectRunStart();
  }
  const allowedQuerySet = new Set(allowedQueryKeys);
  for (const item of endpoint.query) {
    if (
      !hasExactKeys(item, ['key', 'value'])
      || typeof item.key !== 'string'
      || !allowedQuerySet.has(item.key)
      || typeof item.value !== 'string'
    ) {
      rejectRunStart();
    }
  }
  const sanitized = canonicalClone(input);
  sanitized.apiVersionHeaders.sort((left, right) => (
    compareKeyValue(left, right, 'name')
  ));
  sanitized.endpoint.query.sort((left, right) => (
    compareKeyValue(left, right, 'key')
  ));
  return deepFreeze(sanitized);
}

function sanitizeRunStartMap(input) {
  const {
    nonSecretQueryKeyAllowlist,
    nonSecretHeaderNameAllowlist,
    runStartRequestInputs,
  } = input;
  if (!hasExactKeys(runStartRequestInputs, D9_RUN_START_CONFIG_KEYS)) {
    throw manifestError('KIMI_D9_MANIFEST_SCHEMA_INVALID');
  }
  validateNonSecretAllowlist(nonSecretQueryKeyAllowlist, { lowercase: false });
  validateNonSecretAllowlist(nonSecretHeaderNameAllowlist, { lowercase: true });
  const sanitized = Object.fromEntries(
    D9_RUN_START_CONFIG_KEYS.map(key => [
      key,
      sanitizeRunStartRequestInputsV1(runStartRequestInputs[key], {
        allowedQueryKeys: nonSecretQueryKeyAllowlist,
        allowedHeaderNames: nonSecretHeaderNameAllowlist,
      }),
    ]),
  );
  for (const surface of ['cli', 'desktop']) {
    assertPairedTreatmentInvariant(
      sanitized[`k3:${surface}:baseline`],
      sanitized[`k3:${surface}:candidate`],
    );
  }
  for (const key of [
    'k3-256k:cli:candidate',
    'k3-256k:desktop:candidate',
  ]) {
    if (
      sanitized[key].preservedThinking !== true
      || sanitized[key].promptCacheKey !== false
      || sanitized[key].wireModel !== 'k3-256k'
    ) {
      throw manifestError('KIMI_D9_TREATMENT_INVARIANT_VIOLATION');
    }
  }
  return {
    nonSecretQueryKeyAllowlist: [...nonSecretQueryKeyAllowlist].sort(),
    nonSecretHeaderNameAllowlist:
      [...nonSecretHeaderNameAllowlist].sort(),
    runStartRequestInputs: sanitized,
    productRuntimeConfigDigests: Object.fromEntries(
      D9_RUN_START_CONFIG_KEYS.map(key => [
        key,
        canonicalSha256(sanitized[key]),
      ]),
    ),
  };
}

export function assertPairedTreatmentInvariant(baseline, candidate) {
  if (
    !hasExactKeys(baseline, RUN_START_KEYS)
    || !hasExactKeys(candidate, RUN_START_KEYS)
    || baseline.preservedThinking !== false
    || candidate?.preservedThinking !== true
    || baseline?.promptCacheKey !== false
    || candidate?.promptCacheKey !== false
  ) {
    throw manifestError('KIMI_D9_TREATMENT_INVARIANT_VIOLATION');
  }
  const baselineInvariant = { ...baseline };
  const candidateInvariant = { ...candidate };
  delete baselineInvariant.preservedThinking;
  delete candidateInvariant.preservedThinking;
  if (canonicalize(baselineInvariant) !== canonicalize(candidateInvariant)) {
    throw manifestError('KIMI_D9_TREATMENT_INVARIANT_VIOLATION');
  }
  return true;
}

function assertExactMap(actual, expected, valueValidator, errorCode) {
  if (
    !hasExactKeys(actual, Object.keys(expected))
    || Object.entries(expected).some(([key, value]) => (
      actual[key] !== value
      || (valueValidator && !valueValidator(actual[key]))
    ))
  ) {
    throw manifestError(errorCode);
  }
}

function validateArtifactDigests(artifactDigests) {
  if (
    !hasExactKeys(artifactDigests, D9_ARTIFACT_KEYS)
    || D9_ARTIFACT_KEYS.some(key => !isSha256(artifactDigests[key]))
  ) {
    throw manifestError('KIMI_D9_MANIFEST_SCHEMA_INVALID');
  }
}

function validateFixtures(fixtures, withdrawnFixtureDigests) {
  if (
    !Array.isArray(fixtures)
    || !Array.isArray(withdrawnFixtureDigests)
    || withdrawnFixtureDigests.some(value => !isSha256(value))
  ) {
    throw manifestError('KIMI_D9_MANIFEST_SCHEMA_INVALID');
  }
  const withdrawn = new Set(withdrawnFixtureDigests);
  const fixtureIds = new Set();
  const fixtureDigests = new Set();
  const counts = new Map();
  for (const fixture of fixtures) {
    if (
      !hasExactKeys(fixture, [
        'fixtureId',
        'digest',
        'profile',
        'surface',
        'stratum',
      ])
      || typeof fixture.fixtureId !== 'string'
      || fixtureIds.has(fixture.fixtureId)
      || !isSha256(fixture.digest)
      || fixtureDigests.has(fixture.digest)
      || !Object.hasOwn(D9_STRATA, fixture.surface)
      || !D9_STRATA[fixture.surface].includes(fixture.stratum)
      || !['k3', 'k3-256k'].includes(fixture.profile)
    ) {
      throw manifestError('KIMI_D9_MANIFEST_SCHEMA_INVALID');
    }
    if (withdrawn.has(fixture.digest)) {
      throw manifestError('KIMI_D9_WITHDRAWN_FIXTURE_REUSED');
    }
    fixtureIds.add(fixture.fixtureId);
    fixtureDigests.add(fixture.digest);
    const key = `${fixture.profile}:${fixture.surface}:${fixture.stratum}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const profile of ['k3', 'k3-256k']) {
    for (const surface of ['cli', 'desktop']) {
      for (const stratum of D9_STRATA[surface]) {
        if (counts.get(`${profile}:${surface}:${stratum}`) !== D9_SAMPLES_PER_STRATUM) {
          throw manifestError('KIMI_D9_MANIFEST_SCHEMA_INVALID');
        }
      }
    }
  }
  return new Map(fixtures.map(fixture => [fixture.fixtureId, fixture]));
}

function validateAssignments(assignments, fixturesById) {
  const cellKeys = Object.keys(D9_EXPECTED_ELIGIBILITY);
  if (!hasExactKeys(assignments, cellKeys)) {
    throw manifestError('KIMI_D9_ASSIGNMENT_INVALID');
  }
  for (const cellKey of cellKeys) {
    const records = assignments[cellKey];
    const [profile, surface] = cellKey.split(':');
    const paired = D9_EXPECTED_ELIGIBILITY[cellKey] === 'paired-eligible';
    if (!Array.isArray(records) || records.length !== D9_SAMPLES_PER_CELL) {
      throw manifestError('KIMI_D9_ASSIGNMENT_INVALID');
    }
    const seen = new Set();
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      const expectedKeys = paired
        ? ['sequenceIndex', 'profile', 'surface', 'stratum', 'fixtureId', 'pairIndex', 'firstArm']
        : ['sequenceIndex', 'profile', 'surface', 'stratum', 'fixtureId', 'pairIndex'];
      if (
        !hasExactKeys(record, expectedKeys)
        || record.sequenceIndex !== index
        || record.profile !== profile
        || record.surface !== surface
        || !D9_STRATA[surface].includes(record.stratum)
        || !fixturesById.has(record.fixtureId)
        || seen.has(record.fixtureId)
        || !Number.isSafeInteger(record.pairIndex)
        || record.pairIndex < 0
        || record.pairIndex >= D9_SAMPLES_PER_STRATUM
        || (
          paired
          && record.firstArm !== (
            record.pairIndex % 2 === 0
              ? 'baseline-first'
              : 'candidate-first'
          )
        )
      ) {
        throw manifestError('KIMI_D9_ASSIGNMENT_INVALID');
      }
      const fixture = fixturesById.get(record.fixtureId);
      if (
        fixture.profile !== profile
        || fixture.surface !== surface
        || fixture.stratum !== record.stratum
      ) {
        throw manifestError('KIMI_D9_ASSIGNMENT_INVALID');
      }
      seen.add(record.fixtureId);
    }
    const fixtureIdsByStratum = Object.fromEntries(
      D9_STRATA[surface].map(stratum => [
        stratum,
        [...fixturesById.values()]
          .filter(fixture => (
            fixture.profile === profile
            && fixture.surface === surface
            && fixture.stratum === stratum
          ))
          .map(fixture => fixture.fixtureId),
      ]),
    );
    const expected = createCellAssignment({
      profile,
      surface,
      eligibility: D9_EXPECTED_ELIGIBILITY[cellKey],
      fixtureIdsByStratum,
    });
    if (canonicalize(records) !== canonicalize(expected)) {
      throw manifestError('KIMI_D9_ASSIGNMENT_INVALID');
    }
  }
}

function assertConstants(input) {
  if (
    (input.randomizationSeed !== undefined
      && input.randomizationSeed !== D9_RANDOMIZATION_MASTER_SEED)
    || (input.bootstrapSeed !== undefined
      && input.bootstrapSeed !== D9_BOOTSTRAP_MASTER_SEED)
    || (input.samplesPerStratum !== undefined
      && input.samplesPerStratum !== D9_SAMPLES_PER_STRATUM)
  ) {
    throw manifestError('KIMI_D9_MANIFEST_CONSTANT_MISMATCH');
  }
}

export function buildFrozenManifest(input) {
  if (!isPlainObject(input)) {
    throw manifestError('KIMI_D9_MANIFEST_SCHEMA_INVALID');
  }
  const inputKeys = Reflect.ownKeys(input);
  if (
    MANIFEST_REQUIRED_INPUT_KEYS.some(key => !Object.hasOwn(input, key))
    || inputKeys.some(key => (
      typeof key !== 'string'
      || !MANIFEST_REQUIRED_INPUT_KEYS.includes(key)
        && !MANIFEST_OPTIONAL_CONSTANT_KEYS.includes(key)
    ))
  ) {
    throw manifestError('KIMI_D9_MANIFEST_SCHEMA_INVALID');
  }
  assertConstants(input);
  if (
    !isSha256(input.preflightPlanHash)
    || !isSha256(input.preflightArtifactAttestationHash)
    || canonicalSha256(input.preflightPlan) !== input.preflightPlanHash
  ) {
    throw manifestError('KIMI_D9_MANIFEST_SCHEMA_INVALID');
  }
  validatePreflightArtifactAttestation(
    input.preflightArtifactAttestation,
  );
  if (
    canonicalSha256(input.preflightArtifactAttestation)
      !== input.preflightArtifactAttestationHash
    || input.preflightArtifactAttestation.preflightPlanHash
      !== input.preflightPlanHash
  ) {
    throw manifestError('KIMI_D9_ARTIFACT_ATTESTATION_INVALID');
  }
  assertExactMap(
    input.eligibility,
    D9_EXPECTED_ELIGIBILITY,
    undefined,
    'KIMI_D9_MANIFEST_SCHEMA_INVALID',
  );
  validateArtifactDigests(input.artifactDigests);
  if (D9_ARTIFACT_KEYS.some(key => (
    input.preflightArtifactAttestation.artifacts[key].digest
      !== input.artifactDigests[key]
  ))) {
    throw manifestError('KIMI_D9_ARTIFACT_ATTESTATION_INVALID');
  }
  const runStart = sanitizeRunStartMap(input);
  const fixturesById = validateFixtures(
    input.fixtures,
    input.withdrawnFixtureDigests,
  );
  validateAssignments(input.assignments, fixturesById);

  const manifest = deepFreeze(canonicalClone({
    schemaVersion: 1,
    designSha256: D9_DESIGN_SHA256,
    stage: D9_STAGE,
    canonicalHelperAttestation: CANONICAL_HELPER_ATTESTATION,
    preflightPlan: input.preflightPlan,
    preflightPlanHash: input.preflightPlanHash,
    preflightArtifactAttestation:
      input.preflightArtifactAttestation,
    preflightArtifactAttestationHash:
      input.preflightArtifactAttestationHash,
    randomizationAlgorithm: D9_RANDOMIZATION_ALGORITHM,
    randomizationSeed: D9_RANDOMIZATION_MASTER_SEED,
    bootstrapAlgorithm: D9_BOOTSTRAP_ALGORITHM,
    bootstrapSeed: D9_BOOTSTRAP_MASTER_SEED,
    bootstrapIterations: D9_BOOTSTRAP_ITERATIONS,
    artifactDigestAlgorithm: D9_ARTIFACT_DIGEST_ALGORITHM,
    samplesPerStratum: D9_SAMPLES_PER_STRATUM,
    strataPerSurface: D9_STRATA_PER_SURFACE,
    samplesPerCell: D9_SAMPLES_PER_CELL,
    treatment: {
      pointerAllowlist: [D9_TREATMENT_POINTER],
      baseline: false,
      candidate: true,
    },
    nonSecretQueryKeyAllowlist:
      runStart.nonSecretQueryKeyAllowlist,
    nonSecretHeaderNameAllowlist:
      runStart.nonSecretHeaderNameAllowlist,
    runStartRequestInputs: runStart.runStartRequestInputs,
    productRuntimeConfigDigests:
      runStart.productRuntimeConfigDigests,
    perMetricSessionReduction: D9_PER_METRIC_SESSION_REDUCTION,
    performanceRegressionBudget:
      D9_PERFORMANCE_REGRESSION_BUDGET,
    performanceRegressionBudgetSource:
      D9_PERFORMANCE_REGRESSION_BUDGET_SOURCE,
    performanceRegressionBudgetSourceSha256:
      D9_PERFORMANCE_REGRESSION_BUDGET_SOURCE_SHA256,
    performanceRegressionBudgetSourceCommit:
      D9_PERFORMANCE_REGRESSION_BUDGET_SOURCE_COMMIT,
    performanceRegressionBudgetSourceIntroducedAt:
      D9_PERFORMANCE_REGRESSION_BUDGET_SOURCE_INTRODUCED_AT,
    performanceRegressionBudgetSourceHashObject:
      D9_PERFORMANCE_REGRESSION_BUDGET_SOURCE_HASH_OBJECT,
    eligibility: input.eligibility,
    artifactDigests: input.artifactDigests,
    fixtures: input.fixtures,
    assignments: input.assignments,
    withdrawnFixtureDigests: input.withdrawnFixtureDigests,
  }));
  return {
    manifest,
    canonicalBytes: canonicalize(manifest),
    hash: canonicalSha256(manifest),
  };
}

export function verifyFrozenManifest(manifest, expectedHash) {
  if (!isSha256(expectedHash) || canonicalSha256(manifest) !== expectedHash) {
    throw manifestError('KIMI_D9_MANIFEST_HASH_MISMATCH');
  }
  let rebuilt;
  try {
    rebuilt = buildFrozenManifest({
      preflightPlan: manifest.preflightPlan,
      preflightPlanHash: manifest.preflightPlanHash,
      preflightArtifactAttestation:
        manifest.preflightArtifactAttestation,
      preflightArtifactAttestationHash:
        manifest.preflightArtifactAttestationHash,
      eligibility: manifest.eligibility,
      artifactDigests: manifest.artifactDigests,
      nonSecretQueryKeyAllowlist:
        manifest.nonSecretQueryKeyAllowlist,
      nonSecretHeaderNameAllowlist:
        manifest.nonSecretHeaderNameAllowlist,
      runStartRequestInputs: manifest.runStartRequestInputs,
      fixtures: manifest.fixtures,
      assignments: manifest.assignments,
      withdrawnFixtureDigests: manifest.withdrawnFixtureDigests,
    }).manifest;
  } catch {
    throw manifestError('KIMI_D9_MANIFEST_SCHEMA_INVALID');
  }
  if (canonicalize(rebuilt) !== canonicalize(manifest)) {
    throw manifestError('KIMI_D9_MANIFEST_SCHEMA_INVALID');
  }
  return manifest;
}
