import { posix, win32 } from 'node:path';
export interface PermissionPolicySnapshot {
  globalAllow: string[];
  globalDeny: string[];
  projectAllow: string[];
  projectDeny: string[];
  sessionAllow: string[];
  sessionDeny: string[];
}

export interface PermissionPolicyDecision {
  action: 'allow' | 'deny' | 'prompt';
  rule: string;
}

export class PermissionPolicyEngine {
  constructor(private readonly snapshot: PermissionPolicySnapshot) {}

  async evaluate(toolName: string, input: Record<string, unknown>): Promise<PermissionPolicyDecision> {
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

    if (matches(denyRules, toolName, input, 'deny')) {
      return { action: 'deny', rule };
    }
    if (matches(allowRules, toolName, input)) {
      return { action: 'allow', rule };
    }
    return { action: 'prompt', rule };
  }
}

export function matches(rules: string[], toolName: string, input: Record<string, unknown>, intent: 'allow' | 'deny' = 'allow'): boolean {
  if (toolName === 'bash') {
    const command = getRuleTarget(input);
    const parsed = parseCommandSegments(command);
    const matchSegment = (segment: string) => matchesTarget(rules, toolName, { command: segment });
    if (intent === 'deny') return denyCommandSegments(command).some(matchSegment);
    return parsed.valid && !requiresCommandConfirmation(command) && parsed.segments.length > 0 && parsed.segments.every(matchSegment);
  }
  return matchesTarget(rules, toolName, input);
}

function matchesTarget(rules: string[], toolName: string, input: Record<string, unknown>): boolean {
  return rules.some((rule) => {
    const parenMatch = rule.match(/^([a-z_]+)\((.*)\)$/i);
    const colonMatch = parenMatch ? null : rule.match(/^([a-z_]+):(.*)$/i);
    const [ruleTool, pattern = '*'] = colonMatch
      ? [colonMatch[1], colonMatch[2]]
      : parenMatch
        ? [parenMatch[1], parenMatch[2]]
        : [toolName, rule];
    if (ruleTool !== toolName) {
      return false;
    }

    const rawTarget = getRuleTarget(input);
    const [normalizedPattern, target] = usesPathTarget(input)
      ? [normalizePathSeparators(pattern), normalizePathSeparators(rawTarget)]
      : [pattern, rawTarget];
    const regex = buildRuleRegex(normalizedPattern);
    return regex.test(target);
  });
}

function usesPathTarget(input: Record<string, unknown>): boolean {
  return typeof input.file_path === 'string' || typeof input.path === 'string';
}

function normalizePathSeparators(value: string): string {
  const portable = value.replace(/\\/g, '/');
  if (/^[a-z]:/i.test(value) || value.startsWith('\\\\')) return win32.normalize(value).replace(/\\/g, '/').toLowerCase();
  return posix.normalize(portable);
}

export function buildRuleRegex(pattern: string): RegExp {
  if (pattern.endsWith(' *')) {
    const prefix = pattern.slice(0, -2);
    return new RegExp(`^${prefix.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[\\s\\S]*')}(?: [\\s\\S]*)?$`);
  }

  return new RegExp(
    `^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[\\s\\S]*')}$`,
  );
}

