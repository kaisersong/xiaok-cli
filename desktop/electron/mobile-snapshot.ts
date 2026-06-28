import type { ArtifactSummary, DesktopTaskEvent, NeedsUserQuestion, TaskSnapshot } from '../../src/runtime/task-host/types.js';
import type { LoopDefinition, LoopRun, UserLoopTemplate } from './loop-types.js';
import type { MobileChatMessage, MobileConversationSummary, MobileRunningTurn, MobileSnapshot } from './mobile-gateway.js';

type MobileProjectStatus = 'active' | 'blocked' | 'completed' | 'closed';
type MobileApprovalRisk = 'low' | 'medium' | 'high';
type MobileApprovalStatus = 'pending' | 'approved' | 'rejected';
type MobileLoopStatus = 'scheduled' | 'running' | 'paused' | 'blocked';
type MobileLoopRunStatus = 'success' | 'failed' | 'running' | 'blocked' | 'skipped';
type MobileArtifactKind = 'markdown' | 'pdf' | 'pptx' | 'html' | 'image' | 'text' | 'other';
type MobileArtifactStatus = 'ready' | 'generating' | 'failed';

export interface MobileProjectSummary {
  id: string;
  name: string;
  status: MobileProjectStatus;
  progress: number;
  activeTasks: number;
  updatedAt: string;
}

export interface MobileApprovalSummary {
  id: string;
  title: string;
  detail: string;
  risk: MobileApprovalRisk;
  status: MobileApprovalStatus;
  createdAt: string;
}

export interface MobileLoopSummary {
  id: string;
  name: string;
  status: MobileLoopStatus;
  lastRunStatus: MobileLoopRunStatus;
  nextRunSummary: string;
}

export interface MobileArtifactSummary {
  id: string;
  name: string;
  kind: MobileArtifactKind;
  source: string;
  status: MobileArtifactStatus;
  previewAvailable?: boolean;
  mimeType?: string;
  sizeBytes?: number;
}

export interface KSwarmProjectLike {
  id?: unknown;
  name?: unknown;
  goal?: unknown;
  status?: unknown;
  taskCount?: unknown;
  doneCount?: unknown;
  stoppedCount?: unknown;
  updatedAt?: unknown;
  createdAt?: unknown;
}

export function buildMobileSnapshotFromSources(input: {
  desktopName: string;
  snapshots: TaskSnapshot[];
  activeTaskId?: string | null;
  mobileMessages?: MobileChatMessage[];
  kswarmProjects?: KSwarmProjectLike[];
  loopDefinitions?: LoopDefinition[];
  userLoopTemplates?: UserLoopTemplate[];
  loopRunsByLoopId?: Map<string, LoopRun[]>;
  now?: number;
}): MobileSnapshot {
  const snapshots = [...input.snapshots]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 20);
  const activeSnapshot = snapshots.find(snapshot => snapshot.taskId === input.activeTaskId)
    ?? snapshots.find(snapshot => !isTerminalTaskStatus(snapshot.status));
  const projects = input.kswarmProjects?.length
    ? input.kswarmProjects.slice(0, 20).map(mapKSwarmProject)
    : snapshots.slice(0, 10).map(mapTaskSnapshotProject);

  const messages = buildMobileMessages(snapshots, input.mobileMessages ?? []);
  return {
    desktopName: input.desktopName,
    health: 'online',
    lastSyncSequence: input.now ?? Date.now(),
    runningTurn: activeSnapshot ? mapRunningTurn(activeSnapshot) : null,
    messages,
    conversations: buildConversationSummaries(snapshots, messages),
    projects,
    approvals: buildApprovalSummaries(snapshots),
    loops: buildLoopSummaries(input.loopDefinitions ?? [], input.userLoopTemplates ?? [], input.loopRunsByLoopId ?? new Map()),
    artifacts: buildArtifactSummaries(snapshots),
  };
}

export function resolveMobileApprovalAnswer(
  question: NeedsUserQuestion,
  decision: 'approve' | 'reject',
): { questionId: string; type: 'choice'; choiceId: string } | null {
  const choices = question.choices ?? [];
  if (choices.length === 0) return null;
  const patterns = decision === 'approve'
    ? [/^(yes|y|ok|approve|confirm|continue)$/i, /确认|同意|允许|继续|是|好/]
    : [/^(no|n|reject|deny|cancel|stop)$/i, /拒绝|取消|不同意|否|停止/];
  const exact = choices.find(choice => patterns.some(pattern => pattern.test(choice.id) || pattern.test(choice.label)));
  if (exact) return { questionId: question.questionId, type: 'choice', choiceId: exact.id };
  if (decision === 'approve') {
    return { questionId: question.questionId, type: 'choice', choiceId: choices[0].id };
  }
  if (choices.length >= 2) {
    return { questionId: question.questionId, type: 'choice', choiceId: choices[choices.length - 1].id };
  }
  return null;
}

