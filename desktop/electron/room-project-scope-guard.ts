import {
  assertOriginalBrokerAdmissionClient,
  readOriginalRoomSnapshot,
  completeOriginalRoomWake,
  readOriginalRoomHistoryPage,
} from './collaboration-room-broker-client.js';
import {
  bindOriginalRoomWorkspaceDiscussionClient,
  claimOriginalRoomWorkspaceDiscussion,
  claimOriginalRoomWorkspaceWake,
  abandonOriginalRoomWorkspaceWake,
} from './room-workspace-broker-client.js';
import {
  readOriginalKSwarmRoomProjectMappingIO,
  type OriginalKSwarmRoomProjectMappingIO,
} from './kswarm-service.js';
import {
  assertRoomTurnCustody,
  createRoomTurnCustody,
  type RoomTurnCustody,
} from './original-room-turn-custody.js';
import { captureDispatchBusinessData } from '../../src/runtime/conversation-activity/dispatch-business-data.js';
import { createIntrinsicSet } from '../../src/runtime/verification/intrinsic-async-collection.js';
const scopedApply = Reflect.apply,
  scopedGet = WeakMap.prototype.get,
  scopedSet = WeakMap.prototype.set,
  scopedFreeze = Object.freeze;
const ScopedMap = Map,
  scopedMapGet = Map.prototype.get,
  scopedMapSet = Map.prototype.set;
const scopedAbort = AbortController,
  scopedArray = Array.isArray,
  scopedTrim = String.prototype.trim,
  scopedIncludes = String.prototype.includes;
const scopedObject = (value: unknown): value is Result =>
  !!value && typeof value === 'object' && !scopedArray(value);
type ScopedCollect = {
  roomId: string;
  roomMessageId: string;
  logicalAgentIds: readonly string[];
};
type ScopedClaim = {
  roomId: string;
  roomMessageId: string;
  logicalAgentId: string;
  hostParticipantId: string;
};
export interface OriginalScopedRoomWakeAcceptance {
  collect(
    input: ScopedCollect,
    context: RoomTurnCustody,
  ): Promise<Record<string, unknown>>;
  claim(
    input: ScopedClaim,
    context: RoomTurnCustody,
  ): Promise<Record<string, unknown>>;
}
interface ScopedOrigin {
  bind(service: unknown): void;
  isBound(): boolean;
  facet: OriginalScopedRoomWakeAcceptance;
  perform(
    kind: 'claim' | 'workspaceClaim' | 'abandon' | 'complete' | 'history',
    input: unknown,
  ): Promise<Result>;
}
const scopedOrigins = new WeakMap<object, ScopedOrigin>();
export function bindOriginalRoomProjectScopeGuardClient(
  client: unknown,
  service: unknown,
): boolean {
  const row = scopedApply(scopedGet, scopedOrigins, [client]) as
    | ScopedOrigin
    | undefined;
  if (!row) return false;
  row.bind(service);
  return true;
}
/** Only non-members return undefined. A genuine unbound wrapper never falls
 * through to a raw client or a public method shape. */
