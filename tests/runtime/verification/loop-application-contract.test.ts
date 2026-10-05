import {expect,it} from 'vitest';
import {parseLoopBusinessContract,loopBusinessContractHash} from '../../../src/runtime/verification/loop-application-contract.js';
import {createDefaultLoopContract} from '../../../desktop/electron/loop-contract.js';
const diagnostic={version:1,kind:'builtin-diagnostic',scanner:'artifact-evidence-regression',objective:'Publish the original scan.',completionCriterion:'Check the original report with the registered rules.'};
const assistant={version:1,kind:'assistant',assistantKind:'evening',profileId:'default-personal-assistant',locale:'zh',timeZone:'Asia/Shanghai',dataScopes:['threads','projects'],objective:'Review today.',completionCriterion:'Verify the recorded sources.'};
function template(){return {version:1,kind:'user-template',templateKind:'task_completion',prompt:'Complete task.',outputDirectory:'',outputFileName:'',loopContract:createDefaultLoopContract({kind:'task_completion',loopId:'loop',title:'Report',prompt:'Complete task.',now:1})};}
it.each([diagnostic,{...diagnostic,scanner:'kswarm-service-health'},assistant,{...assistant,assistantKind:'morning',locale:'en'},template()])('preserves the exact explicit producer business contract: %j',raw=>{
 const result=parseLoopBusinessContract(raw);expect(result).toEqual(raw);expect(Object.isFrozen(result)).toBe(true);
 expect(loopBusinessContractHash(raw)).toMatch(/^[a-f0-9]{64}$/);
 expect(()=>parseLoopBusinessContract({...raw,recipe:{kind:'self-scored-pass'}})).toThrow(/loop_contract/);
});
it('binds every described field rather than deriving a recipe or authority from it',()=>{
 expect(loopBusinessContractHash(diagnostic)).not.toBe(loopBusinessContractHash({...diagnostic,completionCriterion:'Another rule.'}));
 expect(loopBusinessContractHash(assistant)).not.toBe(loopBusinessContractHash({...assistant,timeZone:'UTC'}));
 const t=template(),h=loopBusinessContractHash(t);t.loopContract.successCriteria=[{kind:'task_completed',strength:'strong'}];expect(loopBusinessContractHash(t)).not.toBe(h);
 expect(parseLoopBusinessContract(template())).toMatchObject({loopContract:{successCriteria:[{kind:'task_completed',strength:'weak'}]}});
});
it.each([
 {...diagnostic,version:2},{...diagnostic,scanner:'unregistered-plugin'},
 {...assistant,profileId:'invented-profile'},{...assistant,locale:'zh-CN'},
 {...assistant,assistantKind:'unknown'},{...assistant,dataScopes:['all-files']},
 {...assistant,timeZone:''},{...diagnostic,objective:''},{...diagnostic,completionCriterion:''},
 {...template(),templateKind:'shell_script'},{...template(),outputDirectory:null},
])('rejects invalid branch or unavailable producer identity: %j',raw=>{
 expect(()=>parseLoopBusinessContract(raw)).toThrow(/loop_contract/);
});
it('checks nested legacy contract completeness, freezes scopes, and rejects oversized or accessor bodies',()=>{
 const t=template();(t.loopContract.triggerPolicy as any).implicitApproval=true;
 expect(()=>parseLoopBusinessContract(t)).toThrow(/loop_contract/);
 const input=structuredClone(assistant),r=parseLoopBusinessContract(input);input.dataScopes.push('tasks');expect(r).toEqual(assistant);expect(Object.isFrozen((r as any).dataScopes)).toBe(true);
 expect(()=>parseLoopBusinessContract({...diagnostic,objective:'中'.repeat(30000)})).toThrow(/limit/);
 let reads=0;expect(()=>parseLoopBusinessContract({...diagnostic,get objective(){reads++;return 'changed';}})).toThrow();expect(reads).toBe(0);
});
