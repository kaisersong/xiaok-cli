/**
 * useRuntimes — React Query hook for fetching runtime list.
 * All REST calls routed through main process IPC proxy.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';

function getApi(): any {
  return typeof window !== 'undefined' ? (window as any).xiaokDesktop : null;
}

export const runtimeKeys = {
  all: () => ['runtimes'] as const,
  list: () => [...runtimeKeys.all(), 'list'] as const,
  liveness: () => [...runtimeKeys.all(), 'liveness'] as const,
};

export function useRuntimes() {
  return useQuery({
    queryKey: runtimeKeys.list(),
    queryFn: async () => {
      const api = getApi();
      const data = await api?.kswarmProxyGet('/runtimes');
      if (!data) throw new Error('Failed to fetch runtimes');
      return data.runtimes || [];
    },
    staleTime: 60_000,
    refetchInterval: 30_000,
    retry: 2,
  });
}

export function useAgentLiveness() {
  return useQuery({
    queryKey: runtimeKeys.liveness(),
    queryFn: async () => {
      const api = getApi();
      const data = await api?.kswarmProxyGet('/agents/liveness');
      if (!data) throw new Error('Failed to fetch liveness');
      return data.liveness || {};
    },
    staleTime: 15_000,
    refetchInterval: 10_000,
    retry: 1,
  });
}

export function useInvalidateRuntimes() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: runtimeKeys.all() });
  };
}