export function readOptionalOriginalScopedRoomWakeAcceptance(
  client: unknown,
): OriginalScopedRoomWakeAcceptance | undefined {
  const row = scopedApply(scopedGet, scopedOrigins, [client]) as
    | ScopedOrigin
    | undefined;
  if (!row) return;
  if (!row.isBound()) throw Error('ROOM_SCOPED_ORIGINAL_BINDING_REQUIRED');
  return row.facet;
}
function scopedData(raw: unknown, context?: RoomTurnCustody): Result {
  const value = captureDispatchBusinessData(raw, (child) =>
    context?.inventory(child),
  );
  if (!value || typeof value !== 'object' || scopedArray(value))
    throw Error('room_input_invalid');
  return value as Result;
}
function scopedText(raw: unknown): string {
  if (
    typeof raw !== 'string' ||
    !raw ||
    raw.length > 1024 ||
    scopedApply(scopedTrim, raw, []) !== raw ||
    scopedApply(scopedIncludes, raw, ['\0'])
  )
    throw Error('room_project_identity_required');
  return raw;
}
function makeScopedOrigin(
  rawClient: object,
  rawWorkspace: object,
): ScopedOrigin {
  let service: unknown;
  const leases = new WeakMap<object, OriginalKSwarmRoomProjectMappingIO>(),
    claims = new ScopedMap<
      string,
      { input: ScopedClaim; context: RoomTurnCustody }
    >();
  const stocks = createIntrinsicSet<RoomTurnCustody>();
  async function finishPublic<T>(
    context: RoomTurnCustody,
    raw: Promise<T>,
  ): Promise<T> {
    let value: T | undefined, first: { raw: unknown } | undefined;
    try {
      value = await raw;
    } catch (error) {
      first = { raw: error };
    }
    // An outer runtime only sees this public Promise. Keep its SDK frontier
    // inside that Promise, including independent error/raw/Response tails.
    try {
      await context.waitPhysicalKnown();
      stocks.delete(context);
    } catch (error) {
      first ??= { raw: error };
    }
    if (first) throw first.raw;
    return value!;
  }
  const local = (context: RoomTurnCustody) => {
    assertRoomTurnCustody(context);
    context.current();
    if (!service) throw Error('ROOM_SCOPED_ORIGINAL_BINDING_REQUIRED');
    assertOriginalBrokerAdmissionClient(rawClient, service);
    let io = scopedApply(scopedGet, leases, [context]) as
      | OriginalKSwarmRoomProjectMappingIO
      | undefined;
    if (!io) {
      io = readOriginalKSwarmRoomProjectMappingIO(service);
      scopedApply(scopedSet, leases, [context, io]);
    }
    io.assertLocal();
    context.current();
    return io;
  };
  async function snapshot(
    input: ScopedCollect,
    context: RoomTurnCustody,
  ): Promise<Result> {
    local(context);
    const roomId = scopedText(input.roomId),
      messageId = scopedText(input.roomMessageId);
    const raw = await readOriginalRoomSnapshot(rawClient, context, roomId),
      data = scopedData(raw, context);
    if (
      data.ok !== true ||
      !scopedObject(data.room) ||
      data.room.roomId !== roomId ||
      data.room.status !== 'active' ||
      !scopedArray(data.messages)
    )
      throw Error('ROOM_TURN_SNAPSHOT_UNAVAILABLE');
    let source: Result | undefined;
    for (let i = 0; i < data.messages.length; i++) {
      const row = data.messages[i];
      if (scopedObject(row) && row.roomId === roomId && row.messageId === messageId)
        source = row;
    }
    if (!source) throw Error('ROOM_TURN_MESSAGE_NOT_FOUND');
    const scope = source.contextScope ?? { kind: 'room_only' };
    if (!scopedObject(scope)) throw Error('room_scope_mismatch');
    if (scope.kind === 'room_only') {
      local(context);
      return data;
    }
    if (scope.kind !== 'project') throw Error('room_scope_mismatch');
    const projectId = scopedText(scope.projectId),
      io = local(context),
      signal = new scopedAbort().signal;
    for (let i = 0; i < input.logicalAgentIds.length; i++) {
      const agent = scopedText(input.logicalAgentIds[i]),
        actual = scopedData(
          await io.read(projectId, agent, context, signal),
          context,
        );
      if (actual.ok !== true || !scopedObject(actual.project))
        throw Error('room_project_access_denied');
      const project = actual.project;
      if (
        project.id !== projectId ||
        project.primaryRoomId !== roomId ||
        project.status === 'archived' ||
        project.archived === true
      )
        throw Error('room_project_access_denied');
      local(context);
    }
    return data;
  }
  const facet: OriginalScopedRoomWakeAcceptance = scopedFreeze({
    collect(input: ScopedCollect, context: RoomTurnCustody) {
      assertRoomTurnCustody(context);
      return context.root(() => {
        const data = scopedData(input, context);
        if (!scopedArray(data.logicalAgentIds))
          throw Error('room_input_invalid');
        return snapshot(
          {
            roomId: scopedText(data.roomId),
            roomMessageId: scopedText(data.roomMessageId),
            logicalAgentIds: data.logicalAgentIds as string[],
          },
          context,
        );
      });
    },
    claim(input: ScopedClaim, context: RoomTurnCustody) {
      assertRoomTurnCustody(context);
      return context.root(async () => {
        const data = scopedData(input, context),
          closed = {
            roomId: scopedText(data.roomId),
            roomMessageId: scopedText(data.roomMessageId),
            logicalAgentId: scopedText(data.logicalAgentId),
            hostParticipantId: scopedText(data.hostParticipantId),
          };
        await snapshot(
          { ...closed, logicalAgentIds: [closed.logicalAgentId] },
          context,
        );
        local(context);
        const reply = scopedData(
          await claimOriginalRoomWorkspaceDiscussion(
            rawWorkspace,
            context,
            closed,
          ),
          context,
        );
        if (reply.ok === true) {
          const token = scopedText(reply.claimToken);
          scopedApply(scopedMapSet, claims, [
            token,
            { input: closed, context },
          ]);
        }
        local(context);
        return reply;
      });
    },
  });
  return {
    bind(value: unknown) {
      assertOriginalBrokerAdmissionClient(rawClient, value);
      if (service && service !== value)
        throw Error('ROOM_SCOPED_ORIGINAL_SERVICE_MISMATCH');
      bindOriginalRoomWorkspaceDiscussionClient(rawWorkspace, value);
      service = value;
    },
    isBound: () => service !== undefined,
    facet,
    async perform(
      kind: 'claim' | 'workspaceClaim' | 'abandon' | 'complete' | 'history',
      raw: unknown,
    ) {
      const data = scopedData(raw);
      let context: RoomTurnCustody;
      if (kind === 'claim') {
        context = createRoomTurnCustody();
        stocks.add(context);
        return finishPublic(
          context,
          facet.claim(data as unknown as ScopedClaim, context),
        );
      }
      if (kind === 'workspaceClaim') {
        context = createRoomTurnCustody();
        stocks.add(context);
        return finishPublic(
          context,
          context.root(async () => {
            const closed = {
              roomId: scopedText(data.roomId),
              roomMessageId: scopedText(data.roomMessageId),
              logicalAgentId: scopedText(data.logicalAgentId),
              hostParticipantId: scopedText(data.hostParticipantId),
            };
            await snapshot(
              { ...closed, logicalAgentIds: [closed.logicalAgentId] },
              context,
            );
            local(context);
            const input =
              data.discussionOnly === true
                ? { ...closed, discussionOnly: true }
                : { ...closed, claimId: scopedText(data.claimId) };
            const reply = scopedData(
              await claimOriginalRoomWorkspaceWake(
                rawWorkspace,
                context,
                input,
              ),
              context,
            );
            if (reply.ok === true)
              scopedApply(scopedMapSet, claims, [
                scopedText(reply.claimToken),
                { input: closed, context },
              ]);
            local(context);
            return reply;
          }),
        );
      }
      if (kind === 'abandon') {
        const token = scopedText(data.claimToken),
          accepted = scopedApply(scopedMapGet, claims, [token]) as
            | { input: ScopedClaim; context: RoomTurnCustody }
            | undefined;
        if (!accepted || data.roomId !== accepted.input.roomId)
          throw Error('ROOM_SCOPED_ORIGINAL_CLAIM_REQUIRED');
        const accounting = createRoomTurnCustody();
        stocks.add(accounting);
        return finishPublic(
          accounting,
          accounting.root(() =>
            abandonOriginalRoomWorkspaceWake(rawWorkspace, accounting, {
              roomId: accepted.input.roomId,
              claimToken: token,
            }),
          ),
        );
      }
      const token = scopedText(data.claimToken),
        accepted = scopedApply(scopedMapGet, claims, [token]) as
          | { input: ScopedClaim; context: RoomTurnCustody }
          | undefined;
      if (!accepted || data.roomId !== accepted.input.roomId)
        throw Error('ROOM_SCOPED_ORIGINAL_CLAIM_REQUIRED');
      context = accepted.context;
      return finishPublic(
        context,
        context.root(async () => {
          await snapshot(
            {
              ...accepted.input,
              logicalAgentIds: [accepted.input.logicalAgentId],
            },
            context,
          );
          local(context);
          const method =
            kind === 'complete'
              ? completeOriginalRoomWake
              : readOriginalRoomHistoryPage;
          const reply = await method(rawClient, context, data);
          local(context);
          return reply;
        }),
      );
    },
  };
}
import type { RoomWorkspaceBrokerPort } from './room-workspace-service.js';

