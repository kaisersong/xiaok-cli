import { createHash } from 'node:crypto';
import type { Message, MessageBlock } from '../../types.js';
import { canonicalJsonV1 } from './canonical-json.js';

export type StrictKimiK3ProfileId =
  | 'kimi-k3-coding-openai'
  | 'kimi-k3-256k-coding-openai';

const EPHEMERAL_PROVIDER_TRANSCRIPT_DOMAIN = 'xiaok:ephemeral-provider-transcript:v1\0';
const CapturedArray = Array;

function canonicalizeBlock(
  block: MessageBlock,
  role: Message['role'],
): Record<string, unknown> {
  if (block.type === 'text') {
    return { type: 'text', text: block.text };
  }
  if (block.type === 'image') {
    return {
      type: 'image',
      source: {
        type: block.source.type,
        media_type: block.source.media_type,
        data: block.source.data,
      },
    };
  }
  if (block.type === 'tool_use') {
    return {
      type: 'tool_use',
      id: block.id,
      name: block.name,
      input: block.input,
    };
  }
  if (block.type === 'tool_result') {
    return {
      type: 'tool_result',
      tool_use_id: block.tool_use_id,
      content: block.content,
      ...(block.is_error === undefined ? {} : { is_error: block.is_error }),
    };
  }

  const provenance = block.reasoningProvenance;
  if (
    role !== 'assistant'
    ||
    provenance?.captureVersion !== 1
    || provenance.source !== 'reasoning_content'
    || provenance.fieldPresence !== 'present'
  ) {
    throw new Error('KIMI_REASONING_SOURCE_INVARIANT');
  }
  return {
    type: 'thinking',
    thinking: block.thinking,
    reasoningProvenance: {
      captureVersion: 1,
      source: 'reasoning_content',
      fieldPresence: 'present',
    },
  };
}

function canonicalizeMessages(
  messages: readonly Message[],
): Array<Record<string, unknown>> {
  const canonicalMessages = new CapturedArray<Record<string, unknown>>(
    messages.length,
  );
  for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
    const message = messages[messageIndex]!;
    const content = new CapturedArray<Record<string, unknown>>(
      message.content.length,
    );
    for (let blockIndex = 0; blockIndex < message.content.length; blockIndex += 1) {
      content[blockIndex] = canonicalizeBlock(
        message.content[blockIndex]!,
        message.role,
      );
    }
    canonicalMessages[messageIndex] = {
      role: message.role,
      content,
    };
  }
  return canonicalMessages;
}

export function computeEphemeralProviderTranscriptDigest(input: {
  surfaceKind:
    | 'desktop-task'
    | 'cli-subagent'
    | 'cli-compaction'
    | 'cli-chat-task'
    | 'stateless-fresh-side-call';
  invocationId: string;
  providerConversationProfileId: StrictKimiK3ProfileId;
  messages: readonly Message[];
}): `sha256:${string}` {
  const canonical = canonicalJsonV1({
    surfaceKind: input.surfaceKind,
    invocationId: input.invocationId,
    providerConversationProfileId: input.providerConversationProfileId,
    reasoningCaptureVersion: 1,
    messages: canonicalizeMessages(input.messages),
  });
  return `sha256:${createHash('sha256')
    .update(`${EPHEMERAL_PROVIDER_TRANSCRIPT_DOMAIN}${canonical}`, 'utf8')
    .digest('hex')}`;
}