function buildMobileMessages(snapshots: TaskSnapshot[], mobileMessages: MobileChatMessage[]): MobileChatMessage[] {
  const desktopMessages = snapshots.flatMap(buildTaskMessagesForMobile);
  return [...mobileMessages.map(message => ({
    ...message,
    conversationId: message.conversationId ?? 'default',
    deliveryStatus: message.deliveryStatus ?? 'sent',
  })), ...desktopMessages]
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    .slice(-120);
}

function buildTaskMessagesForMobile(snapshot: TaskSnapshot): MobileChatMessage[] {
  const messages: MobileChatMessage[] = [];
  const baseTime = snapshot.createdAt || snapshot.updatedAt || Date.now();
  messages.push({
    id: `desktop-prompt-${snapshot.taskId}`,
    conversationId: snapshot.taskId,
    role: 'user',
    text: snapshot.prompt,
    createdAt: new Date(baseTime).toISOString(),
    deliveryStatus: 'sent',
  });

  const eventMessages = snapshot.events
    .flatMap((event, index) => mobileMessagesForEvent(snapshot, event, index, baseTime))
    .slice(-18);
  messages.push(...eventMessages);

  if (snapshot.result?.summary?.trim()) {
    messages.push({
      id: `desktop-result-${snapshot.taskId}`,
      conversationId: snapshot.taskId,
      role: 'assistant',
      text: snapshot.result.summary.trim(),
      createdAt: new Date(Math.max(snapshot.updatedAt || 0, baseTime + messages.length + 1)).toISOString(),
      deliveryStatus: 'sent',
    });
  }

  return messages;
}

function mobileMessagesForEvent(
  snapshot: TaskSnapshot,
  event: DesktopTaskEvent,
  index: number,
  baseTime: number,
): MobileChatMessage[] {
  const createdAt = new Date(eventTimestamp(event) ?? baseTime + index + 1).toISOString();
  const common = {
    conversationId: snapshot.taskId,
    createdAt,
    deliveryStatus: 'sent' as const,
  };

  switch (event.type) {
  case 'progress':
    return nonEmptyMessage({
      id: `desktop-progress-${snapshot.taskId}-${event.eventId}`,
      role: 'assistant',
      text: event.message,
      ...common,
    });
  case 'assistant_delta':
    return nonEmptyMessage({
      id: `desktop-assistant-${snapshot.taskId}-${event.eventId}`,
      role: 'assistant',
      text: event.delta,
      ...common,
    });
  case 'needs_user': {
    const choices = event.question.choices?.map(choice => `- ${choice.label}`).join('\n');
    return nonEmptyMessage({
      id: `desktop-question-${snapshot.taskId}-${event.question.questionId}`,
      role: 'assistant',
      text: choices ? `${event.question.prompt}\n\n${choices}` : event.question.prompt,
      ...common,
    });
  }
  case 'error':
    return nonEmptyMessage({
      id: `desktop-error-${snapshot.taskId}-${index}`,
      role: 'system',
      text: event.message,
      ...common,
    });
  case 'salvage':
    return nonEmptyMessage({
      id: `desktop-salvage-${snapshot.taskId}-${index}`,
      role: 'assistant',
      text: event.salvage.summary.join('\n'),
      ...common,
    });
  default:
    return [];
  }
}

function nonEmptyMessage(message: MobileChatMessage): MobileChatMessage[] {
  return message.text.trim() ? [{ ...message, text: message.text.trim() }] : [];
}

function eventTimestamp(event: DesktopTaskEvent): number | null {
  if ('ts' in event && typeof event.ts === 'number' && Number.isFinite(event.ts)) {
    return event.ts;
  }
  return null;
}

