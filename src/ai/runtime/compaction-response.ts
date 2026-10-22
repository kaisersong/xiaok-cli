import type { StreamChunk } from '../../types.js';

type Failure = 'provider_incomplete' | 'missing_terminal' | 'unexpected_tool' | 'content_after_terminal' | 'empty';

/** A bounded diagnostic; never includes provider payloads or private history. */
export class CompactionResponseError extends Error {
  readonly code = 'compaction_response_incomplete';
  readonly retryable = false;
  constructor(readonly reason: Failure) {
    super(`compaction_response_incomplete:${reason}`);
    this.name = 'CompactionResponseError';
  }
}

/** Drain the original stream before installing any summary, including late usage/errors. */
export async function collectCompactionResponse(
  stream: AsyncIterable<StreamChunk>,
  options: { signal?: AbortSignal; onProgress?: () => void; allowEmpty?: boolean } = {},
): Promise<string> {
  options.signal?.throwIfAborted();
  const text: string[] = [];
  let terminal = false, failure: Failure | undefined;
  try {
    for await (const chunk of stream) {
      if (chunk.type !== 'usage') options.signal?.throwIfAborted();
      options.onProgress?.();
      if (chunk.type === 'usage') continue;
      if (terminal) failure ??= 'content_after_terminal';
      if (chunk.type === 'done') terminal = true;
      else if (chunk.type === 'tool_use') failure ??= 'unexpected_tool';
      else if (chunk.type === 'text') text.push(chunk.delta);
    }
  } catch (error) {
    options.signal?.throwIfAborted();
    throw error;
  }
  options.signal?.throwIfAborted();
  if (failure) throw new CompactionResponseError(failure);
  if (!terminal) throw new CompactionResponseError('missing_terminal');
  const summary = text.join('').trim();
  if (!summary && !options.allowEmpty) throw new CompactionResponseError('empty');
  return summary;
}
