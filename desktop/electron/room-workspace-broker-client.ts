import { desktopServiceUrl } from './desktop-service-discovery.js';
import { types } from 'node:util';
import { createRoomTurnCustody } from './original-room-turn-custody.js';
import { createIntrinsicSet } from '../../src/runtime/verification/intrinsic-async-collection.js';
import {
  assertOriginalKSwarmBrokerClientToken,
  readOriginalKSwarmRoomProjectMappingIO,
} from './kswarm-service.js';
import {
  assertRoomTurnCustody,
  type RoomTurnCustody,
} from './original-room-turn-custody.js';
import { captureDispatchBusinessData } from '../../src/runtime/conversation-activity/dispatch-business-data.js';
const workspaceGet = WeakMap.prototype.get,
  workspaceSet = WeakMap.prototype.set,
  workspaceApply = Reflect.apply;
const workspaceFetch = fetch,
  workspaceJson = Response.prototype.json,
  workspaceStatus = Object.getOwnPropertyDescriptor(
    Response.prototype,
    'status',
  )!.get!;
const workspaceKeys = Reflect.ownKeys,
  workspaceDescriptor = Object.getOwnPropertyDescriptor,
  workspaceOwn = Object.hasOwn,
  workspaceFreeze = Object.freeze;
const workspaceThen = Promise.prototype.then,
  workspaceCreate = Object.create,
  workspaceDefine = Object.defineProperty;
const workspaceEncode = encodeURIComponent,
  workspaceString = String,
  workspaceStringify = JSON.stringify,
  workspaceTimeout = AbortSignal.timeout,
  workspaceSafeInteger = Number.isSafeInteger,
  workspaceIsArray = Array.isArray,
  workspaceProxy = types.isProxy;
type OriginalWorkspaceWakeInput = Readonly<{
  roomId: string;
  roomMessageId: string;
  logicalAgentId: string;
  hostParticipantId: string;
  claimId?: string;
  discussionOnly?: boolean;
}>;
interface OriginalWorkspaceClient {
  bind(service: unknown): void;
  claim(
    context: RoomTurnCustody,
    input: OriginalWorkspaceWakeInput,
  ): Promise<Record<string, unknown>>;
  abandon(
    context: RoomTurnCustody,
    input: Readonly<{ roomId: string; claimToken: string }>,
  ): Promise<Record<string, unknown>>;
}
const originalWorkspaceClients = new WeakMap<object, OriginalWorkspaceClient>();
export function bindOriginalRoomWorkspaceDiscussionClient(
  client: unknown,
  service: unknown,
): void {
  const row = workspaceApply(workspaceGet, originalWorkspaceClients, [
    client,
  ]) as OriginalWorkspaceClient | undefined;
  if (!row) throw Error('ROOM_SCOPED_ORIGINAL_WORKSPACE_REQUIRED');
  row.bind(service);
}
export function claimOriginalRoomWorkspaceDiscussion(
  client: unknown,
  context: RoomTurnCustody,
  input: Readonly<{
    roomId: string;
    roomMessageId: string;
    logicalAgentId: string;
    hostParticipantId: string;
  }>,
): Promise<Record<string, unknown>> {
  const row = workspaceApply(workspaceGet, originalWorkspaceClients, [
    client,
  ]) as OriginalWorkspaceClient | undefined;
  if (!row) throw Error('ROOM_SCOPED_ORIGINAL_WORKSPACE_REQUIRED');
  assertRoomTurnCustody(context);
  return row.claim(context, { ...input, discussionOnly: true });
}
export function claimOriginalRoomWorkspaceWake(
  client: unknown,
  context: RoomTurnCustody,
  input: OriginalWorkspaceWakeInput,
): Promise<Record<string, unknown>> {
  const row = workspaceApply(workspaceGet, originalWorkspaceClients, [
    client,
  ]) as OriginalWorkspaceClient | undefined;
  if (!row) throw Error('ROOM_SCOPED_ORIGINAL_WORKSPACE_REQUIRED');
  assertRoomTurnCustody(context);
  return row.claim(context, input);
}
export function abandonOriginalRoomWorkspaceWake(
  client: unknown,
  context: RoomTurnCustody,
  input: Readonly<{ roomId: string; claimToken: string }>,
): Promise<Record<string, unknown>> {
  const row = workspaceApply(workspaceGet, originalWorkspaceClients, [
    client,
  ]) as OriginalWorkspaceClient | undefined;
  if (!row) throw Error('ROOM_SCOPED_ORIGINAL_WORKSPACE_REQUIRED');
  assertRoomTurnCustody(context);
  return row.abandon(context, input);
}
import { randomUUID } from 'node:crypto';
import type { RoomWorkspaceBrokerPort } from './room-workspace-service.js';

