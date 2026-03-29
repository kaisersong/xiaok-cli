import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface SkillMeta {
  name: string;
  description: string;
  content: string;  // frontmatter 之后的全部内容
  source: 'global' | 'project';
}

/**
 * 解析 Markdown 文件中的 YAML frontmatter。
 * 格式：文件以 --- 开头，第二个 --- 之前是 frontmatter。
 * 返回 { name, description, content } 或 null（格式不合法）。
 */
function parseFrontmatter(raw: string): { name: string; description: string; content: string } | null {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return null;

  const fm = match[1];
  const content = match[2].trim();

  // 简单解析 key: value 行（不依赖 yaml 库）
  const fields: Record<string, string> = {};
  for (const line of fm.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    fields[key] = value;
  }

  if (!fields.name || !fields.description) return null;
  return { name: fields.name, description: fields.description, content };
}

function loadSkillsFromDir(dir: string, source: 'global' | 'project'): SkillMeta[] {
  if (!existsSync(dir)) return [];

  const results: SkillMeta[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir).filter(f => f.endsWith('.md'));
  } catch {
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
      results.push({ ...parsed, source });
    } catch {
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
export async function loadSkills(
  xiaokConfigDir = join(homedir(), '.xiaok'),
  cwd = process.cwd()
): Promise<SkillMeta[]> {
  const globalSkillsDir = join(xiaokConfigDir, 'skills');
  const projectSkillsDir = join(cwd, '.xiaok', 'skills');

  const globalSkills = loadSkillsFromDir(globalSkillsDir, 'global');
  const projectSkills = loadSkillsFromDir(projectSkillsDir, 'project');

  // 合并：项目本地覆盖全局同名 skill
  const map = new Map<string, SkillMeta>();
  for (const s of globalSkills) map.set(s.name, s);
  for (const s of projectSkills) map.set(s.name, s); // 覆盖

  return Array.from(map.values());
}

/** 格式化 skills 列表为系统提示片段 */
export function formatSkillsContext(skills: SkillMeta[]): string {
  if (skills.length === 0) return '';
  const lines = skills.map(s => `- /${s.name}: ${s.description}`).join('\n');
  return `## 可用 Skills\n\n通过 /skill-name 或工具调用方式使用：\n${lines}`;
}

/** 解析用户输入中的斜杠命令。以 / 开头且第一个 token 是 skill 名称。 */
export function parseSlashCommand(input: string): { skillName: string; rest: string } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;
  const [token, ...rest] = trimmed.slice(1).split(/\s+/);
  if (!token) return null;
  return { skillName: token, rest: rest.join(' ') };
}
