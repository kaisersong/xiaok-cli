import {captureLoopProducerValue} from '../../src/runtime/loop/producer-value.js';
export {captureLoopProducerValue} from '../../src/runtime/loop/producer-value.js';
import {parseLoopCandidateBody,type LoopCandidateBody,type LoopArtifactDescriptor} from '../../src/runtime/verification/loop-application-binding.js';
import {parseLoopHostSubject,type LoopHostSubject} from '../../src/runtime/verification/loop-host-subject.js';
import type {LoopBusinessContract} from '../../src/runtime/verification/loop-application-contract.js';
import type {ArtifactEvidenceRegressionScanResult,EvidenceAnomaly} from './artifact-evidence-regression-loop.js';
import type {KSwarmServiceHealthScanResult,KSwarmHealthAnomaly} from './kswarm-health-loop.js';
function anomaly(a:EvidenceAnomaly|KSwarmHealthAnomaly){
 return {id:a.id,ownerKind:a.ownerKind,ownerId:a.ownerId,kind:a.kind,status:a.status,firstSeenAt:a.firstSeenAt,lastSeenAt:a.lastSeenAt,lastResolvedAt:a.lastResolvedAt??null,seenCount:a.seenCount,ignoredUntil:a.ignoredUntil??null,message:a.message,evidenceIds:a.evidenceIds};
}
/** Pure projection of the fixed scanners' actual typed output. Caller provenance
 * and original configuration remain the Main producer/store's responsibility. */
export function buildLoopScanPublicationBody(rawSubject:Readonly<LoopHostSubject>,raw:ArtifactEvidenceRegressionScanResult|KSwarmServiceHealthScanResult,observedAt:number,artifacts:readonly LoopArtifactDescriptor[],contract:Readonly<LoopBusinessContract>):Readonly<Extract<LoopCandidateBody,{kind:'builtin-diagnostic'}>> {
 const subject=parseLoopHostSubject(rawSubject),result=captureLoopProducerValue(raw);
 if(result.loopId!==subject.loopId||result.loopRunId!==subject.runId||subject.stage!==null&&subject.stage.stageKind!=='scan')throw Error('loop_scan_publication_source');
 const common={kind:result.loopId,openAnomalyCount:result.openAnomalyCount,resolvedAnomalyCount:result.resolvedAnomalyCount,anomalies:result.anomalies.map(anomaly)};
 const diagnostic=result.loopId==='artifact-evidence-regression'?{...common,scannedOwnerCount:result.scannedOwnerCount}:{...common,diagnosticKinds:result.summaryEvidence.metadata.diagnosticKinds,findings:result.summaryEvidence.metadata.findings,suggestedActions:result.summaryEvidence.metadata.suggestedActions,logPaths:result.summaryEvidence.metadata.logPaths};
 const body=parseLoopCandidateBody({kind:'builtin-diagnostic',scanner:result.loopId,observedAt,summary:result.summaryEvidence.summary,nextActionKind:result.nextActionKind,nextActionSummary:result.nextActionSummary??null,diagnostic,artifacts},subject,contract);
 if(body.kind!=='builtin-diagnostic')throw Error('loop_scan_publication_body');return body;
}
