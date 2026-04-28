import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getConfigDir } from '../../utils/config.js';
import type { SkillComplianceResult } from '../../ai/skills/compliance.js';

const ADHERENCE_SCHEMA_VERSION = 1;

export interface SkillAdherenceRecord {
  skillName: string;
  passedCount: number;
  failedCount: number;
  failedByReason: Record<string, number>;
  updatedAt: number;
}

interface PersistedSkillAdherenceDocument {
  schemaVersion: typeof ADHERENCE_SCHEMA_VERSION;
  records: SkillAdherenceRecord[];
}

export class FileSkillAdherenceStore {
  constructor(private readonly filePath = join(getConfigDir(), 'skills', 'adherence.json')) {}

  loadAll(): SkillAdherenceRecord[] {
    if (!existsSync(this.filePath)) {
      return [];
    }

    const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<PersistedSkillAdherenceDocument>;
    if (parsed.schemaVersion !== ADHERENCE_SCHEMA_VERSION || !Array.isArray(parsed.records)) {
      return [];
    }

    return parsed.records.map((record) => ({
      skillName: record.skillName,
      passedCount: record.passedCount,
      failedCount: record.failedCount,
      failedByReason: { ...(record.failedByReason ?? {}) },
      updatedAt: record.updatedAt,
    }));
  }

  record(skillName: string, compliance: SkillComplianceResult): void {
    const records = this.loadAll();
    const existing = records.find((record) => record.skillName === skillName);
    const target = existing ?? {
      skillName,
      passedCount: 0,
      failedCount: 0,
      failedByReason: {},
      updatedAt: compliance.checkedAt,
    };

    if (!existing) {
      records.push(target);
    }

    if (compliance.passed) {
      target.passedCount += 1;
    } else {
      target.failedCount += 1;
      for (const reason of deriveFailureReasons(compliance)) {
        target.failedByReason[reason] = (target.failedByReason[reason] ?? 0) + 1;
      }
    }

    target.updatedAt = compliance.checkedAt;
    this.saveAll(records);
  }

  private saveAll(records: SkillAdherenceRecord[]): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const document: PersistedSkillAdherenceDocument = {
      schemaVersion: ADHERENCE_SCHEMA_VERSION,
      records,
    };
    writeFileSync(this.filePath, JSON.stringify(document, null, 2), 'utf8');
  }
}

export function deriveFailureReasons(compliance: SkillComplianceResult): string[] {
  const reasons: string[] = [];
  if (compliance.missingReferences.length > 0) {
    reasons.push('missingReferences');
  }
  if (compliance.missingScripts.length > 0) {
    reasons.push('missingScripts');
  }
  if (compliance.missingSteps.length > 0) {
    reasons.push('missingSteps');
  }
  if (compliance.failedChecks.length > 0) {
    reasons.push('failedChecks');
  }
  return reasons;
}
