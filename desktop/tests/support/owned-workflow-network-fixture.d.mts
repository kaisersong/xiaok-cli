import type { KSwarmWorkflowNodeHandoff } from '../../electron/kswarm-runtime-bridge.js';

/** Data accepted by the actual sibling workflow-node-permissions validator. */
export interface OwnedWorkflowNodePermissions {
  toolCategories?: string[];
  deniedCommandIds?: string[];
  deniedCommands?: string[];
}
export interface OwnedWorkflowNetworkFixtureOptions {
  issuer?: string;
  partialRunWriteDeny?: boolean;
  project?: { id?: string; name?: string; goal?: string };
  workflowName?: string;
  phaseTitle?: string;
  prompt?: string;
  label?: string;
}
/** Fields established by the existing real Hub issuer; other persisted data stays unknown. */
export interface OwnedWorkflowNodeDispatch extends KSwarmWorkflowNodeHandoff {
  targetParticipantId: string | null;
}
export interface OwnedWorkflowNetworkFixture {
  root: string;
  base: string;
  brokerBase: string;
  workspace: { path: string; artifacts: string; custom: boolean };
  project: { id: string; name: string; goal: string; [key: string]: unknown };
  original: Record<string, unknown>;
  issued: {
    ok: true;
    workflowRun: { id: string; [key: string]: unknown };
    nodeId?: string;
    dispatches: OwnedWorkflowNodeDispatch[];
  };
  forwardedFetch: typeof globalThis.fetch;
  nativeFetch: typeof globalThis.fetch;
  requestLog: Array<{ originalOrigin: string; path: string; method: string; ownedTarget: string }>;
  close(): Promise<void>;
  tightenToReadonly(): Promise<void>;
  durableMutations: Array<{ runId: string; nodeId: string; revision: number; beforePermissions: unknown; afterPermissions: OwnedWorkflowNodePermissions }>;
}
/** Adjacent declaration for the real MJS export, not a replacement module or authority issuer. */
export function createOwnedWorkflowNetworkFixture(
  permissions?: OwnedWorkflowNodePermissions | null,
  options?: OwnedWorkflowNetworkFixtureOptions,
): Promise<OwnedWorkflowNetworkFixture>;
