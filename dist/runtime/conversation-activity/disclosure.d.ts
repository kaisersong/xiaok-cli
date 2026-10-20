import type { ConversationActivity, WorkProjection } from './types.js';
export declare function unavailableProjection(value: WorkProjection): WorkProjection;
/** Diagnostic strings are not authorization or evidence of redaction. */
export declare function isUnavailableProjection(value: WorkProjection): boolean;
export declare function unavailableActivity(value: ConversationActivity): ConversationActivity;
export declare function isUnavailableActivity(value: ConversationActivity): boolean;
