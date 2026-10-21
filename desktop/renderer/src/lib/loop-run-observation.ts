import type {LoopRunView} from '../api/types';
export function loopNeedsRevalidation(run:LoopRunView|undefined):boolean {
 if(!run)return false;
 return run.businessState==='publication_pending'||run.status==='success'&&(run.completionObservation?.state!=='verified_at_read'||!Number.isSafeInteger(run.completionObservation.checkedAt)||run.completionObservation.checkedAt<0);
}
export function loopObservationLabel(run:LoopRunView,labels:{pending:string;verified(at:number):string;status(value:LoopRunView['status']):string}):string {
 if(loopNeedsRevalidation(run))return labels.pending;
 if(run.status==='success'&&run.completionObservation?.state==='verified_at_read')return labels.verified(run.completionObservation.checkedAt);
 return labels.status(run.status);
}
export function invalidateLoopObservations(value:Record<string,LoopRunView[]>):Record<string,LoopRunView[]> {
 return Object.fromEntries(Object.entries(value).map(([id,runs])=>[id,runs.map(run=>run.status==='success'?{...run,businessState:'publication_pending' as const,completionObservation:undefined}:run)]));
}
