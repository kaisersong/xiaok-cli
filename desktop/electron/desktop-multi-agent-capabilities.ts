import { randomUUID } from 'node:crypto';
import type { PermissionClass, Tool, ToolDefinition, ToolExecutionContext, ToolPermissionGrant } from '../../src/types.js';
import { isToolPermissionGrant, ToolRegistry, type RegistryOptions } from '../../src/ai/tools/index.js';
import { getCanonicalToolId } from '../../src/ai/tools/tool-identity.js';
import { MULTI_AGENT_TOOL_NAMES } from '../../src/ai/tools/multi-agent.js';
import type { ExecutionAuthorizationSnapshot } from '../shared/multi-agent-types.js';

type Source = 'user' | 'agent' | 'scheduler';
export interface DesktopCapabilityScope {
  workspaceId: string;
  materialIds: readonly string[];
  permissions: readonly PermissionClass[];
}
export interface DesktopInvocationAuthority {
  groupId: string; agentId: string; turnId: string; cwd: string; workspaceId: string;
  materialIds: readonly string[]; permissionRevision: number; signal: AbortSignal;
  deadlineAt: number;
  getApprovalDeadline?(): number;
  assertCurrent?(): void;
  beforeOpaqueInvocation?(): void | Promise<void>;
  requestApproval?(invocation: DesktopApprovalInvocation): Promise<false | ToolPermissionGrant>;
}
/** Main-only resolved invocation, never an IPC or model-supplied credential. */
export interface DesktopApprovalInvocation {
  invocation: object; descriptor: DesktopCapabilityDescriptor; tool: Tool; toolName: string;
  input: Record<string, unknown>; toolContext: ToolExecutionContext; authority: Readonly<DesktopInvocationAuthority>;
  issuedAt: number; minDeadlineAt: number; assertCurrent(): void;
  subscribeInvalidated(listener: (reason: 'descriptor_changed' | 'scope_disposed') => void): () => void;
}
export interface DesktopCapabilityEntry {
  definition: ToolDefinition;
  aliases: readonly string[];
  permission: PermissionClass;
  /** Main-reviewed implementation guarantee, never inferred from name/permission. */
  verifiedReadOnly?: boolean;
  scope: DesktopCapabilityScope;
  bindInvocation(authority: Readonly<DesktopInvocationAuthority>): Tool['execute'];
}
export interface DesktopCapabilityDescriptor extends DesktopCapabilityEntry {
  capabilityId: string; ownerId: string; slotId: string; revision: number; canonicalName: string;
}
export interface DesktopCapabilityPolicy { readonly policyId: string }
export interface DesktopScopedRegistry {
  registry: ToolRegistry;
  authority: Readonly<DesktopInvocationAuthority>;
  dispose(): void;
}
interface ScopeRecord {
  handle: DesktopScopedRegistry; controller: AbortController; active: boolean;
  policy: Map<string, DesktopCapabilityScope>; tools: Map<string, Tool>;
  invalidations: Set<{ current(): boolean; listener(reason: 'descriptor_changed' | 'scope_disposed'): void }>;
}
const RESERVED = new Set<string>([...MULTI_AGENT_TOOL_NAMES, 'tool_search']);
const keyOf = (ownerId: string, slotId: string): string => JSON.stringify([ownerId, slotId]);

/** Main-only catalog: names address capabilities but never grant their identity. */
export class DesktopCapabilityCatalog {
  private readonly descriptors = new Map<string, DesktopCapabilityDescriptor>();
  private readonly slotOwners = new Map<string, string>();
  private readonly slotRevisions = new Map<string, number>();
  private readonly names = new Map<string, string>();
  private readonly authorized = new Map<string, string>();
  private readonly policies = new WeakMap<DesktopCapabilityPolicy, Map<string, DesktopCapabilityScope>>();
  private readonly scopes = new Set<ScopeRecord>();
  private readonly workspaceRevisions = new Map<string, number>();
  private readonly workspaceAuthorizations = new Map<string, Readonly<ExecutionAuthorizationSnapshot>>();

