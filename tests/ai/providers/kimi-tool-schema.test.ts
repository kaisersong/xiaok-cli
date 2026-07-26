import { describe, expect, it } from 'vitest';
import {
  KIMI_SCHEMA_LIMITS,
  KimiToolSchemaError,
  normalizeKimiToolSchema,
} from '../../../src/ai/providers/kimi-tool-schema.js';

function expectKimiError(
  action: () => unknown,
  code: KimiToolSchemaError['code'],
): KimiToolSchemaError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(KimiToolSchemaError);
    expect(error).toMatchObject({ code });
    return error as KimiToolSchemaError;
  }
  throw new Error(`Expected ${code}`);
}

function expectLimit(
  action: () => unknown,
  limitKind: KimiToolSchemaError['limitKind'],
): KimiToolSchemaError {
  const error = expectKimiError(action, 'KIMI_SCHEMA_LIMIT_EXCEEDED');
  expect(error.limitKind).toBe(limitKind);
  return error;
}

function schemaWithInputNodes(target: number): Record<string, unknown> {
  return {
    'x-padding': Array.from({ length: target - 2 }, () => null),
  };
}

function schemaWithObservedDepth(target: number): Record<string, unknown> {
  let value: unknown = null;
  for (let depth = 1; depth < target; depth += 1) {
    value = [value];
  }
  return { 'x-depth': value };
}

function schemaWithOutputBytes(target: number): Record<string, unknown> {
  return {
    x: 'a'.repeat(target - 8),
  };
}

function wideSharedRefSchema(extraRootNodes = 0): Record<string, unknown> {
  const schema: Record<string, unknown> = {
    $defs: {
      payload: {
        type: 'object',
        'x-padding': Array.from({ length: 113 }, () => null),
      },
    },
    properties: Object.fromEntries(
      Array.from({ length: 430 }, (_, index) => [
        `tool${index}`,
        { $ref: '#/$defs/payload' },
      ]),
    ),
  };
  for (let index = 0; index < extraRootNodes; index += 1) {
    schema[`extra${index}`] = null;
  }
  return schema;
}

function schemaWithRefExpansions(count: number): Record<string, unknown> {
  return {
    $defs: {
      value: { type: 'string' },
    },
    properties: Object.fromEntries(
      Array.from({ length: count }, (_, index) => [
        `value${index}`,
        { $ref: '#/$defs/value' },
      ]),
    ),
  };
}

function deepRefChainSchema(length: number): Record<string, unknown> {
  const definitions: Record<string, unknown> = {};
  for (let index = 0; index < length; index += 1) {
    definitions[`level${index}`] = index === length - 1
      ? { type: 'string' }
      : { $ref: `#/$defs/level${index + 1}` };
  }
  return {
    $defs: definitions,
    $ref: '#/$defs/level0',
  };
}

