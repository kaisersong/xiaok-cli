import { createHash } from 'node:crypto';

export interface WorkflowScriptMetaPhase {
  title: string;
  detail?: string;
  model?: string;
}

export interface WorkflowScriptMeta {
  name: string;
  description: string;
  whenToUse?: string;
  phases?: WorkflowScriptMetaPhase[];
}

export interface WorkflowScriptAnalysis {
  agentCallCount: number;
  phaseCallCount: number;
  parallelCallCount: number;
  pipelineCallCount: number;
  requestUserInputCallCount: number;
  runtimePhaseTitles: string[];
}

export interface WorkflowScriptValidationPolicy {
  maxScriptBytes?: number;
  maxAgentCalls?: number;
}

export type WorkflowScriptValidationResult =
  | {
      ok: true;
      normalized: {
        meta: WorkflowScriptMeta;
        scriptHash: string;
        analysis: WorkflowScriptAnalysis;
        policy: Required<WorkflowScriptValidationPolicy>;
      };
    }
  | {
      ok: false;
      error: string;
      message?: string;
      api?: string;
      limit?: number;
      actual?: number;
    };

export type WorkflowScriptPreview =
  | {
      ok: true;
      workflowId: string;
      source: 'script_generated';
      strategy: 'workflow';
      status: 'pending_confirmation';
      projectId: string;
      scope: { projectId: string; taskId?: string };
      requestedBy: string;
      createdAt: number;
      title: string;
      description: string;
      meta: WorkflowScriptMeta;
      phases: Array<{ id: string; title: string; detail: string | null }>;
      scriptHash: string;
      analysis: WorkflowScriptAnalysis;
    }
  | { ok: false; error: string; message?: string };

export interface ParsedWorkflowScript {
  meta: WorkflowScriptMeta;
  body: string;
  script: string;
}

const DEFAULT_SCRIPT_POLICY: Required<WorkflowScriptValidationPolicy> = {
  maxScriptBytes: 20_000,
  maxAgentCalls: 32,
};

