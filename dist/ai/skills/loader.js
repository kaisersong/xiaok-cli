import { readdirSync, readFileSync, existsSync } from 'fs';
import { basename, join } from 'path';
import { getBuiltinSkillRoots } from './defaults.js';
import { getConfigDir } from '../../utils/config.js';
function decodeQuotedScalar(value) {
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith('\'') && value.endsWith('\''))) {
        const inner = value.slice(1, -1);
        if (value.startsWith('\'')) {
            return inner.replace(/''/g, '\'');
        }
        return inner.replace(/\\(["\\])/g, '$1');
    }
    return value;
}
function stripListBrackets(value) {
    const trimmed = value.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        return trimmed.slice(1, -1);
    }
    return value;
}
function parseInlineList(value) {
    const input = stripListBrackets(value).trim();
    if (!input)
        return [];
    const items = [];
    let current = '';
    let quote = null;
    for (let index = 0; index < input.length; index += 1) {
        const char = input[index];
        if (quote) {
            if (quote === '\'' && char === '\'' && index + 1 < input.length && input[index + 1] === '\'') {
                current += '\'';
                index += 1;
                continue;
            }
            if (char === quote) {
                quote = null;
                continue;
            }
            if (char === '\\' && quote === '"' && index + 1 < input.length) {
                const next = input[index + 1];
                if (next === '"' || next === '\\') {
                    current += next;
                    index += 1;
                    continue;
                }
                current += char;
                continue;
            }
            current += char;
            continue;
        }
        if (char === '"' || char === '\'') {
            quote = char;
            continue;
        }
        if (char === ',') {
            const item = current.trim();
            if (item) {
                items.push(decodeQuotedScalar(item));
            }
            current = '';
            continue;
        }
        current += char;
    }
    const lastItem = current.trim();
    if (lastItem) {
        items.push(decodeQuotedScalar(lastItem));
    }
    return items.filter(Boolean);
}
function parseBoolean(value) {
    if (!value)
        return undefined;
    if (/^(true|yes|1)$/i.test(value))
        return true;
    if (/^(false|no|0)$/i.test(value))
        return false;
    return undefined;
}
function readListField(fields, listFields, key) {
    return listFields.get(key) ?? parseInlineList(fields.get(key) ?? '');
}
export function parseFrontmatter(raw) {
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!match)
        return null;
    const lines = match[1].split('\n');
    const content = match[2].trim();
    const fields = new Map();
    const listFields = new Map();
    let currentListKey = null;
    // For YAML block scalars (>-, |-, >, |)
    let blockScalarKey = null;
    let blockScalarLines = [];
    const flushBlockScalar = () => {
        if (blockScalarKey !== null) {
            fields.set(blockScalarKey, blockScalarLines.join(' ').trim().replace(/\s+/g, ' '));
            blockScalarKey = null;
            blockScalarLines = [];
        }
    };
    for (const rawLine of lines) {
        const line = rawLine.replace(/\r$/, '');
        const trimmed = line.trim();
        // Continuation of a block scalar (indented line)
        if (blockScalarKey !== null) {
            if (line.startsWith('  ') || line.startsWith('\t')) {
                blockScalarLines.push(trimmed);
                continue;
            }
            // Non-indented line ends the block scalar
            flushBlockScalar();
        }
        if (!trimmed) {
            currentListKey = null;
            continue;
        }
        const listItemMatch = line.match(/^\s*-\s+(.+)$/);
        if (listItemMatch && currentListKey) {
            const items = listFields.get(currentListKey) ?? [];
            items.push(decodeQuotedScalar(listItemMatch[1].trim()));
            listFields.set(currentListKey, items);
            continue;
        }
        currentListKey = null;
        const colonIdx = line.indexOf(':');
        if (colonIdx === -1)
            continue;
        const key = line.slice(0, colonIdx).trim();
        const value = line.slice(colonIdx + 1).trim();
        if (!key)
            continue;
        // YAML block scalar indicators: >-, |-, >, |
        if (value === '>-' || value === '|-' || value === '>' || value === '|') {
            blockScalarKey = key;
            blockScalarLines = [];
            continue;
        }
        if (value.length === 0) {
            currentListKey = key;
            listFields.set(key, listFields.get(key) ?? []);
            continue;
        }
        fields.set(key, decodeQuotedScalar(value));
    }
    flushBlockScalar();
    const name = fields.get('name');
    const description = fields.get('description');
    if (!name || !description) {
        return null;
    }
    const allowedTools = listFields.get('allowed-tools')
        ?? parseInlineList(fields.get('allowed-tools') ?? '');
    const dependsOn = listFields.get('depends-on')
        ?? parseInlineList(fields.get('depends-on') ?? fields.get('skills') ?? '');
    const taskGoals = readListField(fields, listFields, 'task-goals');
    const inputKinds = readListField(fields, listFields, 'input-kinds');
    const outputKinds = readListField(fields, listFields, 'output-kinds');
    const examples = readListField(fields, listFields, 'examples');
    const executionContext = fields.get('context') === 'fork' ? 'fork' : 'inline';
    return {
        name,
        description,
        content,
        allowedTools,
        executionContext,
        agent: fields.get('agent') || undefined,
        model: fields.get('model') || undefined,
        effort: fields.get('effort') || undefined,
        dependsOn,
        userInvocable: parseBoolean(fields.get('user-invocable')),
        whenToUse: fields.get('when_to_use') ?? fields.get('when-to-use') ?? undefined,
        taskGoals,
        inputKinds,
        outputKinds,
        examples,
    };
}
function normalizeSkill(parsed, filePath, source, tier, aliases = []) {
    const normalizedAliases = Array.from(new Set(aliases.map((alias) => alias.trim()).filter((alias) => alias && alias !== parsed.name)));
    return {
        name: parsed.name,
        aliases: normalizedAliases,
        description: parsed.description,
        content: parsed.content,
        path: filePath,
        source,
        tier,
        allowedTools: parsed.allowedTools,
        executionContext: parsed.executionContext,
        agent: parsed.agent,
        model: parsed.model,
        effort: parsed.effort,
        dependsOn: parsed.dependsOn,
        userInvocable: parsed.userInvocable ?? true,
        whenToUse: parsed.whenToUse,
        taskHints: {
            taskGoals: parsed.taskGoals,
            inputKinds: parsed.inputKinds,
            outputKinds: parsed.outputKinds,
            examples: parsed.examples,
        },
    };
}
function loadSkillsFromDir(dir, source, tier) {
    if (!existsSync(dir))
        return [];
    const results = [];
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    }
    catch {
        return [];
    }
    const loadSkillFile = (filePath, displayName, aliases = []) => {
        try {
            const raw = readFileSync(filePath, 'utf-8');
            const parsed = parseFrontmatter(raw);
            if (!parsed) {
                console.warn(`[xiaok] Skills: 跳过格式错误的文件: ${displayName}`);
                return;
            }
            results.push(normalizeSkill(parsed, filePath, source, tier, aliases));
        }
        catch {
            console.warn(`[xiaok] Skills: 读取文件失败: ${displayName}`);
        }
    };
    for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.md')) {
            loadSkillFile(join(dir, entry.name), entry.name, [basename(entry.name, '.md')]);
            continue;
        }
        if (!entry.isDirectory() && !entry.isSymbolicLink()) {
            continue;
        }
        const skillFilePath = join(dir, entry.name, 'SKILL.md');
        if (existsSync(skillFilePath)) {
            loadSkillFile(skillFilePath, `${entry.name}/SKILL.md`, [entry.name]);
        }
    }
    return results;
}
export function resolveSkillRoots(xiaokConfigDir = getConfigDir(), cwd = process.cwd(), options) {
    return {
        builtinRoots: [
            ...(options?.builtinRoots ?? getBuiltinSkillRoots()),
            ...(options?.extraRoots ?? []),
        ],
        globalSkillsDir: join(xiaokConfigDir, 'skills'),
        projectSkillsDir: join(cwd, '.xiaok', 'skills'),
    };
}
export async function discoverSkills(xiaokConfigDir = getConfigDir(), cwd = process.cwd(), options) {
    const roots = resolveSkillRoots(xiaokConfigDir, cwd, options);
    const builtinSkills = roots.builtinRoots.flatMap((root) => loadSkillsFromDir(root, 'builtin', 'system'));
    const globalSkills = loadSkillsFromDir(roots.globalSkillsDir, 'global', 'user');
    const projectSkills = loadSkillsFromDir(roots.projectSkillsDir, 'project', 'project');
    return [...builtinSkills, ...globalSkills, ...projectSkills];
}
export async function loadSkills(xiaokConfigDir = getConfigDir(), cwd = process.cwd(), options) {
    const discovered = await discoverSkills(xiaokConfigDir, cwd, options);
    const map = new Map();
    for (const skill of discovered) {
        map.set(skill.name, skill);
    }
    return Array.from(map.values());
}
function resolveSkillsByName(names, skills) {
    const ordered = [];
    const seen = new Set();
    const stack = new Set();
    const byName = new Map();
    for (const skill of skills) {
        byName.set(skill.name, skill);
    }
    for (const skill of skills) {
        for (const alias of skill.aliases ?? []) {
            if (!byName.has(alias)) {
                byName.set(alias, skill);
            }
        }
    }
    const visit = (name) => {
        if (seen.has(name))
            return;
        if (stack.has(name)) {
            throw new Error(`skill dependency cycle detected: ${name}`);
        }
        const skill = byName.get(name);
        if (!skill)
            return;
        stack.add(name);
        for (const dependency of skill.dependsOn) {
            visit(dependency);
        }
        stack.delete(name);
        seen.add(name);
        ordered.push(skill);
    };
    for (const name of names) {
        visit(name);
    }
    return ordered;
}
export function createSkillCatalog(xiaokConfigDir = getConfigDir(), cwd = process.cwd(), options) {
    let skills = [];
    return {
        async reload() {
            skills = await loadSkills(xiaokConfigDir, cwd, options);
            return [...skills];
        },
        list() {
            return [...skills];
        },
        get(name) {
            return findSkillByCommandName(skills, name);
        },
        resolve(names) {
            return resolveSkillsByName(names, skills);
        },
    };
}
const SKILL_DESCRIPTION_MAX_CHARS = 250;
function formatSkillDescription(skill) {
    const text = skill.whenToUse
        ? `${skill.description} - ${skill.whenToUse}`
        : skill.description;
    return text.length > SKILL_DESCRIPTION_MAX_CHARS
        ? text.slice(0, SKILL_DESCRIPTION_MAX_CHARS - 1) + '…'
        : text;
}
export function formatSkillEntry(skill) {
    const aliases = skill.aliases ?? [];
    const aliasSuffix = aliases.length > 0
        ? ` (${aliases.map((alias) => `/${alias}`).join(', ')})`
        : '';
    return `- ${skill.name}${aliasSuffix}: ${formatSkillDescription(skill)}`;
}
export function formatSkillsContext(skills) {
    if (skills.length === 0)
        return '';
    return skills.map(formatSkillEntry).join('\n');
}
export function toSkillEntries(skills) {
    return skills.map((skill) => ({ name: skill.name, listing: formatSkillEntry(skill) }));
}
export function getSkillCommandNames(skill) {
    return [skill.name, ...(skill.aliases ?? [])];
}
export function findSkillByCommandName(skills, name) {
    return skills.find((skill) => skill.name === name || (skill.aliases ?? []).includes(name));
}
export function parseSlashCommand(input) {
    const trimmed = input.trim();
    if (!trimmed.startsWith('/'))
        return null;
    const [token, ...rest] = trimmed.slice(1).split(/\s+/);
    if (!token)
        return null;
    return { skillName: token, rest: rest.join(' ') };
}
