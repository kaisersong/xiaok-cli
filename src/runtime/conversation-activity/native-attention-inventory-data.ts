import {z} from 'zod/v3';
import {nativeAttentionReferenceSchema} from './native-attention-source.js';
const key=z.string().min(1).max(256),digest=z.string().regex(/^[a-f0-9]{64}$/);
export const nativeInventorySnapshotSchema=z.object({enrollmentIncarnation:z.string().uuid(),bindingDigest:digest,reference:nativeAttentionReferenceSchema,
 coverage:z.literal('native_approvals_exclusive_execution_v1'),inventoryRevision:z.number().int().nonnegative().safe(),inventoryDigest:digest,
 questions:z.array(z.object({inputId:z.string().uuid(),expectedDigest:digest,requestDigest:digest}).strict()).max(32)}).strict();
export const nativeAttentionInventorySchema=nativeInventorySnapshotSchema.extend({sourceKind:z.literal('codex_native_approval'),watchId:key,readerIncarnation:z.string().uuid(),
 taskStatus:z.enum(['working','input_required']),businessOutcome:z.literal('unknown')}).strict().superRefine((value,context)=>{
 if((value.taskStatus==='input_required')!==(value.questions.length>0)||new Set(value.questions.map(q=>q.inputId)).size!==value.questions.length||value.readerIncarnation!==value.reference.nativeIncarnation)context.addIssue({code:z.ZodIssueCode.custom,message:'attention_native_inventory_incomplete'});
});
export type NativeAttentionInventory=z.infer<typeof nativeAttentionInventorySchema>;
export type NativeInventorySnapshot=z.infer<typeof nativeInventorySnapshotSchema>;
/** Internal original-receipt result. Deliberately absent from public schemas. */
export interface NativeTerminalAttentionInventory {
 sourceKind:'codex_native_terminal';watchId:string;readerIncarnation:string;reference:z.infer<typeof nativeAttentionReferenceSchema>;
 enrollmentIncarnation:string;bindingDigest:string;taskStatus:'completed'|'failed'|'cancelled';businessOutcome:'success'|'error'|'cancelled';questions:[];
 terminalReceipt:{factId:string;revision:number;eventKey:string};
}
export function nativeInventorySnapshot(inventory:NativeAttentionInventory):NativeInventorySnapshot {
 return nativeInventorySnapshotSchema.parse({enrollmentIncarnation:inventory.enrollmentIncarnation,bindingDigest:inventory.bindingDigest,reference:inventory.reference,coverage:inventory.coverage,
  inventoryRevision:inventory.inventoryRevision,inventoryDigest:inventory.inventoryDigest,questions:[...inventory.questions].sort((a,b)=>a.inputId<b.inputId?-1:a.inputId>b.inputId?1:0)});
}
