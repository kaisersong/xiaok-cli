import type { Message, ModelAdapter } from '../../types.js';
import {
  computeEphemeralProviderTranscriptDigest,
  type StrictKimiK3ProfileId,
} from './provider-transcript-digest.js';
import { resolveRegisteredStrictKimiK3Profile } from './model-harness-identity.js';
import type { StreamOptions } from './model-capabilities.js';
import type { StreamChunk, ToolDefinition } from '../../types.js';

type StreamCapableAdapter = Pick<ModelAdapter, 'stream'>;

export interface ProviderConversationAuthorization {
  readonly opaqueAuthorization: never;
}

export type ProviderConversationSurfaceKind =
  | 'desktop-task'
  | 'cli-subagent'
  | 'cli-compaction'
  | 'cli-chat-task'
  | 'stateless-fresh-side-call';

interface AuthorizationClaims {
  adapter: StreamCapableAdapter;
  profileId: StrictKimiK3ProfileId;
  surfaceKind: ProviderConversationSurfaceKind;
  invocationId: string;
  digest: `sha256:${string}`;
  state: 'issued' | 'reserved' | 'consumed';
}

export interface ProviderConversationAuthorizationReservation {
  readonly opaqueReservation: never;
}

const claimsByAuthorization = new WeakMap<object, AuthorizationClaims>();
const authorizationByReservation = new WeakMap<object, object>();

function issueTaskLocalProviderConversationAuthorization(input: {
  adapter: StreamCapableAdapter;
  surfaceKind: ProviderConversationSurfaceKind;
  invocationId: string;
  messages: readonly Message[];
}): ProviderConversationAuthorization {
  const profileId = requireStrictProfile(input.adapter);
  assertAuthorizationSurfaceShape(input.surfaceKind, input.messages);
  assertTaskLocalStrictHistory(input.messages);
  const authorization = Object.freeze(Object.create(null)) as ProviderConversationAuthorization;
  claimsByAuthorization.set(authorization as object, {
    adapter: input.adapter,
    profileId,
    surfaceKind: input.surfaceKind,
    invocationId: input.invocationId,
    digest: computeEphemeralProviderTranscriptDigest({
      surfaceKind: input.surfaceKind,
      invocationId: input.invocationId,
      providerConversationProfileId: profileId,
      messages: input.messages,
    }),
    state: 'issued',
  });
  return authorization;
}

interface ProviderConversationStreamInput {
  adapter: StreamCapableAdapter;
  messages: Message[];
  tools: ToolDefinition[];
  systemPrompt: string;
  options?: StreamOptions;
  invocationId: string;
}

export function streamCliChatTaskProviderConversation(
  input: ProviderConversationStreamInput,
): AsyncIterable<StreamChunk> {
  return streamOwnedProviderConversation(input, 'cli-chat-task');
}

export function streamCliSubagentProviderConversation(
  input: ProviderConversationStreamInput,
): AsyncIterable<StreamChunk> {
  return streamOwnedProviderConversation(input, 'cli-subagent');
}

export function streamCliCompactionProviderConversation(
  input: ProviderConversationStreamInput,
): AsyncIterable<StreamChunk> {
  return streamOwnedProviderConversation(input, 'cli-compaction');
}

export function streamDesktopTaskProviderConversation(
  input: ProviderConversationStreamInput,
): AsyncIterable<StreamChunk> {
  return streamOwnedProviderConversation(input, 'desktop-task');
}

export function streamStatelessSideCallProviderConversation(
  input: ProviderConversationStreamInput,
): AsyncIterable<StreamChunk> {
  return streamOwnedProviderConversation(input, 'stateless-fresh-side-call');
}

function streamOwnedProviderConversation(
  input: ProviderConversationStreamInput,
  surfaceKind: ProviderConversationSurfaceKind,
): AsyncIterable<StreamChunk> {
  const profileId = resolveRegisteredStrictKimiK3Profile(input.adapter);
  if (!profileId) {
    const claimedProfileId = readClaimedHarnessProfileId(input.adapter);
    if (
      claimedProfileId === 'kimi-k3-coding-openai'
      || claimedProfileId === 'kimi-k3-256k-coding-openai'
    ) {
      throw new Error('KIMI_K3_PROFILE_CAPABILITY_REQUIRED');
    }
    return input.options === undefined
      ? input.adapter.stream(
          input.messages,
          input.tools,
          input.systemPrompt,
        )
      : input.adapter.stream(
          input.messages,
          input.tools,
          input.systemPrompt,
          input.options,
        );
  }
  const providerConversationAuthorization =
    issueTaskLocalProviderConversationAuthorization({
      adapter: input.adapter,
      surfaceKind,
      invocationId: input.invocationId,
      messages: input.messages,
    });
  return input.adapter.stream(
    input.messages,
    input.tools,
    input.systemPrompt,
    {
      ...input.options,
      providerConversationAuthorization,
    },
  );
}

