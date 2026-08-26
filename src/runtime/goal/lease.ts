import {
  closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

interface LeaseDocument {
  sessionId: string;
  instanceId: string;
  pid: number;
  acquiredAt: number;
  heartbeatAt: number;
}

export class GoalSessionLease {
  private acquired = false;
  private readonly now: () => number;
  private readonly pid: number;
  private readonly leaseTimeoutMs: number;
  private readonly isAlive: (pid: number) => boolean;
  private readonly path: string;

  constructor(private readonly options: {
    rootDir: string;
    sessionId: string;
    instanceId: string;
    pid?: number;
    now?: () => number;
    leaseTimeoutMs?: number;
    isProcessAlive?: (pid: number) => boolean;
  }) {
    this.now = options.now ?? Date.now;
    this.pid = options.pid ?? process.pid;
    this.leaseTimeoutMs = options.leaseTimeoutMs ?? 30_000;
    this.isAlive = options.isProcessAlive ?? isProcessAlive;
    this.path = join(options.rootDir, `${options.sessionId}.goal.lock`);
  }

  acquire(input: { recoverExpired?: boolean } = {}): void {
    mkdirSync(this.options.rootDir, { recursive: true });
    try {
      this.create();
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const existing = this.read();
    const expired = this.now() - existing.heartbeatAt > this.leaseTimeoutMs;
    const dead = !this.isAlive(existing.pid);
    if (!input.recoverExpired || !expired || !dead) {
      throw new Error(`Goal lease is held by ${existing.instanceId}`);
    }
    unlinkSync(this.path);
    this.create();
  }

  heartbeat(): void {
    this.assertOwned();
    const current = this.read();
    writeFileSync(this.path, JSON.stringify({ ...current, heartbeatAt: this.now() }), 'utf8');
  }

  assertOwned(): void {
    if (!this.acquired || !existsSync(this.path)) throw new Error('Goal lease is not held');
    const current = this.read();
    if (current.instanceId !== this.options.instanceId) throw new Error('Goal lease owner mismatch');
  }

  release(): void {
    if (!this.acquired) return;
    try {
      this.assertOwned();
      unlinkSync(this.path);
    } finally {
      this.acquired = false;
    }
  }

  private create(): void {
    const now = this.now();
    const descriptor = openSync(this.path, 'wx', 0o600);
    try {
      const document: LeaseDocument = {
        sessionId: this.options.sessionId,
        instanceId: this.options.instanceId,
        pid: this.pid,
        acquiredAt: now,
        heartbeatAt: now,
      };
      writeFileSync(descriptor, JSON.stringify(document), 'utf8');
    } finally {
      closeSync(descriptor);
    }
    this.acquired = true;
  }

  private read(): LeaseDocument {
    return JSON.parse(readFileSync(this.path, 'utf8')) as LeaseDocument;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
