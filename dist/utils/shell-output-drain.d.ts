import type { ChildProcess } from 'node:child_process';
export declare const INHERITED_SHELL_OUTPUT_NOTICE = "\uFF08\u547D\u4EE4\u8FDB\u7A0B\u5DF2\u9000\u51FA\uFF1B\u540E\u4EE3\u4ECD\u6301\u6709\u8F93\u51FA\u7BA1\u9053\uFF0C\u5DF2\u505C\u6B62\u7B49\u5F85\u8F93\u51FA\u3002\u5E94\u7528\u6216\u7F51\u9875\u662F\u5426\u6253\u5F00\u9700\u53E6\u884C\u89C2\u5BDF\u3002\uFF09";
/** A GUI descendant may keep pipes open long after cmd.exe has exited. */
export declare function drainExitedWindowsShell(child: ChildProcess, options: {
    platform?: NodeJS.Platform;
    onExit?: () => void;
    canDrain?: () => boolean;
    onDrained(code: number | null, signal: NodeJS.Signals | null): void;
}): () => void;
