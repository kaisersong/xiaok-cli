import * as readline from 'readline';
/** 流式输出文本（直接写 stdout，无换行缓冲） */
export declare function writeChunk(text: string): void;
/** 输出一行（带换行） */
export declare function writeLine(text: string): void;
/** 输出错误行 */
export declare function writeError(text: string): void;
/** 检测 stdin 是否为 TTY */
export declare function isTTY(): boolean;
/**
 * 向用户询问确认。
 * 返回 true（确认）或 false（拒绝）。
 * 若用户输入 "y!"，返回 true 并设置 autoMode 回调。
 *
 * @param rl 可选的已有 readline.Interface（避免嵌套创建导致 stdin 冲突）
 */
export declare function confirm(toolName: string, input: Record<string, unknown>, onAutoMode?: () => void, rl?: readline.Interface): Promise<boolean>;
