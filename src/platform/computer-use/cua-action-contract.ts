/**
 * CUA action contract table (design v58 §6.1; R25-01, R26-01, R28-03, R34-01,
 * R44-04, R50-01).
 *
 * Why a table instead of "map the tool name and pass the rest through": the real
 * `cua-driver 0.19.3` legacy catalog has 54 operations and contains **no**
 * standalone `screenshot` or `middle_click`, requires `from_x/from_y/to_x/to_y`
 * for drag, `amount` for scroll, integer identifiers, and per-operation required
 * fields that differ (`double_click`/`right_click` need `pid`; `set_value` needs
 * `pid` + `value`; `click` needs none). Generic pass-through produced "ready"
 * providers that then failed with Unknown tool / schema errors.
 *
 * One table drives both activation (exact-set ABI verification) and execution
 * (translation), so they can never drift.
 */

export type PublicCuaAction =
  | 'capture' | 'screenshot' | 'list_apps' | 'list_windows'
  | 'click' | 'double_click' | 'right_click' | 'middle_click'
  | 'drag' | 'scroll' | 'type' | 'key' | 'set_value';

export interface CuaActionContract {
  readonly action: PublicCuaAction;
  readonly backendOperation: string;
  /** Backend fields this operation requires (exact set, per 0.19.3). */
  readonly backendRequired: readonly string[];
  /** Backend fields the translator may emit; the public reachable subset. */
  readonly translatorAllowed: readonly string[];
  /** Backend-only fields that must never be forwarded from public input. */
  readonly backendOnlyExcluded: readonly string[];
  /** Injected constants, e.g. include_screenshot / button:middle. */
  readonly forced?: Readonly<Record<string, unknown>>;
  /** Public → backend renames, e.g. x→from_x, pages→amount. */
  readonly renames?: Readonly<Record<string, string>>;
  /** Pixel coordinate pairs that must be provided together when present. */
  readonly pixelPairs?: readonly (readonly [string, string])[];
  readonly acceptsSnapshotTargeting: boolean;
}

const IDENTIFIER_FIELDS = Object.freeze(['pid', 'window_id', 'element_index']);
const SNAPSHOT_ID_PATTERN = /^s[0-9a-f]{8}$/;

const GET_WINDOW_STATE_ALLOWED = Object.freeze([
  'capture_mode', 'include_screenshot', 'max_depth', 'max_elements',
  'pid', 'query', 'screenshot_out_file', 'session', 'window_id',
]);

