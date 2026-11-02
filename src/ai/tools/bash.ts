import { measureCollector, observationMetricsEnabled } from '../../runtime/trace/observation-metrics.js';
import { spawn, type ChildProcess } from 'child_process';
import type { Tool, ToolExecutionContext } from '../../types.js';
import { BASH_TIMEOUT_MAX, BASH_OUTPUT_MIN, BASH_OUTPUT_MAX, validateBashLimits } from './bash-limits.js';
import { BoundedShellOutput, WindowsElevationDetector, renderShellOutput } from './bash-output.js';
import { classifyBashCommand } from './bash-safety.js';
import { drainExitedWindowsShell, INHERITED_SHELL_OUTPUT_NOTICE } from '../../utils/shell-output-drain.js';
import { beginToolObservation } from '../../runtime/sol-pi/collector-port.js';

const DEFAULT_TIMEOUT_MS = 30_000;
function terminateChildProcessTree(child: ChildProcess): void {
  if (process.platform === 'win32' && child.pid) {
    try {
      const killer = spawn('taskkill', ['/F', '/T', '/PID', String(child.pid)], {
        stdio: 'ignore', windowsHide: true, detached: true,
      });
      killer.on('error', () => { child.kill('SIGKILL'); });
      killer.unref();
      return;
    } catch {
      child.kill('SIGKILL');
      return;
    }
  }
  const kill = (signal: NodeJS.Signals) => {
    try {
      if (child.pid) process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') child.kill(signal);
    }
  };
  kill('SIGKILL');
}


export type BashToolExecutionContext = Pick<
  ToolExecutionContext,
  'signal' | 'assertPermissionApproval' | 'compoundPhase' | 'toolInvocationId' | 'runtimeFactSink' | 'observationCollector' | 'executionProgress'
> | ToolExecutionContext;

export type BashTool = Omit<Tool, 'execute'> & {
  execute(input: Record<string, unknown>, context?: BashToolExecutionContext): Promise<string>;
};

export interface BashApprovalOptions {
  /** Live host mode callback; never model input. */
  isYolo?: () => boolean;
}

