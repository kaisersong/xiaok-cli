// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as os from 'node:os';
import { createPreloadApi } from '../../electron/preload-api.js';
function ipc() { return { invoke: vi.fn(async () => ({ transportOnly: true })), on: vi.fn(), off: vi.fn(), removeListener: vi.fn(), send: vi.fn() }; }
async function check(api: ReturnType<typeof createPreloadApi>, port: ReturnType<typeof ipc>) {
  const calls = [
    ['syncScheduledTasks',[[{id:'own',cronExpr:'* * * * *',enabled:true}]],'syncScheduledTasks'],['getScheduledTasks',[],'getScheduledTasks'],['createScheduledTask',[{name:'Own',prompt:'Own body',trigger:{kind:'once',at:5000},source:'user'}],'createScheduledTask'],['createLoopSchedule',[{loopId:'own-loop',title:'Own',trigger:{kind:'daily',hour:9,minute:0}}],'loops:createSchedule'],['getLoopScheduleBindings',[],'loops:getScheduleBindings'],['updateScheduledTask',[{id:'own',name:'Own changed loop',trigger:{kind:'weekly',dayOfWeek:1,hour:9,minute:0}}],'updateScheduledTask'],['setScheduledTaskStatus',['own','paused'],'setScheduledTaskStatus'],['cancelScheduledTask',['own'],'cancelScheduledTask'],['getTimedActions',[],'getTimedActions'],['getTimedActionRuns',['own'],'getTimedActionRuns'],['clearScheduledTaskRunHistory',['own',undefined],'scheduledTasks:clearRunHistory'],['approveTimedActionAuto',['own'],'timedAction:approveAuto'],['revokeTimedActionAuto',['own'],'timedAction:revokeAuto'],['createReminder',[{content:'Own notification',scheduleAt:5000,timezone:'UTC'}],'createReminder'],['listReminders',[],'listReminders'],['cancelReminder',['own'],'cancelReminder'],['getReminderStatus',[],'getReminderStatus'],
  ] as const;
  for (const [method, args, channel] of calls) {
    port.invoke.mockClear();
    await (api[method] as unknown as (...args: unknown[]) => Promise<unknown>)(...args);
    expect(port.invoke).toHaveBeenCalledExactlyOnceWith('desktop:' + channel, ...args);
    expect(port.invoke.mock.calls[0]).toHaveLength(args.length + 1);
  }

}
it('preserves all seventeen actual TS timed tuples including optional loop prompt and history selector slot', async () => {
  const port = ipc(); await check(createPreloadApi(port as never), port);
});
it('preserves all seventeen actual CJS timed tuples with no actor transport additions', async () => {
  const port = ipc(); let api!: ReturnType<typeof createPreloadApi>;
  runInNewContext(readFileSync(new URL('../../electron/preload.cjs', import.meta.url), 'utf8'), {
    require(name: string) {
      if (name === 'electron') return { ipcRenderer: port, contextBridge: { exposeInMainWorld(_key: string, value: ReturnType<typeof createPreloadApi>) { api = value; } } };
      if (name === 'os') return os; throw Error('unexpected preload dependency ' + name);
    },
  }); await check(api, port);
});