function readClaimedHarnessProfileId(
  adapter: StreamCapableAdapter,
): string | undefined {
  const candidate = adapter as StreamCapableAdapter & {
    getHarnessProfileId?: () => unknown;
    harnessContext?: { profile?: { id?: unknown } };
  };
  try {
    const fromGetter = candidate.getHarnessProfileId?.();
    if (typeof fromGetter === 'string') {
      return fromGetter;
    }
  } catch {
    return undefined;
  }
  return typeof candidate.harnessContext?.profile?.id === 'string'
    ? candidate.harnessContext.profile.id
    : undefined;
}

export function reserveProviderConversationAuthorization(input: {
  authorization: ProviderConversationAuthorization | undefined;
  adapter: StreamCapableAdapter;
  messages: readonly Message[];
}): ProviderConversationAuthorizationReservation {
  if (!input.authorization) {
    throw new Error('KIMI_K3_AUTHORIZATION_REQUIRED');
  }
  const authorization = input.authorization as object;
  const claims = claimsByAuthorization.get(authorization);
  if (!claims) {
    throw new Error('KIMI_K3_AUTHORIZATION_REJECTED');
  }
  if (claims.state === 'consumed') {
    throw new Error('KIMI_K3_AUTHORIZATION_REPLAYED');
  }
  if (claims.state !== 'issued') {
    throw new Error('KIMI_K3_AUTHORIZATION_REPLAYED');
  }
  verifyClaims(claims, input.adapter, input.messages);
  claims.state = 'reserved';
  const reservation = Object.freeze(Object.create(null)) as
    ProviderConversationAuthorizationReservation;
  authorizationByReservation.set(reservation as object, authorization);
  return reservation;
}

export function consumeProviderConversationAuthorization(input: {
  reservation: ProviderConversationAuthorizationReservation;
  adapter: StreamCapableAdapter;
  messages: readonly Message[];
}): void {
  const authorization = authorizationByReservation.get(input.reservation as object);
  const claims = authorization ? claimsByAuthorization.get(authorization) : undefined;
  if (!claims || claims.state !== 'reserved') {
    throw new Error('KIMI_K3_AUTHORIZATION_REJECTED');
  }
  verifyClaims(claims, input.adapter, input.messages);
  claims.state = 'consumed';
}

export function verifyConsumedProviderConversationAuthorizationForRetry(input: {
  reservation: ProviderConversationAuthorizationReservation;
  adapter: StreamCapableAdapter;
  messages: readonly Message[];
}): void {
  const authorization = authorizationByReservation.get(input.reservation as object);
  const claims = authorization ? claimsByAuthorization.get(authorization) : undefined;
  if (!claims || claims.state !== 'consumed') {
    throw new Error('KIMI_K3_AUTHORIZATION_REJECTED');
  }
  verifyClaims(claims, input.adapter, input.messages);
}

function verifyClaims(
  claims: AuthorizationClaims,
  adapter: StreamCapableAdapter,
  messages: readonly Message[],
): void {
  const profileId = resolveRegisteredStrictKimiK3Profile(adapter);
  assertAuthorizationSurfaceShape(claims.surfaceKind, messages);
  if (
    claims.adapter !== adapter
    || claims.profileId !== profileId
    || claims.digest !== computeEphemeralProviderTranscriptDigest({
      surfaceKind: claims.surfaceKind,
      invocationId: claims.invocationId,
      providerConversationProfileId: claims.profileId,
      messages,
    })
  ) {
    throw new Error('KIMI_K3_AUTHORIZATION_MISMATCH');
  }
}

function assertAuthorizationSurfaceShape(
  surfaceKind: ProviderConversationSurfaceKind,
  messages: readonly Message[],
): void {
  if (
    surfaceKind !== 'stateless-fresh-side-call'
    && surfaceKind !== 'cli-compaction'
  ) {
    return;
  }
  for (const message of messages) {
    if (message.role !== 'user') {
      throw new Error('KIMI_K3_AUTHORIZATION_SURFACE_SHAPE_REJECTED');
    }
    for (const block of message.content) {
      if (
        block.type === 'thinking'
        || block.type === 'tool_use'
        || block.type === 'tool_result'
      ) {
        throw new Error('KIMI_K3_AUTHORIZATION_SURFACE_SHAPE_REJECTED');
      }
    }
  }
}

function assertTaskLocalStrictHistory(messages: readonly Message[]): void {
  for (const message of messages) {
    if (message.role !== 'assistant') {
      continue;
    }
    const hasOfficialReasoning = message.content.some(
      (block) => block.type === 'thinking'
        && block.reasoningProvenance?.captureVersion === 1
        && block.reasoningProvenance.source === 'reasoning_content'
        && block.reasoningProvenance.fieldPresence === 'present',
    );
    if (!hasOfficialReasoning) {
      throw new Error('KIMI_K3_DURABLE_RESUME_UNSUPPORTED');
    }
  }
}

function requireStrictProfile(
  adapter: StreamCapableAdapter,
): StrictKimiK3ProfileId {
  const profileId = resolveRegisteredStrictKimiK3Profile(adapter);
  if (!profileId) {
    throw new Error('KIMI_K3_AUTHORIZATION_PROFILE_REQUIRED');
  }
  return profileId;
}
