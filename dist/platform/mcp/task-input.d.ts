import type { ApplicationInputHandler } from '@modelcontextprotocol/ext-tasks/client';
/** Task updates belong to the explicit user input API. An observation driver
 * must never use the SDK's implicit elicitation cancel fallback. Aborting this
 * local wait makes the official driver skip submission; it does not cancel
 * the task or answer its pending request. */
export declare const deferMcpTaskInput: ApplicationInputHandler['handle'];
