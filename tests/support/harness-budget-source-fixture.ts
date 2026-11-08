import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {mkdirSync,statSync,appendFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {HarnessOptimizationStore} from '../../desktop/electron/harness-optimization-store.js';
import {DEFAULT_HARNESS_OPTIMIZATION_CONFIG} from '../../desktop/electron/harness-optimization-config.js';
const ledger=await import(new URL('../../desktop/electron/harness-dsh-budget-ledger.mjs',import.meta.url).href);
const source=await import(new URL('../../desktop/electron/harness-dsh-source-read-budget.mjs',import.meta.url).href);
const work=await import(new URL('../../desktop/electron/harness-dsh-work-escrow.mjs',import.meta.url).href);
const conservative=await import(new URL('../../desktop/electron/harness-dsh-budget-conservative.mjs',import.meta.url).href);
const revision=await import(new URL('../../desktop/electron/harness-dsh-account-revision.mjs',import.meta.url).href);
const draft=await import(new URL('../../desktop/electron/harness-dsh-draft-usage.mjs',import.meta.url).href);
const epoch=await import(new URL('../../desktop/electron/harness-dsh-account-epoch.mjs',import.meta.url).href);
const {dshDigest}=await import(new URL('../../desktop/electron/harness-dsh-budget-data.mjs',import.meta.url).href);

export function budgetStoreData(directory:string,initializing=true){const s=statSync(directory,{bigint:true});return {dbPath:join(directory,'harness-optimization.sqlite'),root:directory,identity:`${s.dev}:${s.ino}`,ownerId:'original-owner',initOperationId:'original-init',initializing,now:1000,defaultConfig:structuredClone(DEFAULT_HARNESS_OPTIMIZATION_CONFIG),profileId:'original-profile',workspaceId:'original-workspace'};}
export async function createOriginalBudgetVersion(path:string,v:number,withSource=v===4||v>=6){
 const directory=dirname(path);mkdirSync(directory,{recursive:true});const store=new HarnessOptimizationStore(budgetStoreData(directory),()=>{});try{await store.ready;}finally{await store.dispose();}
 const base=v>=6?5:v,db=new DatabaseSync(path);try{
  for(let n=3;n<=9;n++)db.function('xiaok_harness_dsh_budget_v'+n,()=>1);
  db.exec(''+(base>1?';'+(base===5?conservative.conservativeDshSchema(ledger.DSH_SCHEMA_SQL):ledger.DSH_SCHEMA_SQL):'')+(base>=3?';'+work.WORK_SCHEMA_SQL:'')+(withSource?';'+source.SOURCE_SCHEMA_SQL:'')+(base===5?';'+conservative.CONSERVATIVE_SQL+(withSource?conservative.CONSERVATIVE_SOURCE_GUARDS:''):'')+(v>=6?';'+revision.ACCOUNT_REVISION_SQL:'')+(v>=7?';'+draft.DRAFT_USAGE_SQL:'')+(v>=8?';'+epoch.ACCOUNT_EPOCH_SQL:'')+(v===9?';'+source.SOURCE_TENANT_SQL:''));
  const metadata:Record<string,string>={schemaVersion:String(v)};
  if(base>=3)Object.assign(metadata,{dshWorkProfile:work.WORK_ESCROW_PROFILE,dshWorkSchemaDigest:dshDigest('dsh-budget-work-schema-v1',work.WORK_SCHEMA_SQL)});
  if(withSource)Object.assign(metadata,{dshSourceProfile:source.SOURCE_READ_PROFILE,dshSourceSchemaDigest:dshDigest('dsh-budget-source-schema-v1',source.SOURCE_SCHEMA_SQL)});
  if(base===5)Object.assign(metadata,{dshConservativeProfile:conservative.CONSERVATIVE_PROFILE,dshConservativeSchemaDigest:dshDigest('dsh-budget-conservative-schema-v1',conservative.CONSERVATIVE_SQL+(withSource?conservative.CONSERVATIVE_SOURCE_GUARDS:''))});
  if(v>=6)Object.assign(metadata,{dshAccountRevisionProfile:revision.ACCOUNT_REVISION_PROFILE,dshAccountRevisionSchemaDigest:dshDigest('dsh-account-revision-schema-v1',revision.ACCOUNT_REVISION_SQL)});
  if(v>=7)Object.assign(metadata,{dshDraftUsageProfile:draft.DRAFT_USAGE_PROFILE,dshDraftUsageSchemaDigest:dshDigest('dsh-draft-usage-schema-v1',draft.DRAFT_USAGE_SQL)});
  if(v>=8)Object.assign(metadata,{dshAccountEpochProfile:epoch.ACCOUNT_EPOCH_PROFILE,dshAccountEpochSchemaDigest:dshDigest('dsh-account-epoch-schema-v1',epoch.ACCOUNT_EPOCH_SQL)});
  if(v===9)Object.assign(metadata,{dshSourceTenantProfile:source.SOURCE_TENANT_PROFILE,dshSourceTenantSchemaDigest:dshDigest('dsh-source-tenant-schema-v2',source.SOURCE_TENANT_SQL)});
  for(const [k,val]of Object.entries(metadata))db.prepare('INSERT OR REPLACE INTO metadata VALUES(?,?)').run(k,val);
  const fixed=ledger.createDshBudgetLedger({db,transaction:(fn:()=>unknown)=>fn(),ownerId:'original-owner',profileId:'original-profile',workspaceId:'original-workspace'});fixed.schema(String(v));fixed.graph();

 }finally{db.close();}
 // Genuine original Worker cold-read verifies the same ledger schema/graph and witness.
 const cold=new HarnessOptimizationStore(budgetStoreData(directory,false),()=>{});try{await cold.ready;}finally{await cold.dispose();}
}
export function compileBudgetCustody(root:string){
 const sqlite=resolve('node_modules/better-sqlite3/deps/sqlite3'),object=join(root,'sqlite.o'),sqliteHelper=join(root,'sqlite'),directoryHelper=join(root,'directory');
 function run(args:string[]){const result=spawnSync('clang',args,{encoding:'utf8',timeout:30000});if(process.env.XIAOK_BUDGET_SOURCE_PID_LOG)appendFileSync(process.env.XIAOK_BUDGET_SOURCE_PID_LOG,JSON.stringify({pid:result.pid,command:'clang',args,status:result.status,signal:result.signal})+'\n');if(result.error||result.status!==0)throw new Error(result.stderr||'compile_failed',{cause:result.error});}
 run(['-O2','-DSQLITE_THREADSAFE=0','-DSQLITE_OMIT_LOAD_EXTENSION=1','-DSQLITE_TEMP_STORE=3','-DSQLITE_ENABLE_DBPAGE_VTAB=1','-c',join(sqlite,'sqlite3.c'),'-o',object]);
 run(['-Wall','-Wextra','-Werror','-std=c11','-I',sqlite,resolve('src/runtime/verification/native/source-sqlite-custody.c'),object,'-o',sqliteHelper]);
 run(['-Wall','-Wextra','-Werror','-std=c11',resolve('src/runtime/verification/native/source-lock-custody.c'),'-o',directoryHelper]);return {sqliteHelper,directoryHelper};
}
/** Seed real held/unknown accounting only through the original ledger API. */
export async function createOriginalUnknownBudget(path:string){
 await createOriginalBudgetVersion(path,2);const db=new DatabaseSync(path);
 try{
  const data=await import(new URL('../../desktop/electron/harness-dsh-budget-data.mjs',import.meta.url).href),hash='a'.repeat(64);
  const transaction=ledger.createDshBudgetTransaction(db,(raw:unknown)=>{throw new Error('unexpected_fixture_outcome_unknown',{cause:raw});});
  const original=ledger.createDshBudgetLedger({db,transaction,ownerId:'original-owner',profileId:'original-profile',workspaceId:'original-workspace'});
  function invoke(purpose:string,input:unknown){return original.execute(purpose,{input,now:2000,authority:{requestSource:purpose==='open'?'user':'scheduler',profileId:'original-profile',workspaceId:'original-workspace',tenantId:'original-tenant',mandateId:'original-mandate',mandateRevision:1,authorizationEpoch:1,authorityHash:hash,commandDigest:data.dshBudgetCommandDigest(purpose,input)}});}
  invoke('open',{accountId:'account',tokenLimit:1000,costLimitMicros:1000,currency:'USD',scale:6,validUntil:100000});
  invoke('reserve',{accountId:'account',operation:{operationKey:'operation',purpose:'assessment',inputId:'input',evidenceHash:hash,semanticHash:hash,threadHash:hash,workId:null,maxAttempts:2,deadline:50000},attempt:{attemptId:'attempt',sequence:1,bodyHash:hash,providerId:'provider',modelId:'model',modelProfileId:'model_readonly_v1',pricingHash:hash,pricingKnown:true,maxInputTokens:200,maxOutputTokens:200,maxTokens:400,maxCostMicros:600,toolRounds:0}});
  invoke('marker',{accountId:'account',operationKey:'operation',sequence:1,attemptId:'attempt',bodyHash:hash});transaction(()=>original.recover());original.schema('2');original.graph();
 }finally{db.close();}
 const cold=new HarnessOptimizationStore(budgetStoreData(dirname(path),false),()=>{});try{await cold.ready;}finally{await cold.dispose();}
}
