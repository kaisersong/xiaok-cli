import type { CuaConnection } from '../mcp/cua-connection-manager.js';
import type { McpToolSchema } from '../../ai/mcp/client.js';
import {
  MACOS_CUA_ABI_PROFILE, InvalidComputerUseInputError, translateCuaAction, verifyBackendAbi,
  type BackendOperationSchema, type CuaAbiProfile,
} from './cua-action-contract.js';

// Frozen from the installed macOS 0.33.1 tools/list. Keep the public legacy
// vocabulary, but verify and send only fields supported by the native catalog.
const types: Readonly<Record<string, string>> = Object.freeze({
  pid: 'integer', window_id: 'integer', max_depth: 'integer', max_elements: 'integer',
  count: 'integer', duration_ms: 'integer', steps: 'integer', delay_ms: 'integer', amount: 'integer',
  x: 'number', y: 'number', from_x: 'number', from_y: 'number', to_x: 'number', to_y: 'number',
  include_screenshot: 'boolean', on_screen_only: 'boolean', from_zoom: 'boolean',
  modifier: 'array', modifiers: 'array', capture_mode: 'string', query: 'string',
  screenshot_out_file: 'string', session: 'string', button: 'string', delivery_mode: 'string',
  element_token: 'string', debug_image_out: 'string', scope: 'string', by: 'string',
  direction: 'string', text: 'string', key: 'string', value: 'string',
});
const enums: Readonly<Record<string, readonly string[]>> = Object.freeze({
  button: Object.freeze(['left', 'right', 'middle']),
  delivery_mode: Object.freeze(['background', 'foreground']),
  scope: Object.freeze(['window', 'desktop']), by: Object.freeze(['line', 'page']),
  direction: Object.freeze(['up', 'down', 'left', 'right']), capture_mode: Object.freeze(['ax', 'vision']),
});
const retired = ['element_index', 'snapshot_id'];
const contracts = Object.freeze(MACOS_CUA_ABI_PROFILE.contracts.map(contract => Object.freeze({
  ...contract,
  translatorAllowed: Object.freeze(contract.translatorAllowed.filter(field => !retired.includes(field))),
  acceptsSnapshotTargeting: false,
})));
const expectedProperties: NonNullable<CuaAbiProfile['expectedProperties']> = Object.freeze(Object.fromEntries(
  contracts.map(contract => [contract.backendOperation, Object.freeze(Object.fromEntries(
    contracts.filter(candidate => candidate.backendOperation === contract.backendOperation)
      .flatMap(candidate => candidate.translatorAllowed)
      .map(field => [field, Object.freeze({ type: types[field], ...(enums[field] ? { enum: enums[field] } : {}) })]),
  ))]),
));
export const MACOS_TOKEN_CUA_ABI_PROFILE: CuaAbiProfile = Object.freeze({
  ...MACOS_CUA_ABI_PROFILE, id: 'macos-0.33.1', contracts, expectedProperties,
});

export function macosCuaCatalog(schemas: readonly McpToolSchema[]): BackendOperationSchema[] {
  return schemas.map(schema => {
    const required = schema.inputSchema?.required ?? [];
    const properties = schema.inputSchema?.properties;
    if (!Array.isArray(required) || !required.every(field => typeof field === 'string')
      || !properties || typeof properties !== 'object' || Array.isArray(properties)
      || !Object.values(properties).every(value => value && typeof value === 'object' && !Array.isArray(value))) {
      throw new Error('CUA macOS ABI catalog invalid');
    }
    return { name: schema.name, required, properties } as BackendOperationSchema;
  });
}

export function selectMacosCuaAbiProfile(catalog: readonly BackendOperationSchema[]): CuaAbiProfile {
  const modern = verifyBackendAbi(catalog, MACOS_TOKEN_CUA_ABI_PROFILE);
  const fullyRetired = contracts.every(contract => {
    const op = catalog.find(candidate => candidate.name === contract.backendOperation);
    return op && retired.every(field => !(field in op.properties));
  });
  if (modern.ok && fullyRetired) return MACOS_TOKEN_CUA_ABI_PROFILE;
  const legacy = verifyBackendAbi(catalog, MACOS_CUA_ABI_PROFILE);
  if (legacy.ok) return MACOS_CUA_ABI_PROFILE;
  throw Object.assign(new Error(`CUA macOS ABI mismatch: ${[
    ...(!modern.ok ? modern.problems : ['partially retired element addressing']), ...legacy.problems,
  ].join('; ')}`), { code: 'COMPUTER_USE_MACOS_ABI_MISMATCH' });
}

/** Applied to every initial/replacement connection, before any native input. */
export function createMacosCuaConnection(catalog: readonly BackendOperationSchema[], connection: CuaConnection): CuaConnection {
  const profile = selectMacosCuaAbiProfile(catalog);
  return {
    dispose: () => connection.dispose(),
    async callToolResult(operation, input, options) {
      options?.signal?.throwIfAborted();
      // Internal lifecycle recovery only; this operation is never a public tool.
      if (operation === 'start_session' && catalog.some(op => op.name === operation)) {
        if (Object.keys(input).some(field => field !== 'session') || (input.session !== undefined && typeof input.session !== 'string')) {
          throw new InvalidComputerUseInputError('invalid internal session revival');
        }
        return connection.callToolResult(operation, input, options);
      }
      const contract = MACOS_CUA_ABI_PROFILE.contracts.find(candidate => candidate.backendOperation === operation);
      if (!contract) throw new InvalidComputerUseInputError(`unsupported native operation ${operation}`);
      const normalized = translateCuaAction(contract.action, input).input;
      if (profile === MACOS_TOKEN_CUA_ABI_PROFILE) {
        const indexed = normalized.element_index !== undefined;
        if ((indexed || normalized.element_token !== undefined) && ['x', 'y', 'to_x', 'to_y'].some(field => normalized[field] !== undefined)) {
          throw new InvalidComputerUseInputError('Use either element or pixel targeting');
        }
        if (indexed) {
          if (normalized.element_token !== undefined || (normalized.element_index as number) < 0) {
            throw new InvalidComputerUseInputError('invalid or ambiguous element_index');
          }
          normalized.element_token = `${normalized.snapshot_id}:${normalized.element_index}`;
        }
        if (normalized.element_token !== undefined && (typeof normalized.element_token !== 'string' || !/^s[0-9a-f]{8}:[0-9]+$/.test(normalized.element_token))) {
          throw new InvalidComputerUseInputError('invalid native element_token');
        }
        delete normalized.element_index;
        delete normalized.snapshot_id;
      }
      const translated = translateCuaAction(contract.action, normalized, profile);
      return connection.callToolResult(translated.operation, translated.input, options);
    },
  };
}
