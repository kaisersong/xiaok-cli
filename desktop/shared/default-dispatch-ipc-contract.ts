import {z} from 'zod';
export const DEFAULT_DISPATCH_CAPTURE_CHANNEL='desktop:kswarm:default-dispatch:capture';
const projectId=z.string().min(1).max(256).refine(value=>value.trim()===value&&!value.includes('\0'));
export const DEFAULT_DISPATCH_INPUT=z.tuple([z.object({projectId}).strict()]);
const digest=z.string().regex(/^[a-f0-9]{64}$/);
/** Schema 5 receipts are storage intent, never evidence of model execution. */
const captureSuccess=z.object({ok:z.literal(true),operation:z.object({
  parentId:z.string().regex(/^default-dispatch-parent:[a-f0-9]{64}$/),projectId:z.string().min(1).max(256),planRevision:z.number().int().min(1),dispatchGeneration:z.number().int().min(1),
  children:z.array(z.object({childKey:z.string().regex(/^default-dispatch-child:[a-f0-9]{64}$/),taskId:z.string().min(1),payloadHash:digest,state:z.literal('intent_pending')}).strict()),
 }).strict()}).strict();
const captureFailure=z.object({ok:z.literal(false),error:z.string().min(1).max(2048),notInvoked:z.literal(true).optional()}).strict();
/** Exact original B capture shape. B cannot assert a Main Host observation. */
export const DEFAULT_DISPATCH_CAPTURE_OUTPUT=z.union([captureSuccess,captureFailure]);
const preparationObservation=z.object({childKey:z.string().regex(/^default-dispatch-child:[a-f0-9]{64}$/),taskId:z.string().min(1).max(256),status:z.enum(['present','missing','unavailable'])}).strict();
const observedCapture=captureSuccess.extend({preparationObservations:z.array(preparationObservation).optional(),preparationObservationUnavailable:z.literal(true).optional()}).superRefine((value,context)=>{
 if(value.preparationObservations!==undefined){
  if(value.preparationObservationUnavailable||value.preparationObservations.length!==value.operation.children.length){context.addIssue({code:z.ZodIssueCode.custom,message:'DEFAULT_DISPATCH_OBSERVATION_PROJECTION_INVALID'});return;}
  for(let i=0;i<value.preparationObservations.length;i++){const observed=value.preparationObservations[i]!,child=value.operation.children[i]!;if(observed.childKey!==child.childKey||observed.taskId!==child.taskId)context.addIssue({code:z.ZodIssueCode.custom,message:'DEFAULT_DISPATCH_OBSERVATION_PROJECTION_INVALID'});}
 }
});
/** Main read projection only. It does not advance B or authorize execution. */
export const DEFAULT_DISPATCH_OUTPUT=z.union([observedCapture,captureFailure]);
export type DefaultDispatchPreparationObservationView=z.infer<typeof preparationObservation>;
export type DefaultDispatchInput=z.infer<typeof DEFAULT_DISPATCH_INPUT>[0];
export type DefaultDispatchResult=z.infer<typeof DEFAULT_DISPATCH_OUTPUT>;
