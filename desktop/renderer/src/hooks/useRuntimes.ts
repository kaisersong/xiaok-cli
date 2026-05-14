/**
 * useRuntimes — React Query hook for fetching runtime list.
 * Replace manual fetch + localStorage pattern with cached queries.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';

export const runtimeKeys = {
  all: () => ['runtimes'] as const,
  list: () => [...runtimeKeys.all(), 'list'] as const,
  liveness: () => [...runtimeKeys.all(), 'liveness'] as const,
};

export function useRuntimes() {
  return useQuery({
    queryKey: runtimeKeys.list(),
    queryFn: async () => {
      const res = await fetch('http://127.0.0.1:4400/runtimes');
      if (!res.ok) throw new Error(`Failed to fetch runtimes: ${res.status}`);
      const data = await res.json();
      return data.runtimes || [];
    },
    staleTime: 60_000,  // 1 minute
    refetchInterval: 30_000,  // Auto-refresh every 30s
    retry: 2,
  });
}

export function useAgentLiveness() {
  return useQuery({
    queryKey: runtimeKeys.liveness(),
    queryFn: async () => {
      const res = await fetch('http://127.0.0.1:4400/agents/liveness');
      if (!res.ok) throw new Error(`Failed to fetch liveness: ${res.status}`);
      const data = await res.json();
      return data.liveness || {};
    },
    staleTime: 15_000,  // 15 seconds
    refetchInterval: 10_000,  // Auto-refresh every 10s
    retry: 1,
  });
}

export function useInvalidateRuntimes() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: runtimeKeys.all() });
  };
}