describe('normalizeKimiToolSchema type completion', () => {
  it.each([
    ['string enum', { enum: ['red', 'blue'] }, 'string'],
    ['integer enum', { enum: [1, 2] }, 'integer'],
    ['number enum', { enum: [1.5, 2.5] }, 'number'],
    ['integer and number enum', { enum: [1, 2.5] }, 'number'],
    ['boolean enum', { enum: [true, false] }, 'boolean'],
    ['object enum', { enum: [{ a: 1 }, { b: 2 }] }, 'object'],
    ['array enum', { enum: [[1], [2]] }, 'array'],
    ['null enum', { enum: [null, null] }, 'null'],
    ['string const', { const: 'fixed' }, 'string'],
    ['integer const', { const: 7 }, 'integer'],
    ['number const', { const: 7.25 }, 'number'],
  ] as const)('infers %s deterministically', (_label, child, expectedType) => {
    const result = normalizeKimiToolSchema({
      type: 'object',
      properties: { value: child },
    });

    expect(result.schema).toMatchObject({
      properties: {
        value: {
          ...child,
          type: expectedType,
        },
      },
    });
  });

  it('uses enum before const and rejects an incompatible const candidate', () => {
    expectKimiError(
      () => normalizeKimiToolSchema({
        type: 'object',
        properties: {
          value: {
            enum: ['left', 'right'],
            const: 1,
          },
        },
      }),
      'KIMI_SCHEMA_TYPE_INFERENCE_FAILED',
    );
  });

  it('rejects mixed candidates only when a missing type requires inference', () => {
    expectKimiError(
      () => normalizeKimiToolSchema({
        type: 'object',
        properties: {
          value: { enum: ['text', 1] },
        },
      }),
      'KIMI_SCHEMA_TYPE_INFERENCE_FAILED',
    );

    expect(normalizeKimiToolSchema({
      type: 'object',
      properties: {
        value: {
          type: 'string',
          enum: ['text', 1],
        },
      },
    }).schema).toMatchObject({
      properties: {
        value: {
          type: 'string',
          enum: ['text', 1],
        },
      },
    });
  });

  it.each([
    { enum: ['ok', undefined] },
    { const: Number.NaN },
    { const: 1n },
  ])('rejects non-JSON enum or const candidates locally', (candidate) => {
    expectKimiError(
      () => normalizeKimiToolSchema({
        type: 'object',
        properties: { value: candidate },
      }),
      'KIMI_SCHEMA_TYPE_INFERENCE_FAILED',
    );
  });

  it('keeps an empty root and fills an unconstrained nested schema as string', () => {
    expect(normalizeKimiToolSchema({}).schema).toEqual({});
    expect(normalizeKimiToolSchema({
      type: 'object',
      properties: { value: {} },
    }).schema).toEqual({
      type: 'object',
      properties: {
        value: { type: 'string' },
      },
    });
  });

  it('uses deterministic object, array, string, number structure priority', () => {
    const result = normalizeKimiToolSchema({
      type: 'object',
      properties: {
        objectWins: {
          properties: { nested: {} },
          items: {},
          pattern: '^x',
          minimum: 0,
        },
        arrayWins: {
          items: {},
          pattern: '^x',
          minimum: 0,
        },
        stringWins: {
          pattern: '^x',
          minimum: 0,
        },
        number: {
          minimum: 0,
        },
      },
    });

    expect(result.schema).toEqual({
      type: 'object',
      properties: {
        objectWins: {
          type: 'object',
          properties: {
            nested: { type: 'string' },
          },
          pattern: '^x',
          minimum: 0,
        },
        arrayWins: {
          type: 'array',
          items: { type: 'string' },
          pattern: '^x',
          minimum: 0,
        },
        stringWins: {
          type: 'string',
          pattern: '^x',
          minimum: 0,
        },
        number: {
          type: 'number',
          minimum: 0,
        },
      },
    });
  });

  it('repairs a single explicit type only for a conflicting enum or const', () => {
    const result = normalizeKimiToolSchema({
      type: 'object',
      properties: {
        enumRepair: {
          type: 'string',
          enum: [1, 2],
          properties: { removed: {} },
          items: {},
        },
        constRepair: {
          type: 'object',
          const: ['fixed'],
          properties: { removed: {} },
          items: {},
        },
        structureDoesNotRepair: {
          type: 'string',
          properties: { removed: {} },
          items: {},
        },
        unionIsUntouched: {
          type: ['string', 'object'],
          enum: [1, 2],
          properties: { kept: {} },
        },
      },
    });

    expect(result.schema).toEqual({
      type: 'object',
      properties: {
        enumRepair: {
          type: 'integer',
          enum: [1, 2],
        },
        constRepair: {
          type: 'array',
          const: ['fixed'],
          items: { type: 'string' },
        },
        structureDoesNotRepair: {
          type: 'string',
        },
        unionIsUntouched: {
          type: ['string', 'object'],
          enum: [1, 2],
          properties: {
            kept: { type: 'string' },
          },
        },
      },
    });
  });

  it('does not add a type to combinator nodes but normalizes every branch', () => {
    const result = normalizeKimiToolSchema({
      type: 'object',
      properties: {
        choice: {
          oneOf: [
            { const: 'text' },
            { items: {} },
          ],
        },
      },
    });

    expect(result.schema).toEqual({
      type: 'object',
      properties: {
        choice: {
          oneOf: [
            { const: 'text', type: 'string' },
            { type: 'array', items: { type: 'string' } },
          ],
        },
      },
    });
  });
});

