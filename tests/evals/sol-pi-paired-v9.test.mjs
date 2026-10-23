import test from 'node:test';
import assert from 'node:assert/strict';
import {createPairedPlan,verifyPairedManifest} from '../../scripts/evals/sol-pi/paired-core.mjs';
import {tasks,plan} from '../../scripts/evals/sol-pi/baseline-core.mjs';
test('v9 keeps the original 42 cases and admits 24 ordinary owner candidates, never children',()=>{
 const schedule=createPairedPlan();assert.equal(schedule.length,84);
 assert.deepEqual(schedule.filter(e=>e.arm==='legacy').map(({caseKey})=>caseKey),plan.map(e=>e.key));
 const candidate=schedule.filter(e=>e.arm==='candidate');assert.equal(candidate.filter(e=>e.mechanismAvailability==='eligible').length,24);assert.equal(candidate.filter(e=>e.mechanismAvailability==='not-ready').length,18);
 assert.ok(candidate.filter(e=>e.surface.endsWith('child')).every(e=>e.mechanismAvailability==='not-ready'));assert.equal(tasks.length,4);
});
test('v9 exposes the shared production Desktop task-host adapter',async()=>{
 const {runPairedDesktopTask}=await import('../../scripts/evals/sol-pi/paired-desktop.mjs');assert.equal(typeof runPairedDesktopTask,'function');
});
test('v9 actual report describes 24 eligible and preserves pending comparison with partial wire evidence',async()=>{
 const fs=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
 const {report}=await import('../../scripts/evals/sol-pi/paired-run.mjs');
 const root=await fs.mkdtemp(join(tmpdir(),'paired-v9-report-'));
 try{await report(root,{missing:['actual-cost']},[],'verified');const text=await fs.readFile(join(root,'summary.md'),'utf8');assert.match(text,/v9/);assert.match(text,/24项/);assert.match(text,/18项/);assert.match(text,/Desktop.*wire attempts/);assert.doesNotMatch(text,/其余30项|v8|未观测 wire attempts/);assert.equal(JSON.parse(await fs.readFile(join(root,'summary.json'),'utf8')).comparisonValid,null);}finally{await fs.rm(root,{recursive:true,force:true});}
});
