import https from 'node:https';
import { assertSafeRelativePath } from './integrity.js';

export const DEFAULT_REGISTRY_V2_URL =
  'https://raw.githubusercontent.com/kaisersong/kai-xiaok-plugins/main/registry-v2.json';

export const REGISTRY_MAX_BYTES = 2 * 1024 * 1024;

const DEFAULT_REGISTRY_HOST = new URL(DEFAULT_REGISTRY_V2_URL).host;

const PLUGIN_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const REPO_OWNER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,38}$/;
const REPO_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const PLUGIN_VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const COMMIT_SHA1 = /^[0-9a-f]{40}$/;
const TREE_SHA256 = /^[0-9a-f]{64}$/;
const NPM_SCRIPT = /^[A-Za-z0-9][A-Za-z0-9:_.-]{0,63}$/;
const MCP_SERVER_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export type TrustedInstallStepKind = 'npm_ci' | 'npm_run' | 'python_requirements' | 'external';

export interface TrustedInstallStep {
  kind: TrustedInstallStepKind;
  /** POSIX relative directory inside the plugin root. */
  cwd: string;
  /** npm_run only. */
  script?: string;
  /** python_requirements only. */
  file?: string;
  /** external only: MCP servers that stay unprobed because the step is manual. */
  serverNames?: string[];
  reason?: string;
}

export interface TrustedPluginRepository {
  owner: string;
  name: string;
  cloneUrl: string;
}

export interface TrustedRegistryPlugin {
  name: string;
  displayName: string;
  description: string;
  keywords: string[];
  repo: TrustedPluginRepository;
  path: string;
  version: string;
  source: { commit: string; treeSha256: string };
  install: { steps: TrustedInstallStep[] };
  runtime?: string;
}

export interface TrustedRegistry {
  version: 2;
  plugins: TrustedRegistryPlugin[];
}

