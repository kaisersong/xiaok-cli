import { createHash } from 'node:crypto';

export function computeBaselineHash(input: unknown): string {
  return `sha256:${createHash('sha256').update(stableStringify(input)).digest('hex')}`;
}

export function validateBaselineUpdate(input: {
  oldBaseline: unknown;
  newBaseline: unknown;
  manifestOverride?: { actor: string; reason: string };
}): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const newFailures = extractFailures(input.newBaseline);
  for (const failure of newFailures) {
    if (failure.severity === 'critical' || failure.severity === 'high') {
      if (!input.manifestOverride?.actor || !input.manifestOverride.reason.trim()) {
        errors.push(`failureCategoryDelta:${failure.severity}:${failure.category}`);
      }
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

function extractFailures(value: unknown): Array<{ category: string; severity: string }> {
  if (!isRecord(value) || !Array.isArray(value.failures)) return [];
  return value.failures
    .filter(isRecord)
    .map((failure) => ({
      category: String(failure.category ?? 'unknown'),
      severity: String(failure.severity ?? 'unknown'),
    }));
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
