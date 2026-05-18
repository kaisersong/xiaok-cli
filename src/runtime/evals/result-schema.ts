import { existsSync, readFileSync } from 'node:fs';
import { computeBaselineHash } from './baseline.js';
import { diagnoseTraceBundle } from '../diagnostics/diagnoser.js';
import type { DiagnosisFinding } from '../diagnostics/types.js';
import { validateTraceBundle, type TraceBundleV1 } from '../trace/schema.js';

export interface AheLiteEvalResult {
  evalId: string;
  ok: boolean;
  expectedFailureCategory: string;
  actualFailureCategory: string;
  primaryFinding: string;
  evidenceIds: string[];
  traceBundlePath: string;
  baselineHash: string;
  durationMs: number;
  environment: { mode: 'deterministic' | 'live'; failureClass?: 'product' | 'infra' | 'timeout' | 'skipped' };
}

export function validateAheLiteEvalResult(
  input: unknown,
  options: { baselinePath: string },
): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(input)) return { ok: false, errors: ['evalResult'] };

  const traceBundlePath = typeof input.traceBundlePath === 'string' ? input.traceBundlePath : '';
  let bundle: TraceBundleV1 | null = null;
  if (!traceBundlePath || !existsSync(traceBundlePath)) {
    errors.push('traceBundlePath');
  } else {
    try {
      bundle = JSON.parse(readFileSync(traceBundlePath, 'utf8')) as TraceBundleV1;
      const validation = validateTraceBundle(bundle);
      if (!validation.ok) errors.push(...validation.errors.map((error) => `trace:${error}`));
    } catch {
      errors.push('traceBundlePath:json');
    }
  }

  if (bundle) {
    const report = diagnoseTraceBundle(bundle);
    const guardFinding = deriveGuardFinding(bundle);
    const primary = report.primaryFinding ?? guardFinding;
    const evidenceIds = Array.isArray(input.evidenceIds) ? input.evidenceIds.map(String) : [];
    evidenceIds.forEach((id, index) => {
      if (!resolveEvidenceId(bundle!, id)) errors.push(`evidenceIds[${index}]:${id}`);
    });

    const expectedPrimary = primary ? findingSignature(primary.category, primary.evidenceIds[0]) : '';
    if (input.primaryFinding !== expectedPrimary) errors.push(`primaryFinding:${String(input.primaryFinding)}`);
    if (input.actualFailureCategory !== primary?.category) {
      errors.push(`actualFailureCategory:${String(input.actualFailureCategory)}`);
    }
  }

  if (!existsSync(options.baselinePath)) {
    errors.push('baselinePath');
  } else {
    const baseline = JSON.parse(readFileSync(options.baselinePath, 'utf8')) as unknown;
    if (input.baselineHash !== computeBaselineHash(baseline)) errors.push('baselineHash');
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

function findingSignature(category: string, evidenceId?: string): string {
  const suffix = evidenceId?.startsWith('task:') ? evidenceId.slice('task:'.length) : evidenceId;
  return suffix ? `${category}:${suffix}` : category;
}

function deriveGuardFinding(bundle: TraceBundleV1): DiagnosisFinding | null {
  const event = bundle.events.find((item) => (
    (item.type === 'guard.warned' || item.type === 'guard.blocked')
    && typeof item.data?.category === 'string'
  ));
  if (!event || typeof event.data?.category !== 'string') return null;
  const evidenceId = event.refs?.taskId
    ? `task:${event.refs.taskId}`
    : `event:${event.id}`;
  return {
    id: `finding:${event.data.category}:${event.id}`,
    severity: event.type === 'guard.blocked' ? 'critical' : 'medium',
    category: event.data.category as DiagnosisFinding['category'],
    title: String(event.data.reason ?? event.data.category),
    explanation: String(event.data.action ?? event.data.reason ?? event.data.category),
    confidence: 0.8,
    evidenceIds: [evidenceId],
  };
}

function resolveEvidenceId(bundle: TraceBundleV1, evidenceId: string): boolean {
  const [kind, id] = evidenceId.split(':', 2);
  if (!kind || !id) return false;
  if (kind === 'task') return bundle.tasks.some((task) => task.id === id);
  if (kind === 'tool') return bundle.toolCalls.some((tool) => tool.id === id);
  if (kind === 'artifact') return bundle.artifacts.some((artifact) => artifact.id === id);
  if (kind === 'event') return bundle.events.some((event) => event.id === id);
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
