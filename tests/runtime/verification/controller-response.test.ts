import { describe, it, expect } from 'vitest';
import { generateKeyPairSync, verify } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { encodeControllerResponse } from '../../../src/runtime/verification/controller-response.js';
import { canonicalVerificationJson } from '../../../src/runtime/verification/protocol.js';
import { startControllerIpc, callControllerIpc } from '../../../src/runtime/verification/controller-ipc.js';

describe('signed terminal responses preserve facts within the entire RPC frame', () => {
  it.each(['x', '"\\\n', '😀'])('retains terminal proof over actual IPC with oversized %s output', async text => {
    const root = mkdtempSync(join(tmpdir(), 'response-'));
    const socketPath = join(root, 'controller.sock');
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const expected = { executionIdentity: 'execution', scopeDigest: 'a'.repeat(64) };
    const payload = { domain: 'xiaok.controller.response.v1', authorityId: 'authority', serviceEpoch: 'epoch', nonce: 'a'.repeat(64), method: 'execution.dispatch', requestHash: 'b'.repeat(64), result: { expected, termination: 'terminal', exitCode: 0, outputTruncated: false, stdout: text.repeat(700000), stderr: text.repeat(348576), physical: { expected, engineId: 'engine', engineEpoch: 'epoch', quiescent: true } } };
    const server = await startControllerIpc({ socketPath, dispatch: async () => encodeControllerResponse(payload, privateKey) });
    try {
      const bytes = await callControllerIpc(socketPath, Buffer.from('{}'));
      expect(bytes.length).toBeLessThanOrEqual(1024 ** 2);
      const reply = JSON.parse(bytes.toString());
      expect(verify(null, Buffer.from(canonicalVerificationJson(reply.payload)), publicKey, Buffer.from(reply.signature, 'base64'))).toBe(true);
      expect(reply.payload.result.physical).toEqual(payload.result.physical);
      expect(reply.payload.result.termination).toBe('terminal');
      expect(reply.payload.result.outputTruncated).toBe(true);
      expect(payload.result.outputTruncated).toBe(false);
      expect(payload.result.stdout.startsWith(reply.payload.result.stdout)).toBe(true);
      expect(payload.result.stderr.startsWith(reply.payload.result.stderr)).toBe(true);
    } finally { await server.close(); rmSync(root, { recursive: true, force: true }); }
  });
  it('refuses oversized essential metadata instead of truncating receipts', () => {
    const { privateKey } = generateKeyPairSync('ed25519');
    expect(() => encodeControllerResponse({ method: 'execution.dispatch', result: { stdout: 'x', stderr: '', outputTruncated: false, physical: { proof: 'p'.repeat(1024 ** 2) } } }, privateKey)).toThrow('controller_response_essential_limit');
  });
});
