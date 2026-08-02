import type { Command } from 'commander';
import { existsSync, readdirSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import https from 'https';
import {
  readActivePluginPointer,
  assertValidPluginName,
  removeActivePluginPointer,
  resolveManagedPlugins,
} from '../platform/plugins/install/active-pointer.js';
import { installPlugin, type InstallEvent } from '../platform/plugins/install/installer.js';
import {
  DEFAULT_REGISTRY_V2_URL,
  parseTrustedRegistry,
} from '../platform/plugins/install/registry.js';
import {
  RESERVED_PLUGIN_DIR_NAMES,
  resolveDefaultPluginsDir,
  resolveInstallPaths,
} from '../platform/plugins/install/source.js';

const LEGACY_REGISTRY_URL =
  'https://raw.githubusercontent.com/kaisersong/kai-xiaok-plugins/main/registry.json';

interface SearchablePlugin {
  name: string;
  displayName: string;
  description: string;
  version: string;
  keywords: string[];
  installable: boolean;
}

function getPluginsDir(): string {
  return resolveDefaultPluginsDir();
}

function downloadFile(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (!url.startsWith('https://')) {
      reject(new Error(`Plugin registry must be served over https, got "${url}"`));
      return;
    }
    https
      .get(url, { headers: { 'User-Agent': 'xiaok-cli', Accept: 'application/json' } }, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      })
      .on('error', reject);
  });
}

/** Search tolerates the legacy v1 document; install never does. */
async function fetchSearchableRegistry(registryUrl?: string): Promise<SearchablePlugin[]> {
  const url = registryUrl ?? DEFAULT_REGISTRY_V2_URL;
  let raw: unknown;
  try {
    raw = JSON.parse((await downloadFile(url)).toString('utf8'));
  } catch (error) {
    if (registryUrl) throw error;
    raw = JSON.parse((await downloadFile(LEGACY_REGISTRY_URL)).toString('utf8'));
  }

  const doc = raw as { version?: unknown; plugins?: unknown };
  if (doc.version === 2) {
    return parseTrustedRegistry(raw).plugins.map((plugin) => ({
      name: plugin.name,
      displayName: plugin.displayName,
      description: plugin.description,
      version: plugin.version,
      keywords: plugin.keywords,
      installable: true,
    }));
  }

  const plugins = Array.isArray(doc.plugins) ? (doc.plugins as Array<Record<string, unknown>>) : [];
  return plugins.map((plugin) => ({
    name: String(plugin.name ?? ''),
    displayName: String(plugin.display_name ?? plugin.name ?? ''),
    description: String(plugin.description ?? ''),
    version: String(plugin.version ?? '?'),
    keywords: Array.isArray(plugin.keywords)
      ? plugin.keywords.filter((keyword): keyword is string => typeof keyword === 'string')
      : [],
    installable: false,
  }));
}

interface InstalledPlugin {
  name: string;
  version: string;
  displayName: string;
  description: string;
  origin: 'managed' | 'directory';
  probeStatus?: 'verified' | 'unverified';
  invalid?: string;
}

export function listInstalledPlugins(pluginsDir = getPluginsDir()): InstalledPlugin[] {
  const installed: InstalledPlugin[] = [];
  if (!existsSync(pluginsDir)) return installed;

  const managed = resolveManagedPlugins(pluginsDir);
  const managedNames = new Set([
    ...managed.entries.map((entry) => entry.name),
    ...managed.invalid.map((entry) => entry.name),
  ]);

  for (const entry of managed.entries) {
    installed.push({
      ...describeManifest(entry.pointer.pluginDir, entry.name, entry.pointer.version),
      origin: 'managed',
      probeStatus: entry.pointer.probe.status,
    });
  }
  for (const invalid of managed.invalid) {
    installed.push({
      name: invalid.name,
      version: '?',
      displayName: invalid.name,
      description: '',
      origin: 'managed',
      invalid: `invalid pointer: ${invalid.reason}`,
    });
  }

  for (const entry of readdirSync(pluginsDir).sort()) {
    if (RESERVED_PLUGIN_DIR_NAMES.includes(entry) || managedNames.has(entry)) continue;
    const pluginDir = join(pluginsDir, entry);
    if (!existsSync(join(pluginDir, 'plugin.json'))) continue;
    installed.push({ ...describeManifest(pluginDir, entry), origin: 'directory' });
  }

  return installed;
}

function describeManifest(
  pluginDir: string,
  name: string,
  fallbackVersion = '?',
): Omit<InstalledPlugin, 'origin'> {
  try {
    const raw = JSON.parse(readFileSync(join(pluginDir, 'plugin.json'), 'utf8')) as Record<string, unknown>;
    const iface = (raw.interface as Record<string, string> | undefined) ?? {};
    return {
      name,
      version: String(raw.version ?? fallbackVersion),
      displayName: iface.display_name || String(raw.name ?? name),
      description: iface.short_description || '',
    };
  } catch {
    return {
      name,
      version: fallbackVersion,
      displayName: name,
      description: '',
      invalid: 'invalid manifest',
    };
  }
}

