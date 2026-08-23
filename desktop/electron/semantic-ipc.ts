import type { IpcMain } from 'electron';
import type { KSwarmSemanticService } from './kswarm-semantic-service.js';
import type { IpcHandleRegistrar } from './shutdown-aware-ipc-main.js';

export interface AssistantSemanticController {
  getOverview(): unknown | Promise<unknown>;
  activate(input: { requestSource: 'user' }): unknown | Promise<unknown>;
  pause(input: { requestSource: 'user' }): unknown | Promise<unknown>;
  resume(input: { requestSource: 'user' }): unknown | Promise<unknown>;
  acceptCandidate(input: { candidateId: string; collectionId?: string; requestSource: 'user' }): unknown | Promise<unknown>;
  rejectCandidate(input: { candidateId: string; requestSource: 'user' }): unknown | Promise<unknown>;
}

export function registerSemanticDesktopIpc(
  ipcMain: IpcHandleRegistrar,
  options: {
    assistant: AssistantSemanticController;
    kswarm: KSwarmSemanticService;
  },
): void {
  const { assistant, kswarm } = options;
  ipcMain.handle('desktop:assistant:getOverview', () => assistant.getOverview());
  ipcMain.handle('desktop:assistant:activate', () => assistant.activate({ requestSource: 'user' }));
  ipcMain.handle('desktop:assistant:pause', () => assistant.pause({ requestSource: 'user' }));
  ipcMain.handle('desktop:assistant:resume', () => assistant.resume({ requestSource: 'user' }));
  ipcMain.handle('desktop:assistant:acceptCandidate', (_event, input) => assistant.acceptCandidate({
    candidateId: readId(input?.candidateId),
    collectionId: readOptionalId(input?.collectionId),
    requestSource: 'user',
  }));
  ipcMain.handle('desktop:assistant:rejectCandidate', (_event, input) => assistant.rejectCandidate({
    candidateId: readId(input?.candidateId),
    requestSource: 'user',
  }));

  ipcMain.handle('desktop:kswarm:team:plan', (_event, input) => kswarm.planProjectTeam({ projectId: readId(input?.projectId) }));
  ipcMain.handle('desktop:kswarm:team:apply', (_event, input) => kswarm.applyProjectTeamPlan({
    projectId: readId(input?.projectId),
    planId: readId(input?.planId),
    projectRevision: readRevision(input?.projectRevision),
  }));
  ipcMain.handle('desktop:kswarm:team:getOperation', (_event, input) => kswarm.getProjectTeamOperation({ projectId: readId(input?.projectId) }));
  ipcMain.handle('desktop:kswarm:project:create', (_event, input) => kswarm.createKSwarmProject(readRecord(input)));
  ipcMain.handle('desktop:kswarm:project:updateExecutionMode', (_event, input) => kswarm.updateKSwarmProjectExecutionMode({
    projectId: readId(input?.projectId),
    executionMode: readExecutionMode(input?.executionMode),
  }));
  ipcMain.handle('desktop:kswarm:project:delete', (_event, input) => kswarm.deleteKSwarmProject({ projectId: readId(input?.projectId) }));
  ipcMain.handle('desktop:kswarm:agent:create', (_event, input) => kswarm.createKSwarmAgent(readRecord(input)));
  ipcMain.handle('desktop:kswarm:agent:update', (_event, input) => kswarm.updateKSwarmAgent({
    id: readId(input?.agentId), changes: readRecord(input?.patch),
  }));
  ipcMain.handle('desktop:kswarm:agent:archive', (_event, input) => kswarm.archiveKSwarmAgent({ id: readId(input?.agentId) }));
  ipcMain.handle('desktop:kswarm:agent:start', (_event, input) => kswarm.startKSwarmAgent({ id: readId(input?.agentId) }));
  ipcMain.handle('desktop:kswarm:agent:stop', (_event, input) => kswarm.stopKSwarmAgent({ id: readId(input?.agentId) }));
  ipcMain.handle('desktop:kswarm:agent:probe', (_event, input) => kswarm.probeKSwarmAgent({ id: readId(input?.agentId) }));
}

function readId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('id_required');
  return value.trim();
}

function readOptionalId(value: unknown): string | undefined {
  return value === undefined ? undefined : readId(value);
}

function readRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error('invalid_project_revision');
  return Number(value);
}

function readExecutionMode(value: unknown): 'direct' | 'auto' | 'workflow_preferred' {
  if (value === 'direct' || value === 'auto' || value === 'workflow_preferred') return value;
  throw new Error('invalid_execution_mode');
}

function readRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('object_required');
  return value as Record<string, unknown>;
}
