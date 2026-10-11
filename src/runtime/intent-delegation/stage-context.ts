import {createHash} from 'node:crypto';
import {toDurableSessionSnapshot,type PersistedSessionSnapshot} from '../../ai/runtime/session-store/store.js';
import {assertCapturedMessageSchema} from '../../ai/runtime/provider-private-data.js';
import {canonicalVerificationJson as json} from '../verification/protocol.js';
import type {Message} from '../../types.js';
export interface IntentStageContext {stageId:string;messageCount:number;messagesHash:string}
/** Original durable message conversion; a digest is a fact, never a grant. */
export function intentStageMessages(snapshot:PersistedSessionSnapshot):Message[]{
 assertCapturedMessageSchema(snapshot.messages);return JSON.parse(JSON.stringify(toDurableSessionSnapshot(snapshot).messages)) as Message[];
}
export function intentStageMessagesHash(messages:readonly Message[]):string{
 assertCapturedMessageSchema(messages);return createHash('sha256').update('xiaok-intent-stage-context-v1\0').update(json(messages)).digest('hex');
}
export function captureIntentStageContext(snapshot:PersistedSessionSnapshot,stageId:string):IntentStageContext{
 const messages=intentStageMessages(snapshot);return {stageId,messageCount:messages.length,messagesHash:intentStageMessagesHash(messages)};
}
export function assertIntentStagePrefix(snapshot:PersistedSessionSnapshot,context:IntentStageContext):Message[]{
 const messages=intentStageMessages(snapshot);if(messages.length<context.messageCount||intentStageMessagesHash(messages.slice(0,context.messageCount))!==context.messagesHash)throw Error('intent_stage_context_prefix');return messages;
}
