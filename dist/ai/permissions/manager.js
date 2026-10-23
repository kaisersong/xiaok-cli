import { posix, win32 } from 'node:path';
import { PermissionPolicyEngine, requiresCommandConfirmation, getCommandWriteTargets, hasMatchingCommandAllowRule, requiresAlwaysCommandConfirmation, getExactCommandApprovalRule, isExactCommandApprovalRule } from './policy-engine.js';
import { isScreenAutomationFallbackInvocation, isSensitiveToolInvocation } from './sensitive-paths.js';
import { classifyBashCommand, requiresAutoPromptForBashCommand } from '../tools/bash-safety.js';
function readBashCommand(input) {
    return typeof input.command === 'string' ? input.command : '';
}
export class PermissionManager {
    mode;
    cwd;
    allowRules;
    denyRules;
    revision = 0;
    revisionListeners = new Set();
    constructor(options) {
        this.mode = options.mode;
        this.cwd = options.cwd ?? process.cwd();
        this.allowRules = [...(options.allowRules ?? [])];
        this.denyRules = [...(options.denyRules ?? [])];
    }
    getMode() {
        return this.mode;
    }
    setMode(mode) {
        if (this.mode === mode)
            return;
        this.mode = mode;
        this.advanceRevision();
    }
    getRevision() { return this.revision; }
    /** Host lifecycle hook: revoke already in-flight disclosures in the same turn. */
    onRevisionChanged(listener) {
        if (typeof listener !== 'function')
            throw new Error('invalid_permission_revision_listener');
        this.revisionListeners.add(listener);
        return () => { this.revisionListeners.delete(listener); };
    }
    advanceRevision() {
        this.revision++;
        const failures = [];
        for (const listener of [...this.revisionListeners]) {
            try {
                const result = listener(this.revision);
                if (result !== undefined) {
                    if (result && typeof result.then === 'function')
                        void Promise.resolve(result).catch(() => { });
                    throw new Error('permission_revision_listener_must_be_synchronous');
                }
            }
            catch (error) {
                failures.push(error);
            }
        }
        if (failures.length)
            throw new AggregateError(failures, 'permission_revision_listener_failed');
    }
    addSessionRule(rule) {
        if (!this.allowRules.includes(rule)) {
            this.allowRules.push(rule);
            this.advanceRevision();
        }
    }
    addSessionDenyRule(rule) {
        if (!this.denyRules.includes(rule)) {
            this.denyRules.push(rule);
            this.advanceRevision();
        }
    }
    static nextMode(mode) {
        if (mode === 'default')
            return 'auto';
        if (mode === 'auto')
            return 'plan';
        return 'default';
    }
    async check(toolName, input) {
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
        if (this.mode === 'yolo')
            return 'allow';
        if (toolName === 'bash') {
            const command = readBashCommand(input);
            if (evaluation.action === 'allow' && this.allowRules.some(isExactCommandApprovalRule)) {
                const exact = getExactCommandApprovalRule(input, this.cwd);
                if (exact && this.allowRules.includes(exact))
                    return 'allow';
            }
            const conservative = this.mode !== 'auto' || hasMatchingCommandAllowRule(this.allowRules, command);
            if (conservative ? requiresCommandConfirmation(command) : requiresAlwaysCommandConfirmation(command))
                return 'prompt';
            if (conservative) {
                const targets = getCommandWriteTargets(command);
                const hasWorkdir = Object.hasOwn(input, 'workdir');
                if (targets.length && hasWorkdir && typeof input.workdir !== 'string')
                    return 'prompt';
                const api = /^[a-z]:|^\\\\|^\/\//i.test(this.cwd) ? win32 : posix;
                const effectiveDir = typeof input.workdir === 'string' ? api.resolve(this.cwd, input.workdir) : this.cwd;
                if (targets.length && hasWorkdir && isOutsideWorkspace(input.workdir, this.cwd))
                    return 'prompt';
                if (targets.some(target => isOutsideWorkspace(target, this.cwd, effectiveDir)))
                    return 'prompt';
                if (targets.length && this.mode !== 'auto')
                    return 'prompt';
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
function isOutsideWorkspace(target, cwd, effectiveDir = cwd) {
    if (/^[~]|[$`]/.test(target))
        return true;
    const windows = /^[a-z]:|^\\\\|^\/\//i;
    const api = windows.test(cwd) ? win32 : posix;
    if (windows.test(target) && api !== win32)
        return true;
    if (api === win32 && posix.isAbsolute(target) && !windows.test(target))
        return true;
    const relative = api.relative(api.resolve(cwd), api.resolve(effectiveDir, target));
    return relative === '..' || relative.startsWith(`..${api.sep}`) || api.isAbsolute(relative);
}