export function getRuleTarget(input: Record<string, unknown>): string {
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

/** A conservative scanner, not a shell interpreter. Unsupported grammar requires confirmation. */
export function parseCommandSegments(command: string): { segments: string[]; valid: boolean } {
  command = command.replace(/\\\n/g, '');
  const segments: string[] = [];
  let valid = true;
  let index = 0;
  function scan(end?: string, depth = 0): void {
    if (depth > 64) { valid = false; index = command.length; return; }
    let text = '';
    let quote = '';
    let needsCommand = false;
    const flush = () => { if (text.trim()) segments.push(text.trim()); text = ''; };
    while (index < command.length) {
      const ch = command[index];
      if (ch === "'" && quote !== '"') { quote = quote ? '' : "'"; text += ch; index++; continue; }
      if (quote === "'") { text += ch; index++; continue; }
      if (ch === '\\') {
        if (index + 1 >= command.length) { valid = false; text += ch; index++; continue; }
        text += command.slice(index, index + 2); index += 2; continue;
      }
      if (!quote && end && ch === end) { if (needsCommand && !text.trim()) valid = false; flush(); index++; return; }
      if (ch === '"') { quote = quote ? '' : '"'; text += ch; index++; continue; }
      const substitution = command.startsWith('$(', index) || (!quote && /[<>]/.test(ch) && command[index + 1] === '(');
      if (substitution || ch === '`') {
        const start = index;
        index += substitution ? 2 : 1;
        scan(substitution ? ')' : '`', depth + 1);
        text += command.slice(start, index);
        continue;
      }
      if (!quote) {
        const redirect = command.slice(index).match(/^(?:&>>?|[<>]&[0-9-]+)/);
        if (redirect) { text += redirect[0]; index += redirect[0].length; continue; }
      }
      if (!quote && /[;&|\n]/.test(ch)) {
        if (!text.trim() && ch !== '\n') valid = false;
        needsCommand = ch === '|' || (ch === '&' && command[index + 1] === '&');
        flush();
        if ((command[index + 1] === ch && ch !== '\n') || (ch === '|' && command[index + 1] === '&')) index++;
        index++; continue;
      }
      // Grouping, arithmetic, heredocs and shell control grammar need a real shell parser.
      if (!quote && (/[()]/.test(ch) || (/^[{}]$/.test(ch) && !text.trim() && /^(?:\s|$)/.test(command[index + 1] ?? '')) || command.startsWith('<<', index) || (ch === '#' && (!text || /\s$/.test(text))))) valid = false;
      text += ch; index++;
    }
    if (needsCommand && !text.trim()) valid = false;
    flush();
    if (quote || end) valid = false;
  }
  scan();
  if (segments.some(segment => /^(?:if|then|else|fi|for|while|do|done|case|esac|function)\b/.test(segment))) valid = false;
  return { segments, valid };
}

/** Inspect literal wrapper payloads conservatively; no shell execution occurs here. */
function denyCommandSegments(command: string, depth = 0): string[] {
  const normalized = command.replace(/\\\n/g, '');
  const segments = parseCommandSegments(normalized).segments;
  const candidates = [command, normalized, ...segments, ...segments.map(segment => segment.replace(/^\{\s+/, ''))];
  if (depth >= 32) return candidates;
  for (const segment of segments) {
    const wrapper = /(?:^|\s)(?:(?:\S*\/)?(?:sh|bash|zsh|dash|ksh)\s+-[a-z]*c\s+|eval\s+)/;
    const start = wrapper.exec(segment);
    if (!start) continue;
    const argumentsText = segment.slice(start.index + start[0].length);
    for (const match of argumentsText.matchAll(/(["'])([\s\S]*?)\1/g)) {
      candidates.push(...denyCommandSegments(match[2], depth + 1));
    }
  }
  return candidates;
}

export function requiresCommandConfirmation(command: string): boolean {
  // Literal quoting and escaped flag characters retain conservative review requirements.
  const literal = command.replace(/\\\n/g, '').replace(/['"]/g, '').replace(/\\([^\n])/g, '$1');
  const forcedPush = /\bgit\s+(?:(?:-C|-c|--git-dir|--work-tree)\s+\S+\s+|--[\w-]+=[^\s]+\s+|--[\w-]+\s+|-[a-zA-Z]+\s+)*push\b[^;|&\n]*\s(?:--force(?:-with-lease)?(?:=\S*)?|-([a-z]*f[a-z]*)|\+\S+)(?:\s|$)/;
  const recursiveDelete = /\brm\s+[^;&|\n]*/g;
  const deletion = [...literal.matchAll(recursiveDelete)].some(([text]) => {
    const flags = text.split(/\s+/).slice(1);
    return flags.some(flag => flag === '--recursive' || /^-[a-z]*r[a-z]*$/i.test(flag))
      && flags.some(flag => flag === '--force' || /^-[a-z]*f[a-z]*$/i.test(flag));
  });
  // Two-step download-to-file then execution is outside this list; every segment still needs approval.
  const downloadedShell = /\b(?:curl|wget)\b[^\n;]*\|&?\s*(?:(?:sudo|env|command|exec)\s+|[A-Za-z_][\w]*=\S+\s+)*(?:\S*\/)?(?:sh|bash|zsh|dash|ksh)\b/;
  return forcedPush.test(literal) || deletion || downloadedShell.test(literal);
}
