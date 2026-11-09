import { realpath, stat } from 'node:fs/promises';
import {assertBeforeEffects} from '../../src/runtime/verification/before-effects.js';
import { extname, isAbsolute } from 'node:path';
import { XIAOK_DESKTOP_HOST_PARTICIPANT_ID, XIAOK_WORKER_SEED_ID } from '../shared/kswarm-seed-contract.js';
import type { RoomExternalDiscussionAdapter, RoomExternalDiscussionCapability, RoomExternalDiscussionRuntime } from '../shared/room-external-discussion.js';
import type { RoomAgentExecutionCapability } from './collaboration-room-service.js';

type Profile = { executable: string; argsPrefix?: readonly string[] };
type Agent = { id: string; participantId?: string; runtimeType?: string; runtimePath?: string; runtimeSource?: string; archivedAt?: unknown; execution?: { mode?: string; hostParticipantId?: string; participantId?: string } };
type Resolution = (RoomExternalDiscussionCapability & { logicalAgentId: string }) | null;
function effectGuard(beforeEffects?:()=>void){
  let failure:{error:unknown}|undefined;
  return {check(){try{assertBeforeEffects(beforeEffects);}catch(error){failure={error};throw error;}},failed(error:unknown){return Boolean(failure&&Object.is(error,failure.error));}};
}

/** Uses KSwarm runtime identity, not names or caller-supplied executable paths. */
export function createRoomExecutionRouter(options: {
  request(path: string): Promise<{ ok: boolean; json(): Promise<unknown> }>;
  makeAdapter(options: { profiles: Partial<Record<RoomExternalDiscussionRuntime, Profile>> }): RoomExternalDiscussionAdapter;
  canonicalExecutable?(value: string): Promise<string>;
}) {
  const installations = new Map<RoomExternalDiscussionRuntime, Promise<{ path: string; adapter: RoomExternalDiscussionAdapter }>>();
  const canonical = options.canonicalExecutable ?? (async (value: string) => {
    if (!isAbsolute(value)) throw new Error('runtime_identity_mismatch');
    const result = await realpath(value);
    if (!(await stat(result)).isFile()) throw new Error('runtime_identity_mismatch');
    return result;
  });
  const unavailable = (logicalAgentId: string, runtime: RoomExternalDiscussionRuntime = 'kiro', reason = 'unsupported_protocol'): NonNullable<Resolution> => ({ logicalAgentId, runtime, protocol: 'room_discussion_v1', supported: false, reason });
  async function agents(): Promise<Agent[]> {
    const response = await options.request('/agents');
    if (!response.ok) throw new Error('agent_catalog_unavailable');
    const value = await response.json() as { agents?: Agent[] };
    return Array.isArray(value.agents) ? value.agents : [];
  }
  async function installation(runtime: RoomExternalDiscussionRuntime) {
    let pending = installations.get(runtime);
    if (!pending) {
      pending = (async () => {
        const response = await options.request('/runtimes');
        if (!response.ok) throw new Error('not_installed');
        const value = await response.json() as { runtimes?: Array<{ type?: string; path?: string }> };
        const entry = value.runtimes?.find(item => item.type === runtime);
        if (!entry?.path) throw new Error('not_installed');
        const path = await canonical(entry.path);
        const profile: Profile = ['.js', '.mjs', '.cjs'].includes(extname(path))
          ? { executable: process.execPath, argsPrefix: [path] } : { executable: path };
        return { path, adapter: options.makeAdapter({ profiles: { [runtime]: profile } }) };
      })().catch(error => { installations.delete(runtime); throw error; });
      installations.set(runtime, pending);
    }
    return pending;
  }
  async function resolveWith(logicalAgentId: string, rows: Agent[],guard=effectGuard()): Promise<Resolution> {
    guard.check();
    if (logicalAgentId === XIAOK_WORKER_SEED_ID || logicalAgentId === 'xiaok-po') return null;
    const agent = rows.find(row => row.id === logicalAgentId && !row.archivedAt);
    if (!agent) return unavailable(logicalAgentId);
    if (agent.execution?.mode === 'hosted') {
      if (agent.participantId && agent.participantId !== agent.execution.hostParticipantId) return unavailable(logicalAgentId, undefined, 'runtime_identity_mismatch');
      return agent.execution.hostParticipantId === XIAOK_DESKTOP_HOST_PARTICIPANT_ID ? null : unavailable(logicalAgentId);
    }
    if (agent.runtimeSource === 'desktop-agent-runtime' && agent.execution?.mode !== 'self_running') return null;
    if (agent.execution?.mode === 'self_running' && agent.participantId && agent.participantId !== agent.execution.participantId) return unavailable(logicalAgentId, undefined, 'runtime_identity_mismatch');
    const runtime = agent.runtimeType;
    if (agent.execution?.mode !== 'self_running' || !agent.execution.participantId || (runtime !== 'qoder' && runtime !== 'xiaok')) return unavailable(logicalAgentId, runtime === 'kiro' ? runtime : undefined);
    try {
      const installed = await installation(runtime);
      guard.check();
      if (agent.runtimePath){const current=await canonical(agent.runtimePath);guard.check();if(current!==installed.path)return unavailable(logicalAgentId, runtime, 'runtime_identity_mismatch');}
      const capability=await installed.adapter.probe(runtime,guard.check);guard.check();
      return { ...capability, logicalAgentId };
    } catch(error) { if(guard.failed(error))throw error;return unavailable(logicalAgentId, runtime, 'not_installed'); }
  }
  return {
    async resolve(logicalAgentId: string,beforeEffects?:()=>void): Promise<Resolution> {
      const guard=effectGuard(beforeEffects);guard.check();
      if (logicalAgentId === XIAOK_WORKER_SEED_ID || logicalAgentId === 'xiaok-po') return null;
      try { const rows=await agents();guard.check();return await resolveWith(logicalAgentId,rows,guard); }
      catch(error) { if(guard.failed(error))throw error;return unavailable(logicalAgentId); }
    },
    async capabilities(ids?: string[]): Promise<RoomAgentExecutionCapability[]> {
      const rows = await agents().catch(() => []);
      const targetIds = ids ?? [...new Set([XIAOK_WORKER_SEED_ID, ...rows.map(row => row.id)])];
      return Promise.all(targetIds.map(async logicalAgentId => {
        const result = await resolveWith(logicalAgentId, rows);
        return result === null ? { logicalAgentId, mode: 'workspace_worker' as const }
          : { logicalAgentId, mode: result.supported ? 'discussion_only' as const : 'discussion_unavailable' as const, runtime: result.runtime, ...(result.reason ? { reason: result.reason } : {}) };
      }));
    },
    async execute(input: Parameters<RoomExternalDiscussionAdapter['execute']>[0]) {
      assertBeforeEffects(input.beforeEffects);
      const installed = installations.get(input.runtime);
      if (!installed) throw new Error('discussion_protocol_unavailable');
      const current=await installed;assertBeforeEffects(input.beforeEffects);return current.adapter.execute(input);
    },
  };
}
