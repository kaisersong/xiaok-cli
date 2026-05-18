/**
 * KSwarmContext — provides kswarm client state and actions to the component tree.
 *
 * Also manages the kswarm service lifecycle status via IPC.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useKSwarmClient, type KSwarmClientState, type KSwarmClientActions } from '../hooks/useKSwarmClient';
import type { KSwarmServiceStatus } from '../../../electron/preload-api';

interface KSwarmContextValue extends KSwarmClientState, KSwarmClientActions {
  serviceStatus: KSwarmServiceStatus | null;
}

const KSwarmContext = createContext<KSwarmContextValue | null>(null);

export function KSwarmProvider({ children }: { children: ReactNode }) {
  const client = useKSwarmClient();
  const [serviceStatus, setServiceStatus] = useState<KSwarmServiceStatus | null>(null);

  useEffect(() => {
    const api = (window as unknown as { xiaokDesktop: { kswarmGetStatus(): Promise<KSwarmServiceStatus>; onKSwarmStatus(cb: (s: KSwarmServiceStatus) => void): () => void } }).xiaokDesktop;
    if (!api) return;

    // Get initial status
    api.kswarmGetStatus().then(setServiceStatus).catch(() => {});

    // Subscribe to status changes
    const unsub = api.onKSwarmStatus((status) => {
      setServiceStatus(status);
    });

    return unsub;
  }, []);

  return (
    <KSwarmContext.Provider value={{ ...client, serviceStatus }}>
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
