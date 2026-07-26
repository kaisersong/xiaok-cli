import { describe, expect, it, vi } from 'vitest';
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

function schemaWithOutputBytes(target: number): Record<string, unknown> {
  return {
    x: 'a'.repeat(target - 8),
  };
}

function schemaWithEscapedUtf8OutputBytes(target: number): Record<string, unknown> {
  const escapedUtf8Prefix = '中😀"\n';
  const prefixBytes = Buffer.byteLength(JSON.stringify(escapedUtf8Prefix), 'utf8') - 2;
  return {
    x: escapedUtf8Prefix + 'a'.repeat(target - 8 - prefixBytes),
  };
}

function structuralSchemaAtDepth(depth: number): Record<string, unknown> {
  let schema: Record<string, unknown> = {};
  for (let index = 0; index < depth; index += 1) {
    schema = { not: schema };
  }
  return schema;
}

function arbitraryJsonAtDepth(depth: number): Record<string, unknown> {
  let value: unknown = null;
  for (let index = 1; index < depth; index += 1) {
    value = [value];
  }
  return { 'x-arbitrary-json': value };
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
          properties: { preserved: {} },
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
          properties: {
            preserved: { type: 'string' },
          },
          items: { type: 'string' },
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

  it.each(['allOf', 'anyOf', 'oneOf'] as const)(
    'does not add a type to %s nodes but normalizes every branch',
    (applicator) => {
      const result = normalizeKimiToolSchema({
        type: 'object',
        properties: {
          choice: {
            [applicator]: [
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
            [applicator]: [
              { const: 'text', type: 'string' },
              { type: 'array', items: { type: 'string' } },
            ],
          },
        },
      });
    },
  );

  it.each(['if', 'then', 'else', 'not'] as const)(
    'does not fill or repair type on a node with %s but normalizes its branch',
    (applicator) => {
      const result = normalizeKimiToolSchema({
        type: 'object',
        properties: {
          guarded: {
            type: 'string',
            enum: [1, 2],
            [applicator]: {
              properties: {
                label: {},
              },
            },
          },
        },
      });

      expect(result.schema).toEqual({
        type: 'object',
        properties: {
          guarded: {
            type: 'string',
            enum: [1, 2],
            [applicator]: {
              type: 'object',
              properties: {
                label: { type: 'string' },
              },
            },
          },
        },
      });
    },
  );
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
        current: { const: 'current' },
        legacy: { enum: [1, 2] },
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
        escaped: { const: true },
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
          properties: {
            fromTarget: { const: 'target', type: 'string' },
          },
          items: { const: 'sibling', type: 'string' },
          description: 'sibling description',
        },
      },
    });
  });

  it('does not fill type on a successfully resolved ref node', () => {
    const result = normalizeKimiToolSchema({
      type: 'object',
      $defs: {
        value: { const: 'resolved' },
      },
      properties: {
        value: { $ref: '#/$defs/value' },
      },
    });

    expect(result.schema).toMatchObject({
      $defs: {
        value: { const: 'resolved', type: 'string' },
      },
      properties: {
        value: { const: 'resolved' },
      },
    });
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

  it.each([
    ['unresolved local', '#/$defs/missing'],
    ['remote', 'https://example.com/schema.json#/$defs/value'],
  ])('preserves an %s ref while normalizing sibling child slots', (_label, ref) => {
    const result = normalizeKimiToolSchema({
      type: 'object',
      properties: {
        value: {
          $ref: ref,
          properties: {
            label: {},
          },
        },
      },
    });

    expect(result.schema).toEqual({
      type: 'object',
      properties: {
        value: {
          $ref: ref,
          properties: {
            label: { type: 'string' },
          },
        },
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

  it('preserves a JSON own __proto__ schema key without changing output prototypes', () => {
    const input = JSON.parse(
      '{"type":"object","properties":{"__proto__":{}}}',
    ) as Record<string, unknown>;

    const result = normalizeKimiToolSchema(input);
    const properties = result.schema.properties as Record<string, unknown>;
    const expected = JSON.parse(
      '{"type":"object","properties":{"__proto__":{"type":"string"}}}',
    ) as Record<string, unknown>;

    expect(result.schema).toEqual(expected);
    expect(Object.getPrototypeOf(properties)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(properties, '__proto__')).toBe(true);
    expect(properties.__proto__).toEqual({ type: 'string' });
    expect(result.outputNodes).toBe(5);
    expect(result.outputBytes).toBe(
      Buffer.byteLength(JSON.stringify(expected), 'utf8'),
    );
  });
});

describe('normalizeKimiToolSchema vetted input snapshot', () => {
  it.each([
    {
      label: 'changing bigint',
      getValue(reads: number): unknown {
        return reads === 1 ? null : 1n;
      },
    },
    {
      label: 'changing cycle',
      getValue(reads: number): unknown {
        if (reads === 1) return null;
        const cycle: Record<string, unknown> = {};
        cycle.self = cycle;
        return cycle;
      },
    },
    {
      label: 'throwing',
      getValue(): unknown {
        throw new Error('getter must never run');
      },
    },
  ])('rejects a $label accessor without invoking it', ({ getValue }) => {
    let getterReads = 0;
    const nested: Record<string, unknown> = {};
    Object.defineProperty(nested, 'value', {
      enumerable: true,
      get() {
        getterReads += 1;
        return getValue(getterReads);
      },
    });

    expectKimiError(
      () => normalizeKimiToolSchema({
        type: 'object',
        'x-nested': nested,
      }),
      'KIMI_SCHEMA_INVALID_JSON_VALUE',
    );
    expect(getterReads).toBe(0);
  });

  it('rejects a Proxy without entering its reflection traps', () => {
    let trapCalls = 0;
    const input = new Proxy<Record<string, unknown>>(
      { type: 'object' },
      {
        getPrototypeOf(target) {
          trapCalls += 1;
          return Reflect.getPrototypeOf(target);
        },
        ownKeys(target) {
          trapCalls += 1;
          return Reflect.ownKeys(target);
        },
      },
    );

    expectKimiError(
      () => normalizeKimiToolSchema(input),
      'KIMI_SCHEMA_INVALID_JSON_VALUE',
    );
    expect(trapCalls).toBe(0);
  });
});

describe('normalizeKimiToolSchema resource limits', () => {
  it('accepts arbitrary input JSON depth 64 inclusive and rejects depth 65', () => {
    expect(() => normalizeKimiToolSchema(
      arbitraryJsonAtDepth(KIMI_SCHEMA_LIMITS.maxDepth),
    )).not.toThrow();
    expectLimit(
      () => normalizeKimiToolSchema(
        arbitraryJsonAtDepth(KIMI_SCHEMA_LIMITS.maxDepth + 1),
      ),
      'depth',
    );
  });

  it('accepts structural depth 64 inclusive and rejects depth 65', () => {
    expect(() => normalizeKimiToolSchema(
      structuralSchemaAtDepth(KIMI_SCHEMA_LIMITS.maxDepth),
    )).not.toThrow();
    expectLimit(
      () => normalizeKimiToolSchema(
        structuralSchemaAtDepth(KIMI_SCHEMA_LIMITS.maxDepth + 1),
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

  it('rejects the first over-limit input child before invoking its accessor', () => {
    let getterReads = 0;
    const input: Record<string, unknown> = {};
    for (
      let index = 0;
      index < KIMI_SCHEMA_LIMITS.maxInputNodes - 1;
      index += 1
    ) {
      input[`value${index}`] = null;
    }
    Object.defineProperty(input, 'firstOverLimit', {
      enumerable: true,
      get() {
        getterReads += 1;
        throw new Error('over-limit getter must never run');
      },
    });

    const ownKeysSpy = vi.spyOn(Reflect, 'ownKeys');
    let caught: unknown;
    try {
      normalizeKimiToolSchema(input);
    } catch (error) {
      caught = error;
    }
    const ownKeysCalls = ownKeysSpy.mock.calls.length;
    ownKeysSpy.mockRestore();

    expect(caught).toBeInstanceOf(KimiToolSchemaError);
    expect(caught).toMatchObject({
      code: 'KIMI_SCHEMA_LIMIT_EXCEEDED',
      limitKind: 'input_nodes',
    });
    expect(ownKeysCalls).toBe(0);
    expect(getterReads).toBe(0);
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

  it('counts multibyte, surrogate, quote, and control escaping at exact byte boundaries', () => {
    const acceptedSchema = schemaWithEscapedUtf8OutputBytes(
      KIMI_SCHEMA_LIMITS.maxOutputBytes - 1,
    );
    const accepted = normalizeKimiToolSchema(acceptedSchema);
    expect(accepted.outputBytes).toBe(KIMI_SCHEMA_LIMITS.maxOutputBytes - 1);
    expect(accepted.outputBytes).toBe(
      Buffer.byteLength(JSON.stringify(accepted.schema), 'utf8'),
    );

    expectLimit(
      () => normalizeKimiToolSchema(
        schemaWithEscapedUtf8OutputBytes(KIMI_SCHEMA_LIMITS.maxOutputBytes + 1),
      ),
      'output_bytes',
    );
  });

  it('rejects a single oversized string without creating a full JSON string copy', () => {
    const stringifySpy = vi.spyOn(JSON, 'stringify');
    let caught: unknown;
    try {
      normalizeKimiToolSchema(
        schemaWithOutputBytes(KIMI_SCHEMA_LIMITS.maxOutputBytes + 1),
      );
    } catch (error) {
      caught = error;
    }

    expect(stringifySpy).not.toHaveBeenCalled();
    stringifySpy.mockRestore();
    expect(caught).toBeInstanceOf(KimiToolSchemaError);
    expect(caught).toMatchObject({
      code: 'KIMI_SCHEMA_LIMIT_EXCEEDED',
      limitKind: 'output_bytes',
    });
  });

  it('rejects accessor instrumentation before materializing shared-ref output', () => {
    let paddingReads = 0;
    const payload: Record<string, unknown> = {
      type: 'object',
    };
    Object.defineProperty(payload, 'x-padding', {
      enumerable: true,
      get() {
        paddingReads += 1;
        if (paddingReads >= 100) {
          throw new Error('shared-ref bomb was materialized too far');
        }
        return Array.from({ length: 997 }, () => null);
      },
    });
    const schema = {
      $defs: { payload },
      properties: Object.fromEntries(
        Array.from({ length: 200 }, (_, index) => [
          `value${index}`,
          { $ref: '#/$defs/payload' },
        ]),
      ),
    };

    expectKimiError(
      () => normalizeKimiToolSchema(schema),
      'KIMI_SCHEMA_INVALID_JSON_VALUE',
    );
    expect(paddingReads).toBe(0);
  });

  it('rejects object identity cycles without relying on JSON.stringify', () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;

    expectKimiError(
      () => normalizeKimiToolSchema(cycle),
      'KIMI_SCHEMA_INVALID_JSON_VALUE',
    );
  });

  it('accepts exactly 64 local ref hops and rejects 65', () => {
    expect(() => normalizeKimiToolSchema(
      deepRefChainSchema(KIMI_SCHEMA_LIMITS.maxDepth),
    )).not.toThrow();
    expectLimit(
      () => normalizeKimiToolSchema(
        deepRefChainSchema(KIMI_SCHEMA_LIMITS.maxDepth + 1),
      ),
      'depth',
    );
  });
});
