import {expect,it} from 'vitest';
import {parseLoopContractV1,isWeakOnlyBackgroundContract} from '../../../src/runtime/loop/contract.js';
import {parseStrictLoopContractV1} from '../../../src/runtime/verification/loop-application-contract.js';
import {parseLoopContractV1 as desktopParser,createDefaultLoopContract,isWeakOnlyBackgroundContract as desktopWeak} from '../../../desktop/electron/loop-contract.js';
function fixture(){return createDefaultLoopContract({kind:'task_completion',loopId:'loop',title:'Report',prompt:'Complete the original task.',now:1});}
it('uses one production parser from both core and Desktop without strengthening old weak contracts',()=>{
 expect(desktopParser).toBe(parseLoopContractV1);expect(desktopWeak).toBe(isWeakOnlyBackgroundContract);
 const original=fixture(),parsed=parseLoopContractV1(original,{registeredCriteria:['task_completed']});
 expect(parsed).toEqual(original);expect(isWeakOnlyBackgroundContract(parsed)).toBe(true);
 expect(parseStrictLoopContractV1(original)).toEqual(original);
});
it.each(['triggerPolicy','stopPolicy','permissionPolicy','concurrencyPolicy','legacyPolicy'] as const)('strict signed values reject fields the ordinary parser would drop: %s',field=>{
 const original=fixture();(original[field] as any).inventedAuthorization=true;
 expect(()=>parseLoopContractV1(original,{registeredCriteria:['task_completed']})).not.toThrow();
 expect(()=>parseStrictLoopContractV1(original)).toThrow(/loop_contract/);
});
it.each([
 {kind:'task_completed',strength:'weak'},
 {kind:'file_exists',pathTemplate:'report.txt',minBytes:0,expectedMime:'text/plain'},
 {kind:'command_exit_zero',commandId:'test',args:['--run'],cwdPolicy:'workspace'},
])('strict signed values preserve actual criterion fields and reject an added hidden grant: %j',criterion=>{
 const original={...fixture(),successCriteria:[criterion]};
 expect(parseStrictLoopContractV1(original)).toEqual(original);
 expect(()=>parseStrictLoopContractV1({...original,successCriteria:[{...criterion,grant:true}]})).toThrow(/loop_contract/);
});
it('captures before freezing, rejects accessors without reading them, and keeps the complete size bound',()=>{
 const original=fixture(),captured=parseStrictLoopContractV1(original);original.successCriteria.length=0;
 expect(captured.successCriteria).toHaveLength(1);expect(Object.isFrozen(captured.successCriteria[0])).toBe(true);
 expect(Object.isFrozen(captured.permissionPolicy.allowedToolCategories)).toBe(true);
 let reads=0;const accessor={...fixture(),get objective(){reads++;return 'fake';}};
 expect(()=>parseStrictLoopContractV1(accessor)).toThrow();expect(reads).toBe(0);
 expect(()=>parseStrictLoopContractV1({...fixture(),objective:'x'.repeat(65536)})).toThrow(/limit/);
});