/** Private authenticated main transport, never exposed as a generic IPC API. */
export function createRoomWorkspaceBrokerClient(options: {
  token: string;
  ready?: () => Promise<void>;
  isMutationOwner: () => boolean;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl ?? 'http://127.0.0.1:4318';
  const discoveredBaseUrl = () => options.baseUrl ?? desktopServiceUrl('broker');
  const startupId = randomUUID(),
    originalToken = options.token,
    mutationOwner = options.isMutationOwner;
  let boundService: unknown,
    qualified = false,
    registrationStarted = false,
    retired: { raw: unknown } | undefined;
  const qualifiedStocks = createIntrinsicSet<RoomTurnCustody>(),
    serviceGates = new WeakMap<
      object,
      ReturnType<typeof readOriginalKSwarmRoomProjectMappingIO>
    >();
  const acceptedWakes = new Map<
    string,
    { roomId: string; hostIncarnation: number }
  >();
  const mapGet = Map.prototype.get,
    mapSet = Map.prototype.set;
  let registration:
    | Promise<{ hostId: string; hostIncarnation: number }>
    | undefined;
  async function send(
    roomId: string,
    action?: string,
    input?: Record<string, unknown>,
    incarnation?: number,
    revision?: number,
  ) {
    await options.ready?.();
    const url = `${discoveredBaseUrl()}/rooms/${encodeURIComponent(roomId)}/workspace${action ? `/${action}` : ''}${revision === undefined ? '' : `?instructionsRevision=${revision}`}`;
    const response = await fetchImpl(url, {
      method: action ? 'POST' : 'GET',
      signal: AbortSignal.timeout(15_000),
      headers: {
        'x-intent-broker-room-token': options.token,
        ...(action ? { 'content-type': 'application/json' } : {}),
        ...(incarnation
          ? { 'x-intent-broker-host-incarnation': workspaceString(incarnation) }
          : {}),
      },
      ...(action ? { body: JSON.stringify(input ?? {}) } : {}),
    });
    return (await response.json()) as Record<string, unknown>;
  }
  async function getHost(roomId: string) {
    if (qualified) return runQualified((context) => fixedHost(context, roomId));
    registrationStarted = true;
    if (!options.isMutationOwner())
      throw new Error('workspace_mutation_owner_busy');
    if (!registration)
      registration = send(roomId, 'register-host', { startupId })
        .then((result) => {
          const host = result.host as
            | { hostId?: string; hostIncarnation?: number }
            | undefined;
          if (
            !result.ok ||
            !host?.hostId ||
            !Number.isSafeInteger(host.hostIncarnation)
          )
            throw new Error(
              String(result.code ?? 'workspace_protocol_unavailable'),
            );
          return {
            hostId: host.hostId,
            hostIncarnation: host.hostIncarnation!,
          };
        })
        .catch((error) => {
          registration = undefined;
          throw error;
        });
    return registration;
  }
  const port: RoomWorkspaceBrokerPort = {
    async get(roomId) {
      if (qualified)
        return runQualified(async (context) => {
          const host = await fixedHost(context, roomId);
          return fixedSend(context, roomId, '', {}, host.hostIncarnation);
        });
      const host = await getHost(roomId);
      return send(roomId, undefined, undefined, host.hostIncarnation);
    },
    async request(roomId, action, input) {
      if (!/^[a-z]+(?:-[a-z]+)*$/.test(action))
        throw new Error('workspace_action_invalid');
      if (qualified)
        return runQualified(async (context) => {
          const host = await fixedHost(context, roomId);
          return fixedSend(
            context,
            roomId,
            action,
            input,
            host.hostIncarnation,
          );
        });
      const host = await getHost(roomId);
      return send(roomId, action, input, host.hostIncarnation);
    },
  };
  const originalClient = {
    ...port,
    getHost,
    async getInstructions(roomId: string, revision: number) {
      const host = await getHost(roomId);
      return send(roomId, undefined, undefined, host.hostIncarnation, revision);
    },
    async probe() {
      await options.ready?.();
      const response = await fetchImpl(`${discoveredBaseUrl()}/rooms/workspace-protocol`, { headers: { 'x-intent-broker-room-token': options.token }, signal: AbortSignal.timeout(15_000) });
      return response.json();
    },
  };
  async function runQualified<T>(
    work: (context: RoomTurnCustody) => Promise<T>,
  ): Promise<T> {
    const context = createRoomTurnCustody();
    qualifiedStocks.add(context);
    let result: T | undefined, first: { raw: unknown } | undefined;
    try {
      result = await context.root(() => work(context));
    } catch (raw) {
      first = { raw };
    }
    try {
      await context.waitPhysicalKnown();
      qualifiedStocks.delete(context);
    } catch (raw) {
      first ??= { raw };
    }
    if (first) throw first.raw;
    return result!;
  }
  function local(context: RoomTurnCustody): void {
    context.current();
    if (!qualified || retired)
      throw Error('ROOM_SCOPED_WORKSPACE_NOT_CURRENT', { cause: retired?.raw });
    assertOriginalKSwarmBrokerClientToken(boundService, originalToken);
    let gate = workspaceApply(workspaceGet, serviceGates, [context]) as
      | ReturnType<typeof readOriginalKSwarmRoomProjectMappingIO>
      | undefined;
    if (!gate) {
      gate = readOriginalKSwarmRoomProjectMappingIO(boundService);
      workspaceApply(workspaceSet, serviceGates, [context, gate]);
    }
    gate.assertLocal();
    context.current();
  }
  async function fixedSend(
    context: RoomTurnCustody,
    roomId: string,
    action: string,
    input: Record<string, unknown>,
    incarnation?: number,
    negative = false,
  ): Promise<Record<string, unknown>> {
    const check = () => {
      if (negative) {
        assertRoomTurnCustody(context);
        context.current();
        if (!qualified) throw Error('ROOM_SCOPED_ORIGINAL_BINDING_REQUIRED');
        assertOriginalKSwarmBrokerClientToken(boundService, originalToken);
      } else local(context);
    };
    check();
    const headers = workspaceCreate(null) as Record<string, string>;
    workspaceDefine(headers, 'x-intent-broker-room-token', {
      __proto__: null,
      value: originalToken,
      enumerable: true,
    } as PropertyDescriptor);
    workspaceDefine(headers, 'content-type', {
      __proto__: null,
      value: 'application/json',
      enumerable: true,
    } as PropertyDescriptor);
    if (incarnation !== undefined)
      workspaceDefine(headers, 'x-intent-broker-host-incarnation', {
        __proto__: null,
        value: workspaceString(incarnation),
        enumerable: true,
      } as PropertyDescriptor);
    let acquired: Response | undefined,
      bodyEntered = false;
    try {
      const send = () => {
        check();
        return workspaceApply(fetchImpl, undefined, [
          `${baseUrl}/rooms/${workspaceEncode(roomId)}/workspace${action ? '/' + action : ''}`,
          {
            __proto__: null,
            method: action ? 'POST' : 'GET',
            headers,
            ...(action ? { body: workspaceStringify(input) } : {}),
            redirect: 'error',
            cache: 'no-store',
            signal: workspaceTimeout(15000),
          },
        ]);
      };
      const response = await context.sdk<Response>(send, undefined, [], {
        accept(value) {
          if (!value || typeof value !== 'object' || workspaceProxy(value))
            return false;
          const names = workspaceKeys(value);
          for (let i = 0; i < names.length; i++) {
            const row = workspaceDescriptor(value, names[i]!);
            if (!row || !workspaceOwn(row, 'value')) return false;
          }
          try {
            workspaceApply(workspaceStatus, value, []);
            acquired = value as Response;
            return true;
          } catch {
            return false;
          }
        },
        consumer: workspaceJson,
      });
      const status = await context.consumeResource<number>(
        workspaceStatus,
        response,
        [],
      );
      bodyEntered = true;
      const raw = await context.consumeResource<unknown>(
        workspaceJson,
        response,
        [],
      );
      const data = captureDispatchBusinessData(raw, (value) =>
        context.inventory(value),
      ) as Record<string, unknown>;
      check();
      if (status < 200 || status >= 300)
        throw Error('ROOM_SCOPED_WORKSPACE_UNAVAILABLE');
      return data;
    } catch (first) {
      if (acquired && !bodyEntered) {
        bodyEntered = true;
        try {
          const cleanup = context.consumeResource(workspaceJson, acquired, []);
          const observed = workspaceApply(workspaceThen, cleanup, [
            () => undefined,
            (raw: unknown) => context.inventory(raw),
          ]);
          context.inventory(observed);
        } catch (raw) {
          context.inventory(raw);
        }
      }
      throw first;
    }
  }
  async function fixedHost(
    context: RoomTurnCustody,
    roomId: string,
  ): Promise<{ hostId: string; hostIncarnation: number }> {
    local(context);
    const allowed = await context.sdk<boolean>(mutationOwner, undefined, []);
    local(context);
    if (allowed !== true) throw Error('workspace_mutation_owner_busy');
    if (!registration) {
      registrationStarted = true;
      const raw = fixedSend(context, roomId, 'register-host', { startupId });
      registration = workspaceApply(workspaceThen, raw, [
        (result: Record<string, unknown>) => {
          const host = result.host as Record<string, unknown> | undefined;
          if (
            result.ok !== true ||
            !host ||
            typeof host !== 'object' ||
            workspaceIsArray(host) ||
            typeof host.hostId !== 'string' ||
            !host.hostId ||
            typeof host.hostIncarnation !== 'number' ||
            !workspaceSafeInteger(host.hostIncarnation) ||
            host.hostIncarnation < 1
          )
            throw Error('workspace_protocol_unavailable');
          return {
            hostId: host.hostId,
            hostIncarnation: host.hostIncarnation as number,
          };
        },
        (raw: unknown) => {
          retired = { raw };
          throw raw;
        },
      ]);
    }
    const host = await context.sdk<{ hostId: string; hostIncarnation: number }>(
      () => registration!,
      undefined,
      [],
    );
    local(context);
    return host;
  }
  workspaceApply(workspaceSet, originalWorkspaceClients, [
    originalClient,
    workspaceFreeze({
      bind(service: unknown) {
        assertOriginalKSwarmBrokerClientToken(service, originalToken);
        if (fetchImpl !== workspaceFetch || baseUrl !== 'http://127.0.0.1:4318')
          throw Error('ROOM_SCOPED_ORIGINAL_WORKSPACE_TRANSPORT_REQUIRED');
        if (qualified) {
          if (boundService !== service)
            throw Error('ROOM_SCOPED_WORKSPACE_SERVICE_MISMATCH');
          if (retired) throw Error('ROOM_SCOPED_WORKSPACE_NOT_CURRENT');
          return;
        }
        if (registrationStarted)
          throw Error('ROOM_SCOPED_WORKSPACE_LEGACY_REGISTRATION_STARTED');
        boundService = service;
        qualified = true;
      },
      async claim(context: RoomTurnCustody, input: OriginalWorkspaceWakeInput) {
        local(context);
        const closed = captureDispatchBusinessData(input, (raw) =>
          context.inventory(raw),
        ) as OriginalWorkspaceWakeInput;
        if (
          !closed ||
          typeof closed !== 'object' ||
          typeof closed.roomId !== 'string' ||
          typeof closed.roomMessageId !== 'string' ||
          typeof closed.logicalAgentId !== 'string' ||
          typeof closed.hostParticipantId !== 'string'
        )
          throw Error('room_input_invalid');
        if (
          closed.discussionOnly !== true &&
          (typeof closed.claimId !== 'string' || !closed.claimId)
        )
          throw Error('ROOM_SCOPED_ORIGINAL_PROJECT_CLAIM_REQUIRED');
        const host = await fixedHost(context, closed.roomId);
        local(context);
        const body: Record<string, unknown> = {
          roomMessageId: closed.roomMessageId,
          logicalAgentId: closed.logicalAgentId,
          hostParticipantId: closed.hostParticipantId,
        };
        if (closed.discussionOnly === true) body.discussionOnly = true;
        else body.claimId = closed.claimId;
        const reply = await fixedSend(
          context,
          closed.roomId,
          'claim-wake',
          body,
          host.hostIncarnation,
        );
        if (reply.ok === true && typeof reply.claimToken === 'string')
          workspaceApply(mapSet, acceptedWakes, [
            reply.claimToken,
            { roomId: closed.roomId, hostIncarnation: host.hostIncarnation },
          ]);
        return reply;
      },
      async abandon(
        context: RoomTurnCustody,
        input: Readonly<{ roomId: string; claimToken: string }>,
      ) {
        const closed = captureDispatchBusinessData(input, (raw) =>
          context.inventory(raw),
        ) as typeof input;
        const accepted = workspaceApply(mapGet, acceptedWakes, [
          closed.claimToken,
        ]) as { roomId: string; hostIncarnation: number } | undefined;
        if (!accepted || accepted.roomId !== closed.roomId)
          throw Error('ROOM_SCOPED_ORIGINAL_CLAIM_REQUIRED');
        // This is an existing host-bound negative settlement. It never asks for
        // a new host, mutation lease, project membership or business effect.
        return fixedSend(
          context,
          closed.roomId,
          'abandon-wake',
          { claimToken: closed.claimToken, reason: 'execution_failed' },
          accepted.hostIncarnation,
          true,
        );
      },
    }),
  ]);
  return originalClient;
}
