import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { getBuiltinSkillRoots } from './defaults.js';

export type SkillExecutionContext = 'inline' | 'fork';

export interface SkillMeta {
  name: string;
  description: string;
  content: string;
  path: string;
  source: 'builtin' | 'global' | 'project';
  tier: 'system' | 'user' | 'project';
  allowedTools: string[];
  executionContext: SkillExecutionContext;
  agent?: string;
  model?: string;
  effort?: string;
  dependsOn: string[];
  userInvocable: boolean;
  whenToUse?: string;
}

export interface SkillLoadOptions {
  builtinRoots?: string[];
  extraRoots?: string[];
}

export interface SkillCatalog {
  reload(): Promise<SkillMeta[]>;
  list(): SkillMeta[];
  get(name: string): SkillMeta | undefined;
  resolve(names: string[]): SkillMeta[];
}

interface ParsedFrontmatter {
  name: string;
  description: string;
  content: string;
  allowedTools: string[];
  executionContext: SkillExecutionContext;
  agent?: string;
  model?: string;
  effort?: string;
  dependsOn: string[];
  userInvocable?: boolean;
  whenToUse?: string;
}

function stripWrappingQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith('\'') && value.endsWith('\''))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function splitCommaList(value: string): string[] {
  return value
    .split(',')
    .map((entry) => stripWrappingQuotes(entry.trim()))
    .filter(Boolean);
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  if (/^(true|yes|1)$/i.test(value)) return true;
  if (/^(false|no|0)$/i.test(value)) return false;
  return undefined;
}

function parseFrontmatter(raw: string): ParsedFrontmatter | null {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return null;

  const lines = match[1].split('\n');
  const content = match[2].trim();
  const fields = new Map<string, string>();
  const listFields = new Map<string, string[]>();
  let currentListKey: string | null = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '');
    const trimmed = line.trim();
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
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (!key) continue;

    if (value.length === 0) {
      currentListKey = key;
      listFields.set(key, listFields.get(key) ?? []);
      continue;
    }

    fields.set(key, stripWrappingQuotes(value));
  }

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

function normalizeSkill(
  parsed: ParsedFrontmatter,
  filePath: string,
  source: SkillMeta['source'],
  tier: SkillMeta['tier'],
): SkillMeta {
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

function loadSkillsFromDir(
  dir: string,
  source: SkillMeta['source'],
  tier: SkillMeta['tier'],
): SkillMeta[] {
  if (!existsSync(dir)) return [];

  const results: SkillMeta[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir).filter((file) => file.endsWith('.md'));
  } catch {
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
    } catch {
      console.warn(`[xiaok] Skills: 读取文件失败: ${file}`);
    }
  }

  return results;
}

export async function loadSkills(
  xiaokConfigDir = join(homedir(), '.xiaok'),
  cwd = process.cwd(),
  options?: SkillLoadOptions,
): Promise<SkillMeta[]> {
  const builtinRoots = [
    ...(options?.builtinRoots ?? getBuiltinSkillRoots()),
    ...(options?.extraRoots ?? []),
  ];
  const globalSkillsDir = join(xiaokConfigDir, 'skills');
  const projectSkillsDir = join(cwd, '.xiaok', 'skills');

  const builtinSkills = builtinRoots.flatMap((root) => loadSkillsFromDir(root, 'builtin', 'system'));
  const globalSkills = loadSkillsFromDir(globalSkillsDir, 'global', 'user');
  const projectSkills = loadSkillsFromDir(projectSkillsDir, 'project', 'project');

  const map = new Map<string, SkillMeta>();
  for (const skill of builtinSkills) map.set(skill.name, skill);
  for (const skill of globalSkills) map.set(skill.name, skill);
  for (const skill of projectSkills) map.set(skill.name, skill);

  return Array.from(map.values());
}

function resolveSkillsByName(names: string[], skills: SkillMeta[]): SkillMeta[] {
  const ordered: SkillMeta[] = [];
  const seen = new Set<string>();
  const stack = new Set<string>();
  const byName = new Map(skills.map((skill) => [skill.name, skill]));

  const visit = (name: string) => {
    if (seen.has(name)) return;
    if (stack.has(name)) {
      throw new Error(`skill dependency cycle detected: ${name}`);
    }

    const skill = byName.get(name);
    if (!skill) return;

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

export function createSkillCatalog(
  xiaokConfigDir = join(homedir(), '.xiaok'),
  cwd = process.cwd(),
  options?: SkillLoadOptions,
): SkillCatalog {
  let skills: SkillMeta[] = [];

  return {
    async reload() {
      skills = await loadSkills(xiaokConfigDir, cwd, options);
      return [...skills];
    },
    list() {
      return [...skills];
    },
    get(name: string) {
      return skills.find((skill) => skill.name === name);
    },
    resolve(names: string[]) {
      return resolveSkillsByName(names, skills);
    },
  };
}

export function formatSkillsContext(skills: SkillMeta[]): string {
  if (skills.length === 0) return '';

  const builtinSkills = skills.filter((skill) => skill.tier === 'system');
  const customSkills = skills.filter((skill) => skill.tier !== 'system');
  const render = (skill: SkillMeta) => {
    const hints: string[] = [];
    if ((skill.executionContext ?? 'inline') === 'fork') hints.push('fork');
    if (skill.agent) hints.push(`agent=${skill.agent}`);
    if ((skill.dependsOn ?? []).length > 0) hints.push(`deps=${(skill.dependsOn ?? []).join(',')}`);
    return `- /${skill.name}: ${skill.description}${hints.length > 0 ? ` [${hints.join(' ')}]` : ''}`;
  };

  const sections: string[] = [];
  if (builtinSkills.length > 0) {
    sections.push(`## 默认 Skills\n\n${builtinSkills.map(render).join('\n')}`);
  }
  if (customSkills.length > 0) {
    sections.push(`## 扩展 Skills\n\n${customSkills.map(render).join('\n')}`);
  }
  sections.push('通过 /skill-name 或 skill 工具调用方式使用。多 skills 场景应先解析依赖并按计划执行。');
  return sections.join('\n\n');
}

export function parseSlashCommand(input: string): { skillName: string; rest: string } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;
  const [token, ...rest] = trimmed.slice(1).split(/\s+/);
  if (!token) return null;
  return { skillName: token, rest: rest.join(' ') };
}
