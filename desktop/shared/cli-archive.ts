export interface CliArchiveList {items:Array<{sessionId:string;available:boolean;updatedAt:number|null}>;nextAfter?:string}
export interface CliArchivePreview {previewId:string;sessionId:string;manifestHash:string;messageCount:number;sample:string;coverage:'partial'}
export interface CliArchiveClaim {conversationId:string;messageCount:number}
