export interface ConversationInputAcceptance {accepted:true;inputId:string;conversationId:string;sequence:number;taskId:string;sourceEpoch:string}
export interface ConversationQueuedInput {inputId:string;prompt:string;unavailable?:boolean;status:'pending'|'claimed'|'unknown';sequence:number;revision:number;materialCount:number;prepared:boolean}
export interface ConversationQueueView {conversationId:string;items:ConversationQueuedInput[];failedInput?:{inputId:string;prompt:string;sequence:number;unavailable?:boolean}|null;pauseReason:'unknown_execution'|'execution_authorization_changed'|'input_unavailable'|null;currentTaskId:string|null}
export interface EnqueueConversationInput {inputId:string;conversationId:string;prompt:string;filePaths?:string[]}
