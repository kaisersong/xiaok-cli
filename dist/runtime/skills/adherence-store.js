import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getConfigDir } from '../../utils/config.js';
const ADHERENCE_SCHEMA_VERSION = 1;
export class FileSkillAdherenceStore {
    filePath;
    constructor(filePath = join(getConfigDir(), 'skills', 'adherence.json')) {
        this.filePath = filePath;
    }
    loadAll() {
        if (!existsSync(this.filePath)) {
            return [];
        }
        const parsed = JSON.parse(readFileSync(this.filePath, 'utf8'));
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
    record(skillName, compliance) {
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
        }
        else {
            target.failedCount += 1;
            for (const reason of deriveFailureReasons(compliance)) {
                target.failedByReason[reason] = (target.failedByReason[reason] ?? 0) + 1;
            }
        }
        target.updatedAt = compliance.checkedAt;
        this.saveAll(records);
    }
    saveAll(records) {
        mkdirSync(dirname(this.filePath), { recursive: true });
        const document = {
            schemaVersion: ADHERENCE_SCHEMA_VERSION,
            records,
        };
        writeFileSync(this.filePath, JSON.stringify(document, null, 2), 'utf8');
    }
}
export function deriveFailureReasons(compliance) {
    const reasons = [];
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
