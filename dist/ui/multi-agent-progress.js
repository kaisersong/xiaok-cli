import { publicAgentSummary } from '../ai/agents/subagent-presentation.js';
import { getUiCopy } from './locale.js';
import { formatSubAgentCodename } from './render.js';
import { stripAnsi, truncateAnsi } from './text-metrics.js';
function inline(value) {
    return stripAnsi(value.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')).replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
}
function age(ms) {
    if (ms < 1000)
        return `${Math.max(0, ms / 1000).toFixed(1)}s`;
    const seconds = Math.max(0, Math.floor(ms / 1000));
    return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m${seconds % 60}s`;
}
function fitStyledLine(text, columns) {
    const clipped = truncateAnsi(text, Math.max(0, columns));
    // Truncation may cut the name before its reset. Never style the next UI row.
    return clipped.includes('\x1b') ? `${clipped}\x1b[0m` : clipped;
}
/** Preserve notice order without interleaving a question frame or streamed text. */
export class SubAgentNoticeQueue {
    pending = [];
    get hasPending() { return this.pending.length > 0; }
    push(block) { if (block)
        this.pending.push(block); }
    flush(canWrite, write) {
        if (!canWrite || this.pending.length === 0)
            return;
        const blocks = this.pending;
        this.pending = [];
        write(blocks.join('\n'));
    }
}
/** A projection of coordinator events, not a second execution/status owner. */
export class MultiAgentProgressView {
    agents = new Map();
    aliases = new Map();
    runs = new Map();
    alias(id, locale) {
        if (!this.aliases.has(id))
            this.aliases.set(id, this.aliases.size);
        const index = this.aliases.get(id);
        const names = getUiCopy(locale).subAgents.constellations;
        return `${names[index % names.length]}${index >= names.length ? `-${Math.floor(index / names.length) + 1}` : ''}`;
    }
    updateRun(event, columns = 100, locale = 'zh-CN') {
        const previous = this.runs.get(event.agentId);
        if (previous && (previous.turn > event.turn || (previous.turn === event.turn
            && (previous.kind === 'finished' || event.timestamp < previous.timestamp))))
            return '';
        this.runs.set(event.agentId, { ...event, toolCounts: { ...event.toolCounts } });
        const alias = this.alias(event.agentId, locale);
        const labels = getUiCopy(locale).subAgents;
        if (event.kind === 'activity' || (event.kind === 'started' && previous?.turn === event.turn))
            return '';
        const line = (value, heading = false) => {
            // Sanitize and clip plain text before applying our own ANSI. A name cut
            // short in a very narrow terminal remains plain rather than half-styled.
            const clipped = truncateAnsi(`  ${heading ? '╭─' : '│'} ${publicAgentSummary(value, 600)}`, Math.max(0, columns));
            return `${heading ? clipped.replace(alias, formatSubAgentCodename(alias)) : clipped}\n`;
        };
        const heading = `${labels.collaboration} · ${alias} · ${event.kind === 'started' ? labels.started : labels.statuses[event.status]} · ${labels.round(event.turn)}`;
        let text = `\n${line(heading, true)}${line(`${labels.assignment}：${event.task}`)}`;
        if (event.kind === 'finished') {
            const breakdown = Object.entries(event.toolCounts).map(([name, count]) => `${publicAgentSummary(name, 30)} ${count}`).join(' / ');
            text += line(`${labels.tools(event.toolsCompleted)}${event.toolsFailed ? ` · ${labels.failures(event.toolsFailed)}` : ''} · ${labels.elapsed} ${age(event.elapsedMs)}${breakdown ? ` · ${breakdown}` : ''}`);
            if (event.resultSummary)
                text += line(`${labels.result}：${event.resultSummary}`);
        }
        return text;
    }
    update(event) {
        if (!event.agent.parentId)
            return;
        this.agents.set(event.agent.id, { ...event.agent });
        if (this.agents.size > 32) {
            const retired = [...this.agents.values()].find((agent) => agent.resourcesReleased);
            if (retired)
                this.agents.delete(retired.id);
        }
    }
    summary(now = Date.now(), columns = 100, locale = 'zh-CN') {
        const labels = getUiCopy(locale).subAgents;
        const agents = [...this.agents.values()].filter((agent) => !agent.resourcesReleased);
        for (const run of this.runs.values()) {
            if (run.status !== 'running' || this.agents.has(run.agentId))
                continue;
            agents.push({ id: run.agentId, taskName: run.taskName, canonicalName: '', parentId: 'main', depth: 1,
                status: 'running', unreadMessages: 0, turn: run.turn, startedAt: run.startedAt,
                lastActivityAt: run.timestamp, phase: run.phase, currentTool: run.currentTool, executionHealth: run.executionHealth,
                executionActive: true, resourcesReleased: false, runtimeResident: true });
        }
        if (agents.length === 0)
            return '';
        agents.sort((left, right) => Number(right.executionActive) - Number(left.executionActive));
        const pieces = agents.map((agent) => {
            const label = agent.executionActive && agent.executionHealth === 'cleanup_pending' ? labels.stalled : agent.status === 'running'
                ? (agent.currentTool ? inline(agent.currentTool) : labels.phases[agent.phase ?? 'starting'])
                : agent.status === 'closed' && !agent.resourcesReleased ? labels.cleaning : labels.statuses[agent.status];
            const elapsed = agent.startedAt === undefined ? '' : ` ${age((agent.endedAt ?? now) - agent.startedAt)}`;
            const idle = agent.status === 'running' && agent.lastActivityAt !== undefined
                ? ` ${labels.idle}${age(now - agent.lastActivityAt)}` : '';
            const run = this.runs.get(agent.id);
            const name = run ? formatSubAgentCodename(this.alias(agent.id, locale)) : truncateAnsi(inline(agent.taskName), 24);
            return `${name}: ${label}${elapsed}${idle}`;
        });
        return pieces.map(piece => fitStyledLine(`${labels.title} ${piece}`, columns)).join('\n');
    }
}
