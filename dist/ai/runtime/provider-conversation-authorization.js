import { computeEphemeralProviderTranscriptDigest, } from './provider-transcript-digest.js';
import { resolveRegisteredStrictKimiK3Profile } from './model-harness-identity.js';
const claimsByAuthorization = new WeakMap();
const authorizationByReservation = new WeakMap();
function issueTaskLocalProviderConversationAuthorization(input) {
    const profileId = requireStrictProfile(input.adapter);
    assertAuthorizationSurfaceShape(input.surfaceKind, input.messages);
    assertTaskLocalStrictHistory(input.messages);
    const authorization = Object.freeze(Object.create(null));
    claimsByAuthorization.set(authorization, {
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
export function streamCliChatTaskProviderConversation(input) {
    return streamOwnedProviderConversation(input, 'cli-chat-task');
}
export function streamCliSubagentProviderConversation(input) {
    return streamOwnedProviderConversation(input, 'cli-subagent');
}
export function streamCliCompactionProviderConversation(input) {
    return streamOwnedProviderConversation(input, 'cli-compaction');
}
export function streamDesktopTaskProviderConversation(input) {
    return streamOwnedProviderConversation(input, 'desktop-task');
}
export function streamStatelessSideCallProviderConversation(input) {
    return streamOwnedProviderConversation(input, 'stateless-fresh-side-call');
}
function streamOwnedProviderConversation(input, surfaceKind) {
    const profileId = resolveRegisteredStrictKimiK3Profile(input.adapter);
    if (!profileId) {
        const claimedProfileId = readClaimedHarnessProfileId(input.adapter);
        if (claimedProfileId === 'kimi-k3-coding-openai'
            || claimedProfileId === 'kimi-k3-256k-coding-openai') {
            throw new Error('KIMI_K3_PROFILE_CAPABILITY_REQUIRED');
        }
        return input.options === undefined
            ? input.adapter.stream(input.messages, input.tools, input.systemPrompt)
            : input.adapter.stream(input.messages, input.tools, input.systemPrompt, input.options);
    }
    const providerConversationAuthorization = issueTaskLocalProviderConversationAuthorization({
        adapter: input.adapter,
        surfaceKind,
        invocationId: input.invocationId,
        messages: input.messages,
    });
    return input.adapter.stream(input.messages, input.tools, input.systemPrompt, {
        ...input.options,
        providerConversationAuthorization,
    });
}
function readClaimedHarnessProfileId(adapter) {
    const candidate = adapter;
    try {
        const fromGetter = candidate.getHarnessProfileId?.();
        if (typeof fromGetter === 'string') {
            return fromGetter;
        }
    }
    catch {
        return undefined;
    }
    return typeof candidate.harnessContext?.profile?.id === 'string'
        ? candidate.harnessContext.profile.id
        : undefined;
}
export function reserveProviderConversationAuthorization(input) {
    if (!input.authorization) {
        throw new Error('KIMI_K3_AUTHORIZATION_REQUIRED');
    }
    const authorization = input.authorization;
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
    const reservation = Object.freeze(Object.create(null));
    authorizationByReservation.set(reservation, authorization);
    return reservation;
}
export function consumeProviderConversationAuthorization(input) {
    const authorization = authorizationByReservation.get(input.reservation);
    const claims = authorization ? claimsByAuthorization.get(authorization) : undefined;
    if (!claims || claims.state !== 'reserved') {
        throw new Error('KIMI_K3_AUTHORIZATION_REJECTED');
    }
    verifyClaims(claims, input.adapter, input.messages);
    claims.state = 'consumed';
}
export function verifyConsumedProviderConversationAuthorizationForRetry(input) {
    const authorization = authorizationByReservation.get(input.reservation);
    const claims = authorization ? claimsByAuthorization.get(authorization) : undefined;
    if (!claims || claims.state !== 'consumed') {
        throw new Error('KIMI_K3_AUTHORIZATION_REJECTED');
    }
    verifyClaims(claims, input.adapter, input.messages);
}
function verifyClaims(claims, adapter, messages) {
    const profileId = resolveRegisteredStrictKimiK3Profile(adapter);
    assertAuthorizationSurfaceShape(claims.surfaceKind, messages);
    if (claims.adapter !== adapter
        || claims.profileId !== profileId
        || claims.digest !== computeEphemeralProviderTranscriptDigest({
            surfaceKind: claims.surfaceKind,
            invocationId: claims.invocationId,
            providerConversationProfileId: claims.profileId,
            messages,
        })) {
        throw new Error('KIMI_K3_AUTHORIZATION_MISMATCH');
    }
}
function assertAuthorizationSurfaceShape(surfaceKind, messages) {
    if (surfaceKind !== 'stateless-fresh-side-call'
        && surfaceKind !== 'cli-compaction') {
        return;
    }
    for (const message of messages) {
        if (message.role !== 'user') {
            throw new Error('KIMI_K3_AUTHORIZATION_SURFACE_SHAPE_REJECTED');
        }
        for (const block of message.content) {
            if (block.type === 'thinking'
                || block.type === 'tool_use'
                || block.type === 'tool_result') {
                throw new Error('KIMI_K3_AUTHORIZATION_SURFACE_SHAPE_REJECTED');
            }
        }
    }
}
function assertTaskLocalStrictHistory(messages) {
    for (const message of messages) {
        if (message.role !== 'assistant') {
            continue;
        }
        const hasOfficialReasoning = message.content.some((block) => block.type === 'thinking'
            && block.reasoningProvenance?.captureVersion === 1
            && block.reasoningProvenance.source === 'reasoning_content'
            && block.reasoningProvenance.fieldPresence === 'present');
        if (!hasOfficialReasoning) {
            throw new Error('KIMI_K3_DURABLE_RESUME_UNSUPPORTED');
        }
    }
}
function requireStrictProfile(adapter) {
    const profileId = resolveRegisteredStrictKimiK3Profile(adapter);
    if (!profileId) {
        throw new Error('KIMI_K3_AUTHORIZATION_PROFILE_REQUIRED');
    }
    return profileId;
}