describe('normalizeKimiToolSchema local references', () => {
  it('resolves local pointers from both draft definition buckets', () => {
    const result = normalizeKimiToolSchema({
      type: 'object',
      $defs: {
        current: { const: 'current' },
      },
      definitions: {
        legacy: { enum: [1, 2] },
      },
      properties: {
        current: { $ref: '#/$defs/current' },
        legacy: { $ref: '#/definitions/legacy' },
      },
    });

    expect(result.schema).toEqual({
      type: 'object',
      $defs: {
        current: { const: 'current', type: 'string' },
      },
      definitions: {
        legacy: { enum: [1, 2], type: 'integer' },
      },
      properties: {
        current: { const: 'current', type: 'string' },
        legacy: { enum: [1, 2], type: 'integer' },
      },
    });
  });

  it('decodes escaped JSON Pointer segments', () => {
    const result = normalizeKimiToolSchema({
      type: 'object',
      $defs: {
        'path/name~kind': { const: true },
      },
      properties: {
        escaped: { $ref: '#/$defs/path~1name~0kind' },
      },
    });

    expect(result.schema).toMatchObject({
      properties: {
        escaped: { const: true, type: 'boolean' },
      },
    });
  });

  it('applies current-node siblings as a shallow overlay after resolving the target', () => {
    const result = normalizeKimiToolSchema({
      type: 'object',
      $defs: {
        base: {
          type: 'object',
          properties: {
            fromTarget: { const: 'target' },
          },
          description: 'target description',
        },
      },
      properties: {
        value: {
          $ref: '#/$defs/base',
          type: 'array',
          items: { const: 'sibling' },
          description: 'sibling description',
        },
      },
    });

    expect(result.schema).toMatchObject({
      properties: {
        value: {
          type: 'array',
          items: { const: 'sibling', type: 'string' },
          description: 'sibling description',
        },
      },
    });
    expect((result.schema.properties as Record<string, unknown>).value)
      .not.toHaveProperty('properties');
  });

  it('preserves circular refs and the definition bucket they need', () => {
    const result = normalizeKimiToolSchema({
      type: 'object',
      $defs: {
        node: {
          type: 'object',
          properties: {
            next: { $ref: '#/$defs/node' },
          },
        },
      },
      properties: {
        root: { $ref: '#/$defs/node' },
      },
    });

    expect(result.schema).toEqual({
      type: 'object',
      $defs: {
        node: {
          type: 'object',
          properties: {
            next: { $ref: '#/$defs/node' },
          },
        },
      },
      properties: {
        root: {
          type: 'object',
          properties: {
            next: { $ref: '#/$defs/node' },
          },
        },
      },
    });
  });

  it('preserves a circular ref while recursively normalizing its current-node siblings', () => {
    const result = normalizeKimiToolSchema({
      type: 'object',
      $defs: {
        node: {
          type: 'object',
          properties: {
            next: {
              $ref: '#/$defs/node',
              properties: {
                label: {},
              },
            },
          },
        },
      },
    });

    expect(result.schema).toEqual({
      type: 'object',
      $defs: {
        node: {
          type: 'object',
          properties: {
            next: {
              $ref: '#/$defs/node',
              properties: {
                label: { type: 'string' },
              },
            },
          },
        },
      },
    });
  });

  it('leaves unresolved local and remote refs intact', () => {
    const result = normalizeKimiToolSchema({
      type: 'object',
      properties: {
        missing: { $ref: '#/$defs/missing' },
        remote: { $ref: 'https://example.com/schema.json#/$defs/value' },
      },
    });

    expect(result.schema).toEqual({
      type: 'object',
      properties: {
        missing: { $ref: '#/$defs/missing' },
        remote: { $ref: 'https://example.com/schema.json#/$defs/value' },
      },
    });
  });
});