export function normalizePluginRepository(repo: unknown): TrustedPluginRepository {
  if (typeof repo !== 'string' || repo.length === 0 || repo.length > 140) {
    throw new Error('Registry entry "repo" must be an "owner/name" GitHub slug');
  }
  const segments = repo.split('/');
  if (segments.length !== 2) {
    throw new Error(`Registry entry "repo" must be an "owner/name" GitHub slug, got "${repo}"`);
  }
  const [owner, name] = segments;
  if (!REPO_OWNER.test(owner) || !REPO_NAME.test(name) || owner.includes('..') || name.includes('..')) {
    throw new Error(`Registry entry "repo" is not a safe GitHub slug: "${repo}"`);
  }
  return { owner, name, cloneUrl: `https://github.com/${owner}/${name}` };
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function parseInstallStep(raw: unknown, index: number): TrustedInstallStep {
  const entry = requireObject(raw, `Install step #${index}`);
  const kind = entry.kind;
  const cwd = entry.cwd === undefined ? '.' : entry.cwd;
  if (typeof cwd !== 'string') {
    throw new Error(`Install step #${index} has an invalid "cwd"`);
  }
  try {
    assertSafeRelativePath(cwd, `Install step #${index} "cwd"`);
  } catch (error) {
    throw new Error(`Install step #${index} has an invalid "cwd": ${(error as Error).message}`);
  }

  if (kind === 'npm_ci') {
    return { kind, cwd };
  }

  if (kind === 'npm_run') {
    const script = entry.script;
    if (typeof script !== 'string' || !NPM_SCRIPT.test(script)) {
      throw new Error(`Install step #${index} has an invalid npm "script"`);
    }
    return { kind, cwd, script };
  }

  if (kind === 'python_requirements') {
    const file = entry.file === undefined ? 'requirements.txt' : entry.file;
    if (typeof file !== 'string') {
      throw new Error(`Install step #${index} has an invalid requirements "file"`);
    }
    try {
      assertSafeRelativePath(file, `Install step #${index} "file"`);
    } catch (error) {
      throw new Error(`Install step #${index} has an invalid requirements "file": ${(error as Error).message}`);
    }
    return { kind, cwd, file };
  }

  if (kind === 'external') {
    const serverNames = entry.serverNames;
    if (!Array.isArray(serverNames) || serverNames.length === 0) {
      throw new Error(`Install step #${index} of kind "external" must list the affected "serverNames"`);
    }
    const names = serverNames.map((name) => {
      if (typeof name !== 'string' || !MCP_SERVER_NAME.test(name)) {
        throw new Error(`Install step #${index} has an invalid entry in "serverNames"`);
      }
      return name;
    });
    const step: TrustedInstallStep = { kind, cwd, serverNames: names };
    if (typeof entry.reason === 'string' && entry.reason) step.reason = entry.reason;
    return step;
  }

  throw new Error(`Install step #${index} has an unsupported "kind": ${JSON.stringify(kind)}`);
}

function parsePluginEntry(raw: unknown, index: number): TrustedRegistryPlugin {
  const entry = requireObject(raw, `Registry plugin #${index}`);

  const name = entry.name;
  if (typeof name !== 'string' || !PLUGIN_NAME.test(name) || name.startsWith('.')) {
    throw new Error(`Registry plugin #${index} has an invalid "name": ${JSON.stringify(name)}`);
  }

  const repo = normalizePluginRepository(entry.repo);

  const path = entry.path;
  if (typeof path !== 'string') {
    throw new Error(`Plugin "${name}" has an invalid "path"`);
  }
  try {
    assertSafeRelativePath(path, `Plugin "${name}" "path"`);
  } catch (error) {
    throw new Error(`Plugin "${name}" has an invalid "path": ${(error as Error).message}`);
  }

  const version = entry.version;
  if (typeof version !== 'string' || !PLUGIN_VERSION.test(version)) {
    throw new Error(`Plugin "${name}" has an invalid "version"`);
  }

  const source = requireObject(entry.source, `Plugin "${name}" "source"`);
  const commit = source.commit;
  if (typeof commit !== 'string' || !COMMIT_SHA1.test(commit)) {
    throw new Error(`Plugin "${name}" requires an immutable 40-hex "source.commit", got ${JSON.stringify(commit)}`);
  }
  const treeSha256 = source.treeSha256;
  if (typeof treeSha256 !== 'string' || !TREE_SHA256.test(treeSha256)) {
    throw new Error(`Plugin "${name}" requires a 64-hex "source.treeSha256"`);
  }

  let steps: TrustedInstallStep[] = [];
  if (entry.install !== undefined) {
    const install = requireObject(entry.install, `Plugin "${name}" "install"`);
    if (install.steps !== undefined) {
      if (!Array.isArray(install.steps)) {
        throw new Error(`Plugin "${name}" has an invalid "install.steps"`);
      }
      steps = install.steps.map((step, stepIndex) => parseInstallStep(step, stepIndex));
    }
  }

  const keywords = Array.isArray(entry.keywords)
    ? entry.keywords.filter((keyword): keyword is string => typeof keyword === 'string')
    : [];

  return {
    name,
    displayName: typeof entry.display_name === 'string' && entry.display_name ? entry.display_name : name,
    description: typeof entry.description === 'string' ? entry.description : '',
    keywords,
    repo,
    path,
    version,
    source: { commit, treeSha256 },
    install: { steps },
    ...(typeof entry.runtime === 'string' && entry.runtime ? { runtime: entry.runtime } : {}),
  };
}

export function parseTrustedRegistry(raw: unknown): TrustedRegistry {
  const doc = requireObject(raw, 'Registry document');

  if (doc.version !== 2) {
    throw new Error(
      `Plugin install requires registry v2 (got version ${JSON.stringify(doc.version)}). ` +
        'Upgrade the registry to registry-v2.json with pinned source commits and typed install steps.',
    );
  }
  if (!Array.isArray(doc.plugins)) {
    throw new Error('Registry document must contain a "plugins" array');
  }

  const plugins = doc.plugins.map((entry, index) => parsePluginEntry(entry, index));
  const seen = new Set<string>();
  for (const plugin of plugins) {
    if (seen.has(plugin.name)) {
      throw new Error(`Registry contains duplicate plugin name "${plugin.name}"`);
    }
    seen.add(plugin.name);
  }

  return { version: 2, plugins };
}

export interface RegistryHttpResponse {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
  url: string;
}

export type RegistryRequest = (url: string, maxBytes: number) => Promise<RegistryHttpResponse>;

export interface FetchTrustedRegistryOptions {
  registryUrl?: string;
  trustRegistry?: boolean;
  request?: RegistryRequest;
  maxBytes?: number;
  maxRedirects?: number;
}

export async function fetchTrustedRegistryDocument(
  options: FetchTrustedRegistryOptions = {},
): Promise<TrustedRegistry> {
  const maxBytes = options.maxBytes ?? REGISTRY_MAX_BYTES;
  const request = options.request ?? httpsRegistryRequest;
  const maxRedirects = options.maxRedirects ?? 3;
  const isCustom = Boolean(options.registryUrl) && options.registryUrl !== DEFAULT_REGISTRY_V2_URL;

  if (isCustom && !options.trustRegistry) {
    throw new Error(
      'Refusing to install from a custom plugin registry without --trust-registry. ' +
        'A custom registry can execute build steps from arbitrary code.',
    );
  }

  const startUrl = options.registryUrl ?? DEFAULT_REGISTRY_V2_URL;
  let parsed: URL;
  try {
    parsed = new URL(startUrl);
  } catch {
    throw new Error(`Invalid registry URL: ${startUrl}`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`Plugin registry must be served over https, got "${parsed.protocol}"`);
  }

  const expectedHost = isCustom ? parsed.host : DEFAULT_REGISTRY_HOST;
  let currentUrl = parsed.toString();

  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    const response = await request(currentUrl, maxBytes);

    if (response.statusCode >= 300 && response.statusCode < 400) {
      const location = response.headers.location;
      const target = Array.isArray(location) ? location[0] : location;
      if (!target) {
        throw new Error(`Registry redirect from ${currentUrl} is missing a location header`);
      }
      const next = new URL(target, currentUrl);
      if (next.protocol !== 'https:' || next.host !== expectedHost) {
        throw new Error(
          `Refusing registry redirect to a different origin: ${next.protocol}//${next.host} (expected https://${expectedHost})`,
        );
      }
      currentUrl = next.toString();
      continue;
    }

    if (response.statusCode !== 200) {
      throw new Error(`HTTP ${response.statusCode} fetching plugin registry ${currentUrl}`);
    }
    if (response.body.byteLength > maxBytes) {
      throw new Error(`Plugin registry document is too large (limit ${maxBytes} bytes)`);
    }

    let json: unknown;
    try {
      json = JSON.parse(response.body.toString('utf8'));
    } catch (error) {
      throw new Error(`Plugin registry is not valid JSON: ${(error as Error).message}`);
    }
    return parseTrustedRegistry(json);
  }

  throw new Error('Too many registry redirects');
}

const httpsRegistryRequest: RegistryRequest = (url, maxBytes) =>
  new Promise<RegistryHttpResponse>((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { 'User-Agent': 'xiaok-cli', Accept: 'application/json' } },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.byteLength;
          if (size > maxBytes) {
            res.destroy();
            reject(new Error(`Plugin registry document is too large (limit ${maxBytes} bytes)`));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () =>
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers as Record<string, string | string[] | undefined>,
            body: Buffer.concat(chunks),
            url,
          }),
        );
        res.on('error', reject);
      },
    );
    req.setTimeout(30_000, () => req.destroy(new Error(`Timed out fetching plugin registry ${url}`)));
    req.on('error', reject);
  });
