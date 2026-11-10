import {captureDispatchBusinessData} from '../conversation-activity/dispatch-business-data.js';
import {instantMs} from '../admission/parse.js';
import {dshAFields,dshAText,dshARevision,type DshARecord} from './dsh-admission-data.js';
const array=Array.isArray,freeze=Object.freeze;
/** A published user policy is configuration, never a body-dispatch permit. */
export function parseDshEgressPolicy(raw:unknown):DshARecord{
 const policy=captureDispatchBusinessData(raw) as DshARecord;
 dshAFields(policy,['policyRef','epoch','provider','modelIds','destinationRef','bodyClasses','purposes','enabled','validUntil']);
 dshAText(policy.policyRef);dshAText(policy.provider);dshAText(policy.destinationRef);dshARevision(policy.epoch);
 if(typeof policy.enabled!=='boolean'||!array(policy.modelIds)||!policy.modelIds.length||policy.modelIds.length>16||!array(policy.bodyClasses)||policy.bodyClasses.length!==1||policy.bodyClasses[0]!=='source_title_body_v1'||!array(policy.purposes)||!policy.purposes.length||policy.purposes.length>3)throw Error('DSH_A_EGRESS_POLICY_INVALID');
 for(let i=0;i<policy.modelIds.length;i++){dshAText(policy.modelIds[i]);for(let j=0;j<i;j++)if(policy.modelIds[j]===policy.modelIds[i])throw Error('DSH_A_EGRESS_POLICY_INVALID');}
 for(let i=0;i<policy.purposes.length;i++){const purpose=policy.purposes[i];if(purpose!=='admission'&&purpose!=='preview'&&purpose!=='draft')throw Error('DSH_A_EGRESS_POLICY_INVALID');for(let j=0;j<i;j++)if(policy.purposes[j]===purpose)throw Error('DSH_A_EGRESS_POLICY_INVALID');}
 instantMs(policy.validUntil as string);freeze(policy.modelIds);freeze(policy.bodyClasses);freeze(policy.purposes);return freeze(policy);
}
