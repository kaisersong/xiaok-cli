import { createHash } from 'node:crypto';
import {
  D9_RANDOMIZATION_MASTER_SEED,
  D9_SAMPLES_PER_STRATUM,
  D9_STRATA,
} from './constants.mjs';

function assignmentError() {
  return new Error('KIMI_D9_ASSIGNMENT_INVALID');
}

export function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function deriveAssignmentSeed(masterSeed, ...labels) {
  const digest = createHash('sha256')
    .update([String(masterSeed), ...labels].join('\0'))
    .digest();
  return digest.readUInt32BE(0);
}

function shuffledFixtureIds(profile, surface, stratum, fixtureIds) {
  const values = [...fixtureIds];
  const random = mulberry32(deriveAssignmentSeed(
    D9_RANDOMIZATION_MASTER_SEED,
    'track-a-d9',
    profile,
    surface,
    stratum,
  ));
  for (let index = values.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [values[index], values[target]] = [values[target], values[index]];
  }
  return values;
}

export function createCellAssignment({
  profile,
  surface,
  eligibility,
  fixtureIdsByStratum,
}) {
  if (
    !['k3', 'k3-256k'].includes(profile)
    || !Object.hasOwn(D9_STRATA, surface)
    || !['paired-eligible', 'no-product-baseline'].includes(eligibility)
    || typeof fixtureIdsByStratum !== 'object'
    || fixtureIdsByStratum === null
  ) {
    throw assignmentError();
  }
  const strata = D9_STRATA[surface];
  if (
    Reflect.ownKeys(fixtureIdsByStratum).length !== strata.length
    || strata.some(stratum => !Object.hasOwn(fixtureIdsByStratum, stratum))
  ) {
    throw assignmentError();
  }

  const seen = new Set();
  const byStratum = new Map();
  for (const stratum of strata) {
    const fixtures = fixtureIdsByStratum[stratum];
    if (
      !Array.isArray(fixtures)
      || fixtures.length !== D9_SAMPLES_PER_STRATUM
      || fixtures.some(fixtureId => (
        typeof fixtureId !== 'string'
        || fixtureId.length === 0
        || seen.has(fixtureId)
      ))
    ) {
      throw assignmentError();
    }
    for (const fixtureId of fixtures) seen.add(fixtureId);
    byStratum.set(
      stratum,
      shuffledFixtureIds(profile, surface, stratum, fixtures),
    );
  }

  const records = [];
  for (let round = 0; round < D9_SAMPLES_PER_STRATUM; round += 1) {
    for (const stratum of strata) {
      const record = {
        sequenceIndex: records.length,
        profile,
        surface,
        stratum,
        fixtureId: byStratum.get(stratum)[round],
        pairIndex: round,
      };
      if (eligibility === 'paired-eligible') {
        record.firstArm = round % 2 === 0
          ? 'baseline-first'
          : 'candidate-first';
      }
      records.push(record);
    }
  }
  return records;
}
