import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function isDocsOnly(files, event) {
 return event === 'pull_request' && files.length > 0 && files.every(file =>
  !/[\r\n\0]/.test(file) && (/^README(?:[._-][a-zA-Z0-9-]+)?\.md$/.test(file) || file === 'CHANGELOG.md' || /^docs\/.+\.md$/.test(file)));
}
export function changedPaths(base, head, cwd = process.cwd()) {
 if (![base,head].every(sha => /^[a-f0-9]{40}$/.test(sha))) throw new Error('Expected full commit SHA');
 return execFileSync('git',['diff','--no-renames','--name-only','-z',base,head,'--'],{cwd,encoding:'utf8'}).split('\0').filter(Boolean);
}
export const canonicalName = entry => entry.parts.join(' ');
export function partitionCases(inventory, count) {
 if (!inventory.length || !Number.isInteger(count) || count < 1) throw new Error('Empty inventory or invalid shard count');
 const seen=new Set();const parts=Array.from({length:count},()=>[]);
 for (const row of inventory) {
  if (!row.parts?.length || row.parts.some(x=>typeof x!=='string') || !['run','skip','todo'].includes(row.mode)) throw new Error('Invalid test identity/mode');
  const name=canonicalName(row);
  if (seen.has(name)) throw new Error(`Ambiguous/duplicate canonical test name: ${name}`);
  seen.add(name);
 }
 // Balance runnable cases independently of natural skips; hash order avoids
 // lexically clustered scenarios while keeping every identity deterministic.
 for (const runnable of [true,false]) {
  const names=inventory.filter(row=>(row.mode==='run')===runnable).map(canonicalName).sort((a,b)=>digest(a).localeCompare(digest(b)));
  names.forEach((name,index)=>parts[index%count].push(name));
 }
 if (parts.some(part=>!part.length)) throw new Error('Empty shard');
 return parts;
}
export function auditCases(selected, report, inventory) {
 const expected=new Set(selected);const found=new Set();const modes=new Map(inventory?.map(row=>[canonicalName(row),row.mode]));
 for (const file of report.testResults ?? []) for (const row of file.assertionResults ?? []) {
  if (found.has(row.fullName)) throw new Error(`Duplicate result ${row.fullName}`);
  found.add(row.fullName);
  if (expected.has(row.fullName)) {
   const mode=modes.get(row.fullName) ?? 'run';
   if (mode==='run' && !['passed','failed'].includes(row.status)) throw new Error(`Selected case did not run: ${row.fullName}`);
   if (mode==='skip' && row.status!=='skipped') throw new Error(`Natural skip changed: ${row.fullName}`);
   if (mode==='todo' && row.status!=='todo') throw new Error(`Natural todo changed: ${row.fullName}`);
  } else if (row.status!=='skipped' && !(modes.get(row.fullName)==='todo' && row.status==='todo')) throw new Error(`Unexpectedly executed or unfinished ${row.fullName}`);
 }
 for (const name of expected) if(!found.has(name)) throw new Error(`Missing case ${name}`);
 if(inventory && (found.size!==inventory.length || inventory.some(row=>!found.has(canonicalName(row))))) throw new Error('Runtime inventory differs from collection');
}
function load(path) {return JSON.parse(readFileSync(path,'utf8'));}
function save(path,value) {writeFileSync(path,JSON.stringify(value,null,2)+'\n');}
async function collect(config,file,directory,group,index,total) {
 const sandbox=config.endsWith('vitest.sandbox.config.mjs');
 if(sandbox)await import('../../tests/support/vite-net-use-patch.cjs');
 const {createVitest}=await import('vitest/node');
 const ctx=await createVitest('test',{config,...(sandbox?{configLoader:'runner'}:{}),watch:false,reporters:[],cache:false,maxWorkers:1});
 let result;let collectionError;
 try {result=await ctx.collect([file]);}catch(error){collectionError=error;}
 try {await ctx.close();}catch(error){throw collectionError?new AggregateError([collectionError,error],'Collection and close failed'):error;}
 if(collectionError)throw collectionError;
 if(result.unhandledErrors.length || result.testModules.length!==1) throw new Error('Collection failed or selected multiple files');
 const inventory=[];
 for(const mod of result.testModules) for(const test of mod.children.allTests()) {
  const parts=[test.name];let parent=test.parent;
  while(parent.type!=='module'){parts.unshift(parent.name);parent=parent.parent;}
  inventory.push({parts,mode:test.options.mode});
 }
 const partitions=partitionCases(inventory,Number(total));const shard=Number(index);
 if(!Number.isInteger(shard)||shard<1||shard>partitions.length)throw new Error('Invalid shard');
 const selected=partitions[shard-1];
 if(!inventory.some(row=>row.mode==='run'&&selected.includes(canonicalName(row))))throw new Error('Shard has no runnable tests');
 const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 const configHash=digest([config,readFileSync(config,'utf8'),readFileSync('package-lock.json','utf8'),readFileSync(file,'utf8')]);
 mkdirSync(directory,{recursive:true});
 save(join(directory,'manifest.json'),{version:1,head,configHash,file,config,group,index:shard,total:Number(total),inventory,inventoryHash:digest(inventory),selected});
}
function run(directory) {
 for(const name of ['results.json','audit.json','run-receipt.json'])rmSync(join(directory,name),{force:true});
 const m=load(join(directory,'manifest.json'));const escaped=m.selected.map(x=>x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
 const sandbox=m.config.endsWith('vitest.sandbox.config.mjs');
 const args=[...(sandbox?['-r','./tests/support/vite-net-use-patch.cjs']:[]),'./node_modules/vitest/vitest.mjs','run',...(sandbox?['--no-cache','--configLoader','runner']:[]),'--config',m.config,m.file,'--maxWorkers=1','--testNamePattern',`^(?:${escaped.join('|')})$`,'--reporter=default','--reporter=json',`--outputFile=${join(directory,'results.json')}`];
 const child=spawnSync(process.execPath,args,{stdio:'inherit'});
 if(child.error)throw child.error;
 if(child.signal)throw new Error(`Vitest terminated: ${child.signal}`);
 save(join(directory,'run-receipt.json'),{head:m.head,inventoryHash:m.inventoryHash,selectedHash:digest(m.selected),exitCode:child.status,signal:child.signal,error:null});
 process.exitCode=child.status ?? 1;
}
export function auditReceipt(manifest,report,receipt) {
 if(!receipt||receipt.head!==manifest.head||receipt.inventoryHash!==manifest.inventoryHash||receipt.selectedHash!==digest(manifest.selected)||receipt.signal||receipt.error||![0,1].includes(receipt.exitCode))throw new Error('No matching normal process termination receipt');
 if(receipt.exitCode===1 && !(report.numFailedTests>0||report.numFailedTestSuites>0))throw new Error('Runner failed without test failure evidence');
 if(receipt.exitCode===0 && (report.numFailedTests>0||report.numFailedTestSuites>0))throw new Error('Successful exit contradicts test failures');
}
function audit(directory) {
 const manifest=load(join(directory,'manifest.json'));const report=load(join(directory,'results.json'));
 auditCases(manifest.selected,report,manifest.inventory);
 auditReceipt(manifest,report,load(join(directory,'run-receipt.json')));
 save(join(directory,'audit.json'),{head:manifest.head,group:manifest.group,index:manifest.index,inventoryHash:manifest.inventoryHash,selected:manifest.selected,passed:report.numPassedTests,failed:report.numFailedTests});
}
function aggregate(root,expectedHead,groups,total) {
 const manifests=[];
 function walk(dir){for(const entry of readdirSync(dir,{withFileTypes:true})){const path=join(dir,entry.name);if(entry.isDirectory())walk(path);else if(entry.name==='manifest.json'){const manifest=load(path);const audit=load(join(dir,'audit.json'));const report=load(join(dir,'results.json'));auditCases(manifest.selected,report,manifest.inventory);auditReceipt(manifest,report,load(join(dir,'run-receipt.json')));if(audit.head!==manifest.head||audit.index!==manifest.index||audit.inventoryHash!==manifest.inventoryHash)throw new Error('Audit metadata mismatch');manifests.push(manifest);}}}
 walk(root);
 if(manifests.length!==groups.length*total)throw new Error('Missing or extra shard manifests');
 for(const group of groups){const items=manifests.filter(m=>m.group===group).sort((a,b)=>a.index-b.index);if(items.length!==total)throw new Error(`Missing group: ${group}`);const first=items[0];const partitions=partitionCases(first.inventory,total);
  for(let i=0;i<total;i++){const m=items[i];if(m.index!==i+1||m.total!==total||m.head!==expectedHead||m.configHash!==first.configHash||m.inventoryHash!==digest(m.inventory)||m.inventoryHash!==first.inventoryHash||JSON.stringify(m.selected)!==JSON.stringify(partitions[i]))throw new Error(`Shard coverage mismatch: ${group}/${i+1}`);}
 }
 console.log(`Verified ${manifests.length} shards across ${groups.length} OS/Node groups; complete case coverage, original natural skips retained.`);
}
export async function main([command,...args]) {
 if(command==='docs'){const files=changedPaths(process.env.CI_BASE_SHA,process.env.CI_HEAD_SHA);const docs=isDocsOnly(files,process.env.GITHUB_EVENT_NAME);if(process.env.GITHUB_OUTPUT)writeFileSync(process.env.GITHUB_OUTPUT,`docs_only=${docs}\n`,{flag:'a'});console.log(JSON.stringify({docs_only:docs,changed_files:files}));}
 else if(command==='collect')await collect(...args);
 else if(command==='run')run(...args);
 else if(command==='audit')audit(...args);
 else if(command==='aggregate')aggregate(args[0],args[1],args[2].split(','),Number(args[3]));
 else throw new Error('Unknown CI plan command');
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main(process.argv.slice(2));
