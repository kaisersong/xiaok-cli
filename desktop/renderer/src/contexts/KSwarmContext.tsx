import { useKswarmStatusReadonly } from '../hooks/useKswarmStatusReadonly';
/**
 * KSwarmContext — provides kswarm client state and actions to the component tree.
 *
 * Also manages the kswarm service lifecycle status via IPC.
 */

import { createContext, useContext, type ReactNode } from 'react';
import { useKSwarmClient, type KSwarmClientState, type KSwarmClientActions } from '../hooks/useKSwarmClient';
import type { KSwarmServiceStatus } from '../../../electron/preload-api';

interface KSwarmContextValue extends KSwarmClientState, KSwarmClientActions {
  serviceStatus: KSwarmServiceStatus | null;
  serviceStatusReadFailed: boolean;
  serviceStatusReading: boolean;
  reloadServiceStatus(): void;
}

const KSwarmContext = createContext<KSwarmContextValue | null>(null);

export function KSwarmProvider({ children }: { children: ReactNode }) {
  const client = useKSwarmClient();
  const status = useKswarmStatusReadonly();

  return (
    <KSwarmContext.Provider value={{ ...client, serviceStatus: status.data, serviceStatusReadFailed: status.failed, serviceStatusReading: status.reading, reloadServiceStatus: status.refresh }}>
      {children}
    </KSwarmContext.Provider>
  );
}

export function useKSwarm(): KSwarmContextValue {
  const ctx = useContext(KSwarmContext);
  if (!ctx) {
    throw new Error('useKSwarm must be used within a KSwarmProvider');
  }
  return ctx;
}
