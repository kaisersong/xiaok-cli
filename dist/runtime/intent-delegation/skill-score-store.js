import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getConfigDir } from '../../utils/config.js';
import { buildSkillScoreKey, cloneContextualSkillScoreRecord, computeContextualSkillBoost, } from './skill-eval.js';
const SCORE_SCHEMA_VERSION = 1;
export class FileSkillScoreStore {
    filePath;
    constructor(filePath = join(getConfigDir(), 'intent-delegation', 'skill-scores.json')) {
        this.filePath = filePath;
    }
    loadAll() {
        if (!existsSync(this.filePath)) {
            return [];
        }
        const parsed = JSON.parse(readFileSync(this.filePath, 'utf8'));
        if (parsed.schemaVersion !== SCORE_SCHEMA_VERSION || !Array.isArray(parsed.entries)) {
            return [];
        }
        return parsed.entries.map(cloneContextualSkillScoreRecord);
    }
    getBoost(input) {
        const entry = this.loadAll().find((candidate) => buildSkillScoreKey(candidate) === buildSkillScoreKey(input));
        return computeContextualSkillBoost(entry);
    }
    recordRuntimeObservation(observation) {
        if (!observation.actualSkillName) {
            return;
        }
        if (observation.status !== 'completed' && observation.status !== 'failed') {
            return;
        }
        const actualSkillName = observation.actualSkillName;
        this.mutate((entries) => {
            const entry = getOrCreateEntry(entries, {
                skillName: actualSkillName,
                intentType: observation.intentType,
                stageRole: observation.stageRole,
                deliverableFamily: observation.deliverableFamily,
            });
            const target = observation.status === 'completed'
                ? entry.runtimeSuccessObservationIds
                : entry.runtimeFailureObservationIds;
            if (!target.includes(observation.observationId)) {
                target.push(observation.observationId);
                entry.updatedAt = Date.now();
            }
        });
    }
    recordFeedback(feedback, observations) {
        const relevant = observations.filter((observation) => Boolean(observation.actualSkillName));
        if (relevant.length === 0) {
            return;
        }
        this.mutate((entries) => {
            for (const observation of relevant) {
                const entry = getOrCreateEntry(entries, {
                    skillName: observation.actualSkillName,
                    intentType: observation.intentType,
                    stageRole: observation.stageRole,
                    deliverableFamily: observation.deliverableFamily,
                });
                const target = selectFeedbackTarget(entry, feedback);
                if (!target.includes(feedback.feedbackId)) {
                    target.push(feedback.feedbackId);
                    entry.updatedAt = feedback.createdAt;
                }
            }
        });
    }
    mutate(apply) {
        const entries = this.loadAll();
        apply(entries);
        mkdirSync(dirname(this.filePath), { recursive: true });
        const document = {
            schemaVersion: SCORE_SCHEMA_VERSION,
            entries: entries.map(cloneContextualSkillScoreRecord),
        };
        writeFileSync(this.filePath, JSON.stringify(document, null, 2), 'utf8');
    }
}
function getOrCreateEntry(entries, input) {
    const existing = entries.find((candidate) => buildSkillScoreKey(candidate) === buildSkillScoreKey(input));
    if (existing) {
        return existing;
    }
    const created = {
        ...input,
        runtimeSuccessObservationIds: [],
        runtimeFailureObservationIds: [],
        routingPositiveFeedbackIds: [],
        routingNegativeFeedbackIds: [],
        outcomePositiveFeedbackIds: [],
        outcomeNegativeFeedbackIds: [],
        updatedAt: Date.now(),
    };
    entries.push(created);
    return created;
}
function selectFeedbackTarget(entry, feedback) {
    if (feedback.kind === 'routing') {
        return feedback.sentiment === 'positive'
            ? entry.routingPositiveFeedbackIds
            : entry.routingNegativeFeedbackIds;
    }
    return feedback.sentiment === 'positive'
        ? entry.outcomePositiveFeedbackIds
        : entry.outcomeNegativeFeedbackIds;
}