  publish(input: { requestSource: Source; ownerId: string; slotId?: string; entry: DesktopCapabilityEntry }): DesktopCapabilityDescriptor {
    this.assertSource(input.requestSource, 'scheduler');
    if (!input.ownerId) throw new Error('capability requires owner');
    const slotId = input.slotId ?? randomUUID();
    const knownOwner = this.slotOwners.get(slotId);
    if (input.slotId && knownOwner !== input.ownerId) throw new Error('unknown capability slot or owner mismatch');
    const key = keyOf(input.ownerId, slotId);
    const previous = this.descriptors.get(key);
    const names = [input.entry.definition.name, ...input.entry.aliases].map(getCanonicalToolId);
    for (const name of names) {
      if (!name || RESERVED.has(name)) throw new Error('reserved multi-agent control namespace');
      const existing = this.names.get(name);
      if (existing && existing !== key) throw new Error('capability name collision');
    }
    const scope = copyScope(input.entry.scope);
    if (!scope.permissions.includes(input.entry.permission)) throw new Error('capability permission is outside its scope');
    const revision = (this.slotRevisions.get(slotId) ?? 0) + 1;
    const descriptor: DesktopCapabilityDescriptor = Object.freeze({ ...input.entry,
      definition: structuredClone(input.entry.definition), aliases: Object.freeze([...input.entry.aliases]), scope,
      capabilityId: randomUUID(), ownerId: input.ownerId, slotId, revision, canonicalName: input.entry.definition.name,
    });
    // Validate first, then atomically remove all aliases of the previous revision.
    if (previous) this.removeNames(key, previous);
    this.descriptors.set(key, descriptor); this.slotOwners.set(slotId, input.ownerId); this.slotRevisions.set(slotId, revision);
    for (const name of names) this.names.set(name, key);
    this.authorized.delete(key);
    this.refreshAll();
    return descriptor;
  }

  authorize(input: { requestSource: Source; capabilityId: string }): void {
    this.assertSource(input.requestSource, 'user');
    const descriptor = [...this.descriptors.values()].find(item => item.capabilityId === input.capabilityId);
    if (!descriptor) throw new Error('stale capability authorization');
    this.authorized.set(keyOf(descriptor.ownerId, descriptor.slotId), descriptor.capabilityId);
    this.refreshAll();
  }

  revoke(input: { requestSource: Source; ownerId: string; slotId?: string; expectedCapabilityId?: string }): void {
    this.assertSource(input.requestSource, 'scheduler');
    for (const [key, descriptor] of this.descriptors) {
      if (descriptor.ownerId !== input.ownerId || input.slotId && descriptor.slotId !== input.slotId
        || input.expectedCapabilityId && descriptor.capabilityId !== input.expectedCapabilityId) continue;
      this.removeNames(key, descriptor); this.descriptors.delete(key); this.authorized.delete(key);
    }
    this.refreshAll();
  }

  revokeWorkspace(input: { requestSource: Source; workspaceId: string }): void {
    this.assertSource(input.requestSource, 'user');
    if (this.hasWorkspaceAuthorization(input.workspaceId)) throw new Error('workspace authorization is service-owned');
    this.workspaceRevisions.set(input.workspaceId, this.permissionRevision(input.workspaceId) + 1);
    for (const scope of this.scopes) {
      if (scope.handle.authority.workspaceId === input.workspaceId) scope.controller.abort(new DOMException('workspace permission revoked', 'AbortError'));
    }
    this.refreshAll();
  }

  /** Main owner projection only. Descriptor generations remain independent. */
  applyWorkspaceAuthorization(input: { workspaceId: string; snapshot: ExecutionAuthorizationSnapshot }): void {
    const incoming = input.snapshot;
    if (!input.workspaceId || !incoming || typeof incoming.bootId !== 'string' || !incoming.bootId
      || !Number.isSafeInteger(incoming.permissionRevision) || incoming.permissionRevision < 0
      || typeof incoming.executionAllowed !== 'boolean'
      || !['confirmed', 'unknown'].includes(incoming.persistenceState)
      || incoming.persistenceState === 'unknown' && incoming.executionAllowed) throw new Error('invalid workspace authorization snapshot');
    const previous = this.workspaceAuthorizations.get(input.workspaceId);
    if (previous) {
      if (incoming.bootId !== previous.bootId || incoming.permissionRevision < previous.permissionRevision) return;
      if (incoming.permissionRevision === previous.permissionRevision) {
        // A confirmed candidate is final. Only the owner's unknown candidate
        // may become confirmed at the same revision (including a true grant).
        if (previous.persistenceState === 'confirmed' || incoming.persistenceState === 'unknown') return;
      }
    }
    this.workspaceAuthorizations.set(input.workspaceId, Object.freeze({ bootId: incoming.bootId,
      permissionRevision: incoming.permissionRevision, executionAllowed: incoming.executionAllowed, persistenceState: incoming.persistenceState }));
    for (const scope of this.scopes) {
      const authority = scope.handle.authority;
      if (authority.workspaceId === input.workspaceId && !this.workspaceAllows(authority.workspaceId, authority.permissionRevision)) {
        scope.controller.abort(new DOMException('workspace permission revoked', 'AbortError'));
      }
    }
    this.refreshAll();
  }

