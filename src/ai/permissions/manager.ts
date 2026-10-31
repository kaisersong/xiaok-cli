import { posix, win32 } from 'node:path';
export type PermissionMode = 'default' | 'auto' | 'plan' | 'yolo';
export type PermissionDecision = 'allow' | 'deny' | 'prompt';
import { PermissionPolicyEngine, requiresCommandConfirmation, getCommandWriteTargets, hasMatchingCommandAllowRule, requiresAlwaysCommandConfirmation, getExactCommandApprovalRule, isExactCommandApprovalRule } from './policy-engine.js';
import { isScreenAutomationFallbackInvocation, isSensitiveToolInvocation } from './sensitive-paths.js';
import { classifyBashCommand, requiresAutoPromptForBashCommand } from '../tools/bash-safety.js';
import { isDeepStrictEqual } from 'node:util';
import type { PermissionChoice } from '../../types.js';
import { invalidateCurrentPromptAuthorization, isCurrentPromptAuthorization, snapshotPromptData, withinPromptAuthorization, type PromptAuthorizationScope } from './prompt-authorization-scope.js';

interface PromptAuthorizationRecord {
  token: object;
  scope: PromptAuthorizationScope;
  name: string;
  input: Record<string, unknown>;
  baselineRevision: number;
  expectedRevision: number;
  dirty: boolean;
  closed: boolean;
  rules?: readonly string[];
  choice?: Extract<PermissionChoice, { rule: string }>;
  ownedRules: string[];
  completed: number;
  finished: boolean;
  persistenceFailed: boolean;
  applying: boolean;
  slot?: { rule: string; called: boolean };
}

export interface PermissionManagerOptions {
  mode: PermissionMode;
  cwd?: string;
  allowRules?: string[];
  denyRules?: string[];
}

function readBashCommand(input: Record<string, unknown>): string {
  return typeof input.command === 'string' ? input.command : '';
}

export class PermissionManager {
  private mode: PermissionMode;
  private readonly cwd: string;
  private allowRules: string[];
  private denyRules: string[];
  private revision = 0;
  private readonly revisionListeners = new Set<(revision: number) => void>();
  #pendingPrompts = new Set<PromptAuthorizationRecord>();
  #promptReceipts = new WeakMap<object, { record: PromptAuthorizationRecord; revision: number }>();

  /** One native prompt transaction. No caller-supplied revision/receipt is accepted. */
  async runPromptAuthorization<T>(token: object, name: string, input: Record<string, unknown>, prompt: () => Promise<T>): Promise<{ value: T; continuationRevision?: number }> {
    const baselineRevision = this.getRevision();
    const record: PromptAuthorizationRecord = {
      token, name, input: snapshotPromptData(input), baselineRevision, expectedRevision: baselineRevision, ownedRules: [],
      dirty: false, closed: false, completed: 0, finished: false, persistenceFailed: false, applying: false,
      scope: {
        invalidate: () => { record.dirty = true; },
        begin: (confirmedName, confirmedInput, choice) => {
          if (record.closed || record.rules || !isCurrentPromptAuthorization(record.scope)
            || confirmedName !== record.name || !isDeepStrictEqual(confirmedInput, record.input)) {
            record.dirty = true; throw new Error('invalid_prompt_remember_plan');
          }
          record.choice = choice;
          record.rules = Object.freeze([...(choice.rules?.length ? choice.rules : [choice.rule])]);
          return {
            applyRule: (rule, apply) => {
              if (record.closed || record.dirty || record.applying || record.finished
                || !isCurrentPromptAuthorization(record.scope) || rule !== record.rules?.[record.completed]
                || this.getRevision() !== record.expectedRevision) {
                record.dirty = true; throw new Error('invalid_prompt_remember_mutation');
              }
              const slot = { rule, called: false };
              record.slot = slot; record.applying = true;
              try {
                const returned: unknown = apply();
                if (returned !== undefined) {
                  record.dirty = true;
                  // The callback is synchronous; never turn its promise into approval.
                  void Promise.resolve(returned).catch(() => {});
                }
                if (!slot.called || this.getRevision() !== record.expectedRevision) record.dirty = true;
                if (record.dirty) throw new Error('invalid_prompt_remember_mutation');
                record.completed++;
              } catch (error) { record.dirty = true; throw error; }
              finally { record.slot = undefined; record.applying = false; }
            },
            finish: persistenceFailed => {
              if (record.closed || record.finished || record.applying || !isCurrentPromptAuthorization(record.scope)) record.dirty = true;
              record.finished = true; record.persistenceFailed = persistenceFailed;
            },
          };
        },
      },
    };
    for (const pending of this.#pendingPrompts) {
      if (pending.token === token || isCurrentPromptAuthorization(pending.scope)) { pending.dirty = true; record.dirty = true; }
    }
    this.#pendingPrompts.add(record);
    try {
      const value = await withinPromptAuthorization(record.scope, prompt);
      record.closed = true;
      const valid = !record.dirty && this.getRevision() === record.expectedRevision;
      const validPlan = record.rules !== undefined && value === true && record.finished
        && (record.completed === record.rules.length || record.persistenceFailed);
      if (valid && validPlan && record.ownedRules.length > 0) {
        this.#promptReceipts.set(token, { record, revision: record.expectedRevision });
      }
      // Consume by the exact invocation identity once, before returning to registry.
      const receipt = this.#promptReceipts.get(token);
      this.#promptReceipts.delete(token);
      const continuationRevision = receipt?.record === record ? receipt.revision
        : valid && record.expectedRevision === record.baselineRevision && (!record.rules || validPlan) ? record.baselineRevision : undefined;
      return { value, continuationRevision };
    } finally {
      record.closed = true; record.slot = undefined;
      this.#pendingPrompts.delete(record); this.#promptReceipts.delete(token);
    }
  }

