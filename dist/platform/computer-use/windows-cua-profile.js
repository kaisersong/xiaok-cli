/** Frozen from the actual Windows interactive MCP catalog, 2026-10-02.
 * Release 0.31.0 / commit 5272e492d61b96caf08e3bf434d91126c1f3dccc.
 * Whole-catalog SHA-256: 13dc5e2e7a7127bff6053099361709c9e17c583f573d68c0c3ebe1195e3c6374.
 * Windows accepts element_token, never the macOS element_index/snapshot_id fields.
 */
const types = Object.freeze({
    pid: 'integer', window_id: 'integer', max_depth: 'integer', max_elements: 'integer',
    max_dimension: 'integer', max_image_dimension: 'integer', timeout_ms: 'integer',
    count: 'integer', duration_ms: 'integer', steps: 'integer', delay_ms: 'integer', amount: 'integer',
    include_screenshot: 'boolean', include_accessibility_tree: 'boolean', on_screen_only: 'boolean',
    x: 'number', y: 'number', from_x: 'number', from_y: 'number', to_x: 'number', to_y: 'number',
    modifier: 'array', modifiers: 'array', urls: 'array', session: 'string', query: 'string',
    element_token: 'string', capture_id: 'string', button: 'string', delivery_mode: 'string',
    scope: 'string', direction: 'string', by: 'string', text: 'string', key: 'string', value: 'string',
});
const enums = Object.freeze({
    button: Object.freeze(['left', 'right', 'middle']), delivery_mode: Object.freeze(['background', 'foreground']),
    scope: Object.freeze(['window', 'desktop']), direction: Object.freeze(['up', 'down', 'left', 'right']),
    by: Object.freeze(['line', 'page']),
});
const windowFields = ['pid', 'window_id', 'element_token', 'session', 'delivery_mode'];
function contract(action, operation, required, allowed, extra = {}) {
    return Object.freeze({ action, backendOperation: operation, backendRequired: Object.freeze(required),
        translatorAllowed: Object.freeze(allowed), backendOnlyExcluded: Object.freeze([]), acceptsSnapshotTargeting: false, ...extra });
}
const background = Object.freeze({ delivery_mode: 'background' });
const windowScope = Object.freeze({ scope: 'window' });
const pair = Object.freeze([Object.freeze(['x', 'y'])]);
const observation = ['pid', 'window_id', 'include_screenshot', 'include_accessibility_tree', 'max_depth', 'max_elements', 'max_dimension', 'max_image_dimension', 'timeout_ms', 'query', 'session'];
const click = [...windowFields, 'x', 'y', 'button', 'count', 'modifier', 'scope', 'capture_id'];
const contracts = Object.freeze([
    contract('capture', 'get_window_state', ['pid', 'window_id'], [...observation], { forced: Object.freeze({ include_screenshot: true }) }),
    contract('screenshot', 'get_window_state', ['pid', 'window_id'], [...observation], { forced: Object.freeze({ include_screenshot: true }) }),
    contract('list_apps', 'list_apps', [], ['session']),
    contract('list_windows', 'list_windows', [], ['pid', 'on_screen_only', 'session']),
    contract('open_url', 'launch_app', [], ['urls']),
    contract('click', 'click', [], [...click], { defaults: background, forced: windowScope, pixelPairs: pair }),
    contract('middle_click', 'click', [], [...click], { defaults: background, forced: Object.freeze({ ...windowScope, button: 'middle' }), pixelPairs: pair }),
    contract('double_click', 'double_click', ['pid'], [...windowFields, 'x', 'y', 'modifier'], { defaults: background, pixelPairs: pair }),
    contract('right_click', 'right_click', ['pid'], [...windowFields, 'x', 'y', 'modifier'], { defaults: background, pixelPairs: pair }),
    contract('drag', 'drag', ['from_x', 'from_y', 'to_x', 'to_y'], ['pid', 'window_id', 'session', 'delivery_mode', 'scope', 'from_x', 'from_y', 'to_x', 'to_y', 'button', 'duration_ms', 'steps', 'modifier'], {
        defaults: background, forced: windowScope, renames: Object.freeze({ x: 'from_x', y: 'from_y' }),
        pixelPairs: Object.freeze([Object.freeze(['from_x', 'from_y']), Object.freeze(['to_x', 'to_y'])]),
    }),
    contract('scroll', 'scroll', ['direction'], [...windowFields, 'x', 'y', 'scope', 'amount', 'by', 'direction'], { defaults: background, forced: windowScope, renames: Object.freeze({ pages: 'amount' }), pixelPairs: pair }),
    contract('type', 'type_text', ['text'], [...windowFields, 'x', 'y', 'scope', 'text', 'delay_ms'], { defaults: background, forced: windowScope, pixelPairs: pair }),
    contract('key', 'press_key', ['key'], [...windowFields, 'x', 'y', 'scope', 'key', 'modifiers'], { defaults: background, forced: windowScope, pixelPairs: pair }),
    contract('set_value', 'set_value', ['pid', 'value'], [...windowFields, 'value'], { defaults: background }),
]);
const expectedProperties = {};
for (const c of contracts) {
    expectedProperties[c.backendOperation] = Object.freeze(Object.fromEntries(c.translatorAllowed.map(field => [field,
        Object.freeze({ type: types[field], ...(enums[field] ? { enum: enums[field] } : {}) })])));
}
export const WINDOWS_CUA_ABI_PROFILE = Object.freeze({
    id: 'windows-x64-0.31.0', platform: 'win32', contracts,
    absentOperations: Object.freeze(['screenshot', 'middle_click']),
    snapshotIdPattern: Object.freeze(/^w[0-9a-f]{32}:s[0-9a-f]{8}$/),
    expectedProperties: Object.freeze(expectedProperties),
});
