import {createHash} from 'node:crypto';
import {toDurableSessionSnapshot,type PersistedSessionSnapshot} from '../../ai/runtime/session-store/store.js';
import {assertCapturedMessageSchema} from '../../ai/runtime/provider-private-data.js';
import {canonicalVerificationJson as json} from '../verification/protocol.js';
import type {Message} from '../../types.js';
import type {StoredSessionSnapshot} from '../../ai/runtime/session-store/stored-snapshot-types.js';
export interface IntentStageContext {stageId:string;messageCount:number;messagesHash:string}
/** Original durable message conversion; a digest is a fact, never a grant. */
export function intentStageMessages(snapshot:StoredSessionSnapshot):Message[]{
 assertCapturedMessageSchema(snapshot.messages);return JSON.parse(JSON.stringify(toDurableSessionSnapshot(snapshot).messages)) as Message[];
}
export function intentStageMessagesHash(messages:readonly Message[]):string{
 assertCapturedMessageSchema(messages);return createHash('sha256').update('xiaok-intent-stage-context-v1\0').update(json(messages)).digest('hex');
}
export function captureIntentStageContext(snapshot:PersistedSessionSnapshot,stageId:string):IntentStageContext;
export function captureIntentStageContext(snapshot:StoredSessionSnapshot,stageId:unknown):IntentStageContext;
export function captureIntentStageContext(snapshot:StoredSessionSnapshot,stageId:unknown):IntentStageContext{
 const messages=intentStageMessages(snapshot);
 if(typeof stageId!=='string')throw Error('intent_stage_context_identity');
 return {stageId,messageCount:messages.length,messagesHash:intentStageMessagesHash(messages)};
}
export function assertIntentStagePrefix(snapshot:StoredSessionSnapshot,context:IntentStageContext):Message[]{
 const messages=intentStageMessages(snapshot);if(messages.length<context.messageCount||intentStageMessagesHash(messages.slice(0,context.messageCount))!==context.messagesHash)throw Error('intent_stage_context_prefix');return messages;
}
