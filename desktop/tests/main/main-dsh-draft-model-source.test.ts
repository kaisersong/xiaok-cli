// @vitest-environment node
import {expect,it} from 'vitest';
import * as draft from '../../electron/main-dsh-draft-model-source.js';
it('exposes only the fixed draft Source and private result/budget/resource readers',()=>{
 for(const name of ['createMainDshDraftModelSource','readOriginalDshDraftModelBudgetAuthority','readOriginalDshDraftModelResult','readOptionalOriginalDshDraftModelResourceContext','readOriginalDshDraftModelPhysicalReceipt','readOriginalDshDraftModelLaunchPhysicalFate'])expect(typeof (draft as any)[name]).toBe('function');
});
it('rejects copied or foreign draft identities before any getter or SDK',()=>{
 let reads=0;const fake=new Proxy({},{get(){reads++;throw Error('foreign');},ownKeys(){reads++;return [];},getOwnPropertyDescriptor(){reads++;throw Error('descriptor');}});
 expect(()=>draft.createMainDshDraftModelSource(fake)).toThrow();
 expect(()=>draft.readOriginalDshDraftModelBudgetAuthority(fake,fake,'reserve',fake)).toThrow('DSH_DRAFT_MODEL_ATTEMPT_REQUIRED');
 expect(()=>draft.readOriginalDshDraftModelResult(fake,fake,fake,fake,fake,fake)).toThrow('DSH_DRAFT_MODEL_RESULT_REQUIRED');
 expect(draft.readOptionalOriginalDshDraftModelResourceContext(fake,fake,fake,fake,fake)).toBeUndefined();
 expect(()=>draft.readOriginalDshDraftModelPhysicalReceipt(fake,fake,fake,fake,fake,fake)).toThrow('DSH_DRAFT_MODEL_PHYSICAL_RECEIPT_REQUIRED');
 expect(()=>draft.readOriginalDshDraftModelLaunchPhysicalFate(fake,fake,fake,fake,fake,fake)).toThrow('DSH_DRAFT_MODEL_LAUNCH_FATE_REQUIRED');expect(reads).toBe(0);
});
it('keeps a metadata-only original composition unable to turn a foreign launch into a model request',async()=>{
 const [{DesktopMultiAgentStore},{createMainDshBudgetAuthoritySource},{createMainDshModelSource},{createMainDshBusinessSource},{mkdtempSync,rmSync},{tmpdir},{join}]=await Promise.all([import('../../electron/desktop-multi-agent-store.js'),import('../../electron/main-dsh-budget-authority-source.js'),import('../../electron/main-dsh-model-source.js'),import('../../electron/main-dsh-business-source.js'),import('node:fs'),import('node:os'),import('node:path')]);
 const root=mkdtempSync(join(tmpdir(),'draft-source-member-')),realm={resolve(){throw Error('no Native authority');}},user={resolve(){throw Error('no user authority');}},runtime={};
 const store=new DesktopMultiAgentStore(join(root,'groups.sqlite'),{dshAdmissionSource:realm,dshUserControlSource:user}),budget=createMainDshBudgetAuthoritySource({realm,userSource:user});budget.bindStore(store);
 const model=createMainDshModelSource({realm,store,runtime,budgetSource:budget}),business=createMainDshBusinessSource({realm,runtime,budgetSource:budget});business.bindStore(store);
 const source=draft.createMainDshDraftModelSource({realm,store,runtime,budgetSource:budget,businessSource:business,modelSource:model});let getters=0;
 const foreign=new Proxy({},{get(){getters++;throw Error('must not inspect');},ownKeys(){getters++;return [];}});
 try{await expect(source.runDraft(foreign)).rejects.toThrow();expect(getters).toBe(0);await source.close();}
 finally{await source.close();await model.close();await business.close();await budget.drain();store.close();rmSync(root,{recursive:true,force:true});}
});
