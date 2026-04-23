import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export type RegressionKind = 'test' | 'eval' | 'ux' | 'routing' | 'artifact' | 'reliability';
export type RegressionSource = 'manual' | 'runtime' | 'eval';
export type RegressionSuggestedLayer =
  | 'unit'
  | 'integration'
  | 'structured-eval'
  | 'artifact-smoke'
  | 'manual'
  | 'slow-gate';
export type RegressionEvidenceKind = 'transcript' | 'artifact' | 'trace' | 'feedback' | 'note' | 'path';

export interface RegressionEvidence {
  kind: RegressionEvidenceKind;
  value: string;
}

export interface RegressionRecord {
  id: string;
  title: string;
  summary: string;
  kind: RegressionKind;
  source: RegressionSource;
  suggestedLayer: RegressionSuggestedLayer;
  createdAt: string;
  evidence: RegressionEvidence[];
}

export interface CreateRegressionRecordInput {
  id?: string;
  title: string;
  summary: string;
  kind: RegressionKind;
  source: RegressionSource;
  suggestedLayer: RegressionSuggestedLayer;
  evidence?: RegressionEvidence[];
  createdAt?: string;
}

export interface WriteRegressionRecordInput extends CreateRegressionRecordInput {
  outputDir?: string;
  overwrite?: boolean;
}

export interface WriteRegressionRecordResult {
  record: RegressionRecord;
  path: string;
}

export function createRegressionRecord(input: CreateRegressionRecordInput): RegressionRecord {
  const id = input.id ? slugifyRegressionId(input.id) : slugifyRegressionId(input.title);
  if (!id) {
    throw new Error('regression id resolved to empty value');
  }

  return {
    id,
    title: input.title.trim(),
    summary: input.summary.trim(),
    kind: input.kind,
    source: input.source,
    suggestedLayer: input.suggestedLayer,
    createdAt: input.createdAt ?? new Date().toISOString(),
    evidence: (input.evidence ?? []).map((item) => ({
      kind: item.kind,
      value: item.value,
    })),
  };
}

export function writeRegressionRecord(input: WriteRegressionRecordInput): WriteRegressionRecordResult {
  const record = createRegressionRecord(input);
  const outputDir = resolve(input.outputDir ?? join(process.cwd(), 'evals', 'regressions'));
  mkdirSync(outputDir, { recursive: true });

  const path = join(outputDir, `${record.id}.json`);
  if (existsSync(path) && !input.overwrite) {
    throw new Error(`regression record already exists: ${path}`);
  }

  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return { record, path };
}

export function slugifyRegressionId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
