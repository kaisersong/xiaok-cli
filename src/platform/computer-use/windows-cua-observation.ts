import { randomBytes } from 'node:crypto';
import type { McpRuntimeToolResult } from '../../ai/mcp/runtime/client.js';
import { validateComputerUsePng } from './cua-png.js';
import { WINDOWS_CUA_ABI_PROFILE } from './windows-cua-profile.js';
import { InvalidComputerUseInputError } from './cua-action-contract.js';

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function address(value: Readonly<Record<string, unknown>>): { pid: number; window_id: number } {
  const read = (field: string) => {
    const v = value[field]; const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v;
    if (typeof n !== 'number' || !Number.isSafeInteger(n) || n <= 0) throw new InvalidComputerUseInputError(`${field} must be a positive safe integer`);
    return n;
  };
  return { pid: read('pid'), window_id: read('window_id') };
}
function error(code: string): Error { return Object.assign(new Error(code), { code }); }
interface Observation { snapshot: string; capture: string; width: number; height: number; indices: Map<number, string>; tokens: Map<string, string> }

/** Never reuses driver tokens across a host generation, even if raw IDs repeat. */
export class WindowsCuaObservationStore {
  private nonce = randomBytes(16).toString('hex');
  private foregroundGrants = new Set<string>();
  private observations = new Map<string, Observation>();
  reset(): void { this.nonce = randomBytes(16).toString('hex'); this.observations.clear(); this.foregroundGrants.clear(); }
  recordOutcome(operation: string, input: Readonly<Record<string, unknown>>, result: McpRuntimeToolResult): void {
    const a = address(input); const key = `${a.pid}:${a.window_id}:${operation}`;
    this.foregroundGrants.delete(key);
    const structured = object(result.structuredContent);
    const escalation = object(structured?.escalation);
    if (input.delivery_mode === 'background' && result.isError && ['background_unavailable', 'background_occluded'].includes(String(structured?.code))
      && escalation?.recommended === 'foreground') {
      if (this.foregroundGrants.size >= 16) this.foregroundGrants.delete(this.foregroundGrants.values().next().value!);
      this.foregroundGrants.add(key);
    }
  }
  identity(input: Readonly<Record<string, unknown>>): object | undefined {
    const a = address(input); return this.observations.get(`${a.pid}:${a.window_id}`);
  }
  consume(input: Readonly<Record<string, unknown>>): void {
    const a = address(input); this.observations.delete(`${a.pid}:${a.window_id}`);
  }
  record(input: Readonly<Record<string, unknown>>, result: McpRuntimeToolResult): McpRuntimeToolResult {
    const a = address(input); const key = `${a.pid}:${a.window_id}`;
    this.observations.delete(key);
    const raw = object(result.structuredContent);
    if (!raw || raw.pid !== a.pid || raw.window_id !== a.window_id) throw error('COMPUTER_USE_OBSERVATION_TARGET_MISMATCH');
    if (result.isError || typeof raw.snapshot_id !== 'string' || !/^s[0-9a-f]{8}$/.test(raw.snapshot_id)
      || typeof raw.capture_id !== 'string' || !/^capture_[0-9a-f]{32}_[0-9a-f]{16}$/.test(raw.capture_id)
      || !Array.isArray(raw.elements) || result.images.length !== 1 || result.images[0].mimeType !== 'image/png'
      || !result.images[0].data || result.images[0].filePath) throw error('COMPUTER_USE_OBSERVATION_INVALID');
    const png = validateComputerUsePng(result.images[0].data);
    if (png.width !== raw.screenshot_width || png.height !== raw.screenshot_height) throw error('COMPUTER_USE_OBSERVATION_INVALID');
    const snapshot = `w${this.nonce}:${raw.snapshot_id}`;
    const capture = `w${this.nonce}:${raw.capture_id}`;
    const indices = new Map<number, string>(); const tokens = new Map<string, string>();
    const elements = raw.elements.map(value => {
      const element = object(value); const index = element?.element_index; const token = element?.element_token;
      if (!element || typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0 || indices.has(index)
        || token !== `${raw.snapshot_id}:${index}`) throw error('COMPUTER_USE_OBSERVATION_INVALID');
      const publicToken = `w${this.nonce}:${token}`;
      indices.set(index, token as string); tokens.set(publicToken, token as string);
      return { ...element, element_token: publicToken };
    });
    if (this.observations.size >= 16) this.observations.delete(this.observations.keys().next().value!);
    this.observations.set(key, { snapshot, capture, width: png.width, height: png.height, indices, tokens });
    return { ...result, structuredContent: { ...raw, snapshot_id: snapshot, capture_id: capture, elements } };
  }
  prepare(action: string, input: Readonly<Record<string, unknown>>): Record<string, unknown> {
    if (['capture', 'screenshot', 'list_apps', 'list_windows'].includes(action)) return { ...input };
    const a = address(input); const observation = this.observations.get(`${a.pid}:${a.window_id}`);
    if (!observation) throw error('COMPUTER_USE_REOBSERVE_REQUIRED');
    const mode = input.delivery_mode ?? 'background';
    if (mode !== 'background' && mode !== 'foreground') throw new InvalidComputerUseInputError('invalid delivery_mode');
    const operation = WINDOWS_CUA_ABI_PROFILE.contracts.find(contract => contract.action === action)?.backendOperation;
    const grant = `${a.pid}:${a.window_id}:${operation}`;
    if (mode === 'foreground' && !this.foregroundGrants.has(grant)) throw new InvalidComputerUseInputError('foreground requires a native background_unavailable response for this target and operation');
    const output: Record<string, unknown> = { ...input, ...a, delivery_mode: mode };
    if ((input.element_index !== undefined || input.element_token !== undefined) && ['x', 'y', 'to_x', 'to_y'].some(field => input[field] !== undefined)) {
      throw new InvalidComputerUseInputError('Use either element or pixel targeting for one action');
    }
    if (input.element_index !== undefined && input.element_token !== undefined) {
      throw new InvalidComputerUseInputError('Use either element_index or element_token for one action');
    }
    if (input.element_index !== undefined) {
      const index = typeof input.element_index === 'string' && /^\d+$/.test(input.element_index) ? Number(input.element_index) : input.element_index;
      const token = typeof index === 'number' ? observation.indices.get(index) : undefined;
      if (!token || input.snapshot_id !== observation.snapshot) throw error('COMPUTER_USE_REOBSERVE_REQUIRED');
      output.element_token = token;
    } else if (input.element_token !== undefined) {
      const token = typeof input.element_token === 'string' ? observation.tokens.get(input.element_token) : undefined;
      if (!token) throw error('COMPUTER_USE_REOBSERVE_REQUIRED');
      output.element_token = token;
    }
    if (input.capture_id !== undefined && input.capture_id !== observation.capture) throw error('COMPUTER_USE_REOBSERVE_REQUIRED');
    for (const [field, limit] of [['x', observation.width], ['y', observation.height], ['to_x', observation.width], ['to_y', observation.height]] as const) {
      const coordinate = input[field];
      if (coordinate !== undefined && (typeof coordinate !== 'number' || !Number.isFinite(coordinate) || coordinate < 0 || coordinate >= limit)) throw new InvalidComputerUseInputError(`${field} is outside the observed image`);
    }
    if ((action === 'click' || action === 'middle_click') && !output.element_token && input.x !== undefined && input.y !== undefined) {
      output.capture_id = observation.capture.slice(34);
    } else { delete output.capture_id; }
    if (mode === 'foreground') this.foregroundGrants.delete(grant);
    delete output.element_index; delete output.snapshot_id;
    return output;
  }
}
