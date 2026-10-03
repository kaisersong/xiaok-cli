import { randomBytes } from 'node:crypto';
import type { McpRuntimeToolResult } from '../../ai/mcp/runtime/client.js';
import { validateComputerUsePng } from './cua-png.js';
import { WINDOWS_CUA_ABI_PROFILE } from './windows-cua-profile.js';
import { InvalidComputerUseInputError } from './cua-action-contract.js';
import { validatedBrowserUrl } from './windows-cua-url.js';

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
function foregroundKey(operation: string | undefined, input: Readonly<Record<string, unknown>>): string {
  const a = address(input);
  // click and middle_click share a native operation. A refusal for one button
  // must not authorize a different button's foreground action.
  const button = operation === 'click' ? `:${input.button ?? 'left'}:${input.count ?? 1}` : '';
  return `${a.pid}:${a.window_id}:${operation}${button}`;
}
interface EditRegion { x: number; y: number; w: number; h: number }
interface Observation { snapshot: string; capture: string; width: number; height: number; indices: Map<number, string>; tokens: Map<string, string>; edits: EditRegion[]; webTokens: Set<string>; webRegions: EditRegion[] }

/** Never reuses driver tokens across a host generation, even if raw IDs repeat. */
export class WindowsCuaObservationStore {
  private nonce = randomBytes(16).toString('hex');
  private foregroundGrants = new Set<string>();
  private observations = new Map<string, Observation>();
  reset(): void { this.nonce = randomBytes(16).toString('hex'); this.observations.clear(); this.foregroundGrants.clear(); }
  recordOutcome(operation: string, input: Readonly<Record<string, unknown>>, result: McpRuntimeToolResult): void {
    const key = foregroundKey(operation, input);
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
  backgroundDragRequiresMouse(input: Readonly<Record<string, unknown>>): boolean {
    if (input.delivery_mode !== 'background') return false;
    const a = address(input); const observation = this.observations.get(`${a.pid}:${a.window_id}`);
    const x = input.from_x; const y = input.from_y;
    return typeof x === 'number' && typeof y === 'number' && Boolean(observation?.edits.some(
      rect => x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h,
    ));
  }
  backgroundGestureRequiresMouse(operation: string, input: Readonly<Record<string, unknown>>): boolean {
    if (input.delivery_mode !== 'background') return false;
    const complex = ['double_click', 'right_click'].includes(operation)
      || (operation === 'click' && (input.button === 'right' || Number(input.count ?? 1) > 1));
    if (!complex) return false;
    const a = address(input); const observation = this.observations.get(`${a.pid}:${a.window_id}`);
    if (typeof input.element_token === 'string') return !observation?.webTokens.has(input.element_token);
    const x = input.x; const y = input.y;
    return !(typeof x === 'number' && typeof y === 'number' && observation?.webRegions.some(
      rect => x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h,
    ));
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
    const indices = new Map<number, string>(); const tokens = new Map<string, string>(); const edits: EditRegion[] = [];
    const webTokens = new Set<string>(); const webRegions: EditRegion[] = [];
    const elements = raw.elements.map(value => {
      const element = object(value); const index = element?.element_index; const token = element?.element_token;
      if (!element || typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0 || indices.has(index)
        || token !== `${raw.snapshot_id}:${index}`) throw error('COMPUTER_USE_OBSERVATION_INVALID');
      const publicToken = `w${this.nonce}:${token}`;
      indices.set(index, token as string); tokens.set(publicToken, token as string);
      if (element.in_web_content === true) webTokens.add(token as string);
      const frame = object(element.screenshot_frame);
      if (frame && ['x', 'y', 'w', 'h'].every(k => typeof frame[k] === 'number' && Number.isFinite(frame[k]))
        && (frame.w as number) > 0 && (frame.h as number) > 0) {
        const rect = { x: frame.x as number, y: frame.y as number, w: frame.w as number, h: frame.h as number };
        if (element.role === 'Edit') edits.push(rect);
        if (element.in_web_content === true) webRegions.push(rect);
      }
      return { ...element, element_token: publicToken };
    });
    if (this.observations.size >= 16) this.observations.delete(this.observations.keys().next().value!);
    this.observations.set(key, { snapshot, capture, width: png.width, height: png.height, indices, tokens, edits, webTokens, webRegions });
    return { ...result, structuredContent: { ...raw, snapshot_id: snapshot, capture_id: capture, elements } };
  }
  prepare(action: string, input: Readonly<Record<string, unknown>>): Record<string, unknown> {
    if (action === 'open_url') {
      if (Object.keys(input).some(field => field !== 'url')) throw new InvalidComputerUseInputError('open_url accepts only url');
      return { urls: [validatedBrowserUrl(input.url)] };
    }
    if (['capture', 'screenshot', 'list_apps', 'list_windows'].includes(action)) return { ...input };
    const a = address(input); const observation = this.observations.get(`${a.pid}:${a.window_id}`);
    if (!observation) throw error('COMPUTER_USE_REOBSERVE_REQUIRED');
    const mode = input.delivery_mode ?? 'background';
    if (mode !== 'background' && mode !== 'foreground') throw new InvalidComputerUseInputError('invalid delivery_mode');
    const contract = WINDOWS_CUA_ABI_PROFILE.contracts.find(contract => contract.action === action);
    const grant = foregroundKey(contract?.backendOperation, { ...input, ...contract?.forced });
    if (mode === 'foreground' && !this.foregroundGrants.has(grant)) throw new InvalidComputerUseInputError('foreground requires a background_unavailable response for this target and operation');
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
