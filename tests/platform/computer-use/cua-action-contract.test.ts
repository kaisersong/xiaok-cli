import { describe, expect, it } from 'vitest';
import {
  CUA_ACTION_CONTRACTS,
  InvalidComputerUseInputError,
  translateCuaAction,
  verifyBackendAbi,
  type BackendOperationSchema,
} from '../../../src/platform/computer-use/cua-action-contract.js';

/**
 * Design v58 §6.1. Real `cua-driver 0.19.3` has no standalone `screenshot` or
 * `middle_click`, and its per-operation required sets differ, so a generic
 * pass-through wrapper reports "ready" and then fails at call time.
 */
describe('CUA translator — alias operations', () => {
  it('routes screenshot and capture to get_window_state with include_screenshot', () => {
    for (const action of ['capture', 'screenshot']) {
      const { operation, input } = translateCuaAction(action, { pid: 501, window_id: 12 });
      expect(operation).toBe('get_window_state');
      expect(input).toEqual({ pid: 501, window_id: 12, include_screenshot: true });
    }
  });

  it('routes middle_click to click with button:middle', () => {
    const { operation, input } = translateCuaAction('middle_click', { pid: 501, x: 10, y: 20 });
    expect(operation).toBe('click');
    expect(input).toMatchObject({ button: 'middle', x: 10, y: 20 });
  });

  it('never forwards the backend-only click `action` property', () => {
    const { input } = translateCuaAction('click', { action: 'click', pid: 501, x: 1, y: 2 });
    expect(input).not.toHaveProperty('action');
  });

  it('renames drag coordinates and requires all four', () => {
    const { operation, input } = translateCuaAction('drag', {
      x: 5, y: 6, to_x: 50, to_y: 60, pid: 501,
    });
    expect(operation).toBe('drag');
    expect(input).toMatchObject({ from_x: 5, from_y: 6, to_x: 50, to_y: 60 });

    expect(() => translateCuaAction('drag', { x: 5, y: 6, pid: 501 }))
      .toThrow(/requires to_x/);
  });

  it('renames scroll pages to amount and keeps direction required', () => {
    const { input } = translateCuaAction('scroll', { direction: 'down', pages: 3, pid: 501 });
    expect(input).toMatchObject({ direction: 'down', amount: 3 });

    expect(() => translateCuaAction('scroll', { pages: 3, pid: 501 })).toThrow(/requires direction/);
  });

  it('rejects the removed javascript field instead of passing it through', () => {
    expect(() => translateCuaAction('click', { javascript: 'alert(1)', pid: 1 }))
      .toThrow(/javascript is not supported/);
  });
});

describe('CUA translator — per-operation required fields', () => {
  it('keeps pid required for double_click and right_click even with a token', () => {
    for (const action of ['double_click', 'right_click']) {
      expect(() => translateCuaAction(action, { element_token: 'tok-1' }))
        .toThrow(/requires pid/);
      expect(translateCuaAction(action, { element_token: 'tok-1', pid: 501 }).input)
        .toMatchObject({ pid: 501, element_token: 'tok-1' });
    }
  });

  it('keeps pid and value required for set_value and rejects pixel coordinates', () => {
    expect(() => translateCuaAction('set_value', { pid: 501 })).toThrow(/requires value/);
    const { input } = translateCuaAction('set_value', { pid: 501, value: 'hello', x: 3, y: 4 });
    expect(input).toEqual({ pid: 501, value: 'hello' });
  });

  it('allows a token-only click but still requires payloads elsewhere', () => {
    expect(translateCuaAction('click', { element_token: 'tok' }).input).toEqual({ element_token: 'tok' });
    expect(() => translateCuaAction('type', { element_token: 'tok' })).toThrow(/requires text/);
    expect(() => translateCuaAction('key', { element_token: 'tok' })).toThrow(/requires key/);
  });

  it('requires paired pixel coordinates', () => {
    expect(() => translateCuaAction('click', { pid: 1, x: 10 })).toThrow(/x\/y must be provided together/);
    expect(translateCuaAction('click', { pid: 1, x: 10, y: 20 }).input).toMatchObject({ x: 10, y: 20 });
  });
});

