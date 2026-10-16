import { classifyBashCommand } from '../tools/bash-safety.js';
import { posix, win32 } from 'node:path';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolveRealPath } from './workspace.js';
import { isSensitivePath } from './sensitive-paths.js';
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
        if (matches(denyRules, toolName, input, 'deny', this.snapshot.cwd)) {
            return { action: 'deny', rule };
        }
        if (matches(allowRules, toolName, input, 'allow', this.snapshot.cwd)) {
            return { action: 'allow', rule };
        }
        return { action: 'prompt', rule };
    }
}
export function matches(rules, toolName, input, intent = 'allow', cwd = process.cwd()) {
    if (toolName === 'bash') {
        const exact = rules.some(isExactCommandApprovalRule) ? commandFingerprint(input, cwd) : null;
        if (exact && rules.includes(exact))
            return intent === 'deny' || getExactCommandApprovalRule(input, cwd) === exact;
        const command = getRuleTarget(input);
        const parsed = parseCommandSegments(command);
        const matchSegment = (segment) => matchesTarget(rules, toolName, { command: segment });
        if (intent === 'deny')
            return denyCommandSegments(command).some(matchSegment);
        return parsed.valid && classifyBashCommand(command).level === 'safe' && !requiresCommandConfirmation(command) && getCommandWriteTargets(command).length === 0 && parsed.segments.length > 0 && parsed.segments.every(matchSegment);
    }
    return matchesTarget(rules, toolName, input);
}
export function isExactCommandApprovalRule(rule) {
    return /^bash\(@exact:[a-f0-9]{64}\)$/.test(rule);
}
function commandFingerprint(input, cwd) {
    if (typeof input.command !== 'string' || !input.command.trim())
        return null;
    if (Object.hasOwn(input, 'workdir') && (typeof input.workdir !== 'string' || !input.workdir))
        return null;
    try {
        const directory = resolveRealPath(resolve(cwd, typeof input.workdir === 'string' ? input.workdir : '.'));
        return `bash(@exact:${createHash('sha256').update(JSON.stringify([input.command, directory])).digest('hex')})`;
    }
    catch {
        return null;
    }
}
/** Inspect the surrounding shell without interpreting a quoted script body. */
function exactApprovalShell(command) {
    if (!command.includes('<<') || parseCommandSegments(command).valid)
        return { text: command, script: false };
    const lines = command.split('\n');
    let marker = null;
    let markerIndex = -1;
    let quote = '';
    for (let index = 0; index < lines[0].length;) {
        const literal = scanShellLiteral(lines[0], index, quote);
        if (literal) {
            quote = literal.quote;
            index = literal.end;
            continue;
        }
        if (!quote && lines[0].startsWith('<<', index)) {
            if (marker)
                return null;
            marker = lines[0].slice(index).match(/^<<(['"])([A-Za-z_]\w*)\1/);
            if (!marker)
                return null;
            markerIndex = index;
            index += marker[0].length;
            continue;
        }
        index++;
    }
    if (!marker)
        return null;
    const end = lines.findIndex((line, index) => index > 0 && line.replace(/\r$/, '') === marker[2]);
    if (end < 1)
        return null;
    const header = lines[0].slice(0, markerIndex) + '< /dev/null' + lines[0].slice(markerIndex + marker[0].length);
    const parsed = parseCommandSegments(header);
    const last = shellWords(parsed.segments.at(-1) ?? '');
    if (!parsed.valid || !/^(?:python[23]?|node|ruby|perl)$/.test(posix.basename(last[0] ?? '')) || last[1] !== '-')
        return null;
    return { text: [header, ...lines.slice(end + 1)].join('\n'), script: true };
}
function withinPath(path, root) {
    const child = relative(root, path);
    return child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}
/** An explicit full-command grant; never inferred from a prefix/wildcard rule. */
export function getExactCommandApprovalRule(input, cwd = process.cwd()) {
    const fingerprint = commandFingerprint(input, cwd);
    const command = input.command;
    if (!fingerprint || typeof command !== 'string' || command.length > 65536
        || classifyBashCommand(command).level !== 'safe' || requiresAlwaysCommandConfirmation(command))
        return null;
    const shell = exactApprovalShell(command);
    if (!shell || !parseCommandSegments(shell.text).valid || requiresCommandConfirmation(shell.text))
        return null;
    const targets = getCommandWriteTargets(shell.text);
    if (!shell.script && targets.length === 0)
        return null;
    try {
        const workspace = resolveRealPath(resolve(cwd));
        const temporary = resolveRealPath(tmpdir());
        const roots = [workspace, temporary];
        if (process.platform !== 'win32')
            roots.push(resolveRealPath('/tmp'));
        let directory = resolveRealPath(resolve(cwd, typeof input.workdir === 'string' ? input.workdir : '.'));
        const safePath = (target) => {
            if (!target || /^[~]|[$`*?\[\]{}]/.test(target))
                return false;
            const lexical = resolve(directory, target);
            const actual = resolveRealPath(lexical);
            if (isSensitivePath(lexical) || isSensitivePath(actual))
                return false;
            if (withinPath(lexical, workspace) && !withinPath(actual, workspace))
                return false;
            return roots.some(root => withinPath(actual, root));
        };
        if (!roots.some(root => withinPath(directory, root)))
            return null;
        for (const segment of parseCommandSegments(shell.text).segments) {
            let remaining = segment.trimStart();
            while (remaining) {
                const word = nextShellWord(remaining);
                if (word.hasExpansion)
                    return null;
                remaining = remaining.slice(word.end).trimStart();
            }
            const words = shellWords(segment);
            if (words.some((word, index) => /^(?:sh|bash|zsh|dash|ksh)$/.test(posix.basename(word)) && shellPayloadIndex(words, index) >= 0)
                || words.some(word => /^(?:eval|pushd|popd)$/.test(word))
                || (words[0] === 'env' && words.some(word => /^(?:-C|--chdir)(?:=|$)/.test(word))))
                return null;
            if (words[0] === 'cd') {
                const args = words.slice(1).filter(word => word !== '--');
                if (args.length !== 1 || args[0] === '-' || !safePath(args[0]))
                    return null;
                directory = resolveRealPath(resolve(directory, args[0]));
            }
            if (getCommandWriteTargets(segment).some(target => !safePath(target)))
                return null;
        }
        return fingerprint;
    }
    catch {
        return null;
    }
}
/** Whether an allow pattern participates, before conservative safety rejection. */
export function hasMatchingCommandAllowRule(rules, command) {
    return denyCommandSegments(command, 0, false).some(segment => matchesTarget(rules, 'bash', { command: segment }));
}
function matchesTarget(rules, toolName, input) {
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
function usesPathTarget(input) {
    return typeof input.file_path === 'string' || typeof input.path === 'string';
}
function normalizePathSeparators(value) {
    const portable = value.replace(/\\/g, '/');
    if (/^[a-z]:/i.test(value) || value.startsWith('\\\\'))
        return win32.normalize(value).replace(/\\/g, '/').toLowerCase();
    return posix.normalize(portable);
}
export function buildRuleRegex(pattern) {
    if (pattern.endsWith(' *')) {
        const prefix = pattern.slice(0, -2);
        return new RegExp(`^${prefix.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[\\s\\S]*')}(?: [\\s\\S]*)?$`);
    }
    return new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[\\s\\S]*')}$`);
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
/** Shared literal quote and escape transitions for segment and word scanning. */
function scanShellLiteral(text, index, quote) {
    const ch = text[index];
    if (ch === "'" && quote !== '"')
        return { end: index + 1, quote: quote ? '' : "'", value: '', valid: true };
    if (quote === "'")
        return { end: index + 1, quote, value: ch, valid: true };
    if (ch === '\\') {
        const next = text[index + 1];
        if (next === undefined)
            return { end: index + 1, quote, value: ch, valid: false };
        if (quote === '"' && !/[$`"\\\n]/.test(next))
            return { end: index + 1, quote, value: ch, valid: true };
        return { end: index + 2, quote, value: next === '\n' ? '' : next, valid: true };
    }
    if (ch === '"')
        return { end: index + 1, quote: quote ? '' : '"', value: '', valid: true };
    return undefined;
}
function nextShellWord(text, stopAtOperator = false) {
    let index = 0;
    let quote = '';
    let value = '';
    let hasExpansion = false;
    let hasWildcard = false;
    let unquoted = '';
    while (index < text.length) {
        if (!quote && (/\s/.test(text[index]) || (stopAtOperator && /[<>&|;]/.test(text[index]))))
            break;
        const literal = scanShellLiteral(text, index, quote);
        if (literal) {
            value += literal.value;
            quote = literal.quote;
            index = literal.end;
        }
        else {
            hasExpansion ||= /[$`]/.test(text[index]);
            hasWildcard ||= /[*?\[]/.test(text[index]);
            if (!quote)
                unquoted += text[index];
            value += text[index++];
        }
    }
    hasExpansion ||= /\{[^{}]*(?:,|\.\.)[^{}]*\}/.test(unquoted);
    if (value === '[' || value === '[[')
        hasWildcard = false;
    return { value, end: index, hasExpansion, hasWildcard };
}
function segmentRequiresExpansionConfirmation(segment) {
    let remaining = segment.trimStart();
    let commandWord;
    let hasExpansion = false;
    while (remaining) {
        const word = nextShellWord(remaining);
        hasExpansion ||= word.hasExpansion;
        if (!commandWord && !/^[A-Za-z_][\w]*=/.test(word.value))
            commandWord = word;
        remaining = remaining.slice(word.end).trimStart();
    }
    if (!commandWord)
        return false;
    if (commandWord.hasExpansion || commandWord.hasWildcard)
        return true;
    return hasExpansion && /^(?:git|rm|curl|wget|sh|bash|zsh|dash|ksh|eval|env|sudo|command|exec|xargs)$/.test(posix.basename(commandWord.value));
}
function shellPayloadIndex(words, shellIndex) {
    for (let index = shellIndex + 1; index < words.length; index++) {
        const option = words[index];
        if (option === '-O' || option === '-o') {
            index++;
            continue;
        }
        if (/^-[a-zA-Z]*c[a-zA-Z]*$/.test(option))
            return index + 1;
        if (option === '--' || !option.startsWith('-') || option === '-')
            break;
    }
    return -1;
}
/** A conservative scanner, not a shell interpreter. Unsupported grammar requires confirmation. */
export function parseCommandSegments(command) {
    const { segments, valid } = scanCommandSegments(command);
    return { segments, valid };
}
function scanCommandSegments(command) {
    command = command.replace(/\\\n/g, '');
    const segments = [];
    const pipes = new Set();
    let valid = true;
    let index = 0;
    function scan(end, depth = 0) {
        if (depth > 64) {
            valid = false;
            index = command.length;
            return;
        }
        let text = '';
        let quote = '';
        let needsCommand = false;
        const flush = () => { if (text.trim())
            segments.push(text.trim()); text = ''; };
        while (index < command.length) {
            const ch = command[index];
            const literal = scanShellLiteral(command, index, quote);
            if (literal) {
                text += command.slice(index, literal.end);
                quote = literal.quote;
                valid &&= literal.valid;
                index = literal.end;
                continue;
            }
            if (!quote && end && ch === end) {
                if (needsCommand && !text.trim())
                    valid = false;
                flush();
                index++;
                return;
            }
            if (!quote && (ch === '(' || (ch === '{' && !text.trim() && /\s/.test(command[index + 1] ?? '')))) {
                valid = false;
                flush();
                index++;
                scan(ch === '(' ? ')' : '}', depth + 1);
                continue;
            }
            const substitution = command.startsWith('$(', index) || (!quote && /[<>]/.test(ch) && command[index + 1] === '(');
            if (substitution || ch === '`') {
                const start = index;
                index += substitution ? 2 : 1;
                scan(substitution ? ')' : '`', depth + 1);
                text += command.slice(start, index);
                continue;
            }
            if (!quote) {
                const redirect = command.slice(index).match(/^(?:&>>?|>\||[<>]&[0-9-]+)/);
                if (redirect) {
                    text += redirect[0];
                    index += redirect[0].length;
                    continue;
                }
            }
            if (!quote && /[;&|\n]/.test(ch)) {
                if (!text.trim() && ch !== '\n')
                    valid = false;
                needsCommand = ch === '|' || (ch === '&' && command[index + 1] === '&');
                flush();
                if (ch === '|' && command[index + 1] !== '|')
                    pipes.add(segments.length - 1);
                if ((command[index + 1] === ch && ch !== '\n') || (ch === '|' && command[index + 1] === '&'))
                    index++;
                index++;
                continue;
            }
            // Grouping, arithmetic, heredocs and shell control grammar need a real shell parser.
            if (!quote && (/[()]/.test(ch) || (/^[{}]$/.test(ch) && !text.trim() && /^(?:\s|$)/.test(command[index + 1] ?? '')) || command.startsWith('<<', index) || (ch === '#' && (!text || /\s$/.test(text)))))
                valid = false;
            text += ch;
            index++;
        }
        if (needsCommand && !text.trim())
            valid = false;
        flush();
        if (quote || end)
            valid = false;
    }
    scan();
    if (segments.some(segment => /^(?:if|then|else|fi|for|while|do|done|case|esac|function)\b/.test(segment)))
        valid = false;
    return { segments, valid, pipes };
}
/** Inspect literal wrapper payloads conservatively; no shell execution occurs here. */
// Bound recursive wrapper fan-out, independently of command length or word count.
const SCAN_LIMIT = 2000;
const BUDGET_EXCEEDED = '$inspection-budget-exceeded';
function spend(budget) {
    budget.remaining -= 1;
    if (budget.remaining < 0)
        budget.exceeded = true;
    return !budget.exceeded;
}
export function exceedsCommandInspectionBudget(command) {
    const budget = { remaining: SCAN_LIMIT, exceeded: false };
    denyCommandSegments(command, 0, true, budget);
    return budget.exceeded;
}
function denyCommandSegments(command, depth = 0, uncertainWrappers = true, budget = { remaining: SCAN_LIMIT, exceeded: false }) {
    if (!spend(budget))
        return [BUDGET_EXCEEDED];
    const normalized = command.replace(/\\\n/g, '');
    const segments = parseCommandSegments(normalized).segments;
    const candidates = [command, normalized, ...segments, ...segments.map(segment => segment.replace(/^\{\s+/, ''))];
    if (depth >= 32) {
        budget.exceeded = true;
        return [...candidates, BUDGET_EXCEEDED];
    }
    for (const segment of segments) {
        if (budget.exceeded)
            break;
        const payload = prefixWrapperPayload(segment);
        if (payload !== undefined && payload)
            candidates.push(...denyCommandSegments(payload, depth + 1, uncertainWrappers, budget));
        if (payload === '' && uncertainWrappers) {
            // An uncertain option can hide the executable at any subsequent word.
            // Keep raw tails so quoting is preserved; do not use these for allow matching.
            let remaining = segment.trimStart();
            let word = nextShellWord(remaining);
            while (/^[A-Za-z_][\w]*=/.test(word.value)) {
                remaining = remaining.slice(word.end).trimStart();
                word = nextShellWord(remaining);
            }
            remaining = remaining.slice(word.end).trimStart(); // Skip the wrapper name.
            while (remaining && !budget.exceeded) {
                candidates.push(...denyCommandSegments(remaining, depth + 1, uncertainWrappers, budget));
                remaining = remaining.slice(nextShellWord(remaining).end).trimStart();
            }
        }
        const wrapper = /(?:^|\s)(?:(?:\S*\/)?(?:sh|bash|zsh|dash|ksh)\s+-[a-z]*c\s+|eval\s+)/;
        const start = wrapper.exec(segment);
        if (!start)
            continue;
        const argumentsText = segment.slice(start.index + start[0].length);
        candidates.push(...denyCommandSegments(argumentsText, depth + 1, uncertainWrappers, budget));
        let remaining = argumentsText;
        const words = [];
        while (remaining.trim()) {
            remaining = remaining.trimStart();
            const word = nextShellWord(remaining);
            words.push(word.value);
            if (word.value !== remaining.slice(0, word.end)) {
                candidates.push(...denyCommandSegments(word.value, depth + 1, uncertainWrappers, budget));
            }
            remaining = remaining.slice(word.end);
        }
        const unquoted = words.join(' ');
        if (unquoted !== argumentsText)
            candidates.push(...denyCommandSegments(unquoted, depth + 1, uncertainWrappers, budget));
    }
    return candidates;
}
/** Return the raw command tail, retaining quoting and expansion metadata. Unknown
 * wrapper options fail closed rather than guessing which word is executable. */
function prefixWrapperPayload(segment) {
    let remaining = segment.trimStart();
    const take = () => {
        const word = nextShellWord(remaining);
        remaining = remaining.slice(word.end).trimStart();
        return word.value;
    };
    let name = take();
    while (/^[A-Za-z_][\w]*=/.test(name) && remaining)
        name = take();
    name = posix.basename(name);
    if (!/^(?:nohup|time|nice|timeout|stdbuf|env)$/.test(name))
        return undefined;
    while (remaining.startsWith('-')) {
        const option = take();
        if (option === '--')
            break;
        const needsValue = (name === 'nice' && /^(?:-n|--adjustment)$/.test(option))
            || (name === 'timeout' && /^(?:-k|-s|--kill-after|--signal)$/.test(option))
            || (name === 'stdbuf' && /^(?:-[ioe]|--(?:input|output|error))$/.test(option))
            || (name === 'env' && /^(?:-u|--unset|-C|--chdir)$/.test(option));
        if (needsValue) {
            if (!remaining)
                return '';
            take();
            continue;
        }
        const known = (name === 'time' && /^(?:-p)$/.test(option))
            || (name === 'nice' && /^(?:-n.+|--adjustment=.+|-\d+)$/.test(option))
            || (name === 'timeout' && /^(?:--(?:foreground|preserve-status|verbose)|-[sv]|-[ks].+|--(?:signal|kill-after)=.+)$/.test(option))
            || (name === 'stdbuf' && /^(?:-[ioe].+|--(?:input|output|error)=.+)$/.test(option))
            || (name === 'env' && /^(?:-i|--ignore-environment|-u.+|--(?:unset|chdir)=.+)$/.test(option));
        if (!known)
            return '';
    }
    if (name === 'timeout') {
        if (!remaining)
            return '';
        take();
    }
    if (name === 'env') {
        while (/^[A-Za-z_][\w]*=/.test(nextShellWord(remaining).value) && remaining)
            take();
    }
    return remaining;
}
function shellWords(text) {
    const words = [];
    let remaining = text.trimStart();
    while (remaining) {
        const word = nextShellWord(remaining);
        words.push(word.value);
        remaining = remaining.slice(word.end).trimStart();
    }
    return words;
}
function hasForcedPush(words) {
    for (let start = 0; start < words.length; start++) {
        if (posix.basename(words[start]) !== 'git')
            continue;
        let index = start + 1;
        while (index < words.length && words[index].startsWith('-')) {
            const option = words[index++];
            if (option === '--')
                break;
            if (/^(?:-[Cc]|--(?:git-dir|work-tree|namespace|exec-path|config-env|super-prefix))$/.test(option))
                index++;
            // Attached short values and long =values are already contained in one word.
        }
        if (words[index] !== 'push')
            continue;
        if (words.slice(index + 1).some(word => /^(?:--delete(?:=.*)?|-[a-z]*d[a-z]*|:[^:]+)$/.test(word)))
            return true;
        if (words.slice(index + 1).some(word => /^(?:--force(?:-with-lease)?(?:=.*)?|-[a-z]*f[a-z]*|\+.+)$/.test(word)))
            return true;
    }
    return false;
}
/** Match conservative Git long-option abbreviations, ignoring attached values. */
function isLongOptionPrefix(word, target, minLength) {
    if (!word.startsWith('--'))
        return false;
    const name = word.slice(2).split('=', 1)[0];
    return name.length >= minLength && target.startsWith(name);
}
/** Git can delegate execution to configured programs. This finite list requires
 * individual review; it does not enumerate all Git or shell execution semantics. */
function hasGitExecution(words) {
    for (let start = 0; start < words.length; start++) {
        if (posix.basename(words[start]) !== 'git')
            continue;
        if (words.slice(0, start).some(word => /^GIT_[\w]*=/.test(word)))
            return true;
        if (words.slice(start + 1).some(word => /^(?:--[^=]+=)?ext::/.test(word)))
            return true;
        let index = start + 1;
        while (index < words.length && words[index].startsWith('-')) {
            const option = words[index++];
            if (/^(?:-c.*|--(?:exec-path|config-env)(?:=.*)?)$/.test(option))
                return true;
            if (option === '--')
                break;
            if (/^(?:-C|--(?:git-dir|work-tree|namespace|super-prefix))$/.test(option))
                index++;
        }
        const subcommand = words[index++];
        const args = words.slice(index);
        if (subcommand === 'filter-branch' || subcommand === 'mergetool' || subcommand === 'difftool')
            return true;
        if (args.some(word => isLongOptionPrefix(word, 'exec', 1)))
            return true;
        if (/^(?:fetch|ls-remote|clone|pull|archive)$/.test(subcommand) && args.some(word => isLongOptionPrefix(word, 'upload-pack', 1)))
            return true;
        // Only clone uses -u for upload-pack; fetch/push use it for unrelated flags.
        if (subcommand === 'clone' && args.some(word => /^-u.*$/.test(word)))
            return true;
        if (/^(?:push|send-pack)$/.test(subcommand) && args.some(word => isLongOptionPrefix(word, 'receive-pack', 1)))
            return true;
        if (subcommand === 'archive' && args.some(word => isLongOptionPrefix(word, 'remote', 1)))
            return true;
        if (subcommand === 'config' && args.some(word => /^(?:alias\..+|core\.(?:pager|sshcommand|editor|hookspath|fsmonitor)|diff\.external|.+\.pager|credential(?:\..+)?\.helper)(?:=|$)/i.test(word)))
            return true;
        if (subcommand === 'submodule' && args.includes('foreach'))
            return true;
        if (subcommand === 'bisect' && args.includes('run'))
            return true;
        if (subcommand === 'rebase' && args.some(word => /^-x.*$/.test(word) || isLongOptionPrefix(word, 'exec', 1)))
            return true;
        if (subcommand === 'diff' && args.some(word => isLongOptionPrefix(word, 'ext-diff', 1)))
            return true;
    }
    return false;
}
/** List literal output destinations without executing or expanding shell text. */
export function getCommandWriteTargets(command, depth = 0, budget = { remaining: SCAN_LIMIT, exceeded: false }) {
    if (!spend(budget) || depth >= 32)
        return ['$unresolved'];
    const targets = [];
    for (const segment of parseCommandSegments(command).segments) {
        if (!spend(budget)) {
            targets.push('$unresolved');
            break;
        }
        let quote = '';
        for (let index = 0; index < segment.length;) {
            const literal = scanShellLiteral(segment, index, quote);
            if (literal) {
                quote = literal.quote;
                index = literal.end;
                continue;
            }
            if (!quote) {
                if (segment.startsWith('>(', index)) {
                    index += 2;
                    continue;
                }
                const redirect = segment.slice(index).match(/^(?:&>>?|>\||>>?)/);
                if (redirect) {
                    index += redirect[0].length;
                    const tail = segment.slice(index).trimStart();
                    index = segment.length - tail.length;
                    if (tail.startsWith('&')) {
                        const fd = tail.match(/^&[0-9-]+/);
                        if (fd) {
                            index += fd[0].length;
                            continue;
                        }
                    }
                    const word = nextShellWord(tail, true);
                    if (word.value && word.value !== '/dev/null')
                        targets.push(word.value);
                    index += Math.max(word.end, 1);
                    continue;
                }
            }
            index++;
        }
        const words = shellWords(segment);
        for (let index = 0; index < words.length; index++) {
            const name = posix.basename(words[index]);
            const payloadIndex = name === 'eval' ? index + 1
                : /^(?:sh|bash|zsh|dash|ksh)$/.test(name) ? shellPayloadIndex(words, index) : -1;
            if (payloadIndex >= 0 && payloadIndex < words.length) {
                targets.push(...getCommandWriteTargets(words.slice(payloadIndex).join(' '), depth + 1, budget));
                break;
            }
        }
        for (let start = 0; start < words.length; start++) {
            if (posix.basename(words[start]) !== 'git')
                continue;
            let index = start + 1;
            let base = '';
            let unresolved = false;
            while (index < words.length && words[index].startsWith('-')) {
                const option = words[index++];
                if (option === '--')
                    break;
                if (option === '-C' || option.startsWith('-C')) {
                    const dir = option === '-C' ? words[index++] : option.slice(2);
                    if (dir === undefined || /^[~]|[$`*?\[]|\{[^{}]*(?:,|\.\.)[^{}]*\}/.test(dir))
                        unresolved = true;
                    else if (dir) {
                        const api = /^[a-z]:|^\\\\|^\/\//i.test(dir) || /^[a-z]:|^\\\\/i.test(base) ? win32 : posix;
                        base = api.isAbsolute(dir) ? api.normalize(dir) : api.join(base, dir);
                    }
                }
                else if (/^(?:-c|--(?:git-dir|work-tree|namespace|exec-path|config-env|super-prefix))$/.test(option))
                    index++;
            }
            const subcommand = words[index++];
            const args = words.slice(index);
            const add = (target) => {
                if (target === undefined || target === '/dev/null')
                    return;
                const api = /^[a-z]:|^\\\\|^\/\//i.test(base) || /^[a-z]:|^\\\\/i.test(target) ? win32 : posix;
                targets.push(unresolved ? '$unresolved' : !base || api.isAbsolute(target) ? target : api.join(base, target));
            };
            let explicitPatchOutput = false;
            for (let i = 0; i < args.length; i++) {
                const word = args[i];
                if (word === '--')
                    break;
                if (subcommand === 'format-patch' && (word === '--stdout' || word.startsWith('-o')
                    || word === '--output' || word.startsWith('--output=')
                    || word === '--output-directory' || word.startsWith('--output-directory=')))
                    explicitPatchOutput = true;
                if (word.startsWith('--output='))
                    add(word.slice(9));
                else if (word === '--output')
                    add(args[++i]);
                else if (subcommand === 'archive' || subcommand === 'format-patch') {
                    if (word === '-o')
                        add(args[++i]);
                    else if (word.startsWith('-o'))
                        add(word.slice(2));
                    else if (subcommand === 'format-patch' && word === '--output-directory')
                        add(args[++i]);
                    else if (subcommand === 'format-patch' && word.startsWith('--output-directory='))
                        add(word.slice(19));
                }
                if (subcommand === 'fast-export') {
                    if (word === '--export-marks')
                        add(args[++i]);
                    else if (word.startsWith('--export-marks='))
                        add(word.slice(15));
                }
            }
            if (subcommand === 'format-patch' && !explicitPatchOutput)
                add('.');
            if (subcommand === 'bundle' && args[0] === 'create') {
                let i = 1;
                while (i < args.length && args[i].startsWith('-')) {
                    if (args[i++] === '--')
                        break;
                }
                add(args[i]);
            }
        }
    }
    return targets;
}
function hasRecursiveDelete(words) {
    return words.some((word, index) => {
        if (posix.basename(word) !== 'rm')
            return false;
        const flags = words.slice(index + 1);
        return flags.some(flag => flag === '--recursive' || /^-[a-z]*r[a-z]*$/i.test(flag))
            && flags.some(flag => flag === '--force' || /^-[a-z]*f[a-z]*$/i.test(flag));
    });
}
/** Check the finite mandatory-review forms within a single parsed command. */
function hasConfirmationForm(command, conservative = true) {
    const parsed = scanCommandSegments(command);
    const segments = parsed.segments.map(shellWords);
    if (segments.some(words => hasForcedPush(words) || (conservative && hasGitExecution(words)) || hasRecursiveDelete(words)))
        return true;
    // Expansion-obfuscated mandatory forms remain recognizable from their literal
    // operation/flags. Do not extend this to ordinary expanded arguments.
    if (!conservative && parsed.segments.some((segment, index) => {
        if (!segmentRequiresExpansionConfirmation(segment))
            return false;
        const words = segments[index];
        const executable = nextShellWord(segment.trimStart());
        const expandedExecutable = executable.hasExpansion || executable.hasWildcard;
        const flags = words.filter(word => word.startsWith('-'));
        const recursive = flags.some(flag => /^-[a-z]*r|^--recursive/.test(flag));
        const force = flags.some(flag => /^-[a-z]*f|^--force/.test(flag));
        return ((posix.basename(executable.value) === 'rm' || expandedExecutable) && recursive && force)
            || ((posix.basename(executable.value) === 'git' || expandedExecutable) && words.includes('push')
                && (force || words.some(word => /^\+.+|^:[^:]+|^--delete/.test(word))));
    }))
        return true;
    // Enumerated curl/wget pipelines into the sh family only. Two-step download
    // to disk then execution and other downloaders are outside this list; each
    // command segment still goes through the ordinary permission rules.
    return segments.some((words, index) => {
        if (!words.some(word => /^(?:curl|wget)$/.test(posix.basename(word))))
            return false;
        const next = segments[index + 1];
        if (!next || !parsed.pipes.has(index))
            return false;
        let shellIndex = 0;
        while (shellIndex < next.length && (/^(?:sudo|env|command|exec)$/.test(posix.basename(next[shellIndex])) || /^[A-Za-z_][\w]*=/.test(next[shellIndex])))
            shellIndex++;
        return /^(?:sh|bash|zsh|dash|ksh)$/.test(posix.basename(next[shellIndex] ?? ''));
    });
}
function payloadRequiresConfirmation(command, depth = 0, conservative = true, budget = { remaining: SCAN_LIMIT, exceeded: false }) {
    if (!spend(budget))
        return true;
    if (depth >= 32)
        return conservative;
    if (hasConfirmationForm(command, conservative))
        return true;
    for (const segment of scanCommandSegments(command).segments) {
        if (conservative && segmentRequiresExpansionConfirmation(segment))
            return true;
        const payload = prefixWrapperPayload(segment);
        if (payload !== undefined && ((conservative && (!payload || classifyBashCommand(payload).level !== 'safe')) || payloadRequiresConfirmation(payload, depth + 1, conservative, budget)))
            return true;
        const words = shellWords(segment);
        // Reparse quoted literal arguments completely, preserving conservative review
        // even when dangerous text is only a message rather than an executable payload.
        if (words.some(word => /\s/.test(word) && payloadRequiresConfirmation(word, depth + 1, conservative, budget)))
            return true;
        for (let index = 0; index < words.length; index++) {
            const name = posix.basename(words[index]);
            const payloadIndex = name === 'eval' ? index + 1
                : /^(?:sh|bash|zsh|dash|ksh)$/.test(name) ? shellPayloadIndex(words, index) : -1;
            // eval can concatenate arguments; inspecting the entire wrapper tail also
            // covers nested wrappers without losing their pipeline segmentation.
            if (payloadIndex >= 0 && payloadIndex < words.length
                && payloadRequiresConfirmation(words.slice(payloadIndex).join(' '), depth + 1, conservative, budget))
                return true;
        }
    }
    return false;
}
/** Conservative form recognition, not an enumeration of shell semantics.
 * Expansion checks apply to top-level and wrapper-payload segments alike;
 * the allow boundary remains the requirement to match every parsed segment.
 */
export function requiresCommandConfirmation(command) {
    return exceedsCommandInspectionBudget(command) || payloadRequiresConfirmation(command)
        // Conservative fallback: removing quotes may expose otherwise hidden forms.
        || hasConfirmationForm(command.replace(/['"]/g, ''));
}
/** Mandatory forms for AUTO without rule-based approval involvement. */
export function requiresAlwaysCommandConfirmation(command) {
    return exceedsCommandInspectionBudget(command) || payloadRequiresConfirmation(command, 0, false)
        || hasConfirmationForm(command.replace(/['"]/g, ''), false);
}
