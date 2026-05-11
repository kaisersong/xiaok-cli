import type { Command } from 'commander';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  readFileSync,
  writeFileSync,
  createWriteStream,
} from 'fs';
import { join, resolve } from 'path';
import { createGunzip } from 'zlib';
import { pipeline } from 'stream/promises';
import { createReadStream, createWriteStream as fsCreateWriteStream } from 'fs';
import { execSync } from 'child_process';
import https from 'https';
import http from 'http';

const DEFAULT_REGISTRY_URL =
  'https://raw.githubusercontent.com/kaisersong/kai-xiaok-plugins/main/registry.json';
const FALLBACK_REGISTRY_URL =
  'https://api.github.com/repos/kaisersong/kai-xiaok-plugins/contents/registry.json';

interface RegistryPlugin {
  name: string;
  display_name: string;
  description: string;
  repo: string;
  path: string;
  version: string;
  keywords?: string[];
  dependencies: {
    runtime: string;
    install: string;
    test?: string;
  };
}

interface Registry {
  version: number;
  repo: string;
  plugins: RegistryPlugin[];
}

function getPluginsDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE || '~';
  return resolve(home, '.xiaok', 'plugins');
}

function downloadFile(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const follow = (u: string, redirects: number) => {
      if (redirects > 5) return reject(new Error('Too many redirects'));
      client
        .get(u, { headers: { 'User-Agent': 'xiaok-cli' } }, (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            follow(res.headers.location, redirects + 1);
            res.resume();
            return;
          }
          if (res.statusCode !== 200) {
            res.resume();
            reject(new Error(`HTTP ${res.statusCode} fetching ${u}`));
            return;
          }
          const chunks: Buffer[] = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => resolve(Buffer.concat(chunks)));
          res.on('error', reject);
        })
        .on('error', reject);
    };
    follow(url, 0);
  });
}

async function fetchRegistry(registryUrl?: string): Promise<Registry> {
  if (registryUrl) {
    const data = await downloadFile(registryUrl);
    return JSON.parse(data.toString('utf8')) as Registry;
  }

  // Try raw URL first, fallback to API URL
  try {
    const data = await downloadFile(DEFAULT_REGISTRY_URL);
    return JSON.parse(data.toString('utf8')) as Registry;
  } catch {
    // API URL returns base64-encoded content
    const data = await downloadFile(FALLBACK_REGISTRY_URL);
    const apiResp = JSON.parse(data.toString('utf8')) as { content?: string };
    if (!apiResp.content) throw new Error('Failed to fetch registry');
    const decoded = Buffer.from(apiResp.content, 'base64').toString('utf8');
    return JSON.parse(decoded) as Registry;
  }
}

function execCmd(cmd: string, cwd?: string): void {
  execSync(cmd, { cwd, stdio: 'inherit', timeout: 120_000 });
}

async function runInstall(name: string, opts: { registry?: string; force?: boolean }): Promise<void> {
  const pluginsDir = getPluginsDir();
  const targetDir = join(pluginsDir, name);

  if (existsSync(targetDir) && !opts.force) {
    console.log(`Plugin "${name}" already installed. Use --force to reinstall.`);
    return;
  }

  console.log(`Fetching plugin registry...`);
  const registry = await fetchRegistry(opts.registry);
  const plugin = registry.plugins.find((p) => p.name === name);

  if (!plugin) {
    console.error(
      `Plugin "${name}" not found in registry.`,
    );
    console.error(`Available: ${registry.plugins.map((p) => p.name).join(', ')}`);
    process.exit(1);
  }

  console.log(`Installing ${plugin.display_name} v${plugin.version}...`);

  if (existsSync(targetDir)) {
    rmSync(targetDir, { recursive: true, force: true });
  }
  mkdirSync(targetDir, { recursive: true });

  // Strategy: git clone the repo, then copy the plugin subdirectory
  const { execSync: exec } = await import('child_process');
  const tmpDir = join(pluginsDir, `.tmp-${name}-${Date.now()}`);

  try {
    console.log(`  Cloning ${plugin.repo}...`);
    exec(
      `git clone --depth 1 --sparse ${plugin.repo} "${tmpDir}"`,
      { stdio: 'pipe', timeout: 60_000 },
    );

    // Sparse checkout just the plugin subdirectory
    exec(`cd "${tmpDir}" && git sparse-checkout set ${plugin.path}`, {
      stdio: 'pipe',
      timeout: 30_000,
    });

    // Copy plugin files
    const srcDir = join(tmpDir, plugin.path);
    if (!existsSync(srcDir)) {
      throw new Error(`Plugin path "${plugin.path}" not found in repo`);
    }
    exec(`cp -r "${srcDir}/." "${targetDir}/"`, { stdio: 'pipe' });

    console.log(`  Files installed.`);

    // Install dependencies
    if (plugin.dependencies?.install) {
      console.log(`  Installing dependencies...`);
      try {
        execCmd(plugin.dependencies.install, targetDir);
        console.log(`  Dependencies installed.`);
      } catch {
        console.warn(`  Warning: dependency install failed. You may need to run manually:`);
        console.warn(`    cd ${targetDir} && ${plugin.dependencies.install}`);
      }
    }

    // Verify
    const manifestPath = join(targetDir, 'plugin.json');
    if (!existsSync(manifestPath)) {
      throw new Error('Installation failed: plugin.json not found after install');
    }

    console.log(`\n  ${plugin.display_name} v${plugin.version} installed successfully.`);
    console.log(`  Location: ${targetDir}`);

    if (plugin.dependencies?.runtime) {
      console.log(`  Runtime: ${plugin.dependencies.runtime}`);
    }
  } finally {
    // Cleanup temp dir
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }
}

