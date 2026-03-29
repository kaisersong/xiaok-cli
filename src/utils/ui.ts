import * as readline from 'readline';

/** 流式输出文本（直接写 stdout，无换行缓冲） */
export function writeChunk(text: string): void {
  process.stdout.write(text);
}

/** 输出一行（带换行） */
export function writeLine(text: string): void {
  console.log(text);
}

/** 输出错误行 */
export function writeError(text: string): void {
  console.error(`\x1b[31mError:\x1b[0m ${text}`);
}

/** 检测 stdin 是否为 TTY */
export function isTTY(): boolean {
  return Boolean(process.stdin.isTTY);
}

/**
 * 向用户询问确认。
 * 返回 true（确认）或 false（拒绝）。
 * 若用户输入 "y!"，返回 true 并设置 autoMode 回调。
 */
export async function confirm(
  toolName: string,
  input: Record<string, unknown>,
  onAutoMode?: () => void
): Promise<boolean> {
  const inputSummary = JSON.stringify(input).slice(0, 120);
  process.stdout.write(`\n\x1b[33m[确认]\x1b[0m 执行 \x1b[36m${toolName}\x1b[0m: ${inputSummary}\n`);
  process.stdout.write('输入 y 确认，n 取消，y! 此后全部自动确认：');

  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
    rl.once('line', (line: string) => {
      rl.close();
      const answer = line.trim().toLowerCase();
      if (answer === 'y!') {
        onAutoMode?.();
        resolve(true);
      } else {
        resolve(answer === 'y');
      }
    });
  });
}
