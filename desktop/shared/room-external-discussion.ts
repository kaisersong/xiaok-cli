/** Main-owned capability facts; never accepted from renderer mutation payloads. */
export type RoomExternalDiscussionRuntime = 'qoder' | 'xiaok' | 'kiro';
export interface RoomExternalDiscussionProof {
  freshSession: true;
  toolsDisabled: true;
  mcpDisabled: true;
  hooksDisabled: true;
}
export interface RoomExternalDiscussionCapability {
  protocol: 'room_discussion_v1';
  runtime: RoomExternalDiscussionRuntime;
  supported: boolean;
  reason?: string;
  proof?: RoomExternalDiscussionProof;
}
export interface RoomExternalDiscussionPrepared {
  operationId: string;
  runtime: RoomExternalDiscussionRuntime;
  neutralRoot: string;
  ownerPid: number;
  phase: 'prepared';
}
export interface RoomExternalDiscussionStarted extends Omit<RoomExternalDiscussionPrepared, 'phase'> {
  phase: 'running';
  pid: number;
  processGroupId: number;
  processStartIdentity: string;
}
export interface RoomExternalDiscussionExited extends Omit<RoomExternalDiscussionStarted, 'phase'> {
  phase: 'released';
  exitCode: number | null;
  groupExitVerified: true;
}
export interface RoomExternalDiscussionNotSpawned extends Omit<RoomExternalDiscussionPrepared, 'phase'> {
  phase: 'not-spawned';
  noSpawnVerified: true;
}
export interface RoomExternalDiscussionExecuteInput {
  operationId: string;
  runtime: RoomExternalDiscussionRuntime;
  prompt: string;
  signal: AbortSignal;
  onPrepared(record: RoomExternalDiscussionPrepared): Promise<void>;
  onStarted(record: RoomExternalDiscussionStarted): Promise<void>;
  onExited(record: RoomExternalDiscussionExited): Promise<void>;
  onNotSpawned?(record: RoomExternalDiscussionNotSpawned): Promise<void>;
}
export interface RoomExternalDiscussionResult { text: string; resourcesReleased: true }
export interface RoomExternalDiscussionAdapter {
  probe(runtime: RoomExternalDiscussionRuntime): Promise<RoomExternalDiscussionCapability>;
  execute(input: RoomExternalDiscussionExecuteInput): Promise<RoomExternalDiscussionResult>;
}
