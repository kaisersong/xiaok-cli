import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { normalizeKSwarmProjectDetail } from './normalizer.js';
import { redactString, redactTraceValue } from './redactor.js';
import { validateTraceBundle, type TraceArtifact, type TraceBundleV1, type TraceEvent, type TraceRedaction, type TraceTask, type TraceToolCall } from './schema.js';
import type { DesktopTaskEvent, TaskSnapshot, TaskSnapshotStatus } from '../task-host/types.js';

export interface TraceExportOptions {
  now?: () => Date;
  version?: string;
  command?: string;
}

export function loadTaskSnapshotsForSession(input: { dataRoot: string; sessionId: string }): TaskSnapshot[] {
  const snapshotDir = join(input.dataRoot, 'tasks', 'snapshots');
  if (!existsSync(snapshotDir)) return [];
  return readdirSync(snapshotDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => join(snapshotDir, name))
    .map((filePath) => JSON.parse(readFileSync(filePath, 'utf8')) as TaskSnapshot)
    .filter((snapshot) => snapshot.sessionId === input.sessionId);
}

export function buildSessionTraceBundleFromSnapshots(
  snapshots: TaskSnapshot[],
  input: { sessionId: string; dataRoot?: string } & TraceExportOptions,
): TraceBundleV1 {
  const createdAt = (input.now?.() ?? new Date()).toISOString();
  const events: TraceEvent[] = [];
  const tasks: TraceTask[] = [];
  const toolCalls = new Map<string, TraceToolCall>();
  const artifacts = new Map<string, TraceArtifact>();
  const redactions: TraceRedaction[] = [];
  const turns = new Map<string, { id: string; role?: string; ts?: string }>();

  for (const snapshot of snapshots) {
    const taskArtifacts = new Set<string>();
    tasks.push({
      id: snapshot.taskId,
      title: snapshot.understanding?.goal || snapshot.prompt.slice(0, 80) || snapshot.taskId,
      status: mapTaskSnapshotStatus(snapshot.status),
      artifacts: [...taskArtifacts],
    });

    snapshot.events.forEach((event, index) => {
      const eventId = eventIdForSnapshotEvent(snapshot.taskId, event, index);
      const ts = tsFromDesktopEvent(event, snapshot.updatedAt);
      events.push({
        id: eventId,
        ts,
        source: 'desktop',
        type: `desktop.${event.type}`,
        refs: { taskId: snapshot.taskId, ...refsForDesktopEvent(event) },
        data: dataForDesktopEvent(event),
      });

      if (event.type === 'canvas_tool_call') {
        const redactedInput = redactTraceValue(event.input, `toolCalls.${event.toolUseId}.input`);
        redactions.push(...redactedInput.redactions);
        toolCalls.set(event.toolUseId, {
          id: event.toolUseId,
          name: event.toolName,
          inputPreview: JSON.stringify(redactedInput.value),
          redactedInputSha256: sha256Json(redactedInput.value),
          startedAt: ts,
        });
      } else if (event.type === 'canvas_tool_result') {
        const existing = toolCalls.get(event.toolUseId);
        const redactedOutput = redactString(event.response, `toolCalls.${event.toolUseId}.output`);
        redactions.push(...redactedOutput.redactions);
        toolCalls.set(event.toolUseId, {
          id: event.toolUseId,
          name: event.toolName,
          inputPreview: existing?.inputPreview ?? '{}',
          redactedInputSha256: existing?.redactedInputSha256,
          startedAt: existing?.startedAt ?? ts,
          endedAt: ts,
          ok: event.ok,
          outputPreview: redactedOutput.value.slice(0, 10_000),
          redactedOutputSha256: sha256(redactedOutput.value),
          outputBytes: Buffer.byteLength(redactedOutput.value, 'utf8'),
        });
      } else if (event.type === 'artifact_recorded') {
        turns.set(event.turnId, turns.get(event.turnId) ?? { id: event.turnId, ts });
        const artifact = artifactFromDesktopEvent(event, snapshot.taskId, redactions);
        artifacts.set(artifact.id, artifact);
        taskArtifacts.add(artifact.id);
      } else if (event.type === 'result') {
        for (const resultArtifact of event.result.artifacts) {
          const path = resultArtifact.filePath
            ? redactString(resultArtifact.filePath, `artifacts.${resultArtifact.artifactId}.path`)
            : null;
          if (path) redactions.push(...path.redactions);
          const artifact: TraceArtifact = {
            id: resultArtifact.artifactId,
            path: path?.value ?? resultArtifact.artifactId,
            kind: resultArtifact.kind,
            bytes: resultArtifact.sizeBytes,
            existsAtExport: resultArtifact.filePath ? existsSync(resultArtifact.filePath) : false,
            protected: true,
            createdBy: { taskId: snapshot.taskId },
          };
          artifacts.set(artifact.id, artifact);
          taskArtifacts.add(artifact.id);
        }
      }
    });

    const taskIndex = tasks.findIndex((task) => task.id === snapshot.taskId);
    if (taskIndex >= 0) {
      tasks[taskIndex] = { ...tasks[taskIndex], artifacts: [...taskArtifacts] };
    }
  }

  const dataRoot = input.dataRoot ? redactString(input.dataRoot, 'environment.dataRoot') : undefined;
  redactions.push(...(dataRoot?.redactions ?? []));

  return {
    schemaVersion: 1,
    bundleId: `trace_${safeFilePart(input.sessionId)}_${createdAt.replace(/[^0-9]/g, '')}`,
    createdAt,
    source: { app: 'xiaok-desktop', version: input.version, command: input.command },
    scope: { kind: 'session', sessionId: input.sessionId },
    environment: { dataRoot: dataRoot?.value },
    turns: [...turns.values()],
    events,
    toolCalls: [...toolCalls.values()],
    approvals: [],
    tasks,
    agents: [],
    artifacts: [...artifacts.values()],
    memoryRefs: [],
    skillEvidence: [],
    recovery: [],
    crashes: [],
    redactions: mergeRedactions(redactions),
    attachments: [],
    summary: {
      taskCount: tasks.length,
      eventCount: events.length,
      toolCallCount: toolCalls.size,
      artifactCount: artifacts.size,
    },
  };
}