  private claimPromptRule(rule: string): PromptAuthorizationRecord | undefined {
    for (const record of this.#pendingPrompts) {
      if (!record.closed && record.applying && isCurrentPromptAuthorization(record.scope)) {
        const slot = record.slot;
        // Consume before advanceRevision invokes any user/revocation listeners.
        record.slot = undefined;
        if (!slot || slot.called || slot.rule !== rule || this.getRevision() !== record.expectedRevision) record.dirty = true;
        else { slot.called = true; return record; }
      }
    }
    return undefined;
  }

  private recordPolicyMutation(owner?: PromptAuthorizationRecord, rule?: string): void {
    const owned = owner !== undefined && rule !== undefined && this.#pendingPrompts.has(owner)
      && !owner.dirty && !owner.closed && isCurrentPromptAuthorization(owner.scope)
      && this.getRevision() === owner.expectedRevision;
    if (!owned) invalidateCurrentPromptAuthorization();
    for (const record of this.#pendingPrompts) {
      if (record === owner && owned && rule !== undefined) {
        record.expectedRevision++;
        record.ownedRules.push(rule);
      }
      else record.dirty = true;
    }
  }

  constructor(options: PermissionManagerOptions) {
    this.mode = options.mode;
    this.cwd = options.cwd ?? process.cwd();
    this.allowRules = [...(options.allowRules ?? [])];
    this.denyRules = [...(options.denyRules ?? [])];
  }

  getMode(): PermissionMode {
    return this.mode;
  }

  setMode(mode: PermissionMode): void {
    if (this.mode === mode) return;
    this.recordPolicyMutation();
    this.mode = mode;
    this.advanceRevision();
  }

  getRevision(): number { return this.revision; }

  /** Host lifecycle hook: revoke already in-flight disclosures in the same turn. */
  onRevisionChanged(listener: (revision: number) => void): () => void {
    if (typeof listener !== 'function') throw new Error('invalid_permission_revision_listener');
    this.revisionListeners.add(listener);
    return () => { this.revisionListeners.delete(listener); };
  }