describe('CUA translator — snapshot binding and identifiers', () => {
  it('requires a matching snapshot_id and window_id with element_index', () => {
    expect(() => translateCuaAction('click', { element_index: 4 }))
      .toThrow(/requires a matching snapshot_id/);
    expect(() => translateCuaAction('click', { element_index: 4, snapshot_id: 's1a2b3c4d' }))
      .toThrow(/requires window_id/);
    expect(translateCuaAction('click', {
      element_index: 4, snapshot_id: 's1a2b3c4d', window_id: 12,
    }).input).toMatchObject({ element_index: 4, snapshot_id: 's1a2b3c4d', window_id: 12 });
  });

  it('validates the snapshot_id pattern', () => {
    for (const bad of ['abc', 's123', 'S1A2B3C4', 's1a2b3c4dx']) {
      expect(() => translateCuaAction('click', {
        element_index: 1, window_id: 2, snapshot_id: bad,
      })).toThrow(/snapshot_id must match/);
    }
  });

  it('coerces decimal numeric strings for window_id and element_index but not pid', () => {
    const { input } = translateCuaAction('click', {
      window_id: '12', element_index: '3', snapshot_id: 's1a2b3c4d',
    });
    expect(input).toMatchObject({ window_id: 12, element_index: 3 });

    expect(() => translateCuaAction('capture', { pid: '501', window_id: 1 }))
      .toThrow(/pid must be a number/);
  });

  it('rejects float, hex and overflowing identifiers', () => {
    expect(() => translateCuaAction('capture', { pid: 1.5, window_id: 1 })).toThrow(/safe integer/);
    expect(() => translateCuaAction('click', { window_id: '0x10' })).toThrow(/decimal numeric string/);
    expect(() => translateCuaAction('click', { window_id: '99999999999999999999' }))
      .toThrow(/overflows a safe integer/);
  });

  it('drops wrapper-only routing fields', () => {
    const { input } = translateCuaAction('capture', {
      action: 'capture', app: 'Finder', capture_after: true, pid: 501, window_id: 1,
    });
    expect(input).toEqual({ pid: 501, window_id: 1, include_screenshot: true });
  });
});

