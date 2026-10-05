import { describe, expect, it } from 'vitest';
import { validateSemanticCompactionLedger, mergeSemanticCompactionLedgers, reserveSemanticCompaction,
  transitionSemanticReservation, commitSemanticCompaction, type SemanticCompactionLedger,
} from '../../../src/runtime/sol-pi/semantic-compaction-ledger.js';

const hash = 'a'.repeat(64);
const initial = (): SemanticCompactionLedger => ({ version: 1, currency: 'USD', generation: 0,
  policies: [{ grantId: 'g1', maxCalls: 2, maxCostUnits: 100, expiresAt: 1000 }], reservations: [], commits: [] });
const request = { operationId: 'op1', grantId: 'g1', bodyDigest: hash, sourceHistoryDigest: hash,
  model: 'deepseek-flash', priceRevision: hash, maximumCostUnits: 40 };

describe('durable semantic compaction budget and commit facts', () => {
  it('precharges before dispatch and preserves charge across a JSON restart', () => {
    const reserved = reserveSemanticCompaction(initial(), request, 10);
    const loaded = validateSemanticCompactionLedger(JSON.parse(JSON.stringify(reserved)));
    expect(loaded.reservations[0].status).toBe('reserved');
    expect(reserveSemanticCompaction(loaded, request, 20)).toEqual(loaded);
    expect(() => reserveSemanticCompaction(loaded, { ...request, bodyDigest: 'b'.repeat(64) }, 20)).toThrow();
    expect(() => reserveSemanticCompaction(loaded, { ...request, operationId: 'op2', maximumCostUnits: 61 }, 20)).toThrow();
  });
  it('will not revive or remove charged reservations through stale ordinary snapshots', () => {
    const a = reserveSemanticCompaction(initial(), request, 10);
    expect(mergeSemanticCompactionLedgers(a, undefined)).toEqual(a);
    expect(() => mergeSemanticCompactionLedgers(a, initial())).toThrow();
    const b = transitionSemanticReservation(a, 'op1', 'dispatched');
    expect(() => mergeSemanticCompactionLedgers(b, a)).toThrow();
    expect(() => transitionSemanticReservation(b, 'op1', 'reserved')).toThrow();
  });
  it('unknown dispatch consumes the full reservation and cannot be dispatched again', () => {
    const a = transitionSemanticReservation(reserveSemanticCompaction(initial(), request, 10), 'op1', 'dispatched');
    const b = transitionSemanticReservation(a, 'op1', 'unknown');
    expect(() => transitionSemanticReservation(b, 'op1', 'dispatched')).toThrow();
    expect(() => reserveSemanticCompaction(b, { ...request, operationId: 'op2', maximumCostUnits: 61 }, 20)).toThrow();
  });
  it('commits only a settled summary once and rejects generation or anchor rewrite', () => {
    const reserved = reserveSemanticCompaction(initial(), request, 10);
    const fact = { operationId: 'op1', sourceHistoryDigest: hash, nextHistoryDigest: 'b'.repeat(64), anchorDigest: 'c'.repeat(64) };
    expect(() => commitSemanticCompaction(reserved, fact)).toThrow();
    const settled = transitionSemanticReservation(transitionSemanticReservation(reserved, 'op1', 'dispatched'), 'op1', 'settled');
    const committed = commitSemanticCompaction(settled, fact);
    expect(committed.generation).toBe(1);
    expect(commitSemanticCompaction(committed, fact)).toEqual(committed);
    expect(() => commitSemanticCompaction(committed, { ...fact, anchorDigest: hash })).toThrow();
    expect(() => mergeSemanticCompactionLedgers(committed, settled)).toThrow();
  });
  it('checks request and monetary limits independently, expiry and mutation of prior policy', () => {
    const a = reserveSemanticCompaction(initial(), request, 10);
    const b = reserveSemanticCompaction(a, { ...request, operationId: 'op2', maximumCostUnits: 1 }, 20);
    expect(() => reserveSemanticCompaction(b, { ...request, operationId: 'op3', maximumCostUnits: 1 }, 30)).toThrow();
    expect(() => reserveSemanticCompaction(initial(), request, 1000)).toThrow();
    const raised = structuredClone(a); raised.policies[0].maxCostUnits = 100000;
    expect(() => mergeSemanticCompactionLedgers(a, raised)).toThrow();
  });
  it.each([NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid money %s', value => {
    expect(() => reserveSemanticCompaction(initial(), { ...request, maximumCostUnits: value }, 10)).toThrow();
  });
  it('rejects duplicate identities, orphan commits, unknown fields and oversized material', () => {
    const a = reserveSemanticCompaction(initial(), request, 10);
    expect(() => validateSemanticCompactionLedger({ ...a, reservations: [...a.reservations, ...a.reservations] })).toThrow();
    expect(() => validateSemanticCompactionLedger({ ...a, credential: 'forbidden' })).toThrow();
    expect(() => validateSemanticCompactionLedger({ ...a, generation: 1 })).toThrow();
    expect(() => reserveSemanticCompaction(a, { ...request, operationId: 'x'.repeat(300000) }, 10)).toThrow();
    const loaded = validateSemanticCompactionLedger(a); loaded.policies[0].maxCalls = 999;
    expect(a.policies[0].maxCalls).toBe(2);
  });
});