  hasWorkspaceAuthorization(workspaceId: string): boolean { return this.workspaceAuthorizations.has(workspaceId); }
  assertWorkspaceAuthorization(workspaceId: string, permissionRevision: number): void {
    if (!this.workspaceAllows(workspaceId, permissionRevision)) throw new Error('stale or denied workspace permission revision');
  }
  private workspaceAllows(workspaceId: string, permissionRevision: number): boolean {
    const snapshot = this.workspaceAuthorizations.get(workspaceId);
    return permissionRevision === this.permissionRevision(workspaceId)
      && (!snapshot || snapshot.persistenceState === 'confirmed' && snapshot.executionAllowed);
  }
  permissionRevision(workspaceId: string): number { return this.workspaceAuthorizations.get(workspaceId)?.permissionRevision ?? this.workspaceRevisions.get(workspaceId) ?? 0; }
  snapshotDescriptors(): DesktopCapabilityDescriptor[] { return [...this.descriptors.values()]; }

  snapshotPolicy(): DesktopCapabilityPolicy {
    const ceiling = new Map<string, DesktopCapabilityScope>();
    for (const [key, descriptor] of this.descriptors) {
      if (this.authorized.get(key) === descriptor.capabilityId) ceiling.set(key, copyScope(descriptor.scope));
    }
    return this.issuePolicy(ceiling);
  }

  forkPolicy(parent: DesktopCapabilityPolicy, allowedNames?: readonly string[]): DesktopCapabilityPolicy {
    const ceiling = this.policies.get(parent);
    if (!ceiling) throw new Error('invalid capability policy');
    // Undefined inherits; an explicit empty intersection grants nothing.
    const selected = allowedNames === undefined ? undefined : new Set(allowedNames.map(name => this.names.get(getCanonicalToolId(name))).filter(Boolean));
    const next = new Map<string, DesktopCapabilityScope>();
    for (const [key, scope] of ceiling) {
      const descriptor = this.descriptors.get(key);
      if ((!selected || selected.has(key)) && descriptor && this.authorized.get(key) === descriptor.capabilityId && scopeWithin(descriptor.scope, scope)) next.set(key, copyScope(scope));
    }
    return this.issuePolicy(next);
  }

  createScopedRegistry(policy: DesktopCapabilityPolicy, input: DesktopInvocationAuthority, options: RegistryOptions = {}): DesktopScopedRegistry {
    const ceiling = this.policies.get(policy);
    if (!ceiling) throw new Error('invalid capability policy');
    this.assertWorkspaceAuthorization(input.workspaceId, input.permissionRevision);
    const controller = new AbortController();
    const authority = Object.freeze({ ...input, materialIds: Object.freeze([...input.materialIds]), signal: AbortSignal.any([input.signal, controller.signal]) });
    let record!: ScopeRecord;
    const registry = new ToolRegistry({ ...options, agentId: authority.agentId,
      // Never pass the broad global CapabilityRegistry into a scoped tool_search.
      capabilityRegistry: undefined,
      onPrompt: (name, rawInput, invocation) => this.approve(record, name, rawInput, options.onPrompt, invocation),
    }, []);
    const handle: DesktopScopedRegistry = { registry, authority,
      dispose: () => {
        if (!record.active) return;
        record.active = false; controller.abort(new DOMException('invocation authority disposed', 'AbortError'));
        for (const item of [...record.invalidations]) { record.invalidations.delete(item); item.listener('scope_disposed'); }
        this.scopes.delete(record); record.tools.clear(); registry.dispose();
      },
    };
    record = { handle, controller, active: true, policy: new Map(ceiling), tools: new Map(), invalidations: new Set() };
    this.scopes.add(record); this.refresh(record);
    return handle;
  }

