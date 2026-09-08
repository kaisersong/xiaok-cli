import { resolve } from 'node:path';
import type { Tool } from '../../src/types.js';
import { ToolRegistry, type RegistryOptions } from '../../src/ai/tools/index.js';
import { createReadTool } from '../../src/ai/tools/read.js';
import { createWriteTool } from '../../src/ai/tools/write.js';
import { createEditTool } from '../../src/ai/tools/edit.js';
import { createRenderUiTool } from '../../src/ai/tools/render-ui.js';
import { MULTI_AGENT_TOOL_NAMES } from '../../src/ai/tools/multi-agent.js';
import { DesktopCapabilityCatalog, type DesktopCapabilityDescriptor, type DesktopInvocationAuthority } from './desktop-multi-agent-capabilities.js';
import type { DesktopAgentExecutionContext, DesktopMultiAgentService } from './desktop-multi-agent-service.js';
import type { ExecutionAuthorizationSnapshot } from '../shared/multi-agent-types.js';

export interface DesktopToolOwnership {
  ownerId: string; slotKey: string; binding: 'builtin' | 'independent' | 'rootOnly' | 'custom'; verifiedReadOnly?: boolean;
  bindInvocation?(authority: Readonly<DesktopInvocationAuthority>): Tool['execute'];
}
const BUILTINS = new Set(['read', 'write', 'edit', 'bash', 'grep', 'glob', 'web_fetch', 'web_search', 'render_ui', 'install_skill', 'uninstall_skill', 'validate_skill']);
const PURE_READ_BUILTINS = new Set(['read', 'grep', 'glob']);
const CONTROL_NAMES = new Set<string>(MULTI_AGENT_TOOL_NAMES);

