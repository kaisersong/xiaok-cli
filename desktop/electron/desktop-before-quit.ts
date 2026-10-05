import type { DesktopShutdownCoordinator } from './desktop-shutdown-coordinator.js';
import type { UpdaterHandoffStateMachine } from './updater-handoff.js';

export function registerDesktopBeforeQuit(
  host: { on(event: 'before-quit', listener: (event: { preventDefault(): void }) => void): unknown },
  coordinator: DesktopShutdownCoordinator,
  handoff: UpdaterHandoffStateMachine,
  completeUpdaterHandoff: () => void,
  reportUpdaterFailure: (error: unknown) => void = error => console.error('[main] updater quit hook failed:', error),
): void {
  let began = false;
  host.on('before-quit', event => {
    const first = !began;
    began = true;
    const { preventDefault } = coordinator.onBeforeQuit();
    if (preventDefault) event.preventDefault();
    if (first) {
      for (const hook of [() => handoff.commitHandoffOnBeforeQuit(), completeUpdaterHandoff]) {
        try { hook(); }
        catch (error) {
          // A diagnostic callback must not undo synchronous shutdown ownership.
          try { reportUpdaterFailure(error); } catch { /* keep draining */ }
        }
      }
    }
  });
}

export async function disposeDesktopLifetimeSteps(
  steps: Array<{ name: string; run: () => Promise<void> }>,
  reportFailure: (name: string, error: unknown) => void,
): Promise<void> {
  const failures: Error[] = [];
  for (const step of steps.splice(0)) {
    try { await step.run(); }
    catch (error) {
      failures.push(new Error(`${step.name}: ${error instanceof Error ? error.message : String(error)}`, { cause: error }));
      try { reportFailure(step.name, error); } catch { /* independent cleanup still runs */ }
    }
  }
  if (failures.length) throw new AggregateError(failures, failures.map(error => error.message).join('; '));
}