type Result = Record<string, unknown>;
type RoomPort = {
  getRoomSnapshot(roomId: string): Promise<Result>;
  claimWake(input: any): Promise<Result>;
  completeWake(input: any): Promise<Result>;
  listRoomMessagesPage(input: any): Promise<Result>;
};
const object = (value: unknown): value is Result => !!value && typeof value === 'object' && !Array.isArray(value);
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

/** No permission cache: each agent operation checks both current authorities. */
export function createRoomProjectScopeGuard<R extends RoomPort, W extends RoomWorkspaceBrokerPort>(options: {
  roomClient: R;
  workspaceBroker: W;
  kswarmRequest(path: string, init?: RequestInit): Promise<{ ok: boolean; json(): Promise<unknown> }>;
}) {
  const origin=makeScopedOrigin(options.roomClient,options.workspaceBroker);
  async function authorize(roomId: unknown, roomMessageId: unknown, logicalAgentId: unknown, signal: AbortSignal) {
    if (!nonempty(roomId) || !nonempty(roomMessageId) || !nonempty(logicalAgentId)) throw new Error('room_project_identity_required');
    const snapshot = await options.roomClient.getRoomSnapshot(roomId);
    signal.throwIfAborted();
    if (!snapshot.ok || !object(snapshot.room) || snapshot.room.roomId !== roomId) throw new Error('broker_unavailable');
    const source = Array.isArray(snapshot.messages) ? snapshot.messages.find(message => object(message) && message.messageId === roomMessageId && message.roomId === roomId) : undefined;
    if (!object(source)) throw new Error('room_message_not_found');
    const scope = source.contextScope ?? { kind: 'room_only' };
    if (!object(scope)) throw new Error('room_scope_mismatch');
    if (scope.kind === 'room_only') return;
    if (scope.kind !== 'project' || !nonempty(scope.projectId)) throw new Error('room_scope_mismatch');
    const response = await options.kswarmRequest(`/projects/${encodeURIComponent(scope.projectId)}/workspace-mapping?logicalAgentId=${encodeURIComponent(logicalAgentId)}`, { signal });
    const result = await response.json();
    signal.throwIfAborted();
    if (!response.ok || !object(result) || result.ok !== true || !object(result.project)) throw new Error(object(result) && nonempty(result.error) ? result.error : 'room_project_authorization_unavailable');
    const project = result.project;
    if (project.id !== scope.projectId || project.primaryRoomId !== roomId || project.status === 'archived' || project.archived === true) throw new Error('room_project_access_denied');
    // Membership (including canonical agent IDs) belongs to this KSwarm
    // endpoint. Do not clone its policy or persist a shadow grant here.
  }
  async function guarded(input: unknown, token: boolean, invoke: () => Promise<Result>) {
    try {
      if (!object(input)) throw new Error('room_input_invalid');
      const parts = token && typeof input.claimToken === 'string' ? input.claimToken.split('|') : [];
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          authorize(input.roomId, token ? parts[0] : input.roomMessageId, token ? parts[1] : input.logicalAgentId, controller.signal),
          new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { const error = new Error('room_project_authorization_timeout'); controller.abort(error); reject(error); }, 15_000); }),
        ]);
      } finally { if (timer) clearTimeout(timer); }
      return await invoke();
    } catch (error) { return { ok: false, code: error instanceof Error ? error.message : 'room_project_authorization_unavailable' }; }
  }
  const guardedClients={
    roomClient: {
      ...options.roomClient,
      claimWake: (input: unknown) => origin.isBound()?origin.perform('claim',input):guarded(input, false, () => {
        const value = input as Result;
        return options.workspaceBroker.request(value.roomId as string, 'claim-wake', { roomMessageId: value.roomMessageId, logicalAgentId: value.logicalAgentId, hostParticipantId: value.hostParticipantId, discussionOnly: true });
      }),
      abandonWake: (input: { roomId: string; claimToken: string; reason?: string }) => {
        if(origin.isBound())return origin.perform('abandon',input);
        if (!nonempty(input?.roomId) || !nonempty(input?.claimToken)) return Promise.resolve({ ok: false, code: 'room_input_invalid' });
        return options.workspaceBroker.request(input.roomId, 'abandon-wake', { claimToken: input.claimToken, reason: 'execution_failed' });
      },
      completeWake: (input: unknown) => origin.isBound()?origin.perform('complete',input):guarded(input, true, () => options.roomClient.completeWake(input)),
      listRoomMessagesPage: (input: unknown) => origin.isBound()?origin.perform('history',input):guarded(input, true, () => options.roomClient.listRoomMessagesPage(input)),
    } as R & { abandonWake(input: { roomId: string; claimToken: string; reason?: string }): Promise<Result> },
    workspaceBroker: {
      ...options.workspaceBroker,
      request: (roomId: string, action: string, input: Result) => origin.isBound()&&(action==='claim-wake'||action==='abandon-wake')
        ? origin.perform(action==='claim-wake'?'workspaceClaim':'abandon',{...scopedData(input),roomId})
        : action === 'claim-wake'
        ? guarded({ ...input, roomId }, false, () => options.workspaceBroker.request(roomId, action, input))
        : options.workspaceBroker.request(roomId, action, input),
    } as W,
  };
  scopedApply(scopedSet,scopedOrigins,[guardedClients.roomClient,origin]);scopedApply(scopedSet,scopedOrigins,[guardedClients.workspaceBroker,origin]);
  return guardedClients;
}
