import type {ReceiverClockEvidence} from './receiver-store.js';
export interface MaterialDeadline{readonly wallExpiresAt:number;readonly continuousExpiresAt:number;readonly clockDomainId:string;readonly clockQualificationEpoch:number;readonly preparedLowerBound:number}
function evidence(c:ReceiverClockEvidence){if(!c||typeof c.domainId!=='string'||!c.domainId||!Number.isSafeInteger(c.qualificationEpoch)||c.qualificationEpoch<1||!Number.isSafeInteger(c.lowerBound)||!Number.isSafeInteger(c.upperBound)||c.lowerBound<0||c.upperBound<c.lowerBound||!/^[a-f0-9]{64}$/.test(c.evidenceHash))throw Error('material_deadline_clock');}
/** Called exactly once at server prepare. Later native approval never renews it.
 * Clock evidence must come from the installed broker, not the caller DTO. */
export function freezeMaterialDeadline(input:{requestedWallExpiry:number;wallNow:number;clock:ReceiverClockEvidence;maximumLifetimeMs:number}):Readonly<MaterialDeadline>{
 const {requestedWallExpiry,wallNow,maximumLifetimeMs}=input,clock={...input.clock};evidence(clock);
 if(!Number.isSafeInteger(requestedWallExpiry)||!Number.isSafeInteger(wallNow)||wallNow<0||!Number.isSafeInteger(maximumLifetimeMs)||maximumLifetimeMs<1||maximumLifetimeMs>86400000||requestedWallExpiry<=wallNow)throw Error('material_deadline_expired');
 const ttl=Math.min(requestedWallExpiry-wallNow,maximumLifetimeMs),continuousExpiresAt=clock.lowerBound+ttl;
 if(!Number.isSafeInteger(continuousExpiresAt)||continuousExpiresAt<=clock.upperBound)throw Error('material_deadline_expired');
 return Object.freeze({wallExpiresAt:Math.min(requestedWallExpiry,wallNow+ttl),continuousExpiresAt,clockDomainId:clock.domainId,clockQualificationEpoch:clock.qualificationEpoch,preparedLowerBound:clock.lowerBound});
}
/** Wall time can only further deny; rolling it backwards cannot extend the
 * already frozen continuous deadline. Includes GUI/IPC time and sleep. */
export function assertMaterialDeadline(deadline:Readonly<MaterialDeadline>,input:{wallNow:number;clock:ReceiverClockEvidence}):void{
 const clock={...input.clock};evidence(clock);
 if(clock.domainId!==deadline.clockDomainId||clock.qualificationEpoch!==deadline.clockQualificationEpoch||clock.lowerBound<deadline.preparedLowerBound)throw Error('material_deadline_domain');
 if(!Number.isSafeInteger(input.wallNow)||input.wallNow<0||!Number.isSafeInteger(deadline.continuousExpiresAt)||!Number.isSafeInteger(deadline.wallExpiresAt)||input.wallNow>=deadline.wallExpiresAt||clock.upperBound>=deadline.continuousExpiresAt)throw Error('material_deadline_expired');
}
