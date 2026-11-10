import {z} from 'zod';
import {createHash} from 'node:crypto';import type {DatabaseSync} from 'node:sqlite';
import {assistantDigestEnvelopeSchema,type AssistantDigestEnvelope,type AssistantNotificationSuppression} from './notification-policy.js';
export const assistantDigestReceiptSchema=z.object({deliveryId:z.string().uuid(),status:z.enum(['unknown','shown','suppressed','failed']),suppressionReason:z.enum(['quiet_hours','platform_unavailable','disabled','budget_exhausted','stale_policy']).optional()}).strict();
export type AssistantDigestReceipt=z.infer<typeof assistantDigestReceiptSchema>;
export function migrateAssistantDigestReceipts(db:DatabaseSync){db.exec('CREATE TABLE IF NOT EXISTS assistant_digest_receipts(delivery_id TEXT PRIMARY KEY,envelope_hash TEXT NOT NULL,receipt_json TEXT NOT NULL)');}
export function getAssistantDigestReceipt(db:DatabaseSync,deliveryId:string):AssistantDigestReceipt|undefined{const row=db.prepare('SELECT receipt_json FROM assistant_digest_receipts WHERE delivery_id=?').get(deliveryId);return row?assistantDigestReceiptSchema.parse(JSON.parse(String(row.receipt_json))):undefined;}
export function claimAssistantDigest(db:DatabaseSync,input:AssistantDigestEnvelope):{claimed:boolean;receipt:AssistantDigestReceipt}{
 const envelope=assistantDigestEnvelopeSchema.parse(input),hash=createHash('sha256').update(JSON.stringify(envelope)).digest('hex');
 const old=db.prepare('SELECT envelope_hash,receipt_json FROM assistant_digest_receipts WHERE delivery_id=?').get(envelope.deliveryId);
 if(old){if(old.envelope_hash!==hash)throw Error('assistant_digest_receipt_conflict');return {claimed:false,receipt:assistantDigestReceiptSchema.parse(JSON.parse(String(old.receipt_json)))};}
 const receipt:AssistantDigestReceipt={deliveryId:envelope.deliveryId,status:'unknown'};
 db.prepare('INSERT INTO assistant_digest_receipts(delivery_id,envelope_hash,receipt_json) VALUES(?,?,?)').run(envelope.deliveryId,hash,JSON.stringify(receipt));return {claimed:true,receipt};
}
export function finishAssistantDigest(db:DatabaseSync,receipt:AssistantDigestReceipt):AssistantDigestReceipt{
 const old=getAssistantDigestReceipt(db,receipt.deliveryId);if(!old)throw Error('assistant_digest_receipt_missing');
 if(!['shown','suppressed','failed'].includes(receipt.status)||receipt.status==='suppressed'&&!['quiet_hours','platform_unavailable','disabled','budget_exhausted','stale_policy'].includes(receipt.suppressionReason??''))throw Error('assistant_digest_receipt_invalid');
 if(old.status!=='unknown'){if(JSON.stringify(old)!==JSON.stringify(receipt))throw Error('assistant_digest_receipt_conflict');return old;}
 db.prepare('UPDATE assistant_digest_receipts SET receipt_json=? WHERE delivery_id=?').run(JSON.stringify(receipt),receipt.deliveryId);return receipt;
}
