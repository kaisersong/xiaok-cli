import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, rmSync, cpSync } from 'fs';
import { homedir } from 'os';
import { basename, dirname, isAbsolute, join, resolve } from 'path';
import { execSync } from 'child_process';
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
  kind: 'url' | 'file' | 'repo';
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

/**
 * 解析 GitHub 仓库简写（支持复合技能）
 * 格式: owner/repo 或 owner/repo#branch
 */
function resolveGitHubRepo(source: string): { owner: string; repo: string; branch: string } | null {
  // owner/repo#branch 格式
  const branchMatch = source.match(/^([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+)#(.+)$/);
  if (branchMatch) {
    const [, owner, repo, branch] = branchMatch;
    return { owner, repo, branch };
  }

  // owner/repo 格式（默认 main 分支）
  const simpleMatch = source.match(/^([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+)$/);
  if (simpleMatch) {
    const [, owner, repo] = simpleMatch;
    return { owner, repo, branch: 'main' };
  }

  return null;
}

function resolveSource(source: string, cwd: string): ResolvedSource {
  const trimmed = source.trim();
  if (!trimmed) {
    throw new Error('缺少 skill 来源');
  }

  // 1. 检查是否是 GitHub 仓库简写（复合技能）
  const repoInfo = resolveGitHubRepo(trimmed);
  if (repoInfo) {
    return { kind: 'repo', location: `https://github.com/${repoInfo.owner}/${repoInfo.repo}.git` };
  }

  // 2. 检查是否是 GitHub 仓库 URL
  const repoUrlMatch = trimmed.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)(\/)?$/);
  if (repoUrlMatch) {
    const [, owner, repo] = repoUrlMatch;
    return { kind: 'repo', location: `https://github.com/${owner}/${repo}.git` };
  }

  // 3. 检查是否是单个 Markdown 文件的 GitHub URL
  const githubUrl = resolveGitHubUrl(trimmed);
  if (githubUrl) {
    return { kind: 'url', location: githubUrl };
  }

  // 4. 检查是否是其他 URL
  if (/^https?:\/\//i.test(trimmed)) {
    return { kind: 'url', location: trimmed };
  }

  // 5. 检查是否是本地路径
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

/**
 * 克隆 GitHub 仓库作为复合技能
 */
function cloneSkillRepo(repoUrl: string, targetDir: string): { success: boolean; message: string; skillName: string } {
  try {
    // 提取仓库名作为技能名
    const repoName = basename(repoUrl, '.git');
    const skillDir = join(targetDir, repoName);

    // 如果目录已存在，先删除
    if (existsSync(skillDir)) {
      rmSync(skillDir, { recursive: true, force: true });
    }

    // 创建目标目录
    mkdirSync(targetDir, { recursive: true });

    // 克隆仓库（浅克隆）
    execSync(`git clone --single-branch --depth 1 "${repoUrl}" "${skillDir}"`, {
      stdio: 'pipe',
      timeout: 60000, // 60秒超时
    });

    // 检查是否有 setup 脚本
    const setupSh = join(skillDir, 'setup');
    const setupBash = join(skillDir, 'setup.bash');
    const setupShFile = join(skillDir, 'setup.sh');

    let setupMessage = '';
    if (existsSync(setupSh) || existsSync(setupBash) || existsSync(setupShFile)) {
      setupMessage = '\n注意: 该技能包含 setup 脚本，请运行以下命令完成安装：';
      setupMessage += `\n  cd ${skillDir} && ./setup`;
    }

    return {
      success: true,
      message: `已克隆技能仓库到 ${skillDir}${setupMessage}`,
      skillName: repoName,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: `克隆技能仓库失败: ${errorMsg}`,
      skillName: '',
    };
  }
}

export function createInstallSkillTool(options: InstallSkillToolOptions = {}): Tool {
  const cwd = options.cwd ?? process.cwd();
  const configDir = options.configDir ?? getConfigDir();
  const fetchFn = options.fetchFn ?? fetch;

  return {
    permission: 'write',
    definition: {
      name: 'install_skill',
      description: '从远程 Markdown URL、GitHub 仓库或本地文件安装 skill。支持：\n- 单个 Markdown 文件: owner/repo/path/to/skill.md\n- GitHub 仓库（复合技能）: owner/repo 或 owner/repo#branch\n- 本地文件: ./path/to/skill.md',
      inputSchema: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description: 'skill 来源。支持：单个 MD 文件 URL、GitHub 仓库 (owner/repo)、本地路径',
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

      // 处理仓库克隆（复合技能）
      if (resolvedSource.kind === 'repo') {
        const skillDir = targetScope === 'global'
          ? join(configDir, 'skills')
          : join(cwd, '.xiaok', 'skills');

        const result = cloneSkillRepo(resolvedSource.location, skillDir);

        if (!result.success) {
          return `Error: ${result.message}`;
        }

        await options.onInstall?.({
          name: result.skillName,
          path: join(skillDir, result.skillName),
          scope: targetScope,
        });

        return result.message;
      }

      // 处理单个文件下载/读取
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
        `提示: 可使用 /skills-reload 命令刷新 skill 目录`,
      ].join('\n');
    },
  };
}

export const installSkillTool = createInstallSkillTool();
