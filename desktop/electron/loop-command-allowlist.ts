import { spawn } from 'node:child_process';

import type { LoopSuccessCriterion } from './loop-contract.js';
import type { LoopCriterionVerification } from './loop-evaluator.js';

export type LoopCommandCwdPolicy = 'workspace' | 'output_dir';

export interface LoopCommandDefinition {
  commandId: string;
  command: string | { default: string; win32?: string; darwin?: string; linux?: string };
  args: string[];
  cwdPolicy: LoopCommandCwdPolicy | LoopCommandCwdPolicy[];
  dynamicArgs?: {
    maxCount: number;
    pattern: string;
  };
}

export interface ResolveLoopCommandInput {
  commandId: string;
  args: string[];
  cwdPolicy: LoopCommandCwdPolicy;
  workspaceRoot: string;
  outputDirectory?: string;
}

export interface LoopCommandInvocation {
  command: string;
  args: string[];
  cwd: string;
  shell: boolean;
}

export type ResolveLoopCommandResult =
  | { ok: true; invocation: LoopCommandInvocation }
  | {
      ok: false;
      reason:
        | 'command_not_allowlisted'
        | 'cwd_policy_not_allowed'
        | 'cwd_required'
        | 'unexpected_command_args'
        | 'unsafe_command_arg';
      message: string;
    };

export interface LoopCommandAllowlist {
  resolve(input: ResolveLoopCommandInput): ResolveLoopCommandResult;
}

export interface RunAllowedLoopCommandCriterionInput {
  allowlist: LoopCommandAllowlist;
  criterion: Extract<LoopSuccessCriterion, { kind: 'command_exit_zero' }>;
  workspaceRoot: string;
  outputDirectory?: string;
  timeoutMs?: number;
  streamCapBytes?: number;
}

