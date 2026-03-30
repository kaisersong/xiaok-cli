import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface SessionBinding {
  sessionId: string;
  channel: 'yzj';
  chatId: string;
  userId?: string;
  cwd: string;
  repoRoot?: string;
  branch?: string;
  updatedAt: number;
}

interface BindInput {
  sessionId: string;
  chatId: string;
  userId?: string;
  cwd: string;
}

export class InMemorySessionBindingStore {
  private readonly bindings = new Map<string, SessionBinding>();

  async bind(input: BindInput): Promise<SessionBinding> {
    const cwd = resolve(input.cwd);
    if (!existsSync(cwd)) {
      throw new Error(`路径不存在: ${cwd}`);
    }
    if (!statSync(cwd).isDirectory()) {
      throw new Error(`路径不是目录: ${cwd}`);
    }

    const binding: SessionBinding = {
      sessionId: input.sessionId,
      channel: 'yzj',
      chatId: input.chatId,
      userId: input.userId,
      cwd,
      repoRoot: await getRepoRoot(cwd),
      branch: await getCurrentBranchSafe(cwd),
      updatedAt: Date.now(),
    };
    this.bindings.set(input.sessionId, binding);
    return binding;
  }

  get(sessionId: string): SessionBinding | undefined {
    return this.bindings.get(sessionId);
  }

  clear(sessionId: string): boolean {
    return this.bindings.delete(sessionId);
  }
}

async function getRepoRoot(cwd: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd });
    const repoRoot = stdout.trim();
    return repoRoot || undefined;
  } catch {
    return undefined;
  }
}

async function getCurrentBranchSafe(cwd: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
    const branch = stdout.trim();
    return branch || undefined;
  } catch {
    return undefined;
  }
}
