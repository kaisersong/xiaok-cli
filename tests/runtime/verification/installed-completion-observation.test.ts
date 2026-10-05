import {it,expect,vi} from 'vitest';
const ports=vi.hoisted(()=>({ownerState:{kind:'ordinary'} as any,result:{currentVerification:'valid'} as any,opens:0,disposes:0}));
vi.mock('../../../src/runtime/verification/installed-owner-state.js',()=>({readInstalledCurrentOwner:()=>ports.ownerState}));
vi.mock('../../../src/runtime/verification/controller-client.js',()=>({createInstalledVerificationClient:()=>{ports.opens++;return {completionTransport:{},dispose(){ports.disposes++;}};}}));
vi.mock('../../../src/runtime/verification/completion-client.js',()=>({openCompletionClientSync:()=>({inspectSync:()=>{if(ports.result instanceof Error)throw ports.result;return ports.result;}}),openCompletionClient:async()=>({inspect:async()=>{if(ports.result instanceof Error)throw ports.result;return ports.result;}})}));
import {observeInstalledCompletionSync,observeInstalledCompletion} from '../../../src/runtime/verification/installed-completion-observation.js';
const owner={ownerKind:'task' as const,ownerId:'one'},indexOwner={...owner,profileId:'actual'};
it('does not connect ordinary owners and always reobserves protected owner status with no cached pass',async()=>{
 ports.ownerState={kind:'ordinary'};ports.opens=ports.disposes=0;expect(observeInstalledCompletionSync(owner)).toEqual({kind:'ordinary'});expect(ports.opens).toBe(0);
 ports.ownerState={kind:'protected-unregistered',authorityId:'authority',owner:indexOwner};ports.result={owner:indexOwner,obligationCount:1,currentVerification:'valid'};
 expect(observeInstalledCompletionSync(owner)).toMatchObject({kind:'protected',state:{currentVerification:'valid'}});
 ports.result=Error('offline');expect(await observeInstalledCompletion(owner)).toEqual({kind:'unavailable'});expect(ports.opens).toBe(2);expect(ports.disposes).toBe(2);
});
it('never treats missing index, pending migration or different resolved profile as ordinary',async()=>{
 ports.ownerState={kind:'unavailable'};expect(await observeInstalledCompletion(owner)).toEqual({kind:'unavailable'});
 ports.ownerState={kind:'pending',owner:indexOwner,authorityId:'authority'};const before=ports.opens;expect(observeInstalledCompletionSync(owner)).toEqual({kind:'unavailable'});expect(ports.opens).toBe(before);
 ports.ownerState={kind:'protected-unregistered',owner:indexOwner,authorityId:'authority'};ports.result={owner:{...indexOwner,profileId:'other'},obligationCount:1,currentVerification:'valid'};
 expect(observeInstalledCompletionSync(owner)).toEqual({kind:'unavailable'});
});
