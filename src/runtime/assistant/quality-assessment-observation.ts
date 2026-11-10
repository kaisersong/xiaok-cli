import {applyHumanQualityReview,hasFrozenRiskCoverage,qualityDigest,type QualityRecord,type QualityAssessmentIdentity,type QualityModelReader} from './quality-authorization.js';
import {evaluateAssistantQuality} from './quality-qualification.js';
import {parseCapturedSourceJson} from '../verification/captured-source-json.js';
/** Pure business observation shared by Main's original lease reader and the
 * fixed read-only notification reader. It cannot issue qualification tokens. */
export function assessCurrentAssistantQuality(input:{context:QualityRecord['context'];generation:number;record:QualityRecord|undefined;model:ReturnType<QualityModelReader>;finalModel:ReturnType<QualityModelReader>;expected?:QualityAssessmentIdentity}){
 const {context,generation,record,model,finalModel,expected}=input;
 if(model.modelEpoch!==context.modelEpoch||model.configFingerprint!==context.configFingerprint)return undefined;
 if(!record||record.phase!=='assessed'||record.generation!==generation||JSON.stringify(context)!==JSON.stringify(record.context)||!record.review||!record.attestation)return undefined;
 if(expected&&(expected.assessmentId!==record.assessmentId||expected.generation!==generation||expected.digest!==record.digest))return undefined;
 const reviewed=applyHumanQualityReview(record,parseCapturedSourceJson(record.review)),report=evaluateAssistantQuality(reviewed);
 if(!hasFrozenRiskCoverage(record)||!report.passed||record.reportDigest!==qualityDigest({input:reviewed,report}))return undefined;
 if(finalModel.modelEpoch!==model.modelEpoch||finalModel.configFingerprint!==model.configFingerprint)return undefined;
 return {assessmentId:record.assessmentId,generation,digest:record.digest,reportDigest:record.reportDigest,currentBinding:context.binding,input:reviewed,report};
}
