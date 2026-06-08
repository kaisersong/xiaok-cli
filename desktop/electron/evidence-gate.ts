import { spawn } from 'node:child_process';
import { existsSync, lstatSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

import type { EvidenceCheck } from './workflow-script-contract.js';

export interface EvidenceVerificationInput {
  runId: string;
  nodeId: string;
  result: unknown;
  workspaceRoot: string;
  checks: EvidenceCheck[];
  timeoutMs?: number;
  streamCapBytes?: number;
}

export interface EvidenceVerdict {
  ok: boolean;
  failures: string[];
  warnings: string[];
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_STREAM_CAP_BYTES = 1024 * 1024;

const TEST_COMMANDS: Record<string, { command: string; args: string[] }> = {
  'npm test': { command: process.platform === 'win32' ? 'npm.cmd' : 'npm', args: ['test'] },
  'npm run lint': { command: process.platform === 'win32' ? 'npm.cmd' : 'npm', args: ['run', 'lint'] },
  'python -m pytest': { command: process.platform === 'win32' ? 'python' : 'python', args: ['-m', 'pytest'] },
};

export async function verifyEvidenceChecks(input: EvidenceVerificationInput): Promise<EvidenceVerdict> {
  const failures: string[] = [];
  const warnings: string[] = [];
  const outputText = typeof input.result === 'string' ? input.result : JSON.stringify(input.result ?? null);

  for (const check of input.checks || []) {
    if (check.kind === 'output_schema') {
      verifyOutputSchema(input.result, check.requiredKeys, failures);
    } else if (check.kind === 'output_size') {
      if (outputText.length < check.minChars) {
        warnings.push(`output_size below minimum: ${outputText.length} < ${check.minChars}`);
      }
    } else if (check.kind === 'artifact_exists') {
      const artifact = verifyArtifactPath(input.workspaceRoot, check.path);
      if (!artifact.ok) failures.push(artifact.error);
    } else if (check.kind === 'test_command') {
      const command = await runAllowedTestCommand({
        workspaceRoot: input.workspaceRoot,
        command: check.command,
        expectExitCode: check.expectExitCode,
        timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        streamCapBytes: input.streamCapBytes ?? DEFAULT_STREAM_CAP_BYTES,
      });
      if (!command.ok) failures.push(command.error);
    }
  }

  return { ok: failures.length === 0, failures, warnings };
}

function verifyOutputSchema(result: unknown, requiredKeys: string[], failures: string[]): void {
  let parsed = result;
  if (typeof result === 'string') {
    try {
      parsed = JSON.parse(result);
    } catch {
      failures.push('output_schema result is not valid JSON');
      return;
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    failures.push('output_schema result is not an object');
    return;
  }
  const record = parsed as Record<string, unknown>;
  for (const key of requiredKeys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      failures.push(`output_schema missing key: ${key}`);
    }
  }
}

function verifyArtifactPath(workspaceRoot: string, artifactPath: string): { ok: true } | { ok: false; error: string } {
  if (!workspaceRoot || !artifactPath) return { ok: false, error: 'artifact_exists path required' };
  if (artifactPath.includes('\0') || isAbsolute(artifactPath)) {
    return { ok: false, error: 'artifact_exists path must be relative' };
  }
  const resolvedRoot = resolve(workspaceRoot);
  const resolvedArtifact = resolve(resolvedRoot, artifactPath);
  const rel = relative(resolvedRoot, resolvedArtifact);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    return { ok: false, error: 'artifact_exists path outside workspace' };
  }
  try {
    if (lstatSync(resolvedArtifact).isSymbolicLink()) {
      return { ok: false, error: 'artifact_exists symlink rejected' };
    }
  } catch {
    return { ok: false, error: `artifact_exists missing: ${artifactPath}` };
  }
  if (!existsSync(resolvedArtifact)) return { ok: false, error: `artifact_exists missing: ${artifactPath}` };
  return { ok: true };
}

async function runAllowedTestCommand({
  workspaceRoot,
  command,
  expectExitCode,
  timeoutMs,
  streamCapBytes,
}: {
  workspaceRoot: string;
  command: string;
  expectExitCode: number;
  timeoutMs: number;
  streamCapBytes: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const allowed = TEST_COMMANDS[command];
  if (!allowed) return { ok: false, error: `test_command not allowed: ${command}` };

  return new Promise((resolvePromise) => {
    let settled = false;
    let capturedBytes = 0;
    const child = spawn(allowed.command, allowed.args, {
      cwd: workspaceRoot,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const finish = (result: { ok: true } | { ok: false; error: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise(result);
    };
    const onData = (chunk: Buffer) => {
      capturedBytes += chunk.length;
      if (capturedBytes > streamCapBytes) {
        child.kill('SIGKILL');
        finish({ ok: false, error: `test_command output exceeded ${streamCapBytes} bytes` });
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('error', error => finish({ ok: false, error: `test_command failed to start: ${error.message}` }));
    child.on('exit', (code, signal) => {
      if (signal) {
        finish({ ok: false, error: `test_command terminated by signal: ${signal}` });
        return;
      }
      if (Number(code) !== expectExitCode) {
        finish({ ok: false, error: `test_command exit code ${code} !== ${expectExitCode}` });
        return;
      }
      finish({ ok: true });
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish({ ok: false, error: `test_command timed out after ${timeoutMs}ms` });
    }, timeoutMs);
    timer.unref?.();
  });
}
