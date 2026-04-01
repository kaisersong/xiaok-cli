import * as readline from 'readline';
/** 流式输出文本（直接写 stdout，无换行缓冲） */
export function writeChunk(text) {
    process.stdout.write(text);
}
/** 输出一行（带换行） */
export function writeLine(text) {
    console.log(text);
}
/** 输出错误行 */
export function writeError(text) {
    console.error(`\x1b[31mError:\x1b[0m ${formatErrorText(text)}`);
}
export function formatErrorText(text) {
    return text.replace(/^Error:\s*/u, '');
}
/** 检测 stdin 是否为 TTY */
export function isTTY() {
    return Boolean(process.stdin.isTTY);
}
/**
 * 向用户询问确认。
 * 返回 true（确认）或 false（拒绝）。
 * 若用户输入 "y!"，返回 true 并设置 autoMode 回调。
 *
 * @param rl 可选的已有 readline.Interface（避免嵌套创建导致 stdin 冲突）
 */
export async function confirm(toolName, input, onAutoMode, rl) {
    const inputSummary = JSON.stringify(input).slice(0, 120);
    process.stdout.write(`\n\x1b[33m[确认]\x1b[0m 执行 \x1b[36m${toolName}\x1b[0m: ${inputSummary}\n`);
    process.stdout.write('输入 y 确认，n 取消，y! 此后全部自动确认：');
    const handleAnswer = (line, resolve) => {
        const answer = line.trim().toLowerCase();
        if (answer === 'y!') {
            onAutoMode?.();
            resolve(true);
        }
        else {
            resolve(answer === 'y');
        }
    };
    if (rl) {
        // 复用调用方的 readline 实例，避免在同一个 stdin 上创建嵌套接口
        return new Promise(resolve => {
            rl.once('line', (line) => handleAnswer(line, resolve));
        });
    }
    // 无外部 rl 时（如非交互单次模式）创建临时接口
    return new Promise(resolve => {
        const tmpRl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
        tmpRl.once('line', (line) => {
            tmpRl.close();
            handleAnswer(line, resolve);
        });
    });
}
