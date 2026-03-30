import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { PermissionSettings } from '../../types.js';

function getGlobalSettingsPath(): string {
  const dir = process.env.XIAOK_CONFIG_DIR ?? join(homedir(), '.xiaok');
  return join(dir, 'settings.json');
}

function getProjectSettingsPath(cwd: string): string {
  return join(cwd, '.xiaok', 'settings.json');
}

async function readSettings(path: string): Promise<PermissionSettings> {
  if (!existsSync(path)) return {};
  try {
    const raw = await readFile(path, 'utf-8');
    const parsed = JSON.parse(raw) as PermissionSettings;
    return parsed ?? {};
  } catch {
    return {};
  }
}

async function writeSettings(path: string, settings: PermissionSettings): Promise<void> {
  const dir = join(path, '..');
  await mkdir(dir, { recursive: true });
  await writeFile(path, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
}

export async function loadSettings(cwd: string): Promise<{
  global: PermissionSettings;
  project: PermissionSettings;
}> {
  const [global, project] = await Promise.all([
    readSettings(getGlobalSettingsPath()),
    readSettings(getProjectSettingsPath(cwd)),
  ]);
  return { global, project };
}

export function mergeRules(settings: { global: PermissionSettings; project: PermissionSettings }): {
  allowRules: string[];
  denyRules: string[];
} {
  const allowRules = [
    ...(settings.global.permissions?.allow ?? []),
    ...(settings.project.permissions?.allow ?? []),
  ];
  const denyRules = [
    ...(settings.global.permissions?.deny ?? []),
    ...(settings.project.permissions?.deny ?? []),
  ];
  return { allowRules, denyRules };
}

export async function addAllowRule(
  scope: 'global' | 'project',
  rule: string,
  cwd: string,
): Promise<void> {
  const path = scope === 'global' ? getGlobalSettingsPath() : getProjectSettingsPath(cwd);
  const settings = await readSettings(path);
  const allow = settings.permissions?.allow ?? [];
  if (allow.includes(rule)) return;
  settings.permissions = {
    ...settings.permissions,
    allow: [...allow, rule],
  };
  await writeSettings(path, settings);
}

export async function addDenyRule(
  scope: 'global' | 'project',
  rule: string,
  cwd: string,
): Promise<void> {
  const path = scope === 'global' ? getGlobalSettingsPath() : getProjectSettingsPath(cwd);
  const settings = await readSettings(path);
  const deny = settings.permissions?.deny ?? [];
  if (deny.includes(rule)) return;
  settings.permissions = {
    ...settings.permissions,
    deny: [...deny, rule],
  };
  await writeSettings(path, settings);
}

export { getGlobalSettingsPath, getProjectSettingsPath };
