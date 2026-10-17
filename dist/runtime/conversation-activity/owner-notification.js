import { execFile } from 'node:child_process';
/** Content never contains source text, paths, prompts or credentials. The
 * service commits the attempt before this adapter is called. */
export async function showActivityOwnerNotification(activity) {
    const terminal = ['completed', 'failed', 'cancelled'].includes(activity.projection.executionState);
    const failed = activity.projection.executionState === 'failed' || activity.projection.businessOutcome === 'error';
    const title = terminal ? failed ? 'xiaok 工作执行失败' : 'xiaok 工作状态已更新' : 'xiaok 工作需要你处理';
    const body = '会话中有新的工作进展，请打开原会话查看。';
    let command, args;
    if (process.platform === 'darwin') {
        command = '/usr/bin/osascript';
        args = ['-e', `display notification "${body}" with title "${title}"`];
    }
    else if (process.platform === 'linux') {
        command = 'notify-send';
        args = ['--app-name=xiaok', title, body];
    }
    else
        return 'suppressed';
    return new Promise(resolve => execFile(command, args, { timeout: 5000 }, error => resolve(error ? 'failed' : 'shown')));
}
