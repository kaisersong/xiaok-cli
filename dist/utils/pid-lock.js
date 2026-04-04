import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
/**
 * Lightweight pidfile-based singleton lock for long-running processes.
 * Ensures only one instance of a service (e.g. yzj serve) runs at a time.
 */
export class PidLock {
    pidFile;
    constructor(pidFile) {
        this.pidFile = pidFile;
    }
    /**
     * Try to acquire the lock. Returns true if acquired, false if another
     * live process holds it.
     */
    acquire() {
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
        // Clean up on exit
        const cleanup = () => this.release();
        process.on('exit', cleanup);
        process.on('SIGINT', () => { cleanup(); process.exit(130); });
        process.on('SIGTERM', () => { cleanup(); process.exit(143); });
        return { acquired: true };
    }
    release() {
        try {
            if (existsSync(this.pidFile)) {
                const raw = readFileSync(this.pidFile, 'utf-8').trim();
                if (Number(raw) === process.pid) {
                    unlinkSync(this.pidFile);
                }
            }
        }
        catch {
            // Best-effort cleanup
        }
    }
    isProcessAlive(pid) {
        try {
            process.kill(pid, 0);
            return true;
        }
        catch {
            return false;
        }
    }
}
