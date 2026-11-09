import { createHash } from 'node:crypto';
import { types } from 'node:util';
/** Bytes and relation binding only. Encoding or decoding is never a Source,
 * writer-close, Native approval, activation or namespace-birth grant. */
export const MAIN_ROOT_ACCEPTED_BYTES = 2080;
export const MAIN_ROOT_CONSUME_BYTES = 320;
export type MainRootEnrollmentBuildKind = 'production' | 'component';
const apply = Reflect.apply, descriptor = Object.getOwnPropertyDescriptor, keys = Reflect.ownKeys;
const own = Object.hasOwn, prototype = Object.getPrototypeOf, freeze = Object.freeze, create = Object.create;
const isProxy = types.isProxy, isShared = types.isSharedArrayBuffer, array = Array.isArray, integer = Number.isSafeInteger;
const plain = Object.prototype, arrayPrototype = Array.prototype;
const alloc = Buffer.alloc, from = Buffer.from, isBuffer = Buffer.isBuffer, toHex = Buffer.prototype.toString;
const write32 = Buffer.prototype.writeUInt32BE, read32 = Buffer.prototype.readUInt32BE;
const write64 = Buffer.prototype.writeBigUInt64BE, read64 = Buffer.prototype.readBigUInt64BE;
const typed = prototype(Uint8Array.prototype), length = descriptor(typed, 'length')!.get!, buffer = descriptor(typed, 'buffer')!.get!;
const set = Uint8Array.prototype.set, NativeBigInt = BigInt;
const nativeCreateHash = createHash;
const hashPrototype = prototype(nativeCreateHash('sha256')), update = hashPrototype.update, digest = hashPrototype.digest;
const acceptedDomain = from('xiaok-main-root-accepted-projection-v1\0');
const consumeDomain = from('xiaok-main-root-consume-receipt-v1\0');
const acceptedHashes = [
    ['authorityIdHash', 32], ['installationReleaseHash', 64], ['mainHash', 96], ['controllerPackageHash', 128],
    ['profileHash', 200], ['operationHash', 232], ['namespaceId', 264], ['birthId', 296], ['poolId', 328],
    ['wholeSourceNamespaceHash', 360], ['finalReviewHash', 392], ['nativeApprovalBindingHash', 424],
    ['committedCommandHash', 456], ['rootLedgerDigest', 488], ['oldWriterFenceDigest', 520], ['floorTransitionHash', 552],
    ['clockDomainHash', 600], ['historyBindingHash', 656], ['policyDigest', 792], ['pendingOperationHash', 832],
    ['priorAcceptedHash', 864], ['completeWitnessHash', 896], ['bootSessionHash', 928], ['publisherReleaseHash', 960],
] as const;
const consumeHashes = [['operationHash', 32], ['acceptedDigest', 64], ['namespaceId', 96], ['birthId', 128], ['poolId', 160], ['nonce', 192], ['publisherCodeDigest', 224], ['acceptedPhysicalIdentityBinding', 256]] as const;
const familyHashes = ['producerCodeDigest', 'namespaceBinding', 'ledgerDigest', 'captureManifestDigest', 'floorDigest', 'writerFenceDigest', 'derivedScope'] as const;
const familyNames = ['admission', 'budget', 'kswarm', 'broker'] as const;
const acceptedFields = ['version', 'buildKind', 'uid', 'epoch', 'accountGeneration', 'mode', 'clockEpoch', 'notBefore', 'validUntil', 'sourceRootSchemaVersion', 'targetRootSchemaVersion', 'inventoryGeneration', 'sourceFacts', 'families'];
for (let i = 0; i < acceptedHashes.length; i++)
    acceptedFields.push(acceptedHashes[i]![0]);
const consumeFields = ['version', 'buildKind', 'uid', 'epoch'];
for (let i = 0; i < consumeHashes.length; i++)
    consumeFields.push(consumeHashes[i]![0]);
