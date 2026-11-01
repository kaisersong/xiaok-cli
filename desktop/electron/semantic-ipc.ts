import type {AssistantCalendarMemorySettingsDto,AssistantCalendarMemoryInput} from '../shared/assistant-calendar-memory-contract.js';
import type {AssistantAnalysisStatus,AssistantAnalysisSettingsInput} from '../shared/assistant-analysis-settings-contract.js';
import type {AssistantThreadTargetPage} from '../shared/assistant-launch-contract.js';
import type {AssistantQualityStatus} from '../shared/assistant-quality-contract.js';
import type {AssistantPeriodicSettings,AssistantPeriodicStatus,AssistantPeriodicCheck} from '../shared/assistant-periodic-contract.js';
import type {AssistantLaunchService} from './assistant-launch-service.js';
import type {AssistantCalendarStatus} from '../shared/assistant-calendar-contract.js';
import type {AssistantActionDecisionResultDto} from '../shared/assistant-action-contract.js';
import { registerCollaborationRoomTypedIpc } from './collaboration-room-typed-ipc.js';
import type { RoomCreateInput, RoomArchiveInput, RoomDeleteInput, RoomMembersInput, RoomSendInput, RoomSeenInput, RoomCancelInput, RoomProjectCreateInput, RoomTaskCreateInput, RoomListResultDto, RoomSnapshotDto, RoomCreateResultDto, RoomArchiveResultDto, RoomDeleteResultDto, RoomMembersResultDto, RoomSendResultDto, RoomSeenResultDto, RoomCancelResultDto, RoomProjectCreateResultDto, RoomTaskCreateResultDto } from '../shared/collaboration-room-ipc-contract.js';
import { registerKSwarmProjectAgentTypedIpc } from './kswarm-project-agent-typed-ipc.js';
import { registerKSwarmTeamTypedIpc } from './kswarm-team-typed-ipc.js';
import type { AssistantCandidatePageDto, AssistantActionOverviewDto, AssistantProfileDto, AssistantOverviewDto, AssistantCandidateDto, AssistantAcceptResultDto } from '../shared/assistant-ipc-contract.js';
import { registerAssistantTypedIpc } from './assistant-typed-ipc.js';
import type { KSwarmSemanticService } from './kswarm-semantic-service.js';
import type { IpcHandleRegistrar } from './shutdown-aware-ipc-main.js';

/**
 * CollaborationRoom semantic controller (design §12, §16.3). Null until the
 * broker/KSwarm service adapters are wired in main — renderer calls then get
 * the stable broker_unavailable degraded code instead of a raw crash.
 */
export interface CollaborationRoomSemanticController {
  listRooms(): RoomListResultDto | Promise<RoomListResultDto>;
  getRoom(roomId: string): RoomSnapshotDto | Promise<RoomSnapshotDto>;
  createRoom(input: RoomCreateInput, authority?: { requestSource: 'user'; signal?: AbortSignal }): RoomCreateResultDto | Promise<RoomCreateResultDto>;
  archiveRoom(input: RoomArchiveInput): RoomArchiveResultDto | Promise<RoomArchiveResultDto>;
  deleteRoom?(input: RoomDeleteInput, authority: { requestSource: 'user' }): RoomDeleteResultDto | Promise<RoomDeleteResultDto>;
  updateRoomMembers(input: RoomMembersInput): RoomMembersResultDto | Promise<RoomMembersResultDto>;
  sendMessage(input: RoomSendInput): RoomSendResultDto | Promise<RoomSendResultDto>;
  markRoomSeen(input: RoomSeenInput): RoomSeenResultDto | Promise<RoomSeenResultDto>;
  cancelDiscussion(input: RoomCancelInput): RoomCancelResultDto | Promise<RoomCancelResultDto>;
  createProjectFromRoom(input: RoomProjectCreateInput): RoomProjectCreateResultDto | Promise<RoomProjectCreateResultDto>;
  createTaskFromRoomMessage(input: RoomTaskCreateInput): RoomTaskCreateResultDto | Promise<RoomTaskCreateResultDto>;
}

