import { registerComputerUseCapabilityReadonlyIpc, registerKswarmStatusReadonlyIpc } from '../../electron/runtime-status-readonly-typed-ipc.js';
import { registerSkillMutationIpc } from '../../electron/skill-mutation-typed-ipc.js';
import { registerChannelMcpMutationIpc } from '../../electron/channel-mcp-mutation-typed-ipc.js';
import { registerMeetingMutationIpc } from '../../electron/meeting-mutation-typed-ipc.js';
import { registerMeetingReadonlyIpc } from '../../electron/meeting-readonly-typed-ipc.js';
import { registerChannelMcpReadonlyIpc } from '../../electron/channel-mcp-readonly-typed-ipc.js';
import { registerSkillListIpc } from '../../electron/skill-list-typed-ipc.js';
import { registerAutomationConfigIpc } from '../../electron/automation-config-typed-ipc.js';
import { registerMobileSignInIpc } from '../../electron/mobile-signin-typed-ipc.js';
import { registerServiceControlIpc } from '../../electron/service-control-typed-ipc.js';
import { registerMobileReadonlyIpc } from '../../electron/mobile-readonly-typed-ipc.js';
import { registerScheduledTimedActionIpc } from '../../electron/scheduled-timed-action-typed-ipc.js';
import { registerPluginCatalogIpc } from '../../electron/plugin-catalog-typed-ipc.js';
import {registerLoopOutputIpc} from '../../electron/loop-output-service.js';
import {registerLoopCurrentViewIpc} from '../../electron/loop-current-views.js';
import {registerLoopManagementIpc} from '../../electron/loop-management-typed-ipc.js';
import {registerThreadMetadataIpc} from '../../electron/thread-metadata-typed-ipc.js';
import {registerDesktopSmallConfigIpc} from '../../electron/desktop-small-config-typed-ipc.js';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const mainSource = readFileSync(join(import.meta.dirname, '..', '..', 'electron', 'main.ts'), 'utf8');
const ipcSource = readFileSync(join(import.meta.dirname, '..', '..', 'electron', 'ipc.ts'), 'utf8');
const currentViewChannels:string[]=[];
registerMobileSignInIpc({handle:channel=>{currentViewChannels.push(channel);}});
registerAutomationConfigIpc({handle:channel=>{currentViewChannels.push(channel);}});
registerSkillListIpc({handle:channel=>{currentViewChannels.push(channel);}});
registerChannelMcpReadonlyIpc({handle:channel=>{currentViewChannels.push(channel);}});
registerMeetingReadonlyIpc({handle:channel=>{currentViewChannels.push(channel);}});
registerComputerUseCapabilityReadonlyIpc({handle:channel=>{currentViewChannels.push(channel);}});registerKswarmStatusReadonlyIpc({handle:channel=>{currentViewChannels.push(channel);}});registerSkillMutationIpc({handle:channel=>{currentViewChannels.push(channel);}});registerChannelMcpMutationIpc({handle:channel=>{currentViewChannels.push(channel);}});registerMeetingMutationIpc({handle:channel=>{currentViewChannels.push(channel);}}, new Map());
registerServiceControlIpc({handle:channel=>{currentViewChannels.push(channel);}});
registerMobileReadonlyIpc({handle:channel=>{currentViewChannels.push(channel);}});
registerPluginCatalogIpc({handle:channel=>{currentViewChannels.push(channel);}});
registerScheduledTimedActionIpc({handle:channel=>{currentViewChannels.push(channel);}});
registerLoopCurrentViewIpc({handle:channel=>{currentViewChannels.push(channel);}},{} as never,()=>false);
registerLoopOutputIpc({handle:channel=>{currentViewChannels.push(channel);}},{} as never,()=>false);
registerLoopManagementIpc({handle:channel=>{currentViewChannels.push(channel);}});
registerThreadMetadataIpc({handle:channel=>{currentViewChannels.push(channel);}});
registerDesktopSmallConfigIpc({handle:channel=>{currentViewChannels.push(channel);}});

function extractIpcChannels(source: string): string[] {
  const matches = [...source.matchAll(/(?:(?:ipcMain|shutdownAwareIpc)\.handle|fileHandler)\(\s*['"]([^'"]+)['"]/g)];
  return matches.map(m => m[1]).sort();
}

describe('IPC schema coverage', () => {
  it('enumerates all registered IPC channels from main.ts and ipc.ts', () => {
    const mainChannels = [...extractIpcChannels(mainSource),...currentViewChannels];
    const ipcChannels = extractIpcChannels(ipcSource);
    const allChannels = [...new Set([...mainChannels, ...ipcChannels])].sort();

    expect(allChannels.length).toBeGreaterThan(50);
  });

  it('has no duplicate channel registrations across files', () => {
    const mainChannels = [...extractIpcChannels(mainSource),...currentViewChannels];
    const ipcChannels = extractIpcChannels(ipcSource);

    const dupes = mainChannels.filter(c => ipcChannels.includes(c));
    expect(dupes, `Channels registered in both main.ts and ipc.ts: ${dupes.join(', ')}`).toEqual([]);
  });

  it('all channels follow the desktop: prefix convention', () => {
    const mainChannels = [...extractIpcChannels(mainSource),...currentViewChannels];
    const ipcChannels = extractIpcChannels(ipcSource);
    const allChannels = [...mainChannels, ...ipcChannels];

    const nonConforming = allChannels.filter(c => !c.startsWith('desktop:'));
    expect(nonConforming, `Channels not using desktop: prefix: ${nonConforming.join(', ')}`).toEqual([]);
  });

  it('registers loop diagnostics channels without renderer mutation channels', () => {
    const mainChannels = [...extractIpcChannels(mainSource),...currentViewChannels];
    const ipcChannels = extractIpcChannels(ipcSource);
    const allChannels = new Set([...mainChannels, ...ipcChannels]);

    expect([...allChannels].sort()).toEqual(expect.arrayContaining([
      'desktop:loops:listDefinitions',
      'desktop:loops:listUserTemplates',
      'desktop:loops:createUserTemplate',
      'desktop:loops:createSchedule',
      'desktop:automations:getOverviewSnapshot',
      'desktop:automations:getRunHistory',
      'desktop:automations:getConfig',
      'desktop:automations:setGlobalBackgroundAutoRun',
      'desktop:loops:openOutputDirectory',
      'desktop:loops:readOutputPreview',
      'desktop:loops:listRuns',
      'desktop:loops:listAnomalies',
      'desktop:loops:runNow',
    ]));
    expect(allChannels.has('desktop:loops:insertEvidence')).toBe(false);
    expect(allChannels.has('desktop:loops:completeLoopRun')).toBe(false);
    expect(allChannels.has('desktop:loops:completeTask')).toBe(false);
  });
});