export async function runInstall(
  name: string,
  opts: { registry?: string; force?: boolean; trustRegistry?: boolean },
): Promise<void> {
  const result = await installPlugin(name, {
    pluginsDir: getPluginsDir(),
    registryUrl: opts.registry,
    trustRegistry: opts.trustRegistry,
    force: opts.force,
    onEvent: (event: InstallEvent) => console.log(`  ${event.message}`),
  });

  if (result.status === 'already-installed') {
    console.log(`Plugin "${name}" is already installed at digest ${result.digest.slice(0, 12)}. Use --force to reinstall.`);
    return;
  }

  console.log(`\n  ${result.displayName} v${result.version} installed.`);
  console.log(`  Location: ${result.pluginDir}`);
  console.log(`  Source: ${result.commit.slice(0, 12)} (tree ${result.digest.slice(0, 12)})`);

  const connected = result.probe.outcomes.filter((outcome) => outcome.status === 'connected');
  if (result.probe.status === 'verified') {
    console.log(`  MCP verified: ${connected.map((outcome) => `${outcome.serverName} (${outcome.toolCount} tools)`).join(', ')}`);
  } else {
    console.log('  MCP not verified: no applicable server was probed.');
  }
  for (const outcome of result.probe.outcomes.filter((item) => item.status === 'skipped')) {
    console.log(`  Skipped ${outcome.serverName}: ${outcome.reason}`);
  }
  if (result.skippedServerNames.length > 0) {
    console.log(`  Manual setup required for: ${result.skippedServerNames.join(', ')}`);
  }
}

export function runList(): void {
  const installed = listInstalledPlugins();

  if (installed.length === 0) {
    console.log('No plugins installed.');
    return;
  }

  console.log('Installed plugins:\n');
  for (const plugin of installed) {
    if (plugin.invalid) {
      console.log(`  ${plugin.name}  (${plugin.invalid})`);
      continue;
    }
    const badge = plugin.origin === 'managed' ? `  [managed/${plugin.probeStatus}]` : '';
    console.log(`  ${plugin.name}  ${plugin.version}  ${plugin.displayName}${badge}`);
    if (plugin.description) console.log(`    ${plugin.description}`);
  }
}

export async function runSearch(query?: string, opts?: { registry?: string }): Promise<void> {
  console.log('Fetching plugin registry...');
  let plugins = await fetchSearchableRegistry(opts?.registry);
  const installedNames = new Set(listInstalledPlugins().map((plugin) => plugin.name));

  if (query) {
    const needle = query.toLowerCase();
    plugins = plugins.filter(
      (plugin) =>
        plugin.name.toLowerCase().includes(needle) ||
        plugin.displayName.toLowerCase().includes(needle) ||
        plugin.description.toLowerCase().includes(needle) ||
        plugin.keywords.some((keyword) => keyword.toLowerCase().includes(needle)),
    );
  }

  if (plugins.length === 0) {
    console.log('No plugins found.');
    return;
  }

  console.log('\nAvailable plugins:\n');
  for (const plugin of plugins) {
    const status = installedNames.has(plugin.name) ? '[installed]' : '';
    const trust = plugin.installable ? '' : '[registry v1: install disabled]';
    console.log(`  ${plugin.name}  v${plugin.version}  ${plugin.displayName}  ${status}${trust}`);
    if (plugin.description) console.log(`    ${plugin.description}`);
  }
}

export function runUninstall(name: string): void {
  assertValidPluginName(name);
  const pluginsDir = getPluginsDir();
  const paths = resolveInstallPaths(pluginsDir);
  const legacyDir = join(pluginsDir, name);
  let removed = false;

  const hasPointer = existsSync(join(paths.activeDir, `${name}.json`));
  if (hasPointer) {
    let pluginVersion = '';
    try {
      pluginVersion = readActivePluginPointer(paths, name).version;
    } catch {
      pluginVersion = '';
    }
    removeActivePluginPointer(paths, name);
    rmSync(join(paths.managedDir, name), { recursive: true, force: true });
    rmSync(join(paths.runtimesDir, name), { recursive: true, force: true });
    removed = true;
    console.log(`Plugin "${name}"${pluginVersion ? ` v${pluginVersion}` : ''} uninstalled.`);
  }

  if (existsSync(join(legacyDir, 'plugin.json'))) {
    rmSync(legacyDir, { recursive: true, force: true });
    if (!removed) console.log(`Plugin "${name}" uninstalled.`);
    removed = true;
  }

  if (!removed) {
    throw new Error(`Plugin "${name}" is not installed.`);
  }
}

export function registerPluginCommands(program: Command): void {
  const plugin = program.command('plugin').description('管理 xiaok 插件');

  plugin
    .command('install <name>')
    .description('安装插件（校验来源摘要并验证 MCP 可用后才激活）')
    .option('--registry <url>', '自定义 registry v2 URL')
    .option('--trust-registry', '显式信任自定义 registry（会执行其声明的构建步骤）')
    .option('--force', '强制重新安装')
    .action(async (name: string, opts: { registry?: string; force?: boolean; trustRegistry?: boolean }) => {
      try {
        await runInstall(name, opts);
      } catch (error) {
        console.error(`安装失败: ${(error as Error).message}`);
        process.exitCode = 1;
      }
    });

  plugin
    .command('uninstall <name>')
    .description('卸载插件')
    .action((name: string) => {
      try {
        runUninstall(name);
      } catch (error) {
        console.error((error as Error).message);
        process.exitCode = 1;
      }
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
      try {
        await runSearch(query, opts);
      } catch (error) {
        console.error(`搜索失败: ${(error as Error).message}`);
        process.exitCode = 1;
      }
    });
}
