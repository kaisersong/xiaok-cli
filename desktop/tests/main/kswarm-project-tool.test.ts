import { describe, expect, it } from 'vitest';

import { extractCreatedAgentId, resolveCreateProjectMembers } from '../../electron/kswarm-project-tool.js';

describe('kswarm create_project defaults', () => {
  it('keeps the offline xiaok worker as the default member seed and reports total agent count', () => {
    const result = resolveCreateProjectMembers({
      agents: [
        { id: 'xiaok-po', name: 'PO-Agent', status: 'idle', roles: ['project_owner'] },
        { id: 'xiaok-worker', name: 'Worker-Agent', status: 'offline', roles: ['worker'] },
        { id: 'codex-worker', name: 'Codex', status: 'idle', roles: ['worker'] },
      ],
      poAgent: 'xiaok-po',
      memberNames: [],
      memberCount: 0,
    });

    expect(result.members).toEqual(['xiaok-worker']);
    expect(result.totalAgentCount).toBe(2);
  });

  it('keeps the dedicated xiaok worker seed when chat asks for a worker count without naming agents', () => {
    const result = resolveCreateProjectMembers({
      agents: [
        { id: 'xiaok-po', name: 'PO-Agent', status: 'idle', roles: ['project_owner'] },
        { id: 'xiaok-worker', name: 'Worker-Agent', status: 'offline', roles: ['worker'] },
        { id: 'codex-worker', name: 'Codex', status: 'idle', roles: ['worker'] },
        { id: 'claude-worker', name: 'Claude', status: 'idle', roles: ['worker'] },
      ],
      poAgent: 'xiaok-po',
      memberNames: [],
      memberCount: 2,
    });

    expect(result.members).toEqual(['xiaok-worker']);
    expect(result.totalAgentCount).toBe(2);
  });

  it('fills requested worker count with online agents when no dedicated xiaok worker seed exists', () => {
    const result = resolveCreateProjectMembers({
      agents: [
        { id: 'xiaok-po', name: 'PO-Agent', status: 'idle', roles: ['project_owner'] },
        { id: 'codex-worker', name: 'Codex', status: 'idle', roles: ['worker'] },
        { id: 'claude-worker', name: 'Claude', status: 'idle', roles: ['worker'] },
      ],
      poAgent: 'xiaok-po',
      memberNames: [],
      memberCount: 2,
    });

    expect(result.members).toEqual(['codex-worker', 'claude-worker']);
    expect(result.totalAgentCount).toBe(3);
  });

  it('extracts created worker ids from KSwarm agent creation responses without leaking undefined members', () => {
    expect(extractCreatedAgentId({ id: 'worker-top-level' })).toBe('worker-top-level');
    expect(extractCreatedAgentId({ agent: { id: 'worker-nested' } })).toBe('worker-nested');
    expect(extractCreatedAgentId({ agent: { id: '' } })).toBe('');
    expect(extractCreatedAgentId({ agent: { source: 'default_seed' } })).toBe('');
    expect(extractCreatedAgentId(null)).toBe('');
  });
});
