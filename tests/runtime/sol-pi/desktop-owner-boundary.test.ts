import { describe, expect, it, vi } from 'vitest';
import { runDesktopToolLoop } from '../../../desktop/electron/desktop-services.js';
import { DesktopManagedAgentSession } from '../../../desktop/electron/desktop-managed-agent-session.js';
import { withObservationExecutionOwner } from '../../../src/runtime/sol-pi/observation-execution-scope.js';

describe('Desktop observation owner not-ready boundaries', () => {
  it.each([{}, { metricsSurface: 'desktop-child' }, { roomExecution: {} }, { executionScope: {} }, { mailbox: {} }])('rejects host owner before any work for %j', async extra => {
    await expect(runDesktopToolLoop({ observationOwner: {}, ...extra } as unknown as Parameters<typeof runDesktopToolLoop>[0])).rejects.toThrow(/OBSERVATION_NOT_READY/);
  });
  it('managed child rejects explicit host owner', async () => {
    const session = new DesktopManagedAgentSession({ observationOwner: {}, forkContext: false } as unknown as ConstructorParameters<typeof DesktopManagedAgentSession>[0]);
    await expect(session.run('go')).rejects.toThrow(/CHILD_OBSERVATION_NOT_READY/);
  });
  it('cannot silently clear protected inherited owner at a legacy Desktop entry', async () => {
    const owner = { hasDependencies: () => true, ownsDisclosure: () => false, prepareProviderDisclosure: () => undefined };
    const stream = vi.fn();
    await expect(withObservationExecutionOwner(owner, () => runDesktopToolLoop({
      signal: new AbortController().signal, adapter: { stream },
    } as unknown as Parameters<typeof runDesktopToolLoop>[0]))).rejects.toThrow(/HANDOFF/);
    expect(stream).not.toHaveBeenCalled();
  });
});