const RESERVED_META_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const FORBIDDEN_API_PATTERNS: Array<[string, RegExp]> = [
  ['require', /\brequire\s*\(/],
  ['import', /\bimport\s*(?:\(|\{|\*|[A-Za-z_$])/],
  ['fs', /\bfs\s*\./],
  ['node_fs', /\bnode:fs\b/],
  ['child_process', /\bchild_process\b/],
  ['fetch', /\bfetch\s*\(/],
  ['websocket', /\bWebSocket\s*\(/],
  ['xml_http_request', /\bXMLHttpRequest\b/],
  ['date_now', /\bDate\s*\.\s*now\s*\(/],
  ['math_random', /\bMath\s*\.\s*random\s*\(/],
  ['new_date', /\bnew\s+Date\s*\(/],
  ['process_env', /\bprocess\s*\.\s*env\b/],
  ['process_exit', /\bprocess\s*\.\s*exit\s*\(/],
  ['global_this', /\bglobalThis\b/],
  ['constructor_escape', /\bconstructor\s*\.\s*constructor\b/],
  ['proto_escape', /\b__proto__\b/],
  ['eval', /\beval\s*\(/],
  ['function_constructor', /\bFunction\s*\(/],
  ['electron_ipc', /\bipc(?:Renderer|Main)\b/],
  ['socket', /\bnet\s*\.\s*connect\s*\(/],
];

export function normalizeWorkflowScript(script: string): string {
  if (typeof script !== 'string') {
    throw scriptError('workflow_script_required', 'workflow script must be a string');
  }
  let text = script.trim();
  const fence = text.match(/^```(?:js|javascript)?\s*\n([\s\S]*?)\n```$/i);
  if (fence) text = fence[1].trim();
  return text;
}

export function parseWorkflowScript(script: string): ParsedWorkflowScript {
  const text = normalizeWorkflowScript(script);
  const match = /^export\s+const\s+meta\s*=\s*/.exec(text);
  if (!match) {
    throw scriptError('workflow_script_meta_first_required', 'script must start with export const meta = {...}');
  }

  const parser = new LiteralParser(text, match[0].length);
  let meta: unknown;
  try {
    meta = parser.parseValue();
    parser.skipSpaceAndComments();
    if (parser.peek() === ';') {
      parser.index += 1;
      parser.skipSpaceAndComments();
    }
  } catch (error) {
    if (hasCode(error)) throw error;
    throw scriptError('workflow_script_meta_literal_required', error instanceof Error ? error.message : 'meta must be a literal object');
  }

  const metaValidation = validateWorkflowMeta(meta);
  if (!metaValidation.ok) {
    throw scriptError(metaValidation.error, metaValidation.error);
  }

  return {
    meta: metaValidation.meta,
    body: text.slice(parser.index).trimStart(),
    script: text,
  };
}

export function validateWorkflowScript(
  script: string,
  { policy = {} }: { policy?: WorkflowScriptValidationPolicy } = {},
): WorkflowScriptValidationResult {
  let text: string;
  try {
    text = normalizeWorkflowScript(script);
  } catch (error) {
    return errorResult(error);
  }

  const limits: Required<WorkflowScriptValidationPolicy> = { ...DEFAULT_SCRIPT_POLICY, ...policy };
  const byteLength = Buffer.byteLength(text, 'utf8');
  if (byteLength > limits.maxScriptBytes) {
    return {
      ok: false,
      error: 'workflow_script_size_exceeded',
      limit: limits.maxScriptBytes,
      actual: byteLength,
    };
  }

  let parsed: ParsedWorkflowScript;
  try {
    parsed = parseWorkflowScript(text);
  } catch (error) {
    return errorResult(error);
  }

  const forbidden = findForbiddenApi(parsed.body);
  if (forbidden) {
    return {
      ok: false,
      error: 'workflow_script_forbidden_api',
      api: forbidden,
    };
  }

  if (hasEagerParallelAgentCall(parsed.body)) {
    return {
      ok: false,
      error: 'workflow_script_parallel_thunk_required',
    };
  }

  const analysis = analyzeWorkflowScriptBody(parsed.body);
  if (analysis.agentCallCount === 0) {
    return {
      ok: false,
      error: 'workflow_script_agent_required',
    };
  }
  if (analysis.agentCallCount > limits.maxAgentCalls) {
    return {
      ok: false,
      error: 'workflow_script_agent_limit_exceeded',
      limit: limits.maxAgentCalls,
      actual: analysis.agentCallCount,
    };
  }

  return {
    ok: true,
    normalized: {
      meta: parsed.meta,
      scriptHash: hashWorkflowScript(text),
      analysis,
      policy: limits,
    },
  };
}

export function createWorkflowScriptPreview(
  script: string,
  {
    projectId,
    taskId = null,
    requestedBy = 'human',
    now = Date.now(),
    policy = {},
  }: {
    projectId?: string;
    taskId?: string | null;
    requestedBy?: string;
    now?: number;
    policy?: WorkflowScriptValidationPolicy;
  } = {},
): WorkflowScriptPreview {
  if (!projectId) return { ok: false, error: 'project_id_required' };
  const validation = validateWorkflowScript(script, { policy });
  if (!validation.ok) return validation;

  const { meta, scriptHash, analysis } = validation.normalized;
  const phases = Array.isArray(meta.phases) && meta.phases.length > 0
    ? meta.phases.map((phase, index) => ({
        id: `phase-${index + 1}`,
        title: phase.title,
        detail: phase.detail || null,
      }))
    : analysis.runtimePhaseTitles.map((title, index) => ({
        id: `phase-${index + 1}`,
        title,
        detail: null,
      }));

  return {
    ok: true,
    workflowId: meta.name,
    source: 'script_generated',
    strategy: 'workflow',
    status: 'pending_confirmation',
    projectId,
    scope: taskId ? { projectId, taskId } : { projectId },
    requestedBy,
    createdAt: now,
    title: meta.description,
    description: meta.description,
    meta,
    phases,
    scriptHash,
    analysis,
  };
}

function hasEagerParallelAgentCall(body: string): boolean {
  const stripped = stripStringsAndComments(body);
  return /\bparallel\s*\(\s*\[\s*(?:await\s+)?agent\s*\(/.test(stripped)
    || /,\s*(?:await\s+)?agent\s*\(/.test(stripped.match(/\bparallel\s*\(\s*\[[\s\S]*?\]\s*(?:,|\))/)?.[0] || '');
}

function validateWorkflowMeta(meta: unknown): { ok: true; meta: WorkflowScriptMeta } | { ok: false; error: string } {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return { ok: false, error: 'workflow_script_meta_object_required' };
  const value = meta as Partial<WorkflowScriptMeta>;
  if (typeof value.name !== 'string' || !value.name.trim()) return { ok: false, error: 'workflow_script_meta_name_required' };
  if (!/^[a-z][a-z0-9_]{1,80}$/.test(value.name)) return { ok: false, error: 'workflow_script_meta_name_invalid' };
  if (typeof value.description !== 'string' || !value.description.trim()) return { ok: false, error: 'workflow_script_meta_description_required' };
  if (value.whenToUse !== undefined && typeof value.whenToUse !== 'string') return { ok: false, error: 'workflow_script_meta_when_to_use_invalid' };
  if (value.phases !== undefined) {
    if (!Array.isArray(value.phases)) return { ok: false, error: 'workflow_script_meta_phases_invalid' };
    for (const phase of value.phases) {
      if (!phase || typeof phase !== 'object' || Array.isArray(phase)) return { ok: false, error: 'workflow_script_meta_phase_invalid' };
      if (typeof phase.title !== 'string' || !phase.title.trim()) return { ok: false, error: 'workflow_script_meta_phase_title_required' };
      if (phase.detail !== undefined && typeof phase.detail !== 'string') return { ok: false, error: 'workflow_script_meta_phase_detail_invalid' };
      if (phase.model !== undefined && typeof phase.model !== 'string') return { ok: false, error: 'workflow_script_meta_phase_model_invalid' };
    }
  }
  return { ok: true, meta: value as WorkflowScriptMeta };
}

function analyzeWorkflowScriptBody(body: string): WorkflowScriptAnalysis {
  const stripped = stripStringsAndComments(body);
  return {
    agentCallCount: countNamedCalls(stripped, 'agent'),
    phaseCallCount: countNamedCalls(stripped, 'phase'),
    parallelCallCount: countNamedCalls(stripped, 'parallel'),
    pipelineCallCount: countNamedCalls(stripped, 'pipeline'),
    requestUserInputCallCount: countDottedCalls(stripped, 'workflow', 'requestUserInput'),
    runtimePhaseTitles: collectRuntimePhaseTitles(body),
  };
}

function findForbiddenApi(body: string): string | null {
  const stripped = stripStringsAndComments(body);
  for (const [api, pattern] of FORBIDDEN_API_PATTERNS) {
    if (pattern.test(stripped)) return api;
  }
  return null;
}

function countNamedCalls(source: string, name: string): number {
  const pattern = new RegExp(`\\b${escapeRegExp(name)}\\s*\\(`, 'g');
  return [...source.matchAll(pattern)].length;
}

function countDottedCalls(source: string, objectName: string, methodName: string): number {
  const pattern = new RegExp(`\\b${escapeRegExp(objectName)}\\s*\\.\\s*${escapeRegExp(methodName)}\\s*\\(`, 'g');
  return [...source.matchAll(pattern)].length;
}

function collectRuntimePhaseTitles(body: string): string[] {
  const titles: string[] = [];
  const pattern = /\bphase\s*\(\s*(['"`])((?:\\.|(?!\1).)*?)\1\s*\)/g;
  for (const match of body.matchAll(pattern)) {
    if (match[1] === '`' && match[2].includes('${')) continue;
    const title = decodeSimpleString(match[2]).trim();
    if (title && !titles.includes(title)) titles.push(title);
  }
  return titles;
}

function stripStringsAndComments(source: string): string {
  let out = '';
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (char === '/' && next === '/') {
      out += '  ';
      index += 2;
      while (index < source.length && source[index] !== '\n') {
        out += ' ';
        index += 1;
      }
      continue;
    }
    if (char === '/' && next === '*') {
      out += '  ';
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        out += source[index] === '\n' ? '\n' : ' ';
        index += 1;
      }
      if (index < source.length) {
        out += '  ';
        index += 2;
      }
      continue;
    }
    if (char === '\'' || char === '"' || char === '`') {
      const quote = char;
      out += ' ';
      index += 1;
      while (index < source.length) {
        if (source[index] === '\\') {
          out += '  ';
          index += 2;
          continue;
        }
        if (source[index] === quote) {
          out += ' ';
          index += 1;
          break;
        }
        out += source[index] === '\n' ? '\n' : ' ';
        index += 1;
      }
      continue;
    }
    out += char;
    index += 1;
  }
  return out;
}

function hashWorkflowScript(script: string): string {
  return createHash('sha256').update(script).digest('hex');
}

function errorResult(error: unknown): WorkflowScriptValidationResult {
  return {
    ok: false,
    error: hasCode(error) ? error.code : 'workflow_script_invalid',
    message: error instanceof Error ? error.message : String(error),
  };
}

function scriptError(code: string, message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

function hasCode(error: unknown): error is Error & { code: string } {
  return error instanceof Error && typeof (error as { code?: unknown }).code === 'string';
}

function escapeRegExp(value: string): string {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decodeSimpleString(value: string): string {
  return String(value)
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '\r')
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

class LiteralParser {
  public index: number;

  public constructor(
    private readonly source: string,
    index = 0,
  ) {
    this.index = index;
  }

  public parseValue(): unknown {
    this.skipSpaceAndComments();
    const char = this.peek();
    if (char === '{') return this.parseObject();
    if (char === '[') return this.parseArray();
    if (char === '\'' || char === '"' || char === '`') return this.parseString();
    if (char === '-' || isDigit(char)) return this.parseNumber();
    if (this.consumeWord('true')) return true;
    if (this.consumeWord('false')) return false;
    if (this.consumeWord('null')) return null;
    throw scriptError('workflow_script_meta_literal_required', `unsupported literal at ${this.index}`);
  }

  public skipSpaceAndComments(): void {
    while (this.index < this.source.length) {
      if (/\s/.test(this.source[this.index])) {
        this.index += 1;
        continue;
      }
      if (this.source[this.index] === '/' && this.source[this.index + 1] === '/') {
        this.index += 2;
        while (this.index < this.source.length && this.source[this.index] !== '\n') this.index += 1;
        continue;
      }
      if (this.source[this.index] === '/' && this.source[this.index + 1] === '*') {
        this.index += 2;
        while (this.index < this.source.length && !(this.source[this.index] === '*' && this.source[this.index + 1] === '/')) {
          this.index += 1;
        }
        if (this.index < this.source.length) this.index += 2;
        continue;
      }
      break;
    }
  }

  public peek(): string {
    return this.source[this.index] || '';
  }

  private parseObject(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    this.expect('{');
    this.skipSpaceAndComments();
    while (this.peek() !== '}') {
      if (!this.peek()) throw scriptError('workflow_script_meta_literal_required', 'unterminated object literal');
      if (this.source.startsWith('...', this.index) || this.peek() === '[') {
        throw scriptError('workflow_script_meta_literal_required', 'spread or computed keys are not allowed');
      }
      const key = this.parseKey();
      if (RESERVED_META_KEYS.has(key)) {
        throw scriptError('workflow_script_meta_literal_required', `reserved key name not allowed: ${key}`);
      }
      this.skipSpaceAndComments();
      this.expect(':');
      out[key] = this.parseValue();
      this.skipSpaceAndComments();
      if (this.peek() === ',') {
        this.index += 1;
        this.skipSpaceAndComments();
        if (this.peek() === '}') break;
        continue;
      }
      if (this.peek() !== '}') throw scriptError('workflow_script_meta_literal_required', 'object entries must be comma separated');
    }
    this.expect('}');
    return out;
  }

  private parseArray(): unknown[] {
    const out: unknown[] = [];
    this.expect('[');
    this.skipSpaceAndComments();
    while (this.peek() !== ']') {
      if (!this.peek()) throw scriptError('workflow_script_meta_literal_required', 'unterminated array literal');
      if (this.source.startsWith('...', this.index) || this.peek() === ',') {
        throw scriptError('workflow_script_meta_literal_required', 'spread or sparse arrays are not allowed');
      }
      out.push(this.parseValue());
      this.skipSpaceAndComments();
      if (this.peek() === ',') {
        this.index += 1;
        this.skipSpaceAndComments();
        if (this.peek() === ']') break;
        continue;
      }
      if (this.peek() !== ']') throw scriptError('workflow_script_meta_literal_required', 'array entries must be comma separated');
    }
    this.expect(']');
    return out;
  }

  private parseKey(): string {
    this.skipSpaceAndComments();
    const char = this.peek();
    if (char === '\'' || char === '"' || char === '`') return String(this.parseString());
    const match = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(this.source.slice(this.index));
    if (!match) throw scriptError('workflow_script_meta_literal_required', `unsupported object key at ${this.index}`);
    this.index += match[0].length;
    return match[0];
  }

  private parseString(): string {
    const quote = this.peek();
    this.index += 1;
    let out = '';
    while (this.index < this.source.length) {
      const char = this.source[this.index];
      if (char === quote) {
        this.index += 1;
        return out;
      }
      if (quote === '`' && char === '$' && this.source[this.index + 1] === '{') {
        throw scriptError('workflow_script_meta_literal_required', 'template interpolation is not allowed in metadata');
      }
      if (char === '\\') {
        const next = this.source[this.index + 1];
        out += decodeEscape(next);
        this.index += 2;
        continue;
      }
      out += char;
      this.index += 1;
    }
    throw scriptError('workflow_script_meta_literal_required', 'unterminated string literal');
  }

  private parseNumber(): number {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?/.exec(this.source.slice(this.index));
    if (!match) throw scriptError('workflow_script_meta_literal_required', `invalid number at ${this.index}`);
    this.index += match[0].length;
    return Number(match[0]);
  }

  private consumeWord(word: string): boolean {
    if (!this.source.startsWith(word, this.index)) return false;
    const after = this.source[this.index + word.length];
    if (after && /[A-Za-z0-9_$]/.test(after)) return false;
    this.index += word.length;
    return true;
  }

  private expect(char: string): void {
    this.skipSpaceAndComments();
    if (this.peek() !== char) {
      throw scriptError('workflow_script_meta_literal_required', `expected ${char} at ${this.index}`);
    }
    this.index += 1;
  }
}

function isDigit(char: string): boolean {
  return char >= '0' && char <= '9';
}

function decodeEscape(char: string | undefined): string {
  if (char === 'n') return '\n';
  if (char === 't') return '\t';
  if (char === 'r') return '\r';
  if (char === 'b') return '\b';
  if (char === 'f') return '\f';
  if (char === 'v') return '\v';
  return char || '';
}
