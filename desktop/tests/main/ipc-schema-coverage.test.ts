import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const mainSource = readFileSync(join(import.meta.dirname, '..', '..', 'electron', 'main.ts'), 'utf8');
const ipcSource = readFileSync(join(import.meta.dirname, '..', '..', 'electron', 'ipc.ts'), 'utf8');

function extractIpcChannels(source: string): string[] {
  const matches = [...source.matchAll(/ipcMain\.handle\(\s*['"]([^'"]+)['"]/g)];
  return matches.map(m => m[1]).sort();
}

describe('IPC schema coverage', () => {
  it('enumerates all registered IPC channels from main.ts and ipc.ts', () => {
    const mainChannels = extractIpcChannels(mainSource);
    const ipcChannels = extractIpcChannels(ipcSource);
    const allChannels = [...new Set([...mainChannels, ...ipcChannels])].sort();

    expect(allChannels.length).toBeGreaterThan(50);
  });

  it('has no duplicate channel registrations across files', () => {
    const mainChannels = extractIpcChannels(mainSource);
    const ipcChannels = extractIpcChannels(ipcSource);

    const dupes = mainChannels.filter(c => ipcChannels.includes(c));
    expect(dupes, `Channels registered in both main.ts and ipc.ts: ${dupes.join(', ')}`).toEqual([]);
  });

  it('all channels follow the desktop: prefix convention', () => {
    const mainChannels = extractIpcChannels(mainSource);
    const ipcChannels = extractIpcChannels(ipcSource);
    const allChannels = [...mainChannels, ...ipcChannels];

    const nonConforming = allChannels.filter(c => !c.startsWith('desktop:'));
    expect(nonConforming, `Channels not using desktop: prefix: ${nonConforming.join(', ')}`).toEqual([]);
  });

  it('registers loop diagnostics channels without renderer mutation channels', () => {
    const mainChannels = extractIpcChannels(mainSource);
    const ipcChannels = extractIpcChannels(ipcSource);
    const allChannels = new Set([...mainChannels, ...ipcChannels]);

    expect([...allChannels].sort()).toEqual(expect.arrayContaining([
      'desktop:loops:listDefinitions',
      'desktop:loops:listRuns',
      'desktop:loops:listAnomalies',
      'desktop:loops:runNow',
      'desktop:loops:listUserTemplates',
      'desktop:loops:createUserTemplate',
      'desktop:loops:updateUserTemplate',
      'desktop:loops:deleteUserTemplate',
      'desktop:loops:setUserTemplateAutoRunApproved',
    ]));
    expect(allChannels.has('desktop:loops:insertEvidence')).toBe(false);
    expect(allChannels.has('desktop:loops:completeLoopRun')).toBe(false);
    expect(allChannels.has('desktop:loops:completeTask')).toBe(false);
    expect([...allChannels].some(channel => /evidence.*(insert|update|delete|complete)/i.test(channel))).toBe(false);
  });
});
