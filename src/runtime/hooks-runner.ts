import { exec } from 'child_process';

export interface ToolHookConfig {
  command: string;
  tools?: string[];
}

export interface HooksRunnerConfig {
  pre?: ToolHookConfig[];
  post?: ToolHookConfig[];
  timeoutMs?: number;
}

export interface HookRunResult {
  ok: boolean;
  message?: string;
}

export interface HooksRunner {
  runPreHooks(toolName: string, input: Record<string, unknown>): Promise<HookRunResult>;
  runPostHooks(toolName: string, input: Record<string, unknown>): Promise<string[]>;
}

function matchesTool(filter: string[] | undefined, toolName: string): boolean {
  if (!filter || filter.length === 0) return true;
  return filter.includes('*') || filter.includes(toolName);
}

function serializeHookContext(toolName: string, input: Record<string, unknown>): string {
  return JSON.stringify({ toolName, input });
}

async function runCommand(
  command: string,
  timeoutMs: number,
  toolName: string,
  input: Record<string, unknown>,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = exec(command, {
      env: {
        ...process.env,
        XIAOK_TOOL_NAME: toolName,
        XIAOK_TOOL_INPUT: serializeHookContext(toolName, input),
      },
    }, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`hook timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    if (typeof child.on === 'function') {
      child.on('exit', () => clearTimeout(timer));
      child.on('error', () => clearTimeout(timer));
    }
  });
}

export function createHooksRunner(config: HooksRunnerConfig = {}): HooksRunner {
  const timeoutMs = config.timeoutMs ?? 5000;

  return {
    async runPreHooks(toolName, input) {
      for (const hook of config.pre ?? []) {
        if (!matchesTool(hook.tools, toolName)) continue;

        try {
          await runCommand(hook.command, timeoutMs, toolName, input);
        } catch (error) {
          return { ok: false, message: String(error) };
        }
      }

      return { ok: true };
    },

    async runPostHooks(toolName, input) {
      const warnings: string[] = [];

      for (const hook of config.post ?? []) {
        if (!matchesTool(hook.tools, toolName)) continue;

        try {
          await runCommand(hook.command, timeoutMs, toolName, input);
        } catch (error) {
          warnings.push(String(error));
        }
      }

      return warnings;
    },
  };
}