describe('normalizeKimiToolSchema immutability', () => {
  it('does not mutate or reuse input object identities', () => {
    const nested = { const: 'value' };
    const input = {
      type: 'object',
      properties: { nested },
      'x-extension': {
        nested: ['untouched'],
      },
    };
    const snapshot = structuredClone(input);

    const result = normalizeKimiToolSchema(input);

    expect(input).toEqual(snapshot);
    expect(result.schema).not.toBe(input);
    expect((result.schema.properties as Record<string, unknown>).nested).not.toBe(nested);
    expect(result.schema).toEqual({
      type: 'object',
      properties: {
        nested: { const: 'value', type: 'string' },
      },
      'x-extension': {
        nested: ['untouched'],
      },
    });
  });
});

describe('normalizeKimiToolSchema resource limits', () => {
  it('accepts depth limit - 1 and rejects depth limit + 1 before recursing', () => {
    expect(() => normalizeKimiToolSchema(
      schemaWithObservedDepth(KIMI_SCHEMA_LIMITS.maxDepth - 1),
    )).not.toThrow();
    expectLimit(
      () => normalizeKimiToolSchema(
        schemaWithObservedDepth(KIMI_SCHEMA_LIMITS.maxDepth + 1),
      ),
      'depth',
    );
  });

  it('accepts input node limit - 1 and rejects input node limit + 1', () => {
    const accepted = normalizeKimiToolSchema(
      schemaWithInputNodes(KIMI_SCHEMA_LIMITS.maxInputNodes - 1),
    );
    expect(accepted.inputNodes).toBe(KIMI_SCHEMA_LIMITS.maxInputNodes - 1);

    expectLimit(
      () => normalizeKimiToolSchema(
        schemaWithInputNodes(KIMI_SCHEMA_LIMITS.maxInputNodes + 1),
      ),
      'input_nodes',
    );
  });

  it('accepts ref expansion limit - 1 and rejects ref expansion limit + 1', () => {
    expect(() => normalizeKimiToolSchema(
      schemaWithRefExpansions(KIMI_SCHEMA_LIMITS.maxRefExpansions - 1),
    )).not.toThrow();

    expectLimit(
      () => normalizeKimiToolSchema(
        schemaWithRefExpansions(KIMI_SCHEMA_LIMITS.maxRefExpansions + 1),
      ),
      'ref_expansions',
    );
  });

  it('accepts output node limit - 1 and rejects output node limit + 1 for wide shared refs', () => {
    const accepted = normalizeKimiToolSchema(wideSharedRefSchema());
    expect(accepted.outputNodes).toBe(KIMI_SCHEMA_LIMITS.maxOutputNodes - 1);

    expectLimit(
      () => normalizeKimiToolSchema(wideSharedRefSchema(2)),
      'output_nodes',
    );
  });

  it('accepts UTF-8 output byte limit - 1 and rejects byte limit + 1', () => {
    const accepted = normalizeKimiToolSchema(
      schemaWithOutputBytes(KIMI_SCHEMA_LIMITS.maxOutputBytes - 1),
    );
    expect(accepted.outputBytes).toBe(KIMI_SCHEMA_LIMITS.maxOutputBytes - 1);

    expectLimit(
      () => normalizeKimiToolSchema(
        schemaWithOutputBytes(KIMI_SCHEMA_LIMITS.maxOutputBytes + 1),
      ),
      'output_bytes',
    );
  });

  it('rejects object identity cycles without relying on JSON.stringify', () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;

    expectKimiError(
      () => normalizeKimiToolSchema(cycle),
      'KIMI_SCHEMA_INVALID_JSON_VALUE',
    );
  });

  it('bounds deep local ref chains by recursion depth', () => {
    expectLimit(
      () => normalizeKimiToolSchema(
        deepRefChainSchema(KIMI_SCHEMA_LIMITS.maxDepth + 2),
      ),
      'depth',
    );
  });
});