describe('CUA activation ABI verification', () => {
  /** A catalog shaped like the real 0.19.3 legacy tools/list. */
  function realisticCatalog(): BackendOperationSchema[] {
    return [
      {
        name: 'get_window_state',
        required: ['pid', 'window_id'],
        properties: {
          capture_mode: { type: 'string' }, include_screenshot: { type: 'boolean' },
          max_depth: { type: 'integer' }, max_elements: { type: 'integer' },
          pid: { type: 'integer' }, query: { type: 'string' },
          screenshot_out_file: { type: 'string' }, session: { type: 'string' },
          window_id: { type: 'integer' },
        },
      },
      { name: 'list_apps', required: [], properties: {} },
      {
        name: 'list_windows',
        required: [],
        properties: { pid: { type: 'integer' }, on_screen_only: { type: 'boolean' } },
      },
      {
        name: 'click',
        required: [],
        properties: {
          action: { type: 'string' }, button: { type: 'string' }, count: { type: 'integer' },
          debug_image_out: { type: 'string' }, delivery_mode: { type: 'string' },
          element_index: { type: 'integer' }, element_token: { type: 'string' },
          from_zoom: { type: 'number' }, modifier: { type: 'string' }, pid: { type: 'integer' },
          scope: { type: 'string' }, session: { type: 'string' }, snapshot_id: { type: 'string' },
          window_id: { type: 'integer' }, x: { type: 'number' }, y: { type: 'number' },
        },
      },
      {
        name: 'double_click',
        required: ['pid'],
        properties: {
          delivery_mode: { type: 'string' }, element_index: { type: 'integer' },
          element_token: { type: 'string' }, pid: { type: 'integer' }, session: { type: 'string' },
          snapshot_id: { type: 'string' }, window_id: { type: 'integer' },
          x: { type: 'number' }, y: { type: 'number' },
        },
      },
      {
        name: 'right_click',
        required: ['pid'],
        properties: {
          delivery_mode: { type: 'string' }, element_index: { type: 'integer' },
          element_token: { type: 'string' }, modifier: { type: 'string' },
          pid: { type: 'integer' }, session: { type: 'string' }, snapshot_id: { type: 'string' },
          window_id: { type: 'integer' }, x: { type: 'number' }, y: { type: 'number' },
        },
      },
      {
        name: 'drag',
        required: ['from_x', 'from_y', 'to_x', 'to_y'],
        properties: {
          button: { type: 'string' }, delivery_mode: { type: 'string' },
          duration_ms: { type: 'integer' }, from_x: { type: 'number' }, from_y: { type: 'number' },
          from_zoom: { type: 'number' }, modifier: { type: 'string' }, pid: { type: 'integer' },
          scope: { type: 'string' }, session: { type: 'string' }, steps: { type: 'integer' },
          to_x: { type: 'number' }, to_y: { type: 'number' }, window_id: { type: 'integer' },
        },
      },
      {
        name: 'scroll',
        required: ['direction'],
        properties: {
          amount: { type: 'number' }, by: { type: 'string' }, delivery_mode: { type: 'string' },
          direction: { type: 'string' }, element_index: { type: 'integer' },
          element_token: { type: 'string' }, pid: { type: 'integer' }, scope: { type: 'string' },
          session: { type: 'string' }, snapshot_id: { type: 'string' },
          window_id: { type: 'integer' }, x: { type: 'number' }, y: { type: 'number' },
        },
      },
      {
        name: 'type_text',
        required: ['text'],
        properties: {
          delay_ms: { type: 'integer' }, delivery_mode: { type: 'string' },
          element_index: { type: 'integer' }, element_token: { type: 'string' },
          pid: { type: 'integer' }, scope: { type: 'string' }, session: { type: 'string' },
          snapshot_id: { type: 'string' }, text: { type: 'string' },
          window_id: { type: 'integer' }, x: { type: 'number' }, y: { type: 'number' },
        },
      },
      {
        name: 'press_key',
        required: ['key'],
        properties: {
          delivery_mode: { type: 'string' }, element_index: { type: 'integer' },
          element_token: { type: 'string' }, key: { type: 'string' },
          modifiers: { type: 'string' }, pid: { type: 'integer' }, scope: { type: 'string' },
          session: { type: 'string' }, snapshot_id: { type: 'string' },
          window_id: { type: 'integer' }, x: { type: 'number' }, y: { type: 'number' },
        },
      },
      {
        name: 'set_value',
        required: ['pid', 'value'],
        properties: {
          element_index: { type: 'integer' }, element_token: { type: 'string' },
          pid: { type: 'integer' }, session: { type: 'string' }, snapshot_id: { type: 'string' },
          value: { type: 'string' }, window_id: { type: 'integer' },
        },
      },
    ];
  }

  it('accepts a catalog matching the frozen contract table', () => {
    expect(verifyBackendAbi(realisticCatalog())).toEqual({ ok: true });
  });

  it('fails activation when an operation disappears', () => {
    const catalog = realisticCatalog().filter((op) => op.name !== 'set_value');
    const result = verifyBackendAbi(catalog);
    expect(result.ok).toBe(false);
    expect((result as { problems: string[] }).problems.join(' ')).toContain('missing backend operation set_value');
  });

  it('fails activation when a required set drifts', () => {
    const catalog = realisticCatalog().map((op) => (
      op.name === 'double_click' ? { ...op, required: [] } : op
    ));
    const result = verifyBackendAbi(catalog);
    expect((result as { problems: string[] }).problems.join(' ')).toContain('double_click required set');
  });

  it('fails activation when the backend-only click action gains an enum', () => {
    const catalog = realisticCatalog().map((op) => (
      op.name === 'click'
        ? { ...op, properties: { ...op.properties, action: { type: 'string', enum: ['click'] } } }
        : op
    ));
    const result = verifyBackendAbi(catalog);
    expect((result as { problems: string[] }).problems.join(' ')).toContain('enum-free string');
  });

  it('fails activation if the catalog ever grows a standalone screenshot op', () => {
    const catalog = [...realisticCatalog(), { name: 'screenshot', required: [], properties: {} }];
    const result = verifyBackendAbi(catalog);
    expect((result as { problems: string[] }).problems.join(' ')).toContain('unexpectedly exposes screenshot');
  });

  it('covers all thirteen public actions', () => {
    expect(CUA_ACTION_CONTRACTS).toHaveLength(13);
    expect(new Set(CUA_ACTION_CONTRACTS.map((c) => c.action)).size).toBe(13);
  });

  it('reports an unsupported public action as invalid input', () => {
    expect(() => translateCuaAction('teleport', {})).toThrow(InvalidComputerUseInputError);
  });
});
