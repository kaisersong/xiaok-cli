import { PermissionPolicyEngine, matches } from './policy-engine.js';
import { isScreenAutomationFallbackInvocation, isSensitiveToolInvocation } from './sensitive-paths.js';
import { classifyBashCommand, requiresAutoPromptForBashCommand } from '../tools/bash-safety.js';
function readBashCommand(input) {
    return typeof input.command === 'string' ? input.command : '';
}
export class PermissionManager {
    mode;
    allowRules;
    denyRules;
    revision = 0;
    revisionListeners = new Set();
    constructor(options) {
        this.mode = options.mode;
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
    matches(rules, toolName, input) {
        return matches(rules, toolName, input);
    }
    buildRuleRegex(pattern) {
        if (pattern.endsWith(' *')) {
            const prefix = pattern.slice(0, -2);
            return new RegExp(`^${prefix.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[\\s\\S]*')}(?: [\\s\\S]*)?$`);
        }
        return new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[\\s\\S]*')}$`);
    }
    getRuleTarget(input) {
        if (typeof input.command === 'string') {
            return input.command;
        }
        if (typeof input.file_path === 'string') {
            return input.file_path;
        }
        if (typeof input.path === 'string') {
            return input.path;
        }
        return '';
    }
}
