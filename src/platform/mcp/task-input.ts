import type { ApplicationInputHandler } from '@modelcontextprotocol/ext-tasks/client';

/** Task updates belong to the explicit user input API. An observation driver
 * must never use the SDK's implicit elicitation cancel fallback. Aborting this
 * local wait makes the official driver skip submission; it does not cancel
 * the task or answer its pending request. */
export const deferMcpTaskInput: ApplicationInputHandler['handle'] = (_request, context) => new Promise((_resolve, reject) => {
  const signal = context.signal;
  const aborted = () => reject(signal?.reason ?? new Error('mcp_task_observation_stopped'));
  if (signal?.aborted) aborted(); else signal?.addEventListener('abort', aborted, { once: true });
});
