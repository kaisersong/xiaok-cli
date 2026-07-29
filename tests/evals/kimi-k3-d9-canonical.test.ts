import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

async function loadCanonicalModule(): Promise<any> {
  return import(pathToFileURL(join(
    process.cwd(),
    'scripts/evals/kimi-k3-d9/canonical.mjs',
  )).href);
}

describe('Kimi K3 D9 canonical contract', () => {
  it('delegates to the built canonicalJsonV1 helper and binds its bytes', async () => {
    const {
      canonicalize,
      canonicalSha256,
      getCanonicalHelperAttestation,
    } = await loadCanonicalModule();
    const input = {
      z: [-0, true],
      a: 'line\n',
      nested: { 2: 'two', 10: 'ten' },
      1: 'one',
    };
    const expected = '{"1":"one","a":"line\\n","nested":{"10":"ten","2":"two"},"z":[0,true]}';

    expect(canonicalize(input)).toBe(expected);
    expect(canonicalSha256(input)).toBe(
      createHash('sha256').update(expected).digest('hex'),
    );

    const attestation = await getCanonicalHelperAttestation();
    const helperBytes = await readFile(join(
      process.cwd(),
      'dist/ai/runtime/canonical-json.js',
    ));
    expect(attestation).toEqual({
      encoderId: 'xiaok-canonical-json-direct-v1',
      helperRelativePath: 'dist/ai/runtime/canonical-json.js',
      helperSha256: createHash('sha256').update(helperBytes).digest('hex'),
    });
  });

  it('preserves finite boundary values and rejects non-data grammar', async () => {
    const { canonicalize } = await loadCanonicalModule();

    expect(canonicalize({
      min: Number.MIN_VALUE,
      max: Number.MAX_VALUE,
      safe: Number.MAX_SAFE_INTEGER,
    })).toBe(
      `{"max":${Number.MAX_VALUE},"min":${Number.MIN_VALUE},"safe":${Number.MAX_SAFE_INTEGER}}`,
    );

    const accessor = Object.create(null);
    Object.defineProperty(accessor, 'secret', {
      enumerable: true,
      get: () => 'not-data',
    });
    expect(() => canonicalize(accessor)).toThrow('canonicalJsonV1InvalidGrammar');
    expect(() => canonicalize(new Proxy({ value: 1 }, {})))
      .toThrow('canonicalJsonV1InvalidGrammar');
    expect(() => canonicalize({ [Symbol('hidden')]: true }))
      .toThrow('canonicalJsonV1InvalidGrammar');
  });
});
