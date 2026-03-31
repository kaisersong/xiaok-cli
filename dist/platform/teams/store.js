import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
export class InMemoryTeamStore {
    teams = new Map();
    messages = new Map();
    nextTeamId = 1;
    nextMessageId = 1;
    createTeam(input) {
        const now = Date.now();
        const team = {
            ...input,
            teamId: `team_${this.nextTeamId++}`,
            createdAt: now,
            updatedAt: now,
        };
        this.teams.set(team.teamId, team);
        return team;
    }
    getTeam(teamId) {
        return this.teams.get(teamId);
    }
    deleteTeam(teamId) {
        this.teams.delete(teamId);
        this.messages.delete(teamId);
    }
    listTeams() {
        return [...this.teams.values()];
    }
    appendMessage(input) {
        const message = {
            ...input,
            messageId: `msg_${this.nextMessageId++}`,
            createdAt: Date.now(),
        };
        const existing = this.messages.get(input.teamId) ?? [];
        existing.push(message);
        this.messages.set(input.teamId, existing);
        return message;
    }
    listMessages(teamId) {
        return [...(this.messages.get(teamId) ?? [])];
    }
}
export class FileTeamStore extends InMemoryTeamStore {
    filePath;
    constructor(filePath) {
        super();
        this.filePath = filePath;
        this.load();
    }
    createTeam(input) {
        const team = super.createTeam(input);
        this.persist();
        return team;
    }
    deleteTeam(teamId) {
        super.deleteTeam(teamId);
        this.persist();
    }
    appendMessage(input) {
        const message = super.appendMessage(input);
        this.persist();
        return message;
    }
    load() {
        if (!existsSync(this.filePath)) {
            return;
        }
        try {
            const parsed = JSON.parse(readFileSync(this.filePath, 'utf8'));
            if (parsed.schemaVersion !== 1) {
                return;
            }
            this.restore({
                teams: Array.isArray(parsed.teams) ? parsed.teams : [],
                messages: Array.isArray(parsed.messages) ? parsed.messages : [],
                nextTeamId: 1,
                nextMessageId: 1,
            });
        }
        catch {
            return;
        }
    }
    restore(state) {
        this.teams.clear();
        this.messages.clear();
        let maxTeamId = 0;
        let maxMessageId = 0;
        for (const team of state.teams) {
            if (!team?.teamId) {
                continue;
            }
            this.teams.set(team.teamId, team);
            maxTeamId = Math.max(maxTeamId, extractSequence(team.teamId, 'team_'));
        }
        for (const message of state.messages) {
            if (!message?.messageId || !message.teamId) {
                continue;
            }
            const existing = this.messages.get(message.teamId) ?? [];
            existing.push(message);
            this.messages.set(message.teamId, existing);
            maxMessageId = Math.max(maxMessageId, extractSequence(message.messageId, 'msg_'));
        }
        this.nextTeamId = Math.max(state.nextTeamId, maxTeamId + 1);
        this.nextMessageId = Math.max(state.nextMessageId, maxMessageId + 1);
    }
    persist() {
        mkdirSync(dirname(this.filePath), { recursive: true });
        const messages = [...this.messages.values()].flat().sort((a, b) => a.createdAt - b.createdAt);
        const doc = {
            schemaVersion: 1,
            teams: this.listTeams(),
            messages,
        };
        writeFileSync(this.filePath, JSON.stringify(doc, null, 2), 'utf8');
    }
}
function extractSequence(value, prefix) {
    if (!value.startsWith(prefix)) {
        return 0;
    }
    const parsed = Number(value.slice(prefix.length));
    return Number.isFinite(parsed) ? parsed : 0;
}