export interface AssistantSemanticController {
  getCalendarMemorySettings?():Promise<AssistantCalendarMemorySettingsDto>;configureCalendarMemory?(input:AssistantCalendarMemoryInput&{requestSource:'user'}):Promise<AssistantCalendarMemorySettingsDto>;
  getAnalysisProvider?():Promise<AssistantAnalysisStatus>;configureAnalysisProvider?(input:AssistantAnalysisSettingsInput&{requestSource:'user'}):Promise<AssistantAnalysisStatus>;listLaunchTargets?(input:{cursor?:string;requestSource:'user'}):Promise<AssistantThreadTargetPage>;
  getQualityStatus?():Promise<AssistantQualityStatus>;
  exportQualityReview?(input:{requestSource:'user'}):Promise<{cancelled:boolean;status:AssistantQualityStatus}>;
  importQualityReview?(input:{attestHumanReview:true;requestSource:'user'}):Promise<{cancelled:boolean;status:AssistantQualityStatus}>;
  revokeQualityReview?(input:{requestSource:'user'}):Promise<AssistantQualityStatus>;
  getPeriodicStatus?():Promise<AssistantPeriodicStatus>;
  configurePeriodic?(input:AssistantPeriodicSettings&{requestSource:'user'}):Promise<AssistantPeriodicStatus>;
  checkPeriodic?(input:{requestSource:'user'}):Promise<AssistantPeriodicCheck>;
  cancelLaunch?(input:Parameters<AssistantLaunchService['cancel']>[0]):ReturnType<AssistantLaunchService['cancel']>;
  prepareReconfirmation?(input:Parameters<AssistantLaunchService['prepareReconfirmation']>[0]):ReturnType<AssistantLaunchService['prepareReconfirmation']>;
  prepareFollowUpLaunch?(input:Parameters<AssistantLaunchService['prepareFollowUp']>[0]):ReturnType<AssistantLaunchService['prepareFollowUp']>;
  prepareLaunch?(input:Parameters<AssistantLaunchService['prepare']>[0]):ReturnType<AssistantLaunchService['prepare']>;
  confirmLaunch?(input:Parameters<AssistantLaunchService['confirm']>[0]):ReturnType<AssistantLaunchService['confirm']>;
  getActionLaunch?(input:Parameters<AssistantLaunchService['get']>[0]):ReturnType<AssistantLaunchService['get']>;
  resolveActionLaunch?(input:Parameters<AssistantLaunchService['resolve']>[0]):ReturnType<AssistantLaunchService['resolve']>;
  getCalendarStatus?():AssistantCalendarStatus;
  connectCalendar?(input:{requestSource:'user'}):Promise<AssistantCalendarStatus>;
  disconnectCalendar?(input:{requestSource:'user'}):AssistantCalendarStatus;
  getActionCandidatesPage?(input:{cursor:string}):AssistantCandidatePageDto|Promise<AssistantCandidatePageDto>;
  dismissAction?(input:{proposalId:string;expectedRevision:number;existingThreadId?:string;requestSource:'user'}):Promise<AssistantActionDecisionResultDto>;
  snoozeAction?(input:{proposalId:string;expectedRevision:number;snoozeUntil:number;requestSource:'user'}):Promise<AssistantActionDecisionResultDto>;
  getActionOverview?(): AssistantActionOverviewDto | Promise<AssistantActionOverviewDto>;
  getOverview(): AssistantOverviewDto | Promise<AssistantOverviewDto>;
  activate(input: { requestSource: 'user' }): AssistantProfileDto | Promise<AssistantProfileDto>;
  pause(input: { requestSource: 'user' }): AssistantProfileDto | Promise<AssistantProfileDto>;
  resume(input: { requestSource: 'user' }): AssistantProfileDto | Promise<AssistantProfileDto>;
  acceptCandidate(input: { candidateId: string; collectionId?: string; requestSource: 'user' }): AssistantAcceptResultDto | Promise<AssistantAcceptResultDto>;
  rejectCandidate(input: { candidateId: string; requestSource: 'user' }): AssistantCandidateDto | Promise<AssistantCandidateDto>;
}

export function registerSemanticDesktopIpc(
  ipcMain: IpcHandleRegistrar,
  options: {
    assistant: AssistantSemanticController;
    authorizeAssistant?: (event: unknown) => boolean;
    authorizeRoomDeletion?: (event: unknown) => boolean;
    kswarm: KSwarmSemanticService;
    collaborationRooms?: CollaborationRoomSemanticController | null;
  },
): void {
  const { assistant, kswarm } = options;
  const rooms = options.collaborationRooms ?? null;
  registerAssistantTypedIpc(ipcMain, assistant, options.authorizeAssistant);

  registerKSwarmTeamTypedIpc(ipcMain, kswarm);

  registerCollaborationRoomTypedIpc(ipcMain, rooms, options.authorizeRoomDeletion);
  registerKSwarmProjectAgentTypedIpc(ipcMain, kswarm);

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
