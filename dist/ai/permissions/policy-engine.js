export class PermissionPolicyEngine {
    snapshot;
    constructor(snapshot) {
        this.snapshot = snapshot;
    }
    async evaluate(toolName, input) {
        const target = getRuleTarget(input);
        const rule = target ? `${toolName}:${target}` : toolName;
        const denyRules = [
            ...this.snapshot.globalDeny,
            ...this.snapshot.projectDeny,
            ...this.snapshot.sessionDeny,
        ];
        const allowRules = [
            ...this.snapshot.globalAllow,
            ...this.snapshot.projectAllow,
            ...this.snapshot.sessionAllow,
        ];
        if (matches(denyRules, toolName, input)) {
            return { action: 'deny', rule };
        }
        if (matches(allowRules, toolName, input)) {
            return { action: 'allow', rule };
        }
        return { action: 'prompt', rule };
    }
}
export function matches(rules, toolName, input) {
    return rules.some((rule) => {
        const parenMatch = rule.match(/^([a-z_]+)\((.*)\)$/i);
        const [ruleTool, pattern = '*'] = rule.includes(':')
            ? rule.split(':', 2)
            : parenMatch
                ? [parenMatch[1], parenMatch[2]]
                : [toolName, rule];
        if (ruleTool !== toolName) {
            return false;
        }
        const target = getRuleTarget(input);
        const regex = buildRuleRegex(pattern);
        return regex.test(target);
    });
}
export function buildRuleRegex(pattern) {
    if (pattern.endsWith(' *')) {
        const prefix = pattern.slice(0, -2);
        return new RegExp(`^${prefix.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}(?: .*)?$`);
    }
    return new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
}
export function getRuleTarget(input) {
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
