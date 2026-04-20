import { basename } from 'node:path';
import { describeToolActivity, formatRailHeader, formatRailLine, formatToolActivity } from './render.js';
function singleLine(text) {
    return text.replace(/\s+/g, ' ').trim();
}
function summarizePath(input) {
    const target = typeof input.file_path === 'string'
        ? input.file_path
        : typeof input.path === 'string'
            ? input.path
            : '';
    if (!target)
        return '';
    return basename(target) || target;
}
function describeGroupedActivity(toolName, input) {
    if (toolName === 'tool_search') {
        const query = typeof input.query === 'string' ? singleLine(input.query) : '';
        return query ? { group: 'Explored', item: `Search ${query}` } : null;
    }
    if (toolName === 'grep' || toolName === 'glob' || toolName === 'web_search') {
        const query = typeof input.pattern === 'string'
            ? singleLine(input.pattern)
            : typeof input.query === 'string'
                ? singleLine(input.query)
                : '';
        return query ? { group: 'Explored', item: `Search ${query}` } : null;
    }
    if (toolName === 'read') {
        const file = summarizePath(input);
        return file ? { group: 'Explored', item: `Read ${file}` } : null;
    }
    if (toolName === 'skill') {
        const name = typeof input.name === 'string'
            ? singleLine(input.name)
            : typeof input.path === 'string'
                ? summarizePath(input)
                : '';
        if (name === 'using-superpowers') {
            return null;
        }
        return name ? { group: 'Explored', item: `Load ${name}` } : null;
    }
    if (toolName === 'web_fetch') {
        const url = typeof input.url === 'string' ? singleLine(input.url) : '';
        return url ? { group: 'Explored', item: `Fetch ${url}` } : null;
    }
    return null;
}
function stripKnownLabel(description, labels) {
    for (const label of labels) {
        if (description.startsWith(label)) {
            return description.slice(label.length).trim();
        }
    }
    return description.trim();
}
function describeDirectActivity(toolName, input) {
    if (toolName === 'bash') {
        const description = describeToolActivity(toolName, input, 'zh-CN');
        const item = stripKnownLabel(description, ['执行命令', 'Run command']);
        if (item && item !== '执行本地命令' && item !== 'Run local command') {
            return { group: 'Ran', item };
        }
        const command = typeof input.command === 'string' ? singleLine(input.command) : '';
        return command ? { group: 'Ran', item: command } : (item ? { group: 'Ran', item } : null);
    }
    if (toolName === 'write') {
        const file = summarizePath(input);
        return file ? { group: 'Changed', item: `Wrote ${file}` } : null;
    }
    if (toolName === 'edit') {
        const file = summarizePath(input);
        return file ? { group: 'Changed', item: `Edited ${file}` } : null;
    }
    if (toolName === 'install_skill') {
        const target = summarizePath(input)
            || (typeof input.source === 'string' ? singleLine(input.source) : '');
        return target ? { group: 'Skills', item: `Installed ${target}` } : null;
    }
    if (toolName === 'uninstall_skill') {
        const target = summarizePath(input)
            || (typeof input.name === 'string' ? singleLine(input.name) : '');
        return target ? { group: 'Skills', item: `Removed ${target}` } : null;
    }
    return null;
}
export class ToolExplorer {
    formatActivity;
    activeGroup = null;
    constructor(formatActivity = formatToolActivity) {
        this.formatActivity = formatActivity;
    }
    record(name, input) {
        const grouped = describeGroupedActivity(name, input);
        if (grouped) {
            const lines = [];
            if (this.activeGroup && this.activeGroup !== grouped.group) {
                lines.push('\n');
            }
            if (this.activeGroup !== grouped.group) {
                lines.push(`${formatRailHeader(grouped.group)}\n`);
            }
            lines.push(`${formatRailLine(grouped.item)}\n`);
            this.activeGroup = grouped.group;
            return lines.join('');
        }
        const direct = describeDirectActivity(name, input);
        if (direct) {
            const lines = [];
            if (this.activeGroup && this.activeGroup !== direct.group) {
                lines.push('\n');
            }
            if (this.activeGroup !== direct.group) {
                lines.push(`${formatRailHeader(direct.group)}\n`);
            }
            lines.push(`${formatRailLine(direct.item)}\n`);
            this.activeGroup = direct.group;
            return lines.join('');
        }
        this.activeGroup = null;
        const fallback = this.formatActivity(name, input);
        return fallback ? `${fallback}\n` : '';
    }
    reset() {
        this.activeGroup = null;
    }
}
