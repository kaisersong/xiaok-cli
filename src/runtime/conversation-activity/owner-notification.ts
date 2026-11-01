import { execFile } from 'node:child_process';
import type { ConversationActivity } from './types.js';

/** Content never contains source text, paths, prompts or credentials. The
 * service commits the attempt before this adapter is called. */
export async function showActivityOwnerNotification(activity: ConversationActivity): Promise<'shown' | 'suppressed' | 'failed'> {
  const terminal = ['completed','failed','cancelled'].includes(activity.projection.executionState);
  const failed = activity.projection.executionState === 'failed' || activity.projection.businessOutcome === 'error';
  const title = terminal ? failed ? 'xiaok 工作执行失败' : 'xiaok 工作状态已更新' : 'xiaok 工作需要你处理';
  const body = '会话中有新的工作进展，请打开原会话查看。';
  return showOwnerNotification(title,body);
}
/** Same notification owner/adapter; no source text is ever accepted. */
export function showAssistantDigestOwnerNotification():Promise<'shown'|'suppressed'|'failed'>{
  return showOwnerNotification('xiaok 有新的待办建议','请打开小K查看新的助理建议。');
}
async function showOwnerNotification(title:string,body:string):Promise<'shown'|'suppressed'|'failed'>{
  let command: string, args: string[];
  if (process.platform === 'darwin') {
    command = '/usr/bin/osascript'; args = ['-e', `display notification "${body}" with title "${title}"`];
  } else if (process.platform === 'linux') {
    command = 'notify-send'; args = ['--app-name=xiaok', title, body];
  } else return 'suppressed';
  return new Promise(resolve => execFile(command, args, { timeout: 5000 }, error => resolve(error ? 'failed' : 'shown')));
}