  private issuePolicy(ceiling: Map<string, DesktopCapabilityScope>): DesktopCapabilityPolicy {
    const policy = Object.freeze({ policyId: randomUUID() }); this.policies.set(policy, ceiling); return policy;
  }
  private assertSource(actual: Source, allowed: Source): void {
    if (actual !== allowed) throw new Error('capability mutation source is not permitted');
  }
  private removeNames(key: string, descriptor: DesktopCapabilityDescriptor): void {
    for (const name of [descriptor.canonicalName, ...descriptor.aliases].map(getCanonicalToolId)) if (this.names.get(name) === key) this.names.delete(name);
  }
  private refreshAll(): void { for (const scope of this.scopes) this.refresh(scope); }
  private available(record: ScopeRecord, key: string, descriptor: DesktopCapabilityDescriptor): boolean {
    const authority = record.handle.authority;
    const ceiling = record.policy.get(key);
    return Boolean(record.active && !authority.signal.aborted && ceiling && this.workspaceAllows(authority.workspaceId, authority.permissionRevision)
      && authority.workspaceId === descriptor.scope.workspaceId && this.authorized.get(key) === descriptor.capabilityId
      && scopeWithin(descriptor.scope, ceiling) && descriptor.scope.materialIds.every(id => authority.materialIds.includes(id)));
  }
  private refresh(record: ScopeRecord): void {
    for (const item of [...record.invalidations]) if (!item.current()) { record.invalidations.delete(item); item.listener('descriptor_changed'); }
    const desired = new Map<string, { key: string; descriptor: DesktopCapabilityDescriptor }>();
    for (const [key, descriptor] of this.descriptors) if (this.available(record, key, descriptor)) {
      for (const name of [descriptor.canonicalName, ...descriptor.aliases]) desired.set(name, { key, descriptor });
    }
    for (const [name, tool] of record.tools) {
      const next = desired.get(name);
      if (next && (tool as Tool & { capabilityId?: string }).capabilityId === next.descriptor.capabilityId) continue;
      record.handle.registry.unregisterTool(name, tool); record.tools.delete(name);
    }
    for (const [name, { key, descriptor }] of desired) {
      if (record.tools.has(name)) continue;
      const tool: Tool & { capabilityId: string } = {
        definition: { ...descriptor.definition, name }, permission: descriptor.permission, capabilityId: descriptor.capabilityId,
        execute: async (input, context) => {
          const authority = record.handle.authority;
          if (authority.signal.aborted) throw authority.signal.reason;
          if (Date.now() >= authority.deadlineAt) throw new DOMException('invocation deadline exceeded', 'AbortError');
          authority.assertCurrent?.();
          if (this.descriptors.get(key) !== descriptor || !this.available(record, key, descriptor)) throw new Error('capability revoked or scope changed');
          if (!descriptor.verifiedReadOnly) await authority.beforeOpaqueInvocation?.();
          // The journal may be asynchronous. Recheck authority before the effect.
          authority.signal.throwIfAborted(); context?.signal?.throwIfAborted();
          if (Date.now() >= authority.deadlineAt) throw new DOMException('invocation deadline exceeded', 'AbortError');
          authority.assertCurrent?.(); context?.assertPermissionApproval?.();
          if (this.descriptors.get(key) !== descriptor || !this.available(record, key, descriptor)) throw new Error('capability revoked or scope changed');
          const invoke = descriptor.bindInvocation(authority);
          const boundContext: ToolExecutionContext | undefined = context ? { ...context,
            signal: AbortSignal.any([authority.signal, ...(context.signal ? [context.signal] : [])]),
            session: { ...context.session, cwd: authority.cwd },
          } : undefined;
          context?.onToolInvocationStarted?.();
          return invoke(input, boundContext);
        },
      };
      record.tools.set(name, tool); record.handle.registry.registerTool(tool);
    }
  }

