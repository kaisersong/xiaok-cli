import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_AUTHOR_NAME: 'xiaok-fixture',
  GIT_AUTHOR_EMAIL: 'fixture@xiaok.test',
  GIT_COMMITTER_NAME: 'xiaok-fixture',
  GIT_COMMITTER_EMAIL: 'fixture@xiaok.test',
  GIT_TERMINAL_PROMPT: '0',
} as Record<string, string>;

export function git(cwd: string, args: string[], input?: Buffer): string {
  return execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8', input }).trim();
}

export interface FixtureRepo {
  dir: string;
  writeFile(relPath: string, content: string | Buffer, mode?: number): void;
  writeSymlink(relPath: string, target: string): void;
  /** Adds an index entry without touching the working tree (case/unicode collisions). */
  addIndexBlob(relPath: string, content: string | Buffer, mode?: string): void;
  addIndexGitlink(relPath: string, commit: string): void;
  commit(message?: string, options?: { stage?: boolean }): string;
}

export function initFixtureRepo(dir: string): FixtureRepo {
  mkdirSync(dir, { recursive: true });
  git(dir, ['init', '--quiet', '--initial-branch=main']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  git(dir, ['config', 'core.precomposeunicode', 'false']);

  return {
    dir,
    writeFile(relPath, content, mode) {
      const target = join(dir, relPath);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content);
      if (mode !== undefined) chmodSync(target, mode);
    },
    writeSymlink(relPath, target) {
      const linkPath = join(dir, relPath);
      mkdirSync(dirname(linkPath), { recursive: true });
      symlinkSync(target, linkPath);
    },
    addIndexBlob(relPath, content, mode = '100644') {
      const oid = git(dir, ['hash-object', '-w', '--stdin'], Buffer.from(content as string | Buffer));
      git(dir, ['update-index', '--add', '--cacheinfo', `${mode},${oid},${relPath}`]);
    },
    addIndexGitlink(relPath, commit) {
      git(dir, ['update-index', '--add', '--cacheinfo', `160000,${commit},${relPath}`]);
    },
    commit(message = 'fixture commit', options = {}) {
      if (options.stage !== false) git(dir, ['add', '-A']);
      git(dir, ['commit', '--quiet', '--no-gpg-sign', '--no-verify', '-m', message]);
      return git(dir, ['rev-parse', 'HEAD']);
    },
  };
}

export interface PluginFixtureOptions {
  name: string;
  version: string;
  path?: string;
  manifestExtras?: Record<string, unknown>;
}

export function pluginManifestBody(options: PluginFixtureOptions): string {
  return `${JSON.stringify(
    {
      name: options.name,
      version: options.version,
      ...options.manifestExtras,
    },
    null,
    2,
  )}\n`;
}

export function writePluginFixture(repo: FixtureRepo, options: PluginFixtureOptions): string {
  const pluginPath = options.path ?? `plugins/${options.name}`;
  repo.writeFile(`${pluginPath}/plugin.json`, pluginManifestBody(options));
  return pluginPath;
}
