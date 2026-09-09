import { type Config, type ModelAdapter } from '../types.js';
export declare const ROOM_DISCUSSION_PROTOCOL: {
    readonly protocol: "room_discussion_v1";
    readonly runtime: "xiaok";
    readonly freshSession: true;
    readonly toolsDisabled: true;
    readonly mcpDisabled: true;
    readonly hooksDisabled: true;
};
/** Deliberately not chat: no session, memory, hooks, MCP or tool executor imports. */
export declare function runRoomDiscussion(input: {
    prompt: string;
    config: Config;
    signal?: AbortSignal;
    createAdapter?: (config: Config) => ModelAdapter;
}): Promise<string>;
export declare function runRoomDiscussionCli(args: string[]): Promise<void>;
