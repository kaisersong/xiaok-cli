import {createHash} from 'node:crypto';
import type {NativeAttentionReference} from './native-attention-source.js';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Public data identities only; neither hash is a Native answer capability. */
export function nativeQuestionReference(anchorId:string,canonicalInputId:string):string{return 'native-question:'+hash([anchorId,canonicalInputId]);}
export function nativeQuestionExpectedDigest(reference:NativeAttentionReference,question:Readonly<{token:string;requestDigest:string;method:string;description:string;expiresAt:number}>):string{
 return hash(['native-activity-question-v1',reference.taskId,reference.taskSessionId,reference.executionThreadId,reference.nativeIncarnation,reference.nativeSessionId,reference.nativeThreadId,reference.nativeTurnId,reference.nativeGeneration,
  question.token,question.requestDigest,question.method,question.description,question.expiresAt,['approve','deny']]);
}