function buildConversationSummaries(
  snapshots: TaskSnapshot[],
  messages: MobileChatMessage[],
): MobileConversationSummary[] {
  const messagesByConversation = new Map<string, MobileChatMessage[]>();
  for (const message of messages) {
    const conversationId = message.conversationId ?? 'default';
    const list = messagesByConversation.get(conversationId) ?? [];
    list.push(message);
    messagesByConversation.set(conversationId, list);
  }

  const conversations = new Map<string, MobileConversationSummary>();
  for (const snapshot of snapshots) {
    const conversationMessages = messagesByConversation.get(snapshot.taskId) ?? [];
    const latestMessage = latestConversationMessage(conversationMessages);
    conversations.set(snapshot.taskId, {
      id: snapshot.taskId,
      title: truncate(firstLine(snapshot.prompt) || snapshot.taskId, 80),
      status: mapConversationStatus(snapshot.status),
      lastMessagePreview: truncate(latestMessage?.text ?? firstLine(snapshot.result?.summary ?? snapshot.prompt) ?? '', 120),
      updatedAt: new Date(snapshot.updatedAt).toISOString(),
      messageCount: conversationMessages.length,
    });
  }

  for (const [conversationId, conversationMessages] of messagesByConversation) {
    if (conversations.has(conversationId)) continue;
    const latestMessage = latestConversationMessage(conversationMessages);
    conversations.set(conversationId, {
      id: conversationId,
      title: truncate(firstLine(latestMessage?.text ?? conversationId), 80),
      status: 'running',
      lastMessagePreview: truncate(latestMessage?.text ?? '', 120),
      updatedAt: latestMessage?.createdAt ?? new Date().toISOString(),
      messageCount: conversationMessages.length,
    });
  }

  return [...conversations.values()]
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 30);
}

function latestConversationMessage(messages: MobileChatMessage[]): MobileChatMessage | undefined {
  return [...messages].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
}

function buildApprovalSummaries(snapshots: TaskSnapshot[]): MobileApprovalSummary[] {
  return snapshots
    .filter(snapshot => snapshot.status === 'waiting_user')
    .flatMap(snapshot => snapshot.events
      .filter((event): event is Extract<DesktopTaskEvent, { type: 'needs_user' }> => event.type === 'needs_user')
      .slice(-3)
      .map(event => ({
        id: `${snapshot.taskId}:${event.question.questionId}`,
        title: truncate(event.question.prompt, 80),
        detail: event.question.choices?.map(choice => choice.label).join(' / ') ?? event.question.kind,
        risk: approvalRiskForQuestion(event.question),
        status: 'pending' as const,
        createdAt: new Date(snapshot.updatedAt).toISOString(),
      })));
}

function buildArtifactSummaries(snapshots: TaskSnapshot[]): MobileArtifactSummary[] {
  const artifacts: MobileArtifactSummary[] = [];
  for (const snapshot of snapshots) {
    for (const artifact of snapshot.result?.artifacts ?? []) {
      artifacts.push(mapArtifactSummary(artifact, snapshot.taskId, 'ready'));
    }
    for (const event of snapshot.events) {
      if (event.type !== 'artifact_recorded') continue;
      artifacts.push({
        id: event.artifactId,
        name: event.label || event.filePath.split(/[\\/]/).pop() || event.artifactId,
        kind: mapArtifactKind(event.kind),
        source: snapshot.taskId,
        status: 'ready',
        previewAvailable: event.previewAvailable,
        mimeType: event.mimeType,
      });
    }
  }

  const seen = new Set<string>();
  return artifacts
    .filter(artifact => {
      if (seen.has(artifact.id)) return false;
      seen.add(artifact.id);
      return true;
    })
    .slice(0, 30);
}

function buildLoopSummaries(
  definitions: LoopDefinition[],
  templates: UserLoopTemplate[],
  runsByLoopId: Map<string, LoopRun[]>,
): MobileLoopSummary[] {
  const templateByLoopId = new Map(templates.map(template => [template.loopId, template]));
  return definitions
    .filter(definition => definition.status !== 'deleted')
    .slice(0, 20)
    .map(definition => {
      const template = templateByLoopId.get(definition.id);
      const latestRun = runsByLoopId.get(definition.id)?.[0];
      return {
        id: definition.id,
        name: definition.title,
        status: mapLoopStatus(definition, template),
        lastRunStatus: latestRun ? mapLoopRunStatus(latestRun.status) : 'skipped',
        nextRunSummary: template?.scheduleEnabled ? 'Scheduled' : 'Manual',
      };
    });
}

