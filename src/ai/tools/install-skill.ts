import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { basename, dirname, isAbsolute, join, resolve } from 'path';
import type { Tool } from '../../types.js';
import type { CapabilityRegistry } from '../../platform/runtime/capability-registry.js';
import { getConfigDir } from '../../utils/config.js';

export interface InstallSkillToolOptions {
  cwd?: string;
  configDir?: string;
  capabilityRegistry?: CapabilityRegistry;
  fetchFn?: typeof fetch;
  onInstall?: (info: { name: string; path: string; scope: 'project' | 'global' }) => Promise<void> | void;
}

interface ParsedSkillDocument {
  name: string;
  description: string;
}

interface ResolvedSource {
  kind: 'url' | 'file';
  location: string;
}

function parseSkillDocument(raw: string): ParsedSkillDocument | null {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return null;

  const fields: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    fields[key] = value;
  }

  if (!fields.name || !fields.description) {
    return null;
  }

  return {
    name: fields.name,
    description: fields.description,
  };
}

function sanitizeSkillFileName(name: string): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'skill';
}

function isLocalPath(source: string): boolean {
  return (
    isAbsolute(source) ||
    source.startsWith('./') ||
    source.startsWith('../') ||
    source.startsWith('~/')
  );
}

function resolveGitHubUrl(source: string): string | null {
  const blobUrlMatch = source.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+\.md)$/i);
  if (blobUrlMatch) {
    const [, owner, repo, ref, filePath] = blobUrlMatch;
    return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${filePath}`;
  }

  const rawUrlMatch = source.match(/^https?:\/\/raw\.githubusercontent\.com\/.+\.md$/i);
  if (rawUrlMatch) {
    return source;
  }

  const shorthandMatch = source.match(/^([^/#\s]+)\/([^/#\s]+)\/(.+\.md)(?:#(.+))?$/);
  if (shorthandMatch) {
    const [, owner, repo, filePath, ref = 'HEAD'] = shorthandMatch;
    return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${filePath}`;
  }

  return null;
}

function resolveSource(source: string, cwd: string): ResolvedSource {
  const trimmed = source.trim();
  if (!trimmed) {
    throw new Error('缺少 skill 来源');
  }

  const githubUrl = resolveGitHubUrl(trimmed);
  if (githubUrl) {
    return { kind: 'url', location: githubUrl };
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return { kind: 'url', location: trimmed };
  }

  if (isLocalPath(trimmed)) {
    const location = trimmed.startsWith('~/')
      ? join(homedir(), trimmed.slice(2))
      : resolve(cwd, trimmed);
    return { kind: 'file', location };
  }

  throw new Error(`不支持的 skill 来源: ${trimmed}`);
}

function formatDownloadError(status: number, statusText: string): string {
  const text = statusText.trim();
  return text ? `下载 skill 失败 (${status} ${text})` : `下载 skill 失败 (${status})`;
}

export function createInstallSkillTool(options: InstallSkillToolOptions = {}): Tool {
  const cwd = options.cwd ?? process.cwd();
  const configDir = options.configDir ?? getConfigDir();
  const fetchFn = options.fetchFn ?? fetch;

  return {
    permission: 'write',
    definition: {
      name: 'install_skill',
      description: '从远程 Markdown URL、GitHub skill 文件链接或本地文件安装 skill 到 project/global scope',
      inputSchema: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description: 'skill 来源。支持 Markdown URL、GitHub blob/raw URL、owner/repo/path/to/skill.md#ref 或本地路径',
          },
          scope: {
            type: 'string',
            enum: ['project', 'global'],
            description: '安装范围，默认 project',
          },
        },
        required: ['source'],
      },
    },
    async execute(input) {
      const { source, scope = 'project' } = input as { source: string; scope?: 'project' | 'global' };
      const targetScope = scope === 'global' ? 'global' : 'project';
      const resolvedSource = resolveSource(source, cwd);

      let raw: string;
      if (resolvedSource.kind === 'file') {
        if (!existsSync(resolvedSource.location)) {
          return `Error: 来源文件不存在: ${resolvedSource.location}`;
        }
        raw = readFileSync(resolvedSource.location, 'utf8');
      } else {
        try {
          const response = await fetchFn(resolvedSource.location);
          if (!response.ok) {
            return `Error: ${formatDownloadError(response.status, response.statusText)}`;
          }
          raw = await response.text();
        } catch (error) {
          return `Error: 下载 skill 失败: ${error instanceof Error ? error.message : String(error)}`;
        }
      }

      const parsed = parseSkillDocument(raw);
      if (!parsed) {
        return 'Error: 下载内容不是有效的 skill Markdown（缺少 name/description frontmatter）';
      }

      const skillDir = targetScope === 'global'
        ? join(configDir, 'skills')
        : join(cwd, '.xiaok', 'skills');
      const fileName = `${sanitizeSkillFileName(parsed.name)}.md`;
      const targetPath = join(skillDir, basename(fileName));
      const existed = existsSync(targetPath);

      mkdirSync(dirname(targetPath), { recursive: true });
      const tempPath = join(dirname(targetPath), `.xiaok-install-${Date.now()}.tmp`);
      writeFileSync(tempPath, raw, 'utf8');
      renameSync(tempPath, targetPath);

      await options.onInstall?.({
        name: parsed.name,
        path: targetPath,
        scope: targetScope,
      });
      options.capabilityRegistry?.register({
        kind: 'skill',
        name: parsed.name,
        description: parsed.description,
      });

      return [
        `已${existed ? '更新' : '安装'} skill "${parsed.name}"`,
        `范围: ${targetScope}`,
        `路径: ${targetPath}`,
        `来源: ${resolvedSource.location}`,
        `描述: ${parsed.description}`,
      ].join('\n');
    },
  };
}

export const installSkillTool = createInstallSkillTool();
