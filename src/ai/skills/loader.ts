import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getBuiltinSkillRoots } from './defaults.js';
import { getConfigDir } from '../../utils/config.js';
import type { TaskSkillHints } from '../task-delivery/types.js';

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
  taskHints: TaskSkillHints;
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
  taskGoals: string[];
  inputKinds: string[];
  outputKinds: string[];
  examples: string[];
}

function decodeQuotedScalar(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith('\'') && value.endsWith('\''))
  ) {
    const inner = value.slice(1, -1);
    if (value.startsWith('\'')) {
      return inner.replace(/''/g, '\'');
    }
    return inner.replace(/\\(["\\])/g, '$1');
  }
  return value;
}

function stripListBrackets(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1);
  }
  return value;
}

function parseInlineList(value: string): string[] {
  const input = stripListBrackets(value).trim();
  if (!input) return [];

  const items: string[] = [];
  let current = '';
  let quote: '"' | '\'' | null = null;

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

function parseBoolean(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  if (/^(true|yes|1)$/i.test(value)) return true;
  if (/^(false|no|0)$/i.test(value)) return false;
  return undefined;
}

function readListField(fields: Map<string, string>, listFields: Map<string, string[]>, key: string): string[] {
  return listFields.get(key) ?? parseInlineList(fields.get(key) ?? '');
}

function parseFrontmatter(raw: string): ParsedFrontmatter | null {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return null;

  const lines = match[1].split('\n');
  const content = match[2].trim();
  const fields = new Map<string, string>();
  const listFields = new Map<string, string[]>();
  let currentListKey: string | null = null;
  // For YAML block scalars (>-, |-, >, |)
  let blockScalarKey: string | null = null;
  let blockScalarLines: string[] = [];

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
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (!key) continue;

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
    taskHints: {
      taskGoals: parsed.taskGoals,
      inputKinds: parsed.inputKinds,
      outputKinds: parsed.outputKinds,
      examples: parsed.examples,
    },
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
  xiaokConfigDir = getConfigDir(),
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
  xiaokConfigDir = getConfigDir(),
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

const SKILL_DESCRIPTION_MAX_CHARS = 250;

function formatSkillDescription(skill: SkillMeta): string {
  const text = skill.whenToUse
    ? `${skill.description} - ${skill.whenToUse}`
    : skill.description;
  return text.length > SKILL_DESCRIPTION_MAX_CHARS
    ? text.slice(0, SKILL_DESCRIPTION_MAX_CHARS - 1) + '…'
    : text;
}

export function formatSkillEntry(skill: SkillMeta): string {
  return `- ${skill.name}: ${formatSkillDescription(skill)}`;
}

export function formatSkillsContext(skills: SkillMeta[]): string {
  if (skills.length === 0) return '';
  return skills.map(formatSkillEntry).join('\n');
}

export function toSkillEntries(skills: SkillMeta[]): Array<{ name: string; listing: string }> {
  return skills.map((skill) => ({ name: skill.name, listing: formatSkillEntry(skill) }));
}

export function parseSlashCommand(input: string): { skillName: string; rest: string } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;
  const [token, ...rest] = trimmed.slice(1).split(/\s+/);
  if (!token) return null;
  return { skillName: token, rest: rest.join(' ') };
}
