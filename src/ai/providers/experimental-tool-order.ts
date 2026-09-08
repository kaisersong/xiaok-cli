import type { OpenAIHarnessContext } from './model-harness-profile.js';

export interface ExperimentalToolOrder {
  readonly baseUrl: string;
  readonly model: string;
  readonly order: 'name';
}

function canonicalBaseUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048 || /[\s?#]/u.test(value)) return null;
  // URL strips empty userinfo (http://@host); validate the raw authority first.
  if (!/^https?:\/\/[^/@\\]+(?:\/|$)/iu.test(value)) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return `${url.origin}${url.pathname.replace(/\/$/u, '')}`;
  } catch { return null; }
}

/** Explicit experiment only. Invalid/off settings never affect normal startup. */
export function parseExperimentalToolOrder(raw: string | undefined): Readonly<ExperimentalToolOrder> | null {
  if (!raw || raw.length > 4096) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const config = value as Record<string, unknown>;
    if (Object.keys(config).length !== 3 || !['baseUrl', 'model', 'order'].every(k => Object.hasOwn(config, k))) return null;
    const baseUrl = canonicalBaseUrl(config.baseUrl);
    if (!baseUrl || config.order !== 'name' || typeof config.model !== 'string'
      || !config.model.trim() || config.model.length > 512) return null;
    return Object.freeze({ baseUrl, model: config.model, order: 'name' });
  } catch { return null; }
}

/** Change only the newly constructed request array; never mutate a registry or input schema. */
export function applyExperimentalToolOrder<T extends { type: string; function?: { name: string } }>(
  tools: T[],
  config: Readonly<ExperimentalToolOrder> | null,
  context: OpenAIHarnessContext,
  actualClientBaseUrl: string,
): T[] {
  if (!config || tools.length < 2 || context.profile.id !== 'generic-openai'
    || context.identity.providerId === 'kimi' || context.identity.protocol !== 'openai_legacy'
    || context.identity.wireModel !== config.model
    || canonicalBaseUrl(context.identity.canonicalBaseUrl) !== config.baseUrl
    || canonicalBaseUrl(actualClientBaseUrl) !== config.baseUrl
    || tools.some(tool => tool.type !== 'function' || typeof tool.function?.name !== 'string')) return tools;
  return [...tools].sort((left, right) => {
    const a = left.function!.name; const b = right.function!.name;
    return a < b ? -1 : a > b ? 1 : 0;
  });
}
