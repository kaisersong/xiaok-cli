import type { Tool, ModelAdapter, ToolExecutionContext } from '../../types.js';
import type { CustomAgentDef } from '../agents/loader.js';
import type { ToolRegistry } from './index.js';
import type { BackgroundRunner } from '../../platform/agents/background-runner.js';
import type { WorktreeManager } from '../../platform/worktrees/manager.js';
import { executeNamedSubAgent } from '../agents/subagent-executor.js';

interface SubAgentToolOptions {
  source: string;
  sessionId: string;
  cwd?: string;
  adapter: () => ModelAdapter;
  agents: CustomAgentDef[];
  createRegistry(cwd: string, allowedTools?: string[], agentId?: string): ToolRegistry;
  buildSystemPrompt(cwd: string): Promise<string>;
  backgroundRunner?: BackgroundRunner;
  worktreeManager?: WorktreeManager;
  getTaskId?: () => string | undefined;
}

interface SubAgentInvocation {
  agent?: string;         // Pre-defined agent name (optional)
  description?: string;   // Short task description (required for inline mode)
  prompt: string;         // Detailed task instructions
  model?: string;         // Optional model override
  tools?: string[];       // Allowed tools for inline agent
  isolation?: 'none' | 'worktree';
  background?: boolean;
  name?: string;          // Name for addressable agent
}

export function createSubAgentTool(options: SubAgentToolOptions): Tool {
  return {
    permission: 'safe',
    definition: {
      name: 'subagent',
      description: buildSubAgentDescription(options.agents),
      inputSchema: {
        type: 'object',
        properties: {
          agent: { type: 'string', description: 'Pre-defined agent name' },
          description: { type: 'string', description: 'Short task description (for inline agents)' },
          prompt: { type: 'string', description: 'Detailed task instructions' },
          model: { type: 'string', description: 'Optional model override' },
          tools: { type: 'array', items: { type: 'string' }, description: 'Allowed tools for inline agent' },
          isolation: { type: 'string', enum: ['none', 'worktree'] },
          background: { type: 'boolean' },
          name: { type: 'string' },
        },
        required: ['prompt'],
      },
    },
    async execute(input, context) {
      const invocation = input as unknown as SubAgentInvocation;

      // Build agent definition: either pre-defined or inline
      const agentDef = buildAgentDef(options.agents, invocation);
      if (!agentDef) {
        return `Error: unknown agent "${invocation.agent}". Available: ${options.agents.map(a => a.name).join(', ')}`;
      }

      // Validate: need at least prompt
      if (!invocation.prompt?.trim()) {
        return 'Error: prompt is required';
      }

      const shouldRunInBackground = invocation.background ?? agentDef.background ?? false;
      if (shouldRunInBackground) {
        if (!options.backgroundRunner) {
          return `Error: background runner is not configured for agent ${agentDef.name}`;
        }

        const job = await options.backgroundRunner.start({
          sessionId: options.sessionId,
          source: options.source,
          taskId: options.getTaskId?.(),
          metadata: {
            agent: agentDef.name,
            team: agentDef.team,
          },
          input: {
            agent: agentDef.name,
            prompt: invocation.prompt,
            cwd: options.cwd,
          },
        });
        return `background agent queued: ${job.jobId}`;
      }

      return executeNamedSubAgent({
        agentDef,
        prompt: invocation.prompt,
        sessionId: options.sessionId,
        cwd: options.cwd,
        adapter: options.adapter,
        createRegistry: options.createRegistry,
        buildSystemPrompt: options.buildSystemPrompt,
        worktreeManager: options.worktreeManager,
        forkContext: context as ToolExecutionContext | undefined,
      });
    },
  };
}

/**
 * Build a CustomAgentDef from either a pre-defined agent or inline specification.
 * For inline agents, the subagent tool is excluded from allowed tools to prevent recursion.
 */
function buildAgentDef(agents: CustomAgentDef[], invocation: SubAgentInvocation): CustomAgentDef | null {
  // Mode 1: Pre-defined agent
  if (invocation.agent) {
    const agentDef = agents.find(a => a.name === invocation.agent);
    return agentDef ?? null;
  }

  // Mode 2: Inline agent
  // Filter out 'subagent' from allowed tools to prevent unbounded recursion
  const inlineTools = (invocation.tools ?? []).filter(t => t !== 'subagent');

  return {
    name: invocation.name ?? 'inline',
    systemPrompt: '',
    allowedTools: inlineTools.length > 0 ? inlineTools : undefined,
    model: invocation.model,
    maxIterations: 50,
    isolation: invocation.isolation === 'worktree' ? 'worktree' : undefined,
    cleanup: 'keep',
    source: 'project',
  };
}

/**
 * Build a description that tells the LLM about both pre-defined and inline agent modes.
 */
function buildSubAgentDescription(agents: CustomAgentDef[]): string {
  const preDefined = agents.map(a => a.name).join(', ');
  return `Spawn a subagent to execute an independent task.

Two modes:
1. Pre-defined agent: agent="${preDefined}", prompt="..."
   Uses a pre-configured agent with its own system prompt and tool restrictions.

2. Inline agent: description="...", prompt="...", tools=["Read","Edit",...]
   Creates a temporary agent for one-off tasks. The "subagent" tool is automatically
   excluded to prevent infinite recursion.

If no suitable pre-defined agent exists, use inline mode (mode 2).`;
}