const UNSAFE_ARG_PATTERN = /[\0\r\n;&|<>`$"'\\]/;
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_STREAM_CAP_BYTES = 1024 * 1024;

export function createLoopCommandAllowlist(definitions: LoopCommandDefinition[]): LoopCommandAllowlist {
  const byId = new Map<string, LoopCommandDefinition>();
  for (const definition of definitions) {
    if (!definition.commandId.trim()) throw new Error('Loop command commandId is required.');
    if (byId.has(definition.commandId)) throw new Error(`Duplicate loop commandId: ${definition.commandId}`);
    byId.set(definition.commandId, definition);
  }

  return {
    resolve(input: ResolveLoopCommandInput): ResolveLoopCommandResult {
      const definition = byId.get(input.commandId);
      if (!definition) {
        return {
          ok: false,
          reason: 'command_not_allowlisted',
          message: `Loop command is not allowlisted: ${input.commandId}`,
        };
      }

      if (!allowedCwdPolicies(definition).includes(input.cwdPolicy)) {
        return {
          ok: false,
          reason: 'cwd_policy_not_allowed',
          message: `Loop command ${input.commandId} does not allow cwd policy ${input.cwdPolicy}.`,
        };
      }

      const cwd = resolveCwd(input);
      if (!cwd) {
        return {
          ok: false,
          reason: 'cwd_required',
          message: `Loop command ${input.commandId} requires cwd policy ${input.cwdPolicy}.`,
        };
      }

      const dynamicArgs = input.args ?? [];
      const maxCount = definition.dynamicArgs?.maxCount ?? 0;
      if (dynamicArgs.length > maxCount) {
        return {
          ok: false,
          reason: 'unexpected_command_args',
          message: `Loop command ${input.commandId} accepts at most ${maxCount} dynamic args.`,
        };
      }

      const dynamicPattern = definition.dynamicArgs ? new RegExp(definition.dynamicArgs.pattern) : undefined;
      for (let index = 0; index < dynamicArgs.length; index += 1) {
        const arg = dynamicArgs[index] ?? '';
        if (UNSAFE_ARG_PATTERN.test(arg) || (dynamicPattern && !dynamicPattern.test(arg))) {
          return {
            ok: false,
            reason: 'unsafe_command_arg',
            message: `Loop command ${input.commandId} rejected unsafe arg at index ${index}.`,
          };
        }
      }

      return {
        ok: true,
        invocation: {
          command: resolveCommand(definition.command),
          args: [...definition.args, ...dynamicArgs],
          cwd,
          shell: process.platform === 'win32',
        },
      };
    },
  };
}

export async function runAllowedLoopCommandCriterion(
  input: RunAllowedLoopCommandCriterionInput
): Promise<LoopCriterionVerification> {
  const resolved = input.allowlist.resolve({
    commandId: input.criterion.commandId,
    args: input.criterion.args,
    cwdPolicy: input.criterion.cwdPolicy,
    workspaceRoot: input.workspaceRoot,
    outputDirectory: input.outputDirectory,
  });
  if (!resolved.ok) {
    return {
      status: 'blocked',
      evidenceIds: [],
      nextActionKind: resolved.reason,
      nextActionSummary: resolved.message,
    };
  }

  return new Promise((resolvePromise) => {
    let settled = false;
    let capturedBytes = 0;
    const child = spawn(resolved.invocation.command, resolved.invocation.args, {
      cwd: resolved.invocation.cwd,
      shell: resolved.invocation.shell,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const finish = (result: LoopCriterionVerification) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise(result);
    };
    const onData = (chunk: Buffer) => {
      capturedBytes += chunk.length;
      if (capturedBytes > (input.streamCapBytes ?? DEFAULT_STREAM_CAP_BYTES)) {
        child.kill('SIGKILL');
        finish({
          status: 'blocked',
          evidenceIds: [],
          nextActionKind: 'command_output_exceeded',
          nextActionSummary: `Loop command ${input.criterion.commandId} output exceeded ${input.streamCapBytes ?? DEFAULT_STREAM_CAP_BYTES} bytes.`,
        });
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('error', error => finish({
      status: 'blocked',
      evidenceIds: [],
      nextActionKind: 'command_failed_to_start',
      nextActionSummary: `Loop command ${input.criterion.commandId} failed to start: ${error.message}`,
    }));
    child.on('exit', (code, signal) => {
      if (signal) {
        finish({
          status: 'blocked',
          evidenceIds: [],
          nextActionKind: 'command_terminated_by_signal',
          nextActionSummary: `Loop command ${input.criterion.commandId} terminated by signal ${signal}.`,
        });
        return;
      }
      if (Number(code) !== 0) {
        finish({
          status: 'failed',
          evidenceIds: [],
          failureKind: 'validation_failed',
          message: `Loop command ${input.criterion.commandId} exited with code ${Number(code)}.`,
        });
        return;
      }
      finish({
        status: 'passed',
        evidenceIds: [],
        summary: `Loop command ${input.criterion.commandId} exited with code 0.`,
      });
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish({
        status: 'blocked',
        evidenceIds: [],
        nextActionKind: 'command_timeout',
        nextActionSummary: `Loop command ${input.criterion.commandId} timed out after ${input.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms.`,
      });
    }, input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    timer.unref?.();
  });
}

function allowedCwdPolicies(definition: LoopCommandDefinition): LoopCommandCwdPolicy[] {
  return Array.isArray(definition.cwdPolicy) ? definition.cwdPolicy : [definition.cwdPolicy];
}

function resolveCwd(input: ResolveLoopCommandInput): string | undefined {
  if (input.cwdPolicy === 'workspace') return input.workspaceRoot || undefined;
  return input.outputDirectory || undefined;
}

function resolveCommand(command: LoopCommandDefinition['command']): string {
  if (typeof command === 'string') return command;
  if (process.platform === 'win32' && command.win32) return command.win32;
  if (process.platform === 'darwin' && command.darwin) return command.darwin;
  if (process.platform === 'linux' && command.linux) return command.linux;
  return command.default;
}
