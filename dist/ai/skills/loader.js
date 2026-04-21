import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getBuiltinSkillRoots } from './defaults.js';
import { getConfigDir } from '../../utils/config.js';
function stripWrappingQuotes(value) {
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith('\'') && value.endsWith('\''))) {
        return value.slice(1, -1);
    }
    return value;
}
function splitCommaList(value) {
    return value
        .split(',')
        .map((entry) => stripWrappingQuotes(entry.trim()))
        .filter(Boolean);
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
function parseFrontmatter(raw) {
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
            items.push(stripWrappingQuotes(listItemMatch[1].trim()));
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
        fields.set(key, stripWrappingQuotes(value));
    }
    flushBlockScalar();
    const name = fields.get('name');
    const description = fields.get('description');
    if (!name || !description) {
        return null;
    }
    const allowedTools = listFields.get('allowed-tools')
        ?? splitCommaList(fields.get('allowed-tools') ?? '');
    const dependsOn = listFields.get('depends-on')
        ?? splitCommaList(fields.get('depends-on') ?? fields.get('skills') ?? '');
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
    };
}
function normalizeSkill(parsed, filePath, source, tier) {
    return {
        name: parsed.name,
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
    };
}
function loadSkillsFromDir(dir, source, tier) {
    if (!existsSync(dir))
        return [];
    const results = [];
    let entries;
    try {
        entries = readdirSync(dir).filter((file) => file.endsWith('.md'));
    }
    catch {
        return [];
    }
    for (const file of entries) {
        const filePath = join(dir, file);
        try {
            const raw = readFileSync(filePath, 'utf-8');
            const parsed = parseFrontmatter(raw);
            if (!parsed) {
                console.warn(`[xiaok] Skills: 跳过格式错误的文件: ${file}`);
                continue;
            }
            results.push(normalizeSkill(parsed, filePath, source, tier));
        }
        catch {
            console.warn(`[xiaok] Skills: 读取文件失败: ${file}`);
        }
    }
    return results;
}
export async function loadSkills(xiaokConfigDir = getConfigDir(), cwd = process.cwd(), options) {
    const builtinRoots = [
        ...(options?.builtinRoots ?? getBuiltinSkillRoots()),
        ...(options?.extraRoots ?? []),
    ];
    const globalSkillsDir = join(xiaokConfigDir, 'skills');
    const projectSkillsDir = join(cwd, '.xiaok', 'skills');
    const builtinSkills = builtinRoots.flatMap((root) => loadSkillsFromDir(root, 'builtin', 'system'));
    const globalSkills = loadSkillsFromDir(globalSkillsDir, 'global', 'user');
    const projectSkills = loadSkillsFromDir(projectSkillsDir, 'project', 'project');
    const map = new Map();
    for (const skill of builtinSkills)
        map.set(skill.name, skill);
    for (const skill of globalSkills)
        map.set(skill.name, skill);
    for (const skill of projectSkills)
        map.set(skill.name, skill);
    return Array.from(map.values());
}
function resolveSkillsByName(names, skills) {
    const ordered = [];
    const seen = new Set();
    const stack = new Set();
    const byName = new Map(skills.map((skill) => [skill.name, skill]));
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
            return skills.find((skill) => skill.name === name);
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
    return `- ${skill.name}: ${formatSkillDescription(skill)}`;
}
export function formatSkillsContext(skills) {
    if (skills.length === 0)
        return '';
    return skills.map(formatSkillEntry).join('\n');
}
export function toSkillEntries(skills) {
    return skills.map((skill) => ({ name: skill.name, listing: formatSkillEntry(skill) }));
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