function runList(): void {
  const pluginsDir = getPluginsDir();
  if (!existsSync(pluginsDir)) {
    console.log('No plugins installed.');
    return;
  }

  const entries = readdirSync(pluginsDir).filter((e) => {
    const manifest = join(pluginsDir, e, 'plugin.json');
    return existsSync(manifest);
  });

  if (entries.length === 0) {
    console.log('No plugins installed.');
    return;
  }

  console.log('Installed plugins:\n');
  for (const name of entries) {
    const manifestPath = join(pluginsDir, name, 'plugin.json');
    try {
      const raw = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
      const displayName = (raw.interface as Record<string, string>)?.display_name || (raw.name as string) || name;
      const version = raw.version || '?';
      const desc = (raw.interface as Record<string, string>)?.short_description || '';
      console.log(`  ${name}  ${version}  ${displayName}`);
      if (desc) console.log(`    ${desc}`);
    } catch {
      console.log(`  ${name}  (invalid manifest)`);
    }
  }
}

async function runSearch(query?: string, opts?: { registry?: string }): Promise<void> {
  console.log('Fetching plugin registry...');
  const registry = await fetchRegistry(opts?.registry);

  let plugins = registry.plugins;
  if (query) {
    const q = query.toLowerCase();
    plugins = plugins.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.display_name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.keywords?.some((k) => k.toLowerCase().includes(q)),
    );
  }

  if (plugins.length === 0) {
    console.log('No plugins found.');
    return;
  }

  console.log('\nAvailable plugins:\n');
  for (const p of plugins) {
    const installed = existsSync(join(getPluginsDir(), p.name, 'plugin.json'));
    const status = installed ? '[installed]' : '';
    console.log(`  ${p.name}  v${p.version}  ${p.display_name}  ${status}`);
    console.log(`    ${p.description}`);
  }
}

function runUninstall(name: string): void {
  const pluginsDir = getPluginsDir();
  const targetDir = join(pluginsDir, name);

  if (!existsSync(targetDir)) {
    console.error(`Plugin "${name}" is not installed.`);
    process.exit(1);
  }

  rmSync(targetDir, { recursive: true, force: true });
  console.log(`Plugin "${name}" uninstalled.`);
}

export function registerPluginCommands(program: Command): void {
  const plugin = program.command('plugin').description('管理 xiaok 插件');

  plugin
    .command('install <name>')
    .description('安装插件')
    .option('--registry <url>', '自定义 registry URL')
    .option('--force', '强制重新安装')
    .action(async (name: string, opts: { registry?: string; force?: boolean }) => {
      await runInstall(name, opts);
    });

  plugin
    .command('uninstall <name>')
    .description('卸载插件')
    .action((name: string) => {
      runUninstall(name);
    });

  plugin
    .command('list')
    .description('列出已安装的插件')
    .action(() => {
      runList();
    });

  plugin
    .command('search [query]')
    .description('搜索可用插件')
    .option('--registry <url>', '自定义 registry URL')
    .action(async (query?: string, opts?: { registry?: string }) => {
      await runSearch(query, opts);
    });
}
