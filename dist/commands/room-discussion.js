import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { DEFAULT_CONFIG } from '../types.js';
import { getConfigPath } from '../utils/config.js';
import { normalizeConfig } from '../ai/providers/normalize.js';
import { resolveRuntimeModelBinding } from '../ai/providers/control-plane.js';
import { createAdapterFromBinding } from '../ai/models.js';
import { streamStatelessSideCallProviderConversation } from '../ai/runtime/provider-conversation-authorization.js';
export const ROOM_DISCUSSION_PROTOCOL = {
    protocol: 'room_discussion_v1', runtime: 'xiaok', freshSession: true,
    toolsDisabled: true, mcpDisabled: true, hooksDisabled: true,
};
/** Deliberately not chat: no session, memory, hooks, MCP or tool executor imports. */
export async function runRoomDiscussion(input) {
    if (typeof input.prompt !== 'string' || !input.prompt.trim())
        throw new Error('room_discussion_input_invalid');
    input.signal?.throwIfAborted();
    const adapter = (input.createAdapter ?? (config => createAdapterFromBinding(resolveRuntimeModelBinding(config))))(input.config);
    const controller = new AbortController();
    const forwardAbort = () => controller.abort(input.signal?.reason);
    input.signal?.addEventListener('abort', forwardAbort, { once: true });
    try {
        let text = '';
        for await (const chunk of streamStatelessSideCallProviderConversation({
            adapter, messages: [{ role: 'user', content: [{ type: 'text', text: input.prompt }] }], tools: [],
            systemPrompt: 'You are participating in a scoped discussion. Respond only to the supplied discussion text. No tools, filesystem, prior sessions, or external context are available.',
            options: { signal: controller.signal }, invocationId: `room-discussion-${randomUUID()}`,
        })) {
            controller.signal.throwIfAborted();
            if (chunk.type === 'tool_use')
                throw new Error('room_discussion_tool_denied');
            if (chunk.type === 'done')
                break;
            if (chunk.type === 'text')
                text += chunk.delta;
        }
        controller.signal.throwIfAborted();
        return text;
    }
    catch (error) {
        controller.abort(error);
        throw error;
    }
    finally {
        input.signal?.removeEventListener('abort', forwardAbort);
    }
}
export async function runRoomDiscussionCli(args) {
    if (args.length === 1 && args[0] === '--probe') {
        process.stdout.write(JSON.stringify(ROOM_DISCUSSION_PROTOCOL) + '\n');
        return;
    }
    if (args.length)
        throw new Error('room_discussion_arguments_invalid');
    let raw = '';
    for await (const chunk of process.stdin) {
        raw += chunk;
        if (Buffer.byteLength(raw) > 1024 * 1024)
            throw new Error('room_discussion_input_too_large');
    }
    const request = JSON.parse(raw);
    if (typeof request.prompt !== 'string')
        throw new Error('room_discussion_input_invalid');
    // Read-only config loading: malformed config must not trigger normal CLI
    // migration/backup writes, and no session or local project config is loaded.
    let config;
    try {
        config = normalizeConfig(JSON.parse(await readFile(getConfigPath(), 'utf8')));
    }
    catch (error) {
        if (error.code !== 'ENOENT')
            throw error;
        config = DEFAULT_CONFIG;
    }
    const controller = new AbortController();
    const abort = () => controller.abort(new Error('room_discussion_cancelled'));
    process.once('SIGTERM', abort);
    process.once('SIGINT', abort);
    try {
        process.stdout.write(JSON.stringify({ protocol: 'room_discussion_v1', text: await runRoomDiscussion({ prompt: request.prompt, config, signal: controller.signal }) }) + '\n');
    }
    finally {
        process.removeListener('SIGTERM', abort);
        process.removeListener('SIGINT', abort);
    }
}
