import { randomUUID } from 'node:crypto';
export class GoalEvidenceCollector {
    input;
    facts = new Map();
    finished = new Map();
    ready = [];
    constructor(input) {
        this.input = input;
    }
    accept(event) {
        if (!('turnId' in event) || event.turnId !== this.input.goalTurnId)
            return;
        if (event.type === 'tool_execution_fact') {
            this.facts.set(event.invocationId, event);
            this.tryPair(event.invocationId);
        }
        else if (event.type === 'tool_finished') {
            this.finished.set(event.invocationId, event);
            this.tryPair(event.invocationId);
        }
    }
    settleTurn() {
        this.facts.clear();
        this.finished.clear();
    }
    flush() {
        return this.ready.splice(0);
    }
    tryPair(invocationId) {
        const fact = this.facts.get(invocationId);
        const finished = this.finished.get(invocationId);
        if (!fact || !finished)
            return;
        this.facts.delete(invocationId);
        this.finished.delete(invocationId);
        if (!finished.ok)
            return;
        const recordedAt = (this.input.now ?? Date.now)();
        if (fact.factKind === 'command_result' && fact.exitCode === 0) {
            this.ready.push({
                goalId: this.input.goalId,
                epoch: this.input.epoch,
                goalTurnId: this.input.goalTurnId,
                evidenceId: `goal_ev_${randomUUID()}`,
                recordedAt,
                record: {
                    ownerKind: 'goal', ownerId: this.input.goalId, kind: 'command_action',
                    summary: `${fact.toolName} exited successfully`,
                    metadata: { commands: [{ command: fact.toolName, summary: 'completed', exitCode: 0 }] },
                },
            });
        }
        if (fact.factKind === 'file_mutation' && fact.normalizedFilePaths?.length) {
            this.ready.push({
                goalId: this.input.goalId,
                epoch: this.input.epoch,
                goalTurnId: this.input.goalTurnId,
                evidenceId: `goal_ev_${randomUUID()}`,
                recordedAt,
                record: {
                    ownerKind: 'goal', ownerId: this.input.goalId, kind: 'file_artifact',
                    summary: fact.normalizedFilePaths.join(', '),
                    uri: fact.normalizedFilePaths[0],
                    metadata: { paths: fact.normalizedFilePaths },
                },
            });
        }
    }
}
