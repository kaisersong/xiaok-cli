/** Fresh-process, serial, preregistered end-to-end Jev ablation. Private artifacts only. */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { runProcessToExit, validateMatchedRuns } from '../../../src/runtime/evals/jev-skill-experiment.js';
const args=process.argv.slice(2);
const arg=(key:string)=>{ const i=args.indexOf(key); if(i<0 || !args[i+1]) throw new Error(`missing ${key}`); return args[i+1]; };
if(!args.includes('--run-live')) throw new Error('requires --run-live');
const cwd=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const output=resolve(arg('--output'));
if(existsSync(output)) throw new Error('requires fresh output');
mkdirSync(output,{recursive:true,mode:0o700});
const order=['A','B','B','A','B','A','A','B'];
const fixed=['--config','--skill-root','--source','--python','--rubric','--model-id'].flatMap(key=>[key,arg(key)]);
const records:any[]=[];
const started=performance.now();
const fingerprint=()=>Object.fromEntries(['scripts/evals/jev-skill/run.mts','scripts/evals/jev-skill/audit.mts','scripts/evals/jev-skill/compare.mts','src/runtime/evals/jev-skill-experiment.ts','src/runtime/evals/source-owned-plan.ts'].map(file=>[file,createHash('sha256').update(readFileSync(join(cwd,file))).digest('hex')]));
const frozen=fingerprint();
function checkpoint(extra:any={}) {
 writeFileSync(join(output,'comparison.private.json'),JSON.stringify({order,completedRuns:records.length,benchmarkWallMs:Math.round(performance.now()-started),frozenCodeHashes:frozen,records,...extra},null,2),{mode:0o600});
}
checkpoint();
for(const [index,arm] of order.entries()) {
 const runDir=join(output,`${String(index+1).padStart(2,'0')}-${arm}`);
 const pair=Math.floor(index/2)+1;
 console.log(JSON.stringify({event:'start',position:index+1,pair,arm}));
 const child=await runProcessToExit({executable:process.execPath,args:['--import','tsx',join(cwd,'scripts/evals/jev-skill/run.mts'),'--run-live','--mode',arm==='A'?'source-owned-only':'source-owned-advice',...fixed,'--output',runDir],cwd,deadlineMs:16*60_000});
 writeFileSync(join(output,`${index+1}.stdout.private.txt`),child.stdout,{mode:0o600});
 writeFileSync(join(output,`${index+1}.stderr.private.txt`),child.stderr,{mode:0o600});
 const runFile=join(runDir,'run.json');
 let run:any=null;
 try { if(existsSync(runFile)) run=JSON.parse(readFileSync(runFile,'utf8')); } catch { /* Missing/invalid outcome refuses comparison; do not echo private diagnostics. */ }
 const record={position:index+1,pair,arm,endToEndMs:Math.round(child.wallMs),exitCode:child.exitCode,timedOut:child.timedOut,run};
 records.push(record);checkpoint();
 console.log(JSON.stringify({event:'finish',position:index+1,pair,arm,wallMs:record.endToEndMs,status:run?.result?.status ?? 'unknown',audit:run?.contentAudit?.verdict ?? 'unknown'}));
 if(JSON.stringify(fingerprint())!==JSON.stringify(frozen)) {checkpoint({invalidReason:'code changed during experiment'});throw new Error('frozen code changed');}
}
const validation=validateMatchedRuns(records);
const summary=(arm:string)=>{
 const rows=records.filter(r=>r.arm===arm),times=rows.map(r=>r.endToEndMs).sort((a,b)=>a-b);
 return {runs:rows.length,passed:rows.filter(r=>r.exitCode===0&&r.run?.contentAudit?.verdict==='pass').length,meanMs:times.reduce((a,b)=>a+b,0)/times.length,medianMs:(times[1]+times[2])/2,minMs:times[0],maxMs:times.at(-1)};
};
const groups={withoutJev:summary('A'),withJev:summary('B')};
const pairs=[1,2,3,4].map(pair=>{const a=records.find(r=>r.pair===pair&&r.arm==='A')!,b=records.find(r=>r.pair===pair&&r.arm==='B')!;return {pair,withoutJevMs:a.endToEndMs,withJevMs:b.endToEndMs,changePercent:100*(b.endToEndMs/a.endToEndMs-1),bothPassed:a.exitCode===0&&b.exitCode===0};});
checkpoint({validation,groups,pairs,medianReductionPercent:100*(1-groups.withJev.medianMs/groups.withoutJev.medianMs),scope:'one document, four pairs; shared provider cache unknown; descriptive experiment, not formal multi-document/independent visual acceptance'});
console.log(JSON.stringify({event:'complete',validation,groups,pairs}));