/** Desktop-only catalog notifications; CLI registry semantics remain unchanged. */
export class DesktopOwnedToolRegistry extends ToolRegistry {
  private ownership = new Map<string, DesktopToolOwnership>();
  private listeners = new Set<() => void>();
  constructor(options: RegistryOptions, tools: Tool[]) {
    super(options, tools);
    for (const tool of tools) this.ownership.set(tool.definition.name, { ownerId: BUILTINS.has(tool.definition.name) ? 'builtin' : 'desktop-host',
      slotKey: tool.definition.name, binding: BUILTINS.has(tool.definition.name) ? 'builtin' : 'rootOnly',
      verifiedReadOnly: PURE_READ_BUILTINS.has(tool.definition.name) });
  }
  override registerTool(tool: Tool): void {
    // ToolRegistry's constructor dispatches here before subclass fields exist.
    if (!this.ownership) { super.registerTool(tool); return; }
    const current = this.ownership.get(tool.definition.name);
    this.registerOwnedTool(tool, current ?? { ownerId: 'desktop-host', slotKey: tool.definition.name, binding: 'rootOnly' });
  }
  registerOwnedTool(tool: Tool, owner: DesktopToolOwnership): void {
    const name = tool.definition.name;
    if (CONTROL_NAMES.has(name) || name === 'tool_search') throw new Error('reserved multi-agent control namespace');
    const previous = this.ownership.get(name);
    if (this.getRegisteredTool(name) && previous && (previous.ownerId !== owner.ownerId || previous.slotKey !== owner.slotKey)) throw new Error('Desktop capability name collision');
    // A default host registration cannot masquerade as another MCP owner.
    this.ownership.set(name, Object.freeze({ ...owner }));
    super.registerTool(tool); this.changed();
  }
  override unregisterTool(name: string, expected?: Tool): void {
    if (expected && this.getRegisteredTool(name) !== expected) return;
    super.unregisterTool(name, expected); this.ownership.delete(name); this.changed();
  }
  ownerOf(name: string): DesktopToolOwnership | undefined { return this.ownership.get(name); }
  subscribeToolsChanged(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  override dispose(): void { super.dispose(); this.ownership?.clear(); this.changed(); this.listeners?.clear(); }
  private changed(): void { for (const listener of [...(this.listeners ?? [])]) listener(); }
}

/** One main-owned workspace catalog; child policies freeze its slot ceiling. */
export class DesktopToolCatalogBridge {
  readonly catalog = new DesktopCapabilityCatalog();
  private readonly slots = new Map<string, { descriptor: DesktopCapabilityDescriptor; tool: Tool; present: boolean }>();
  private readonly unsubscribe: () => void;
  constructor(private readonly options: { registry: DesktopOwnedToolRegistry; workspaceId: string;
    getService?(): Pick<DesktopMultiAgentService, 'assertInvocation'> | undefined;
  }) {
    this.sync(); this.unsubscribe = options.registry.subscribeToolsChanged(() => this.sync());
  }
  applyExecutionAuthorization(snapshot: ExecutionAuthorizationSnapshot): void {
    this.catalog.applyWorkspaceAuthorization({ workspaceId: this.options.workspaceId, snapshot });
  }
  authorizeRoot(context?: DesktopAgentExecutionContext): void {
    // No owner is needed only for the legacy, unconnected standalone catalog.
    // Once a service or its projection is bound, lack of that owner is denial.
    if (this.options.getService || this.catalog.hasWorkspaceAuthorization(this.options.workspaceId)) {
      const service = this.options.getService?.();
      if (!service || !context) throw new Error('workspace authorization context unavailable');
      service.assertInvocation(context.actor, context);
      context.signal.throwIfAborted();
      if (context.agentId !== `root_${context.groupId}`) throw new Error('root authorization requires the current root context');
      this.catalog.assertWorkspaceAuthorization(this.options.workspaceId, context.permissionRevision);
    }
    this.sync();
    for (const item of this.slots.values()) if (item.present) this.catalog.authorize({ requestSource: 'user', capabilityId: item.descriptor.capabilityId });
  }
  dispose(): void {
    this.unsubscribe();
    for (const item of this.slots.values()) this.catalog.revoke({ requestSource: 'scheduler', ownerId: item.descriptor.ownerId, slotId: item.descriptor.slotId });
    this.slots.clear();
  }
  private sync(): void {
    const seen = new Set<string>();
    for (const definition of this.options.registry.getToolDefinitions()) {
      if (definition.name === 'tool_search') continue;
      const tool = this.options.registry.getRegisteredTool(definition.name);
      const owner = this.options.registry.ownerOf(definition.name);
      if (!tool || !owner) continue;
      const key = JSON.stringify([owner.ownerId, owner.slotKey]); seen.add(key);
      const previous = this.slots.get(key);
      if (previous?.tool === tool && previous.present) continue;
      const descriptor = this.catalog.publish({ requestSource: 'scheduler', ownerId: owner.ownerId, slotId: previous?.descriptor.slotId,
        entry: { definition: tool.definition, aliases: [], permission: tool.permission, verifiedReadOnly: owner.verifiedReadOnly === true,
          scope: { workspaceId: this.options.workspaceId, materialIds: [], permissions: [tool.permission] },
          bindInvocation: authority => this.bind(tool, owner, authority),
        } });
      this.slots.set(key, { descriptor, tool, present: true });
    }
    for (const [key, item] of this.slots) if (!seen.has(key) && item.present) {
      this.catalog.revoke({ requestSource: 'scheduler', ownerId: item.descriptor.ownerId, slotId: item.descriptor.slotId,
        expectedCapabilityId: item.descriptor.capabilityId }); item.present = false;
    }
  }
  private bind(tool: Tool, owner: DesktopToolOwnership, authority: Readonly<DesktopInvocationAuthority>): Tool['execute'] {
    if (owner.binding === 'custom') {
      if (!owner.bindInvocation) throw new Error('tool_scope_unsupported'); return owner.bindInvocation(authority);
    }
    if (owner.binding === 'independent') return (input, context) => tool.execute(input, context);
    if (owner.binding === 'rootOnly') return (input, context) => {
      if (authority.agentId !== `root_${authority.groupId}`) throw new Error('tool_scope_unsupported');
      return tool.execute(input, context);
    };
    switch (tool.definition.name) {
      case 'read': return createReadTool({ cwd: authority.cwd }).execute;
      case 'write': return createWriteTool({ cwd: authority.cwd }).execute;
      case 'edit': return createEditTool({ cwd: authority.cwd }).execute;
      case 'render_ui': return createRenderUiTool({ cwd: authority.cwd }).execute;
      case 'bash': return (input, context) => tool.execute({ ...input, workdir: typeof input.workdir === 'string' ? resolve(authority.cwd, input.workdir) : authority.cwd }, context);
      case 'grep': case 'glob': return (input, context) => tool.execute({ ...input, path: typeof input.path === 'string' ? resolve(authority.cwd, input.path) : authority.cwd }, context);
      // These builtins have no workspace-specific construction closure. Global
      // configuration/file effects still require the frozen parent permission.
      default: return (input, context) => tool.execute(input, context);
    }
  }
}
