import {it,expect} from 'vitest';import {mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {ArtifactEvidenceRegressionScanner} from '../../electron/artifact-evidence-regression-loop.js';
import {KSwarmServiceHealthScanner} from '../../electron/kswarm-health-loop.js';
import {CompletionEvidenceStore} from '../../electron/completion-evidence-store.js';
const contract=(scanner:'artifact-evidence-regression'|'kswarm-service-health')=>({version:1 as const,kind:'builtin-diagnostic' as const,scanner,objective:'Publish original full diagnostic',completionCriterion:'Verify original report'});
import {buildLoopScanPublicationBody} from '../../electron/loop-scan-publication-body.js';
it('captures original typed artifact scanner output including complete anomalies without inventing counters',()=>{
 const root=mkdtempSync(join(tmpdir(),'scan-body-')),file=join(root,'e.sqlite'),evidence=new CompletionEvidenceStore(file),scanner=new ArtifactEvidenceRegressionScanner(file);try{
  const result=scanner.scan({loopRunId:'actual-run',now:1000});
  const body=buildLoopScanPublicationBody({kind:'loop-run',loopId:result.loopId,runId:'actual-run',stage:{stageId:'scan',stageKind:'scan'}},result,1000,[],contract(result.loopId));
  expect(body).toMatchObject({kind:'builtin-diagnostic',summary:result.summaryEvidence.summary,observedAt:1000,diagnostic:{scannedOwnerCount:result.scannedOwnerCount,openAnomalyCount:result.openAnomalyCount,resolvedAnomalyCount:result.resolvedAnomalyCount}});
  expect(()=>buildLoopScanPublicationBody({kind:'loop-run',loopId:result.loopId,runId:'foreign',stage:null},result,1000,[],contract(result.loopId))).toThrow(/source/);
 }finally{scanner.close();evidence.close();rmSync(root,{recursive:true,force:true});}
});
it('preserves actual health findings, diagnostic kinds, log paths and action rather than passing only a summary',async()=>{
 const root=mkdtempSync(join(tmpdir(),'health-body-')),scanner=new KSwarmServiceHealthScanner(join(root,'e.sqlite'),{probe:()=>({expectedEntryPath:null,spawnEntryExists:true,port:{listening:false},health:{ok:false,error:'offline'},broker:{ok:false}}),logPaths:['original/log']});try{
  const result=await scanner.scan({loopRunId:'actual-run',now:1000});
  const body=buildLoopScanPublicationBody({kind:'loop-run',loopId:result.loopId,runId:'actual-run',stage:null},result,1000,[],contract(result.loopId));
  expect(body.diagnostic).toMatchObject({kind:'kswarm-service-health',findings:result.summaryEvidence.metadata.findings,diagnosticKinds:result.summaryEvidence.metadata.diagnosticKinds,logPaths:['original/log'],suggestedActions:result.summaryEvidence.metadata.suggestedActions});
  expect(body.diagnostic.anomalies).toHaveLength(result.anomalies.length);expect(body.nextActionKind).toBe(result.nextActionKind);
  const changed=structuredClone(result);changed.summaryEvidence.summary='different';expect(body.summary).toBe(result.summaryEvidence.summary);
 }finally{scanner.close();rmSync(root,{recursive:true,force:true});}
});
