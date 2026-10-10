import type { ConversationActivity } from './types.js';
/** Content never contains source text, paths, prompts or credentials. The
 * service commits the attempt before this adapter is called. */
export declare function showActivityOwnerNotification(activity: ConversationActivity): Promise<'shown' | 'suppressed' | 'failed'>;
