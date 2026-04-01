import { Agent } from '../agent.js';
import type { CustomAgentDef } from './loader.js';
import type { ModelAdapter, ToolExecutionContext } from '../../types.js';
import type { ToolRegistry } from '../tools/index.js';
import type { WorktreeAllocationRecord } from '../../platform/worktrees/manager.js';
import type { WorktreeManager } from '../../platform/worktrees/manager.js';

interface ModelClonableAdapter extends ModelAdapter {
  cloneWithModel(model: string): ModelAdapter;
}

export interface ExecuteNamedSubAgentOptions {
  agentDef: CustomAgentDef;
  prompt: string;
  sessionId: string;
  cwd?: string;
  adapter: () => ModelAdapter;
  createRegistry(cwd: string, allowedTools?: string[]): ToolRegistry;
  buildSystemPrompt(cwd: string): Promise<string>;
  worktreeManager?: WorktreeManager;
  forkContext?: ToolExecutionContext;
}

export async function executeNamedSubAgent(options: ExecuteNamedSubAgentOptions): Promise<string> {
  const resolved = await resolveSubAgentCwd(
    options.worktreeManager,
    options.agentDef,
    options.sessionId,
    options.cwd,
  );
  const cwd = resolved.cwd;
  const registry = options.createRegistry(cwd, options.agentDef.allowedTools);
  const systemPromptBase = options.forkContext?.systemPrompt ?? await options.buildSystemPrompt(cwd);
  const systemPrompt = [systemPromptBase, options.agentDef.systemPrompt].filter(Boolean).join('\n\n');
  const baseAdapter = options.adapter();
  const adapter = resolveSubAgentAdapter(baseAdapter, options.agentDef.model);
  const agent = new Agent(adapter, registry, systemPrompt, {
    maxIterations: options.agentDef.maxIterations,
  });
  const chunks: string[] = [];

  if (options.forkContext?.session) {
    agent.restoreSession(options.forkContext.session);
  }

  try {
    await agent.runTurn(options.prompt, (chunk) => {
      if (chunk.type === 'text') {
        chunks.push(chunk.delta);
      }
    });
  } finally {
    if (resolved.allocation && resolved.allocation.cleanup === 'delete') {
      await options.worktreeManager?.release(resolved.allocation.path);
    }
  }

  return chunks.join('').trim();
}

function resolveSubAgentAdapter(adapter: ModelAdapter, modelOverride?: string): ModelAdapter {
  if (!modelOverride || !supportsModelClone(adapter)) {
    return adapter;
  }

  return adapter.cloneWithModel(modelOverride);
}

function supportsModelClone(adapter: ModelAdapter): adapter is ModelClonableAdapter {
  return typeof (adapter as Partial<ModelClonableAdapter>).cloneWithModel === 'function';
}

export async function resolveSubAgentCwd(
  manager: WorktreeManager | undefined,
  agent: CustomAgentDef,
  sessionId: string,
  cwd = process.cwd(),
): Promise<{ cwd: string; allocation?: WorktreeAllocationRecord }> {
  if (agent.isolation !== 'worktree') {
    return { cwd };
  }
  if (!manager) {
    throw new Error(`worktree manager is required for isolated agent ${agent.name}`);
  }

  const branch = `${agent.name}-${sessionId}`.replace(/[^a-zA-Z0-9._-]+/g, '-');
  const allocation = await manager.allocate({
    owner: agent.name,
    taskId: sessionId,
    branch,
    cleanup: agent.cleanup ?? 'keep',
  });
  return {
    cwd: allocation.path,
    allocation,
  };
}