  private async approve(record: ScopeRecord, name: string, input: Record<string, unknown>, prompt: RegistryOptions['onPrompt'],
    invocation: Parameters<NonNullable<RegistryOptions['onPrompt']>>[2]): Promise<boolean | ToolPermissionGrant> {
    const authority = record.handle.authority;
    if ((!prompt && !authority.requestApproval) || authority.signal.aborted) return false;
    const key = this.names.get(getCanonicalToolId(name));
    const descriptor = key && this.descriptors.get(key);
    const current = () => Boolean(key && descriptor && invocation && invocation.tool === record.tools.get(name)
      && (invocation.tool as Tool & { capabilityId?: string }).capabilityId === descriptor.capabilityId
      && this.descriptors.get(key) === descriptor && this.available(record, key, descriptor));
    if (!current()) return false;
    const issuedAt = Date.now();
    const minDeadlineAt = Math.min(issuedAt + 10 * 60_000, authority.deadlineAt, authority.getApprovalDeadline?.() ?? authority.deadlineAt);
    const remaining = minDeadlineAt - Date.now();
    if (!Number.isFinite(minDeadlineAt)) return false;
    const assertApprovalCurrent = () => {
      authority.signal.throwIfAborted(); invocation?.context?.signal?.throwIfAborted(); authority.assertCurrent?.();
      if (!current()) throw new Error('capability revoked or scope changed');
      if (Date.now() >= minDeadlineAt) throw new Error('approval_expired');
    };
    if (authority.requestApproval) {
      if (!invocation?.context) throw new Error('approval_context_unavailable');
      const result = await authority.requestApproval({ invocation: Object.freeze({ nonce: randomUUID() }),
        descriptor: descriptor as DesktopCapabilityDescriptor, tool: invocation.tool, toolName: name, input, toolContext: invocation.context, authority,
        issuedAt, minDeadlineAt, assertCurrent: assertApprovalCurrent,
        subscribeInvalidated: listener => {
          if (!record.active) { listener('scope_disposed'); return () => {}; }
          if (!current()) { listener('descriptor_changed'); return () => {}; }
          const item = { current, listener }; record.invalidations.add(item); return () => { record.invalidations.delete(item); };
        },
      });
      return isToolPermissionGrant(result) ? result : false;
    }
    if (remaining <= 0) return false;
    return new Promise<boolean | ToolPermissionGrant>((resolve, reject) => {
      let settled = false;
      const finish = (approved: boolean | ToolPermissionGrant, error?: { reason: unknown }) => {
        if (settled) return; settled = true;
        clearTimeout(timer); authority.signal.removeEventListener('abort', abort);
        if (error) { reject(error.reason); return; }
        if (authority.signal.aborted || Date.now() >= minDeadlineAt) { resolve(false); return; }
        if (!isToolPermissionGrant(approved)) { resolve(approved === true); return; }
        // Preserve the input-consuming receipt rather than truthiness. This
        // invocation-local adapter also retains the captured short deadline
        // through a later async opaque journal; it never renews that deadline.
        resolve({ approved: true,
          prepareInput: finalInput => { assertApprovalCurrent(); return approved.prepareInput(finalInput); },
          assertCurrent: () => { assertApprovalCurrent(); return approved.assertCurrent(); },
        });
      };
      const abort = () => finish(false);
      const timer = setTimeout(() => finish(false), remaining); timer.unref?.();
      authority.signal.addEventListener('abort', abort, { once: true });
      Promise.resolve().then(() => {
        if (authority.signal.aborted || !current() || Date.now() >= minDeadlineAt) return false;
        authority.assertCurrent?.(); return prompt!(name, input, invocation);
      }).then(value => finish(value), error => finish(false, { reason: error }));
    });
  }
}

function copyScope(scope: DesktopCapabilityScope): DesktopCapabilityScope {
  if (!scope.workspaceId || !Array.isArray(scope.materialIds) || !Array.isArray(scope.permissions)
    || scope.materialIds.some(id => typeof id !== 'string') || scope.permissions.some(permission => !['safe', 'write', 'bash'].includes(permission))) throw new Error('invalid capability scope');
  return Object.freeze({ workspaceId: scope.workspaceId, materialIds: Object.freeze([...new Set(scope.materialIds)]), permissions: Object.freeze([...new Set(scope.permissions)]) });
}
function scopeWithin(candidate: DesktopCapabilityScope, ceiling: DesktopCapabilityScope): boolean {
  return candidate.workspaceId === ceiling.workspaceId && candidate.materialIds.every(id => ceiling.materialIds.includes(id))
    && candidate.permissions.every(permission => ceiling.permissions.includes(permission));
}
