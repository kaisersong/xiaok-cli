/**
 * useKSwarmProjects — React Query hooks for kswarm projects and agents.
 * Replaces the manual fetch + WebSocket pattern with React Query caching.
 * All REST calls are routed through the main process IPC proxy.
 *
 * Usage:
 *   const { data: projects } = useProjects();
 *   const { data: agents } = useAgents();
 *   const { data: detail } = useProjectDetail(projectId);
 */

import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';

function getApi(): any {
  return typeof window !== 'undefined' ? (window as any).xiaokDesktop : null;
}

async function proxyGet<T>(path: string): Promise<T> {
  const api = getApi();
  const data = await api?.kswarmProxyGet(path);
  if (data === null || data === undefined) throw new Error(`GET ${path} failed`);
  return data as T;
}

async function proxyPost<T>(path: string, body?: unknown): Promise<T> {
  const api = getApi();
  const data = await api?.kswarmProxyPost(path, body);
  if (data === null || data === undefined) throw new Error(`POST ${path} failed`);
  return data as T;
}

async function proxyDelete(path: string): Promise<void> {
  const api = getApi();
  const ok = await api?.kswarmProxyDelete(path);
  if (!ok) throw new Error(`DELETE ${path} failed`);
}

// ─── Query Keys ────────────────────────────────────────────────────────

export const projectKeys = {
  all: () => ['kswarm', 'projects'] as const,
  list: () => [...projectKeys.all(), 'list'] as const,
  detail: (id: string) => [...projectKeys.all(), 'detail', id] as const,
  fullDetail: (id: string) => [...projectKeys.all(), 'full', id] as const,
};

export const agentKeys = {
  all: () => ['kswarm', 'agents'] as const,
  list: () => [...agentKeys.all(), 'list'] as const,
};

// ─── Projects ──────────────────────────────────────────────────────────

export function useProjects() {
  return useQuery({
    queryKey: projectKeys.list(),
    queryFn: async () => {
      const data = await proxyGet<{ projects: any[] }>('/projects');
      return data.projects || [];
    },
    staleTime: 5_000,
    refetchInterval: 10_000,
    retry: 2,
  });
}

export function useProjectDetail(projectId: string) {
  return useQuery({
    queryKey: projectKeys.detail(projectId),
    queryFn: () => proxyGet(`/projects/${projectId}`),
    enabled: !!projectId,
    staleTime: 5_000,
    refetchInterval: 10_000,
    retry: 2,
  });
}

export function useProjectFullDetail(projectId: string) {
  return useQuery({
    queryKey: projectKeys.fullDetail(projectId),
    queryFn: () => proxyGet(`/projects/${projectId}`),
    enabled: !!projectId,
    staleTime: 5_000,
    refetchInterval: 5_000,
    retry: 2,
  });
}

export function useInvalidateProjects() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: projectKeys.all() });
  };
}

// ─── Agents ────────────────────────────────────────────────────────────

export function useAgents() {
  return useQuery({
    queryKey: agentKeys.list(),
    queryFn: async () => {
      const data = await proxyGet<{ agents: any[] }>('/agents');
      return data.agents || [];
    },
    staleTime: 10_000,
    refetchInterval: 15_000,
    retry: 2,
  });
}

export function useInvalidateAgents() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: agentKeys.all() });
  };
}

// ─── Mutations ─────────────────────────────────────────────────────────

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; goal: string; poAgent: string; requirements?: string; members?: string[]; workFolder?: string }) =>
      proxyPost('/projects', input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: projectKeys.all() });
    },
  });
}

export function useApproveProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (projectId: string) =>
      proxyPost(`/projects/${projectId}/approve`),
    onMutate: async (projectId) => {
      await qc.cancelQueries({ queryKey: projectKeys.detail(projectId) });
      const previous = qc.getQueryData(projectKeys.detail(projectId));
      qc.setQueryData(projectKeys.detail(projectId), (old: any) => {
        if (!old?.project) return old;
        return { ...old, project: { ...old.project, status: 'active' } };
      });
      return { previous };
    },
    onError: (_err, projectId, context) => {
      if (context?.previous) {
        qc.setQueryData(projectKeys.detail(projectId), context.previous);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: projectKeys.all() });
    },
  });
}

export function useCreateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; roles: string[]; runtimeType?: string; provider?: string; model?: string; instructions?: string }) =>
      proxyPost('/agents', input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: agentKeys.all() });
    },
  });
}

export function useStartAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agentId: string) =>
      proxyPost(`/agents/${agentId}/start`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: agentKeys.all() });
    },
  });
}

export function useStopAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agentId: string) =>
      proxyPost(`/agents/${agentId}/stop`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: agentKeys.all() });
    },
  });
}

export function useArchiveAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agentId: string) => proxyDelete(`/agents/${agentId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: agentKeys.all() });
    },
  });
}
