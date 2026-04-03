import { basename } from 'node:path';
import { describeToolActivity, formatRailHeader, formatRailLine, formatToolActivity } from './render.js';
import type { UiLocale } from './locale.js';

type ToolActivityFormatter = (
  toolName: string,
  input: Record<string, unknown>,
  maxWidth?: number,
  locale?: UiLocale,
) => string;

interface GroupedActivity {
  group: string;
  item: string;
}

interface DirectActivity {
  group: string;
  item: string;
}

function singleLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function summarizePath(input: Record<string, unknown>): string {
  const target = typeof input.file_path === 'string'
    ? input.file_path
    : typeof input.path === 'string'
      ? input.path
      : '';
  if (!target) return '';
  return basename(target) || target;
}

function describeGroupedActivity(toolName: string, input: Record<string, unknown>): GroupedActivity | null {
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
    return name ? { group: 'Explored', item: `Load ${name}` } : null;
  }

  if (toolName === 'web_fetch') {
    const url = typeof input.url === 'string' ? singleLine(input.url) : '';
    return url ? { group: 'Explored', item: `Fetch ${url}` } : null;
  }

  return null;
}

function stripKnownLabel(description: string, labels: string[]): string {
  for (const label of labels) {
    if (description.startsWith(label)) {
      return description.slice(label.length).trim();
    }
  }
  return description.trim();
}

function describeDirectActivity(toolName: string, input: Record<string, unknown>): DirectActivity | null {
  if (toolName === 'bash') {
    const description = describeToolActivity(toolName, input, 'zh-CN');
    const item = stripKnownLabel(description, ['执行命令', 'Run command']);
    return item ? { group: 'Ran', item } : null;
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
  private activeGroup: string | null = null;

  constructor(
    private readonly formatActivity: ToolActivityFormatter = formatToolActivity,
  ) {}

  record(name: string, input: Record<string, unknown>): string {
    const grouped = describeGroupedActivity(name, input);
    if (grouped) {
      const lines: string[] = [];
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
      const lines: string[] = [];
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

  reset(): void {
    this.activeGroup = null;
  }
}
