import type { ChildProcess } from 'node:child_process';

export const INHERITED_SHELL_OUTPUT_NOTICE = '（命令进程已退出；后代仍持有输出管道，已停止等待输出。应用或网页是否打开需另行观察。）';

/** A GUI descendant may keep pipes open long after cmd.exe has exited. */
export function drainExitedWindowsShell(child: ChildProcess, options: {
  platform?: NodeJS.Platform;
  onExit?: () => void;
  canDrain?: () => boolean;
  onDrained(code: number | null, signal: NodeJS.Signals | null): void;
}): () => void {
  if ((options.platform ?? process.platform) !== 'win32') return () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => { if (timer) clearTimeout(timer); timer = undefined; };
  const exited = (code: number | null, signal: NodeJS.Signals | null) => {
    options.onExit?.();
    if (options.canDrain?.() === false) return;
    timer = setTimeout(() => {
      timer = undefined;
      if (options.canDrain?.() === false) return;
      child.stdout?.destroy(); child.stderr?.destroy();
      options.onDrained(code, signal);
    }, 200);
  };
  child.once('exit', exited); child.once('close', clear);
  return () => { clear(); child.off('exit', exited); child.off('close', clear); };
}
