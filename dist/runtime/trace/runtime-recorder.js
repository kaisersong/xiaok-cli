import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { redactString, redactTraceValue } from './redactor.js';
import { normalizeRuntimeEvent } from './normalizer.js';
import { validateTraceBundle } from './schema.js';
import { TraceBundleWriter } from './writer.js';
export class RuntimeTraceRecorder {
    options;
    writer;
    turns = new Map();
    events = new Map();
    toolCalls = new Map();
    artifacts = new Map();
    redactions = [];
    toolOrdinal = 0;
    activeToolIds = new Map();
    constructor(options) {
        this.options = options;
        this.writer = new TraceBundleWriter({
            rootDir: options.rootDir,
            previewBytes: options.previewBytes,
            persistOutputBytes: options.persistOutputBytes,
        });
    }
    handleEvent(event) {
        try {
            this.recordEvent(event);
        }
        catch (error) {
            this.options.onWarning?.(error);
        }
    }
    async flush() {
        try {
            const bundle = this.createBundle();
            const validation = validateTraceBundle(bundle);
            if (!validation.ok) {
                throw new Error(`invalid runtime trace bundle: ${validation.errors.join(', ')}`);
            }
            return await this.writer.writeBundle(bundle);
        }
        catch (error) {
            this.options.onWarning?.(error);
            return null;
        }
    }
    createBundle() {
        const cwd = this.options.cwd ? redactString(this.options.cwd, 'environment.cwd') : undefined;
        const bundleRedactions = cwd ? [...this.redactions, ...cwd.redactions] : this.redactions;
        const createdAt = this.nowIso();
        const bundleId = `trace_${safeFilePart(this.options.sessionId)}_${createdAt.replace(/[^0-9]/g, '')}`;
        return {
            schemaVersion: 1,
            bundleId,
            createdAt,
            source: {
                app: 'xiaok-cli',
                version: this.options.version,
                command: this.options.command,
            },
            scope: { kind: 'session', sessionId: this.options.sessionId },
            environment: {
                cwd: cwd?.value,
            },
            turns: [...this.turns.values()],
            events: [...this.events.values()],
            toolCalls: [...this.toolCalls.values()],
            approvals: [],
            tasks: [],
            agents: [],
            artifacts: [...this.artifacts.values()],
            memoryRefs: [],
            skillEvidence: [],
            recovery: [],
            crashes: [],
            redactions: mergeRedactions(bundleRedactions),
            attachments: [],
            summary: {
                eventCount: this.events.size,
                turnCount: this.turns.size,
                toolCallCount: this.toolCalls.size,
                artifactCount: this.artifacts.size,
            },
        };
    }
    recordEvent(event) {
        if ('turnId' in event && typeof event.turnId === 'string') {
            this.turns.set(event.turnId, this.turns.get(event.turnId) ?? { id: event.turnId, ts: this.nowIso() });
        }
        if (event.type === 'pre_tool_use') {
            this.recordToolStart(event.toolUseId, event.turnId, event.toolName, event.toolInput);
        }
        else if (event.type === 'post_tool_use') {
            this.recordToolStart(event.toolUseId, event.turnId, event.toolName, event.toolInput);
            this.recordToolOutput(event.toolUseId, event.toolResponse, true);
        }
        else if (event.type === 'post_tool_use_failure') {
            this.recordToolStart(event.toolUseId, event.turnId, event.toolName, event.toolInput);
            const redactedError = this.recordToolFailure(event.toolUseId, event.error);
            this.appendEvent({
                id: `runtime:${event.sessionId}:${event.turnId}:${event.toolUseId}:post_tool_use_failure`,
                ts: this.nowIso(),
                source: 'tool',
                type: 'tool.failed',
                severity: 'error',
                refs: { turnId: event.turnId, toolCallId: event.toolUseId },
                data: { toolName: event.toolName, error: redactedError },
            });
            return;
        }
        else if (event.type === 'tool_started') {
            const toolCallId = this.nextToolCallId(event.turnId, event.toolName);
            this.activeToolIds.set(`${event.turnId}:${event.toolName}`, toolCallId);
            this.recordToolStart(toolCallId, event.turnId, event.toolName, event.toolInput);
            this.appendEvent({
                id: `runtime:${event.sessionId}:${event.turnId}:${toolCallId}:tool_started`,
                ts: this.nowIso(),
                source: 'tool',
                type: 'tool.started',
                refs: { turnId: event.turnId, toolCallId },
                data: { toolName: event.toolName },
            });
            return;
        }
        else if (event.type === 'tool_finished') {
            const toolCallId = this.activeToolIds.get(`${event.turnId}:${event.toolName}`) ?? this.nextToolCallId(event.turnId, event.toolName);
            const existing = this.toolCalls.get(toolCallId);
            if (existing) {
                this.toolCalls.set(toolCallId, { ...existing, endedAt: this.nowIso(), ok: event.ok });
            }
            this.appendEvent({
                id: `runtime:${event.sessionId}:${event.turnId}:${toolCallId}:tool_finished`,
                ts: this.nowIso(),
                source: 'tool',
                type: event.ok ? 'tool.finished' : 'tool.failed',
                severity: event.ok ? undefined : 'error',
                refs: { turnId: event.turnId, toolCallId },
                data: { toolName: event.toolName },
            });
            return;
        }
        else if (event.type === 'artifact_recorded') {
            this.recordArtifact(event);
        }
        for (const traceEvent of normalizeRuntimeEvent(event)) {
            this.appendEvent(traceEvent);
        }
    }
    recordToolStart(toolCallId, turnId, toolName, toolInput) {
        if (this.toolCalls.has(toolCallId))
            return;
        const redacted = redactTraceValue(toolInput, `toolCalls.${toolCallId}.input`);
        this.redactions.push(...redacted.redactions);
        this.toolCalls.set(toolCallId, {
            id: toolCallId,
            turnId,
            name: toolName,
            inputPreview: previewJson(redacted.value),
            redactedInputSha256: sha256Json(redacted.value),
            startedAt: this.nowIso(),
        });
    }
    recordToolOutput(toolCallId, response, ok) {
        const existing = this.toolCalls.get(toolCallId);
        if (!existing)
            return;
        const content = typeof response === 'string' ? response : JSON.stringify(response);
        const output = this.writer.persistLargeOutput({ toolCallId, content });
        this.redactions.push(...output.redactions);
        this.toolCalls.set(toolCallId, {
            ...existing,
            outputPreview: output.preview,
            redactedOutputSha256: output.redactedSha256,
            outputBytes: output.bytes,
            persistedOutputPath: output.path,
            endedAt: this.nowIso(),
            ok,
        });
    }
    recordToolFailure(toolCallId, error) {
        const redacted = redactString(error, `toolCalls.${toolCallId}.error`);
        this.redactions.push(...redacted.redactions);
        const existing = this.toolCalls.get(toolCallId);
        if (!existing)
            return redacted.value;
        this.toolCalls.set(toolCallId, {
            ...existing,
            endedAt: this.nowIso(),
            ok: false,
            errorClass: redacted.value.slice(0, 120),
        });
        return redacted.value;
    }
    recordArtifact(event) {
        const path = event.path ? redactString(event.path, `artifacts.${event.artifactId}.path`) : undefined;
        if (path)
            this.redactions.push(...path.redactions);
        const artifactPath = path?.value ?? event.artifactId;
        this.artifacts.set(event.artifactId, {
            id: event.artifactId,
            path: artifactPath,
            kind: event.kind,
            createdBy: { taskId: event.stageId },
            existsAtExport: Boolean(event.path && existsSync(event.path)),
        });
        this.appendEvent({
            id: `runtime:${event.sessionId}:${event.turnId}:${event.artifactId}:artifact_recorded`,
            ts: this.nowIso(),
            source: 'cli',
            type: 'artifact.recorded',
            refs: { turnId: event.turnId, artifactId: event.artifactId },
            message: event.label,
            data: { kind: event.kind, creator: event.creator },
        });
    }
    appendEvent(event) {
        let id = event.id;
        let suffix = 1;
        while (this.events.has(id)) {
            suffix += 1;
            id = `${event.id}:${suffix}`;
        }
        this.events.set(id, { ...event, id });
    }
    nextToolCallId(turnId, toolName) {
        this.toolOrdinal += 1;
        return `${turnId}:${safeFilePart(toolName)}:${this.toolOrdinal}`;
    }
    nowIso() {
        return (this.options.now?.() ?? new Date()).toISOString();
    }
}
export function createRuntimeTraceRecorderFromEnv(input) {
    const root = process.env['XIAOK_TRACE_DIR'];
    if (!root)
        return null;
    return new RuntimeTraceRecorder({
        rootDir: join(root, input.sessionId),
        sessionId: input.sessionId,
        cwd: input.cwd,
        command: input.command,
        version: input.version,
        onWarning: input.onWarning,
    });
}
function previewJson(value) {
    return JSON.stringify(value);
}
function sha256Json(value) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function safeFilePart(value) {
    return value.replace(/[^a-zA-Z0-9_.-]+/g, '_');
}
function mergeRedactions(redactions) {
    const counts = new Map();
    for (const redaction of redactions) {
        const key = `${redaction.type}:${redaction.fieldPath ?? ''}`;
        const existing = counts.get(key);
        if (existing) {
            existing.count += redaction.count;
        }
        else {
            counts.set(key, { ...redaction });
        }
    }
    return [...counts.values()];
}