const familyFields = ['family', 'scopeRule', 'readerVersion', 'mode', ...familyHashes];
function invalid(): never { throw Error('MAIN_ROOT_ENROLLMENT_CODEC_INVALID'); }
function object(raw: unknown, fields: readonly string[]): Record<string, any> {
    if (!raw || typeof raw !== 'object' || isProxy(raw) || array(raw))
        invalid();
    const p = prototype(raw);
    if (p !== null && p !== plain)
        invalid();
    const names = keys(raw);
    if (names.length !== fields.length)
        invalid();
    const result = create(null);
    for (let i = 0; i < names.length; i++) {
        const name = names[i]!;
        if (typeof name !== 'string' || !fields.includes(name))
            invalid();
        const d = descriptor(raw, name);
        if (!d || !own(d, 'value'))
            invalid();
        result[name] = d.value;
    }
    return result;
}
function dense(raw: unknown, size: number): unknown[] {
    if (!raw || typeof raw !== 'object' || isProxy(raw) || !array(raw) || prototype(raw) !== arrayPrototype)
        invalid();
    const n = descriptor(raw, 'length');
    if (!n || !own(n, 'value') || n.value !== size || keys(raw).length !== size + 1)
        invalid();
    const out = [];
    for (let i = 0; i < size; i++) {
        const d = descriptor(raw, String(i));
        if (!d || !own(d, 'value'))
            invalid();
        out.push(d.value);
    }
    return out;
}
function u32(value: unknown, minimum = 0): number { if (typeof value !== 'number' || !integer(value) || value < minimum || value > 0xffffffff)
    invalid(); return value; }
function u64(value: unknown, minimum = 0n): bigint {
    if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]{0,19})$/.test(value))
        invalid();
    const n = NativeBigInt(value);
    if (n < minimum || n > 0xffffffffffffffffn)
        invalid();
    return n;
}
function kind(value: unknown): number { if (value === 'production')
    return 1; if (value === 'component')
    return 2; return invalid(); }
function mode(value: unknown): number { if (value === 'migration')
    return 1; if (value === 'restore')
    return 2; return invalid(); }
function hash(value: unknown, allowZero = false): Buffer {
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value) || !allowZero && /^0{64}$/.test(value))
        invalid();
    return from(value, 'hex');
}
function size(raw: unknown, n: number): Buffer {
    if (!raw || typeof raw !== 'object' || isProxy(raw) || !isBuffer(raw) || apply(length, raw, []) !== n || isShared(apply(buffer, raw, [])))
        invalid();
    const out = alloc(n);
    apply(set, out, [raw]);
    return out;
}
function w32(b: Buffer, at: number, n: number) { apply(write32, b, [n, at]); }
function w64(b: Buffer, at: number, n: bigint) { apply(write64, b, [n, at]); }
function r32(b: Buffer, at: number): number { return apply(read32, b, [at]); }
function r64(b: Buffer, at: number): string { return String(apply(read64, b, [at])); }
function copy(b: Buffer, at: number, value: Buffer) { apply(set, b, [value, at]); }
function hex(b: Buffer, at: number): string { return apply(toHex, b, ['hex', at, at + 32]); }
function checksum(domain: Buffer, b: Buffer, n: number): Buffer {
    const h = nativeCreateHash('sha256');
    apply(update, h, [domain]);
    const prefix = alloc(n);
    for (let i = 0; i < n; i++)
        prefix[i] = b[i]!;
    apply(update, h, [prefix]);
    return apply(digest, h, []);
}
function seal(b: Buffer, domain: Buffer, n: number) { copy(b, n, checksum(domain, b, n)); }
function equal(a: Buffer, b: Buffer) { if (apply(length, a, []) !== apply(length, b, []))
    return false; for (let i = 0; i < apply(length, a, []); i++)
    if (a[i] !== b[i])
        return false; return true; }
