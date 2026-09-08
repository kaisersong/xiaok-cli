export type NativeStatus = 'disconnected' | 'connecting' | 'idle' | 'running' | 'error';
export interface NativeMessage { id: string; role: 'user' | 'assistant' | 'system'; text: string; state?: 'queued' | 'sent' | 'cancelled' | 'unknown' }
export interface NativeApproval { token: string; method: string; description: string; expiresAt: number }
export interface NativeSummary { id: string; title: string; cwd: string; status: NativeStatus; updatedAt: number; error?: string }
export interface NativeSnapshot extends NativeSummary { revision: number; messages: NativeMessage[]; approvals: NativeApproval[]; queued: number }
