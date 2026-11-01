import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { writeFileAtomicallySync } from '../utils/atomic-file.js';

export const STATUSLINE_FIELDS = {
  model: '模型名称', mode: '权限模式', branch: 'Git 分支', tokens: '上下文使用比例',
  cost: '估算费用', project: '项目名称', cwd: '当前目录', 'session-id': '会话 ID', version: 'CLI 版本',
} as const;
export type StatusBarField = keyof typeof STATUSLINE_FIELDS | 'session';
export const DEFAULT_STATUSLINE_FIELDS: StatusBarField[] = ['model', 'mode', 'branch', 'tokens', 'cost', 'project'];

export function normalizeStatuslineFields(value: unknown): StatusBarField[] {
  if (!Array.isArray(value)) throw new Error('字段必须是数组');
  const fields: StatusBarField[] = [];
  for (const item of value) {
    const field = item === 'session' ? 'project' : item;
    if (typeof field !== 'string' || !Object.hasOwn(STATUSLINE_FIELDS, field)) {
      throw new Error(`未知字段：${String(item)}`);
    }
    if (!fields.includes(field as StatusBarField)) fields.push(field as StatusBarField);
  }
  return fields;
}

export function statuslinePreferencePath(): string {
  return join(process.env.XIAOK_CONFIG_DIR ?? join(homedir(), '.xiaok'), 'statusline.json');
}

function readJson(file: string): unknown {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return undefined; }
}

export function loadStatuslineConfiguration(cwd: string): {fields: StatusBarField[]; legacy: boolean} {
  const preference = readJson(statuslinePreferencePath()) as {version?: unknown; fields?: unknown} | undefined;
  if (preference?.version === 1) {
    try { return {fields: normalizeStatuslineFields(preference.fields), legacy: false}; } catch {}
  }
  let result = {fields: [...DEFAULT_STATUSLINE_FIELDS], legacy: false};
  for (const file of [join(process.env.XIAOK_CONFIG_DIR ?? join(homedir(), '.xiaok'), 'settings.json'), join(cwd, '.xiaok', 'settings.json')]) {
    const legacy = readJson(file) as {ui?: {statusBar?: {fields?: unknown}}} | undefined;
    const configured = legacy?.ui?.statusBar?.fields;
    if (!Array.isArray(configured)) continue;
    const valid = configured.filter(item => typeof item === 'string' && (item === 'session' || Object.hasOwn(STATUSLINE_FIELDS, item)));
    if (!valid.length) continue;
    // Keep legacy tokens/cost grouped until render: its branch position
    // depends on visible fragments, including whether mode has a value.
    result = {fields: valid as StatusBarField[], legacy: true};
  }
  return result;
}

export function saveStatuslineFields(fields: StatusBarField[]): void {
  writeFileAtomicallySync(statuslinePreferencePath(), JSON.stringify({version: 1, fields: normalizeStatuslineFields(fields)}, null, 2) + '\n');
}
