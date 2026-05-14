/**
 * useKSwarmProjects — React Query hooks for kswarm projects and agents.
 * Replaces the manual fetch + WebSocket pattern with React Query caching.
 *
 * Usage:
 *   const { data: projects } = useProjects();
 *   const { data: agents } = useAgents();
 *   const { data: detail } = useProjectDetail(projectId);
 */

import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';

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
      const res = await fetch('http://127.0.0.1:4400/projects');
      if (!res.ok) throw new Error(`Failed to fetch projects: ${res.status}`);
      const data = await res.json();
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
    queryFn: async () => {
      const res = await fetch(`http://127.0.0.1:4400/projects/${projectId}`);
      if (!res.ok) throw new Error(`Failed to fetch project: ${res.status}`);
      return res.json();
    },
    enabled: !!projectId,
    staleTime: 5_000,
    refetchInterval: 10_000,
    retry: 2,
  });
}

export function useProjectFullDetail(projectId: string) {
  return useQuery({
    queryKey: projectKeys.fullDetail(projectId),
    queryFn: async () => {
      const res = await fetch(`http://127.0.0.1:4400/projects/${projectId}`);
      if (!res.ok) throw new Error(`Failed to fetch project: ${res.status}`);
      return res.json();
    },
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
      const res = await fetch('http://127.0.0.1:4400/agents');
      if (!res.ok) throw new Error(`Failed to fetch agents: ${res.status}`);
      const data = await res.json();
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
    mutationFn: async (input: { name: string; goal: string; poAgent: string; requirements?: string; members?: string[]; workFolder?: string }) => {
      const res = await fetch('http://127.0.0.1:4400/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error(`Failed to create project: ${res.status}`);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: projectKeys.all() });
    },
  });
}

export function useApproveProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (projectId: string) => {
      const res = await fetch(`http://127.0.0.1:4400/projects/${projectId}/approve`, { method: 'POST' });
      if (!res.ok) throw new Error(`Approve failed: ${res.status}`);
      return res.json();
    },
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
    mutationFn: async (input: { name: string; roles: string[]; runtimeType?: string; provider?: string; model?: string; instructions?: string }) => {
      const res = await fetch('http://127.0.0.1:4400/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error(`Failed to create agent: ${res.status}`);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: agentKeys.all() });
    },
  });
}

export function useStartAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (agentId: string) => {
      const res = await fetch(`http://127.0.0.1:4400/agents/${agentId}/start`, { method: 'POST' });
      if (!res.ok) throw new Error(`Start failed: ${res.status}`);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: agentKeys.all() });
    },
  });
}

export function useStopAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (agentId: string) => {
      const res = await fetch(`http://127.0.0.1:4400/agents/${agentId}/stop`, { method: 'POST' });
      if (!res.ok) throw new Error(`Stop failed: ${res.status}`);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: agentKeys.all() });
    },
  });
}

export function useArchiveAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (agentId: string) => {
      const res = await fetch(`http://127.0.0.1:4400/agents/${agentId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Archive failed: ${res.status}`);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: agentKeys.all() });
    },
  });
}
