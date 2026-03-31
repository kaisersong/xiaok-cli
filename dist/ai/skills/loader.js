import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { getBuiltinSkillRoots } from './defaults.js';
/**
 * 解析 Markdown 文件中的 YAML frontmatter。
 * 格式：文件以 --- 开头，第二个 --- 之前是 frontmatter。
 * 返回 { name, description, content } 或 null（格式不合法）。
 */
function parseFrontmatter(raw) {
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!match)
        return null;
    const fm = match[1];
    const content = match[2].trim();
    // 简单解析 key: value 行（不依赖 yaml 库）
    const fields = {};
    for (const line of fm.split('\n')) {
        const colonIdx = line.indexOf(':');
        if (colonIdx === -1)
            continue;
        const key = line.slice(0, colonIdx).trim();
        const value = line.slice(colonIdx + 1).trim();
        fields[key] = value;
    }
    if (!fields.name || !fields.description)
        return null;
    return { name: fields.name, description: fields.description, content };
}
function loadSkillsFromDir(dir, source, tier) {
    if (!existsSync(dir))
        return [];
    const results = [];
    let entries;
    try {
        entries = readdirSync(dir).filter(f => f.endsWith('.md'));
    }
    catch {
        return [];
    }
    for (const file of entries) {
        try {
            const raw = readFileSync(join(dir, file), 'utf-8');
            const parsed = parseFrontmatter(raw);
            if (!parsed) {
                console.warn(`[xiaok] Skills: 跳过格式错误的文件: ${file}`);
                continue;
            }
            results.push({ ...parsed, path: join(dir, file), source, tier });
        }
        catch {
            console.warn(`[xiaok] Skills: 读取文件失败: ${file}`);
        }
    }
    return results;
}
/**
 * 加载所有可用 skills。项目本地优先于全局（同名时覆盖）。
 *
 * @param xiaokConfigDir  ~/.xiaok 目录路径（测试时可覆盖）
 * @param cwd             当前工作目录（用于查找 .xiaok/skills/）
 */
export async function loadSkills(xiaokConfigDir = join(homedir(), '.xiaok'), cwd = process.cwd(), options) {
    const builtinRoots = [
        ...(options?.builtinRoots ?? getBuiltinSkillRoots()),
        ...(options?.extraRoots ?? []),
    ];
    const globalSkillsDir = join(xiaokConfigDir, 'skills');
    const projectSkillsDir = join(cwd, '.xiaok', 'skills');
    const builtinSkills = builtinRoots.flatMap((root) => loadSkillsFromDir(root, 'builtin', 'system'));
    const globalSkills = loadSkillsFromDir(globalSkillsDir, 'global', 'user');
    const projectSkills = loadSkillsFromDir(projectSkillsDir, 'project', 'project');
    // 合并：项目本地覆盖全局同名 skill
    const map = new Map();
    for (const s of builtinSkills)
        map.set(s.name, s);
    for (const s of globalSkills)
        map.set(s.name, s);
    for (const s of projectSkills)
        map.set(s.name, s); // 覆盖
    return Array.from(map.values());
}
export function createSkillCatalog(xiaokConfigDir = join(homedir(), '.xiaok'), cwd = process.cwd(), options) {
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
    };
}
/** 格式化 skills 列表为系统提示片段 */
export function formatSkillsContext(skills) {
    if (skills.length === 0)
        return '';
    const builtinSkills = skills.filter((skill) => skill.tier === 'system');
    const customSkills = skills.filter((skill) => skill.tier !== 'system');
    const sections = [];
    if (builtinSkills.length > 0) {
        sections.push(`## 默认 Skills\n\n${builtinSkills.map((skill) => `- /${skill.name}: ${skill.description}`).join('\n')}`);
    }
    if (customSkills.length > 0) {
        sections.push(`## 扩展 Skills\n\n${customSkills.map((skill) => `- /${skill.name}: ${skill.description}`).join('\n')}`);
    }
    sections.push('通过 /skill-name 或工具调用方式使用。');
    return sections.join('\n\n');
}
/** 解析用户输入中的斜杠命令。以 / 开头且第一个 token 是 skill 名称。 */
export function parseSlashCommand(input) {
    const trimmed = input.trim();
    if (!trimmed.startsWith('/'))
        return null;
    const [token, ...rest] = trimmed.slice(1).split(/\s+/);
    if (!token)
        return null;
    return { skillName: token, rest: rest.join(' ') };
}
