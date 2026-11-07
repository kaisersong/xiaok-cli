import {
  A2UI_LIMITS,
  A2UI_V1_CATALOG_ID,
  SAFE_A2UI_CATALOG_ID,
  type A2UIComponent,
  type A2UIMessage,
  type ValidationResult,
} from './protocol.js';
import { assertJsonBudget } from './json-budget.js';
import { validateLegacyA2uiMessages, validateComponents } from './validator.js';
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
function keys(value: unknown, allowed: string[]): asserts value is Record<string, unknown> {
  if (!record(value) || Object.keys(value).some((key) => !allowed.includes(key)))
    throw Error('未知协议字段');
}
function pointer(path: unknown): string[] {
  if (
    typeof path !== 'string' ||
    !path.startsWith('/') ||
    path.length > 1000 ||
    /~(?![01])/u.test(path)
  )
    throw Error('JSON Pointer 无效');
  const parts = path
    .slice(1)
    .split('/')
    .map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
  if (parts.length > 16 || parts.some((p) => forbidden.has(p))) throw Error('数据路径不允许');
  return parts;
}
function readPointer(data: Record<string, unknown>, path: string): unknown {
  let current: unknown = data;
  for (const part of pointer(path)) {
    if (!record(current) || !Object.hasOwn(current, part)) throw Error('data model 缺少路径');
    current = current[part];
  }
  return current;
}
function patch(
  data: Record<string, unknown>,
  path: unknown,
  value: unknown,
): Record<string, unknown> {
  if (path === undefined || path === '/') {
    if (!record(value)) throw Error('data model 必须是对象');
    return structuredClone(value);
  }
  const parts = pointer(path);
  let current = data;
  for (const part of parts.slice(0, -1)) {
    if (!Object.hasOwn(current, part)) current[part] = {};
    if (!record(current[part])) throw Error('数据路径父节点必须为对象');
    current = current[part];
  }
  const key = parts.at(-1)!;
  if (value === null) delete current[key];
  else current[key] = structuredClone(value);
  return data;
}
function resolveComponent(
  component: Record<string, unknown>,
  data: Record<string, unknown>,
): A2UIComponent {
  const result = { ...component };
  for (const key of ['value', 'rows']) {
    const value = result[key];
    if (record(value)) {
      keys(value, ['@path']);
      if (typeof value['@path'] !== 'string') throw Error('绑定格式无效');
      result[key] = readPointer(data, value['@path']);
    }
  }
  return result as unknown as A2UIComponent;
}
/** Normalize both wire generations to one validated literal-only render model. */
export function normalizeA2uiMessages(input: unknown): A2UIMessage[] {
  assertJsonBudget(input);
  if (!Array.isArray(input) || input.length === 0 || input.length > A2UI_LIMITS.maxMessages)
    throw Error('消息数量超限');
  if (input.every((message) => record(message) && message.version === 1)) {
    const check = validateLegacyA2uiMessages(input);
    if (!check.ok) throw Error(check.reason);
    return input as A2UIMessage[];
  }
  let surfaceId: string | null = null;
  let data: Record<string, unknown> = {};
  const components = new Map<string, Record<string, unknown>>();
  let created = false;
  function upsert(value: unknown): void {
    if (!Array.isArray(value) || !value.length || value.length > A2UI_LIMITS.maxComponents)
      throw Error('components 数量超限');
    const batch = new Set<string>();
    for (const component of value) {
      if (
        !record(component) ||
        typeof component.id !== 'string' ||
        !component.id ||
        component.id.length > 200 ||
        batch.has(component.id)
      )
        throw Error('component id 无效或重复');
      const literal = { ...component };
      for (const key of ['value', 'rows'])
        if (record(literal[key])) {
          const binding = literal[key];
          keys(binding, ['@path']);
          pointer(binding['@path']);
          literal[key] = key === 'rows' ? [] : 0;
        }
      const structural = validateComponents([literal as unknown as A2UIComponent]);
      if (!structural.ok) throw Error(structural.reason);
      batch.add(component.id);
      components.set(component.id, component);
    }
    if (components.size > A2UI_LIMITS.maxComponents) throw Error('组件数量超限');
  }
  for (const message of input) {
    keys(message, [
      'version',
      'createSurface',
      'updateComponents',
      'updateDataModel',
      'deleteSurface',
    ]);
    if (message.version !== '1.0') throw Error('未知或混合协议版本');
    const operations = Object.keys(message).filter((key) => key !== 'version');
    if (operations.length !== 1) throw Error('message 必须且只能包含一个操作');
    const operation = operations[0]!;
    const body = message[operation];
    if (operation === 'createSurface') {
      keys(body, ['surfaceId', 'catalogId', 'sendDataModel', 'components', 'dataModel']);
      if (
        surfaceId !== null ||
        typeof body.surfaceId !== 'string' ||
        !body.surfaceId ||
        body.surfaceId.length > 200
      )
        throw Error('surfaceId 无效或重复');
      if (body.catalogId !== A2UI_V1_CATALOG_ID) throw Error('catalogId 不允许');
      if (body.sendDataModel !== undefined && body.sendDataModel !== false)
        throw Error('sendDataModel 不允许');
      surfaceId = body.surfaceId;
      created = true;
      components.clear();
      data = {};
      if (body.dataModel !== undefined) data = patch(data, '/', body.dataModel);
      if (body.components !== undefined) upsert(body.components);
    } else {
      keys(
        body,
        operation === 'updateComponents'
          ? ['surfaceId', 'components']
          : operation === 'updateDataModel'
            ? ['surfaceId', 'path', 'value']
            : ['surfaceId'],
      );
      if (surfaceId === null || body.surfaceId !== surfaceId)
        throw Error('surfaceId 不一致或未创建');
      if (operation === 'updateComponents') upsert(body.components);
      else if (operation === 'updateDataModel') {
        if (!Object.hasOwn(body, 'value')) throw Error('value 必填');
        data = patch(data, body.path, body.value);
        assertJsonBudget(data);
      } else {
        surfaceId = null;
        components.clear();
        data = {};
      }
    }
  }
  if (!created) throw Error('缺少 createSurface');
  if (surfaceId === null) return [];
  const normalized: A2UIMessage[] = [
    {
      version: 1,
      createSurface: {
        surfaceId: 'a2ui-normalized-surface',
        catalogId: SAFE_A2UI_CATALOG_ID,
        root: 'root',
      },
    },
    {
      version: 1,
      updateComponents: {
        surfaceId: 'a2ui-normalized-surface',
        components: [...components.values()].map((c) => resolveComponent(c, data)),
      },
    },
  ];
  const check = validateLegacyA2uiMessages(normalized);
  if (!check.ok) throw Error(check.reason);
  return normalized;
}
export function validateA2uiMessages(input: unknown): ValidationResult {
  try {
    normalizeA2uiMessages(input);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'A2UI 无效' };
  }
}
