export class PermissionManager {
    mode;
    allowRules;
    denyRules;
    constructor(options) {
        this.mode = options.mode;
        this.allowRules = options.allowRules ?? [];
        this.denyRules = options.denyRules ?? [];
    }
    getMode() {
        return this.mode;
    }
    setMode(mode) {
        this.mode = mode;
    }
    async check(toolName, input) {
        if (this.matches(this.denyRules, toolName, input)) {
            return 'deny';
        }
        if (this.mode === 'plan' && ['write', 'edit', 'bash'].includes(toolName)) {
            return 'deny';
        }
        if (this.mode === 'auto') {
            return 'allow';
        }
        if (['read', 'glob', 'grep', 'skill', 'tool_search'].includes(toolName)) {
            return 'allow';
        }
        if (this.matches(this.allowRules, toolName, input)) {
            return 'allow';
        }
        return 'prompt';
    }
    matches(rules, toolName, input) {
        return rules.some((rule) => {
            const [ruleTool, pattern = '*'] = rule.includes(':') ? rule.split(':', 2) : [toolName, rule];
            if (ruleTool !== toolName) {
                return false;
            }
            const target = this.getRuleTarget(input);
            const regex = new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
            return regex.test(target);
        });
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
