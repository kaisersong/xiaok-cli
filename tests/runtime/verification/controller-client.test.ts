import { describe, it, expect } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import { encodeControllerResponse } from '../../../src/runtime/verification/controller-response.js';
import { canonicalVerificationJson } from '../../../src/runtime/verification/protocol.js';
import { createAuthenticatedControllerClient } from '../../../src/runtime/verification/controller-client.js';
import { startControllerIpc, callControllerIpc } from '../../../src/runtime/verification/controller-ipc.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

describe('production signed controller client protocol (fixture key is not installed OS qualification)', () => {
  it('binds signed replies to this request nonce, method, payload hash and installed authority', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    let mode = 'ok';
    const client = createAuthenticatedControllerClient({ authorityId: 'service', publicKey, roundTrip: async bytes => {
      const request = JSON.parse(bytes.toString());
      const payload = { domain: 'xiaok.controller.response.v1', authorityId: mode === 'authority' ? 'other' : 'service', serviceEpoch: 'epoch-1', nonce: mode === 'nonce' ? '0'.repeat(64) : request.nonce, method: request.method, requestHash: request.requestHash, result: request.method === 'controller.identity' ? {serviceEpoch:'epoch-1',requestTicket:'t'.repeat(64).replace(/t/g,'a')} : { challengeId: 'challenge', canonicalReview: {} } };
      return Buffer.from(JSON.stringify({ payload, signature: sign(null, Buffer.from(canonicalVerificationJson(payload)), privateKey).toString('base64') }));
    }, roundTripSync() { throw Error('not used'); } });
    const draft = {} as any; const signal = new AbortController().signal;
    await expect(client.materialAuthorization.prepareMaterialAuthorization(draft, { signal })).resolves.toHaveProperty('challengeId', 'challenge');
    mode = 'nonce'; await expect(client.materialAuthorization.prepareMaterialAuthorization(draft, { signal })).rejects.toThrow('controller_response_binding');
    mode = 'authority'; await expect(client.materialAuthorization.prepareMaterialAuthorization(draft, { signal })).rejects.toThrow('controller_response_binding');
    expect(() => client.wrapPreparedValidationInput({ mountPlanHandle: { id: 'forged', secret: 'x'.repeat(32) }, scopeDigest: 'a'.repeat(64), command: { argv: ['/bin/true'], cwdRelative: '.' }, invocation: { sessionIdentity: 's', compoundOperationId: 'o', validationInvocationId: 'v' } })).toThrow('controller_mount_plan_unknown');
  });
  it.each(['x', '"\\\n'])('uses real IPC for private mount wrapping/reservation/dispatch with bounded %s output and rejects stale epochs', async output => {
    const root = mkdtempSync(join(tmpdir(), 'controller-client-'));
    const socketPath = process.platform === 'win32' ? '\\\\.\\pipe\\client-' + randomUUID() : join(root, 'service.sock');
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const invocation = { sessionIdentity: 's', compoundOperationId: 'o', validationInvocationId: 'v' };
    const command = { argv: ['/bin/true'], cwdRelative: '.' }, scopeDigest = 'a'.repeat(64);
    const expected = { ...invocation, scopeDigest, executionIdentity: 'execution-1' };
    const mountPlanHandle = { id: 'mount-1', secret: 'm'.repeat(32) }, executionHandle = { id: 'run-1', secret: 'r'.repeat(32) };
    let engineEpoch = 'epoch-1'; const requests: any[] = [];
    const reply = (bytes: Buffer) => {
      const request = JSON.parse(bytes.toString()); requests.push(request);
      const physical = { expected, engineId: 'engine', engineEpoch, quiescent: true };
      const result = request.method === 'controller.identity' ? {serviceEpoch:'instance-1',requestTicket:'a'.repeat(64)} : request.method === 'materials.stage' ? { mountPlanHandle, invocation, command, scopeDigest }
        : request.method === 'execution.reserve' ? { expected, executionIdentity: expected.executionIdentity, executionHandle }
        : request.method === 'execution.dispatch' ? { expected, exitCode: 0, termination: 'terminal', outputTruncated: false, stdout: output.repeat(700000), stderr: output.repeat(348576), physical }
        : physical;
      const payload = { domain: 'xiaok.controller.response.v1', authorityId: 'service', serviceEpoch: 'instance-1', nonce: request.nonce, method: request.method, requestHash: request.requestHash, result };
      return encodeControllerResponse(payload, privateKey);
    };
    const server = await startControllerIpc({ socketPath, dispatch: async bytes => reply(bytes) });
    try {
      const client = createAuthenticatedControllerClient({ authorityId: 'service', publicKey, roundTrip: (bytes, signal) => callControllerIpc(socketPath, bytes, { signal }), roundTripSync: reply });
      const prepared = await client.materialAuthorization.prepareValidationInput({ grantHandle: { id: 'grant', secret: 'g'.repeat(32) }, invocation }, { signal: new AbortController().signal });
      let nestedWrapRejected = false;
      const plan = client.wrapPreparedValidationInput(new Proxy(structuredClone(prepared), { getOwnPropertyDescriptor(target, key) { try { client.wrapPreparedValidationInput(prepared); } catch { nestedWrapRejected = true; } return Object.getOwnPropertyDescriptor(target, key); } }));
      expect(nestedWrapRejected).toBe(true);
      expect(() => client.wrapPreparedValidationInput(prepared)).toThrow('controller_mount_plan_unknown');
      let planReads = 0;
      let nestedReserve: ReturnType<typeof client.execution.reserveExecution> | undefined;
      const proxyCommand = new Proxy(command, { getOwnPropertyDescriptor(target, key) { nestedReserve ??= client.execution.reserveExecution({ ...invocation, command, scopeDigest, materializedInput: plan }); void nestedReserve.catch(() => {}); return Object.getOwnPropertyDescriptor(target, key); } });
      const reserveInput = { ...invocation, command: proxyCommand, scopeDigest, get materializedInput() { return ++planReads === 1 ? plan : {} as any; } };
      const reserved = await client.execution.reserveExecution(reserveInput);
      expect(planReads).toBe(1);
      await expect(nestedReserve).rejects.toThrow('controller_mount_plan_unknown');
      let stdout = '', stderr = '';
      const dispatched = await client.execution.dispatchExecution(reserved.expected, { onStdout: text => { stdout += text; }, onStderr: text => { stderr += text; } });
      await expect(client.execution.dispatchExecution(reserved.expected)).rejects.toThrow('controller_execution_handle_missing');
      await expect(client.execution.reserveExecution({ ...invocation, command, scopeDigest, materializedInput: plan })).rejects.toThrow('controller_mount_plan_unknown');
      expect(dispatched.termination).toBe('terminal'); expect(dispatched.outputTruncated).toBe(true);
      expect(stdout.length + stderr.length).toBeGreaterThan(0);
      expect(requests.find(request => request.method === 'execution.dispatch').payload.executionHandle).toEqual(executionHandle);
      expect(() => client.execution.assertQuiescent(dispatched.receipt!, expected)).not.toThrow();
      engineEpoch = 'epoch-2';
      expect(() => client.execution.assertQuiescent(dispatched.receipt!, expected)).toThrow('controller_quiescence_epoch');
      expect(() => client.execution.assertQuiescent({} as any, expected)).toThrow('controller_quiescence_unknown');
      client.dispose();
      await expect(client.execution.inspectExecution(expected)).rejects.toThrow();
    } finally { await server.close(); rmSync(root, { recursive: true, force: true }); }
  });
});
it('binds synchronous and asynchronous metadata allocation calls to actual signed controller responses',async()=>{const {privateKey,publicKey}=generateKeyPairSync('ed25519');const methods:string[]=[];let wrong=false;const reply=(bytes:Buffer)=>{const r=JSON.parse(bytes.toString());methods.push(r.method);return encodeControllerResponse({domain:'xiaok.controller.response.v1',authorityId:'service',serviceEpoch:'boot',nonce:wrong?'0'.repeat(64):r.nonce,method:r.method,requestHash:r.requestHash,result:r.method==='controller.identity'?{serviceEpoch:'boot',requestTicket:'a'.repeat(64)}:{resourceId:'db'}},privateKey);};const client=createAuthenticatedControllerClient({authorityId:'service',publicKey,roundTrip:async bytes=>reply(bytes),roundTripSync:reply});try{await expect(client.metadataCapacityTransport.call('capacity.metadata.prepare',{})).resolves.toEqual({resourceId:'db'});expect(client.metadataCapacityTransport.callSync('capacity.metadata.query',{})).toEqual({resourceId:'db'});wrong=true;expect(()=>client.metadataCapacityTransport.callSync('capacity.metadata.confirm',{})).toThrow('controller_response_binding');expect(()=>client.metadataCapacityTransport.callSync('arbitrary' as any,{})).toThrow('controller_metadata_method');expect(methods).toContain('capacity.metadata.prepare');}finally{client.dispose();}});