  private advanceRevision(): void {
    this.revision++;
    const failures: unknown[] = [];
    for (const listener of [...this.revisionListeners]) {
      try {
        const result: unknown = listener(this.revision);
        if (result !== undefined) {
          if (result && typeof (result as PromiseLike<unknown>).then === 'function') void Promise.resolve(result).catch(() => {});
          throw new Error('permission_revision_listener_must_be_synchronous');
        }
      } catch (error) { failures.push(error); }
    }
    if (failures.length) {
      for (const record of this.#pendingPrompts) record.dirty = true;
      throw new AggregateError(failures, 'permission_revision_listener_failed');
    }
  }

  addSessionRule(rule: string): void {
    const owner = this.claimPromptRule(rule);
    if (!this.allowRules.includes(rule)) {
      this.recordPolicyMutation(owner, rule);
      this.allowRules.push(rule);
      this.advanceRevision();
    }
  }

  addSessionDenyRule(rule: string): void {
    if (!this.denyRules.includes(rule)) {
      this.recordPolicyMutation();
      this.denyRules.push(rule);
      this.advanceRevision();
    }
  }

  static nextMode(mode: PermissionMode): PermissionMode {
    if (mode === 'default') return 'auto';
    if (mode === 'auto') return 'plan';
    return 'default';
  }

  async check(toolName: string, input: Record<string, unknown>): Promise<PermissionDecision> {
    const policy = new PermissionPolicyEngine({
      cwd: this.cwd,
      globalAllow: this.allowRules,
      globalDeny: this.denyRules,
      projectAllow: [],
      projectDeny: [],
      sessionAllow: [],
      sessionDeny: [],
    });
    const evaluation = await policy.evaluate(toolName, input);
    if (evaluation.action === 'deny') {
      return 'deny';
    }

    if (this.mode === 'plan' && ['write', 'edit', 'bash'].includes(toolName)) {
      return 'deny';
    }

    if (toolName === 'bash') {
      const risk = classifyBashCommand(readBashCommand(input));
      if (risk.level === 'block') {
        return 'deny';
      }
    }

    if (isSensitiveToolInvocation(toolName, input) && evaluation.action !== 'allow') {
      return 'deny';
    }

    if (isScreenAutomationFallbackInvocation(toolName, input)) {
      return 'deny';
    }

    if (this.mode === 'yolo') return 'allow';

    if (toolName === 'bash') {
      const command = readBashCommand(input);
      if (evaluation.action === 'allow' && this.allowRules.some(isExactCommandApprovalRule)) {
        const exact = getExactCommandApprovalRule(input, this.cwd);
        if (exact && this.allowRules.includes(exact)) return 'allow';
      }
      const conservative = this.mode !== 'auto' || hasMatchingCommandAllowRule(this.allowRules, command);
      if (conservative ? requiresCommandConfirmation(command) : requiresAlwaysCommandConfirmation(command)) return 'prompt';
      if (conservative) {
        const targets = getCommandWriteTargets(command);
        const hasWorkdir = Object.hasOwn(input, 'workdir');
        if (targets.length && hasWorkdir && typeof input.workdir !== 'string') return 'prompt';
        const api = /^[a-z]:|^\\\\|^\/\//i.test(this.cwd) ? win32 : posix;
        const effectiveDir = typeof input.workdir === 'string' ? api.resolve(this.cwd, input.workdir) : this.cwd;
        if (targets.length && hasWorkdir && isOutsideWorkspace(input.workdir as string, this.cwd)) return 'prompt';
        if (targets.some(target => isOutsideWorkspace(target, this.cwd, effectiveDir))) return 'prompt';
        if (targets.length && this.mode !== 'auto') return 'prompt';
      }
    }

    if (this.mode === 'auto') {
      if (toolName === 'bash') {
        const autoPromptRisk = requiresAutoPromptForBashCommand(readBashCommand(input));
        if (autoPromptRisk && evaluation.action !== 'allow') {
          return 'prompt';
        }
      }

      return 'allow';
    }

    if (['read', 'glob', 'grep', 'skill', 'tool_search', 'install_skill', 'uninstall_skill'].includes(toolName)) {
      return 'allow';
    }

    if (evaluation.action === 'allow') {
      return 'allow';
    }

    return 'prompt';
  }
}

/** Resolve lexical paths conservatively across POSIX, drive and UNC forms. */
function isOutsideWorkspace(target: string, cwd: string, effectiveDir = cwd): boolean {
  if (/^[~]|[$`]/.test(target)) return true;
  const windows = /^[a-z]:|^\\\\|^\/\//i;
  const api = windows.test(cwd) ? win32 : posix;
  if (windows.test(target) && api !== win32) return true;
  if (api === win32 && posix.isAbsolute(target) && !windows.test(target)) return true;
  const relative = api.relative(api.resolve(cwd), api.resolve(effectiveDir, target));
  return relative === '..' || relative.startsWith(`..${api.sep}`) || api.isAbsolute(relative);
}
