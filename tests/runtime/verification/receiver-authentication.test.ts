import { describe, it, expect } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { createReceiverReplySigner, createReceiverReplyVerifier } from '../../../src/runtime/verification/receiver-authentication.js';

describe('P3-R receiver reply authentication', () => {
  it('real Ed25519 authenticates identity, challenge, full tuple and terminal result', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const signer = createReceiverReplySigner({ privateKey, keyId: 'key1', receiverId: 'receiver1', receiverInstanceEpoch: 1 });
    const verifier = createReceiverReplyVerifier({ publicKey, keyId: 'key1', receiverId: 'receiver1', receiverInstanceEpoch: 1 });
    const request = { fullTupleHash: 'a'.repeat(64), challenge: 'b'.repeat(64) };
    const result = { status: 'cancelled' as const, fullTupleHash: request.fullTupleHash, objectRevision: 2, reason: 'expired' as const, terminalRecordHash: 'c'.repeat(64) };
    const envelope = signer.sign(request, result); const reply = verifier.verify(envelope, request);
    expect(verifier.read(reply).result.status).toBe('cancelled');
    expect(() => verifier.read({ result } as never)).toThrow();
    expect(() => verifier.verify(envelope, { ...request, challenge: 'd'.repeat(64) })).toThrow();
    expect(() => verifier.verify({ ...envelope, payload: { ...envelope.payload, receiverId: 'other' } }, request)).toThrow();
    expect(() => verifier.verify({ ...envelope, payload: { ...envelope.payload, result: { ...result, status: 'committed' } } }, request)).toThrow();
  });
  it('another real signing key is not trusted despite identical textual identity', () => {
    const trusted = generateKeyPairSync('ed25519'), attacker = generateKeyPairSync('ed25519');
    const config = { keyId: 'key1', receiverId: 'receiver1', receiverInstanceEpoch: 1 };
    const request = { fullTupleHash: 'a'.repeat(64), challenge: 'b'.repeat(64) };
    const envelope = createReceiverReplySigner({ ...config, privateKey: attacker.privateKey }).sign(request, { status: 'unknown', fullTupleHash: request.fullTupleHash });
    expect(() => createReceiverReplyVerifier({ ...config, publicKey: trusted.publicKey }).verify(envelope, request)).toThrow();
  });
  it('revoking a host receiver registration also invalidates already verified opaque replies', () => {
    const keys = generateKeyPairSync('ed25519'), identity = { keyId: 'k', receiverId: 'r', receiverInstanceEpoch: 1 };
    const signer = createReceiverReplySigner({ ...identity, privateKey: keys.privateKey });
    const verifier = createReceiverReplyVerifier({ ...identity, publicKey: keys.publicKey });
    const request = { fullTupleHash: 'a'.repeat(64), challenge: 'b'.repeat(64) };
    const signed = signer.sign(request, { status: 'unknown', fullTupleHash: request.fullTupleHash });
    const reply = verifier.verify(signed, request); verifier.revoke();
    expect(() => verifier.read(reply)).toThrow(); expect(() => verifier.verify(signed, request)).toThrow();
  });

});
