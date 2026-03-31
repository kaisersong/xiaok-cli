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