const CUA_ACTION_CONTRACT_LIST: CuaActionContract[] = [
  {
    action: 'capture',
    backendOperation: 'get_window_state',
    backendRequired: ['pid', 'window_id'],
    translatorAllowed: GET_WINDOW_STATE_ALLOWED,
    backendOnlyExcluded: [],
    forced: { include_screenshot: true },
    acceptsSnapshotTargeting: false,
  },
  {
    // Deliberately shares capture's translator: 0.19.3 has no `screenshot` op.
    action: 'screenshot',
    backendOperation: 'get_window_state',
    backendRequired: ['pid', 'window_id'],
    translatorAllowed: GET_WINDOW_STATE_ALLOWED,
    backendOnlyExcluded: [],
    forced: { include_screenshot: true },
    acceptsSnapshotTargeting: false,
  },
  {
    action: 'list_apps',
    backendOperation: 'list_apps',
    backendRequired: [],
    translatorAllowed: [],
    backendOnlyExcluded: [],
    acceptsSnapshotTargeting: false,
  },
  {
    action: 'list_windows',
    backendOperation: 'list_windows',
    backendRequired: [],
    translatorAllowed: ['pid', 'on_screen_only'],
    backendOnlyExcluded: [],
    acceptsSnapshotTargeting: false,
  },
  {
    action: 'click',
    backendOperation: 'click',
    backendRequired: [],
    translatorAllowed: [
      'button', 'count', 'debug_image_out', 'delivery_mode', 'element_index',
      'element_token', 'from_zoom', 'modifier', 'pid', 'scope', 'session',
      'snapshot_id', 'window_id', 'x', 'y',
    ],
    // Real 0.19.3 click has an optional backend `action: string`; it collides
    // with our public routing discriminator and must never be forwarded.
    backendOnlyExcluded: ['action'],
    pixelPairs: [['x', 'y']],
    acceptsSnapshotTargeting: true,
  },
  {
    action: 'double_click',
    backendOperation: 'double_click',
    backendRequired: ['pid'],
    translatorAllowed: [
      'delivery_mode', 'element_index', 'element_token', 'pid', 'session',
      'snapshot_id', 'window_id', 'x', 'y',
    ],
    backendOnlyExcluded: [],
    pixelPairs: [['x', 'y']],
    acceptsSnapshotTargeting: true,
  },
  {
    action: 'right_click',
    backendOperation: 'right_click',
    backendRequired: ['pid'],
    translatorAllowed: [
      'delivery_mode', 'element_index', 'element_token', 'modifier', 'pid',
      'session', 'snapshot_id', 'window_id', 'x', 'y',
    ],
    backendOnlyExcluded: [],
    pixelPairs: [['x', 'y']],
    acceptsSnapshotTargeting: true,
  },
  {
    action: 'middle_click',
    backendOperation: 'click',
    backendRequired: [],
    translatorAllowed: [
      'button', 'count', 'delivery_mode', 'element_index', 'element_token',
      'modifier', 'pid', 'scope', 'session', 'snapshot_id', 'window_id', 'x', 'y',
    ],
    backendOnlyExcluded: ['action'],
    forced: { button: 'middle' },
    pixelPairs: [['x', 'y']],
    acceptsSnapshotTargeting: true,
  },
  {
    action: 'drag',
    backendOperation: 'drag',
    backendRequired: ['from_x', 'from_y', 'to_x', 'to_y'],
    translatorAllowed: [
      'button', 'delivery_mode', 'duration_ms', 'from_x', 'from_y', 'from_zoom',
      'modifier', 'pid', 'scope', 'session', 'steps', 'to_x', 'to_y', 'window_id',
    ],
    backendOnlyExcluded: [],
    renames: { x: 'from_x', y: 'from_y' },
    pixelPairs: [['from_x', 'from_y'], ['to_x', 'to_y']],
    acceptsSnapshotTargeting: false,
  },
  {
    action: 'scroll',
    backendOperation: 'scroll',
    backendRequired: ['direction'],
    translatorAllowed: [
      'amount', 'by', 'delivery_mode', 'direction', 'element_index',
      'element_token', 'pid', 'scope', 'session', 'snapshot_id', 'window_id', 'x', 'y',
    ],
    backendOnlyExcluded: [],
    renames: { pages: 'amount' },
    pixelPairs: [['x', 'y']],
    acceptsSnapshotTargeting: true,
  },
  {
    action: 'type',
    backendOperation: 'type_text',
    backendRequired: ['text'],
    translatorAllowed: [
      'delay_ms', 'delivery_mode', 'element_index', 'element_token', 'pid',
      'scope', 'session', 'snapshot_id', 'text', 'window_id', 'x', 'y',
    ],
    backendOnlyExcluded: [],
    pixelPairs: [['x', 'y']],
    acceptsSnapshotTargeting: true,
  },
  {
    action: 'key',
    backendOperation: 'press_key',
    backendRequired: ['key'],
    translatorAllowed: [
      'delivery_mode', 'element_index', 'element_token', 'key', 'modifiers',
      'pid', 'scope', 'session', 'snapshot_id', 'window_id', 'x', 'y',
    ],
    backendOnlyExcluded: [],
    pixelPairs: [['x', 'y']],
    acceptsSnapshotTargeting: true,
  },
  {
    action: 'set_value',
    backendOperation: 'set_value',
    backendRequired: ['pid', 'value'],
    translatorAllowed: [
      'element_index', 'element_token', 'pid', 'session', 'snapshot_id',
      'value', 'window_id',
    ],
    backendOnlyExcluded: [],
    // set_value has no pixel path at all.
    acceptsSnapshotTargeting: true,
  },
];

export const CUA_ACTION_CONTRACTS: readonly CuaActionContract[] = Object.freeze(CUA_ACTION_CONTRACT_LIST);

/** Wrapper-only or compatibility fields that never reach the backend. */
export const WRAPPER_ONLY_FIELDS: readonly string[] = Object.freeze([
  'action', 'app', 'capture_after', 'pages', 'javascript',
]);

export class InvalidComputerUseInputError extends Error {
  readonly code = 'invalid_computer_use_input';

  constructor(detail: string) {
    super(`invalid_computer_use_input: ${detail}`);
    this.name = 'InvalidComputerUseInputError';
  }
}

export function contractFor(action: string): CuaActionContract {
  const found = CUA_ACTION_CONTRACTS.find((c) => c.action === action);
  if (!found) throw new InvalidComputerUseInputError(`unsupported action "${action}"`);
  return found;
}

/** Identifiers must end up as safe integers; decimal numeric strings coerce. */
function normalizeIdentifier(field: string, value: unknown): number {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new InvalidComputerUseInputError(`${field} must be a safe integer`);
    }
    return value;
  }
  if (field === 'pid') {
    // Public schema has always declared pid as a number; tighten it here.
    throw new InvalidComputerUseInputError('pid must be a number, not a string');
  }
  if (typeof value === 'string' && /^[0-9]+$/.test(value)) {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) {
      throw new InvalidComputerUseInputError(`${field} overflows a safe integer`);
    }
    return parsed;
  }
  throw new InvalidComputerUseInputError(`${field} must be an integer or a decimal numeric string`);
}

