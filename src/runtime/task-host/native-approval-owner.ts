import {z} from 'zod/v3';
const fields=['schemaVersion','kind','taskSessionId','nativeIncarnation','nativeSessionId','nativeThreadId','nativeTurnId','nativeTurnGeneration','approvalToken','requestDigest'] as const;
const key=z.string().min(1).max(256);
export interface NativeApprovalOwnerMetadata {
 readonly schemaVersion:1;readonly kind:'codex_native_approval';readonly taskSessionId:string;readonly nativeIncarnation:string;
 readonly nativeSessionId:string;readonly nativeThreadId:string;readonly nativeTurnId:string;readonly nativeTurnGeneration:number;readonly approvalToken:string;readonly requestDigest:string;
}
/** Historical source metadata. Parsing never issues a Native frame or grant. */
export const nativeApprovalOwnerSchema=z.preprocess(value=>{
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))||Object.getOwnPropertySymbols(value).length)return z.NEVER;
 const descriptors=Object.getOwnPropertyDescriptors(value);
 if(Object.keys(descriptors).length!==fields.length||fields.some(field=>!descriptors[field]||!('value'in descriptors[field])||!descriptors[field].enumerable))return z.NEVER;
 return Object.fromEntries(fields.map(field=>[field,descriptors[field].value]));
},z.object({schemaVersion:z.literal(1),kind:z.literal('codex_native_approval'),taskSessionId:key,nativeIncarnation:z.string().uuid(),nativeSessionId:key,
 nativeThreadId:key,nativeTurnId:key,nativeTurnGeneration:z.number().int().positive().safe(),approvalToken:key,requestDigest:z.string().regex(/^[a-f0-9]{64}$/)}).strict());
export function parseNativeApprovalOwner(value:unknown):NativeApprovalOwnerMetadata {
 const parsed=nativeApprovalOwnerSchema.safeParse(value);if(!parsed.success)throw Error('native_approval_owner_invalid');return Object.freeze(parsed.data);
}
