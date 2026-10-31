import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {runProcessToExit} from '../../../src/runtime/evals/jev-skill-experiment.js';
const args=process.argv.slice(2);const arg=(n:string)=>{const i=args.indexOf(n);if(i<0)throw new Error(`missing ${n}`);return args[i+1];};
const qualified=args.includes('--qualified-discovery');
if(!args.includes('--run-live'))throw new Error('requires --run-live');
const out=resolve(arg('--output'));if(existsSync(out))throw new Error('fresh output required');mkdirSync(out,{recursive:true,mode:0o700});
const baseline=resolve(arg('--baseline'));const config=resolve(arg('--config'));
const files=['scripts/evals/jev-capability/baseline.mts','scripts/evals/jev-capability/run.mts','scripts/evals/jev-capability/compare.mts','src/runtime/evals/jev-capability-experiment.ts','src/runtime/evals/jev-capability-telemetry.ts','src/runtime/evals/jev-decision-experiment.ts','src/runtime/evals/jev-skill-experiment.ts','src/ai/tools/index.ts','src/ai/tools/search.ts','src/platform/runtime/capability-registry.ts','src/ai/skills/loader.ts','src/ai/skills/tool.ts','src/ai/agent.ts','src/ai/runtime/agent-runtime.ts'];
const hashes=()=>Object.fromEntries(files.map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')]));const frozen=hashes();
const order=[['T01','O'],['T01','J'],['T02','J'],['T02','O'],['T03','O'],['T03','J'],['T04','J'],['T04','O'],['T01','J'],['T01','O'],['T02','O'],['T02','J'],['T03','J'],['T03','O'],['T04','O'],['T04','J']];
const save=(n:string,v:unknown)=>writeFileSync(join(out,n),JSON.stringify(v,null,2),{mode:0o600});
save('preregistration.json',{startedAt:new Date().toISOString(),cohort:qualified?'qualified-discovery':'initial-discovery',files:frozen,order,configHash:createHash('sha256').update(readFileSync(config)).digest('hex'),baseline:JSON.parse(readFileSync(join(baseline,'baseline.json'),'utf8')),corpusHash:createHash('sha256').update(readFileSync(join(baseline,'corpus.json'))).digest('hex'),casesHash:createHash('sha256').update(readFileSync(join(baseline,'cases.json'))).digest('hex'),modelId:arg('--model-id'),scope:'finite cases + complete controlled discovery subtasks; not product UI or full slide task; exploratory same-author labels'});
const started=performance.now();
async function child(name:string,extra:string[]){if(JSON.stringify(hashes())!==JSON.stringify(frozen))throw new Error('frozen code changed');const dir=join(out,name);const processResult=await runProcessToExit({executable:process.execPath,args:['--import','tsx','scripts/evals/jev-capability/run.mts','--run-live','--baseline',baseline,'--config',config,'--model-id',arg('--model-id'),'--output',dir,...(qualified?['--qualified-discovery']:[]),...extra],cwd:process.cwd(),deadlineMs:130000});save(`${name}-process.private.json`,processResult);let run:any=null;try{run=JSON.parse(readFileSync(join(dir,'run.json'),'utf8'));}catch{}return{name,parentWallMs:Math.round(processResult.wallMs),exitCode:processResult.exitCode,timedOut:processResult.timedOut,run};}
const cases=qualified?null:await child('cases',['--mode','cases']);if(cases){save('cases-process.private.json',cases);console.log(JSON.stringify({phase:'cases',count:cases.run?.result?.records?.length}));}
const records=[];
for(let i=0;i<order.length;i++){const[task,arm]=order[i];const r=await child(`${String(i+1).padStart(2,'0')}-${task}-${arm}`,['--mode','task','--task',task,'--arm',arm]);records.push(r);save('comparison.private.json',{cases,records,frozen,benchmarkWallMs:Math.round(performance.now()-started)});console.log(JSON.stringify({name:r.name,wallMs:r.parentWallMs,qualityPass:r.run?.result?.qualityPass,llmCalls:r.run?.calls?.length,jevCalls:r.run?.jevCalls?.length,consumption:r.run?.consumption}));}
console.log(JSON.stringify({completedRuns:records.length,benchmarkWallMs:Math.round(performance.now()-started)}));
