import type { HarnessResearchManifest } from './harness-optimization-types.js';
const positive = (value: number) => Number.isSafeInteger(value) && value > 0;
const digest = (value: string) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function validateRegisteredHarnessManifest(input: HarnessResearchManifest | undefined,
  scope: { ownerId: string; profileId: string; workspaceId: string }, now: number): HarnessResearchManifest {
  if (!input) throw new Error('research_manifest_unavailable');
  const m = structuredClone(input);
  if (m.ownerId !== scope.ownerId || m.profileId !== scope.profileId || m.workspaceId !== scope.workspaceId) throw new Error('manifest_scope_forbidden');
  if (!['probe', 'formal-evaluation'].includes(m.executionKind) || !/^[a-zA-Z0-9_-]{1,128}$/.test(m.id)
    || !digest(m.behaviorFingerprint) || !digest(m.bindingHash) || !positive(m.expiresAt) || m.expiresAt <= now
    || !m.perRun || ![m.perRun.tokens, m.perRun.requests, m.perRun.timeoutMs, m.machineBoundMs].every(positive)
    || m.perRun.tokens > 10000000 || m.perRun.requests > 1000 || m.perRun.timeoutMs > 1800000
    || m.machineBoundMs > m.perRun.timeoutMs || !Array.isArray(m.steps) || m.steps.length === 0 || m.steps.length > m.perRun.requests) throw new Error('manifest_invalid');
  let tokens = 0, timeout = 1000;
  const ids = new Set<string>();
  for (const step of m.steps) {
    if (!step || !/^[a-zA-Z0-9_-]{1,128}$/.test(step.id) || ids.has(step.id) || !digest(step.bodyHash)
      || !positive(step.tokens) || !positive(step.timeoutMs)) throw new Error('manifest_invalid');
    ids.add(step.id); tokens += step.tokens; timeout += step.timeoutMs;
  }
  if (tokens > m.perRun.tokens || timeout > m.machineBoundMs) throw new Error('manifest_invalid');
  return m;
}
