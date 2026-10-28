import type { DesktopShutdownGate } from './shutdown-aware-ipc-main.js';

/** UI readiness is independent of task recovery. The existing task/agent
 * admission gates still await recovery; shutdown owns the complete operation. */
export function startDesktopTaskRecovery(
  gate: DesktopShutdownGate,
  recover: () => Promise<void>,
  label = 'startup-task-recovery',
): Promise<void> | undefined {
  if (!gate.isOpen) return undefined;
  const writer = gate.acquire('bootstrap_queue', label);
  return (async () => {
    try { await recover(); }
    finally { writer.release(); }
  })();
}
