// @vitest-environment node
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,expect,it} from 'vitest';
import {DesktopMultiAgentStore} from '../../electron/desktop-multi-agent-store.js';
import {createMainDshBudgetAuthoritySource,readOriginalMainDshBudgetAuthoritySource} from '../../electron/main-dsh-budget-authority-source.js';
import {createMainDshModelSource,readOriginalMainDshModelSource,readOriginalDshAssessmentResult,readOriginalDshModelBudgetAuthority} from '../../electron/main-dsh-model-source.js';
const disposals:Array<()=>unknown>=[];
afterEach(async()=>{for(const close of disposals.splice(0).reverse())await close();});
function fixture(){const realm={resolve(){throw Error('a shaped realm grants nothing');}},user={resolve(){throw Error('a shaped user grants nothing');}},root=mkdtempSync(join(tmpdir(),'dsh-model-denied-'));disposals.push(()=>rmSync(root,{recursive:true,force:true}));const store=new DesktopMultiAgentStore(join(root,'groups.sqlite'),{dshAdmissionSource:realm,dshUserControlSource:user});disposals.push(()=>store.close());const budget=createMainDshBudgetAuthoritySource({realm,userSource:user});budget.bindStore(store);disposals.push(()=>budget.drain());return{realm,user,store,budget};}
it('rejects hostile foreign result and budget attempt identities without observing their properties',()=>{let hooks=0;const fake=new Proxy({},{get(){hooks++;throw Error('get');},getOwnPropertyDescriptor(){hooks++;throw Error('descriptor');},ownKeys(){hooks++;throw Error('keys');}});expect(()=>readOriginalDshAssessmentResult(fake,fake,fake,'attempt')).toThrow('DSH_MODEL_RESULT_REQUIRED');expect(()=>readOriginalDshModelBudgetAuthority(fake,fake,'reserve',fake)).toThrow('DSH_MODEL_ATTEMPT_REQUIRED');expect(hooks).toBe(0);});
it('does not let a shaped model source or Source-looking store construct a model owner',()=>{let hooks=0;const fake=new Proxy({},{get(){hooks++;throw Error('get');},getOwnPropertyDescriptor(){hooks++;throw Error('descriptor');},ownKeys(){hooks++;throw Error('keys');}});expect(()=>createMainDshModelSource(fake)).toThrow();expect(()=>createMainDshModelSource({realm:{},store:fake,runtime:{},budgetSource:{}})).toThrow();expect(hooks).toBe(0);});
it('refuses non-original Main provenance before model/config/budget commands or source bodies',async()=>{const f=fixture(),model=createMainDshModelSource({realm:f.realm,store:f.store,runtime:{},budgetSource:f.budget});disposals.push(()=>model.close());await expect(model.runAssessment('attempt')).rejects.toThrow('DSH_MODEL_ATTEMPT_FAILED');await model.close();await expect(model.runAssessment('attempt')).rejects.toThrow();});
it('pins the original Main budget Source tuple and does not turn a user proof into scheduler authority',async()=>{const f=fixture();expect(readOriginalMainDshBudgetAuthoritySource(f.budget,f.realm,f.store).assertLocal()).toBeUndefined();expect(()=>readOriginalMainDshBudgetAuthoritySource(f.budget,{},f.store)).toThrow();let hooks=0;const fake=new Proxy({},{get(){hooks++;throw Error('get');},getOwnPropertyDescriptor(){hooks++;throw Error('descriptor');}});expect(()=>f.budget.openAssessmentBudget(fake,'reserve',fake)).toThrow('DSH_MODEL_ATTEMPT_REQUIRED');expect(hooks).toBe(0);expect(f.budget.resolve({},'reserve')).toBeNull();});

it('shares one original attempt outcome and never starts a second execution for the same durable attempt',async()=>{const f=fixture(),source=createMainDshModelSource({realm:f.realm,store:f.store,runtime:{},budgetSource:f.budget});disposals.push(()=>source.close());const one=source.runAssessment('same-attempt'),two=source.runAssessment('same-attempt');expect(two).toBe(one);await expect(one).rejects.toThrow('DSH_MODEL_ATTEMPT_FAILED');expect(source.runAssessment('same-attempt')).toBe(one);});

it('pins the original coordinator model handle before any foreign handle properties',async()=>{const f=fixture(),runtime={},source=createMainDshModelSource({realm:f.realm,store:f.store,runtime,budgetSource:f.budget});disposals.push(()=>source.close());expect(readOriginalMainDshModelSource(source,f.realm,f.store,runtime,f.budget)).toBe(source);expect(()=>readOriginalMainDshModelSource({...source},f.realm,f.store,runtime,f.budget)).toThrow();let reads=0;const fake=new Proxy({},{get(){reads++;throw Error('foreign');}});expect(()=>readOriginalMainDshModelSource(fake,f.realm,f.store,runtime,f.budget)).toThrow();expect(reads).toBe(0);expect(()=>readOriginalMainDshModelSource(source,f.realm,f.store,{},f.budget)).toThrow();source.stopAccepting();expect(()=>readOriginalMainDshModelSource(source,f.realm,f.store,runtime,f.budget)).toThrow();});
it('reads reusable pricing only from the same original model Source and never a copied price or foreign handle',async()=>{
 const module=await import('../../electron/main-dsh-model-source.js') as any;
 expect(typeof module.readOriginalDshModelPricingEvidence).toBe('function');
 let reads=0;const fake=new Proxy({},{get(){reads++;throw Error('foreign');},ownKeys(){reads++;return [];}});
 expect(()=>module.readOriginalDshModelPricingEvidence(fake,fake,fake,fake,fake)).toThrow('DSH_MODEL_PRICING_EVIDENCE_REQUIRED');expect(reads).toBe(0);
 const f=fixture(),runtime={},model=createMainDshModelSource({realm:f.realm,store:f.store,runtime,budgetSource:f.budget});disposals.push(()=>model.close());
 expect(()=>module.readOriginalDshModelPricingEvidence(model,f.realm,f.store,runtime,f.budget)).toThrow('DSH_MODEL_PRICING_EVIDENCE_UNAVAILABLE');
 expect(()=>module.readOriginalDshModelPricingEvidence(model,f.realm,f.store,{},f.budget)).toThrow('DSH_MODEL_PRICING_EVIDENCE_REQUIRED');
});

it('pricing GET requires the exact original private assessment token before reading a foreign value', async () => {
 const modelModule=await import('../../electron/main-dsh-model-source.js');
 const sourceModule=await import('../../electron/dsh-github-source-session.js');
 let getters=0;const fake=new Proxy({},{get(){getters++;throw Error('get');},ownKeys(){getters++;return [];},getOwnPropertyDescriptor(){getters++;throw Error('descriptor');}});
 expect(()=>modelModule.readOriginalDshModelPricingRequest(fake,fake)).toThrow('DSH_MODEL_PRICING_REQUEST_REQUIRED');
 await expect(sourceModule.readOriginalMainDshModelPricing(fake,fake)).rejects.toThrow('DSH_MODEL_PRICING_REQUEST_REQUIRED');
 const f=fixture(),runtime={},model=createMainDshModelSource({realm:f.realm,store:f.store,runtime,budgetSource:f.budget});disposals.push(()=>model.close());
 expect(()=>modelModule.readOriginalDshModelPricingRequest(model,fake)).toThrow('DSH_MODEL_PRICING_REQUEST_REQUIRED');
 await expect(sourceModule.readOriginalMainDshModelPricing(model,fake)).rejects.toThrow('DSH_MODEL_PRICING_REQUEST_REQUIRED');expect(getters).toBe(0);
});
