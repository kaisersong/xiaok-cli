import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Lightweight pidfile-based singleton lock for long-running processes.
 * Ensures only one instance of a service (e.g. yzj serve) runs at a time.
 */
export class PidLock {
  constructor(private readonly pidFile: string) {}

  /**
   * Try to acquire the lock. Returns true if acquired, false if another
   * live process holds it.
   */
  acquire(): { acquired: boolean; existingPid?: number } {
    if (existsSync(this.pidFile)) {
      const raw = readFileSync(this.pidFile, 'utf-8').trim();
      const existingPid = Number(raw);
      if (existingPid && this.isProcessAlive(existingPid)) {
        return { acquired: false, existingPid };
      }
      // Stale pidfile — process no longer alive
      unlinkSync(this.pidFile);
    }

    mkdirSync(dirname(this.pidFile), { recursive: true });
    writeFileSync(this.pidFile, String(process.pid), 'utf-8');

    // Release on exit only. Signals belong to the owning service (yzj serve), which shuts down
    // gracefully and then exits; exiting here on SIGINT/SIGTERM would skip that shutdown (#150).
    // A signal before the owner installs its handlers terminates by Node's default; the pidfile
    // left behind names a dead pid and the next acquire() removes it as stale.
    process.on('exit', () => this.release());

    return { acquired: true };
  }

  release(): void {
    try {
      if (existsSync(this.pidFile)) {
        const raw = readFileSync(this.pidFile, 'utf-8').trim();
        if (Number(raw) === process.pid) {
          unlinkSync(this.pidFile);
        }
      }
    } catch {
      // Best-effort cleanup
    }
  }

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
}
