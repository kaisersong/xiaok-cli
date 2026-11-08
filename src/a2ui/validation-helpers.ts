import type { ValidationResult } from './protocol.js';

export const FORBIDDEN_KEYS = new Set([
  '__proto__',
  'constructor',
  'prototype',
  'action',
  'actions',
  'onClick',
  'onclick',
  'event',
  'events',
  'style',
  'className',
  'color',
  'href',
  'src',
  'url',
]);

export function containsForbiddenKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((item) => containsForbiddenKey(item));
  if (!isRecord(value)) return false;
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(key)) return true;
    if (containsForbiddenKey(value[key])) return true;
  }
  return false;
}

export function containsDangerousPrototypeKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((item) => containsDangerousPrototypeKey(item));
  if (!isRecord(value)) return false;
  for (const key of Object.keys(value)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') return true;
    if (containsDangerousPrototypeKey(value[key])) return true;
  }
  return false;
}


export function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

export function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function fail(reason: string): ValidationResult {
  return { ok: false, reason };
}


export function validateChart(value: {title?:unknown;chartType?:unknown;points?:unknown}): ValidationResult {
  if (typeof value.title !== 'string' || value.title.length > 1000) return fail('chart title 无效');
  if (value.chartType !== 'bar' && value.chartType !== 'line') return fail('chart type 无效');
  if (!Array.isArray(value.points) || value.points.length === 0 || value.points.length > 100) return fail('chart points 超限');
  if (!value.points.every(point => isRecord(point) && Object.keys(point).every(k => ['label','value'].includes(k)) && typeof point.label === 'string' && point.label.length <= 200 && typeof point.value === 'number' && Number.isFinite(point.value) && Math.abs(point.value) <= 1e15)) return fail('chart point 无效');
  return { ok: true };
}