function mapTaskSnapshotProject(snapshot: TaskSnapshot): MobileProjectSummary {
  return {
    id: snapshot.taskId,
    name: truncate(firstLine(snapshot.prompt) || snapshot.taskId, 80),
    status: mapTaskProjectStatus(snapshot.status),
    progress: progressForTaskStatus(snapshot.status),
    activeTasks: isTerminalTaskStatus(snapshot.status) ? 0 : 1,
    updatedAt: new Date(snapshot.updatedAt).toISOString(),
  };
}

function mapKSwarmProject(project: KSwarmProjectLike): MobileProjectSummary {
  const taskCount = numberValue(project.taskCount);
  const doneCount = numberValue(project.doneCount);
  return {
    id: stringValue(project.id, 'project'),
    name: truncate(stringValue(project.name ?? project.goal, 'Project'), 80),
    status: mapProjectStatus(project.status),
    progress: taskCount > 0 ? Math.max(0, Math.min(1, doneCount / taskCount)) : 0,
    activeTasks: Math.max(0, taskCount - doneCount - numberValue(project.stoppedCount)),
    updatedAt: new Date(numberValue(project.updatedAt) || numberValue(project.createdAt) || Date.now()).toISOString(),
  };
}

function mapRunningTurn(snapshot: TaskSnapshot): MobileRunningTurn {
  return {
    id: snapshot.taskId,
    title: truncate(firstLine(snapshot.prompt) || 'Active desktop task', 80),
    status: snapshot.status === 'waiting_user' ? 'waiting' : isTerminalTaskStatus(snapshot.status) ? 'finished' : 'running',
  };
}

function mapArtifactSummary(artifact: ArtifactSummary, source: string, status: MobileArtifactStatus): MobileArtifactSummary {
  return {
    id: artifact.artifactId,
    name: artifact.title || artifact.filePath?.split(/[\\/]/).pop() || artifact.artifactId,
    kind: mapArtifactKind(artifact.kind),
    source,
    status,
    previewAvailable: artifact.previewAvailable,
    mimeType: artifact.mimeType,
    sizeBytes: artifact.sizeBytes,
  };
}

function mapArtifactKind(kind: string): MobileArtifactKind {
  if (kind === 'pptx' || kind === 'pdf' || kind === 'html' || kind === 'image' || kind === 'text') return kind;
  if (kind === 'docx' || kind === 'xlsx' || kind === 'a2ui') return 'other';
  if (kind === 'markdown') return 'markdown';
  return 'other';
}

function mapLoopStatus(definition: LoopDefinition, template: UserLoopTemplate | undefined): MobileLoopStatus {
  if (definition.activeRunId) return 'running';
  if (definition.status === 'paused') return 'paused';
  if (template?.scheduleEnabled) return 'scheduled';
  return 'paused';
}

function mapLoopRunStatus(status: LoopRun['status']): MobileLoopRunStatus {
  if (status === 'success' || status === 'failed' || status === 'running' || status === 'blocked') return status;
  return 'skipped';
}

function mapTaskProjectStatus(status: TaskSnapshot['status']): MobileProjectStatus {
  if (status === 'completed') return 'completed';
  if (status === 'failed' || status === 'cancelled') return 'closed';
  if (status === 'waiting_user') return 'blocked';
  return 'active';
}

function mapConversationStatus(status: TaskSnapshot['status']): MobileConversationSummary['status'] {
  if (status === 'completed') return 'completed';
  if (status === 'failed' || status === 'cancelled') return 'failed';
  if (status === 'waiting_user') return 'waiting';
  return 'running';
}

function mapProjectStatus(status: unknown): MobileProjectStatus {
  if (status === 'completed' || status === 'done') return 'completed';
  if (status === 'blocked' || status === 'failed') return 'blocked';
  if (status === 'closed' || status === 'cancelled') return 'closed';
  return 'active';
}

function progressForTaskStatus(status: TaskSnapshot['status']): number {
  if (status === 'completed') return 1;
  if (status === 'failed' || status === 'cancelled') return 1;
  if (status === 'waiting_user') return 0.66;
  if (status === 'running') return 0.5;
  return 0.2;
}

function approvalRiskForQuestion(question: NeedsUserQuestion): MobileApprovalRisk {
  if (question.kind === 'missing_material' || question.expectedAttachments?.length) return 'medium';
  return 'low';
}

function isTerminalTaskStatus(status: TaskSnapshot['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}

function firstLine(value: string): string {
  return value.split(/\r?\n/)[0]?.trim() ?? '';
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
