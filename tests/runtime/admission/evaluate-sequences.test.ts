import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { evaluateAdmission, hashA2Data } from '../../../src/runtime/admission/evaluate.js';

const original = JSON.parse(readFileSync(new URL('./fixtures/a2-snapshot.json', import.meta.url), 'utf8'));

// Fixed replay corpus, not an alternative evaluator. Each step alters one
// explicit gate in a real production snapshot and replays the same request.
it('keeps 10,000 seeded gate/replay steps deterministic and never admits a denied input', () => {
  const seed = 0x6d736832;
  let state = seed, positive = 0, blocked = 0, shadow = 0;
  const cases = new Array<number>(20).fill(0);
  const next = () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return state >>> 0;
  };
  const healthy = evaluateAdmission(original);
  expect(healthy).toMatchObject({ kind: 'admission_suggestion', verdict: 'accept' });
  for (let step = 0; step < 10_000; step++) {
    const snapshot = JSON.parse(JSON.stringify(original));
    const selected = next() % cases.length;
    cases[selected]++;
    switch (selected) {
      case 0: break;
      case 1: snapshot.controls.value.prefixModes[next() % 5].mode = 'off'; break;
      case 2: snapshot.controls.value.prefixPolicies[next() % 20].allowed = false; break;
      case 3: snapshot.controls.value.leaves[next() % 4].contentHash = 'f'.repeat(64); break;
      case 4: snapshot.controls.value.baseline = 'pending'; break;
      case 5: snapshot.source.value.credential = 'revoked'; break;
      case 6: snapshot.source.value.provenance = 'unproven'; break;
      case 7: snapshot.source.value.actorMapping = 'unproven'; break;
      case 8: snapshot.budget.draft.value.remainingTokens = 0; break;
      case 9: snapshot.budget.draft.value.remainingCostMinor = 0; break;
      case 10: snapshot.budget.draft.value.remainingActiveWorks = 0; break;
      case 11: snapshot.clock.nowMs = Date.parse(snapshot.assessment.validUntil); break;
      case 12: snapshot.consumption = { state: 'known', value: { kind: 'pending' } }; break;
      case 13: snapshot.source.value.evidenceHeads[0].state = 'superseded'; break;
      case 14: snapshot.input.envelope.paginationComplete = false; break;
      case 15: snapshot.input.envelope.actorEvidence = { kind: 'unknown', reason: 'fixture-unknown-editor' }; break;
      case 16: snapshot.selection.value.value.assessmentId = 'unselected-assessment'; break;
      case 17: snapshot.assessment.suggestedIntent = 'ambiguous'; break; // Intentionally retains the old hash.
      case 18: snapshot.freshness.value.state = 'backlog'; break;
      case 19: snapshot.controls.value.prefixModes[next() % 5].mode = 'observe'; break;
    }
    const result = evaluateAdmission(snapshot), replay = evaluateAdmission(snapshot);
    if (hashA2Data(result) !== hashA2Data(replay)) throw Error(`a2_replay_changed:${seed}:${step}:${selected}`);
    const admitted = result.kind === 'admission_suggestion' && (result.verdict === 'accept' || result.verdict === 'followup');
    if (selected === 0) {
      if (!admitted || hashA2Data(result) !== hashA2Data(healthy)) throw Error(`a2_healthy_lost:${seed}:${step}`);
      positive++;
    } else {
      if (admitted) throw Error(`a2_denied_admitted:${seed}:${step}:${selected}`);
      if (result.kind === 'shadow_suggestion') shadow++;
      blocked++;
    }
  }
  expect(cases.every(count => count > 0)).toBe(true);
  expect(positive + blocked).toBe(10_000);
  console.log(JSON.stringify({ corpus: 'a2-gate-replay-v1', seed, steps: 10_000, calls: 20_001, positive, blocked, shadow, cases }));
}, 120_000);
