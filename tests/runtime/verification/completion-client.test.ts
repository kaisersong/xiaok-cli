import {it,expect,vi} from 'vitest';
import {createCompletionClient} from '../../../src/runtime/verification/completion-client.js';
const owner={profileId:'p',ownerKind:'task' as const,ownerId:'o'},grant={id:'read-scope',secret:'a'.repeat(64)};
const state={owner,migrationEpoch:1,businessRevision:0,obligationSetRevision:1,obligationSetHash:'a'.repeat(64),obligationCount:2,currentVerification:'needs_revalidation'};
it('requires a current response for this exact protected owner on every sync and async read',async()=>{
 let response:unknown=state;const call=vi.fn(async()=>response),callSync=vi.fn(()=>response);
 const client=createCompletionClient({owner,readGrant:grant,transport:{call,callSync}});
 expect(client.inspectSync().currentVerification).toBe('needs_revalidation');expect((await client.inspect()).obligationCount).toBe(2);
 expect(callSync).toHaveBeenCalledWith('completion.inspect',{owner,readGrant:grant});
 response={...state,owner:{...owner,ownerId:'other'}};expect(()=>client.inspectSync()).toThrow(/binding/);
 response={...state,currentVerification:'ordinary'};await expect(client.inspect()).rejects.toThrow(/shape/);
 response={...state,obligationCount:0};expect(()=>client.inspectSync()).toThrow(/shape/);
 expect(callSync).toHaveBeenCalledTimes(3);expect(call).toHaveBeenCalledTimes(2);
});
it('never uses a cached successful inspection after transport loss and hides read grants',async()=>{
 const transport={call:vi.fn(async()=>({...state,currentVerification:'valid'})),callSync:vi.fn(()=>({...state,currentVerification:'valid'}))};
 const client=createCompletionClient({owner,readGrant:grant,transport});expect(client.inspectSync().currentVerification).toBe('valid');
 transport.callSync.mockImplementation(()=>{throw Error('offline');});expect(()=>client.inspectSync()).toThrow('offline');
 transport.call.mockRejectedValue(Error('offline'));await expect(client.inspect()).rejects.toThrow('offline');
 expect(JSON.stringify(client)).not.toContain(grant.secret);
});
it('retains a historical completion observation with the same original pure validation and no grant',async()=>{
 const {parseCurrentCompletionState}=await import('../../../src/runtime/verification/completion-client.js');
 const result=parseCurrentCompletionState(state,owner);expect(result).toEqual(state);expect(Object.isFrozen(result.owner)).toBe(true);
 expect(()=>parseCurrentCompletionState({...state,owner:{...owner,ownerId:'other'}},owner)).toThrow('binding');
 expect(()=>parseCurrentCompletionState({...state,obligationCount:0},owner)).toThrow('shape');
 expect(()=>parseCurrentCompletionState({...state,extra:'untyped'},owner)).toThrow('shape');
});