/**
 * Builds the backend payload from public input. It constructs a fresh object from
 * the allowed set — never "delete two keys and forward the rest".
 */
export function translateCuaAction(
  action: string,
  publicInput: Readonly<Record<string, unknown>>,
): { operation: string; input: Record<string, unknown> } {
  const contract = contractFor(action);

  if ('javascript' in publicInput) {
    throw new InvalidComputerUseInputError('javascript is not supported by cua-driver 0.19.3');
  }

  const renamed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(publicInput)) {
    if (value === undefined) continue;
    if (WRAPPER_ONLY_FIELDS.includes(key) && !(contract.renames && key in contract.renames)) continue;
    const target = contract.renames?.[key] ?? key;
    renamed[target] = value;
  }

  const output: Record<string, unknown> = {};
  for (const field of contract.translatorAllowed) {
    if (!(field in renamed)) continue;
    const value = renamed[field];
    if (IDENTIFIER_FIELDS.includes(field)) {
      output[field] = normalizeIdentifier(field, value);
      continue;
    }
    if (field === 'snapshot_id') {
      if (typeof value !== 'string' || !SNAPSHOT_ID_PATTERN.test(value)) {
        throw new InvalidComputerUseInputError('snapshot_id must match ^s[0-9a-f]{8}$');
      }
      output[field] = value;
      continue;
    }
    if (field === 'element_token' && typeof value !== 'string') {
      throw new InvalidComputerUseInputError('element_token must be a string');
    }
    output[field] = value;
  }

  for (const excluded of contract.backendOnlyExcluded) {
    delete output[excluded];
  }
  Object.assign(output, contract.forced ?? {});

  for (const [a, b] of contract.pixelPairs ?? []) {
    const hasA = a in output;
    const hasB = b in output;
    if (hasA !== hasB) {
      throw new InvalidComputerUseInputError(`${a}/${b} must be provided together`);
    }
  }

  // element_index only means anything together with its snapshot identity.
  if ('element_index' in output) {
    if (!contract.acceptsSnapshotTargeting) {
      throw new InvalidComputerUseInputError(`${action} does not accept element_index`);
    }
    if (!('snapshot_id' in output)) {
      throw new InvalidComputerUseInputError('element_index requires a matching snapshot_id');
    }
    if (!('window_id' in output)) {
      throw new InvalidComputerUseInputError('element_index requires window_id');
    }
  }

  const tokenOnly = 'element_token' in output;
  for (const field of contract.backendRequired) {
    if (field in output) continue;
    // A token replaces the snapshot/window triple, never an operation's own
    // required fields (design R34-01).
    if (tokenOnly && (field === 'window_id')) continue;
    throw new InvalidComputerUseInputError(`${contract.backendOperation} requires ${field}`);
  }

  return { operation: contract.backendOperation, input: output };
}

/** Activation-side ABI check against a real `tools/list` catalog. */
export interface BackendOperationSchema {
  readonly name: string;
  readonly required: readonly string[];
  readonly properties: Readonly<Record<string, { type?: string; enum?: readonly unknown[] }>>;
}

export type AbiVerification =
  | { ok: true }
  | { ok: false; code: 'activation_failed'; problems: readonly string[] };

export function verifyBackendAbi(catalog: readonly BackendOperationSchema[]): AbiVerification {
  const problems: string[] = [];
  const byName = new Map(catalog.map((op) => [op.name, op]));

  for (const contract of CUA_ACTION_CONTRACTS) {
    const op = byName.get(contract.backendOperation);
    if (!op) {
      problems.push(`missing backend operation ${contract.backendOperation} for action ${contract.action}`);
      continue;
    }
    const required = [...op.required].sort();
    const expected = [...contract.backendRequired].sort();
    if (JSON.stringify(required) !== JSON.stringify(expected)) {
      problems.push(
        `${contract.backendOperation} required set is [${required.join(',')}], expected [${expected.join(',')}]`,
      );
    }
    for (const field of contract.translatorAllowed) {
      if (!(field in op.properties)) {
        problems.push(`${contract.backendOperation} has no property ${field}`);
      }
    }
    for (const excluded of contract.backendOnlyExcluded) {
      const prop = op.properties[excluded];
      if (!prop) {
        problems.push(`${contract.backendOperation} lost backend-only property ${excluded}`);
        continue;
      }
      if (prop.type !== 'string' || prop.enum !== undefined) {
        problems.push(`${contract.backendOperation}.${excluded} must stay an enum-free string`);
      }
    }
  }

  // Operations the wrapper must never call because 0.19.3 does not have them.
  for (const absent of ['screenshot', 'middle_click']) {
    if (byName.has(absent)) {
      problems.push(`catalog unexpectedly exposes ${absent}; revisit the alias contract`);
    }
  }

  return problems.length === 0 ? { ok: true } : { ok: false, code: 'activation_failed', problems };
}