export function buildProjectTraceBundleFromKSwarmDetail(
  detail: unknown,
  input: { projectId: string } & TraceExportOptions,
): TraceBundleV1 {
  const createdAt = (input.now?.() ?? new Date()).toISOString();
  const normalized = normalizeKSwarmProjectDetail(detail as never);
  return {
    schemaVersion: 1,
    bundleId: `trace_project_${safeFilePart(input.projectId)}_${createdAt.replace(/[^0-9]/g, '')}`,
    createdAt,
    source: { app: 'kswarm', version: input.version, command: input.command },
    scope: { kind: 'project', projectId: input.projectId },
    environment: {},
    turns: [],
    events: normalized.events,
    toolCalls: [],
    approvals: [],
    tasks: normalized.tasks,
    agents: normalized.agents,
    artifacts: [],
    memoryRefs: [],
    skillEvidence: [],
    recovery: [],
    crashes: [],
    redactions: [],
    attachments: [],
    summary: normalized.summary,
  };
}

export function writeTraceBundleToPath(input: { bundle: TraceBundleV1; outputPath: string; force?: boolean }): string {
  if (existsSync(input.outputPath) && !input.force) {
    throw new Error(`output already exists: ${input.outputPath}`);
  }
  const redacted = redactTraceValue(input.bundle, 'bundle');
  const bundle = redacted.value as TraceBundleV1;
  bundle.redactions = mergeRedactions([...(input.bundle.redactions ?? []), ...redacted.redactions]);
  const validation = validateTraceBundle(bundle);
  if (!validation.ok) {
    throw new Error(`invalid trace bundle: ${validation.errors.join(', ')}`);
  }
  mkdirSync(dirname(input.outputPath), { recursive: true });
  writeFileSync(input.outputPath, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
  return input.outputPath;
}

function mapTaskSnapshotStatus(status: TaskSnapshotStatus): TraceTask['status'] {
  if (status === 'completed') return 'done';
  if (status === 'failed') return 'failed';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'waiting_user') return 'blocked';
  return 'in_progress';
}

function eventIdForSnapshotEvent(taskId: string, event: DesktopTaskEvent, index: number): string {
  if ('eventId' in event && typeof event.eventId === 'string') return `desktop:${taskId}:${event.eventId}`;
  if ('artifactId' in event && typeof event.artifactId === 'string') return `desktop:${taskId}:${event.artifactId}:${event.type}`;
  return `desktop:${taskId}:${index}:${event.type}`;
}

function refsForDesktopEvent(event: DesktopTaskEvent): TraceEvent['refs'] {
  if (event.type === 'canvas_tool_call' || event.type === 'canvas_tool_result') return { toolCallId: event.toolUseId };
  if (event.type === 'artifact_recorded') return { toolCallId: undefined, artifactId: event.artifactId, turnId: event.turnId };
  return {};
}

function dataForDesktopEvent(event: DesktopTaskEvent): Record<string, unknown> {
  if (event.type === 'canvas_tool_call') return { toolName: event.toolName };
  if (event.type === 'canvas_tool_result') return { toolName: event.toolName, ok: event.ok };
  if (event.type === 'progress') return { message: event.message, stage: event.stage };
  if (event.type === 'error') return { message: event.message };
  return { eventType: event.type };
}

function tsFromDesktopEvent(event: DesktopTaskEvent, fallbackMs: number): string {
  const ts = 'ts' in event && typeof event.ts === 'number' ? event.ts : fallbackMs;
  return new Date(ts).toISOString();
}

function artifactFromDesktopEvent(
  event: Extract<DesktopTaskEvent, { type: 'artifact_recorded' }>,
  taskId: string,
  redactions: TraceRedaction[],
): TraceArtifact {
  const path = redactString(event.filePath, `artifacts.${event.artifactId}.path`);
  redactions.push(...path.redactions);
  const stats = safeStat(event.filePath);
  return {
    id: event.artifactId,
    path: path.value,
    kind: event.kind,
    bytes: stats?.size,
    createdBy: { taskId },
    existsAtExport: Boolean(stats),
    protected: true,
  };
}

function safeStat(path: string) {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sha256Json(value: unknown): string {
  return sha256(JSON.stringify(value));
}

function safeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, '_');
}

function mergeRedactions(redactions: TraceRedaction[]): TraceRedaction[] {
  const map = new Map<string, TraceRedaction>();
  for (const redaction of redactions) {
    const key = `${redaction.type}:${redaction.fieldPath ?? ''}`;
    const current = map.get(key);
    map.set(key, {
      type: redaction.type,
      fieldPath: redaction.fieldPath,
      count: (current?.count ?? 0) + redaction.count,
    });
  }
  return [...map.values()];
}
