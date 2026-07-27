import { canonicalSha256 } from './canonical.mjs';
import { createCellAssignment } from './assignment.mjs';
import {
  D9_EXPECTED_ELIGIBILITY,
  D9_PROFILE_ORDER,
  D9_STRATA,
  D9_SURFACE_ORDER,
} from './constants.mjs';

const STATUSES = new Set(['success', 'failed', 'timeout', 'missing']);
const FORBIDDEN_RECORD_KEYS = new Set([
  'rawOutput',
  'rawRequest',
  'rawResponse',
  'rawReasoning',
  'apiKey',
  'authorization',
  'promptCacheKeyValue',
]);

function fail(code) {
  throw new Error(code);
}

function deepFreeze(value) {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function fixtureMap(formalFixtures) {
  if (!Array.isArray(formalFixtures)) {
    fail('KIMI_D9_EXECUTION_PLAN_INVALID');
  }
  const byId = new Map();
  for (const fixture of formalFixtures) {
    if (
      typeof fixture?.fixtureId !== 'string'
      || byId.has(fixture.fixtureId)
    ) {
      fail('KIMI_D9_EXECUTION_PLAN_INVALID');
    }
    byId.set(fixture.fixtureId, fixture);
  }
  return byId;
}

function fixtureIdsByStratum(formalFixtures, profile, surface) {
  return Object.fromEntries(
    D9_STRATA[surface].map(stratum => [
      stratum,
      formalFixtures
        .filter(fixture => (
          fixture.profile === profile
          && fixture.surface === surface
          && fixture.stratum === stratum
        ))
        .map(fixture => fixture.fixtureId),
    ]),
  );
}

function sessionEntry({
  globalSequenceIndex,
  assignment,
  eligibility,
  arm,
  fixture,
}) {
  const pairId = eligibility === 'paired-eligible'
    ? canonicalSha256({
        v: 'd9-pair-v1',
        profile: assignment.profile,
        surface: assignment.surface,
        stratum: assignment.stratum,
        pairIndex: assignment.pairIndex,
        fixtureId: assignment.fixtureId,
      })
    : null;
  const identity = {
    v: 'd9-product-session-v1',
    globalSequenceIndex,
    profile: assignment.profile,
    surface: assignment.surface,
    stratum: assignment.stratum,
    fixtureId: assignment.fixtureId,
    pairId,
    arm,
  };
  return deepFreeze({
    ...identity,
    sessionKey: canonicalSha256(identity),
    eligibility,
    pairIndex: assignment.pairIndex,
    cellSequenceIndex: assignment.sequenceIndex,
    fixtureDigest: fixture.digest,
  });
}

export function createFormalExecutionPlan(formalFixtures) {
  const byId = fixtureMap(formalFixtures);
  const plan = [];
  for (const profile of D9_PROFILE_ORDER) {
    for (const surface of D9_SURFACE_ORDER) {
      const eligibility = D9_EXPECTED_ELIGIBILITY[`${profile}:${surface}`];
      const assignments = createCellAssignment({
        profile,
        surface,
        eligibility,
        fixtureIdsByStratum: fixtureIdsByStratum(
          formalFixtures,
          profile,
          surface,
        ),
      });
      for (const assignment of assignments) {
        const fixture = byId.get(assignment.fixtureId);
        if (!fixture) fail('KIMI_D9_EXECUTION_PLAN_INVALID');
        const arms = eligibility === 'paired-eligible'
          ? (
              assignment.firstArm === 'baseline-first'
                ? ['baseline', 'candidate']
                : ['candidate', 'baseline']
            )
          : ['candidate'];
        for (const arm of arms) {
          plan.push(sessionEntry({
            globalSequenceIndex: plan.length,
            assignment,
            eligibility,
            arm,
            fixture,
          }));
        }
      }
    }
  }
  if (plan.length !== 180) fail('KIMI_D9_EXECUTION_PLAN_INVALID');
  return deepFreeze(plan);
}

function validBoundedRecord(entry, record) {
  if (
    typeof record !== 'object'
    || record === null
    || Array.isArray(record)
    || record.sessionKey !== entry.sessionKey
    || !STATUSES.has(record.status)
    || typeof record.taskSuccess !== 'boolean'
    || typeof record.toolSuccess !== 'boolean'
    || typeof record.continuitySuccess !== 'boolean'
  ) {
    return false;
  }
  return !Object.keys(record).some(key => FORBIDDEN_RECORD_KEYS.has(key));
}

export function validateBoundedResults(plan, records) {
  if (
    !Array.isArray(plan)
    || !Array.isArray(records)
    || plan.length !== records.length
    || plan.some((entry, index) => !validBoundedRecord(entry, records[index]))
    || new Set(records.map(record => record.sessionKey)).size !== records.length
  ) {
    fail('KIMI_D9_BOUNDED_RESULTS_INVALID');
  }
  return true;
}

export async function runFormalExecutionPlan({
  plan,
  runSession,
  onRecord,
}) {
  if (!Array.isArray(plan) || typeof runSession !== 'function') {
    fail('KIMI_D9_EXECUTION_PLAN_INVALID');
  }
  const records = [];
  for (const entry of plan) {
    const record = await runSession(entry);
    if (!validBoundedRecord(entry, record)) {
      fail('KIMI_D9_BOUNDED_RESULTS_INVALID');
    }
    records.push(deepFreeze(structuredClone(record)));
    if (onRecord) await onRecord(records.at(-1), entry);
  }
  validateBoundedResults(plan, records);
  return deepFreeze(records);
}