function header(raw: unknown, fields: readonly string[], magic: string, bytes: number): {
    value: Record<string, any>;
    bytes: Buffer;
} {
    const value = object(raw, fields), out = alloc(bytes);
    if (value.version !== 1)
        invalid();
    copy(out, 0, from(magic));
    w32(out, 8, 1);
    w32(out, 12, bytes);
    w32(out, 16, kind(value.buildKind));
    const uid = u32(value.uid, 1);
    if (uid === 0xffffffff)
        invalid();
    w32(out, 20, uid);
    w64(out, 24, u64(value.epoch, 1n));
    return { value, bytes: out };
}
export function encodeMainRootAcceptedProjection(raw: unknown): Buffer {
    const { value: v, bytes: b } = header(raw, acceptedFields, 'XMACPT01', MAIN_ROOT_ACCEPTED_BYTES);
    for (let i = 0; i < acceptedHashes.length; i++) {
        const row = acceptedHashes[i]!, field = row[0], offset = row[1];
        copy(b, offset, hash(v[field], field === 'priorAcceptedHash'));
    }
    if (typeof v.accountGeneration !== 'string' || !/^[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}$/.test(v.accountGeneration))
        invalid();
    copy(b, 160, from(v.accountGeneration, 'ascii'));
    const m = mode(v.mode);
    w32(b, 584, m);
    w32(b, 588, 4);
    w32(b, 592, 1);
    w64(b, 632, u64(v.clockEpoch, 1n));
    const before = u64(v.notBefore), until = u64(v.validUntil);
    if (until <= before || until - before > 300001n)
        invalid();
    w64(b, 640, before);
    w64(b, 648, until);
    const facts = dense(v.sourceFacts, 3);
    for (let i = 0; i < 3; i++) {
        const f = object(facts[i], ['device', 'inode', 'uid', 'mode', 'nlink']), at = 688 + 32 * i, links = u64(f.nlink, 1n), owner = u32(f.uid), bits = u32(f.mode);
        if (owner !== 0 && owner !== v.uid || (bits & 0o170000) !== (i ? 0o100000 : 0o040000) || i > 0 && links !== 1n)
            invalid();
        w64(b, at, u64(f.device, 1n));
        w64(b, at + 8, u64(f.inode, 1n));
        w32(b, at + 16, owner);
        w32(b, at + 20, bits);
        w64(b, at + 24, links);
    }
    if (v.sourceRootSchemaVersion !== 3 && v.sourceRootSchemaVersion !== 4 || v.targetRootSchemaVersion !== 4 || m === 2 && v.sourceRootSchemaVersion !== 4)
        invalid();
    w32(b, 784, v.sourceRootSchemaVersion);
    w32(b, 788, 4);
    w64(b, 824, u64(v.inventoryGeneration, 1n));
    const families = dense(v.families, 4);
    for (let i = 0; i < 4; i++) {
        const f = object(families[i], familyFields), at = 1024 + 256 * i;
        if (f.family !== familyNames[i] || f.scopeRule !== i + 1)
            invalid();
        w32(b, at, i + 1);
        w32(b, at + 4, i + 1);
        w32(b, at + 8, u32(f.readerVersion, 1));
        w32(b, at + 12, mode(f.mode));
        for (let j = 0; j < familyHashes.length; j++)
            copy(b, at + 16 + 32 * j, hash(f[familyHashes[j]!]));
    }
    seal(b, acceptedDomain, 2048);
    return b;
}
export function decodeMainRootAcceptedProjection(raw: unknown, expectedKind: MainRootEnrollmentBuildKind = 'production'): Readonly<Record<string, any>> {
    const b = size(raw, MAIN_ROOT_ACCEPTED_BYTES), v = create(null);
    v.version = r32(b, 8);
    v.buildKind = expectedKind;
    if (apply(toHex, b, ['ascii', 0, 8]) !== 'XMACPT01' || r32(b, 12) !== MAIN_ROOT_ACCEPTED_BYTES || r32(b, 16) !== kind(expectedKind))
        invalid();
    v.uid = r32(b, 20);
    v.epoch = r64(b, 24);
    v.accountGeneration = apply(toHex, b, ['ascii', 160, 196]);
    for (let i = 0; i < acceptedHashes.length; i++) {
        const row = acceptedHashes[i]!, field = row[0], offset = row[1];
        v[field] = hex(b, offset);
    }
    v.mode = r32(b, 584) === 1 ? 'migration' : r32(b, 584) === 2 ? 'restore' : invalid();
    v.clockEpoch = r64(b, 632);
    v.notBefore = r64(b, 640);
    v.validUntil = r64(b, 648);
    v.sourceRootSchemaVersion = r32(b, 784);
    v.targetRootSchemaVersion = r32(b, 788);
    v.inventoryGeneration = r64(b, 824);
    v.sourceFacts = [];
    for (let i = 0; i < 3; i++) {
        const at = 688 + 32 * i;
        v.sourceFacts.push(freeze({ device: r64(b, at), inode: r64(b, at + 8), uid: r32(b, at + 16), mode: r32(b, at + 20), nlink: r64(b, at + 24) }));
    }
    freeze(v.sourceFacts);
    v.families = [];
    for (let i = 0; i < 4; i++) {
        const at = 1024 + 256 * i, f = create(null);
        if (r32(b, at) !== i + 1)
            invalid();
        f.family = familyNames[i];
        f.scopeRule = r32(b, at + 4);
        f.readerVersion = r32(b, at + 8);
        f.mode = r32(b, at + 12) === 1 ? 'migration' : r32(b, at + 12) === 2 ? 'restore' : invalid();
        for (let j = 0; j < familyHashes.length; j++)
            f[familyHashes[j]!] = hex(b, at + 16 + 32 * j);
        v.families.push(freeze(f));
    }
    freeze(v.families);
    // Re-encoding checks every reserved byte, discriminator, field, checksum and
    // incomplete-family condition against the one production format definition.
    if (!equal(encodeMainRootAcceptedProjection(v), b))
        invalid();
    return freeze(v);
}
export function encodeMainRootConsumeReceipt(raw: unknown): Buffer {
    const { value: v, bytes: b } = header(raw, consumeFields, 'XMCON001', MAIN_ROOT_CONSUME_BYTES);
    for (let i = 0; i < consumeHashes.length; i++) {
        const row = consumeHashes[i]!, field = row[0], at = row[1];
        copy(b, at, hash(v[field]));
    }
    seal(b, consumeDomain, 288);
    return b;
}
export function decodeMainRootConsumeReceipt(raw: unknown, expectedKind: MainRootEnrollmentBuildKind = 'production'): Readonly<Record<string, any>> {
    const b = size(raw, MAIN_ROOT_CONSUME_BYTES), v = create(null);
    v.version = r32(b, 8);
    v.buildKind = expectedKind;
    v.uid = r32(b, 20);
    v.epoch = r64(b, 24);
    if (apply(toHex, b, ['ascii', 0, 8]) !== 'XMCON001' || r32(b, 12) !== MAIN_ROOT_CONSUME_BYTES || r32(b, 16) !== kind(expectedKind))
        invalid();
    for (let i = 0; i < consumeHashes.length; i++) {
        const row = consumeHashes[i]!, field = row[0], at = row[1];
        v[field] = hex(b, at);
    }
    if (!equal(encodeMainRootConsumeReceipt(v), b))
        invalid();
    return freeze(v);
}
/** Attestation preimage only, not evidence that SQLite committed. The existing
 * controller may sign this core only after its original transaction commits. */
export function mainRootActivationClaimCoreHash(raw: unknown): string {
    const b = size(raw, MAIN_ROOT_ACCEPTED_BYTES), k = r32(b, 16);
    decodeMainRootAcceptedProjection(b, k === 1 ? 'production' : k === 2 ? 'component' : invalid());
    for (let i = 456; i < 488; i++)
        b[i] = 0;
    const out = checksum(from('xiaok-main-root-claim-core-v1\0'), b, 2048);
    return apply(toHex, out, ['hex']);
}
