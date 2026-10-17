import test from 'node:test';
import assert from 'node:assert/strict';
import * as paired from '../../scripts/evals/sol-pi/paired-core.mjs';
import { plan } from '../../scripts/evals/sol-pi/baseline-core.mjs';

test('v8 formal model override changes only the current model wire name in memory',()=>{
 const original={schemaVersion:2,defaultModelId:'default',providers:{p:{baseUrl:'https://api.deepseek.com',apiKey:'test'}},models:{default:{provider:'p',model:'old-alias',label:'unchanged'},other:{provider:'p',model:'other'}}};
 const before=structuredClone(original),result=paired.formalPairedConfig(original);
 assert.deepEqual(original,before);assert.equal(result.models.default.model,'deepseek-flash');
 result.models.default.model='old-alias';assert.deepEqual(result,original);
 assert.throws(()=>paired.formalPairedConfig({...original,defaultModelId:'absent'}));
});
test('v9 retains all 84 original cases with both ordinary main surfaces eligible',()=>{
 const schedule=paired.createPairedPlan();assert.equal(schedule.length,84);
 const candidate=schedule.filter(e=>e.arm==='candidate');
 assert.equal(candidate.filter(e=>e.mechanismAvailability==='eligible').length,24);
 assert.equal(candidate.filter(e=>e.mechanismAvailability==='not-ready').length,18);
 assert.deepEqual(candidate.map(e=>e.caseKey).sort(),plan.map(e=>e.key).sort());
 for(const e of candidate.filter(e=>e.mechanismAvailability==='eligible'))assert.ok(['cli','desktop'].includes(e.surface));
});

test('environment validation rejects manifest byte drift before loading production code',async()=>{
 const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path');
 const {verifyRecipeEnvironment}=await import('../../scripts/evals/sol-pi/paired-environment.mjs');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'solpi-env-'));
 try{await fs.writeFile(path.join(root,'environment.json'),'{}');await fs.writeFile(path.join(root,'manifest.json'),'{}');
  await assert.rejects(verifyRecipeEnvironment({sourceRoot:'/unavailable-source',environmentPath:path.join(root,'environment.json'),manifestPath:path.join(root,'manifest.json')}),/RECIPE_ENVIRONMENT_INVALID/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});


test('wiring qualification does not claim projection or recall activation',()=>{
 const e=paired.createPairedPlan().find(e=>e.arm==='candidate'&&e.surface==='cli');
 const summary=paired.summarizePaired([{...e,mechanism:{qualified:true,projection:{projectedRequests:0},recallCompleted:0}}]);
 assert.equal(summary.candidate.wiringQualified,1);
 assert.equal(summary.candidate.projectionActivated,0);
 assert.equal(summary.candidate.recallActivated,0);
 assert.equal(summary.candidate.records.length,42);
});
test('comparison remains pending until a valid complete environment check',()=>{
 assert.equal(paired.summarizePaired([]).comparisonValid,null);
 assert.equal(paired.summarizePaired([],{comparisonValid:false,limitation:'sleep'}).comparisonValid,false);
 assert.equal(paired.summarizePaired([],{comparisonValid:false,limitation:'sleep'}).comparisonLimitation,'sleep');
 assert.equal(paired.summarizePaired([],{comparisonValid:true,limitation:null}).comparisonValid,true);
});
