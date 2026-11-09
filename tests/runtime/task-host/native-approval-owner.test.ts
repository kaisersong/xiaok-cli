import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {nativeApprovalOwnerSchema} from '../../../src/runtime/task-host/native-approval-owner.js';
import {projectRuntimeEventToDesktopEvent} from '../../../src/runtime/task-host/event-projection.js';
import {createCapturedTaskDeclarationAccumulator} from '../../../src/runtime/task-host/captured-task-declarations.js';
import {TASK7_EVENT,TASK7_ANSWER} from '../../../desktop/shared/task7-ipc-contract.js';
const owner={schemaVersion:1,kind:'codex_native_approval',taskSessionId:'host-session',nativeIncarnation:randomUUID(),nativeSessionId:'native-session',nativeThreadId:'native-thread',nativeTurnId:'actual-native-turn',nativeTurnGeneration:1,approvalToken:'question',requestDigest:'a'.repeat(64)};
const event={type:'approval_required',sessionId:'host-session',turnId:'host-task-not-native-turn',approvalId:'question',prompt:'same approval text',choices:[{id:'approve',label:'Allow'},{id:'deny',label:'Deny'}]};
it('preserves explicitly produced original Native owner metadata through the real projection, IPC contract and source declaration parser',()=>{
 const projected=projectRuntimeEventToDesktopEvent({taskId:'task',event:{...event,owner} as any});expect(projected?.type).toBe('needs_user');if(projected?.type!=='needs_user')throw Error('missing question');
 expect(projected.question.owner).toEqual(owner);expect(projected.question.owner?.nativeTurnId).not.toBe(event.turnId);expect(TASK7_EVENT.safeParse(projected).success).toBe(true);
 const capture=createCapturedTaskDeclarationAccumulator();capture.capture({events:[projected]},'snapshot');const declaration=capture.finish('task',['host-session']);
 expect(declaration.references).toContainEqual({namespace:'codex-native-turn',relation:'snapshot.events[0].question.owner.nativeTurnId',id:'actual-native-turn'});
 expect(TASK7_ANSWER.safeParse({type:'choice',questionId:'question',choiceId:'approve',owner}).success).toBe(false);
});
it('never infers a Native owner from generic approval text, choices or question kind',()=>{
 const projected=projectRuntimeEventToDesktopEvent({taskId:'task',event:event as any});expect(projected?.type).toBe('needs_user');if(projected?.type!=='needs_user')throw Error('missing question');expect(Object.hasOwn(projected.question,'owner')).toBe(false);
 expect(TASK7_EVENT.safeParse(projected).success).toBe(true);const captured=createCapturedTaskDeclarationAccumulator();captured.capture({events:[projected]},'snapshot');expect(captured.finish('task',[]).references.some(ref=>ref.namespace.startsWith('codex-native'))).toBe(false);
});
it('rejects malformed or cross-task owner data and accessors without executing their hooks',()=>{
 for(const bad of [{...owner,extra:true},{...owner,nativeTurnGeneration:NaN},{...owner,nativeTurnGeneration:Number.MAX_SAFE_INTEGER+1},{...owner,requestDigest:'bad'},{...owner,nativeIncarnation:'bad'}])expect(nativeApprovalOwnerSchema.safeParse(bad).success).toBe(false);
 for(const bad of [{...owner,taskSessionId:'foreign'},{...owner,approvalToken:'foreign'}])expect(()=>projectRuntimeEventToDesktopEvent({taskId:'task',event:{...event,owner:bad} as any})).toThrow('native_approval_owner_mismatch');
 let calls=0;const getter={...owner};Object.defineProperty(getter,'nativeSessionId',{enumerable:true,get(){calls++;return 'hook';}});expect(nativeApprovalOwnerSchema.safeParse(getter).success).toBe(false);expect(calls).toBe(0);
 const parent={...event};Object.defineProperty(parent,'owner',{enumerable:true,get(){calls++;return owner;}});expect(()=>projectRuntimeEventToDesktopEvent({taskId:'task',event:parent as any})).toThrow('native_approval_owner_invalid');expect(calls).toBe(0);
});
