/**
 * useRuntimes — React Query hook for fetching runtime list.
 * All REST calls routed through main process IPC proxy.
 *
 * ⚠️ 不要在这些 query hooks 上添加 refetchInterval。
 * useKSwarmClient 已通过 WS 事件驱动刷新，双源会产生冲突。
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getDesktopApi } from '@xiaok/shared/desktop';

function getApi() {
  return getDesktopApi();
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
    retry: 1,
  });
}

export function useInvalidateRuntimes() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: runtimeKeys.all() });
  };
}
