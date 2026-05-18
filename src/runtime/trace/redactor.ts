import type { TraceRedaction } from './schema.js';
import { isRecord } from './schema.js';

interface RedactionAccumulator {
  value: string;
  redactions: TraceRedaction[];
}

export function redactString(input: string, fieldPath?: string): RedactionAccumulator {
  let value = input;
  const counts = new Map<string, number>();

  const record = (type: string, count = 1) => {
    counts.set(type, (counts.get(type) ?? 0) + count);
  };

  value = replaceAndCount(value, /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED:private_key]', () => record('private_key'));

  value = replaceAndCount(value, /^([A-Z0-9_]*API_KEY\s*=\s*)([^\n\r]+)/gim, '$1[REDACTED:api_key]', () => record('api_key'));
  value = replaceAndCount(value, /^(DATABASE_URL\s*=\s*)([^\n\r]+)/gim, '$1[REDACTED:database_url]', () => record('database_url'));
  value = replaceAndCount(value, /^(REDIS_URL\s*=\s*)([^\n\r]+)/gim, '$1[REDACTED:redis_url]', () => record('redis_url'));
  value = replaceAndCount(value, /^([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD)[A-Z0-9_]*\s*=\s*)([^\n\r]+)/gim, '$1[REDACTED:secret_env]', () => record('secret_env'));

  value = replaceAndCount(value, /(Authorization:\s*Bearer\s+)[^\s\n\r]+/gi, '$1[REDACTED:bearer]', () => record('bearer'));
  value = replaceAndCount(value, /(Cookie:\s*)[^\n\r]+/gi, '$1[REDACTED:cookie]', () => record('cookie'));
  value = replaceAndCount(value, /\b(?:ghp_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)\b/g, '[REDACTED:github_token]', () => record('github_token'));
  value = replaceAndCount(value, /\/Users\/[^/\s]+/g, '/Users/[USER]', () => record('home_path'));

  return {
    value,
    redactions: [...counts.entries()].map(([type, count]) => ({ type, fieldPath, count })),
  };
}

export function redactTraceValue(input: unknown, fieldPath = ''): { value: unknown; redactions: TraceRedaction[] } {
  if (typeof input === 'string') return redactString(input, fieldPath);
  if (Array.isArray(input)) {
    const redactions: TraceRedaction[] = [];
    const value = input.map((item, index) => {
      const result = redactTraceValue(item, `${fieldPath}[${index}]`);
      redactions.push(...result.redactions);
      return result.value;
    });
    return { value, redactions };
  }
  if (!isRecord(input)) return { value: input, redactions: [] };

  const output: Record<string, unknown> = {};
  const redactions: TraceRedaction[] = [];
  for (const [key, value] of Object.entries(input)) {
    const childPath = fieldPath ? `${fieldPath}.${key}` : key;
    if (typeof value === 'string' && secretKeyType(key)) {
      const type = secretKeyType(key)!;
      output[key] = `[REDACTED:${type}]`;
      redactions.push({ type, fieldPath: childPath, count: 1 });
      continue;
    }
    const result = redactTraceValue(value, childPath);
    output[key] = result.value;
    redactions.push(...result.redactions);
  }
  return { value: output, redactions };
}

function secretKeyType(key: string): string | null {
  const normalized = key.toUpperCase();
  if (normalized === 'DATABASE_URL') return 'database_url';
  if (normalized === 'REDIS_URL') return 'redis_url';
  if (normalized.includes('API_KEY')) return 'api_key';
  if (/(TOKEN|SECRET|PASSWORD)/.test(normalized)) return 'secret_env';
  return null;
}

function replaceAndCount(
  input: string,
  pattern: RegExp,
  replacement: string,
  onMatch: () => void,
): string {
  return input.replace(pattern, (...args) => {
    onMatch();
    const match = args[0] as string;
    return match.replace(pattern, replacement);
  });
}
