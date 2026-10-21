import { describe, expect, it } from 'vitest';
import { createNativeObservationProvenance, readFinalizedObservationProvenance, wrapNativeObservationHistory } from '../../../src/runtime/sol-pi/observation-provenance.js';

const make = () => createNativeObservationProvenance({ hostInvocationId: 'tool-1', ownerGeneration: 0, nativePreview: 'native' });
describe('host native observation provenance', () => {
  it('retains exact native and separately appended hook/warning bytes through both finalizations', () => {
    const port = make(); port.appendSuffix('\nhook'); port.observeTransform({ before: 'native\nhook', after: 'native\nhook' });
    port.appendSuffix('\nWarning: caution'); port.sealRegistry('native\nhook\nWarning: caution');
    const receipt = port.finalizeHistory('native\nhook\nWarning: caution');
    expect(readFinalizedObservationProvenance(receipt)).toEqual({ hostInvocationId: 'tool-1', ownerGeneration: 0, wholeContent: 'native\nhook\nWarning: caution', segments: { before: '', native: 'native', after: '\nhook\nWarning: caution' } });
    expect(Object.isFrozen(readFinalizedObservationProvenance(receipt)?.segments)).toBe(true);
  });
  it('rejects suffix-only sanitizer/cap change even though native prefix survives', () => {
    const port = make(); port.appendSuffix('\nimportant policy'); port.observeTransform({ before: 'native\nimportant policy', after: 'native\nimport' });
    port.sealRegistry('native\nimport'); expect(port.finalizeHistory('native\nimport')).toBeUndefined();
  });
  it('rejects runtime cap that changes only policy suffix', () => {
    const port = make(); port.appendSuffix('\npolicy'); port.sealRegistry('native\npolicy'); expect(port.finalizeHistory('native\npol')).toBeUndefined();
  });
  it('rejects native rewrite and does not recover after original bytes are restored', () => {
    const port = make(); port.observeTransform({ before: 'native', after: 'changed' }); port.observeTransform({ before: 'changed', after: 'native' }); port.sealRegistry('native'); expect(port.finalizeHistory('native')).toBeUndefined();
  });
  it('rejects wrong previous bytes, out-of-order, repeated and post-seal updates without throwing', () => {
    for (const mutate of [
      (p: ReturnType<typeof make>) => p.observeTransform({ before: 'forged', after: 'forged' }),
      (p: ReturnType<typeof make>) => p.finalizeHistory('native'),
      (p: ReturnType<typeof make>) => { p.sealRegistry('native'); p.sealRegistry('native'); },
      (p: ReturnType<typeof make>) => { p.sealRegistry('native'); p.appendSuffix('suffix'); },
    ]) { const port = make(); expect(() => mutate(port)).not.toThrow(); port.sealRegistry('native'); expect(port.finalizeHistory('native')).toBeUndefined(); }
  });
  it('does not accept a structurally forged receipt', () => {
    expect(readFinalizedObservationProvenance({ hostInvocationId: 'tool-1', segments: { native: 'native' } })).toBeUndefined();
    expect(readFinalizedObservationProvenance(undefined)).toBeUndefined();
  });
  it('a second finalization invalidates even a prior receipt', () => {
    const port = make(); port.sealRegistry('native'); const receipt = port.finalizeHistory('native');
    expect(readFinalizedObservationProvenance(receipt)).toBeDefined(); expect(port.finalizeHistory('native')).toBeUndefined(); expect(readFinalizedObservationProvenance(receipt)).toBeUndefined();
  });
});

it('only one exact host wrap can protect compound facts around sealed native bytes',()=>{
 const p=make();p.appendSuffix(' policy');p.sealRegistry('native policy');
 expect(wrapNativeObservationHistory(p,'edit=succeeded\n','native policy','\nexit=0')).toBe(true);
 const receipt=p.finalizeHistory('edit=succeeded\nnative policy\nexit=0');expect(readFinalizedObservationProvenance(receipt)?.segments).toEqual({before:'edit=succeeded\n',native:'native',after:' policy\nexit=0'});
});
it('rejects copied ports, changed sealed bodies, non-string wrappers and repeated wrapping',()=>{
 const p=make();p.sealRegistry('native');let getter=false;
 expect(wrapNativeObservationHistory({...p,get spoof(){getter=true;return true;}},'','native','')).toBe(false);expect(getter).toBe(false);
 expect(wrapNativeObservationHistory(p,'before','changed','')).toBe(false);expect(p.finalizeHistory('beforechanged')).toBeUndefined();
 const q=make();q.sealRegistry('native');expect(wrapNativeObservationHistory(q,(()=> 'async') as any,'native','')).toBe(false);
 const r=make();r.sealRegistry('native');expect(wrapNativeObservationHistory(r,'before','native','')).toBe(true);expect(wrapNativeObservationHistory(r,'more','beforenative','')).toBe(false);expect(r.finalizeHistory('morebeforenative')).toBeUndefined();
});