export function createBashTool(options: BashApprovalOptions = {}): BashTool {
  return {
  permission: 'bash',
  definition: {
    name: 'bash',
    description: (() => {
      const shell = process.platform === 'win32'
        ? '当前执行环境是 Windows cmd /c，命令须使用 cmd 语法。POSIX 单引号、heredoc 和 PowerShell cmdlet 不能直接使用；需要其他解释器时须显式调用并确认已安装。'
        : '当前执行环境是 sh -c，命令须使用 POSIX sh 语法。';
      return `执行 shell 命令，返回 stdout + stderr。${shell}文件内容搜索优先使用 grep 工具，定位文件使用 glob，读取文件使用 read。慎用：所有 shell 命令均视为潜在危险操作。sudo 在主 CLI 的本地交互终端执行；密码只能由用户在终端输入，严禁通过聊天或工具参数索取、传递密码。`;
    })(),
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '要执行的 shell 命令' },
        timeout_ms: { type: 'integer', minimum: 1, maximum: BASH_TIMEOUT_MAX, description: `超时毫秒数（默认 ${DEFAULT_TIMEOUT_MS}）` },
        workdir: { type: 'string', description: '命令执行目录（可选，默认当前目录）' },
        max_chars: { type: 'integer', minimum: BASH_OUTPUT_MIN, maximum: BASH_OUTPUT_MAX, description: '输出字符上限（默认 12000）' },
      },
      required: ['command'],
    },
  },
  async execute(input, context) {
    context?.signal?.throwIfAborted();
    const { command, timeout_ms = DEFAULT_TIMEOUT_MS, workdir = process.cwd(), max_chars = 12_000 } = input as {
      command: string;
      timeout_ms?: number;
      workdir?: string;
      max_chars?: number;
    };

    const invalidLimits = validateBashLimits(timeout_ms, max_chars);
    if (invalidLimits) return invalidLimits;

    const risk = classifyBashCommand(command);
    if (risk.level === 'block') {
      await context?.compoundPhase?.rejected?.({ toolName: 'bash', reason: 'risk_policy' });
      return `Error: 命令被安全策略拦截: ${risk.reason}`;
    }

    if (/\bsudo\b/.test(command)) { await context?.compoundPhase?.rejected?.({ toolName: 'bash', reason: 'interactive_sudo' }); return 'Error: sudo 需要主 CLI 的本地交互终端；请交由主会话执行，或在 xiaok 交互输入框使用 !sudo 命令；在系统终端直接执行 sudo 命令（不加 !）。'; }

    await context?.compoundPhase?.beforeCommandStart?.({ command, workdir });
    context?.signal?.throwIfAborted(); context?.assertPermissionApproval?.();

    if (context?.compoundPhase) {
      if (!context.compoundPhase.executeIsolatedCommand) throw Error('compound_isolated_execution_required');
      return context.compoundPhase.executeIsolatedCommand(Object.freeze({command,workdir,timeoutMs:timeout_ms,maxChars:max_chars}),()=>{context.signal?.throwIfAborted();context.assertPermissionApproval?.();});
    }
    return new Promise((resolve, reject) => {
      const shell = process.platform === 'win32' ? 'cmd' : 'sh';
      // cmd consumes shell text, not CRT-escaped argv. /s strips only our outer quotes.
      const shellArgs = process.platform === 'win32' ? ['/d', '/s', '/c', `"${command}"`] : ['-c', command];
      const child = spawn(shell, shellArgs, {
        cwd: workdir, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32',
        windowsVerbatimArguments: process.platform === 'win32',
        // Piped stdio alone still lets PowerShell mutate the parent console.
        windowsHide: true,
      });
      const observation = beginToolObservation(context?.observationCollector, {
        toolName: 'bash', source: { command, workdir },
      });
      const stdout = new BoundedShellOutput(Math.min(max_chars, 65536));
      const stderr = new BoundedShellOutput(Math.min(max_chars, 65536));
      const elevation = {stdout:new WindowsElevationDetector(),stderr:new WindowsElevationDetector()};
      const output = (status: string, notice = '') => {
        const header = [status, notice].filter(Boolean).join('\n');
        return `${header}${header ? '\n' : ''}${renderShellOutput(stdout, stderr, max_chars - header.length - 1)}`;
      };

      const collectMetrics = observationMetricsEnabled();
      const collectionStarted = collectMetrics ? performance.now() : 0;
      let collectedBytes = 0; let collectedChunks = 0;
      let settled = false;
      let aborted = false;
      let terminationResult: string | undefined;
      let normalExitObserved = false;
      let stopOutputDrain = () => {};
      let terminationKind: 'timeout' | 'error' | undefined;
      const onAbort = () => {
        if (settled || aborted) return;
        aborted = true;
        if (normalExitObserved) {
          child.stdout?.destroy(); child.stderr?.destroy();
          finish('', null, true, true); return;
        }
        terminateChildProcessTree(child);
      };
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (result: string, exitCode?: number | null, terminalExited = false, inheritedOutput = false) => {
        if (settled) {
          return;
        }
        settled = true;
        stopOutputDrain();
        observation.append(stdout.end());
        observation.append(stderr.end());
        observation.finalize({ executionState: terminalExited ? 'terminal' : 'termination_pending',
          ...(terminalExited ? { outcome: aborted ? 'cancelled' : terminationKind ?? (exitCode === 0 ? 'success' : 'error') } : {}),
          ...(aborted ? { incompleteReason: 'cancelled' } : terminationKind ? { incompleteReason: terminationKind === 'timeout' ? 'timeout' : 'terminated_for_elevation' }
            : !terminalExited ? { incompleteReason: 'termination_unconfirmed' }
              : inheritedOutput ? { incompleteReason: 'interrupted' } : {}),
        });
        if (collectMetrics) measureCollector({ invocationId: context?.toolInvocationId, bytes: collectedBytes, chunks: collectedChunks,
          durationMs: performance.now() - collectionStarted, terminalExited, interrupted: aborted || terminationResult !== undefined });
        context?.signal?.removeEventListener('abort', onAbort);
        if (timer) {
          clearTimeout(timer);
        }
        const complete = () => {
        if (aborted) {
          reject(context?.signal?.reason ?? new DOMException('Aborted', 'AbortError'));
          return;
        }
        if (context?.toolInvocationId) {
          context.runtimeFactSink?.emit({
            invocationId: context.toolInvocationId,
            toolName: 'bash',
            factKind: 'command_result',
            exitCode,
          });
        }
        resolve(result);
        };
        if (context?.compoundPhase?.commandFinished) {
          void Promise.resolve().then(() => context.compoundPhase!.commandFinished!({ exitCode: exitCode ?? null, terminalExited,
            outcome: aborted ? 'cancelled' : terminationKind === 'timeout' ? 'timeout' : exitCode === 0 ? 'success' : 'error', pid: child.pid ?? null,
          })).then(complete, reject);
        } else complete();
      };

      const handleOutput = (stream: 'stdout' | 'stderr', data: Buffer) => {
        const chunk = !settled ? (stream === 'stdout' ? stdout : stderr).write(data) : '';
        if (!settled) observation.append(chunk);
        if (collectMetrics) { collectedBytes += data.byteLength; collectedChunks++; }
        context?.executionProgress?.progress();
        if (aborted || settled || terminationResult) return;
        if (process.platform === 'win32' && elevation[stream].write(chunk)) {
          terminationKind = 'error';
          terminationResult = output('Error: 命令需要管理员权限，已停止等待。请在管理员 PowerShell 中手动运行该命令。');
          if (!normalExitObserved) terminateChildProcessTree(child);
        }
      };

      child.stdout?.on('data', (d: Buffer) => handleOutput('stdout', d));
      child.stderr?.on('data', (d: Buffer) => handleOutput('stderr', d));

      timer = setTimeout(() => {
        if (aborted || terminationResult) return;
        terminationKind = 'timeout';
        terminationResult = output(`Error: 命令超时（>${timeout_ms}ms）`);
        terminateChildProcessTree(child);
      }, timeout_ms);

      const complete = (code: number | null, inheritedOutput = false) => {
        if (terminationResult) { finish(terminationResult, null, true, inheritedOutput); return; }
        if (settled) {
          return;
        }
        observation.append(stdout.end());observation.append(stderr.end());
        const notice = inheritedOutput ? INHERITED_SHELL_OUTPUT_NOTICE : '';
        if (code !== 0) {
          finish(output(`Error (exit ${code}):`, notice), code, true, inheritedOutput);
        } else {
          finish(output('', notice), 0, true, inheritedOutput);
        }
      };
      stopOutputDrain = drainExitedWindowsShell(child, {
        onExit: () => {
          normalExitObserved = !aborted && !terminationResult;
          if (normalExitObserved && timer) clearTimeout(timer);
        },
        canDrain: () => normalExitObserved && !aborted,
        onDrained: code => complete(code, true),
      });
      child.on('close', code => complete(code));

      child.on('error', (error) => {
        if (aborted || terminationResult) {
          // A failed kill is not evidence that the process exited.
          console.warn(`BASH_TERMINATION_PENDING: ${String(error)}`);
          return;
        }
        finish(`Error: ${String(error)}`, null);
      });
      context?.signal?.addEventListener('abort', onAbort, { once: true });
      if (context?.signal?.aborted) onAbort();
    });
  },
  };
}

export const bashTool: BashTool = createBashTool();

/** Installed only by the interactive CLI host, before sandbox wrapping. */
export function createInteractiveBashTool(run: Tool['execute'], options: BashApprovalOptions = {}): Tool {
  const tool = createBashTool(options);
  return { ...tool, async execute(input, context) {
    context?.signal?.throwIfAborted();
    const invalidLimits = validateBashLimits(input.timeout_ms === undefined ? DEFAULT_TIMEOUT_MS : input.timeout_ms, input.max_chars === undefined ? 12_000 : input.max_chars);
    if (invalidLimits) return invalidLimits;
    const command = String(input.command ?? '');
    if (!/\bsudo\b/.test(command)) return tool.execute(input, context);
    const risk = classifyBashCommand(command);
    if (risk.level === 'block') return `Error: 命令被安全策略拦截: ${risk.reason}`;
    return run(input, context);
  } };
}
