import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mainRootEnrollmentCodecFixture as fixture } from '../../support/main-root-enrollment-codec.fixture.js';
const H = '12'.repeat(32), Z = '00'.repeat(32);
const api = () => import('../../../src/runtime/verification/main-root-enrollment-codec.js');
it('encodes the exact accepted layout with independent big-endian offsets and separate checksum domain', async () => {
    const codec = await api(), value = fixture(), bytes = codec.encodeMainRootAcceptedProjection(value);
    expect(bytes.length).toBe(2080);
    expect(bytes.subarray(0, 8).toString()).toBe('XMACPT01');
    expect(bytes.subarray(20, 24).toString('hex')).toBe('01020304');
    expect(bytes.subarray(24, 32).toString('hex')).toBe('0000000100000002');
    expect(bytes.subarray(688, 696).toString('hex')).toBe('0000000100000002');
    expect(bytes.subarray(2048)).toEqual(createHash('sha256').update('xiaok-main-root-accepted-projection-v1\0').update(bytes.subarray(0, 2048)).digest());
    expect(codec.decodeMainRootAcceptedProjection(bytes, 'component')).toEqual(value);
    expect(() => codec.decodeMainRootAcceptedProjection(bytes)).toThrow('MAIN_ROOT_ENROLLMENT_CODEC_INVALID');
});
it('rejects incomplete fourth-family fields, pending purpose, accessor, proxy and extra own symbols without invoking them', async () => {
    const codec = await api();
    let touched = 0;
    for (const change of [(v: any) => { v.families[3].scopeRule = 0; }, (v: any) => { v.families[3].producerCodeDigest = Z; }, (v: any) => { v.purpose = 'main-root-family-enrollment'; }, (v: any) => { Object.defineProperty(v, 'poolId', { get() { touched++; return H; } }); }, (v: any) => { v.families[2] = new Proxy(v.families[2], {}); }, (v: any) => { v[Symbol('not data')] = 1; }]) {
        const v = fixture();
        change(v);
        expect(() => codec.encodeMainRootAcceptedProjection(v)).toThrow('MAIN_ROOT_ENROLLMENT_CODEC_INVALID');
    }
    expect(touched).toBe(0);
});
it('rejects reserved bytes, altered fields, a partial record and foreign build kind before any authority consumer exists', async () => {
    const codec = await api(), bytes = codec.encodeMainRootAcceptedProjection(fixture());
    for (const at of [0, 16, 20, 264, 584, 588, 928, 1024, 1264, 2048]) {
        const changed = Buffer.from(bytes);
        changed[at] ^= 1;
        expect(() => codec.decodeMainRootAcceptedProjection(changed, 'component')).toThrow('MAIN_ROOT_ENROLLMENT_CODEC_INVALID');
    }
    expect(() => codec.decodeMainRootAcceptedProjection(bytes.subarray(0, 2079), 'component')).toThrow('MAIN_ROOT_ENROLLMENT_CODEC_INVALID');
    const reserved = Buffer.from(bytes);
    reserved[992] = 1;
    createHash('sha256').update('xiaok-main-root-accepted-projection-v1\0').update(reserved.subarray(0, 2048)).digest().copy(reserved, 2048);
    expect(() => codec.decodeMainRootAcceptedProjection(reserved, 'component')).toThrow('MAIN_ROOT_ENROLLMENT_CODEC_INVALID');
});
it('keeps the consume receipt in a distinct exact domain and preserves its original Native nonce on cold decode', async () => {
    const codec = await api(), value = { version: 1, buildKind: 'component', uid: 501, epoch: '7', operationHash: H, acceptedDigest: '34'.repeat(32), namespaceId: '56'.repeat(32), birthId: '78'.repeat(32), poolId: '9a'.repeat(32), nonce: 'bc'.repeat(32), publisherCodeDigest: 'de'.repeat(32), acceptedPhysicalIdentityBinding: 'ef'.repeat(32) };
    const bytes = codec.encodeMainRootConsumeReceipt(value);
    expect(bytes.length).toBe(320);
    expect(bytes.subarray(0, 8).toString()).toBe('XMCON001');
    expect(bytes.subarray(288)).toEqual(createHash('sha256').update('xiaok-main-root-consume-receipt-v1\0').update(bytes.subarray(0, 288)).digest());
    expect(codec.decodeMainRootConsumeReceipt(bytes, 'component')).toEqual(value);
    expect(() => codec.decodeMainRootConsumeReceipt(bytes)).toThrow('MAIN_ROOT_ENROLLMENT_CODEC_INVALID');
});
it('uses fixed Hash methods and indexed format rows after late Array iterator and Hash prototype hooks', async () => {
    const codec = await api(), value = fixture(), hashPrototype = Object.getPrototypeOf(createHash('sha256'));
    const iterator = Array.prototype[Symbol.iterator], update = hashPrototype.update, digest = hashPrototype.digest;
    let iteratorCalls = 0, hashCalls = 0, bytes: Buffer | undefined, failure: unknown;
    try {
        Array.prototype[Symbol.iterator] = function () { iteratorCalls++; return Reflect.apply(iterator, this, []); };
        hashPrototype.update = function () { hashCalls++; throw Error('late update'); };
        hashPrototype.digest = function () { hashCalls++; throw Error('late digest'); };
        try {
            bytes = codec.encodeMainRootAcceptedProjection(value);
            codec.decodeMainRootAcceptedProjection(bytes, 'component');
        }
        catch (error) {
            failure = error;
        }
    }
    finally {
        Array.prototype[Symbol.iterator] = iterator;
        hashPrototype.update = update;
        hashPrototype.digest = digest;
    }
    expect(failure).toBeUndefined();
    expect(bytes?.length).toBe(2080);
    expect(hashCalls).toBe(0);
    expect(iteratorCalls).toBe(0);
});
it('computes a noncircular committed-command core without treating the hash as commit evidence', async () => {
    const codec = await api(), v = fixture(), first = codec.encodeMainRootAcceptedProjection(v), preimage = Buffer.from(first.subarray(0, 2048));
    preimage.fill(0, 456, 488);
    const hash = createHash('sha256').update('xiaok-main-root-claim-core-v1\0').update(preimage).digest('hex');
    expect(codec.mainRootActivationClaimCoreHash(first)).toBe(hash);
    v.committedCommandHash = hash;
    expect(codec.mainRootActivationClaimCoreHash(codec.encodeMainRootAcceptedProjection(v))).toBe(hash);
});
